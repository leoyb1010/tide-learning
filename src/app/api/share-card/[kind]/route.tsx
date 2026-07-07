import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getGamificationSummary } from "@/lib/gamification";
import { deriveLevel } from "@/lib/level";
import { formatDurationSec } from "@/lib/format";
import { shanghaiDayKey } from "@/lib/week";

/**
 * v3.2 全局分享体系 —— 统一分享图服务（next/og · ImageResponse / satori）。
 *
 * GET /api/share-card/[kind]?w=og&theme=light&courseId=...&noteId=...&examId=...
 *   kind:  student-card | week-report | course-done | note-quote | streak | exam-result
 *   w=og   → 1200x630 横版（默认竖版 1080x1440，朋友圈/小红书）
 *   theme  → light | dark（默认 dark；深色更出片，浅色配浅色系统主题）
 *
 * v3.2 重做要点（对齐「分享卡太单调」反馈）：
 * - 深/浅双主题：palette(theme) 统一供色，所有元件按 palette 渲染。
 * - Shell 2.0：径向光斑 + SVG 潮汐波形（真实图形主视觉）+ 品牌带 + 二维码（传播闭环）。
 * - 每张卡一个图形主视觉：头像/等级、峰值柱图+活跃点、完课印章、巨型引号、14 格潮汐日历、评级环。
 *
 * 铁律（不变）：
 * - 越权铁律：note-quote / course-done / exam-result 只查「当前登录用户自己」的数据（where userId）。
 * - satori 限制：不支持 CSS 变量 / grid，全部内联样式 + flex；多子节点容器必须显式 display:flex。
 * - 错误兜底：数据缺失 / 未登录 / 异常一律回通用品牌卡，永不 500、永不泄漏堆栈。
 * - 私有缓存：URL 不含用户标识但渲染私有数据，故 private,no-store（见文末注释）。
 */
export const runtime = "nodejs"; // nodejs 而非 edge：需要 Prisma 直查 + qrcode
export const dynamic = "force-dynamic";

// ── 主题调色板 ──────────────────────────────────────────────
type Theme = "light" | "dark";
interface Palette {
  isDark: boolean;
  bgGrad: string; // 基座渐变
  base: string;
  base2: string; // 卡面
  base3: string; // 抬起面
  ink: string;
  ink2: string;
  ink3: string;
  red: string;
  redInk: string; // 红字（按主题调亮/调深保证可读）
  ok: string;
  border: string;
  wave: string; // 潮汐波形描边/次色
  glowRed: string; // 右上红光斑（中心色）
  glowRedEdge: string; // 红光斑边缘（同色 0 alpha，避免向纯黑透明插值出暗环）
  glowCool: string; // 左下冷光斑（中心色）
  glowCoolEdge: string; // 冷光斑边缘（同色 0 alpha）
}

function palette(theme: Theme): Palette {
  if (theme === "light") {
    return {
      isDark: false,
      bgGrad: "linear-gradient(155deg, #ffffff 0%, #eef1f6 46%, #e6ebf2 100%)",
      base: "#f4f6f9",
      base2: "#ffffff",
      base3: "#eef1f6",
      ink: "#171b22",
      ink2: "#4b5563",
      ink3: "#8b95a5",
      red: "#fc011a",
      redInk: "#d6001a",
      ok: "#1a9e6e",
      border: "#e3e7ee",
      wave: "#d7dee8",
      glowRed: "rgba(252,1,26,0.10)",
      glowRedEdge: "rgba(252,1,26,0)",
      glowCool: "rgba(90,120,200,0.08)",
      glowCoolEdge: "rgba(90,120,200,0)",
    };
  }
  return {
    isDark: true,
    bgGrad: "linear-gradient(155deg, #1d2330 0%, #171c26 46%, #0e1116 100%)",
    base: "#0e1116",
    base2: "#161b22",
    base3: "#232935",
    ink: "#edeff3",
    ink2: "#8790a0",
    ink3: "#5a6472",
    red: "#fc011a",
    redInk: "#ff5a4d",
    ok: "#37c491",
    border: "#2a313d",
    wave: "#243040",
    glowRed: "rgba(252,1,26,0.16)",
    glowRedEdge: "rgba(252,1,26,0)",
    glowCool: "rgba(122,160,255,0.10)",
    glowCoolEdge: "rgba(122,160,255,0)",
  };
}

