import { NextRequest } from "next/server";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireLLMAccess } from "@/lib/ai-guard";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";
import { structureImportedTextIntoCourse, MIN_IMPORT_TEXT, MAX_IMPORT_TEXT } from "@/lib/course-import";
import { isValidTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";

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
    // 导入切章为高成本生成（import_source 权重 1.0）：预检按该场景最坏成本设门槛，
    // 与造课对齐，堵住负余额/欠账继续导入。逐节生成扣费在 generateLessonCore 按真实 token 记。
    const { user, snapshot } = await requireLLMAccess({
      deniedMessage: "AI 导入为订阅会员权益，订阅后即可使用",
      spendScene: "import_source",
    });

    // 端点级幂等（P2）：同一用户已有未完成的导入请求（进程内 in-flight 锁，与文件导入共用同一 key）
    // 直接拒绝，防双击/重放并发建两门课、双份切章扣费。finally 释放。
    if (!acquireInflight("import_source", user.id)) {
      return fail("已有生成任务进行中，请稍后再试", 409);
    }
    try {
      assertUserRateLimit(user.id, "ai_import", 5, 86_400_000);

      const body = (await req.json().catch(() => null)) as {
        title?: string;
        rawText?: string;
        template?: string;
        model?: string;
      } | null;

      const rawText = body?.rawText?.trim();
      if (!rawText) return fail("请粘贴要导入的文本内容");
      if (rawText.length < MIN_IMPORT_TEXT) return fail(`文本过短，无法结构化成课程（至少 ${MIN_IMPORT_TEXT} 字）`);
      if (rawText.length > MAX_IMPORT_TEXT) return fail(`文本过长，请精简到 ${MAX_IMPORT_TEXT} 字以内`);

      // v3.2 模板全员免费，非法即拒；模型须在用户可用集内，否则 402。
      const template = body?.template?.trim() || undefined;
      if (!isValidTemplate(template)) return fail("未知的课件模板");
      const requestedModel = body?.model?.trim();
      const modelEntry = selectModelFor(requestedModel, snapshot.isSubscriber);
      if (!modelEntry) {
        return requestedModel
          ? fail("该模型为会员专享或暂不可用，请升级订阅或换用默认模型", 402)
          : fail("AI 服务未配置", 503);
      }

      const result = await structureImportedTextIntoCourse({
        userId: user.id,
        rawText,
        kind: "paste_text",
        title: body?.title,
        template,
        model: modelEntry.key,
      });

      return ok(result);
    } finally {
      releaseInflight("import_source", user.id);
    }
  });
}
