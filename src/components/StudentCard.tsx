import { headers } from "next/headers";
import QRCode from "qrcode";
import { Quotes, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { deriveLevel } from "@/lib/level";

/**
 * StudentCard, 学生证（v2.3 §2 → 对齐 iOS StudentCardView 重构）。
 * 证件语言：顶部深色校徽抬头带（--video-grad + 「有道自习室」+ 订阅胶囊 + 学生证 mono 字）
 * → 主体纸质白底左对齐信息栏（头像 + 昵称 + 学号行 + 入学行 + 等级胶囊 + 紧凑数据行）
 * → 卡脚格言（引号图标 + 可换行）与二维码。双端并排能认出是同一张证。
 * server component：二维码在服务端生成 SVG（指向个人主页 /u/[id]）。
 *
 * variant="full", /me 头部大卡（含格言 + 二维码）
 * variant="mini", 侧栏缩微卡（头像 + 姓名 + 编号 + streak）
 */

export interface StudentCardData {
  userId: string;
  nickname: string;
  pinyin?: string | null; // 昵称拼音（无则不显示）
  studentNo: string; // 证件编号 YD·2026·0817
  joinedYear: number;
  joinedMonth: number;
  totalSeconds: number; // 累计学习秒数（算等级 + 小时数）
  streak: number;
  isSubscriber: boolean;
  validLabel: string; // "VALID FOREVER" / "VALID 2026.09"
  motto?: string | null; // 个性格言
  avatarUrl?: string | null;
}

async function makeQr(userId: string): Promise<string> {
  try {
    // HIGH-4 修复：用绝对 URL，扫码才能解析成可打开的链接（相对路径手机相机识别为裸文本）。
    let origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
    if (!origin) {
      const h = await headers();
      const host = h.get("host");
      const proto = h.get("x-forwarded-proto") ?? "https";
      origin = host ? `${proto}://${host}` : "";
    }
    const url = origin ? `${origin}/u/${userId}` : `/u/${userId}`;
    return await QRCode.toString(url, {
      type: "svg",
      margin: 0,
      color: { dark: "#1a1d24", light: "#00000000" }, // 深灰码 + 透明底
    });
  } catch {
    return "";
  }
}

/** 侧栏缩微版（同步，client 安全）：同纸质语言，砍格言/二维码。 */
export function StudentCardMini({ data }: { data: StudentCardData }) {
  const level = deriveLevel(data.totalSeconds);
  const initial = data.nickname.slice(0, 1);
  return (
    <div className="studio-lift relative overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card)]">
      <span className="absolute left-0 top-3.5 h-4 w-[3px] rounded-r bg-[var(--red)]" aria-hidden />
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[13px] font-bold text-[var(--ink2)]">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-[var(--ink)]">{data.nickname}</span>
            {data.isSubscriber && <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-[var(--red)]" aria-hidden />}
          </div>
          <span className="mono block truncate text-[10px] tracking-[0.08em] text-[var(--ink4)]">{data.studentNo}</span>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border)] pt-2">
        <span className="mono text-[10px] text-[var(--ink4)]">Lv.{level.level} {level.title}</span>
        <span className="mono text-[11px] font-semibold text-[var(--ink2)]">{data.streak}d</span>
      </div>
    </div>
  );
}