const MONO = "ui-monospace, 'SF Mono', 'Roboto Mono', monospace";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

type Kind = "student-card" | "week-report" | "course-done" | "note-quote" | "streak" | "exam-result";
const KINDS: Kind[] = ["student-card", "week-report", "course-done", "note-quote", "streak", "exam-result"];

type Size = { w: number; h: number; landscape: boolean };
function resolveSize(sp: URLSearchParams): Size {
  return sp.get("w") === "og"
    ? { w: 1200, h: 630, landscape: true }
    : { w: 1080, h: 1440, landscape: false };
}

interface Ctx {
  size: Size;
  p: Palette;
  origin: string;
}

// ── 稳定派生 ────────────────────────────────────────────────
function studentNo(id: string, year: number): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return `YD·${year}·${String(h % 10000).padStart(4, "0")}`;
}
function certNo(userId: string, courseId: string): string {
  let h = 0;
  const s = userId + "::" + courseId;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return `CERT-${String(h % 1_000_000).padStart(6, "0")}`;
}
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

// ── 潮汐波形（真实 SVG 图形，底部品牌主视觉）────────────────
function waveDataUri(w: number, p: Palette): string {
  const h = 240;
  const band = (yBase: number, amp: number, fill: string, op: number) =>
    `<path d='M0 ${yBase} C ${w * 0.22} ${yBase - amp}, ${w * 0.4} ${yBase + amp}, ${w * 0.62} ${yBase} S ${w * 0.86} ${yBase - amp}, ${w} ${yBase} L ${w} ${h} L 0 ${h} Z' fill='${fill}' opacity='${op}'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    band(120, 46, p.wave, 0.9) +
    band(150, 36, p.red, 0.14) +
    band(184, 28, p.wave, 0.6) +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// ── 二维码（传播闭环；深/浅统一渲染为白底深码芯片）──────────
async function qrDataUri(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      margin: 0,
      width: 200,
      color: { dark: "#12151b", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  Shell 2.0（所有卡共用）
// ═══════════════════════════════════════════════════════════
function Shell(props: {
  ctx: Ctx;
  eyebrow: string;
  children: React.ReactNode;
  qr?: string | null;
  accent?: boolean;
}): React.ReactElement {
  const { ctx, eyebrow, children, qr, accent = true } = props;
  const { size, p } = ctx;
  const pad = size.landscape ? 56 : 72;
  return (
    <div
      style={{
        width: size.w,
        height: size.h,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: p.base,
        backgroundImage: p.bgGrad,
        fontFamily: SANS,
        color: p.ink,
        padding: pad,
        overflow: "hidden",
      }}
    >
      {/* 红顶边点睛 */}
      <div style={{ position: "absolute", top: 0, left: 0, width: size.w, height: 6, display: "flex", backgroundColor: accent ? p.red : p.border }} />
      {/* 右上角品牌红斜带：给大面积留白一个方向感（satori 对 radial-gradient 渲染有暗芯 bug，改用线性斜带）*/}
      <div
        style={{
          position: "absolute",
          right: -size.w * 0.12,
          top: -size.h * 0.06,
          width: size.w * 0.5,
          height: size.h * 0.42,
          display: "flex",
          transform: "rotate(24deg)",
          backgroundImage: `linear-gradient(180deg, ${p.glowRed}, ${p.glowRedEdge})`,
        }}
      />
      {/* 潮汐波形：底部真实图形 */}
      <img
        src={waveDataUri(size.w, p)}
        width={size.w}
        height={240}
        style={{ position: "absolute", left: 0, bottom: 0, width: size.w, height: 240 }}
      />

      {/* 顶部品牌带：eyebrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, zIndex: 1 }}>
        <div style={{ display: "flex", width: 26, height: 26, borderRadius: 8, backgroundColor: p.red, alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff" }}>有</div>
        <div style={{ display: "flex", fontSize: 21, letterSpacing: 4, fontWeight: 700, color: p.ink2, fontFamily: MONO }}>{eyebrow}</div>
      </div>

      {/* 主体 */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, zIndex: 1, marginTop: size.landscape ? 18 : 38 }}>{children}</div>

      {/* 底部品牌 + 二维码 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", zIndex: 1, paddingTop: 20, borderTop: `1px solid ${p.border}` }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: p.ink }}>有道自习室</div>
            <div style={{ display: "flex", fontSize: 18, color: p.ink3, fontFamily: MONO, letterSpacing: 1 }}>STUDIO</div>
          </div>
          <div style={{ display: "flex", fontSize: 19, color: p.ink3 }}>潮起潮落，学过就算数</div>
        </div>
        {qr && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", padding: 8, borderRadius: 12, backgroundColor: "#ffffff" }}>
              <img src={qr} width={76} height={76} style={{ width: 76, height: 76 }} />
            </div>
            <div style={{ display: "flex", fontSize: 14, color: p.ink3, fontFamily: MONO }}>扫码看看</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 统计块：大 mono 数字 + 标签。 */
function Stat(props: { p: Palette; value: string; label: string; accent?: boolean; big?: boolean }): React.ReactElement {
  const { p, value, label, accent, big } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", fontSize: big ? 108 : 58, fontWeight: 800, lineHeight: 1, fontFamily: MONO, color: accent ? p.redInk : p.ink }}>{value}</div>
      <div style={{ display: "flex", fontSize: 21, color: p.ink2, letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

/** 2×2 数据网格（satori 无 grid，用 flex 两行两列）。 */
function StatGrid(props: { p: Palette; items: { value: string; label: string; accent?: boolean }[] }): React.ReactElement {
  const { p, items } = props;
  const rows = [items.slice(0, 2), items.slice(2, 4)];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%" }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: "flex", gap: 16 }}>
          {row.map((it, ci) => (
            <div
              key={ci}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                flex: 1,
                padding: "18px 22px",
                borderRadius: 16,
                backgroundColor: p.base2,
                border: `1px solid ${p.border}`,
              }}
            >
              <div style={{ display: "flex", fontSize: 46, fontWeight: 800, fontFamily: MONO, lineHeight: 1, color: it.accent ? p.redInk : p.ink }}>{it.value}</div>
              <div style={{ display: "flex", fontSize: 19, color: p.ink2 }}>{it.label}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  1) 学生证卡
// ═══════════════════════════════════════════════════════════
async function renderStudentCard(ctx: Ctx): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(ctx, "登录后生成你的学生证");
  const { p, origin } = ctx;

  const [progressAgg, gamification, profile, completedCount, notesCount] = await Promise.all([
    prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
    getGamificationSummary(user.id),
    prisma.userProfile.findUnique({ where: { userId: user.id }, select: { motto: true } }),
    prisma.learningProgress.count({ where: { userId: user.id, completedAt: { not: null } } }),
    prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
  ]);

  const totalSeconds = progressAgg._sum.progressSec ?? 0;
  const lv = deriveLevel(totalSeconds);
  const year = user.createdAt.getFullYear();
  const no = studentNo(user.id, year);
  const motto = profile?.motto || "日拱一卒，功不唐捐";
  const initial = (user.nickname || "学").slice(0, 1);
  const qr = await qrDataUri(`${origin}/u/${user.id}`);

  return (
    <Shell ctx={ctx} eyebrow="STUDENT ID · 学员证" qr={qr}>
      {/* 头像（渐变圆）+ 昵称 + 学号 + 等级 */}
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div
          style={{
            display: "flex",
            width: 128,
            height: 128,
            borderRadius: 32,
            backgroundImage: `linear-gradient(140deg, ${p.red}, #ff6a5c)`,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 60,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          {initial}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 800, color: p.ink }}>{user.nickname}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", fontSize: 22, color: p.ink2, fontFamily: MONO, letterSpacing: 1 }}>{no}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 999, backgroundColor: p.base2, border: `1px solid ${p.border}` }}>
              <div style={{ display: "flex", fontSize: 20, fontWeight: 800, color: p.redInk, fontFamily: MONO }}>Lv.{lv.level}</div>
              <div style={{ display: "flex", fontSize: 20, fontWeight: 700, color: p.ink }}>{lv.title}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2×2 数据格 */}
      <div style={{ display: "flex", marginTop: 44 }}>
        <StatGrid
          p={p}
          items={[
            { value: String(gamification.currentStreak), label: "连续学习 · 天", accent: true },
            { value: String(lv.hours), label: "累计时长 · 小时" },
            { value: String(completedCount), label: "完成课程 · 门" },
            { value: String(notesCount), label: "笔记 · 条" },
          ]}
        />
      </div>

      {/* 格言 */}
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", paddingBottom: 8 }}>
        <div style={{ display: "flex", fontSize: 18, color: p.ink3, letterSpacing: 2, marginBottom: 8 }}>MOTTO</div>
        <div style={{ display: "flex", fontSize: 32, color: p.ink, fontWeight: 600, lineHeight: 1.4 }}>「{motto}」</div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  2) 学习周报（峰值柱图 + 活跃点）
