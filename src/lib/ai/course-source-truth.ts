import { prisma } from "@/lib/db";
import { readBlueprint, type Blueprint } from "@/lib/ai/blueprint";
import { readCourseContentBrief, type CourseContentBrief } from "@/lib/ai/content-brief";
import { selectImportOutlineSourceText } from "@/lib/ai/prompts";
import { trustedSourceAsOfDate } from "@/lib/ai/source-policy";

interface CourseSourceIdentity {
  id: string;
  authorUserId: string | null;
  origin: string;
  blueprintJson: string | null;
  contentBriefJson: string | null;
}

// 与文件导入硬上限一致；即使遇到旧库异常超大值，也不让单次生成无界占用内存。
export const MAX_COURSE_SOURCE_TRUTH_CHARS = 500_000;

export interface CourseSourceTruth {
  blueprint: Blueprint | null;
  contentBrief: CourseContentBrief | null;
  /** 数据库中本次真正能取到的来源原文，而不是 sourceBased 历史布尔标记。 */
  actualSourceText: string;
  /** 大纲 prompt 使用的覆盖式取样；原文仍完整留在 ImportedSource。 */
  outlineReferenceText: string;
  /** 只来自已持久日期或实际来源文本。 */
  trustedSourceAsOf: string | null;
  hasActualSource: boolean;
  /** 导入课或已声明 sourceBased 的课不得在原文丢失后改用模型常识生成。 */
  requiresActualSource: boolean;
}

/**
 * 课程来源真值的唯一解析器。
 *
 * - 蓝图 referenceText 是实际保存的用户参考资料。
 * - 导入课必须用 courseId + owner + parsed 状态反查 ImportedSource.rawText。
 * - contentBrief.sourceBased 只是行为约束，绝不能单独证明来源还存在。
 */
export async function resolveCourseSourceTruth(course: CourseSourceIdentity): Promise<CourseSourceTruth> {
  const blueprint = readBlueprint(course.blueprintJson);
  const contentBrief = readCourseContentBrief(course.contentBriefJson);
  const sources: string[] = [];
  if (blueprint?.referenceText?.trim()) sources.push(blueprint.referenceText.trim());

  if (course.origin === "user_imported" && course.authorUserId) {
    const imported = await prisma.importedSource.findFirst({
      where: {
        generatedCourseId: course.id,
        userId: course.authorUserId,
        parseStatus: "parsed",
        rawText: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { rawText: true },
    });
    if (imported?.rawText?.trim()) {
      sources.push(imported.rawText.trim().slice(0, MAX_COURSE_SOURCE_TRUTH_CHARS));
    }
  }

  const actualSourceText = sources.join("\n\n");
  return {
    blueprint,
    contentBrief,
    actualSourceText,
    outlineReferenceText: selectImportOutlineSourceText(actualSourceText),
    trustedSourceAsOf: trustedSourceAsOfDate(contentBrief?.sourceAsOf, actualSourceText),
    hasActualSource: Boolean(actualSourceText),
    requiresActualSource: course.origin === "user_imported" || contentBrief?.sourceBased === true,
  };
}
