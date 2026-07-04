import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getGamificationSummary } from "@/lib/gamification";
import { deriveLevel } from "@/lib/level";
import { formatDurationSec } from "@/lib/format";
import { shanghaiDayKey } from "@/lib/week";

/**
 * v3.0 全局分享体系 —— 统一分享图服务（next/og · ImageResponse / satori）。
 *
 * GET /api/share-card/[kind]?w=og&courseId=...&noteId=...&examId=...
 *   kind: student-card | week-report | course-done | note-quote | streak | exam-result
 *   w=og  → 1200x630 横版（默认竖版 1080x1440，朋友圈/小红书）
 *
 * 铁律：
 * - 越权铁律：note-quote / course-done / exam-result 只查「当前登录用户自己」的数据（where userId）。
 * - satori 限制：不支持 CSS 变量、不支持 grid、不支持外部 CSS，全部内联样式 + flex 布局；
 *   多子节点容器必须显式 display:flex（satori 对隐式 block 兄弟节点会报错）。
 * - 分享图配色用具体色值（下方常量），不用 --token。
 * - 错误兜底：数据缺失 / 未登录 / 异常一律回一张通用品牌卡，永不 500、永不泄漏堆栈。
 */
export const runtime = "nodejs"; // nodejs 而非 edge：需要 Prisma 直查
export const dynamic = "force-dynamic";

// ── STUDIO 分享图色值（具体值，非 CSS 变量）─────────────────
const C = {
  base: "#0e1116", // 最深基座
  base2: "#161b22", // 卡面
  base3: "#232935", // 抬起面 / 分隔
  ink: "#edeff3", // 主墨字
  ink2: "#8790a0", // 次要文字
  ink3: "#5a6472", // 三级 / 弱说明
  red: "#fc011a", // 有道红点睛（~7% 用量）
  redInk: "#ff5a4d", // 红色文字（更亮，暗底可读）
  ok: "#37c491", // 成功绿
  border: "#2a313d", // 描边
  wave: "#1c2733", // 潮汐水纹底色
} as const;

// mono 数字字体栈（satori 用系统默认，字符串仅作声明性回退）
const MONO = "ui-monospace, 'SF Mono', 'Roboto Mono', monospace";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

type Kind =
  | "student-card"
  | "week-report"
  | "course-done"
  | "note-quote"
  | "streak"
  | "exam-result";

const KINDS: Kind[] = [
  "student-card",
  "week-report",
  "course-done",
  "note-quote",
  "streak",
  "exam-result",
];

// ── 尺寸方案 ────────────────────────────────────────────────
type Size = { w: number; h: number; landscape: boolean };
function resolveSize(sp: URLSearchParams): Size {
  return sp.get("w") === "og"
    ? { w: 1200, h: 630, landscape: true }
    : { w: 1080, h: 1440, landscape: false };
}

// ── 学号：与站内 me/page.tsx 保持完全一致 ───────────────────
function studentNo(id: string, year: number): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return `YD·${year}·${String(h % 10000).padStart(4, "0")}`;
}

// ── 证书编号：稳定派生（course-done 用）────────────────────
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

// ═══════════════════════════════════════════════════════════
//  视觉基元（返回 satori 可渲染的 React 元素）
// ═══════════════════════════════════════════════════════════

