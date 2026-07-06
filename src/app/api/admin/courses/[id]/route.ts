import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { TRACKS } from "@/lib/tracks";

// 白名单枚举：对齐 prisma/schema.prisma Course 注释（status/level）与 src/lib/tracks.ts（category）
const VALID_STATUS = ["draft", "beta", "published", "archived"];
const VALID_LEVEL = ["L1", "L2", "L3"];
const VALID_CATEGORY = TRACKS.map((t) => t.key);
// 字符串字段长度上限（title 等短文本 200，长文本 2000）
const STRING_MAX: Record<string, number> = {
  title: 200, subtitle: 200, instructorName: 200, reviewerName: 200, updateCadence: 200,
  description: 2000, disclaimer: 2000,
};

// PATCH /api/admin/courses/:id — 编辑课程 / 变更状态（草稿/内测/已发布/下架）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = ["title", "subtitle", "description", "category", "level", "status", "instructorName", "reviewerName", "disclaimer", "updateCadence", "isFeatured"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) data[k] = body[k];
    // —— 字段校验：枚举白名单 / 类型 / 限长，非法直接 400 ——
    if ("status" in data && !VALID_STATUS.includes(data.status as string)) return fail("非法状态");
    if ("level" in data && !VALID_LEVEL.includes(data.level as string)) return fail("非法难度等级");
    if ("category" in data && !VALID_CATEGORY.includes(data.category as string)) return fail("非法分类");
    if ("isFeatured" in data && typeof data.isFeatured !== "boolean") return fail("isFeatured 须为布尔值");
    for (const [k, max] of Object.entries(STRING_MAX)) {
      if (!(k in data)) continue;
      const v = data[k];
      if (v === null && k !== "title") continue; // 可空字段允许显式清空
      if (typeof v !== "string") return fail(`${k} 须为字符串`);
      if (k === "title" && !v.trim()) return fail("标题不能为空");
      if (v.length > max) return fail(`${k} 过长（最多 ${max} 字）`);
    }
    if (body.status === "published") data.publishedAt = new Date();
    data.lastUpdatedAt = new Date();
    const course = await prisma.course.update({ where: { id }, data });
    await audit({ operatorId: admin.id, action: "course.update", targetType: "course", targetId: id, detail: JSON.stringify(data) });
    return ok(course);
  });
}
