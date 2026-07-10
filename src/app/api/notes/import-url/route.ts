import { NextRequest } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { ok, fail, handle, AppError, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { buildExcerpt } from "@/lib/format";
import { htmlToStructuredMarkdown, paragraphizePlainText } from "@/lib/note-structure";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 10_000; // 抓取超时 10s
const MAX_BODY_LEN = 50_000; // 正文截断 50k 字符
const MAX_HTML_BYTES = 4_000_000; // 原始 HTML 硬上限 4MB，防超大页面撑爆内存

/**
 * SSRF 防护：仅允许 http/https，且 hostname / 解析出的 IP 不得指向内网 / 环回 / 链路本地。
 * 拒绝：localhost、127./10./192.168./172.16-31./169.254.、::1、fc00::/7、fe80::、内网泄漏的 metadata IP。
 * 注意：需对 hostname 做 DNS 解析后再判定，防止「域名解析到内网」的绕过。
 */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map((n) => parseInt(n, 10));
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 127) return true; // 环回
    if (a === 10) return true; // 私有 A
    if (a === 192 && b === 168) return true; // 私有 C
    if (a === 172 && b >= 16 && b <= 31) return true; // 私有 B
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10（阿里云 metadata 100.100.100.200 属此段）
    if (a === 169 && b === 254) return true; // 链路本地 / 云 metadata (169.254.169.254)
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // 组播 / 保留
    return false;
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // 环回 / 未指定
    if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true; // 链路本地 / ULA
    // IPv4-mapped（::ffff:127.0.0.1 等）：抽出末段 IPv4 再判
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true; // 非法 IP 一律拒绝
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, ""); // 去尾点
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "localhost.localdomain") return true;
  // hostname 本身就是字面 IP：直接判
  if (isIP(h)) return isBlockedIp(h);
  return false;
}

/** 校验被拒绝时抛出的哨兵错误：hostname 命中黑名单 / 解析失败 / 解析出内网 IP。 */
class BlockedTargetError extends Error {}

/**
 * 对单个 hostname 做 SSRF 校验并返回「把连接钉死在已校验 IP」的 undici Agent，消除 DNS-rebinding 的 TOCTOU：
 * 1) hostname 字面黑名单；2) DNS 解析拿到全部地址；3) 每个 IP 过 isBlockedIp；
 * 4) 选一个已校验通过的 IP，构造 Agent，其 connect.lookup 只返回该 IP —— 实际 TCP 连接必然连到校验过的地址，
 *    而不是在校验后又被重新解析到内网（rebinding）。
 * 校验不通过统一抛 BlockedTargetError。
 */
async function pinnedAgentFor(hostname: string): Promise<Agent> {
  if (isBlockedHostname(hostname)) throw new BlockedTargetError();
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedTargetError();
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new BlockedTargetError();
  }
  // 全部 IP 均已校验通过；钉在第一个上（连接期不再重新解析）。
  const pinned = addrs[0];
  return new Agent({
    connect: {
      lookup: (_hostname, _opts, cb) => cb(null, [{ address: pinned.address, family: pinned.family }]),
    },
  });
}

