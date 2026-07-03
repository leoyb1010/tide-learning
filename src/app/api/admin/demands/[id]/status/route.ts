import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { track } from "@/lib/analytics";
import { ok, fail, handle } from "@/lib/api";
import { generateCourseOutline, slugifyCourse } from "@/lib/course-gen";

const VALID = ["pending_review", "collecting", "evaluating", "scheduled", "producing", "launched", "rejected", "merged"];

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

    const updated = await prisma.demand.update({
      where: { id },
      data: {
        status: body.status,
        officialReply: body.officialReply ?? demand.officialReply,
        // 预览课关联进 launchedCourseId（追溯共创产物），显式传入优先
        launchedCourseId: body.launchedCourseId ?? previewCourseId ?? demand.launchedCourseId,
        riskLevel: body.riskLevel ?? demand.riskLevel,
      },
    });
    await prisma.demandStatusLog.create({
      data: {
        demandId: id,
        fromStatus: demand.status,
        toStatus: body.status,
        operatorId: admin.id,
        reason: body.reason ?? body.officialReply,
      },
    });
    await audit({ operatorId: admin.id, action: "demand.status", targetType: "demand", targetId: id, detail: `${demand.status}→${body.status}${previewCourseId ? ` (ai-preview:${previewCourseId})` : ""}` });
    if (previewCourseId) {
      await track({ eventName: "demand_ai_preview", userId: admin.id, properties: { demandId: id, courseId: previewCourseId } });
    }
    return ok({ ...updated, previewCourseId });
  });
}