// ═══════════════════════════════════════════════════════════
async function renderWeekReport(ctx: Ctx): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(ctx, "登录后生成你的学习周报");
  const { p, origin } = ctx;

  const [gamification, completedCount, notesCount] = await Promise.all([
    getGamificationSummary(user.id),
    prisma.learningProgress.count({ where: { userId: user.id, completedAt: { not: null } } }),
    prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
  ]);

  const todayKey = shanghaiDayKey();
  const calByDay = new Map(gamification.calendar.map((d) => [d.day, d]));
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const todayLocalDow = (new Date(ty, tm - 1, td).getDay() + 6) % 7;
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(ty, tm - 1, td - (todayLocalDow - i));
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    return calByDay.get(key)?.minutes ?? 0;
  });
  const weekMinutes = weekDays.reduce((a, b) => a + b, 0);
  const activeDays = weekDays.filter((m) => m > 0).length;
  const maxDay = Math.max(1, ...weekDays);
  const dowLabels = ["一", "二", "三", "四", "五", "六", "日"];
  const qr = await qrDataUri(`${origin}/u/${user.id}`);

  return (
    <Shell ctx={ctx} eyebrow="WEEKLY REPORT · 本周周报" qr={qr}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 4 }}>
        <div style={{ display: "flex", fontSize: 116, fontWeight: 800, lineHeight: 1, fontFamily: MONO, color: p.redInk }}>{weekMinutes}</div>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: p.ink2 }}>分钟 · 本周学习</div>
      </div>

      {/* 柱图：峰值染红 + 峰值标签 */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 240, marginTop: 44 }}>
        {weekDays.map((m, i) => {
          const isPeak = m >= maxDay && m > 0;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, flex: 1 }}>
              <div style={{ display: "flex", height: 26, alignItems: "center" }}>
                {isPeak && <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: p.redInk, fontFamily: MONO }}>{m}</div>}
              </div>
              <div style={{ display: "flex", flex: 1, alignItems: "flex-end", width: 52 }}>
                <div
                  style={{
                    display: "flex",
                    width: 52,
                    height: Math.max(6, Math.round((m / maxDay) * 180)),
                    borderRadius: 10,
                    backgroundImage: isPeak ? `linear-gradient(180deg, ${p.red}, #ff6a5c)` : "none",
                    backgroundColor: isPeak ? p.red : p.base3,
                  }}
                />
              </div>
              <div style={{ display: "flex", fontSize: 20, color: p.ink3, fontFamily: MONO }}>{dowLabels[i]}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 60, marginTop: "auto", paddingBottom: 6 }}>
        <Stat p={p} value={`${activeDays}/7`} label="活跃天数" accent />
        <Stat p={p} value={String(notesCount)} label="笔记 · 条" />
        <Stat p={p} value={String(completedCount)} label="完课 · 节" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  3) 完课证书（双圈印章）
