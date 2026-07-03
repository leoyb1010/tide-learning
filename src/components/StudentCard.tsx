import { headers } from "next/headers";
import QRCode from "qrcode";
import { deriveLevel } from "@/lib/level";

/**
 * StudentCard —— 学生证（v2.3 §2，对标参考图重设计）。
 * 极简纸质证件：暖白底 + 大数字排版 + 等级称号 + 证件编号 + 格言 + 二维码。
 * 红色几乎不用（仅左上一枚极小校徽点），高级感来自留白与排版而非酷炫深色。
 * server component：二维码在服务端生成 SVG（指向个人主页 /u/[id]）。
 *
 * variant="full"  —— /me 头部大卡（含格言 + 二维码）
 * variant="mini"  —— 侧栏缩微卡（头像 + 姓名 + 编号 + streak）
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
export async function StudentCard({ data }: { data: StudentCardData }) {
  const level = deriveLevel(data.totalSeconds);
  const initial = data.nickname.slice(0, 1);
  const joined = `${data.joinedYear}.${String(data.joinedMonth).padStart(2, "0")}`;
  const qrSvg = await makeQr(data.userId);
  return (
    <div className="studio-rise relative overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card)] sm:p-8">
      {/* 极淡纸纹 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(to bottom right, rgba(0,0,0,0.4), transparent 70%)",
          WebkitMaskImage: "linear-gradient(to bottom right, rgba(0,0,0,0.4), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative flex items-start justify-between">
        {/* 左上：头像 + 姓名 + 拼音 */}
        <div className="flex items-center gap-3.5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[22px] font-bold text-[var(--ink2)]">
            {initial}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[24px] font-bold leading-none text-[var(--ink)]">{data.nickname}</h2>
              {/* 红色校徽点 —— 全卡唯一的红 */}
              <span className="h-2 w-2 rounded-[2px] bg-[var(--red)]" aria-hidden />
            </div>
            {data.pinyin && (
              <p className="mono mt-1.5 text-[11px] uppercase tracking-[0.24em] text-[var(--ink4)]">{data.pinyin}</p>
            )}
          </div>
        </div>
        {/* 右上：品牌位 */}
        <div className="text-right">
          <p className="text-[13px] font-semibold tracking-[0.1em] text-[var(--ink2)]">自习室</p>
          <p className="mono text-[10px] uppercase tracking-[0.24em] text-[var(--ink4)]">STUDIO</p>
        </div>
      </div>

      {/* 中部：三个大数字 */}
      <div className="relative mt-8 flex flex-wrap items-end gap-x-10 gap-y-4">
        <BigStat value={level.hours >= 1000 ? level.hours.toLocaleString("en-US", { maximumFractionDigits: 0 }) : `${level.hours}`} unit="h" label="TOTAL HOURS" />
        <BigStat value={`${data.streak}`} unit="d" label="STREAK" />
        <BigStat value={`Lv.${level.level}`} label={level.title} />
      </div>

      {/* 底部：编号 + 格言 / 二维码 */}
      <div className="relative mt-10 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mono text-[12px] tracking-[0.12em] text-[var(--ink3)]">{data.studentNo}</p>
          {data.motto && (
            <p className="mt-2 truncate text-[14px] italic text-[var(--ink2)]">"{data.motto}"</p>
          )}
          <p className="mono mt-2.5 text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">
            JOINED {joined} · {data.validLabel}
          </p>
        </div>
        {/* 二维码 → 个人主页 */}
        {qrSvg && (
          <div
            className="h-[76px] w-[76px] shrink-0 opacity-80 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            aria-label="个人主页二维码"
          />
        )}
      </div>
    </div>
  );
}

/** 大数字统计（等宽字，单位小写上标风格）。 */
function BigStat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div>
      <p className="font-[var(--font-jakarta)] text-[34px] font-extrabold leading-none tracking-tight text-[var(--ink)]">
        {value}
        {unit && <span className="ml-0.5 text-[16px] font-semibold text-[var(--ink3)]">{unit}</span>}
      </p>
      <p className="mono mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">{label}</p>
    </div>
  );
}