/** 外壳：深色基座 + 潮汐水纹 + 红顶边点睛 + 底部品牌。所有卡片共用。 */
function Shell(props: {
  size: Size;
  eyebrow: string; // 顶部小标题（大写英文标签）
  children: React.ReactNode;
  accent?: boolean; // 顶边是否红色点睛（默认 true）
}) {
  const { size, eyebrow, children, accent = true } = props;
  const pad = size.landscape ? 56 : 72;
  return (
    <div
      style={{
        width: size.w,
        height: size.h,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: C.base,
        // 冷灰蓝渐变基座
        backgroundImage: `linear-gradient(155deg, ${C.base3} 0%, ${C.base2} 42%, ${C.base} 100%)`,
        fontFamily: SANS,
        color: C.ink,
        padding: pad,
        overflow: "hidden",
      }}
    >
      {/* 红色顶边点睛 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: size.w,
          height: 6,
          display: "flex",
          backgroundColor: accent ? C.red : C.border,
        }}
      />
      {/* 潮汐水纹意象：右下低透明度弧带 */}
      <div
        style={{
          position: "absolute",
          right: -size.w * 0.28,
          bottom: -size.h * 0.22,
          width: size.w * 0.9,
          height: size.w * 0.9,
          display: "flex",
          borderRadius: size.w,
          border: `2px solid ${C.wave}`,
          opacity: 0.6,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -size.w * 0.2,
          bottom: -size.h * 0.14,
          width: size.w * 0.7,
          height: size.w * 0.7,
          display: "flex",
          borderRadius: size.w,
          border: `2px solid ${C.wave}`,
          opacity: 0.45,
        }}
      />
      {/* 顶部 eyebrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, zIndex: 1 }}>
        <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, backgroundColor: C.red }} />
        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: 4,
            fontWeight: 700,
            color: C.ink2,
            fontFamily: MONO,
          }}
        >
          {eyebrow}
        </div>
      </div>
      {/* 主体 */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, zIndex: 1, marginTop: size.landscape ? 20 : 40 }}>
        {children}
      </div>
      {/* 底部品牌 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 1,
          paddingTop: 20,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: C.ink }}>有道自习室</div>
          <div style={{ display: "flex", fontSize: 20, color: C.ink3, fontFamily: MONO, letterSpacing: 1 }}>
            STUDIO · 网易有道
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 20, color: C.ink3, fontFamily: MONO }}>youdao.studio</div>
      </div>
    </div>
  );
}

/** 大号 mono 数字 + 说明标签的统计块。 */
function Stat(props: { value: string; label: string; accent?: boolean; big?: boolean }) {
  const { value, label, accent, big } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          fontSize: big ? 108 : 60,
          fontWeight: 800,
          lineHeight: 1,
          fontFamily: MONO,
          color: accent ? C.redInk : C.ink,
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", fontSize: 22, color: C.ink2, letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  1) 学生证卡  student-card（需登录）
// ═══════════════════════════════════════════════════════════
async function renderStudentCard(size: Size): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(size, "登录后生成你的学生证");

  const [progressAgg, gamification, profile] = await Promise.all([
    prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
    getGamificationSummary(user.id),
    prisma.userProfile.findUnique({ where: { userId: user.id }, select: { motto: true } }),
  ]);

  const totalSeconds = progressAgg._sum.progressSec ?? 0;
  const lv = deriveLevel(totalSeconds);
  const year = user.createdAt.getFullYear();
  const no = studentNo(user.id, year);
  const streak = gamification.currentStreak;
  const motto = profile?.motto || "日拱一卒，功不唐捐";
  const initial = (user.nickname || "学").slice(0, 1);

  return (
    <Shell size={size} eyebrow="STUDENT ID · 有道自习室学员证">
      {/* 头像占位 + 昵称 + 学号 */}
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div
          style={{
            display: "flex",
            width: 120,
            height: 120,
            borderRadius: 28,
            backgroundColor: C.base3,
            border: `2px solid ${C.border}`,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
            fontWeight: 800,
            color: C.ink,
          }}
        >
          {initial}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: C.ink }}>{user.nickname}</div>
          <div style={{ display: "flex", fontSize: 24, color: C.ink2, fontFamily: MONO, letterSpacing: 1 }}>{no}</div>
        </div>
      </div>

      {/* 等级徽条 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginTop: 48,
          padding: "16px 24px",
          borderRadius: 16,
          backgroundColor: C.base2,
          border: `1px solid ${C.border}`,
          alignSelf: "flex-start",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: C.redInk, fontFamily: MONO }}>
          Lv.{lv.level}
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: C.ink }}>{lv.title}</div>
      </div>

      {/* 数据行 */}
      <div style={{ display: "flex", gap: 72, marginTop: 56 }}>
        <Stat value={String(streak)} label="连续学习 · 天" accent />
        <Stat value={`${lv.hours}`} label="累计时长 · 小时" />
      </div>

      {/* 格言 */}
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <div style={{ display: "flex", fontSize: 20, color: C.ink3, letterSpacing: 2, marginBottom: 10 }}>MOTTO</div>
        <div style={{ display: "flex", fontSize: 34, color: C.ink, fontWeight: 600, lineHeight: 1.4 }}>「{motto}」</div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  2) 学习周报  week-report（需登录）
// ═══════════════════════════════════════════════════════════
async function renderWeekReport(size: Size): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(size, "登录后生成你的学习周报");

  const [gamification, completedCount, notesCount] = await Promise.all([
    getGamificationSummary(user.id),
    prisma.learningProgress.count({ where: { userId: user.id, completedAt: { not: null } } }),
    prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
  ]);

  // 近 7 天（周一→周日）从潮汐日历推导
  const todayKey = shanghaiDayKey();
  const calByDay = new Map(gamification.calendar.map((d) => [d.day, d]));
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const todayLocalDow = (new Date(ty, tm - 1, td).getDay() + 6) % 7; // 周一=0
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(ty, tm - 1, td - (todayLocalDow - i));
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    return calByDay.get(key)?.minutes ?? 0;
  });
  const weekMinutes = weekDays.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(1, ...weekDays);
  const dowLabels = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <Shell size={size} eyebrow="WEEKLY REPORT · 本周学习周报">
      <div style={{ display: "flex", gap: 64, marginTop: 8 }}>
        <Stat value={String(weekMinutes)} label="本周学习 · 分钟" accent big />
      </div>

      {/* 柱状条（div 手画）*/}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20, height: 260, marginTop: 56 }}>
        {weekDays.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, flex: 1 }}>
            <div style={{ display: "flex", flex: 1, alignItems: "flex-end", width: 56 }}>
              <div
                style={{
                  display: "flex",
                  width: 56,
                  height: Math.max(6, Math.round((m / maxDay) * 200)),
                  borderRadius: 8,
                  backgroundColor: m >= maxDay && m > 0 ? C.red : C.base3,
                }}
              />
            </div>
            <div style={{ display: "flex", fontSize: 22, color: C.ink3, fontFamily: MONO }}>{dowLabels[i]}</div>
          </div>
        ))}
      </div>

      {/* 三项统计 */}
      <div style={{ display: "flex", gap: 72, marginTop: "auto" }}>
        <Stat value={String(notesCount)} label="笔记 · 条" />
        <Stat value={String(completedCount)} label="完课 · 节" />
        <Stat value={String(gamification.longestStreak)} label="最高连击 · 天" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  3) 完课证书卡  course-done（需登录 · courseId · 越权铁律）
