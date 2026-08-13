import { NextRequest, NextResponse } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUniqueRequestAdmission, assertUserRateLimit } from "@/lib/rate-limit";
import { requireCourseGenAccess } from "@/lib/ai-guard";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";
import { paragraphizePlainText } from "@/lib/note-structure";
import { structureImportedTextIntoCourse, MIN_IMPORT_TEXT, MAX_FILE_IMPORT_TEXT } from "@/lib/course-import";
import { isValidTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";
import { createPresentationCourse, createScormCourse } from "@/lib/import-faithful";
import { requireUser } from "@/lib/session";
import {
  importContentSha256,
  importPayloadHash,
  ImportReversalPendingError,
  inspectImportOperation,
  reconcileImportOperationFailure,
  startImportOperation,
  type ImportOperation,
} from "@/lib/import-operation";
import { ensureRequestId } from "@/lib/request-id";

// Node 运行时：pdf-parse / mammoth 依赖 Buffer 与 node 内建。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 100_000_000; // PPT/Keynote/SCORM 含媒体，上传硬上限 100MB
const MAX_TEXT_FILE_BYTES = 15_000_000;
const PARSE_TIMEOUT_MS = 20_000; // 抽取超时 20s，防畸形文件卡死

type FileKind = "pdf" | "docx" | "text" | "pptx" | "key" | "scorm";

// 前后端对齐的受支持扩展名与展示文案（前端 accept 也用同一集合）。
const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "docx",
  txt: "text",
  md: "text",
  markdown: "text",
  text: "text",
  pptx: "pptx",
  key: "key",
  scorm: "scorm",
  zip: "scorm",
};

/** pdf-parse 运行时加载（绕开打包器对模板字面量动态依赖的静态分析），与 import-pdf 同款。 */
type PdfParseFn = (buf: Buffer, opts?: { max?: number }) => Promise<{ numpages: number; text: string }>;
let cachedPdfParse: PdfParseFn | null = null;
function loadPdfParse(): PdfParseFn {
  if (cachedPdfParse) return cachedPdfParse;

  const nodeRequire = eval("require") as NodeRequire;
  cachedPdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js") as PdfParseFn;
  return cachedPdfParse;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new AppError("文件解析超时，请换一个文件重试", 422)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function extFromName(name: string | null): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function titleFromFilename(name: string | null): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.[^.]+$/, "").trim();
  return (noExt || "文件导入").slice(0, 120);
}

/** 按类型抽取纯文本；失败统一收敛为 422 文案，不泄露解析器细节。 */
async function extractText(kind: "pdf" | "docx" | "text", bytes: Buffer): Promise<string> {
  if (kind === "pdf") {
    const magic = bytes.subarray(0, 5).toString("latin1");
    if (!magic.startsWith("%PDF-")) throw new AppError("该文件不是有效的 PDF", 422);
    try {
      const parsed = await withTimeout(loadPdfParse()(bytes, { max: 0 }), PARSE_TIMEOUT_MS);
      return paragraphizePlainText(parsed.text ?? "");
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("无法从该 PDF 提取文本（可能是扫描件或加密文件）", 422);
    }
  }
  if (kind === "docx") {
    // docx 是 zip 容器，魔数 "PK"。旧 .doc（OLE，魔数 D0CF）mammoth 不支持，直接挡。
    const magic = bytes.subarray(0, 2).toString("latin1");
    if (magic !== "PK") throw new AppError("仅支持 .docx（新版 Word），旧版 .doc 请另存为 .docx", 422);
    try {
      const mammoth = await import("mammoth");
      const res = await withTimeout(mammoth.extractRawText({ buffer: bytes }), PARSE_TIMEOUT_MS);
      return paragraphizePlainText(res.value ?? "");
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("无法从该 Word 文档提取文本", 422);
    }
  }
  // text / markdown：直接 utf8 解码（保留原文换行结构）。
  return bytes.toString("utf8");
}

