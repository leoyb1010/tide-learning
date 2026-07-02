import { NextRequest } from "next/server";
import { getLessonForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, fail, handle } from "@/lib/api";

// GET /api/lessons/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await getCurrentUser();
    const data = await getLessonForUser(id, user?.id ?? null);
    if (!data) return fail("章节不存在", 404);
    if (data.lesson.isFree) {
      await track({
        eventName: "lesson_trial_start",
        userId: user?.id,
        properties: { course_id: data.course.id, lesson_id: id },
      });
    }
    return ok(data);
  });
}
