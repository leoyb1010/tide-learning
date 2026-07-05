import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { ok, fail, handle, AppError, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { buildExcerpt } from "@/lib/format";
import { paragraphizePlainText } from "@/lib/note-structure";

// Node 运行时：pdf-parse 依赖 Buffer / node 内建，且经 createRequire 运行时加载（见下）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 15_000_000; // 上传 PDF 硬上限 15MB，防超大文件撑爆内存 / 拖垮解析
const MAX_BODY_LEN = 50_000; // 抽出正文截断 50k 字符（与 import-url 一致口径）
const PARSE_TIMEOUT_MS = 20_000; // PDF 解析超时 20s，防畸形/超复杂 PDF 卡死

/**
 * 运行时加载 pdf-parse 的内层实现，绕开打包器。
 * 1) 直接指向 lib/pdf-parse.js，避开 index.js 里 `!module.parent` 的自测调试块。
 * 2) 用 eval("require") 拿到「未被打包器改写」的原生 require —— pdf-parse 内部有
 *    `require(`./pdf.js/${version}/build/pdf.js`)` 的模板字面量动态依赖，静态打包无法解析；
 *    走原生 require 让它在 Node 运行时按真实文件系统解析，稳定可用。
 */
type PdfParseFn = (buf: Buffer, opts?: { max?: number }) => Promise<{ numpages: number; text: string }>;
let cachedPdfParse: PdfParseFn | null = null;
function loadPdfParse(): PdfParseFn {
  if (cachedPdfParse) return cachedPdfParse;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
  const nodeRequire = eval("require") as NodeRequire;
  cachedPdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js") as PdfParseFn;
  return cachedPdfParse;
}

/** 给 pdf 解析套一层超时，避免畸形 PDF 长时间占用。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new AppError("PDF 解析超时，请换一个文件重试", 422)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 从文件名推导笔记标题（去扩展名、清理路径分隔符），失败回落。 */
function titleFromFilename(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.pdf$/i, "").trim();
  return (noExt || "PDF 导入").slice(0, 200);
}

/**
 * 读取上传：兼容两种入参形态。
 *  1) multipart/form-data：字段 file（File / Blob）→ 首选，Web 前端 <input type=file>。
 *  2) application/json：{ base64: string, filename?: string } → 供原生 App / 脚本用 base64 上传。
 * 返回 { bytes, filename }，越限/缺失抛 AppError。
 */
async function readUpload(req: NextRequest): Promise<{ bytes: Buffer; filename: string | null }> {
  const ctype = req.headers.get("content-type") ?? "";

  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) throw new AppError("表单解析失败", 400);
    const file = form.get("file");
    if (!file || typeof file === "string") throw new AppError("请上传 PDF 文件", 400);
    const blob = file as File;
    if (blob.size > MAX_PDF_BYTES) throw new AppError("PDF 文件过大（上限 15MB）", 413);
    const buf = Buffer.from(await blob.arrayBuffer());
    const name = "name" in blob && typeof blob.name === "string" ? blob.name : null;
    return { bytes: buf, filename: name };
  }

  // JSON base64 形态
  const body = (await req.json().catch(() => null)) as { base64?: string; filename?: string } | null;
  const b64 = body?.base64?.trim();
  if (!b64) throw new AppError("请上传 PDF 文件（form-data file 或 base64）", 400);
  // 去掉可能的 data URL 前缀
  const pure = b64.replace(/^data:application\/pdf;base64,/i, "");
  // 粗估解码后大小：base64 长度 * 3/4，超限直接挡，避免先解码再判
  if (pure.length * 0.75 > MAX_PDF_BYTES) throw new AppError("PDF 文件过大（上限 15MB）", 413);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(pure, "base64");
  } catch {
    throw new AppError("PDF base64 解码失败", 400);
  }
  if (bytes.length === 0) throw new AppError("PDF 内容为空", 400);
  if (bytes.length > MAX_PDF_BYTES) throw new AppError("PDF 文件过大（上限 15MB）", 413);
  return { bytes, filename: typeof body?.filename === "string" ? body!.filename : null };
}

/**
 * POST /api/notes/import-pdf —— PDF 导入：上传 PDF → 抽取文本 → 共享结构化分段 → 落库为独立笔记。
 *
 * 入参：multipart/form-data（字段 file）或 application/json（{ base64, filename? }）。
 * 抽取：pdf-parse 取整篇文本 → paragraphizePlainText 复用 import-url 同款分段（保段落断行）。
 * 落库：source="pdf_import"、kind="text"、title 取原文件名、正文首行标注来源文件名。
 * 安全：requireUser + 同源校验 + 限流 + 大小上限 + 解析超时；免费额度预检（与 /api/notes 同口径）。
 * 越权铁律：笔记强制挂当前 user.id。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    // PDF 解析成本较高，按 IP 限流：每分钟 6 次
    assertRateLimit(req, "note_import_pdf", 6, 60_000);

    // 免费额度预检（与 /api/notes、import-url 一致口径），在昂贵解析前先挡
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canCreateNoteUnlimited) {
      const count = await prisma.note.count({ where: { userId: user.id, deletedAt: null } });
      if (count >= snapshot.noteFreeLimit) {
        throw new AppError(`免费用户最多创建 ${snapshot.noteFreeLimit} 篇笔记，订阅后可无限记录`, 402);
      }
    }

    // —— 读取上传（form-data 或 base64）——
    const { bytes, filename } = await readUpload(req);

    // 头部魔数校验：真 PDF 以 "%PDF" 开头，挡掉伪装 / 损坏文件，避免喂进解析器空转
    const magic = bytes.subarray(0, 5).toString("latin1");
    if (!magic.startsWith("%PDF-")) return fail("该文件不是有效的 PDF");

    // —— 抽取文本（超时保护）——
    let rawText = "";
    let numPages = 0;
    try {
      const pdfParse = loadPdfParse();
      const parsed = await withTimeout(pdfParse(bytes, { max: 0 }), PARSE_TIMEOUT_MS);
      rawText = parsed.text ?? "";
      numPages = parsed.numpages ?? 0;
    } catch (e) {
      if (e instanceof AppError) throw e;
      // 加密 / 畸形 / 扫描件（无文本层）等：统一收敛为 422，不泄露解析器细节
      return fail("无法从该 PDF 提取文本（可能是扫描件或加密文件）", 422);
    }

    // —— 结构化分段（复用 import-url 同款 paragraphizePlainText）——
    let bodyMd = paragraphizePlainText(rawText);
    if (!bodyMd.trim()) {
      return fail("该 PDF 未提取到可用文本（可能是纯图片扫描件）", 422);
    }
    if (bodyMd.length > MAX_BODY_LEN) {
      bodyMd = bodyMd.slice(0, MAX_BODY_LEN) + "\n\n…（正文过长，已截断）";
    }

    const title = titleFromFilename(filename);
    // 正文首行标注来源文件，便于回溯
    const contentMd = `> 来源：PDF 文件《${title}》${numPages ? ` · 共 ${numPages} 页` : ""}\n\n${bodyMd}`;
    const excerpt = buildExcerpt(contentMd);

    // 落库：独立笔记，source="pdf_import"、kind="text"
    const note = await prisma.note.create({
      data: {
        userId: user.id,
        title,
        contentMd,
        excerpt,
        source: "pdf_import",
        kind: "text",
      },
      select: { id: true, title: true },
    });

    await track({
      eventName: "note_import_pdf",
      userId: user.id,
      properties: { pages: numPages, body_len: bodyMd.length },
    });

    return ok({ id: note.id, title: note.title });
  });
}