// ═══════════════════════════════════════════════════════════
async function renderCourseDone(ctx: Ctx, sp: URLSearchParams): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(ctx, "登录后生成完课证书");
  const { p, origin } = ctx;
  const courseId = sp.get("courseId");
  if (!courseId) return brandFallback(ctx, "缺少课程信息");

  const [course, agg, lastDone] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { title: true, slug: true } }),
    prisma.learningProgress.aggregate({ where: { userId: user.id, courseId }, _sum: { progressSec: true } }),
    prisma.learningProgress.findFirst({
      where: { userId: user.id, courseId, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
  ]);
  if (!course) return brandFallback(ctx, "课程不存在");

  const usedSec = agg._sum.progressSec ?? 0;
  const doneDate = lastDone?.completedAt ?? new Date();
  const no = certNo(user.id, courseId);
  const qr = await qrDataUri(`${origin}/market/${course.slug}`);

  return (
    <Shell ctx={ctx} eyebrow="CERTIFICATE · 完课证书" qr={qr}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", fontSize: 24, color: p.ink2, letterSpacing: 2 }}>兹证明 {user.nickname} 已完成</div>
        <div style={{ display: "flex", fontSize: 58, fontWeight: 800, color: p.ink, lineHeight: 1.25 }}>{course.title}</div>
      </div>

      {/* 完课印章：双圈 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 48 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 210,
            height: 210,
            borderRadius: 210,
            border: `4px solid ${p.red}`,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 176,
              height: 176,
              borderRadius: 176,
              border: `2px solid ${p.red}`,
              color: p.redInk,
            }}
          >
            <div style={{ display: "flex", fontSize: 46, fontWeight: 800 }}>已完课</div>
            <div style={{ display: "flex", fontSize: 20, fontFamily: MONO, marginTop: 6, color: p.ink2 }}>{fmtDate(doneDate)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 64, marginTop: "auto", paddingBottom: 4 }}>
        <Stat p={p} value={formatDurationSec(usedSec)} label="累计用时" accent />
        <Stat p={p} value={no} label="证书编号" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  4) 笔记摘录（巨型引号 + 纸质卡）
// ═══════════════════════════════════════════════════════════
async function renderNoteQuote(ctx: Ctx, sp: URLSearchParams): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(ctx, "登录后分享你的笔记");
  const { p, size, origin } = ctx;
  const noteId = sp.get("noteId");
  if (!noteId) return brandFallback(ctx, "缺少笔记信息");

  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: user.id, deletedAt: null },
    select: { title: true, contentMd: true, excerpt: true, course: { select: { title: true } }, lesson: { select: { title: true } } },
  });
  if (!note) return brandFallback(ctx, "笔记不存在或无权访问");

  const raw = (note.excerpt || note.contentMd || "").trim();
  const plain = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const maxLen = size.landscape ? 140 : 260;
  const body = plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain || "（空笔记）";
  // 摘文自适应字号
  const fs = body.length <= 40 ? (size.landscape ? 48 : 60) : body.length <= 100 ? (size.landscape ? 38 : 46) : (size.landscape ? 30 : 36);
  const source = note.course?.title || note.lesson?.title || note.title || "独立笔记";
  const qr = await qrDataUri(`${origin}/u/${user.id}`);

  return (
    <Shell ctx={ctx} eyebrow="NOTE · 笔记摘录" qr={qr}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", position: "relative" }}>
        {/* 巨型装饰引号（压在文字后） */}
        <div style={{ position: "absolute", top: size.landscape ? -40 : -70, left: -10, display: "flex", fontSize: 300, lineHeight: 1, color: p.red, opacity: 0.14, fontWeight: 800 }}>&ldquo;</div>
        {/* 纸质卡 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: 22,
            padding: size.landscape ? 40 : 48,
            backgroundColor: p.isDark ? "#f7f5f0" : "#ffffff",
            borderLeft: `6px solid ${p.red}`,
            border: `1px solid ${p.isDark ? "#e6e1d6" : p.border}`,
          }}
        >
          <div style={{ display: "flex", fontSize: fs, lineHeight: 1.55, color: "#1a1d24", fontWeight: 500 }}>{body}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 32 }}>
            <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, backgroundColor: p.red }} />
            <div style={{ display: "flex", fontSize: 22, color: "#5a6472" }}>摘自 · {source}</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  5) 连续里程碑（大数字 + 14 格潮汐日历）
// ═══════════════════════════════════════════════════════════
async function renderStreak(ctx: Ctx): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(ctx, "登录后见证你的坚持");
  const { p, size, origin } = ctx;

  const g = await getGamificationSummary(user.id);
  const streak = g.currentStreak;
  const longest = g.longestStreak;

  // 最近 14 天学习与否（潮汐日历），末格=今天
  const todayKey = shanghaiDayKey();
  const calByDay = new Map(g.calendar.map((d) => [d.day, d]));
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(ty, tm - 1, td - (13 - i));
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    return (calByDay.get(key)?.minutes ?? 0) > 0;
  });

  const cheer =
    streak >= 100 ? "百日成潮，你已把学习刻进了日子里。"
      : streak >= 30 ? "月满一轮，坚持正在成为本能。"
      : streak >= 7 ? "一周不辍，浪潮已经起势。"
      : streak >= 1 ? "每一天都是一次涨潮。"
      : "从今天起，让学习像潮汐一样准时。";
  const qr = await qrDataUri(`${origin}/u/${user.id}`);

  return (
    <Shell ctx={ctx} eyebrow="STREAK · 连续学习里程碑" qr={qr}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <div style={{ display: "flex", fontSize: size.landscape ? 200 : 280, fontWeight: 800, lineHeight: 0.9, fontFamily: MONO, color: p.redInk }}>{streak}</div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: p.ink }}>天</div>
        </div>

        {/* 14 格潮汐日历 */}
        <div style={{ display: "flex", gap: 10, marginTop: 40 }}>
          {last14.map((on, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: size.landscape ? 42 : 56,
                height: size.landscape ? 42 : 56,
                borderRadius: 12,
                backgroundColor: on ? p.red : "transparent",
                border: on ? `1px solid ${p.red}` : `1px solid ${p.border}`,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", fontSize: 32, color: p.ink, fontWeight: 600, marginTop: 40, lineHeight: 1.5 }}>{cheer}</div>
      </div>
      <div style={{ display: "flex", marginTop: "auto", paddingBottom: 4 }}>
        <Stat p={p} value={String(longest)} label="历史最长连续 · 天" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  6) 模拟考成绩（评级字母 + 正确率）
// ═══════════════════════════════════════════════════════════
async function renderExamResult(ctx: Ctx, sp: URLSearchParams): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(ctx, "登录后分享考试成绩");
  const { p, origin } = ctx;
  const examId = sp.get("examId");

  const attempt = examId
    ? await prisma.examAttempt.findFirst({
        where: { userId: user.id, examId },
        orderBy: { finishedAt: "desc" },
        select: { score: true, total: true, finishedAt: true, exam: { select: { title: true } } },
      })
    : await prisma.examAttempt.findFirst({
        where: { userId: user.id },
        orderBy: { finishedAt: "desc" },
        select: { score: true, total: true, finishedAt: true, exam: { select: { title: true } } },
      });
  if (!attempt) return brandFallback(ctx, "还没有考试记录");

  const { score, total, finishedAt } = attempt;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const title = attempt.exam?.title || "模拟考";
  const grade = pct >= 95 ? "S" : pct >= 85 ? "A" : pct >= 70 ? "B" : pct >= 60 ? "C" : "D";
  const gradeWord = pct >= 95 ? "满分级发挥" : pct >= 85 ? "优秀" : pct >= 70 ? "良好" : pct >= 60 ? "及格" : "再练一练";
  const tone = pct >= 85 ? p.ok : pct >= 60 ? p.redInk : p.ink2;
  const qr = await qrDataUri(`${origin}/u/${user.id}`);

  return (
    <Shell ctx={ctx} eyebrow="EXAM RESULT · 模拟考成绩单" qr={qr}>
      <div style={{ display: "flex", fontSize: 42, fontWeight: 800, color: p.ink, lineHeight: 1.3 }}>{title}</div>

      {/* 评级字母 + 正确率环意象 */}
      <div style={{ display: "flex", alignItems: "center", gap: 44, marginTop: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 200,
            height: 200,
            borderRadius: 200,
            border: `6px solid ${tone}`,
            color: tone,
            fontSize: 120,
            fontWeight: 800,
            fontFamily: MONO,
          }}
        >
          {grade}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ display: "flex", fontSize: 140, fontWeight: 800, lineHeight: 0.9, fontFamily: MONO, color: tone }}>{pct}</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: p.ink2 }}>%</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: p.ink }}>{gradeWord}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 64, marginTop: "auto", paddingBottom: 4 }}>
        <Stat p={p} value={`${score}/${total}`} label="答对 / 总题" accent />
        <Stat p={p} value={fmtDate(finishedAt)} label="考试日期" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  通用品牌兜底卡（永不 500）
