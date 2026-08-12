import { NextRequest, NextResponse } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUniqueRequestAdmission, assertUserRateLimit } from "@/lib/rate-limit";
import { requireCourseGenAccess } from "@/lib/ai-guard";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";
import { structureImportedTextIntoCourse, MIN_IMPORT_TEXT, MAX_IMPORT_TEXT } from "@/lib/course-import";
import { isValidTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";
import { requireUser } from "@/lib/session";
import {
  importContentSha256,
  importPayloadHash,
  ImportReversalPendingError,
  inspectImportOperation,
  reconcileImportOperationFailure,
  startImportOperation,
  validateImportRequestId,
  type ImportOperation,
} from "@/lib/import-operation";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/import-source —— 引擎B · 粘贴文本导入。
 *
 * kind=paste_text：把用户粘贴的原文切成主题章节大纲，落库为一门 private 的 user_imported 课程
 * （generating 态）与 N 个空 Lesson，随后后台逐节生成。核心切章 / 落库 / 后台续跑逻辑收敛到
 * structureImportedTextIntoCourse（与文件导入 /api/ai/import-file 共用）。
 * 越权铁律：所有记录强制挂 user.id。权益：需 canUseLLM。限流：每用户每天 5 次。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as {
        title?: string;
        rawText?: string;
        template?: string;
        model?: string;
        qualityTier?: string;
        checkpoint?: boolean;
        requestId?: string;
      } | null;

      const rawText = body?.rawText?.trim();
      if (!rawText) return fail("请粘贴要导入的文本内容");
      if (rawText.length < MIN_IMPORT_TEXT) return fail(`文本过短，无法结构化成课程（至少 ${MIN_IMPORT_TEXT} 字）`);
      if (rawText.length > MAX_IMPORT_TEXT) return fail(`文本过长，请精简到 ${MAX_IMPORT_TEXT} 字以内`);

      // v3.2 模板全员免费，非法即拒；模型须在用户可用集内，否则 402。
      const template = body?.template?.trim() || undefined;
      if (!isValidTemplate(template)) return fail("未知的课件模板");
      const requestedModel = body?.model?.trim();
      const qualityTier = body?.qualityTier === "premium" ? "premium" : "standard";
      const checkpoint = body?.checkpoint === true;
      const title = body?.title?.trim().slice(0, 120) || undefined;
      const requestId = validateImportRequestId(body?.requestId);
      const payloadHash = importPayloadHash({
        scope: "paste",
        contentSha256: importContentSha256(rawText),
        title: title ?? null,
        template: template ?? null,
        requestedModel: requestedModel ?? null,
        qualityTier,
        checkpoint,
      });

      let prior;
      try {
        prior = await inspectImportOperation({ userId: user.id, requestId, payloadHash });
      } catch (error) {
        if (error instanceof ImportReversalPendingError) return importRunning(error.message, error.status);
        throw error;
      }
      if (prior?.status === "replay") return ok(prior.response);
      if (prior?.status === "running") return importRunning("同一次导入仍在进行，请稍后原样重试");
      if (prior?.status === "failed") return fail("该 requestId 的导入已失败并收敛，请重新发起", 409);

      // 粘贴与文件导入共用每日 15 个唯一 requestId 的非业务 DB 准入桶。
      // 超限的新 ID 在 atomic start 前直接拒绝，同 ID 则始终能继续幂等判定。
      assertUniqueRequestAdmission(user.id, "ai_import", requestId, 15, 86_400_000);

      // 首查与创建之间仍可能有另一实例抢先提交：DB 原子 owner 必须早于
      // 权益/余额、模型、进程锁和限流门。只有 acquired 赢家会消耗这些可变门。
      let started;
      try {
        started = await startImportOperation({ userId: user.id, requestId, payloadHash });
      } catch (error) {
        if (error instanceof ImportReversalPendingError) return importRunning(error.message, error.status);
        throw error;
      }
      if (started.status === "replay") return ok(started.response);
      if (started.status === "running") return importRunning("同一次导入仍在进行，请稍后原样重试");
      if (started.status === "failed") return fail("该 requestId 的导入已失败并收敛，请重新发起", 409);

      const operation: ImportOperation = started.operation;
      let completed = false;
      let inflightAcquired = false;
      try {
        const access = await requireCourseGenAccess({
          deniedMessage: "AI 导入为订阅会员权益，订阅后即可使用",
          spendScene: "import_source",
        });
        if (access.user.id !== user.id) throw new AppError("登录状态已变化，请重新发起", 401, false);
        const snapshot = access.snapshot;
        const modelEntry = selectModelFor(requestedModel, snapshot.isSubscriber);
        if (!modelEntry) {
          throw new AppError(
            requestedModel ? "该模型为会员专享或暂不可用，请升级订阅或换用默认模型" : "AI 服务未配置",
            requestedModel ? 402 : 503,
            false,
          );
        }
        if (qualityTier === "premium" && !snapshot.isSubscriber) {
          throw new AppError("精修排版为会员专享，请升级订阅或使用标准排版", 402, false);
        }
        if (!acquireInflight("course_gen", user.id)) {
          throw new AppError("已有生成任务进行中，请稍后再试", 409, false);
        }
        inflightAcquired = true;
        assertUserRateLimit(user.id, "ai_import", 5, 86_400_000);
        const result = await structureImportedTextIntoCourse({
          userId: user.id,
          operation,
          rawText,
          kind: "paste_text",
          title,
          template,
          model: modelEntry.key,
          qualityTier,
          checkpoint,
        });
        completed = true;
        return ok(result);
      } catch (error) {
        if (!completed) {
          try {
            await reconcileImportOperationFailure(operation, error instanceof Error ? error.message : "import failed");
          } catch (settlementError) {
            console.error("[import-source] failure settlement deferred:", settlementError);
            return importRunning("导入状态正在收敛，请稍后原样重试", 503);
          }
        }
        throw error;
      } finally {
        if (inflightAcquired) releaseInflight("course_gen", user.id);
      }
  });
}

function importRunning(message: string, status = 409): NextResponse {
  return NextResponse.json({
    ok: false,
    error: message,
    data: { code: "IMPORT_RUNNING", preserveRequestId: true },
  }, { status });
}
