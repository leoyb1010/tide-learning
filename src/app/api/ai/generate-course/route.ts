import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUniqueRequestAdmission, assertUserRateLimit } from "@/lib/rate-limit";
import { chatJson } from "@/lib/llm";
import { assertCanSpend } from "@/lib/credits";
import { requireCourseGenAccess } from "@/lib/ai-guard";
import { requireUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { slugify } from "@/lib/format";
import { initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { courseOutlinePrompt } from "@/lib/ai/prompts";
import { isValidTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";
import { parseBlueprint, serializeBlueprint, blueprintOutlineFragment, lessonRangeForLength } from "@/lib/ai/blueprint";
import { createCourseContentBrief, normalizeAssessmentNeed, serializeCourseContentBrief } from "@/lib/ai/content-brief";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";
import { sourcePolicyForFinalCourseOutline, sourcePolicyForTopic } from "@/lib/ai/source-policy";
import { runWithGenerationJobLeaseHeartbeat } from "@/lib/generation-job-lease";
import {
  completeCourseOutlineOperation,
  CourseOutlineReversalPendingError,
  courseOutlinePayloadHash,
  inspectCourseOutlineOperation,
  reconcileCourseOutlineOperationFailure,
  startCourseOutlineOperation,
  validateCourseOutlineRequestId,
  type CourseOutlineOperation,
  type CourseOutlineOperationResponse,
} from "@/lib/course-outline-operation";

export const dynamic = "force-dynamic";

interface OutlineItem {
  title: string;
  objective: string;
  assessmentNeed: "none" | "check" | "practice" | "transfer" | "adaptive";
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
 * POST /api/ai/generate-course —— AI 自习室 引擎A · Step0：一句话需求 → 课程大纲。
 *
 * 生成课程元信息 + 6-8 节大纲，落库为一门 private 的 ai_generated 课程（generating 态）
 * 与 N 个空 Lesson（blocksJson 待逐节生成）。返回 courseId/slug/lessons 供前端逐节触发。
 * 权益：需 canUseLLM。限流：每用户每天 5 门。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    // 先只做身份认证。已经提交的 durable requestId 必须能在免费额度耗尽、订阅失效或
    // 默认模型变化后继续回放；当前权益与模型选择只能约束一个真正的新造课意图。
    const authenticatedUser = await requireUser();

      const body = (await req.json().catch(() => null)) as {
        prompt?: string;
        category?: string;
        template?: string;
        model?: string;
        qualityTier?: string;
        /** 同一次用户造课意图的稳定幂等键，丢包/刷新后原样重用。 */
        requestId?: string;
        /** L2 可控造课：专业模式下先停在大纲检查点（outline_draft），由用户确认后再扇出逐节生成。 */
        checkpoint?: boolean;
        /** L1 课程蓝图（专业模式）：受众/口吻/篇幅/块偏好/参考资料，透传进大纲与逐节 prompt。 */
        blueprint?: unknown;
      } | null;
      // 专业模式大纲检查点：置真则大纲落库后停在 outline_draft，不自动扇出（等 /outline/confirm）。
      const checkpoint = body?.checkpoint === true;
      // L1 蓝图：白名单校验后落库 blueprintJson（逐节生成读它定制内容 + grounding）。
      const blueprint = parseBlueprint(body?.blueprint);
      const prompt = body?.prompt?.trim();
      if (!prompt) return fail("请描述你想学的内容");
      if (prompt.length < 4) return fail("需求太短，请多说几个字（至少 4 字）");
      if (prompt.length > 500) return fail("需求描述过长，请精简到 500 字以内");

      const category = body?.category?.trim() || "ai_skill";
      const provided = body?.template?.trim() || undefined;
      const template = provided ?? null;
      const requestedModel = body?.model?.trim();
      const qualityTier = body?.qualityTier === "premium" ? "premium" : "standard";
      const requestId = validateCourseOutlineRequestId(body?.requestId);
      const payloadHash = courseOutlinePayloadHash({
        prompt,
        category,
        template,
        // 哈希绑定用户的稳定意图，而不是受订阅/配置变化影响的当前模型解析结果。
        requestedModel: requestedModel ?? null,
        qualityTier,
        checkpoint,
        blueprint,
      });
      // done 回放不受当前限流/余额影响；只对真正的新意图消耗限流并创建 job。
      let priorOperation;
      try {
        priorOperation = await inspectCourseOutlineOperation({ userId: authenticatedUser.id, requestId, payloadHash });
      } catch (error) {
        if (error instanceof CourseOutlineReversalPendingError) {
          return courseOutlineRunning(error.message, error.status);
        }
        throw error;
      }
      if (priorOperation?.status === "replay") return ok(priorOperation.response);
      if (priorOperation?.status === "running") return courseOutlineRunning("同一次造课请求仍在进行，请稍后原样重试");
      if (priorOperation?.status === "failed") return fail("该 requestId 的造课已失败并收敛，请重新发起", 409);

      const sourcePolicy = sourcePolicyForTopic(prompt, category);
      if (sourcePolicy.requiresSource && !blueprint?.referenceText?.trim()) {
        return fail(`${sourcePolicy.reason}，请在专业模式的参考资料中提供可核查的一手或官方材料`, 422);
      }
      if (sourcePolicy.requiresAsOfDate && !sourcePolicy.asOfDate) {
        return fail("该主题包含最新/当前信息，请在需求中写明截至日期（例如：截至 2026-08-12）", 422);
      }

      // v3.2 课件模板：模板全员免费，非法 key 直接拒绝（不静默回落，避免脏数据落库）。
      if (provided && !isValidTemplate(provided)) return fail("未知的课件模板");

      // 业务 DB 之前的共享粗准入：同 requestId 只计一次且桶满仍放行，
      // 新 ID 超限则直接 429，不创建 GenerationJob / reversal 墓碑。
      assertUniqueRequestAdmission(authenticatedUser.id, "ai_gen_course", requestId, 30, 86_400_000);

      let startedOperation;
      try {
        // 准入后由 DB 原子 owner 定胜负。跨实例同时首查为空时，
        // 只有 acquired 的赢家会消费这些门；输家直接得到 running/replay，不重复占额度。
        startedOperation = await startCourseOutlineOperation({ userId: authenticatedUser.id, requestId, payloadHash });
      } catch (error) {
        if (error instanceof CourseOutlineReversalPendingError) {
          return courseOutlineRunning(error.message, error.status);
        }
        throw error;
      }
      if (startedOperation.status === "replay") return ok(startedOperation.response);
      if (startedOperation.status === "running") return courseOutlineRunning("同一次造课请求仍在进行，请稍后原样重试");
      if (startedOperation.status === "failed") return fail("该 requestId 的造课已失败并收敛，请重新发起", 409);
      let outlineOperation: CourseOutlineOperation | null = startedOperation.operation;
      let operationCompleted = false;
      let inflightAcquired = false;

      try {
      // 进程锁也是可变门：必须在 atomic start 之后，避免 late replay 被当前 busy 误拒。
      if (!acquireInflight("course_gen", authenticatedUser.id)) {
        throw new AppError("已有生成任务进行中，请稍后再试", 409, false);
      }
      inflightAcquired = true;
      // 只有 DB owner 才消费当前权益/免费额度、模型选择与限流。任一门失败都走下方
      // fenced failure/reversal 收敛，避免留下永久 running requestId。
      const { user, snapshot } = await requireCourseGenAccess({ precheckSpend: false });
      if (user.id !== authenticatedUser.id) throw new AppError("登录状态已变化，请重新发起", 401, false);
      const modelEntry = selectModelFor(requestedModel, snapshot.isSubscriber);
      if (!modelEntry) {
        throw new AppError(
          requestedModel ? "该模型为会员专享或暂不可用，请升级订阅或换用默认模型" : "AI 服务未配置",
          requestedModel ? 402 : 503,
          false,
        );
      }
      const modelKey = modelEntry.key;
      if (qualityTier === "premium" && !snapshot.isSubscriber) {
        throw new AppError("深度研究为会员专享，请升级订阅或使用完整生成", 402, false);
      }
      assertUserRateLimit(user.id, "ai_gen_course", 10, 86_400_000);

      // 积分预检（P1-3 修复）：按所选模型的真实计费权重设门槛（高级模型门槛更高），
      // 堵住「余额仅够基准模型 1 门却用高级模型发起满额造课」的超额免单缺口。
      // 逐节生成的整课扇出成本另由 runCourseGenBackground 内的「逐节预检」按累计预估兜住。
      await assertCanSpend(user.id, "generate_course", modelKey);

      // 内置 prompt 库：金牌架构师 + 分赛道吸引力包 + 起承转合 + 模板结构 + 合规底线。
      // 大纲同时产出整课检验地图，避免逐节导演机械塞 quiz/迁移。
      const lessonRange = blueprint?.length ? lessonRangeForLength(blueprint.length) : undefined;
      const { system, user: userMsg } = courseOutlinePrompt({ prompt, category, template: template ?? undefined, lessonRange });
      // L1 蓝图：受众/口吻/篇幅影响大纲规划，追加到 user 消息末尾。
      const userMsgWithBlueprint = userMsg + blueprintOutlineFragment(blueprint);

      const result = await runWithGenerationJobLeaseHeartbeat(outlineOperation.lease, () => chatJson<OutlineResult>({
        system,
        user: userMsgWithBlueprint,
        temperature: 0.5,
        maxTokens: 6000,
        model: modelKey,
        // 大纲是用户点击后同步等待的调用：不做超时重试，避免慢模型「60s×2=120s」的漫长转圈；
        // 单次 60s 仍失败即快速回错，前端明确提示而非久等。逐节生成（后台）仍保留默认重试。
        retries: 0,
        billing: {
          userId: user.id,
          scene: "generate_course",
          callKey: `course-outline:${outlineOperation!.lease.jobId}:f${outlineOperation!.lease.fencingToken}`,
          operationKey: outlineOperation.operationKey ?? outlineOperation.lease.jobId,
        },
      }));

      // —— 规范化 LLM 产出，兜底非法结构 ——
      const title = (result?.title || "").trim() || prompt.slice(0, 20);
      const subtitle = (result?.subtitle || "").trim() || null;
      const intro = (result?.intro || "").trim();
      const rawOutline = Array.isArray(result?.outline) ? result.outline : [];
      // 篇幅是范围而非固定配额；保留模型按主题复杂度少设或多设的决策。
      const outline = rawOutline
        .filter((o) => o && typeof o.title === "string" && o.title.trim())
        .map((o) => ({
          title: o.title.trim().slice(0, 120),
          objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
          assessmentNeed: normalizeAssessmentNeed(o.assessmentNeed),
        }))
        .slice(0, lessonRange?.max ?? 24);
      if (outline.length === 0) throw new AppError("大纲生成失败，请调整需求后重试", 502);

      // 模型可能把一个安全的原始需求扩写成“最新价格/用药建议/现行政策”。
      // 来源门必须覆盖模型的最终 title + 全量 objective，且在任何 Course/Lesson 落库之前执行。
      const finalSourcePolicy = sourcePolicyForFinalCourseOutline({
        courseTitle: title,
        originalRequest: prompt,
        lessons: outline.map((item) => ({ title: item.title, summary: item.objective })),
        category,
        sourceAvailable: Boolean(blueprint?.referenceText?.trim()),
        persistedSourceAsOf: sourcePolicy.asOfDate,
        trustedDateText: prompt,
        actualSourceText: blueprint?.referenceText ?? null,
      });
      if (finalSourcePolicy.missingSource) {
        throw new AppError(`${finalSourcePolicy.reason ?? "该课程最终大纲包含需核查事实"}，请在专业模式的参考资料中提供可核查的一手或官方材料`, 422, false);
      }
      if (finalSourcePolicy.missingAsOfDate) {
        throw new AppError("该课程最终大纲包含最新/当前信息，请明确写明截至日期（例如：截至 2026-08-12）", 422, false);
      }

      const contentBrief = createCourseContentBrief({
        request: prompt,
        plan: result?.plan,
        sourceBased: Boolean(blueprint?.referenceText?.trim()),
        topicType: finalSourcePolicy.topicType,
        sourceAsOf: finalSourcePolicy.effectiveAsOfDate,
        confirmedOutline: outline.map((item) => ({
          title: item.title, objective: item.objective, assessmentNeed: item.assessmentNeed,
        })),
      });

      // v5 专属视觉：本课设计 brief 不在此同步生成（避免给用户点「生成课程」再叠加一次 LLM 阻塞，
      // review #5）。designJson 先留空,由后台 runCourseGenBackground 的 ensureDesignBrief 在渲染前补齐
      // （失败降级固定皮肤;续造/重拟大纲后确认会再试/按新大纲刷新）。

      const slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 6);

      // —— 事务落库：Course + N 个空 Lesson + GenerationJob ——
      const created = await prisma.$transaction(async (tx) => {
        const course = await tx.course.create({
          data: {
            slug,
            title,
            subtitle,
            description: intro || null,
            category,
            level: "L1",
            status: "published",
            coverColor: "tide",
            origin: "ai_generated",
            authorUserId: user.id,
            ownerId: user.id,
            visibility: "private",
            // 检查点模式先停在 outline_draft（等用户确认），否则直接 generating 走后台扇出。
            genStatus: checkpoint ? "outline_draft" : "generating",
            blueprintJson: blueprint ? serializeBlueprint(blueprint) : null,
            contentBriefJson: serializeCourseContentBrief(contentBrief),
            // designJson 留空：由后台 ensureDesignBrief 生成本课专属 brief 后写入（v5，见上）。
            template,
            modelUsed: modelKey,
            qualityTier,
            disclaimer: "本课程由 AI 生成，内容仅供学习参考",
          },
        });

        // 逐节创建空课件（首节免费试学）
        await Promise.all(
          outline.map((o, i) =>
            tx.lesson.create({
              data: {
                courseId: course.id,
                title: o.title,
                summary: o.objective || null,
                sortOrder: i,
                contentType: "ai_block",
                blocksJson: null,
                isFree: i === 0,
                status: "published",
              },
            }),
          ),
        );

        // 重新按 sortOrder 取回，保证返回顺序稳定
        const lessons = await tx.lesson.findMany({
          where: { courseId: course.id },
          orderBy: { sortOrder: "asc" },
          // checkpoint 会把这份数据原样交给可编辑大纲；summary 是逐节学习目标，绝不能在回包时丢掉。
          select: { id: true, title: true, summary: true },
        });

        const response: CourseOutlineOperationResponse = {
          courseId: course.id,
          slug: course.slug,
          title: course.title,
          ...(checkpoint ? { checkpoint: true, genStatus: "outline_draft" } : {}),
          lessons,
        };
        await completeCourseOutlineOperation(tx, outlineOperation!, course.id, response);
        return { course, lessons, response };
      });
      operationCompleted = true;

      await track({
        eventName: "ai_gen_course",
        userId: user.id,
        properties: { courseId: created.course.id, category, lessons: created.lessons.length, qualityTier },
      }).catch(() => undefined);

      const courseId = created.course.id;
      const total = created.lessons.length;

      // —— L2 检查点模式：大纲已落库为 outline_draft，不建 job、不扇出，直接把大纲交给前端确认 ——
      // 用户在大纲检查点增删改排序后调 /outline/confirm 才真正开始逐节生成。
      if (checkpoint) {
        return ok(created.response);
      }

      // —— v3.0 服务端后台续跑：大纲已落库，逐节生成交给 after() 在响应返回后接管 ——
      // 建课级进度 job（course_gen，一课一条，记 total/done/failed/currentLessonId），
      // 再注册后台任务：关页面/刷新也不影响，前端凭 gen-progress 轮询恢复进度。
      const lease = await initGenJob(courseId, user.id, total, { prompt, category }).catch((error) => {
        // Course + replay snapshot 已原子提交，不能因为后续 worker 调度瞬时失败向客户端伪报失败，
        // 否则 UI 会清 requestId 并在下次点击新建重复课程。耐久 worker 会扫描 generating 课程恢复。
        console.error("[generate-course] course worker scheduling deferred:", error instanceof Error ? error.message : "unknown");
        return null;
      });
      if (lease) {
        after(async () => {
          // after() 内部绝不能抛：runCourseGenBackground 已全程 try/catch 自我兜底。
          await runCourseGenBackground(courseId, user.id, lease);
        });
      }

      // 响应立即返回大纲：前端剧场照常逐条展示，但真实生成已由服务端保障（断点续造）。
      return ok(created.response);
      } catch (error) {
        if (!operationCompleted && outlineOperation) {
          try {
            await reconcileCourseOutlineOperationFailure(
              outlineOperation,
              error instanceof Error ? error.message : "course outline generation failed",
            );
          } catch (settlementError) {
            // 供应商结果/账务终态仍不确定时绝不让 UI 丢 requestId，
            // 否则新 ID 会在旧操作收敛前再烧一次供应商。
            console.error("[generate-course] outline failure settlement deferred:", settlementError);
            return courseOutlineRunning("造课状态正在收敛，请稍后原样重试", 503);
          }
        }
        throw error;
      }
      finally {
        if (inflightAcquired) releaseInflight("course_gen", authenticatedUser.id);
      }
  });
}

function courseOutlineRunning(message: string, status = 409): NextResponse {
  return NextResponse.json({
    ok: false,
    error: message,
    data: {
      code: "COURSE_OUTLINE_RUNNING",
      preserveRequestId: true,
    },
  }, { status });
}
