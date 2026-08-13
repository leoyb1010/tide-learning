import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  beginCoursePresentationMutation,
  claimCourseContentMutation,
  settleExternalCoursePresentation,
} from "@/lib/course-gen";
import { buildContract } from "@/lib/ai/courseware-html";
import { renderSourceHash } from "@/lib/ai/courseware-gen";
import { resolveCourseDesign } from "@/lib/ai/courseware-design";
import { resolveCoursewareMode } from "@/lib/ai/courseware-catalog";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const clients: PrismaClient[] = [];
let tempDir = "";

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-presentation-revision-"));
  const dbPath = join(tempDir, "presentation.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
  const datasourceUrl = `file:${dbPath}?connection_limit=1`;
  clients.push(
    new PrismaClient({ datasources: { db: { url: datasourceUrl } } }),
    new PrismaClient({ datasources: { db: { url: datasourceUrl } } }),
  );
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.create({ data: { id: "presentation-user", nickname: "Presentation User" } });
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clients[0].generationJob.deleteMany();
  await clients[0].lessonRevision.deleteMany();
  await clients[0].lesson.deleteMany();
  await clients[0].course.deleteMany();
});

function blocksJson(label: string) {
  return JSON.stringify({
    version: 1,
    blocks: [{ id: `concept-${label}`, type: "concept", title: label, markdown: `Content ${label}` }],
  });
}

async function createManualCourse(id: string, sharedStatus = "private", lessonCount = 2) {
  const courseShape = { id, title: `Course ${id}`, category: "career", template: null, designJson: null };
  const design = resolveCourseDesign(courseShape);
  const mode = resolveCoursewareMode({
    title: courseShape.title,
    template: courseShape.template,
    artKey: design.art.key,
    layout: design.art.layout,
  });
  return clients[0].course.create({
    data: {
      id,
      slug: `slug-${id}`,
      title: courseShape.title,
      category: courseShape.category,
      level: "L1",
      status: "published",
      origin: "user_created",
      visibility: "private",
      authorUserId: "presentation-user",
      sharedStatus,
      genStatus: "ready",
      lessons: {
        create: Array.from({ length: lessonCount }, (_, index) => {
          const blocks = blocksJson(`${id}-${index}`);
          return {
            id: `${id}-lesson-${index}`,
            title: `Lesson ${index}`,
            sortOrder: index,
            contentType: "ai_html",
            blocksJson: blocks,
            htmlJson: JSON.stringify(buildContract(`<!doctype html><html><body>${id}-${index}</body></html>`)),
            renderEngine: "deterministic",
            renderSourceHash: renderSourceHash({
              blocksJson: blocks,
              title: `Lesson ${index}`,
              sortOrder: index,
              design,
              mode,
            }),
          };
        }),
      },
    },
    include: { lessons: { orderBy: { sortOrder: "asc" } } },
  });
}

