import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, fail, handle } from "@/lib/api";

// POST /api/leads — 预约试听留资（有道 0转正入口，端内/端外均可）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    const body = (await req.json()) as {
      name?: string; phone?: string; courseId?: string; track?: string;
      source?: string; channelDetail?: string;
    };
    if (!body.phone && !user) return fail("请填写手机号以便安排试听");

    const lead = await prisma.lead.create({
      data: {
        userId: user?.id ?? null,
        name: body.name ?? user?.nickname ?? null,
        phone: body.phone ?? user?.phone ?? null,
        courseId: body.courseId ?? null,
        track: body.track ?? null,
        source: body.source ?? "youdao_dict",
        channelDetail: body.channelDetail ?? null,
        status: "new",
      },
    });
    await track({
      eventName: "trial_booking",
      userId: user?.id,
      properties: { track: body.track, source: body.source ?? "youdao_dict", course_id: body.courseId },
    });
    return ok({ id: lead.id, booked: true });
  });
}
