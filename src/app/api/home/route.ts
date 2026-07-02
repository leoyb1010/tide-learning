import { listCourses, listUpdates, listRankedDemands } from "@/lib/queries";
import { ok, handle } from "@/lib/api";

// GET /api/home — 首页聚合数据（§18.1）
export async function GET() {
  return handle(async () => {
    const [featured, updates, demands] = await Promise.all([
      listCourses({ sort: "recommended" }),
      listUpdates(8),
      listRankedDemands(["collecting", "evaluating", "scheduled", "producing"]),
    ]);
    return ok({
      featured: featured.filter((c) => c.isFeatured).slice(0, 6),
      popular: [...featured].sort((a, b) => b.learnersCount - a.learnersCount).slice(0, 6),
      lines: {
        ai_skill: featured.filter((c) => c.category === "ai_skill").slice(0, 3),
        exam: featured.filter((c) => c.category === "exam").slice(0, 3),
        life: featured.filter((c) => c.category === "life").slice(0, 3),
      },
      updates,
      demandTop5: demands.slice(0, 5),
    });
  });
}
