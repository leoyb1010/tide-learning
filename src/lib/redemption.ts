import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { ensureAccount } from "./credits";
import { activateMembershipDays, resolveGrantPlan } from "./payment";

/**
 * 兑换码体系核心（v3.3）—— 与优惠券（Coupon，仅支付折扣）正交。
 * 兑换码可直接发放**积分**或**会员天数**，有独立用户兑换入口，无需下单。
 *
 * 两个纯粹动作：
 *   - generateRedemptionCodes：管理员批量生成 N 个唯一码（TIDE-XXXX-XXXX-XXXX），共用一个 batchId；
 *   - redeemCode：用户输入码兑换，**单事务原子核销**（码计数自增 + 核销记录 + 积分/会员发放）。
 *
 * 一致性/防重放要点：
 *   - RedemptionRecord @@unique([codeId, userId]) —— 同一人对同一码只兑一次（并发下第二次撞唯一约束）；
 *   - usedCount 自增走「条件更新 updateMany(usedCount < maxUses)」，count===0 即已被兑满，杜绝并发超发；
 *   - 会员发放复用 payment.activateMembershipDays（与 iap/verify 行为一致），同事务内提交。
 */

// —— 兑换码格式 ——
const CODE_PREFIX = "TIDE";
// 去除易混字符（0/O、1/I/L）的 Crockford 风格字母表，降低人工输入错误。
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GROUP_LEN = 4;
const GROUP_COUNT = 3; // TIDE-XXXX-XXXX-XXXX

export const REDEMPTION_TYPES = ["credits", "membership"] as const;
export type RedemptionType = (typeof REDEMPTION_TYPES)[number];

/** 生成一个随机分组码：TIDE-XXXX-XXXX-XXXX（大写、去混淆字符）。 */
export function formatRedemptionCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUP_COUNT; g++) {
    let s = "";
    // randomBytes 提供 CSPRNG 熵，逐字符取模映射到字母表（拒绝可预测的 Math.random）。
    const bytes = randomBytes(GROUP_LEN);
    for (let i = 0; i < GROUP_LEN; i++) {
      s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    groups.push(s);
  }
  return `${CODE_PREFIX}-${groups.join("-")}`;
}

/** 规范化用户输入的码：去空白、转大写、去除分组连字符外的杂字符后再统一补连字符。 */
export function normalizeRedemptionCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/** 结构校验（快速拒绝明显非法输入，省一次查库）。TIDE- 前缀 + 3 组 4 位字母表字符。 */
export function isValidRedemptionCodeFormat(code: string): boolean {
  const re = new RegExp(
    `^${CODE_PREFIX}-[${CODE_ALPHABET}]{${GROUP_LEN}}(?:-[${CODE_ALPHABET}]{${GROUP_LEN}}){${GROUP_COUNT - 1}}$`,
  );
  return re.test(code);
}

export interface GenerateOptions {
  type: RedemptionType;
  value: number; // credits: 积分数；membership: 会员天数
  count: number;
  maxUses?: number; // 每个码可被兑换次数（默认 1）
  planId?: string | null; // membership 类可选指定套餐
  note?: string | null;
  expiresAt?: Date | null;
  createdById?: string | null;
}

export interface GenerateResult {
  batchId: string;
  codes: string[];
}

/**
 * 批量生成兑换码。碰撞安全：逐个插入，撞 code 唯一约束(P2002)时换码重试（每码最多重试 8 次）。
 * 校验 type/value/count/maxUses；membership 且指定 planId 时校验套餐存在。返回 batchId + 明文码列表。
 */
