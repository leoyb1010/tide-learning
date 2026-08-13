import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolvePresentationStatus } from "@/lib/gen-progress-contract";
import {
  assessCoursePresentation,
  readGenProgress,
  isLessonGenerationReady,
  summarizeCourseGenerationReadiness,
  type CoursePresentationAssessment,
} from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * 轮询降本：本路由被 GenProgress 每 3 秒打一次，而逐节真值评估要吃进全部
 * blocksJson/htmlJson 并逐课 sha256——对大课是每次轮询 MB 级 SQLite 读 + 重哈希。
 * 缓存键 = (presentationRevision, genStatus, premiumRenderCount, deterministicRenderCount)：
 * - presentationRevision 是内容变更时钟（语义写入都在同事务自增它），正文/大纲/设计改动都会换键；
 * - HTML 渲染写在 lesson 行、刻意不 bump revision，但每条收敛路径（finalize / settle）
 *   都会写回 genStatus 与两个渲染计数器——终态一定换键重算，陈旧只存在于
 *   渲染进行中的装饰性 presentation 计数（进度条真值 done/total 走 blocks，随 revision 换键）。
 * job 快照是行内小字段，每次照常新鲜读取，不进缓存。
 */
interface CachedAssessment {
  key: string;
  presentation: CoursePresentationAssessment;
  qualityFailures: number;
  blocksDone: number;
  lessons: { id: string; title: string; ready: boolean }[];
}
const ASSESS_CACHE_MAX = 500;
const assessCache = new Map<string, CachedAssessment>();

/**
 * GET /api/courses/:id/gen-progress —— 断点续造进度查询（供前端轮询恢复剧场）。
 *
 * 越权铁律：requireUser + 只能查自己作为 author 的课（authorUserId===user.id）。
 * 返回 {total, done, failed, currentLessonId, genStatus, lessons:[{id,title,ready}]}。
 * 进度来自课级 GenerationJob（course_gen）快照，lessons.ready 以 blocksJson 是否已生成为准。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();

    const course = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        category: true,
        template: true,
        designJson: true,
        authorUserId: true,
        genStatus: true,
        presentationRevision: true,
        premiumRenderCount: true,
        deterministicRenderCount: true,
      },
    });
    if (!course) return fail("课程不存在", 404);
    // 只能查自己的课（越权铁律）：官方课 authorUserId 为 null，也一并拒绝。
    if (course.authorUserId !== user.id) throw new AppError("无权查看该课程", 403);

    const progress = await readGenProgress(course.id);

    const cacheKey = `${course.presentationRevision}:${course.genStatus ?? ""}:${course.premiumRenderCount}:${course.deterministicRenderCount}`;
    let assessed = assessCache.get(course.id);
    if (!assessed || assessed.key !== cacheKey) {
      const lessonRows = await prisma.lesson.findMany({
        where: { courseId: course.id },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          summary: true,
          sortOrder: true,
          blocksJson: true,
          qualityJson: true,
          htmlJson: true,
          renderSourceHash: true,
          renderEngine: true,
          designJson: true,
        },
      });
      assessed = {
        key: cacheKey,
        presentation: assessCoursePresentation({ ...course, lessons: lessonRows }),
        qualityFailures: summarizeCourseGenerationReadiness(lessonRows).qualityFailures,
        blocksDone: lessonRows.filter((lesson) => lesson.blocksJson != null).length,
        lessons: lessonRows.map((l) => ({
          id: l.id,
          title: l.title,
          ready: isLessonGenerationReady(l),
        })),
      };
      if (assessCache.size >= ASSESS_CACHE_MAX && !assessCache.has(course.id)) {
        const oldest = assessCache.keys().next().value;
        if (oldest !== undefined) assessCache.delete(oldest);
      }
      assessCache.set(course.id, assessed);
    }
    const { presentation, qualityFailures, blocksDone, lessons } = assessed;

    // total 以实际 lesson 数为准（job 快照可能落后），保证前端进度条分母稳定。
    const total = lessons.length;
    const doneByLessons = lessons.filter((l) => l.ready).length;
    // GET 严格只读：不在轮询路径启动付费 coverage/HTML，也不凭 JSON 心跳改终态。
    // 进程恢复由 generation-worker 经原子 lease acquire 接管。
    const genStatus = course.genStatus;
    const currentLessonId = progress.currentLessonId;
    // 表现层只在整课 ready 后才对外宣布 premium / degraded。
    // 动态发布门若发现缺 HTML、旧 sourceHash 或无效 contract，则显式 incomplete；
    // 生成中不把阶段性的确定性渲染误报为降级成稿。
    const presentationStatus = resolvePresentationStatus(genStatus, presentation);

    return ok({
      total,
      done: doneByLessons,
      failed: Math.max(progress.failed, qualityFailures, total - doneByLessons - (total - blocksDone)),
      currentLessonId,
      genStatus,
      presentationStatus,
      presentation: {
        degraded: presentation.degraded,
        ready: presentation.ready,
        total: presentation.total,
        premiumRenderCount: presentation.premiumRenderCount,
        deterministicRenderCount: presentation.deterministicRenderCount,
      },
      lessons,
    });
  });
}
