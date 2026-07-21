import { NextRequest } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireCourseGenAccess } from "@/lib/ai-guard";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";
import { paragraphizePlainText } from "@/lib/note-structure";
import { structureImportedTextIntoCourse, MIN_IMPORT_TEXT, MAX_IMPORT_TEXT } from "@/lib/course-import";
import { isValidTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";
import { createPresentationCourse, createScormCourse } from "@/lib/import-faithful";

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
    const { user, snapshot } = await requireCourseGenAccess({
      deniedMessage: "AI 导入为订阅会员权益，订阅后即可使用",
      spendScene: "import_source",
    });

    if (!acquireInflight("course_gen", user.id)) {
      return fail("已有生成任务进行中，请稍后再试", 409);
    }
    try {
      // 文件解析成本较高，按用户日限 5 次（与粘贴导入共用同一配额）。
      assertUserRateLimit(user.id, "ai_import", 5, 86_400_000);

      const ctype = req.headers.get("content-type") ?? "";
      if (!ctype.includes("multipart/form-data")) {
        return fail("请以文件表单方式上传（multipart/form-data）");
      }
      const form = await req.formData().catch(() => null);
      if (!form) return fail("表单解析失败");
      const file = form.get("file");
      if (!file || typeof file === "string") return fail("请选择要导入的文件");
      const blob = file as File;
      if (blob.size === 0) return fail("文件内容为空");
      if (blob.size > MAX_FILE_BYTES) return fail("文件过大（上限 100MB）", 413);

      const filename = "name" in blob && typeof blob.name === "string" ? blob.name : null;
      const ext = extFromName(filename);
      const kind = EXT_KIND[ext];
      if (!kind) {
        return fail("暂不支持该格式，请上传 PDF / DOCX / TXT / Markdown / PPTX / Keynote / SCORM 文件");
      }
      if (["pdf", "docx", "text"].includes(kind) && blob.size > MAX_TEXT_FILE_BYTES) return fail("文本文档过大（上限 15MB）", 413);

      const bytes = Buffer.from(await blob.arrayBuffer());
      const title = (form.get("title") as string | null)?.trim() || titleFromFilename(filename);

      // 演示文稿与 SCORM 不走“抽文本重写”：保留原页面坐标/图片或原包运行时，直接产出 ready 课程。
      if (kind === "pptx" || kind === "key") {
        return ok(await createPresentationCourse({ userId: user.id, title, bytes, kind }));
      }
      if (kind === "scorm") {
        return ok(await createScormCourse({ userId: user.id, title, bytes, fileName: filename || `${title}.scorm` }));
      }

      let rawText = (await extractText(kind, bytes)).trim();

      if (!rawText) return fail("未能从文件中提取到可用文本（可能是纯图片扫描件）", 422);
      if (rawText.length < MIN_IMPORT_TEXT) {
        return fail(`文件文本过短，无法结构化成课程（至少 ${MIN_IMPORT_TEXT} 字）`);
      }
      // 过长直接截断（与粘贴导入口径一致，避免超长 payload 撑爆切章）。
      if (rawText.length > MAX_IMPORT_TEXT) {
        rawText = rawText.slice(0, MAX_IMPORT_TEXT);
      }

      // v3.2 模板/模型（multipart 字段）：模板全员免费，非法即拒；模型须在可用集内。
      const template = (form.get("template") as string | null)?.trim() || undefined;
      if (!isValidTemplate(template)) return fail("未知的课件模板");
      const requestedModel = (form.get("model") as string | null)?.trim();
      const modelEntry = selectModelFor(requestedModel, snapshot.isSubscriber);
      if (!modelEntry) {
        return requestedModel
          ? fail("该模型为会员专享或暂不可用，请升级订阅或换用默认模型", 402)
          : fail("AI 服务未配置", 503);
      }

      const qualityTierRaw = (form.get("qualityTier") as string | null)?.trim();
      const qualityTier = qualityTierRaw === "premium" ? "premium" : "standard";
      if (qualityTier === "premium" && !snapshot.isSubscriber) {
        return fail("精修排版为会员专享，请升级订阅或使用标准排版", 402);
      }

      const result = await structureImportedTextIntoCourse({
        userId: user.id,
        rawText,
        kind: `file_${kind}`,
        title,
        template,
        model: modelEntry.key,
        qualityTier,
        checkpoint: form.get("checkpoint") === "true",
      });

      return ok(result);
    } finally {
      releaseInflight("course_gen", user.id);
    }
  });
}
