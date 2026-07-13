import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  course: { findFirst: vi.fn() },
  lesson: { findUnique: vi.fn() },
  coursePurchase: { findUnique: vi.fn() },
  learningProgress: { findMany: vi.fn() },
}));

const mockEntitlement = vi.hoisted(() => ({
  resolveEntitlement: vi.fn(),
  canAccessLesson: vi.fn(
    (track: string, isFree: boolean, snapshot: { accessibleTracks: "all" | string[] }, owned = false) =>
      isFree || owned || snapshot.accessibleTracks === "all" || snapshot.accessibleTracks.includes(track),
  ),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/entitlement", () => mockEntitlement);
vi.mock("@/lib/private-media", () => ({ createStreamSignature: () => "test-signature" }));
vi.mock("@/lib/course-review", () => ({ batchCourseRealRatings: vi.fn() }));
vi.mock("@/lib/demand-score", () => ({ rankDemands: vi.fn() }));
vi.mock("@/lib/credit-trade", () => ({ getAuthorEarnings: vi.fn(), LEDGER_TYPE: {} }));

import { getCourseDetail, getLessonForUser } from "@/lib/queries";

const FREE = { accessibleTracks: [] as string[], isSubscriber: false, accessLevel: "free" };
const ORAL = { accessibleTracks: ["oral"] as string[], isSubscriber: true, accessLevel: "subscriber" };
const ALL = { accessibleTracks: "all" as const, isSubscriber: true, accessLevel: "subscriber" };

const paidLesson = {
  id: "lesson-paid",
  title: "付费章节",
  summary: "安全大纲",
  contentType: "video",
  videoAssetId: "asset-secret",
  videoUrl: "/videos/legacy-secret.mp4",
  articleMd: "TOP_SECRET_ARTICLE",
  blocksJson: "TOP_SECRET_BLOCKS",
  htmlJson: "TOP_SECRET_HTML",
  videoGenStatus: "ready",
  videoDurationSec: 120,
  durationSec: 120,
  isFree: false,
  liveStartAt: null,
  liveSeatLimit: null,
  subtitles: [{ startSec: 0, endSec: 2, text: "TOP_SECRET_SUBTITLE" }],
  course: {
    id: "course-ai",
    slug: "course-ai",
    title: "AI 课程",
    category: "ai",
    totalDurationSec: 120,
    origin: "official",
    visibility: "public",
    authorUserId: null,
    sharedStatus: "unshared",
    lessons: [
      { id: "lesson-free", title: "试听", summary: "公开", contentType: "article", durationSec: 60, isFree: true, sortOrder: 1 },
      { id: "lesson-paid", title: "付费章节", summary: "安全大纲", contentType: "video", durationSec: 120, isFree: false, sortOrder: 2 },
    ],
  },
};

function expectPaidBodyRedacted(result: Awaited<ReturnType<typeof getLessonForUser>>) {
  expect(result).not.toBeNull();
  expect(result!.access).toBe(false);
  expect(result!.lesson).toMatchObject({
    videoUrl: null,
    articleMd: null,
    blocksJson: null,
    htmlJson: null,
    videoGenStatus: null,
    videoDurationSec: null,
    subtitles: [],
  });
  expect(JSON.stringify(result)).not.toContain("TOP_SECRET");
  expect(JSON.stringify(result)).not.toContain("asset-secret");
  expect(JSON.stringify(result)).not.toContain("legacy-secret");
}

describe("付费课件身份矩阵", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.lesson.findUnique.mockResolvedValue(paidLesson);
    mockPrisma.coursePurchase.findUnique.mockResolvedValue(null);
    mockPrisma.learningProgress.findMany.mockResolvedValue([]);
    mockEntitlement.resolveEntitlement.mockResolvedValue(FREE);
  });

  it("匿名与免费用户拿不到任何正文、媒体标识或字幕", async () => {
    expectPaidBodyRedacted(await getLessonForUser("lesson-paid", null));
    expectPaidBodyRedacted(await getLessonForUser("lesson-paid", "user-free"));
  });

  it("错赛道订阅仍被拒绝", async () => {
    mockEntitlement.resolveEntitlement.mockResolvedValue(ORAL);
    expectPaidBodyRedacted(await getLessonForUser("lesson-paid", "user-oral"));
  });

  it("全站订阅仅通过签名流地址获得内容，不泄露原始 assetId/历史直链", async () => {
    mockEntitlement.resolveEntitlement.mockResolvedValue(ALL);
    const result = await getLessonForUser("lesson-paid", "user-all");
    expect(result?.access).toBe(true);
    expect(result?.lesson.videoUrl).toMatch(/^\/api\/stream\/asset-secret\?exp=\d+&sig=test-signature$/);
    expect(result?.lesson.videoUrl).not.toContain("legacy-secret");
    expect(result?.lesson.articleMd).toBe("TOP_SECRET_ARTICLE");
  });

  it("本课买断只按当前用户+当前课程放行", async () => {
    mockPrisma.coursePurchase.findUnique.mockResolvedValue({ id: "purchase-1" });
    const result = await getLessonForUser("lesson-paid", "user-buyer");
    expect(mockPrisma.coursePurchase.findUnique).toHaveBeenCalledWith({
      where: { userId_courseId: { userId: "user-buyer", courseId: "course-ai" } },
      select: { id: true },
    });
    expect(result?.access).toBe(true);
    expect(result?.lesson.articleMd).toBe("TOP_SECRET_ARTICLE");
  });

  it("他人的私有课程对匿名和其他用户都表现为不存在", async () => {
    mockPrisma.lesson.findUnique.mockResolvedValue({
      ...paidLesson,
      course: { ...paidLesson.course, origin: "ai_generated", visibility: "private", authorUserId: "owner", sharedStatus: "unshared" },
    });
    await expect(getLessonForUser("lesson-paid", null)).resolves.toBeNull();
    await expect(getLessonForUser("lesson-paid", "other-user")).resolves.toBeNull();
  });

  it("unlisted 可凭直链读取，但 private 仅作者、分享者或买家可读", async () => {
    mockPrisma.lesson.findUnique.mockResolvedValue({
      ...paidLesson,
      course: { ...paidLesson.course, visibility: "unlisted", origin: "ai_generated" },
    });
    await expect(getLessonForUser("lesson-paid", null)).resolves.not.toBeNull();

    mockPrisma.lesson.findUnique.mockResolvedValue({
      ...paidLesson,
      course: { ...paidLesson.course, visibility: "private", origin: "ai_generated", authorUserId: "owner", sharedStatus: "unshared" },
    });
    await expect(getLessonForUser("lesson-paid", "owner")).resolves.not.toBeNull();
    mockPrisma.coursePurchase.findUnique.mockResolvedValue({ id: "purchase-private" });
    await expect(getLessonForUser("lesson-paid", "buyer")).resolves.not.toBeNull();
  });

  it("课程详情的递归响应只含安全大纲，不含任何课件字段或秘密值", async () => {
    mockPrisma.course.findFirst.mockResolvedValue({
      ...paidLesson.course,
      updateLogs: [],
    });
    const result = await getCourseDetail("course-ai", null);
    expect(result).not.toBeNull();
    const serialized = JSON.stringify(result);
    for (const field of ["articleMd", "blocksJson", "htmlJson", "videoUrl", "videoAssetId", "videoScriptJson", "subtitles"]) {
      expect(serialized).not.toContain(`\"${field}\"`);
    }
    expect(serialized).not.toContain("TOP_SECRET");
  });
});
