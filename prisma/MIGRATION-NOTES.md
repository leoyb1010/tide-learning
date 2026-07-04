# 迁移说明 · batch1_indexes_uniques

## 背景：为何用 db push 而非 migrate dev
本项目从未初始化 Prisma 迁移历史（无 `prisma/migrations/` 目录、dev.db 无 `_prisma_migrations` 表，
历史上一直靠 `prisma db push` 同步）。在此状态下运行 `prisma migrate dev` 会把整份 schema 当作
「全新未应用」，并要求 **reset 数据库（清空所有数据）** 才能建立基线。为避免数据丢失，本批改动
按既有工作流用 `prisma db push --accept-data-loss` 同步。

`--accept-data-loss` 仅因「新增唯一约束理论上可能撞已有重复行」而被 Prisma 强制要求；本批已预先核验
无任何重复行（见下），加索引/约束不删数据，实际零数据丢失。应用前后行数一致：
AnalyticsEvent 87 / CreditLedger 10 / Entitlement 2 / User 12。

## 本批 schema 改动（2 处生效，1 处按诊断否决）

### 1. AnalyticsEvent 加两条索引（P1 性能）— 已应用
```
@@index([eventName, createdAt])
@@index([userId, eventName, createdAt])
```
全站最热写表原零索引；覆盖「按事件名 + 时间范围」「按用户漏斗」两类高频查询。

### 2. Entitlement 加唯一约束（P2 并发写重复快照）— 已应用
```
@@unique([userId, sourceSubscriptionId])
```
字段名核实为 `sourceSubscriptionId`（`String?` 可空）。SQLite 多 NULL 并存不冲突，free 快照行
（sourceSubscriptionId=null，现有 2 行）不受影响。核验非 null 组合无重复行，约束应用无阻塞。
配套改 `src/lib/entitlement.ts` 的 `persistSnapshot`：非 null 走
`prisma.entitlement.upsert({ where: { userId_sourceSubscriptionId: {...} }, update, create })`
原子幂等；null 分支保留 findFirst→update/create 兜底（现有调用方 subscriptionId 恒非 null，
该分支仅防御性存在）。

### 3. CreditLedger `@@unique([type, refId])`（IAP 幂等）— 诊断后否决，未应用
**原提案不安全，会破坏现有契约。** 实测 dev.db 中 `type=llm_spend` 的 refId 写的是 scene 名
（generate_lesson 等），每次 AI 调用都重复（现有 8 行含 generate_lesson x6 / generate_course x2）；
`type=monthly_grant` 的 refId 写的是 monthKey（如 "2026-07"），设计上跨用户共享同月。
全局 `@@unique([type, refId])` 会：
  - 第二次 LLM 计费即触发唯一冲突，打断整条扣费链；
  - 多用户同月月赠互相撞键。
因此**不给 CreditLedger 加此约束**。IAP 充值幂等改为在 `src/app/api/iap/verify/route.ts` 的
recharge 分支用**单事务内「二次确认查重 → 入账」**实现（原 findFirst 在 grantCredits 事务之外，
留有并发窗口；现合并进同一 `$transaction`，等价幂等且不改 schema、不碰计费/月赠路径）。
幂等键仍为 (userId, type=recharge, refId=transactionId)，越权铁律 where userId 保留。

## 若后续要正式建立迁移基线
在数据可控的环境执行 `prisma migrate diff` 生成基线 SQL，或对空库 `migrate dev` 后 `migrate resolve`
标记已应用。切勿在生产/含数据的 dev.db 上直接 `migrate dev`（会要求 reset）。