// ═══════════════════════════════════════════════════════════
async function renderCourseDone(size: Size, sp: URLSearchParams): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(size, "登录后生成完课证书");
  const courseId = sp.get("courseId");
  if (!courseId) return brandFallback(size, "缺少课程信息");

  // 越权铁律：只聚合当前用户在该课的进度
  const [course, agg, lastDone] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }),
    prisma.learningProgress.aggregate({
      where: { userId: user.id, courseId },
      _sum: { progressSec: true },
    }),
    prisma.learningProgress.findFirst({
      where: { userId: user.id, courseId, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
  ]);
  if (!course) return brandFallback(size, "课程不存在");

  const usedSec = agg._sum.progressSec ?? 0;
  const doneDate = lastDone?.completedAt ?? new Date();
  const no = certNo(user.id, courseId);

  return (
    <Shell size={size} eyebrow="CERTIFICATE · 完课证书">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", fontSize: 24, color: C.ink2, letterSpacing: 2 }}>兹证明 {user.nickname} 已完成</div>
        <div style={{ display: "flex", fontSize: 60, fontWeight: 800, color: C.ink, lineHeight: 1.25 }}>{course.title}</div>
      </div>

      {/* 完成印章意象 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 168,
          height: 168,
          borderRadius: 168,
          border: `4px solid ${C.red}`,
          color: C.redInk,
          fontSize: 40,
          fontWeight: 800,
          marginTop: 56,
        }}
      >
        已完课
      </div>

      <div style={{ display: "flex", gap: 72, marginTop: "auto" }}>
        <Stat value={formatDurationSec(usedSec)} label="累计用时" accent />
        <Stat value={fmtDate(doneDate)} label="完成日期" />
      </div>
      <div style={{ display: "flex", marginTop: 28, fontSize: 22, color: C.ink3, fontFamily: MONO, letterSpacing: 1 }}>
        证书编号 {no}
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  4) 笔记摘录卡  note-quote（需登录 · noteId · 越权铁律）
// ═══════════════════════════════════════════════════════════
async function renderNoteQuote(size: Size, sp: URLSearchParams): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(size, "登录后分享你的笔记");
  const noteId = sp.get("noteId");
  if (!noteId) return brandFallback(size, "缺少笔记信息");

  // 越权铁律：where 同时约束 id + userId，只能取自己的笔记
  const note = await prisma.note.findFirst({
    where: { id: noteId, userId: user.id, deletedAt: null },
    select: {
      title: true,
      contentMd: true,
      excerpt: true,
      course: { select: { title: true } },
      lesson: { select: { title: true } },
    },
  });
  if (!note) return brandFallback(size, "笔记不存在或无权访问");

  // 纯文本正文（去 markdown 标记，限长，避免溢出）
  const raw = (note.excerpt || note.contentMd || "").trim();
  const plain = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const maxLen = size.landscape ? 140 : 260;
  const body = plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain || "（空笔记）";
  const source = note.course?.title || note.lesson?.title || note.title || "独立笔记";

  return (
    <Shell size={size} eyebrow="NOTE · 笔记摘录">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {/* 大引号点睛 */}
        <div style={{ display: "flex", fontSize: 120, lineHeight: 0.6, color: C.red, fontWeight: 800, height: 72 }}>
          &ldquo;
        </div>
        <div
          style={{
            display: "flex",
            fontSize: size.landscape ? 34 : 42,
            lineHeight: 1.6,
            color: C.ink,
            fontWeight: 500,
            marginTop: 8,
          }}
        >
          {body}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 40 }}>
        <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, backgroundColor: C.red }} />
        <div style={{ display: "flex", fontSize: 24, color: C.ink2 }}>摘自 · {source}</div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  5) 连续里程碑卡  streak（需登录）
