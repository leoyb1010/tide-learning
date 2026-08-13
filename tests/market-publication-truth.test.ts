import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assessPresentation: vi.fn(),
  summarizeReadiness: vi.fn(),
  inputFingerprint: vi.fn(),
  qualityState: vi.fn(),
  coveragePasses: vi.fn(),
  transaction: vi.fn(),
  ensureAccount: vi.fn(),
}));

vi.mock("@/lib/course-gen", () => ({
  assessCoursePresentation: mocks.assessPresentation,
  summarizeCourseGenerationReadiness: mocks.summarizeReadiness,
  courseGenerationInputFingerprint: mocks.inputFingerprint,
  courseGenerationQualityState: mocks.qualityState,
  coverageVerdictPassesPolicy: mocks.coveragePasses,
}));
vi.mock("@/lib/credits", () => ({ ensureAccount: mocks.ensureAccount }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    coursePurchase: { findUnique: vi.fn() },
    creditAccount: { findUnique: vi.fn() },
  },
}));

import {
  MARKET_BASE_WHERE,
  marketBaseWhere,
  currentMarketPublicationFence,
  filterCurrentMarketCourses,
} from "@/lib/market-eligibility";
import { collectFreeCourse, purchaseCourse } from "@/lib/credit-trade";

const presentationLesson = {
  id: "lesson_1",
  title: "第一节",
  summary: "目标",
  blocksJson: '{"version":1,"blocks":[]}',
  qualityJson: '{"passed":true}',
  htmlJson: '{"renderMode":"sandbox_srcdoc"}',
  renderSourceHash: "sha256:render",
  renderEngine: "deterministic",
  designJson: null,
  contentBriefJson: '{"v":1,"request":"学习目标"}',
  modelUsed: null,
};

const manualCourse = {
  id: "manual_1",
  title: "手工课",
  category: "ai_skill",
  template: null,
  designJson: null,
  contentBriefJson: '{"v":1,"request":"AI 学习目标"}',
  modelUsed: "test-model",
  status: "published",
  sharedStatus: "shared",
  origin: "user_created",
  genStatus: "ready",
  generationQualityJson: null,
  presentationRevision: 3,
  lessons: [presentationLesson],
};

const aiCourse = {
  id: "ai_1",
  title: "AI 课",
  category: "ai_skill",
  template: null,
  designJson: null,
  contentBriefJson: '{"v":1,"request":"AI 学习目标"}',
  modelUsed: "test-model",
  status: "published",
  sharedStatus: "shared",
  origin: "ai_generated",
  genStatus: "ready",
  generationQualityJson: '{"archive":"current"}',
  presentationRevision: 7,
  lessons: [presentationLesson],
};

describe("集市发布真值", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assessPresentation.mockReturnValue({ total: 1, ready: 1, status: "degraded" });
    mocks.summarizeReadiness.mockReturnValue({ total: 1, remaining: 0, qualityFailures: 0, ready: true, retryLessons: [] });
    mocks.inputFingerprint.mockReturnValue("sha256:current");
    mocks.qualityState.mockReturnValue({ state: "passed", archive: { verdict: { passed: true } } });
    mocks.coveragePasses.mockReturnValue(true);
  });

  it("基础 SQL 门要求 published+shared，但 user_created 保留人工审核语义", () => {
    expect(MARKET_BASE_WHERE).toEqual({
      status: "published",
      sharedStatus: "shared",
      OR: [
        { origin: { in: ["user_created", "ai_generated", "user_imported"] }, genStatus: "ready" },
      ],
    });
    const searchOr = { OR: [{ title: { contains: "AI" } }, { subtitle: { contains: "AI" } }] };
    expect(marketBaseWhere(searchOr)).toEqual({ AND: [searchOr, MARKET_BASE_WHERE] });
  });

  it("user_created 不伪造生成档案，仍以 shared 人工审核为真值", async () => {
    await expect(currentMarketPublicationFence(manualCourse)).resolves.toEqual({
      courseId: "manual_1",
      origin: "user_created",
      generationQualityJson: null,
      presentationRevision: 3,
      priceCredits: null,
      firstLessonId: "",
      authorUserId: null,
      title: "",
    });
    expect(mocks.qualityState).not.toHaveBeenCalled();
  });

  it("user_created 只免 AI coverage 档案，不免 ready 与完整表现层", async () => {
    await expect(currentMarketPublicationFence({ ...manualCourse, genStatus: "failed" })).resolves.toBeNull();
    mocks.assessPresentation.mockReturnValueOnce({ total: 0, ready: 0, status: "incomplete" });
    await expect(currentMarketPublicationFence({ ...manualCourse, lessons: [] })).resolves.toBeNull();
    mocks.assessPresentation.mockReturnValueOnce({ total: 1, ready: 0, status: "incomplete" });
    await expect(currentMarketPublicationFence({ ...manualCourse, lessons: [{ ...presentationLesson, htmlJson: null }] })).resolves.toBeNull();
  });

  it("AI/import 只允许当前 archive + presentation revision 完全匹配", async () => {
    await expect(currentMarketPublicationFence(aiCourse)).resolves.toMatchObject({
      courseId: "ai_1",
      generationQualityJson: aiCourse.generationQualityJson,
      presentationRevision: 7,
    });

    mocks.qualityState.mockReturnValueOnce({ state: "stale", archive: null });
    await expect(currentMarketPublicationFence(aiCourse)).resolves.toBeNull();

    mocks.qualityState.mockReturnValueOnce({ state: "passed", archive: { verdict: { passed: true } } });
    mocks.assessPresentation.mockReturnValueOnce({ total: 1, ready: 0, status: "incomplete" });
    await expect(currentMarketPublicationFence(aiCourse)).resolves.toBeNull();
  });

  it("展示批次保留表现完整的 manual，过滤 stale AI，全程只做纯判定", async () => {
    const staleAi = { ...aiCourse, id: "ai_stale", generationQualityJson: '{"archive":"stale"}' };
    mocks.qualityState.mockImplementation((archiveJson: string) => archiveJson.includes("stale")
      ? { state: "stale", archive: null }
      : { state: "passed", archive: { verdict: { passed: true } } });

    await expect(filterCurrentMarketCourses([manualCourse, aiCourse, staleAi])).resolves.toEqual([
      manualCourse,
      aiCourse,
    ]);
    expect(mocks.qualityState).toHaveBeenCalledTimes(2);
  });
});