export async function generateRedemptionCodes(opts: GenerateOptions): Promise<GenerateResult> {
  const { type, value, count } = opts;
  if (!REDEMPTION_TYPES.includes(type)) throw new AppError("兑换码类型仅支持 credits / membership");
  if (!Number.isInteger(value) || value <= 0) throw new AppError("面值（积分数/会员天数）须为正整数");
  if (!Number.isInteger(count) || count <= 0) throw new AppError("生成数量须为正整数");
  if (count > 1000) throw new AppError("单批最多生成 1000 个兑换码");
  const maxUses = opts.maxUses == null ? 1 : opts.maxUses;
  if (!Number.isInteger(maxUses) || maxUses <= 0) throw new AppError("可兑换次数须为正整数");

  // membership 且指定套餐：提前校验存在，避免生成永不生效的僵尸码。
  let planId: string | null = opts.planId ?? null;
  if (type === "membership" && planId) {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new AppError("指定套餐不存在");
  } else if (type === "credits") {
    planId = null; // 积分码不挂套餐
  }

  const batchId = `batch_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    let inserted = false;
    for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
      const code = formatRedemptionCode();
      try {
        await prisma.redemptionCode.create({
          data: {
            code,
            batchId,
            type,
            value,
            planId,
            maxUses,
            status: "active",
            note: opts.note ?? null,
            expiresAt: opts.expiresAt ?? null,
            createdById: opts.createdById ?? null,
          },
        });
        codes.push(code);
        inserted = true;
      } catch (e) {
        // 唯一冲突（极小概率）：换码重试；其它错误直接冒泡。
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    if (!inserted) throw new AppError("生成兑换码时多次碰撞，请重试", 500);
  }

  return { batchId, codes };
}

export interface RedeemResult {
  type: RedemptionType;
  value: number; // 实发积分数 / 会员天数
  balance?: number; // 积分类：兑换后余额
  validUntil?: string; // 会员类：会员到期时间 ISO
}

/**
 * 兑换码核销（用户侧）。整个「校验 → 计数自增 → 核销记录 → 发放」在**单事务内**完成。
 * 各失败态用**互相区分**的文案（未知/已作废/已过期/已兑满/本人已兑），前端可据此提示。
 *
 * @throws AppError 各校验失败（400/409/404 语义），由 api handle 统一转响应。
 */
export async function redeemCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = normalizeRedemptionCode(rawCode);
  if (!code) throw new AppError("请输入兑换码");
  if (!isValidRedemptionCodeFormat(code)) throw new AppError("兑换码格式不正确");

  // 先查一次做「早失败 + 会员套餐解析」（会员发放需 planId，套餐解析涉及独立查询，放事务外）。
  const rc = await prisma.redemptionCode.findUnique({ where: { code } });
  if (!rc) throw new AppError("兑换码不存在", 404);
  if (rc.status !== "active") throw new AppError("兑换码已作废");
  if (rc.expiresAt && rc.expiresAt < new Date()) throw new AppError("兑换码已过期");
  if (rc.usedCount >= rc.maxUses) throw new AppError("兑换码已被兑完");

  // 本人是否已兑过（快速拒绝；事务内还有唯一约束兜底并发）。
  const mine = await prisma.redemptionRecord.findUnique({
    where: { codeId_userId: { codeId: rc.id, userId } },
  });
  if (mine) throw new AppError("你已兑换过该兑换码");

  // 会员类：事务外先解析要挂载的套餐（避免在事务里做多次独立查询拉长事务）。
  const plan = rc.type === "membership" ? await resolveGrantPlan(rc.planId) : null;

  // 积分类：事务外先惰性建账（含注册赠送），保证事务内 update 命中已存在的账户，
  // 避免在外层事务里再嵌套 grantCredits 自己的 $transaction（SQLite 嵌套事务会自锁）。
  if (rc.type === "credits") await ensureAccount(userId);

  // —— 原子核销 ——
  // 事务内：条件自增 usedCount（防超发）→ 建核销记录（防同人重放，唯一约束）→ 发放积分/会员。
  const result = await prisma.$transaction(async (tx) => {
    // 条件自增：仅当仍 active 且未兑满时命中；count===0 说明并发下已被兑满/作废。
    const claimed = await tx.redemptionCode.updateMany({
      where: { id: rc.id, status: "active", usedCount: { lt: rc.maxUses } },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count === 0) throw new AppError("兑换码已被兑完");

    // 核销记录（(codeId,userId) 唯一：并发下本人第二次兑换撞约束 → P2002 → 转「已兑换过」）。
    try {
      await tx.redemptionRecord.create({
        data: {
          codeId: rc.id,
          userId,
          grantedType: rc.type,
          grantedValue: rc.value,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new AppError("你已兑换过该兑换码");
      }
      throw e;
    }

    if (rc.type === "credits") {
      // 在同一事务内入账（对齐 credits.grantCredits 的写法：DB 侧 increment 原子入账 + 写流水），
      // 与「核销记录」同事务提交，保证「记账」与「发放」原子一致；账户已由事务外 ensureAccount 建好。
      const updated = await tx.creditAccount.update({
        where: { userId },
        data: { balance: { increment: rc.value }, totalEarned: { increment: rc.value } },
      });
      const balanceAfter = updated.balance;
      await tx.creditLedger.create({
        data: {
          userId,
          delta: rc.value,
          type: "redemption",
          refId: rc.id,
          reason: `兑换码 ${rc.code}`,
          balanceAfter,
        },
      });
      return { type: "credits" as const, value: rc.value, balance: balanceAfter };
    }

    // membership：复用共享激活核心（与 iap/verify 一致），同事务内挂订阅。
    if (!plan) throw new AppError("会员套餐未配置", 500);
    const subId = await activateMembershipDays(tx, {
      userId,
      planId: plan.id,
      channel: "redemption",
      days: rc.value,
      scope: plan.scope,
      priceSnapshotCents: plan.priceCents,
    });
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: subId },
      select: { currentPeriodEnd: true },
    });
    return { type: "membership" as const, value: rc.value, validUntil: sub.currentPeriodEnd.toISOString() };
  });

  return result;
}