/** /me 头部大卡（async server：含二维码生成）。 */
export async function StudentCard({ data, headerAction }: { data: StudentCardData; headerAction?: React.ReactNode }) {
  const level = deriveLevel(data.totalSeconds);
  const initial = data.nickname.slice(0, 1);
  const joined = `${data.joinedYear}.${String(data.joinedMonth).padStart(2, "0")}`;
  const hoursLabel = level.hours >= 1000 ? level.hours.toLocaleString("en-US", { maximumFractionDigits: 0 }) : `${level.hours}`;
  const qrSvg = await makeQr(data.userId);
  return (
    <div className="studio-rise relative flex flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
      {/* ① 深色校徽抬头带（对齐 iOS videoGradient 抬头）：品牌 + 学生证 mono 字 + 订阅胶囊 */}
      <div className="relative overflow-hidden px-6 pb-5 pt-5 sm:px-7" style={{ background: "var(--video-grad)" }}>
        {/* 右下红色柔光，暗带不死板 */}
        <span
          className="pointer-events-none absolute -bottom-12 -right-10 h-32 w-32 rounded-full opacity-30 blur-2xl"
          style={{ background: "radial-gradient(circle, var(--red) 0%, transparent 70%)" }}
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {/* 校徽（public/brand/studio-emblem.png，红色单色浮雕）：白底芯片衬托，证件感 */}
            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-white/95 shadow-[var(--red-glow)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/studio-emblem.png" alt="" className="h-7 w-7" draggable={false} />
            </span>
            <div className="leading-tight">
              <p className="text-[14px] font-bold tracking-[0.04em] text-[var(--ink-on-dark)]">有道自习室</p>
              <p className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--ink-on-dark-3)]">STUDENT ID</p>
            </div>
          </div>
          {/* 右侧：订阅胶囊 + 可选操作（如分享按钮，走 flex 流内，避免与胶囊绝对定位重叠）*/}
          <div className="flex items-center gap-2">
            {data.isSubscriber ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-on-dark)] bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold text-[var(--ink-on-dark)]">
                <SealCheck size={12} weight="fill" className="text-[var(--red)]" /> 会员
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-[var(--hairline-on-dark)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--ink-on-dark-2)]">
                免费学员
              </span>
            )}
            {headerAction}
          </div>
        </div>
      </div>

      {/* ② 纸质主体：头像 + 昵称 + 左对齐信息栏 */}
      <div className="relative flex-1 px-6 pb-6 pt-5 sm:px-7">
        {/* 极淡纸纹 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "24px 24px",
            maskImage: "linear-gradient(to bottom right, rgba(0,0,0,0.35), transparent 70%)",
            WebkitMaskImage: "linear-gradient(to bottom right, rgba(0,0,0,0.35), transparent 70%)",
          }}
          aria-hidden
        />

        {/* 头像 + 昵称 + 等级胶囊 */}
        <div className="relative flex items-center gap-3.5">
          {data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.avatarUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
            />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[22px] font-bold text-[var(--ink2)]">
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[22px] font-bold leading-none text-[var(--ink)]">{data.nickname}</h2>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* 等级胶囊（对齐 iOS levelPill） */}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red-ink)]">
                Lv.{level.level} {level.title}
              </span>
              {data.pinyin && (
                <span className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink4)]">{data.pinyin}</span>
              )}
            </div>
          </div>
        </div>

        {/* 信息行（学号 / 入学 / 累计 / 连续）：iOS infoRow 语言，非三个 34px 巨字 */}
        <dl className="relative mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4">
          <InfoRow label="学号" value={data.studentNo} mono />
          <InfoRow label="入学" value={`${joined} · ${data.validLabel}`} mono />
          <InfoRow label="累计学习" value={<><span className="mono">{hoursLabel}</span> 小时</>} />
          <InfoRow label="连续" value={<><span className="mono">{data.streak}</span> 天</>} />
        </dl>

        {/* ③ 卡脚：格言（引号图标 + 可换行，去 italic）+ 二维码 */}
        <div className="relative mt-5 flex items-end justify-between gap-4 border-t border-[var(--border)] pt-4">
          <div className="min-w-0">
            {data.motto ? (
              <div className="flex gap-2">
                <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-[var(--ink4)]" aria-hidden />
                <p className="line-clamp-2 text-[14px] leading-[1.6] text-[var(--ink2)]">{data.motto}</p>
              </div>
            ) : (
              <p className="text-[13px] leading-[1.6] text-[var(--ink4)]">写一句座右铭，给这张证一点温度。</p>
            )}
          </div>
          {/* 二维码 → 个人主页（扫码或点击均可访问，带说明避免「这方框是啥」的困惑）*/}
          {qrSvg && (
            <a
              href={`/u/${data.userId}`}
              title="扫码或点击访问我的主页"
              aria-label="我的主页二维码，点击可访问"
              className="group flex shrink-0 flex-col items-center gap-1"
            >
              <span
                className="h-[72px] w-[72px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1.5 opacity-90 transition-opacity group-hover:opacity-100 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <span className="text-[9.5px] leading-none text-[var(--ink4)] transition-colors group-hover:text-[var(--ink3)]">
                扫码看主页
              </span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** 证件信息行（iOS infoRow：小标签 + 值，左对齐）。 */
function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--ink4)]">{label}</dt>
      <dd className={`mt-1 truncate text-[13px] font-semibold text-[var(--ink)] ${mono ? "mono tracking-[0.06em]" : ""}`}>{value}</dd>
    </div>
  );
}