describe("Course presentation revision fencing on isolated SQLite", () => {
  it("prevents an older operation from writing or restoring ready after a newer begin", async () => {
    const course = await createManualCourse("visual-race", "shared", 1);
    const first = await beginCoursePresentationMutation(course.id, {}, clients[0]);
    expect(first).toMatchObject({ ok: true, revision: 1 });
    const second = await beginCoursePresentationMutation(course.id, {}, clients[1]);
    expect(second).toMatchObject({ ok: true, revision: 2 });
    if (!first.ok || !second.ok) throw new Error("expected both operations to begin");

    const latestCourse = await clients[0].course.findUniqueOrThrow({ where: { id: course.id } });
    const design = resolveCourseDesign(latestCourse);
    const mode = resolveCoursewareMode({
      title: latestCourse.title,
      template: latestCourse.template,
      artKey: design.art.key,
      layout: design.art.layout,
    });
    const blocks = course.lessons[0].blocksJson;
    const contractJson = JSON.stringify(buildContract("<!doctype html><html><body>new owner</body></html>"));
    const sourceHash = renderSourceHash({
      blocksJson: blocks,
      title: course.lessons[0].title,
      sortOrder: course.lessons[0].sortOrder,
      design,
      mode,
    });

    const staleWrite = await clients[0].lesson.updateMany({
      where: { id: course.lessons[0].id, course: { presentationRevision: first.revision } },
      data: { htmlJson: contractJson, renderEngine: "deterministic", renderSourceHash: sourceHash },
    });
    expect(staleWrite.count).toBe(0);
    const currentWrite = await clients[1].lesson.updateMany({
      where: { id: course.lessons[0].id, course: { presentationRevision: second.revision } },
      data: { htmlJson: contractJson, renderEngine: "deterministic", renderSourceHash: sourceHash },
    });
    expect(currentWrite.count).toBe(1);

    const staleSettlement = await settleExternalCoursePresentation(course.id, first.revision, clients[0]);
    expect(staleSettlement.settled).toBe(false);
    const currentSettlement = await settleExternalCoursePresentation(course.id, second.revision, clients[1]);
    expect(currentSettlement).toMatchObject({ settled: true, contentReady: true, status: "degraded" });
    const persisted = await clients[0].course.findUniqueOrThrow({ where: { id: course.id } });
    expect(persisted).toMatchObject({ presentationRevision: 2, genStatus: "ready", sharedStatus: "pending" });
  });

  it("serializes manual content claims and keeps the winning revision non-ready", async () => {
    const course = await createManualCourse("content-race", "shared", 1);
    const expectedRevision = course.presentationRevision;
    const claims = await Promise.allSettled([
      clients[0].$transaction((tx) => claimCourseContentMutation(tx, {
        courseId: course.id,
        expectedPresentationRevision: expectedRevision,
      })),
      clients[1].$transaction((tx) => claimCourseContentMutation(tx, {
        courseId: course.id,
        expectedPresentationRevision: expectedRevision,
      })),
    ]);
    const winners = claims.filter((claim) => claim.status === "fulfilled");
    const losers = claims.filter((claim) => claim.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const stored = await clients[0].course.findUniqueOrThrow({ where: { id: course.id } });
    expect(stored).toMatchObject({
      presentationRevision: expectedRevision + 1,
      genStatus: "failed",
      sharedStatus: "pending",
      generationQualityJson: null,
    });
  });

  it("rejects manual content mutation while a live generation owner exists", async () => {
    const course = await createManualCourse("content-live-job", "private", 1);
    await clients[0].generationJob.create({
      data: {
        id: "content-live-job-owner",
        userId: "presentation-user",
        type: "course_gen",
        dedupeKey: "content-live-job-owner-key",
        resultRef: course.id,
        status: "running",
        fencingToken: 1,
        leaseUntil: new Date(Date.now() + 60_000),
        heartbeatAt: new Date(),
      },
    });

    await expect(clients[0].$transaction((tx) => claimCourseContentMutation(tx, {
      courseId: course.id,
      expectedPresentationRevision: course.presentationRevision,
    }))).rejects.toThrow("正在生成");
    const stored = await clients[0].course.findUniqueOrThrow({ where: { id: course.id } });
    expect(stored.presentationRevision).toBe(course.presentationRevision);
    expect(stored.genStatus).toBe("ready");
  });

  it("does not treat an expired outline lease as proof that the paid supplier request stopped", async () => {
    const course = await createManualCourse("content-expired-outline-job", "private", 1);
    await clients[0].generationJob.create({
      data: {
        id: "content-expired-outline-owner",
        userId: "presentation-user",
        type: "outline_regen",
        dedupeKey: "content-expired-outline-owner-key",
        resultRef: course.id,
        status: "running",
        fencingToken: 1,
        leaseUntil: new Date(0),
        heartbeatAt: new Date(0),
      },
    });

    await expect(clients[0].$transaction((tx) => claimCourseContentMutation(tx, {
      courseId: course.id,
      expectedPresentationRevision: course.presentationRevision,
    }))).rejects.toThrow("正在生成");
    await expect(clients[0].course.findUniqueOrThrow({ where: { id: course.id } }))
      .resolves.toMatchObject({ presentationRevision: course.presentationRevision, genStatus: "ready" });
  });

  it("blocks an ownerless presentation begin while a paid visual owner is live, but allows that owner", async () => {
    const course = await createManualCourse("presentation-live-job", "private", 1);
    const now = new Date();
    await clients[0].generationJob.create({
      data: {
        id: "presentation-live-job-owner",
        userId: "presentation-user",
        type: "course_presentation",
        dedupeKey: "presentation-live-job-owner-key",
        resultRef: course.id,
        status: "running",
        fencingToken: 7,
        leaseUntil: new Date(now.getTime() + 60_000),
        heartbeatAt: now,
      },
    });
    const lease = {
      jobId: "presentation-live-job-owner",
      dedupeKey: "presentation-live-job-owner-key",
      fencingToken: 7,
      leaseUntil: new Date(now.getTime() + 60_000),
      heartbeatAt: now,
    };

    await expect(beginCoursePresentationMutation(course.id, {}, clients[0]))
      .resolves.toEqual({ ok: false, reason: "active_generation" });
    await expect(clients[0].course.findUniqueOrThrow({ where: { id: course.id } }))
      .resolves.toMatchObject({ presentationRevision: course.presentationRevision, genStatus: "ready" });

    await clients[0].generationJob.update({
      where: { id: lease.jobId },
      data: { leaseUntil: new Date(0) },
    });
    await expect(beginCoursePresentationMutation(course.id, {}, clients[0]))
      .resolves.toEqual({ ok: false, reason: "active_generation" });
    await clients[0].generationJob.update({
      where: { id: lease.jobId },
      data: { leaseUntil: new Date(Date.now() + 60_000) },
    });

    const owned = await beginCoursePresentationMutation(
      course.id,
      { ownerPresentationLease: lease },
      clients[1],
    );
    expect(owned).toMatchObject({ ok: true, revision: course.presentationRevision + 1 });
  });

  it("changes render hash when title, summary or order changes", () => {
    const shape = { id: "hash-course", title: "Hash course", category: "career", template: null, designJson: null };
    const design = resolveCourseDesign(shape);
    const mode = resolveCoursewareMode({ title: shape.title, template: null, artKey: design.art.key, layout: design.art.layout });
    const base = { blocksJson: blocksJson("hash"), title: "Lesson", summary: "Objective", sortOrder: 0, design, mode };
    const original = renderSourceHash(base);
    expect(renderSourceHash({ ...base, title: "Renamed" })).not.toBe(original);
    expect(renderSourceHash({ ...base, summary: "Changed objective" })).not.toBe(original);
    expect(renderSourceHash({ ...base, sortOrder: 1 })).not.toBe(original);
  });

  it("invalidates only selected lessons and leaves unselected bytes identical", async () => {
    const course = await createManualCourse("visual-target", "private", 2);
    const untouchedBefore = course.lessons[1];
    const mutation = await beginCoursePresentationMutation(
      course.id,
      { lessonIds: [course.lessons[0].id] },
      clients[0],
    );
    expect(mutation).toMatchObject({ ok: true, revision: 1, lessonIds: [course.lessons[0].id] });
    const untouchedAfter = await clients[0].lesson.findUniqueOrThrow({ where: { id: untouchedBefore.id } });
    expect(untouchedAfter.htmlJson).toBe(untouchedBefore.htmlJson);
    expect(untouchedAfter.renderSourceHash).toBe(untouchedBefore.renderSourceHash);
    expect(untouchedAfter.renderEngine).toBe(untouchedBefore.renderEngine);
  });

  it.each([
    ["private", "private"],
    ["rejected", "rejected"],
    ["pending", "pending"],
    ["shared", "pending"],
  ])("preserves publication state matrix %s -> %s", async (before, after) => {
    const course = await createManualCourse(`matrix-${before}`, before, 1);
    expect((await beginCoursePresentationMutation(course.id, {}, clients[0])).ok).toBe(true);
    expect((await clients[0].course.findUniqueOrThrow({ where: { id: course.id } })).sharedStatus).toBe(after);
  });

  it("archives paid HTML before clearing it and rejects faithful imports before revision advances", async () => {
    const course = await createManualCourse("archive-llm", "private", 1);
    await clients[0].lesson.update({
      where: { id: course.lessons[0].id },
      data: { renderEngine: "llm" },
    });
    expect((await beginCoursePresentationMutation(course.id, {}, clients[0])).ok).toBe(true);
    expect(await clients[0].lessonRevision.count({ where: { lessonId: course.lessons[0].id } })).toBe(1);
    expect((await clients[0].lesson.findUniqueOrThrow({ where: { id: course.lessons[0].id } })).htmlJson).toBeNull();

    const faithful = await createManualCourse("faithful", "private", 1);
    await clients[0].lesson.update({
      where: { id: faithful.lessons[0].id },
      data: { renderEngine: "faithful_import" },
    });
    expect(await beginCoursePresentationMutation(faithful.id, {}, clients[0]))
      .toEqual({ ok: false, reason: "faithful_import" });
    expect((await clients[0].course.findUniqueOrThrow({ where: { id: faithful.id } })).presentationRevision).toBe(0);
  });
});
