// 书桌·书架数据层（server lib，纯函数 + prisma）。无 "use client"，不引 next/headers/session。
// 越权铁律：所有查询 where userId，只返回该用户自己的书架。
import { prisma } from "./db";
import { CATEGORY_LABELS } from "./queries";
import { resolveCoverSrc } from "./tracks";

/** 书架分类 key（五层）。 */
export type ShelfCategory = "ai_created" | "imported" | "learning" | "collected" | "completed";

/** 书架里单门课的展示形状。 */
export interface ShelfCourse {
  id: string;
  slug: string;
  title: string;
  category: string; // 赛道 key
  categoryLabel: string; // 赛道中文标签
  lessonsCount: number;
  origin: string; // official / ai_generated / user_imported
  progress: number; // 完课百分比 0-100（完课 lesson 数 / 总 lesson 数）
  coverSrc: string; // 真实封面图路径
  // —— 生成态（仅自造/导入课有意义；官方/淘来课恒为 ready）——
  // 让书架也能展示「生成中」的课（与 /me/courses 一致），生成完自动变就绪。
  genStatus: string; // generating / ready / failed / paused / outline_draft（其它/官方课 → ready）
  genDone: number; // 已生成节数（blocksJson 非空），生成态进度分子
}

/** 书架全量（五个分类，每类一组课）。 */
export type MyShelf = Record<ShelfCategory, ShelfCourse[]>;

/**
 * 取用户书架的全部课，按五个分类归组：
 * - ai_created：我造的 AI 课（origin=ai_generated 且 authorUserId=userId）
 * - imported  ：我导入的课（origin=user_imported 且 authorUserId=userId）
 * - learning  ：我在学的官方课（有 LearningProgress、origin=official、且未全部完成）
 * - collected ：我从集市「拿走」的课（非我造、非官方，且我有 LearningProgress，即 fork 起始记录）
 * - completed ：我已学完的课（该课每一 lesson 都有 completedAt）
 *
 * 分类互斥优先级：completed 最高（学完的课不再出现在 learning/collected），
 * 其次按归属/来源分到 ai_created / imported / learning / collected。
 *
 * 纯 server 函数（引 prisma），不 "use client"。越权铁律：仅查 userId 自己的数据。
 */
