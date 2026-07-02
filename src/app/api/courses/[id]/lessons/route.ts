import { NextRequest } from "next/server";
import { getCourseDetail } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";

// GET /api/courses/:id/lessons
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await getCurrentUser();
    const detail = await getCourseDetail(id, user?.id ?? null);
    if (!detail) return fail("课程不存在", 404);
    return ok({ lessons: detail.lessons });
  });
}
