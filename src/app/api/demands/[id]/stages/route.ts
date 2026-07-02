import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

// 制作阶段固定顺序（剧场进度用）。注意：route.ts 仅允许 export HTTP 方法与保留字段，故此处不 export。
const STAGE_ORDER = ["scripting", "recording", "editing", "reviewing", "published"] as const;
type StageKey = (typeof STAGE_ORDER)[number];
const STAGE_STATUSES = ["pending", "active", "done"] as const;
type StageStatus = (typeof STAGE_STATUSES)[number];

function isStageKey(v: unknown): v is StageKey {
  return typeof v === "string" && (STAGE_ORDER as readonly string[]).includes(v);
}
function isStageStatus(v: unknown): v is StageStatus {
  return typeof v === "string" && (STAGE_STATUSES as readonly string[]).includes(v);
}

// GET /api/demands/:id/stages — 阶段列表（按固定顺序补齐缺失阶段为 pending）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const rows = await prisma.demandStage.findMany({ where: { demandId: id } });
    const byStage = new Map(rows.map((r) => [r.stage, r]));

    const stages = STAGE_ORDER.map((stage) => {
      const r = byStage.get(stage);
      return {
        stage,
        status: r?.status ?? "pending",
        note: r?.note ?? null,
        updatedAt: r?.updatedAt.toISOString() ?? null,
      };
    });
    return ok({ stages });
  });
}

// POST/PATCH /api/demands/:id/stages — 更新单个阶段（仅版主）
async function upsertStage(req: NextRequest, id: string) {
  assertSameOrigin(req);
  await requirePermission("demand:moderate");

  const body = ((await req.json().catch(() => ({}))) as {
    stage?: string;
    status?: string;
    note?: string;
  }) ?? {};
  if (!isStageKey(body.stage)) return fail("非法的制作阶段");
  if (body.status !== undefined && !isStageStatus(body.status)) return fail("非法的阶段状态");

  const demand = await prisma.demand.findUnique({ where: { id }, select: { id: true } });
  if (!demand) return fail("需求不存在", 404);

  // schema 未对 (demandId, stage) 建唯一约束，故用 findFirst + create/update 手动 upsert。
  const existing = await prisma.demandStage.findFirst({
    where: { demandId: id, stage: body.stage },
    select: { id: true },
  });
  const stage = existing
    ? await prisma.demandStage.update({
        where: { id: existing.id },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
      })
    : await prisma.demandStage.create({
        data: {
          demandId: id,
          stage: body.stage,
          status: body.status ?? "active",
          note: body.note ?? null,
        },
      });

  return ok({
    stage: {
      stage: stage.stage,
      status: stage.status,
      note: stage.note,
      updatedAt: stage.updatedAt.toISOString(),
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => upsertStage(req, (await params).id));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => upsertStage(req, (await params).id));
}
