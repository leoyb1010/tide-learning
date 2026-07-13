# P1 验收清单对照（计划书 §19）

逐项对照《潮汐学习 v0.3》第 19 节验收清单，标注实现位置。

## 产品验收

- [x] 首页能清晰表达订阅制、持续更新、需求共创、笔记联动 — `src/app/page.tsx`（10 模块）
- [x] 游客可以试学免费章节 — 免费章节 `isFree`，游客可进 `/courses/[id]/learn/[lessonId]`
- [x] 付费墙逻辑正确 — `src/components/Paywall.tsx` + 服务端 `canAccessLesson`，试学有价值后出现
- [x] 支付成功后能回到原学习位置 — `learning_progress` 恢复 `progressSec`，付费墙就地解锁
- [x] 订阅到期后课程锁定，笔记保留 — `entitlement` 到期归约为 expired；笔记接口不校验订阅
- [x] 用户可以提交需求 — `/demands/new` → `POST /api/demands`（pending_review）
- [x] 订阅用户可以投票 — `POST /api/demands/[id]/vote`，服务端校验 `canVote`
- [x] 后台可以审核需求和发布课程 — `/admin/demands`、`/admin/courses`
- [x] 每门课程有更新日志 — `course_update_logs`，详情页前置展示

## 设计验收

- [x] 移动端无横向滚动 — 响应式栅格 + 底部 Tab（横滑仅限受控 `.scroll-row`）
- [x] CTA 清晰但不使用焦虑营销 — 无倒计时/大红促销，付费墙文案明确解锁与取消
- [x] 页面留白充足 — `max-w-6xl` + 大间距，Calm Premium
- [x] 卡片和按钮样式统一 — `src/components/ui.tsx` 统一 Button/Badge/Card
- [x] loading / empty / error 状态完整 — `EmptyState`/`ErrorState`/`LoadingSkeleton` + `loading.tsx`/`error.tsx`
- [x] 支持 reduced-motion — `globals.css` `@media (prefers-reduced-motion)`
- [x] 正文对比度达到可读标准 — ink 色阶 + 正文 ≥16px / 行高 1.75

## 技术验收

- [x] 权益判断在服务端 — `src/lib/entitlement.ts`，客户端只读快照
- [x] 支付 webhook 幂等 — `payment_webhook_logs` 唯一键 `(channel, externalId)`，实测重复返回 duplicate
- [x] 视频 URL 有短时签名和访问控制 — `/api/stream/[assetId]` HMAC `exp+sig` + 二次权益校验 + Range（匿名付费节 403）
- [x] 笔记自动保存 — `NoteEditor` debounce PATCH
- [x] 投票防重复、防超额 — 周票额 5、单需求 ≤3、`@@unique(demandId,userId,weekKey)`
- [x] 后台操作有 audit log — `audit_logs` + `src/lib/audit.ts`
- [x] 核心接口有错误处理 — `src/lib/api.ts` `handle()` 统一异常
- [x] 核心埋点完整 — `analytics_events`，18 个核心事件（§10.3）

## 内容验收

- [x] P1 至少 8 门课有完整大纲 — seed 8 门（§11.1 全部）
- [x] 每门课至少 1 章可试学 — 每门课首章 `isFree=true`
- [x] 每条内容线至少有 1 门代表课 — AI 技能×3 / 备考×2 / 生活×3
- [x] 健康/财务/防诈骗内容有审核人和免责声明 — 就医前/防诈骗/长辈课含 `reviewerName` + `disclaimer`
- [x] 上新节奏对用户可见 — 课程卡/详情页更新日志 + `/updates` + 后台内容排期

## 核心闭环实测（curl 冒烟）

| 场景 | 结果 |
|---|---|
| 匿名访问付费视频流 | 403 ✅ |
| 订阅用户访问付费视频流 | 200 ✅ |
| 支付 webhook 重复回调 | 首次 processed / 二次 duplicate ✅ |
| 免费用户 → 订阅后 entitlement | free → active ✅ |
| 投票超额（单需求 >3） | 拦截 ✅ |
| 普通用户访问后台 API | 401 ✅ |