// ═══════════════════════════════════════════════════════════
function brandFallback(ctx: Ctx, message: string): React.ReactElement {
  const { p } = ctx;
  return (
    <Shell ctx={ctx} eyebrow="STUDIO · 有道自习室">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", alignItems: "flex-start" }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: p.ink, lineHeight: 1.2 }}>像潮汐一样学习</div>
        <div style={{ display: "flex", fontSize: 30, color: p.ink2, marginTop: 28, lineHeight: 1.5 }}>{message}</div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  路由入口
// ═══════════════════════════════════════════════════════════
export async function GET(req: NextRequest, ctxParam: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctxParam.params;
  const sp = req.nextUrl.searchParams;
  const size = resolveSize(sp);
  const theme: Theme = sp.get("theme") === "light" ? "light" : "dark";
  const ctx: Ctx = { size, p: palette(theme), origin: req.nextUrl.origin };

  let element: React.ReactElement;
  try {
    if (!KINDS.includes(kind as Kind)) {
      element = brandFallback(ctx, "未知的分享类型");
    } else {
      switch (kind as Kind) {
        case "student-card": element = await renderStudentCard(ctx); break;
        case "week-report": element = await renderWeekReport(ctx); break;
        case "course-done": element = await renderCourseDone(ctx, sp); break;
        case "note-quote": element = await renderNoteQuote(ctx, sp); break;
        case "streak": element = await renderStreak(ctx); break;
        case "exam-result": element = await renderExamResult(ctx, sp); break;
        default: element = brandFallback(ctx, "未知的分享类型");
      }
    }
  } catch (e) {
    console.error("[share-card]", kind, e instanceof Error ? e.message : e);
    element = brandFallback(ctx, "分享图暂时生成失败，稍后再试");
  }

  return new ImageResponse(element, {
    width: size.w,
    height: size.h,
    // 安全铁律：本路由所有 kind 都按登录用户私有数据渲染，URL 不含用户标识，故一律
    // private + no-store，禁掉共享缓存，防跨用户 PII 泄露。纯公开 OG 图另见 opengraph-image.tsx。
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
