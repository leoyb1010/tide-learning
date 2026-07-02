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
- [x] 视频 URL 有短时签名或访问控制 — `/api/stream/[assetId]` `exp` 参数 + 二次权益校验（匿名 403）
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
