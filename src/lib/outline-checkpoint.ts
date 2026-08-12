export interface CheckpointLesson {
  id?: string;
  title: string;
  summary?: string | null;
}

/** 检查点全量保存的单一序列化入口；确保“未编辑直接确认”不会丢掉逐节目标。 */
export function checkpointPatchLessons(lessons: CheckpointLesson[]) {
  const seen = new Set<string>();
  return lessons
    .map((lesson) => ({ ...lesson, title: lesson.title.trim() }))
    .filter((lesson) => lesson.title)
    .map((lesson) => {
      if (lesson.id) {
        if (seen.has(lesson.id)) throw new Error("大纲含重复章节，请刷新后重试");
        seen.add(lesson.id);
      }
      return {
        id: lesson.id,
        title: lesson.title,
        // undefined/null 表示客户端不知道原值，必须省略；只有输入框明确给出字符串（含空串）才更新。
        ...(typeof lesson.summary === "string" ? { summary: lesson.summary } : {}),
      };
    });
}