// ═══════════════════════════════════════════════════════════
async function renderStreak(size: Size): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(size, "登录后见证你的坚持");

  const g = await getGamificationSummary(user.id);
  const streak = g.currentStreak;
  const longest = g.longestStreak;
  const cheer =
    streak >= 100
      ? "百日成潮，你已把学习刻进了日子里。"
      : streak >= 30
      ? "月满一轮，坚持正在成为本能。"
      : streak >= 7
      ? "一周不辍，浪潮已经起势。"
      : streak >= 1
      ? "每一天都是一次涨潮。"
      : "从今天起，让学习像潮汐一样准时。";

  return (
    <Shell size={size} eyebrow="STREAK · 连续学习里程碑">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: size.landscape ? 220 : 300,
              fontWeight: 800,
              lineHeight: 0.9,
              fontFamily: MONO,
              color: C.redInk,
            }}
          >
            {streak}
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: C.ink }}>天</div>
        </div>
        <div style={{ display: "flex", fontSize: 34, color: C.ink, fontWeight: 600, marginTop: 36, lineHeight: 1.5 }}>
          {cheer}
        </div>
      </div>
      <div style={{ display: "flex", marginTop: "auto" }}>
        <Stat value={String(longest)} label="历史最长连续 · 天" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  6) 模拟考成绩单卡  exam-result（需登录 · examId 或最近 · 越权铁律）
