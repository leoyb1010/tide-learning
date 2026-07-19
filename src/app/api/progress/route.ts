import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { getLessonForUser } from "@/lib/queries";
import { track } from "@/lib/analytics";
import { recordActivity } from "@/lib/gamification";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

// 进度上限：约 24 小时（秒）。翻页 index 同用此上限，实际远小于此，只为挡住溢出/脏数据。
const MAX_PROGRESS = 24 * 60 * 60;

// POST /api/progress — 记录学习进度（§18.3）
export async function POST(req: NextRequest) {
  return handle(async () => {
    // P2 写门：补同源校验（对 Bearer/native 放行）
    assertSameOrigin(req);
    const user = await requireUser();
    const { lessonId, progressSec, completed, kind } = (await req.json()) as {
      lessonId: string;
      progressSec: number;
      completed?: boolean;
      // 进度语义区分：video（默认，秒数锚点）/ slide（翻页课件的「已读到第几页」，1-indexed）。
      // 两者落在不同字段，块课翻页与视频播放的续读锚点互不覆盖。
      kind?: "video" | "slide";
    };

    // P3 数值校验：progressSec 必须是有限数，clamp 到 [0, MAX_PROGRESS]，挡住 NaN/负数/溢出脏写。
    if (!Number.isFinite(progressSec)) return fail("进度数值非法");
    const safeProgress = Math.min(Math.max(0, Math.floor(progressSec)), MAX_PROGRESS);

    // P2 归属+付费双门：getLessonForUser 已内置 canViewCourse（他人私有课视为不存在→null）
    // 与 canAccessLesson（付费节需订阅→access）。null 即无权可见，403。
    const view = await getLessonForUser(lessonId, user.id);
    if (!view) return fail("无权访问该课程", 403);

    // P1-1：写门与页面 paywall 对齐——无访问权（付费节未订阅/未买断）时直接 403，绝不写入任何进度。
    // 此前仅在 completed 时校验 view.access，普通 progress 仍会 upsert，污染学习时长/续学派生/运营指标，
    // 甚至可能被误用作「已学习/已拥有」信号放大为权益绕过。免费节 isFree→access=true，不受影响。
    if (!view.access) return fail("无权访问该课节", 403);

    // 翻页进度写 lastSlideIndex，视频/模拟播放进度写 progressSec；二者隔离，互不污染另一视图的续读点。
    const isSlide = kind === "slide";
    // 到此 view.access 必为 true（上方已挡）；completed 直接以入参为准。
    const canComplete = completed === true;

    // 蓝图 D1：取写前进度，供激励水位按「前进量」保守折算（防高频上报刷水位）。
    const prevProgress = await prisma.learningProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      select: { progressSec: true, lastSlideIndex: true },
    });

    await prisma.learningProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: {
        userId: user.id,
        courseId: view.course.id,
        lessonId,
        progressSec: isSlide ? 0 : safeProgress,
        lastSlideIndex: isSlide ? safeProgress : null,
        completedAt: canComplete ? new Date() : null,
      },
      update: {
        ...(isSlide ? { lastSlideIndex: safeProgress } : { progressSec: safeProgress }),
        lastPlayedAt: new Date(),
        ...(canComplete ? { completedAt: new Date() } : {}),
      },
    });
    await track({
      eventName: canComplete ? "lesson_complete" : "lesson_progress",
      userId: user.id,
      properties: { course_id: view.course.id, lesson_id: lessonId, progress_sec: safeProgress, kind: isSlide ? "slide" : "video" },
    });
    // 蓝图 D1（审查 P0-7）：学习进度接线激励系统——此前 recordActivity 全仓零调用，
    // streak/潮汐日历/成就对真实用户恒为空。minutes 按前进量折算（回看/重复上报记 0，仅点亮当日）；
    // 完课至少记 1 分钟。after() 响应后执行，失败静默，不影响进度写入主链。
    const advancedMinutes = isSlide
      ? (safeProgress > (prevProgress?.lastSlideIndex ?? 0) ? 1 : 0)
      : Math.min(30, Math.max(0, Math.round((safeProgress - (prevProgress?.progressSec ?? 0)) / 60)));
    after(() =>
      recordActivity(user.id, { minutes: canComplete ? Math.max(1, advancedMinutes) : advancedMinutes }).catch(() => {}),
    );
    return ok({ saved: true });
  });
}

// GET /api/progress — 当前用户的学习进度列表（Web 复合搜索选课范围等消费，只需课程标识）。
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ progress: [] });
    // P1-2 修复：此前 include:{ lesson:true } 会把整行 lesson（含 blocksJson/htmlJson/articleMd/
    // videoScriptJson 完整课件正文）经进度列表整体下发——既是大 payload（重度用户巨响应），
    // 也可能让退订/无权益用户从进度列表拿到已学章节正文，绕过 getLessonForUser 的按权益置空。
    // 正文一律走 /api/lessons/[id] 的权益门；此列表只 select 课程标识与进度锚点，并分页（默认最近 100，上限 200）。
    // 夹上下界：负数/0 会被 Prisma 当「取末尾 N 条」透传，导致返回语义反常，故下界钳到 1。
    const take = Math.min(Math.max(1, Number(new URL(req.url).searchParams.get("take")) || 100), 200);
    const progress = await prisma.learningProgress.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        courseId: true,
        lessonId: true,
        progressSec: true,
        lastSlideIndex: true,
        completedAt: true,
        lastPlayedAt: true,
        course: { select: { id: true, title: true, slug: true, coverColor: true } },
      },
      orderBy: { lastPlayedAt: "desc" },
      take,
    });
    return ok({ progress });
  });
}
