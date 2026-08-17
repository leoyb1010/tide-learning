import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend, reverseCreditOperation } from "@/lib/credits";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { chatJson } from "@/lib/llm";
import { courseOutlinePrompt } from "@/lib/ai/prompts";
import { interactiveLlmTimeoutMs, resolveModel } from "@/lib/ai/models";
import { blueprintOutlineFragment, lessonRangeForLength, untrustedOutlineReferenceFragment } from "@/lib/ai/blueprint";
import {
  createCourseContentBrief,
  normalizeAssessmentNeed,
  serializeCourseContentBrief,
  type AssessmentNeed,
} from "@/lib/ai/content-brief";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";
import { sourcePolicyForFinalCourseOutline } from "@/lib/ai/source-policy";
import { resolveCourseSourceTruth } from "@/lib/ai/course-source-truth";
import {
  acquireGenerationJobLease,
  finishGenerationJobLease,
  runWithGenerationJobLeaseHeartbeat,
} from "@/lib/generation-job-lease";

export const dynamic = "force-dynamic";

interface OutlineItem {
  title: string;
  objective: string;
  assessmentNeed?: AssessmentNeed;
}
interface OutlineResult {
  title: string;
  subtitle: string;
  intro: string;
  plan?: {
    learnerOutcome?: unknown;
    scope?: unknown;
    prerequisites?: unknown;
    capstone?: unknown;
    exclusions?: unknown;
    planningRationale?: unknown;
  };
  outline: OutlineItem[];
}

