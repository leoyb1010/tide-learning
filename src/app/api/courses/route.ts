import { NextRequest } from "next/server";
import { listCourses } from "@/lib/queries";
import { ok, handle } from "@/lib/api";

// GET /api/courses?category=&sort=&q=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const sp = req.nextUrl.searchParams;
    const courses = await listCourses({
      category: sp.get("category") ?? undefined,
      sort: sp.get("sort") ?? undefined,
      q: sp.get("q") ?? undefined,
    });
    return ok({ courses });
  });
}
