# 商业化五轮多角色审计与压力测试

日期：2026-09-05  
项目：Tide Learning  
结论：**受控 Beta 可上线；正式收费需完成支付沙箱与生产运维门禁。**

## 五轮结果

1. **发布、数据与安全**：GenerationJob 唯一约束、fencing token、过期接管、旧 worker 拒绝、RBAC、登录限流和 webhook 幂等均有实现与测试。恢复脚本已改为先校验 DB 与资产包，再原子提交，避免部分恢复。
2. **并发与故障恢复**：租约、心跳、限流、备份恢复演练通过；专项回归 4 个测试文件共 41 项通过，可靠性审计相关测试累计 86 项通过。
3. **商业化闭环**：订单、订阅、权益、积分预占/退款、Stripe 验签与幂等已具备；运营看板补充 `paidOrders`、`grossRevenueCents`、`discountsCents`。
4. **UI、动效与可用性**：现有响应式、reduced-motion、焦点管理和浮层规范通过审查；通用 Button 增加 `focus-visible`、`aria-busy`，LoadingSkeleton 增加加载语义。
5. **最终回归与上线门禁**：`vitest` 95 个文件、752 项通过（13 项跳过）；TypeScript、生产构建、ESLint 均通过。

## 当前上线条件

- 配置并验证 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` 和公网回调域名。
- 完成测试支付、取消、重复 webhook、退款、金额/币种错配 E2E。
- 处理 7 条历史 `LlmBillingReconciliation` pending 记录。
- 确认加密备份调度器已安装，并检查最近一次备份和恢复演练记录。
- 多实例部署前，将文件型限流迁移到 Redis 或数据库原子计数。

## 关键提交

- `7b52489`：运营看板收入指标
- `28e1a8d`：商业化准备度审计记录
- `66dc1d4`：恢复原子性与无障碍状态修复
