import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { generateCourseOutline, slugifyCourse } from "@/lib/course-gen";
import { canTransitionDemand } from "@/lib/demand-status";

const VALID = ["pending_review", "collecting", "evaluating", "scheduled", "producing", "launched", "rejected"];

/**
 * 共创闭环：从 demand 的 title+description 生成一版 AI 预览课（引擎A）。
 * 只创建 unlisted 的 ai_generated 课程（generating 态）+ N 个空 Lesson，逐节由后续触发生成，
 * 不在此阻塞主流程（大纲生成本身是一次快速 LLM 调用，落库轻量）。
 * 返回 courseId 供官方回复附预览链接；生成失败返回 null（不影响状态推进）。
 */
async function generateDemandPreview(demand: { id: string; title: string; description: string | null }): Promise<string | null> {
  const prompt = `${demand.title}${demand.description ? "\n" + demand.description : ""}`;
  const outline = await generateCourseOutline(prompt);
  // 降级：大纲失败退回单章，保证预览课不空
  const chapters = outline.length ? outline : [{ title: demand.title.slice(0, 120), objective: demand.description?.slice(0, 300) || "" }];

  const slug = slugifyCourse(demand.title) + "-" + Math.random().toString(36).slice(2, 6);
  const course = await prisma.course.create({
    data: {
      slug,
      title: demand.title.slice(0, 120),
      description: demand.description?.slice(0, 500) || null,
      category: "ai_skill",
      level: "L1",
      status: "draft",
      coverColor: "tide",
      origin: "ai_generated",
      authorUserId: null, // 官方共创预览：无个人归属
      visibility: "unlisted",
      genStatus: "generating",
      sourceDemandId: demand.id,
      disclaimer: "本课程为需求共创的 AI 预览版，内容仅供评估参考",
    },
  });

  await Promise.all(
    chapters.map((c, i) =>
      prisma.lesson.create({
        data: {
          courseId: course.id,
          title: c.title,
          summary: c.objective || null,
          sortOrder: i,
          contentType: "ai_block",
          blocksJson: null,
          isFree: i === 0,
          status: "draft",
        },
      }),
    ),
  );

  return course.id;
}

// PATCH /api/admin/demands/:id/status — 变更状态 + 官方反馈（§6.6：未采纳必须填原因）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("demand:moderate");
    assertSameOrigin(req);
    const { id } = await params;
    const body = (await req.json()) as {
      status: string;
      officialReply?: string;
      reason?: string;
      launchedCourseId?: string;
      riskLevel?: string;
      generateAiPreview?: boolean; // 共创闭环：推进到 evaluating 时可选生成 AI 预览课
    };
    if (!VALID.includes(body.status)) return fail("非法状态");
    if (body.status === "rejected" && !body.reason?.trim()) return fail("未采纳必须填写原因");

    const demand = await prisma.demand.findUnique({ where: { id } });
    if (!demand) return fail("需求不存在", 404);
    if (!canTransitionDemand(demand.status, body.status)) {
      return fail(`不允许从 ${demand.status} 直接变更为 ${body.status}`, 409);
    }

    const launchedCourseId = body.launchedCourseId?.trim() || demand.launchedCourseId;
    let launchedCourse: { id: string; title: string } | null = null;
    if (body.status === "launched") {
      if (!launchedCourseId) return fail("上线需求必须关联已发布课程");
      launchedCourse = await prisma.course.findFirst({
        where: {
          id: launchedCourseId,
          status: "published",
          visibility: { in: ["public", "unlisted"] },
        },
        select: { id: true, title: true },
      });
      if (!launchedCourse) return fail("关联课程不存在、未发布或不可访问");
    }

    // —— 可选：共创闭环 · 生成 AI 预览课（仅在推进到 evaluating 时触发）——
    // 非阻塞主流程语义：预览生成失败只记日志、不回滚状态推进。
    let previewCourseId: string | null = null;
    if (body.generateAiPreview && body.status === "evaluating") {
      try {
        previewCourseId = await generateDemandPreview(demand);
      } catch (e) {
        console.error("[demand:gen-preview]", e instanceof Error ? e.message : e);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.demand.update({
        where: { id },
        data: {
          status: body.status,
          officialReply: body.officialReply ?? demand.officialReply,
          launchedCourseId: body.status === "launched" ? launchedCourseId : demand.launchedCourseId,
          riskLevel: body.riskLevel ?? demand.riskLevel,
        },
      });
      if (demand.status !== body.status) {
        await tx.demandStatusLog.create({
          data: {
            demandId: id,
            fromStatus: demand.status,
            toStatus: body.status,
            operatorId: admin.id,
            reason: body.reason ?? body.officialReply,
          },
        });
        const [voters, followers] = await Promise.all([
          tx.demandVote.findMany({ where: { demandId: id }, distinct: ["userId"], select: { userId: true } }),
          tx.demandFollow.findMany({ where: { demandId: id }, select: { userId: true } }),
        ]);
        const recipientIds = new Set([demand.userId, ...voters.map((v) => v.userId), ...followers.map((f) => f.userId)]);
        await tx.notification.createMany({
          data: [...recipientIds].map((userId) => ({
            userId,
            type: "demand_update",
            title: body.status === "launched" ? "你关注的需求已上线" : "你关注的需求有新进展",
            body: body.status === "launched" ? `《${launchedCourse!.title}》现已可以学习` : `${demand.title}：${body.status}`,
            refType: "demand",
            refId: id,
          })),
        });
      }
      return next;
    });
    await audit({ operatorId: admin.id, action: "demand.status", targetType: "demand", targetId: id, detail: `${demand.status}→${body.status}${previewCourseId ? ` (ai-preview:${previewCourseId})` : ""}` });
    if (previewCourseId) {
      await track({ eventName: "demand_ai_preview", userId: admin.id, properties: { demandId: id, courseId: previewCourseId } });
    }
    return ok({ ...updated, previewCourseId });
  });
}
