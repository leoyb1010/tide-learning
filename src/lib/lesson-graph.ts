export type LessonEdgeCondition =
  | { type: "always" }
  | { type: "quiz"; blockId: string; answerIndex: number }
  | { type: "choice"; blockId: string; optionIndex: number };

export interface LessonGraphEdgeInput {
  fromLessonId: string;
  toLessonId: string;
  label?: string | null;
  condition?: unknown;
  sortOrder?: number;
}

export interface ValidLessonGraphEdge {
  fromLessonId: string;
  toLessonId: string;
  label: string | null;
  condition: LessonEdgeCondition;
  sortOrder: number;
}

export interface LessonGraphValidation {
  ok: boolean;
  edges: ValidLessonGraphEdge[];
  issues: string[];
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function parseCondition(value: unknown): LessonEdgeCondition | null {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (raw.type === undefined || raw.type === "always") return { type: "always" };
  const blockId = cleanText(raw.blockId, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(blockId)) return null;
  if (raw.type === "quiz") {
    const answerIndex = Number(raw.answerIndex);
    return Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < 12 ? { type: "quiz", blockId, answerIndex } : null;
  }
  if (raw.type === "choice") {
    const optionIndex = Number(raw.optionIndex);
    return Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < 12 ? { type: "choice", blockId, optionIndex } : null;
  }
  return null;
}

/** 课程导航图必须同课、无自环、无重复且无环；sortOrder 始终保留为无障碍线性回退。 */
export function validateLessonGraph(lessonIds: string[], input: unknown): LessonGraphValidation {
  const issues: string[] = [];
  const nodeSet = new Set(lessonIds);
  const rawEdges = Array.isArray(input) ? input : [];
  if (rawEdges.length > 200) issues.push("一门课程最多 200 条导航边");
  const edges: ValidLessonGraphEdge[] = [];
  const seen = new Set<string>();
  for (const [index, value] of rawEdges.slice(0, 200).entries()) {
    if (!value || typeof value !== "object") { issues.push(`第 ${index + 1} 条边格式错误`); continue; }
    const raw = value as LessonGraphEdgeInput;
    const fromLessonId = cleanText(raw.fromLessonId, 80);
    const toLessonId = cleanText(raw.toLessonId, 80);
    if (!nodeSet.has(fromLessonId) || !nodeSet.has(toLessonId)) { issues.push(`第 ${index + 1} 条边包含非本课程课节`); continue; }
    if (fromLessonId === toLessonId) { issues.push(`第 ${index + 1} 条边不能指向自身`); continue; }
    const condition = parseCondition(raw.condition);
    if (!condition) { issues.push(`第 ${index + 1} 条边条件无效`); continue; }
    const label = cleanText(raw.label, 120) || null;
    const key = `${fromLessonId}\u0000${toLessonId}\u0000${label ?? ""}`;
    if (seen.has(key)) { issues.push(`第 ${index + 1} 条边重复`); continue; }
    seen.add(key);
    edges.push({ fromLessonId, toLessonId, label, condition, sortOrder: Number.isInteger(raw.sortOrder) ? Math.max(0, Math.min(999, raw.sortOrder as number)) : index });
  }

  // Kahn 拓扑排序：任一环都会让已访问节点数小于节点总数。
  const indegree = new Map(lessonIds.map((id) => [id, 0]));
  const outgoing = new Map(lessonIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    indegree.set(edge.toLessonId, (indegree.get(edge.toLessonId) ?? 0) + 1);
    outgoing.get(edge.fromLessonId)?.push(edge.toLessonId);
  }
  const queue = lessonIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== lessonIds.length) issues.push("导航图不能形成循环，请保留至少一个可结束的学习路径");
  return { ok: issues.length === 0, edges, issues };
}