/**
 * POST /api/notes/import-url — 链接导入：抓取网页 → 正文提取 → 落库为独立笔记。
 * 安全：仅 http/https、超时、正文截断、SSRF（hostname + 解析 IP 双重拦截内网/环回）。
 * 落库：source="link_import"、sourceUrl=原始 url、title=页面标题、contentMd=正文。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, "note_import_url", 10, 60_000);

    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const raw = body.url?.trim();
    if (!raw) return fail("请输入要导入的链接");

    // 协议 + 格式校验
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return fail("链接格式不合法");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return fail("仅支持 http/https 链接");
    }

    // SSRF 第一道：hostname 字面拦截
    if (isBlockedHostname(target.hostname)) {
      return fail("不允许导入内网或本地地址");
    }
    // SSRF 第二道：DNS 解析后逐个 IP 拦截（防域名解析到内网绕过）
    try {
      const addrs = await lookup(target.hostname, { all: true });
      if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
        return fail("不允许导入内网或本地地址");
      }
    } catch {
      return fail("无法解析该链接的地址");
    }

    // 免费额度预检（与 /api/notes 一致口径），在昂贵抓取前先挡
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canCreateNoteUnlimited) {
      const count = await prisma.note.count({ where: { userId: user.id, deletedAt: null } });
      if (count >= snapshot.noteFreeLimit) {
        throw new AppError(`免费用户最多创建 ${snapshot.noteFreeLimit} 篇笔记，订阅后可无限记录`, 402);
      }
    }

    // 抓取（超时 + 限制大小 + 逐跳 SSRF 校验）：
    // 手动跟随重定向（redirect:"manual"），每一跳都重跑 hostname 黑名单 + DNS 解析 + IP 黑名单，
    // 并用 pinnedAgentFor 把该跳的 TCP 连接钉死在已校验的 IP 上，消除「校验用 IP ≠ 实际连接 IP」的
    // DNS-rebinding TOCTOU；同时防止中途 3xx 跳到内网而不被校验。最多跟随 3 跳。
    const MAX_REDIRECTS = 3;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    let finalUrl = target.toString();
    // 最终响应所用的 Agent：其 body 在循环外流式读取，故不能在循环内提前 close，
    // 否则会打断正在传输的 body。跟随到最终一跳后由 finally 统一关闭。
    let activeDispatcher: Agent | null = null;
    try {
      let currentUrl = target.toString();
      let res: Response | null = null;
      for (let hop = 0; ; hop++) {
        let hopTarget: URL;
        try {
          hopTarget = new URL(currentUrl);
        } catch {
          return fail("抓取链接失败，请检查地址后重试");
        }
        if (hopTarget.protocol !== "http:" && hopTarget.protocol !== "https:") {
          return fail("链接跳转到了不支持的协议，已拒绝");
        }

        // 该跳的 SSRF 校验 + 连接钉 IP（校验不通过抛 BlockedTargetError）
        let dispatcher: Agent;
        try {
          dispatcher = await pinnedAgentFor(hopTarget.hostname);
        } catch (e) {
          if (e instanceof BlockedTargetError) {
            return fail(hop === 0 ? "不允许导入内网或本地地址" : "链接跳转到了内网地址，已拒绝");
          }
          throw e;
        }

        try {
          res = await fetch(hopTarget.toString(), {
            signal: controller.signal,
            redirect: "manual",
            // 把连接强制到已校验的 IP（undici dispatcher）；Next 的 fetch 类型未声明该字段。
            // @ts-expect-error undici dispatcher 传参，运行时受支持
            dispatcher,
            headers: {
              "user-agent": "Mozilla/5.0 (compatible; TideNoteImporter/1.0)",
              accept: "text/html,application/xhtml+xml",
            },
          });
        } catch (fetchErr) {
          // fetch 抛错时本跳 Agent 不会被后续逻辑接管，就地关闭防泄漏后再抛给外层处理。
          void dispatcher.close().catch(() => {});
          throw fetchErr;
        }

        // 3xx：本跳 body 不再需要，关闭其 Agent；手动读 Location，校验后进入下一跳。
        if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
          void dispatcher.close().catch(() => {});
          if (hop >= MAX_REDIRECTS) return fail("重定向次数过多，已拒绝");
          const location = res.headers.get("location")!;
          let next: URL;
          try {
            next = new URL(location, hopTarget); // 相对跳转按当前 URL 解析
          } catch {
            return fail("链接跳转地址不合法，已拒绝");
          }
          currentUrl = next.toString();
          continue;
        }

        // 非重定向：这是最终响应，其 Agent 需存活到 body 读完，交由外层 finally 关闭。
        activeDispatcher = dispatcher;
        finalUrl = hopTarget.toString();
        break;
      }

      if (!res) return fail("抓取链接失败，请检查地址后重试");
      if (!res.ok) return fail(`抓取失败（HTTP ${res.status}）`);

      const ctype = res.headers.get("content-type") ?? "";
      if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) {
        return fail("该链接不是可解析的网页");
      }

      // 按 MAX_HTML_BYTES 限制读取量：流式累加字节，超阈值立即中断（避免先读满内存再判）
      if (!res.body) return fail("抓取链接失败，请检查地址后重试");
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let tooLarge = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_HTML_BYTES) {
            tooLarge = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      if (tooLarge) return fail("页面过大，无法导入");
      const decoder = new TextDecoder("utf-8");
      html = chunks.map((c, i) => decoder.decode(c, { stream: i < chunks.length - 1 })).join("");
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof Error && e.name === "AbortError") return fail("抓取超时，请稍后重试");
      return fail("抓取链接失败，请检查地址后重试");
    } finally {
      clearTimeout(timer);
      // 最终响应的 Agent 到此 body 已读完（或已异常终止），统一关闭。
      if (activeDispatcher) void activeDispatcher.close().catch(() => {});
    }

    // 正文提取：jsdom 解析 + Readability。用 finalUrl 作为 base 便于相对链接解析。
    let pageTitle = "";
    let articleMd = "";
    try {
      const dom = new JSDOM(html, { url: finalUrl });
      const doc = dom.window.document;
      pageTitle = doc.title?.trim() ?? "";
      const reader = new Readability(doc);
      const article = reader.parse();
      if (article) {
        pageTitle = article.title?.trim() || pageTitle;
        // 优先用 Readability 的结构化 HTML（article.content）做块级 → Markdown 的结构化，
        // 保住段落 / 标题 / 列表 / 引用的断行；纯 textContent 会把整篇塞成一坨、前端渲染成「一团乱」。
        if (article.content) {
          articleMd = htmlToStructuredMarkdown(article.content, dom.window.document);
        }
        // article.content 结构化失败时，退回 textContent，但按「双换行 / 单换行」补分段，避免堆叠。
        if (!articleMd) {
          articleMd = paragraphizePlainText(article.textContent ?? "");
        }
      }
      // 兜底：Readability 提不出正文时退回 body 纯文本，同样做基本分段。
      if (!articleMd) {
        articleMd = paragraphizePlainText(doc.body?.textContent ?? "");
      }
    } catch {
      return fail("正文解析失败，该页面可能不受支持");
    }

    if (!articleMd) return fail("未能从该链接提取到正文");

    // 正文截断 50k
    if (articleMd.length > MAX_BODY_LEN) {
      articleMd = articleMd.slice(0, MAX_BODY_LEN) + "\n\n…（正文过长，已截断）";
    }

    const title = pageTitle.slice(0, 200) || "网页导入";
    // 正文首行附来源链接引用，便于回溯
    const contentMd = `> 来源：[${title}](${finalUrl})\n\n${articleMd}`;
    const excerpt = buildExcerpt(contentMd);

    // 落库：独立笔记，source=link_import、sourceUrl 记录原始链接
    const note = await prisma.note.create({
      data: {
        userId: user.id,
        title,
        contentMd,
        excerpt,
        source: "link_import",
        sourceUrl: raw,
        kind: "text",
      },
      select: { id: true, title: true },
    });

    await track({
      eventName: "note_import_url",
      userId: user.id,
      properties: { host: target.hostname, body_len: articleMd.length },
    });

    return ok({ id: note.id, title: note.title });
  });
}
