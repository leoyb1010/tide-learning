# 商业化五轮多角色审计与压力测试

日期：2026-09-05  
项目：Tide Learning  
结论：**受控 Beta 可上线；正式收费需完成支付沙箱与生产运维门禁。**

## 五轮结果

1. **发布、数据与安全**：GenerationJob 唯一约束、fencing token、过期接管、旧 worker 拒绝、RBAC、登录限流和 webhook 幂等均有实现与测试。恢复脚本已改为先校验 DB 与资产包，再原子提交，避免部分恢复。
2. **并发与故障恢复**：租约、心跳、限流、备份恢复演练通过；专项回归 4 个测试文件共 41 项通过，可靠性审计相关测试累计 86 项通过。
3. **商业化闭环**：订单、订阅、权益、积分预占/退款、Stripe 验签与幂等已具备；运营看板补充 `paidOrders`、`grossRevenueCents`、`discountsCents`。
4. **UI、动效与可用性**：现有响应式、reduced-motion、焦点管理和浮层规范通过审查；通用 Button 增加 `focus-visible`、`aria-busy`，LoadingSkeleton 增加加载语义。
5. **最终回归与上线门禁**：`vitest` 97 个文件、755 项通过（13 项跳过）；TypeScript、生产构建、ESLint 均通过。

## 运行态补充验收

- 本地浏览器实测首页、课程库、课程详情、免费试学、登录页。
- 免费试学页实际展示播放器、课程目录、笔记面板和下一讲入口。
- 发现并修复课程详情的派生评分问题：无真实评价时改为“暂无评价”，不再显示虚构的 4.6 分/评价数。
- 发现并修复登录页“微信登录即将上线”的模糊承诺，改为“微信登录暂未开放”。
- 构造带绝对路径 symlink 的恶意资产归档，恢复脚本以退出码 3 拒绝，目标数据库保持原内容不变。
- 新增 `npm run check:commercial` 发布门禁；当前开发库实际发现 7 条从 2026-08-17 至 2026-08-18 遗留的 `provider_timeout` 对账记录，因此门禁按预期失败，不能把正式收费误标为 ready。
- 新增财务后台对账队列 `/api/admin/billing/reconciliation`：仅 `order:refund` 权限可查/处理，`resolved`/`waived` 必须填写原因并写入 `AuditLog`，不会删除记录或自动改余额；匿名 GET/PATCH 实测均返回 401。
- 新增后台 `/admin/billing` 页面和导航入口，财务可在响应式列表中查看原因、预占 ID、供应商状态并处理记录；匿名页面不会获得后台数据。
- 新增 `tests/billing-reconciliation-contract.test.ts`，自动验证权限、CSRF、处理状态、原因长度、审计留痕和禁止重复/删除处理。
- 浏览器审计覆盖 1440/768/375 三种视口：首页、课程库、需求、定价、登录均无 axe 违规、控制台错误、网络失败或横向溢出；登录态造课无失败请求；私有媒体实际返回 9 次 `206 video/mp4` Range 响应；键盘错误态可见。
- 发现开发库媒体索引脱节后，新增 `npm run repair:media-index`，dry-run 后已在本地开发库恢复 4 条真实媒体引用；该工具生产环境必须显式 `--apply`。
- 运行 `node scripts/runtime-critical.mjs` 通过：媒体 4/4、账户删除与订单链路、需求状态机 5 次状态转移、上线通知 3 个接收者均完成。
- 真实浏览器验收补充覆盖 Next 开发源白名单与图片质量警告；桌面/平板/手机场景仍保持 axe、控制台、网络失败和横向溢出为 0。
- 依赖审计发现并修复 `mammoth` 间接引入的 `@xmldom/xmldom` 中危漏洞，现 `npm audit --audit-level=moderate` 为 0 vulnerabilities。
- 使用最新 `next build` 产物启动 `next start` 后重跑浏览器审计：1440/768/375 三种视口、登录态造课、私有媒体 12 次 `206 video/mp4`、键盘错误态全部通过；生产模式 axe、控制台错误、网络失败和横向溢出均为 0。

## 当前上线条件

- 配置并验证 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` 和公网回调域名。
- 完成测试支付、取消、重复 webhook、退款、金额/币种错配 E2E。
- 处理 7 条历史 `LlmBillingReconciliation` pending 记录。
- 确认加密备份调度器已安装，并检查最近一次备份和恢复演练记录。
- 多实例部署前，将文件型限流迁移到 Redis 或数据库原子计数。
- 发布前运行 `npm run check:commercial -- --json`，门禁必须输出 `ok=true`；开发环境当前仍按预期 `ok=false`。
- 新增 `tests/commercial-readiness-gate.test.ts`，锁定生产环境缺少支付、Stripe、加密备份或未清账时必须以非零退出码阻断发布。
- 临时隔离目录完成一次加密恢复演练：开发库 DB 与私有资产包均生成 `.enc`，SHA-256 校验通过，恢复库 `PRAGMA integrity_check=ok`，媒体和上传文件哈希一致；演练未写入原开发库。
- 将恢复演练固化为 `npm run check:backup`，本轮命令实测通过并自动清理临时目录。

## 关键提交

- `7b52489`：运营看板收入指标
- `28e1a8d`：商业化准备度审计记录
- `66dc1d4`：恢复原子性与无障碍状态修复
- `1539516`：Next 开发源与图片质量配置加固
- `4456448`：修复 `@xmldom/xmldom` 间接依赖漏洞