## 状态机覆盖（§7.3 / §6.7）

`free → trial → active → grace_period → billing_retry → active/expired`
`active → canceled_but_active → expired` · `active → refunded / revoked`
— 全部映射到 `STATUS_LABELS` 展示文案，服务端 `resolveEntitlement` 归约。

---

# v1.0 验收补充（升级优化计划）

> 在 P1 基础上补齐差异化体验与生产级健壮性；详见 [`docs/upgrade-plan-v1.0.md`](./docs/upgrade-plan-v1.0.md)。

## 新增能力验收

- [x] 笔记捕捉 2.0 — 学习工作台：截帧(S)/批注(N)/字幕剪藏/焦点(F)/深海模式/Markdown/时间戳编辑/删除撤销 — `src/components/Player.tsx`、`NoteEditor.tsx`（实测 S 键截帧生成 `capture` 笔记并落库）
- [x] 笔记馆三视图 + 标签 + 导出 Markdown — `src/app/notes`、`src/app/api/notes/export`
- [x] 共创剧场 — 评论/楼中楼、关注进度、制作阶段轨道、水滴票额与衰减 — `DemandComments.tsx`、`DemandStageTrack.tsx`
- [ ] 真实支付渠道（部分完成）— Stripe 一次性 Checkout/原生 webhook 已实现，生产拒绝 mock；尚需商户沙箱凭据与公网回调域名完成真实收款/退款/对账 E2E
- [x] 激励体系 — streak / 潮汐日历 / 成就 / 激励页 — `src/lib/gamification.ts`、`TideCalendar.tsx`
- [x] Tide Motion 2.0 + 深海模式 — `src/components/motion.tsx`、`globals.css`
- [x] SEO/运营 — 波形 Hero、CommandK、sitemap/robots/terms/privacy
- [x] 单测 + CI — vitest 247 用例、GitHub Actions

## 终审安全/支付/健壮性验收（多智能体六维度终审 + 对抗验证，共修 31 项 CONFIRMED）

| 项 | 修复 | 实测 |
|---|---|---|
| webhook 密钥伪造 | 移除默认密钥回退，未知渠道 400 | 未知渠道 400 ✅ / 无签名 401 ✅ |
| 细粒度 RBAC | 14 admin 路由 requireAdmin→requirePermission | reviewer 越权 403 ✅ / admin 200 ✅ |
| 登录暴力破解 | 账号 5/min + IP 20/min 双限流 | 第 6 次起 429 ✅ |
| 限流 XFF 绕过 | clientIp 取可信反代跳（TRUSTED_PROXY_HOPS） | — |
| 退款误撤全部订阅 | Order.subscriptionId 精确定位单条 | 退款仅撤本单订阅 ✅ |
| 重复支付并行订阅 | 同 scope 有效订阅改续期 | 未新建第 2 条、到期正确延长 ✅ |
| 优惠券超发/薅首单 | 支付事务内条件自增 + 首单看 paid∪refunded | — |
| 计费状态机复活/白嫖 | 前置状态校验、宽限期派生、升级须补差 | — |
| 投票并发超发 | 配额校验+写入包 $transaction | — |
| SSR/hydration | 时区固定 Asia/Shanghai、活值客户端计算 | 学习页/我的/共创页 0 hydration error ✅ |
| React 竞态/泄漏 | 定时器 cleanup、请求序号 guard、评论框独立 state | 评论框不串台 ✅ |

## 回归验证

2026-07-13 本地复验：`tsc --noEmit` 0 错误 · `vitest run` 241/241 · `next build` 成功。GitHub 线上 Actions/分支保护仍须在推送后由仓库管理员确认。

---

_v3.4 工程原型 · 2026-07_