// ═══════════════════════════════════════════════════════════
async function renderExamResult(size: Size, sp: URLSearchParams): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) return brandFallback(size, "登录后分享考试成绩");
  const examId = sp.get("examId");

  // 越权铁律：attempt.userId 必须等于当前用户
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
  if (!attempt) return brandFallback(size, "还没有考试记录");

  const { score, total, finishedAt } = attempt;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const title = attempt.exam?.title || "模拟考";
  const tone = pct >= 80 ? C.ok : pct >= 60 ? C.redInk : C.ink2;

  return (
    <Shell size={size} eyebrow="EXAM RESULT · 模拟考成绩单">
      <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: C.ink, lineHeight: 1.3 }}>{title}</div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginTop: 56 }}>
        <div style={{ display: "flex", fontSize: 200, fontWeight: 800, lineHeight: 0.9, fontFamily: MONO, color: tone }}>
          {pct}
        </div>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: C.ink2 }}>% 正确率</div>
      </div>

      <div style={{ display: "flex", gap: 72, marginTop: "auto" }}>
        <Stat value={`${score}/${total}`} label="答对 / 总题" accent />
        <Stat value={String(total)} label="题数" />
        <Stat value={fmtDate(finishedAt)} label="考试日期" />
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  通用品牌兜底卡（永不 500）
// ═══════════════════════════════════════════════════════════
function brandFallback(size: Size, message: string): React.ReactElement {
  return (
    <Shell size={size} eyebrow="STUDIO · 有道自习室" accent>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", alignItems: "flex-start" }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: C.ink, lineHeight: 1.2 }}>
          像潮汐一样学习
        </div>
        <div style={{ display: "flex", fontSize: 32, color: C.ink2, marginTop: 28, lineHeight: 1.5 }}>{message}</div>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════════════════
//  路由入口
// ═══════════════════════════════════════════════════════════
export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const size = resolveSize(sp);

  let element: React.ReactElement;
  try {
    if (!KINDS.includes(kind as Kind)) {
      element = brandFallback(size, "未知的分享类型");
    } else {
      switch (kind as Kind) {
        case "student-card":
          element = await renderStudentCard(size);
          break;
        case "week-report":
          element = await renderWeekReport(size);
          break;
        case "course-done":
          element = await renderCourseDone(size, sp);
          break;
        case "note-quote":
          element = await renderNoteQuote(size, sp);
          break;
        case "streak":
          element = await renderStreak(size);
          break;
        case "exam-result":
          element = await renderExamResult(size, sp);
          break;
        default:
          element = brandFallback(size, "未知的分享类型");
      }
    }
  } catch (e) {
    // 任何异常（Prisma / satori / 数据缺失）都回兜底品牌卡，绝不 500
    console.error("[share-card]", kind, e instanceof Error ? e.message : e);
    element = brandFallback(size, "分享图暂时生成失败，稍后再试");
  }

  return new ImageResponse(element, {
    width: size.w,
    height: size.h,
    // 安全铁律：本路由所有 kind 都按登录用户私有数据渲染（学生证 / 周报 / streak /
    // 完课证书 / 笔记摘录 / 模拟考成绩），但 URL 不含任何用户标识，共享缓存/CDN 仅按
    // URL 做 key。若用 public + s-maxage，会把用户 A 的私有卡在缓存窗口内原样发给用户 B，
    // 造成跨用户 PII 泄露。故一律 private + no-store，彻底禁掉共享缓存；auth 走 httpOnly
    // cookie，CDN 默认不按该 cookie 分桶，不能依赖 Vary。纯公开卡（课程 OG 图）另见
    // opengraph-image.tsx，那里才允许 public 共享缓存。
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
