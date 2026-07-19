import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/admin-guard";
import { Badge, EmptyState } from "@/components/ui";

export const metadata = { title: "生成质量" };
export const dynamic = "force-dynamic";

/**
 * /admin/gen-quality —— 生成质量看板（蓝图 C5 / 审查发现「可观测字段已齐但无看板」）。
 *
 * 三块盘面（全部读现有落库字段，零新埋点依赖）：
 * 1) premium 精修命中率：qualityTier=premium 课的 renderEngine llm/deterministic 占比 —— 蓝图 Stage 0 的总验收指标；
 * 2) 拒收原因 Top：renderRejectReason 频次（QC 拆闸后应只剩安全类与超时类）；
 * 3) 低质清单：qualityJson.score < 60 或视觉分 < 55 的节，点进课程可人工复核/重生成。
 */

interface QualityRow {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  lessonTitle: string;
  score: number | null;
  visualScore: number | null;
  engine: string | null;
  regenAdopted: boolean | null;
  safetyLevel: string | null;
}

function parseQuality(raw: string | null): {
  score: number | null;
  visualScore: number | null;
  regenAdopted: boolean | null;
  safetyLevel: string | null;
} {
  try {
    const q = JSON.parse(raw || "{}") as {
      score?: number;
      visual?: { score?: number };
      regen?: { adopted?: boolean } | null;
      safety?: { level?: string };
    };
    return {
      score: typeof q.score === "number" ? q.score : null,
      visualScore: typeof q.visual?.score === "number" ? q.visual.score : null,
      regenAdopted: typeof q.regen?.adopted === "boolean" ? q.regen.adopted : null,
      safetyLevel: typeof q.safety?.level === "string" ? q.safety.level : null,
    };
  } catch {
    return { score: null, visualScore: null, regenAdopted: null, safetyLevel: null };
  }
}

export default async function GenQualityPage() {
  await requireAdminPage("content:review", "/admin/gen-quality");

  // premium 命中率（现库口径）：premium 课已渲染节的 llm / 总数。
  const [premiumLlm, premiumAll] = await Promise.all([
    prisma.lesson.count({ where: { renderEngine: "llm", course: { qualityTier: "premium" } } }),
    prisma.lesson.count({ where: { renderEngine: { not: null }, course: { qualityTier: "premium" } } }),
  ]);

  // 拒收原因 Top（截断串按前 40 字归并）。
  const rejects = await prisma.lesson.findMany({
    where: { renderRejectReason: { not: null } },
    select: { renderRejectReason: true },
    take: 500,
    orderBy: { createdAt: "desc" },
  });
  const rejectTop = new Map<string, number>();
  for (const r of rejects) {
    const key = (r.renderRejectReason || "").slice(0, 40);
    if (key) rejectTop.set(key, (rejectTop.get(key) ?? 0) + 1);
  }
  const rejectRows = Array.from(rejectTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // 低质清单：近 400 节带质量档案的，按内容分/视觉分双阈值筛。
  const recent = await prisma.lesson.findMany({
    where: { qualityJson: { not: null } },
    select: {
      id: true,
      title: true,
      qualityJson: true,
      renderEngine: true,
      course: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const rows: QualityRow[] = recent.map((l) => {
    const q = parseQuality(l.qualityJson);
    return {
      lessonId: l.id,
      courseId: l.course.id,
      courseTitle: l.course.title,
      lessonTitle: l.title,
      engine: l.renderEngine,
      ...q,
    };
  });
  const lowRows = rows
    .filter((r) => (r.score !== null && r.score < 60) || (r.visualScore !== null && r.visualScore < 55) || r.safetyLevel === "block")
    .slice(0, 50);
  const regenCount = rows.filter((r) => r.regenAdopted !== null).length;
  const regenAdopted = rows.filter((r) => r.regenAdopted === true).length;

  const hitRate = premiumAll > 0 ? Math.round((premiumLlm / premiumAll) * 100) : null;

  return (
    <div className="space-y-8">
      <div>
        <div className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">Gen Quality · 生成质量</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]">生成质量看板</h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          premium 精修命中率 / 拒收原因 / 低质与安全拦截清单（质量档案来自 Lesson.qualityJson）
        </p>
      </div>

      {/* 指标行 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["premium 精修命中率", hitRate === null ? "—" : `${hitRate}%`, `${premiumLlm}/${premiumAll} 节走 LLM`],
          ["纠偏重生成", `${regenAdopted}/${regenCount || "0"}`, "触发次数中被采纳的"],
          ["拒收记录", String(rejects.length), "近 500 节内含拒收原因的"],
          ["低质/拦截", String(lowRows.length), "内容分<60 或视觉分<55 或安全拦截"],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--ink)]">{value}</div>
            <div className="mt-0.5 text-[12px] text-[var(--ink3)]">{sub}</div>
          </div>
        ))}
      </div>

      {/* 拒收原因 Top */}
      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">拒收原因 Top</h2>
        {rejectRows.length === 0 ? (
          <div className="mt-2"><EmptyState title="暂无拒收记录" hint="bespoke 全部命中或尚未触发精修" /></div>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="mono px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">原因（前 40 字）</th>
                  <th className="mono px-4 py-2.5 text-right text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">次数</th>
                </tr>
              </thead>
              <tbody>
                {rejectRows.map(([reason, count]) => (
                  <tr key={reason} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-2.5 text-[var(--ink2)]">{reason}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--ink)]">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 低质清单 */}
      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">低质 / 安全拦截清单</h2>
        {lowRows.length === 0 ? (
          <div className="mt-2"><EmptyState title="近 400 节无低质记录" hint="质量闭环运行正常" /></div>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="mono px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">课程 / 章节</th>
                  <th className="mono px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">内容分</th>
                  <th className="mono px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">视觉分</th>
                  <th className="mono px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">引擎</th>
                  <th className="mono px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">安全</th>
                </tr>
              </thead>
              <tbody>
                {lowRows.map((r) => (
                  <tr key={r.lessonId} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/courses?focus=${r.courseId}`} className="text-[var(--ink)] hover:underline">
                        {r.courseTitle}
                      </Link>
                      <span className="text-[var(--ink3)]"> · {r.lessonTitle}</span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{r.score ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.visualScore ?? "—"}</td>
                    <td className="px-4 py-2.5">{r.engine ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {r.safetyLevel === "block" ? <Badge tone="danger">拦截</Badge> : r.safetyLevel === "review" ? <Badge tone="warn">复核</Badge> : <span className="text-[var(--ink3)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
