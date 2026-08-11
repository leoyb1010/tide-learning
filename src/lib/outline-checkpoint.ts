export interface CheckpointLesson {
  id?: string;
  title: string;
  summary?: string | null;
}

/** 检查点全量保存的单一序列化入口；确保“未编辑直接确认”不会丢掉逐节目标。 */
export function checkpointPatchLessons(lessons: CheckpointLesson[]) {
  return lessons
    .map((lesson) => ({ ...lesson, title: lesson.title.trim() }))
    .filter((lesson) => lesson.title)
    .map((lesson) => ({ id: lesson.id, title: lesson.title, summary: lesson.summary ?? "" }));
}
