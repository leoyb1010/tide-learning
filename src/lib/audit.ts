import { prisma } from "./db";

/** 后台操作审计（§19 技术验收：后台操作有 audit log）。 */
export async function audit(params: {
  operatorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
}) {
  await prisma.auditLog.create({ data: params });
}