export async function getMyShelf(userId: string): Promise<MyShelf> {
  // —— 1. 我造/导入的课（归属 = 我）：与 LearningProgress 无关，作者天然拥有。 ——
  const myAuthoredCourses = await prisma.course.findMany({
    where: { authorUserId: userId, origin: { in: ["ai_generated", "user_imported"] } },
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      origin: true,
      genStatus: true,
      _count: { select: { lessons: true } },
      // 已生成节数（blocksJson 非空）：作为「生成中」进度分子。只在有生成态时用到，取轻量字段。
      lessons: { where: { blocksJson: { not: null } }, select: { id: true } },
    },
  });

  // —— 2. 我有学习记录的课（在学/拿走/学完都要基于它派生完课百分比）。 ——
  // 一次拿全我所有 LearningProgress，按 courseId 聚合出 {已完课数, 该课总课数, 来源, 归属}。
  const myProgress = await prisma.learningProgress.findMany({
    where: { userId },
    select: {
      courseId: true,
      completedAt: true,
      course: {
        select: {
          id: true,
          slug: true,
          title: true,
          category: true,
          origin: true,
          authorUserId: true,
          _count: { select: { lessons: true } },
        },
      },
    },
  });

  // 按课聚合：progress 行数 = 我在该课已「起播/学习」的 lesson 数；completed 数 = 有 completedAt 的行数。
  type Agg = {
    course: (typeof myProgress)[number]["course"];
    completedLessons: number;
  };
  const byCourse = new Map<string, Agg>();
  for (const p of myProgress) {
    if (!p.course) continue;
    const cur = byCourse.get(p.courseId) ?? { course: p.course, completedLessons: 0 };
    if (p.completedAt) cur.completedLessons += 1;
    byCourse.set(p.courseId, cur);
  }

  // 已归为「我造/导入」的课，不再重复进 learning/collected（作者本人在学自己的课属于造课层）。
  const authoredIds = new Set(myAuthoredCourses.map((c) => c.id));

  const shelf: MyShelf = { ai_created: [], imported: [], learning: [], collected: [], completed: [] };

  // 造课/导入课直接归组（进度按学习记录派生，无记录则 0%）。
  for (const c of myAuthoredCourses) {
    const agg = byCourse.get(c.id);
    const total = c._count.lessons;
    const genDone = c.lessons.length; // blocksJson 非空的节数（上面 where 已过滤）
    // 生成态归一：显式 generating/failed/paused/outline_draft 照旧透传（后两者为 L2/L3 可控造课新态，
    // Web 端据此渲染「待确认大纲」「已暂停」而非误显转圈；iOS 不解码 genStatus，透传新值解码安全）；
    // 无显式态但仍有空节视为生成中；否则就绪。
    const genStatus =
      c.genStatus === "generating" ||
      c.genStatus === "failed" ||
      c.genStatus === "paused" ||
      c.genStatus === "outline_draft"
        ? c.genStatus
        : genDone < total
        ? "generating"
        : "ready";
    const view: ShelfCourse = {
      id: c.id,
      slug: c.slug,
      title: c.title,
      category: c.category,
      categoryLabel: CATEGORY_LABELS[c.category] ?? c.category,
      lessonsCount: total,
      origin: c.origin,
      progress: pct(agg?.completedLessons ?? 0, total),
      coverSrc: resolveCoverSrc(c.slug, c.category, c.id),
      genStatus,
      genDone,
    };
    if (c.origin === "ai_generated") shelf.ai_created.push(view);
    else shelf.imported.push(view);
  }

  // 有学习记录的课分到 completed / learning / collected。
  for (const [courseId, agg] of byCourse) {
    if (authoredIds.has(courseId)) continue; // 造/导入课已归组
    const c = agg.course;
    if (!c) continue;
    const total = c._count.lessons;
    const done = agg.completedLessons;
    const view: ShelfCourse = {
      id: c.id,
      slug: c.slug,
      title: c.title,
      category: c.category,
      categoryLabel: CATEGORY_LABELS[c.category] ?? c.category,
      lessonsCount: total,
      origin: c.origin,
      progress: pct(done, total),
      coverSrc: resolveCoverSrc(c.slug, c.category, c.id),
      // 学习记录派生的课（官方在学/集市淘来/已完成）恒为就绪：能学=已生成，无生成态展示。
      genStatus: "ready",
      genDone: total,
    };

    // 学完：课有 lesson 且每节都完课。放最高优先级，不再进 learning/collected。
    if (total > 0 && done >= total) {
      shelf.completed.push(view);
      continue;
    }
    // 官方课在学 → learning；非官方（他人造/导入，即从集市拿走的 fork）→ collected。
    if (c.origin === "official") shelf.learning.push(view);
    else shelf.collected.push(view);
  }

  return shelf;
}

/**
 * 书架藏书总册数（供书桌入口角标）——轻量版：只数不组装展示数据。
 *
 * 口径与 getMyShelf 完全一致（去重）：我造/导入的课（作者=我）
 * ∪ 我有学习记录的课（learning/collected/completed），后者剔除已归为造/导入的课，避免重复计数。
 * 只 select id，成本远低于 getMyShelf（书桌首屏可安全并入 Promise.all）。
 * 越权铁律：全部 where userId。
 */
export async function getShelfCount(userId: string): Promise<number> {
  const [authored, progressed] = await Promise.all([
    prisma.course.findMany({
      where: { authorUserId: userId, origin: { in: ["ai_generated", "user_imported"] } },
      select: { id: true },
    }),
    prisma.learningProgress.findMany({
      where: { userId },
      select: { courseId: true },
      distinct: ["courseId"],
    }),
  ]);
  const ids = new Set(authored.map((c) => c.id));
  for (const p of progressed) ids.add(p.courseId);
  return ids.size;
}

/** 完课百分比：done/total，四舍五入并夹在 0-100；total=0 时 0%。 */
function pct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}