/**
 * POST /api/courses/:id/outline/regenerate —— L2 可控造课：重新生成大纲（有偿，重跑大纲 LLM）。
 *
 * 语义：对 outline_draft 的课，优先用 contentBrief 中的原始需求重跑一次大纲 LLM，
 * 旧 course_outline job.inputJson 只做显式的非可信兼容回退；导入课同时注入实际 ImportedSource 原文。
 * 整体替换现有空节（此态下所有节 blocksJson=null，属全量替换）。genStatus 仍留 outline_draft，等确认。
 * 计费：与首次造课大纲完全一致——前置 assertCanSpend + ChatOptions.billing 硬预占/按实耗结算。
 * 防刷：复用与首次造课相同的 acquireInflight('course_gen') + 每天 5 门限流，堵重复重生成的重复扣费。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId + genStatus==='outline_draft'。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    // 独立作用域（2026-07-20 修复）：重拟大纲按真实 token 计费,不该吃掉当天的造课名额。
    assertUserRateLimit(user.id, "ai_outline_regen", 15, 86_400_000);
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    if (!acquireInflight("course_gen", user.id)) {
      return fail("已有生成任务进行中，请稍后再试", 409);
    }
    try {
      const course = await prisma.course.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          authorUserId: true,
          status: true,
          genStatus: true,
          presentationRevision: true,
          category: true,
          origin: true,
          template: true,
          modelUsed: true,
          blueprintJson: true,
          contentBriefJson: true,
          lessons: {
            orderBy: { sortOrder: "asc" },
            select: { title: true, summary: true },
          },
        },
      });
      if (!course) return fail("课程不存在", 404);
      if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
      if (course.status === "archived") return fail("已归档课程不能重新生成大纲", 409);
      if (course.genStatus !== "outline_draft") {
        return fail("仅未开始生成的大纲草稿可重新生成", 409);
      }

      // 新课的正式原始需求在 contentBrief；旧 job.prompt 只能用来尽量恢复意图，
      // 其来源无法再证，因此绝不能为“截至日期”提权。
      const sourceTruth = await resolveCourseSourceTruth(course);
      if (sourceTruth.requiresActualSource && !sourceTruth.hasActualSource) {
        throw new AppError("导入课程的原始资料已丢失或未解析完成，无法重新生成大纲", 422, false);
      }
      const priorBrief = sourceTruth.contentBrief;
      let basePrompt = priorBrief?.request?.trim() ?? "";
      let requestProvenance: "user" | "legacy_job" | "course_title" = priorBrief?.requestProvenance ?? "user";
      if (!basePrompt) {
        const outlineJob = await prisma.generationJob.findFirst({
          where: { userId: user.id, type: "course_outline", resultRef: course.id },
          orderBy: { createdAt: "desc" },
          select: { inputJson: true },
        });
        try {
          const parsed = JSON.parse(outlineJob?.inputJson || "{}") as { prompt?: string };
          if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
            basePrompt = parsed.prompt.trim();
            requestProvenance = "legacy_job";
          }
        } catch {
          /* 脏的历史 inputJson → 继续回退 */
        }
      }
      if (!basePrompt) {
        basePrompt = course.title.trim();
        requestProvenance = "course_title";
      }
      if (!basePrompt) throw new AppError("缺少原始需求，无法重新生成大纲", 400);

      const trustedRequestText = requestProvenance === "user" ? basePrompt : null;
      const preflightSourceGate = sourcePolicyForFinalCourseOutline({
        courseTitle: course.title,
        originalRequest: basePrompt,
        lessons: course.lessons,
        category: course.category,
        sourceAvailable: sourceTruth.hasActualSource,
        persistedSourceAsOf: sourceTruth.trustedSourceAsOf,
        trustedDateText: trustedRequestText,
        actualSourceText: sourceTruth.actualSourceText,
      });
      if (preflightSourceGate.missingSource) {
        throw new AppError(`${preflightSourceGate.reason ?? "该主题需要外部真值"}，请先提供可核查的一手或官方参考资料`, 422, false);
      }
      if (preflightSourceGate.missingAsOfDate) {
        throw new AppError("该主题包含最新/当前信息，请先在原始需求或实际资料中补充截至日期", 422, false);
      }

      const category = course.category || "ai_skill";
      const blueprint = sourceTruth.blueprint;
      const lessonRange = blueprint?.length ? lessonRangeForLength(blueprint.length) : undefined;

      // 用持久租约而不是单进程 Map 保护付费重拟。同课串行；上一次 done/failed
      // 可由下一次用户明确点击重开，每次 fencingToken 不同，计费键也不会串单。
      const lease = await acquireGenerationJobLease({
        userId: user.id,
        type: "outline_regen",
        businessKey: course.id,
        resultRef: course.id,
        allowCompletedReopen: true,
        inputJson: JSON.stringify({
          version: 1,
          state: "claimed",
          presentationRevision: course.presentationRevision,
        }),
      });
      if (!lease) return fail("该课程已有大纲重拟任务在运行", 409);

      // 本 fencing epoch 的稳定账务键。不能用裸 jobId：outline_regen 任务行按课程复用
      // （businessKey=courseId，done/failed 后 reopen 只换 fencingToken），冲正墓碑按
      // operationKey 永久拒绝后续预占，裸 jobId 会把下一次合法重试也堵死。
      const billingOperationKey = `${lease.jobId}:f${lease.fencingToken}`;
      let leaseFinished = false;
      try {
        // 租约落库后再做一次事务快照门。confirm 会先建 course_gen lease；
        // 这里看到它就在付费 LLM 前终止。反向时 confirm/PATCH 会看到本 lease。
        await prisma.$transaction(async (tx) => {
          const snapshotClaim = await tx.course.updateMany({
            where: {
              id: course.id,
              authorUserId: user.id,
              status: { not: "archived" },
              genStatus: "outline_draft",
              presentationRevision: course.presentationRevision,
            },
            data: { presentationRevision: { increment: 0 } },
          });
          if (snapshotClaim.count !== 1) throw new AppError("课程大纲状态已变更，请刷新后重试", 409);
          const ownsLease = await tx.generationJob.count({
            where: {
              id: lease.jobId,
              type: "outline_regen",
              resultRef: course.id,
              userId: user.id,
              status: "running",
              fencingToken: lease.fencingToken,
              leaseUntil: { gt: new Date() },
            },
          });
          const activeCourseGeneration = await tx.generationJob.count({
            where: {
              type: "course_gen",
              resultRef: course.id,
              status: "running",
              leaseUntil: { gt: new Date() },
            },
          });
          if (ownsLease !== 1 || activeCourseGeneration > 0) {
            throw new AppError("课程已开始生成或任务所有权已变更", 409);
          }
        });

        await assertCanSpend(user.id, "generate_course", course.modelUsed ?? undefined);

      const { system, user: userMsg } = courseOutlinePrompt({
        prompt: basePrompt,
        category,
        template: course.template ?? undefined,
        lessonRange,
      });
      const blueprintWithoutReference = blueprint ? { ...blueprint, referenceText: undefined } : null;
      const sourceReferenceFragment = untrustedOutlineReferenceFragment(sourceTruth.outlineReferenceText, 50_000);
      const outlineModel = resolveModel(course.modelUsed);
      const result = await runWithGenerationJobLeaseHeartbeat(lease, () => chatJson<OutlineResult>({
          system,
          user: userMsg + blueprintOutlineFragment(blueprintWithoutReference) + (sourceReferenceFragment ? `\n${sourceReferenceFragment}\n` : ""),
          temperature: 0.5,
          maxTokens: 3500,
          model: course.modelUsed ?? undefined,
          reasoningEffort: outlineModel.interactiveReasoningEffort,
          timeoutMs: interactiveLlmTimeoutMs(outlineModel),
          retries: 0,
          billing: {
            userId: user.id,
            scene: "generate_course",
            callKey: `outline-regenerate:${lease.jobId}:f${lease.fencingToken}`,
            operationKey: billingOperationKey,
          },
        }));

      const rawOutline = Array.isArray(result?.outline) ? result.outline : [];
      const outline = rawOutline
        .filter((o) => o && typeof o.title === "string" && o.title.trim())
        .map((o) => ({
          title: o.title.trim().slice(0, 120),
          objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
          assessmentNeed: normalizeAssessmentNeed(o.assessmentNeed),
        }))
        .slice(0, lessonRange?.max ?? 24);
      if (outline.length === 0) throw new AppError("大纲生成失败，请调整需求后重试", 502);

      const finalCourseTitle = typeof result?.title === "string" && result.title.trim()
        ? result.title.trim().slice(0, 120)
        : course.title;
      const sourceGate = sourcePolicyForFinalCourseOutline({
        courseTitle: finalCourseTitle,
        originalRequest: basePrompt,
        lessons: outline.map((item) => ({ title: item.title, summary: item.objective || null })),
        category: course.category,
        sourceAvailable: sourceTruth.hasActualSource,
        persistedSourceAsOf: sourceTruth.trustedSourceAsOf,
        trustedDateText: trustedRequestText,
        actualSourceText: sourceTruth.actualSourceText,
      });
      if (sourceGate.missingSource) {
        throw new AppError(`${sourceGate.reason ?? "该主题需要外部真值"}，请先提供可核查的一手或官方参考资料`, 422);
      }
      if (sourceGate.missingAsOfDate) {
        throw new AppError("该主题包含最新/当前信息，请先在原始需求或资料中补充截至日期", 422);
      }

      // 全量替换：删掉现有空节（outline_draft 态全部 blocksJson=null），按新大纲重建。
      await prisma.$transaction(async (tx) => {
        // 课级 CAS 是本事务第一个写。归档/confirm/免费 PATCH 只要有一个先发生，
        // 本次付费结果就整笔回滚，不得删掉新课节或复活 archived 课。
        const storedCourse = await tx.course.updateMany({
          where: {
            id: course.id,
            authorUserId: user.id,
            status: { not: "archived" },
            genStatus: "outline_draft",
            presentationRevision: course.presentationRevision,
          },
          data: {
            presentationRevision: { increment: 1 },
            generationQualityJson: null,
            title: finalCourseTitle,
            ...(typeof result?.subtitle === "string" ? { subtitle: result.subtitle.trim().slice(0, 200) || null } : {}),
            ...(typeof result?.intro === "string" ? { description: result.intro.trim().slice(0, 2000) || null } : {}),
            contentBriefJson: serializeCourseContentBrief(createCourseContentBrief({
              request: basePrompt,
              requestProvenance: requestProvenance === "user" ? undefined : requestProvenance,
              plan: result?.plan,
              sourceBased: sourceTruth.hasActualSource,
              sourceAsOf: sourceGate.effectiveAsOfDate,
              topicType: priorBrief?.topicType,
              confirmedOutline: outline.map((item) => ({
                title: item.title,
                objective: item.objective,
                assessmentNeed: item.assessmentNeed,
              })),
            })),
          },
        });
        if (storedCourse.count !== 1) throw new AppError("课程大纲状态已变更，本次结果未写入", 409);
        const ownsLease = await tx.generationJob.count({
          where: {
            id: lease.jobId,
            type: "outline_regen",
            resultRef: course.id,
            userId: user.id,
            status: "running",
            fencingToken: lease.fencingToken,
            leaseUntil: { gt: new Date() },
          },
        });
        const activeCourseGeneration = await tx.generationJob.count({
          where: {
            type: "course_gen",
            resultRef: course.id,
            status: "running",
            leaseUntil: { gt: new Date() },
          },
        });
        if (ownsLease !== 1 || activeCourseGeneration > 0) {
          throw new AppError("课程已开始生成或任务所有权已变更", 409);
        }
        await tx.lesson.deleteMany({ where: { courseId: course.id } });
        for (let i = 0; i < outline.length; i++) {
          await tx.lesson.create({
            data: {
              courseId: course.id,
              title: outline[i].title,
              summary: outline[i].objective || null,
              sortOrder: i,
              contentType: "ai_block",
              blocksJson: null,
              isFree: i === 0,
              status: "published",
            },
          });
        }
        const finishedAt = new Date();
        const finished = await tx.generationJob.updateMany({
          where: {
            id: lease.jobId,
            userId: user.id,
            type: "outline_regen",
            resultRef: course.id,
            status: "running",
            fencingToken: lease.fencingToken,
            leaseUntil: { gt: finishedAt },
          },
          data: {
            status: "done",
            leaseUntil: null,
            heartbeatAt: finishedAt,
            finishedAt,
            errorMessage: null,
            inputJson: JSON.stringify({
              version: 1,
              state: "done",
              presentationRevision: course.presentationRevision + 1,
              lessonCount: outline.length,
            }),
          },
        });
        if (finished.count !== 1) throw new AppError("大纲重拟任务所有权已丢失", 409);
      });
      leaseFinished = true;

      const saved = await prisma.lesson.findMany({
        where: { courseId: course.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, summary: true },
      });
      return ok({ regenerated: true, lessons: saved });
      } catch (error) {
        if (!leaseFinished) {
          // 收敛顺序与 course-outline-operation 一致：先持久化冲正墓碑（覆盖 settle 成功后
          // CAS/内容门失败留下的已扣费），再 fenced finish failed。冲正本身失败时绝不冻结成
          // failed——只把本 token 的租约立即过期，保持 running 供下次重试接管。
          try {
            await reverseCreditOperation({
              operationKey: billingOperationKey,
              userId: user.id,
              scene: "generate_course",
              reason: "大纲重拟未完整交付",
            });
          } catch (reversalError) {
            console.error("[outline-regenerate] billing reversal deferred:", reversalError);
            const now = new Date();
            await prisma.generationJob.updateMany({
              where: {
                id: lease.jobId,
                userId: user.id,
                type: "outline_regen",
                status: "running",
                fencingToken: lease.fencingToken,
              },
              data: { leaseUntil: now, heartbeatAt: now, errorMessage: "billing reversal pending" },
            }).catch(() => undefined);
            throw error;
          }
          await finishGenerationJobLease({
            jobId: lease.jobId,
            fencingToken: lease.fencingToken,
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "outline regeneration failed",
          }).catch(() => false);
        }
        throw error;
      }
    } finally {
      releaseInflight("course_gen", user.id);
    }
  });
}