/**
 * POST /api/ai/import-file —— 文本文档结构化，或 PPTX/Keynote/SCORM 忠实导入。
 *
 * multipart/form-data：字段 file（必填）、title（可选）。抽取纯文本 → 复用
 * structureImportedTextIntoCourse 走与粘贴导入完全一致的切章 / 落库 / 后台生成流程。
 * 与 import-source 共用 in-flight 锁与 ai_import 限流，权益 spendScene=import_source。
 * 越权铁律：所有记录强制挂 user.id。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const ctype = req.headers.get("content-type") ?? "";
    if (!ctype.includes("multipart/form-data")) return fail("请以文件表单方式上传（multipart/form-data）");
    const form = await req.formData().catch(() => null);
    if (!form) return fail("表单解析失败");
    const file = form.get("file");
    if (!file || typeof file === "string") return fail("请选择要导入的文件");
    const blob = file as File;
    if (blob.size === 0) return fail("文件内容为空");
    if (blob.size > MAX_FILE_BYTES) return fail("文件过大（上限 100MB）", 413);

    const filename = "name" in blob && typeof blob.name === "string" ? blob.name : null;
    const kind = EXT_KIND[extFromName(filename)];
    if (!kind) return fail("暂不支持该格式，请上传 PDF / DOCX / TXT / Markdown / PPTX / Keynote / SCORM 文件");
    const textKind = kind === "pdf" || kind === "docx" || kind === "text";
    if (textKind && blob.size > MAX_TEXT_FILE_BYTES) return fail("文本文档过大（上限 15MB）", 413);

    const bytes = Buffer.from(await blob.arrayBuffer());
    const title = ((form.get("title") as string | null)?.trim() || titleFromFilename(filename)).slice(0, 120);
    const template = (form.get("template") as string | null)?.trim() || undefined;
    const requestedModel = (form.get("model") as string | null)?.trim();
    const qualityTier = (form.get("qualityTier") as string | null)?.trim() === "premium" ? "premium" : "standard";
    const checkpoint = form.get("checkpoint") === "true";
    if (textKind && !isValidTemplate(template)) return fail("未知的课件模板");
    const requestId = ensureRequestId(form.get("requestId"));
    const payloadHash = importPayloadHash(textKind ? {
      scope: "file",
      contentSha256: importContentSha256(bytes),
      kind,
      title,
      template: template ?? null,
      requestedModel: requestedModel ?? null,
      qualityTier,
      checkpoint,
    } : {
      scope: "file",
      contentSha256: importContentSha256(bytes),
      kind,
      title,
      fileName: filename ?? null,
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

    // 与粘贴导入共用每日 15 个唯一 requestId 的非业务 DB 准入桶。
    // 超限的新 ID 在 atomic start 前直接拒绝，不留 job/reversal 墓碑。
    assertUniqueRequestAdmission(user.id, "ai_import", requestId, 15, 86_400_000);

    // 跨实例竞争下，首查为空不代表本实例是 owner。先用 DB 原子 start 定胜负，
    // replay/running/failed 直接返回；只有 acquired 赢家才消耗权益、模型、进程锁与限流。
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
      const modelEntry = textKind ? selectModelFor(requestedModel, snapshot.isSubscriber) : null;
      if (textKind && !modelEntry) {
        throw new AppError(
          requestedModel ? "该模型为会员专享或暂不可用，请升级订阅或换用默认模型" : "AI 服务未配置",
          requestedModel ? 402 : 503,
          false,
        );
      }
      if (textKind && qualityTier === "premium" && !snapshot.isSubscriber) {
        throw new AppError("精修排版为会员专享，请升级订阅或使用标准排版", 402, false);
      }
      if (!acquireInflight("course_gen", user.id)) {
        throw new AppError("已有生成任务进行中，请稍后再试", 409, false);
      }
      inflightAcquired = true;
      assertUserRateLimit(user.id, "ai_import", 5, 86_400_000);

      let result;
      if (kind === "pptx" || kind === "key") {
        result = await createPresentationCourse({ userId: user.id, title, bytes, kind, operation });
      } else if (kind === "scorm") {
        result = await createScormCourse({
          userId: user.id,
          title,
          bytes,
          fileName: filename || `${title}.scorm`,
          operation,
        });
      } else {
        const rawText = (await extractText(kind, bytes)).trim();
        if (!rawText) throw new AppError("未能从文件中提取到可用文本（可能是纯图片扫描件）", 422);
        if (rawText.length < MIN_IMPORT_TEXT) throw new AppError(`文件文本过短，无法结构化成课程（至少 ${MIN_IMPORT_TEXT} 字）`, 400);
        if (rawText.length > MAX_FILE_IMPORT_TEXT) {
          throw new AppError(`文件提取文本超过 ${MAX_FILE_IMPORT_TEXT} 字，请拆分后导入；系统不会静默丢弃尾部内容`, 413);
        }
        result = await structureImportedTextIntoCourse({
          userId: user.id,
          operation,
          rawText,
          kind: `file_${kind}`,
          title,
          template,
          model: modelEntry!.key,
          qualityTier,
          checkpoint,
        });
      }
      completed = true;
      return ok(result);
    } catch (error) {
      if (!completed) {
        try {
          await reconcileImportOperationFailure(operation, error instanceof Error ? error.message : "file import failed");
        } catch (settlementError) {
          console.error("[import-file] failure settlement deferred:", settlementError);
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