describe("归档/下架与交易竞态", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAccount.mockResolvedValue({ balance: 100 });
  });

  it("付费课在预检后归档/换表现 revision，事务在建所有权和扣款前 409", async () => {
    const tx = {
      course: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      coursePurchase: { create: vi.fn() },
      creditAccount: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
      creditLedger: { create: vi.fn() },
      learningProgress: { upsert: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => unknown) => run(tx));

    await expect(purchaseCourse({
      buyerId: "buyer",
      authorId: "author",
      courseId: aiCourse.id,
      firstLessonId: "lesson_1",
      priceCredits: 20,
      courseTitle: "AI 课",
      publicationFence: {
        courseId: aiCourse.id,
        origin: aiCourse.origin,
        generationQualityJson: aiCourse.generationQualityJson,
        presentationRevision: 7,
        priceCredits: 20,
        firstLessonId: "lesson_1",
        authorUserId: "author",
        title: "AI 课",
      },
    })).rejects.toMatchObject({ status: 409 });
    expect(tx.course.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: aiCourse.id,
        status: "published",
        sharedStatus: "shared",
        genStatus: "ready",
        generationQualityJson: aiCourse.generationQualityJson,
        presentationRevision: 7,
        priceCredits: 20,
        authorUserId: "author",
        title: "AI 课",
        lessons: { some: { id: "lesson_1" } },
      }),
      data: { salesCount: { increment: 0 } },
    });
    expect(tx.coursePurchase.create).not.toHaveBeenCalled();
    expect(tx.creditAccount.update).not.toHaveBeenCalled();
  });

  it("免费课在预检后下架，事务在建所有权/发作者激励前 409", async () => {
    const tx = {
      course: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      coursePurchase: { create: vi.fn() },
      learningProgress: { upsert: vi.fn() },
      creditAccount: { update: vi.fn() },
      creditLedger: { create: vi.fn() },
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => unknown) => run(tx));

    await expect(collectFreeCourse({
      collectorId: "collector",
      authorId: "author",
      courseId: manualCourse.id,
      firstLessonId: "lesson_1",
      authorBonus: 2,
      courseTitle: "手工课",
      publicationFence: {
        courseId: manualCourse.id,
        origin: manualCourse.origin,
        generationQualityJson: null,
        presentationRevision: 3,
        priceCredits: null,
        firstLessonId: "lesson_1",
        authorUserId: "author",
        title: "手工课",
      },
    })).rejects.toMatchObject({ status: 409 });
    expect(tx.course.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: manualCourse.id,
        status: "published",
        sharedStatus: "shared",
        genStatus: "ready",
        origin: "user_created",
        presentationRevision: 3,
      }),
      data: { salesCount: { increment: 0 } },
    });
    expect(tx.coursePurchase.create).not.toHaveBeenCalled();
    expect(tx.creditAccount.update).not.toHaveBeenCalled();
  });

  it("archive 必须同行写 sharedStatus=private，审核下架使用 shared CAS", async () => {
    const adminRoute = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/admin/courses/[id]/route.ts", "utf8"));
    const moderationRoute = await import("node:fs/promises").then((fs) => fs.readFile("src/app/api/admin/moderation/course/route.ts", "utf8"));
    expect(adminRoute).toContain('if (body.status === "archived") data.sharedStatus = "private"');
    expect(moderationRoute).toContain('where: { id: courseId, sharedStatus: "shared" }');
    expect(moderationRoute).toContain("if (unshared.count !== 1)");
  });
});
