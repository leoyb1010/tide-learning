import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { AppError, ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { TRACKS } from "@/lib/tracks";
import { claimCourseContentMutation } from "@/lib/course-gen";

// 白名单枚举：对齐 prisma/schema.prisma Course 注释（status/level）与 src/lib/tracks.ts（category）
const VALID_STATUS = ["draft", "beta", "published", "archived"];
const VALID_LEVEL = ["L1", "L2", "L3"];
const VALID_CATEGORY = TRACKS.map((t) => t.key);
// 字符串字段长度上限（title 等短文本 200，长文本 2000）
const STRING_MAX: Record<string, number> = {
  title: 200, subtitle: 200, instructorName: 200, reviewerName: 200, updateCadence: 200,
  description: 2000, disclaimer: 2000,
};

// PATCH /api/admin/courses/:id — 编辑课程 / 变更状态（草稿/内测/已发布/下架）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = ["title", "subtitle", "description", "category", "level", "status", "instructorName", "reviewerName", "disclaimer", "updateCadence", "isFeatured"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) data[k] = body[k];
    // —— 字段校验：枚举白名单 / 类型 / 限长，非法直接 400 ——
    if ("status" in data && !VALID_STATUS.includes(data.status as string)) return fail("非法状态");
    if ("level" in data && !VALID_LEVEL.includes(data.level as string)) return fail("非法难度等级");
    if ("category" in data && !VALID_CATEGORY.includes(data.category as string)) return fail("非法分类");
    if ("isFeatured" in data && typeof data.isFeatured !== "boolean") return fail("isFeatured 须为布尔值");
    for (const [k, max] of Object.entries(STRING_MAX)) {
      if (!(k in data)) continue;
      const v = data[k];
      if (v === null && k !== "title") continue; // 可空字段允许显式清空
      if (typeof v !== "string") return fail(`${k} 须为字符串`);
      if (k === "title" && !v.trim()) return fail("标题不能为空");
      if (v.length > max) return fail(`${k} 过长（最多 ${max} 字）`);
    }
    if (body.status === "published") data.publishedAt = new Date();
    // 课程归档与集市下架必须是同一行更新：不留 status=archived/shared=shared 中间态。
    // CoursePurchase 不动，已购者仍按既有所有权通道访问。
    if (body.status === "archived") data.sharedStatus = "private";
    data.lastUpdatedAt = new Date();
    const course = await prisma.$transaction(async (tx) => {
      const prior = await tx.course.findUnique({
        where: { id },
        select: { id: true, status: true, sharedStatus: true, presentationRevision: true },
      });
      if (!prior) throw new AppError("课程不存在", 404);
      const semanticChanged = ["title", "category", "level"].some((field) => field in data);
      const statusChanged = typeof data.status === "string" && data.status !== prior.status;
      let expectedRevision = prior.presentationRevision;

      if (semanticChanged) {
        // faithful_import / SCORM 的 HTML 就是原始课件交付物，当前没有可重建的上传字节。
        // 普通语义编辑会清空全课表现层，因此必须在任何 revision/job 写入前 fail closed。
        const irreplaceableImport = await tx.lesson.findFirst({
          where: {
            courseId: id,
            OR: [{ contentType: "scorm" }, { renderEngine: "faithful_import" }],
          },
          select: { id: true },
        });
        if (irreplaceableImport) {
          throw new AppError("忠实导入/SCORM 课程不能修改标题、分类或难度，以免丢失原课件", 409);
        }
        expectedRevision = await claimCourseContentMutation(tx, {
          courseId: id,
          expectedPresentationRevision: prior.presentationRevision,
        });
        const llmLessons = await tx.lesson.findMany({
          where: { courseId: id, htmlJson: { not: null }, renderEngine: "llm" },
          select: { id: true, blocksJson: true, htmlJson: true },
        });
        for (const lesson of llmLessons) {
          await tx.lessonRevision.create({
            data: { lessonId: lesson.id, blocksJson: lesson.blocksJson, htmlJson: lesson.htmlJson, reason: "manual" },
          });
          const keep = await tx.lessonRevision.findMany({
            where: { lessonId: lesson.id },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true },
          });
          await tx.lessonRevision.deleteMany({
            where: { lessonId: lesson.id, id: { notIn: keep.map((revision) => revision.id) } },
          });
        }
        await tx.lesson.updateMany({
          where: { courseId: id },
          data: {
            htmlJson: null,
            renderEngine: null,
            renderSourceHash: null,
            renderRejectReason: null,
            renderDurationMs: null,
            htmlGenClaimedAt: null,
            designJson: null,
            qualityJson: null,
          },
        });
      }

      // 生命周期切换也是 mutation fence。特别是 archived→published：若不递增 revision，
      // 归档前读到 rev=N 的旧 PATCH/confirm 会在恢复后再次命中，形成 ABA 并复活死 lease。
      // 语义变更已由 claimCourseContentMutation 递增一次，不重复增加。
      const lifecycleStored = await tx.course.updateMany({
        where: { id, presentationRevision: expectedRevision },
        data: {
          ...data,
          ...(statusChanged && !semanticChanged ? { presentationRevision: { increment: 1 } } : {}),
        },
      });
      if (lifecycleStored.count !== 1) throw new AppError("课程状态已变更，请刷新后重试", 409);
      if (statusChanged) {
        // 任何生命周期切换（不只是 archived）都会 bump revision。供应商 HTTP 可能在 lease
        // 过期后仍返回，所以不能用过期时间猜测任务已停，更不能撤 owner 后让结算无法冲正。
        // Course 行已在本事务写入，这个检查与生命周期更新共用 SQLite 写序；命中即整事务回滚。
        const liveJobs = await tx.generationJob.count({
          where: {
            resultRef: id,
            status: "running",
          },
        });
        if (liveJobs > 0) {
          throw new AppError("课程正在生成或应用课件效果，请等任务收敛后再变更状态", 409);
        }
      }
      const updated = await tx.course.findUnique({ where: { id } });
      if (!updated) throw new AppError("课程不存在", 404);
      return updated;
    });
    await audit({ operatorId: admin.id, action: "course.update", targetType: "course", targetId: id, detail: JSON.stringify(data) });
    return ok(course);
  });
}
