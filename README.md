# 🌊 潮汐学习 · Tide Learning

> 全龄订阅制学习平台 · **v3.4 工程原型（融入有道 VIS 设计资料）**
> 基于《潮汐学习产品计划书 v0.3》+《有道学习会员产品介绍》+《网易有道 VIS》+《v1.0 升级优化计划》

用户按月订阅，解锁**持续更新**的体系化课程，支持**全站会员**与**单赛道会员自由组合**，
并通过**需求投票**决定平台下一批课程。学习、笔记、上新提醒与**预约试听/电联建联**形成完整转化与留存闭环。

```
(端内私域/端外投放) → 预约试听 → 电联建联 → 试学 → 订阅(全站/单赛道) → 学习 → 记笔记 → 投票 → 上新
```

> **融合亮点**（详见 [`docs/有道业务融合说明.md`](./docs/有道业务融合说明.md)）：
> 分赛道自由组合订阅 · 预约试听+电联建联漏斗 · 渠道×人群看板 · 直播小班课 · 共创+投流数据双输入选题

---

## 技术栈

| 层 | 选型 | 对应计划书要求 |
|---|---|---|
| 框架 | **Next.js 15（App Router）+ TypeScript** | SSR/SEO（§17-1）、三端复用留空间（§17-8）|
| 样式 | **Tailwind v4 + 设计 Token** | Calm Premium 设计系统（§13）|
| 数据 | **Prisma + SQLite** | 完整数据模型（§9）、订单/订阅/权益分表（§7.3）|
| 鉴权 | Cookie Session + scrypt | 手机号/邮箱登录（§2.2）|
| 权益 | 服务端 Entitlement 状态机 | 客户端不判断 paid（§7.3 / §17-4）|

> 本地可用 SQLite 与 mock 收银台演示业务状态机；生产会强制禁用 mock。已实现 Stripe 一次性 Checkout 与原生 webhook 验签，真实交易仍须使用商户测试账号和公网回调域名完成沙箱验收。

---

## 快速开始

```bash
npm install          # 安装依赖
cp .env.example .env # 按需修改配置；本地默认 SQLite
npm run setup        # migrate deploy 建库 + 灌入冷启动课程
npm run dev          # 启动开发服务器 → http://localhost:3000
# 生产：npm run build && npm run start
```

冷启动数据当前含 8 门、35 节可读课程：4 节绑定仓库内 4 份不同的私有教学视频，其余为完整图文、结构化课件或直播章节；没有媒体的章节不会伪装成视频。生产运行必须使用 Stripe、HTTPS 公网同源地址及绝对持久化目录，缺项会在启动阶段失败。

### 体验账号（seed 内置）

| 账号 | 密码 | 说明 |
|---|---|---|
| `demo@tide.learning` | `demo123` | 全站年卡，可学全部赛道 |
| `oral@tide.learning` | `oral123` | 仅口语实战单赛道（演示分赛道订阅） |
| `admin@tide.learning` | `admin123` | 后台管理员（建联队列 / 渠道看板） |

---

## v1.0 升级亮点（相较 v0.6）

> 详见 [`docs/upgrade-plan-v1.0.md`](./docs/upgrade-plan-v1.0.md)以及后续 v2–v3.4 升级文档。

- **笔记捕捉 2.0**：学习工作台化 —— 视频截帧(S)、快速批注(N)、字幕划线剪藏、焦点模式(F)、深海模式、Markdown 预览、时间戳编辑、删除撤销；移动端可拖拽笔记 Sheet。
- **笔记馆**：三视图（时间线/画廊/课程归档）+ 标签 + 一键导出 Markdown。
- **共创剧场**：需求评论/楼中楼、关注进度、制作阶段轨道、水滴票额与衰减机制。
- **支付状态机**：Stripe 一次性 Checkout + `stripe-signature` 原始 body 验签、金额/币种/渠道对账、幂等回调、仅非生产可用的 mock 收银台、订阅管理与优惠券。
- **激励体系**：连续学习 streak、潮汐日历、成就徽章、激励页。
- **Tide Motion 2.0**：潮汐主题动效系统（TidalReveal/Ripple/WaveProgress 等）+ 深海模式主题。
- **SEO/运营**：波形 Hero 首页、CommandK 快捷搜索、sitemap/robots/terms/privacy。
- **生产级健壮性**：webhook 强验签（无默认密钥）、细粒度 RBAC、登录/接口限流、CSRF、订阅状态机与退款/续期/优惠券的原子性与幂等、SSR/hydration 稳定性、React 竞态与内存泄漏治理。
- **质量保障**：vitest 单测 + GitHub Actions CI（迁移、lint、类型、测试、构建、依赖审计、恢复演练）。
- **生产运维**：发布、加密备份、异地复制、RPO/RTO 与恢复演练见 [`docs/operations-runbook.md`](docs/operations-runbook.md)。

---

## 已实现范围（P1）

### 用户端
- **首页 / 发现**（`/`）— Hero、本周上新、热门课程、三条内容线、需求榜、笔记演示、数据证明、订阅方案、FAQ（§6.1 十模块）
- **课程库**（`/courses`）— 分类/排序/搜索、空态推荐（§6.2）
- **课程详情**（`/courses/[id]`）— 更新日志前置、大纲、免费标记、合规声明（§6.3）
- **播放器/学习页**（`/courses/[id]/learn/[lessonId]`）— 模拟播放器、倍速、进度记忆、付费墙、笔记抽屉（§6.4）
- **笔记**（`/notes`）— 时间戳锚点回跳、按课程归档、搜索、自动保存、停订仍可查看（§6.5）
- **共创需求**（`/demands`, `/demands/new`, `/demands/[id]`）— 提交、综合分排行榜、投票、状态流转、官方反馈（§6.6）
- **订阅**（`/pricing`）— 连续包月/年度主推、权益对比（§7.1/§7.2）
- **我的**（`/me`, `/me/subscription`, `/me/settings`）— 订阅状态机展示、取消挽留、恢复购买、长辈模式/字号预留（§6.7/§13.6）

### 后台 CMS（`/admin`）
- 数据看板（10 项指标，§8.2.5）
- 课程管理（新建、状态流转、增章节、发更新日志，§8.2.1）
- 内容排期（§8.2.2）· 需求审核（合并/状态/官方反馈，§8.2.3）· 订单与 webhook 记录（§8.2.4）· 用户管理

### 工程能力
- **服务端权益判断**：`src/lib/entitlement.ts` 从订阅归约出权益快照，客户端只读
- **支付 webhook 状态机幂等**：`payment_webhook_logs` 唯一键去重；Stripe 成功/退款事件归一化，错金额、错币种、跨渠道和过期重放均拒绝
- **付费视频访问控制**：私有 `.data/media` 落盘、MP4/WebM 魔数校验、`/api/stream/[assetId]` HMAC 短时签名 + 二次权益校验 + HTTP Range；付费视频不再放入 `public/`
- **投票风控**：仅订阅用户、每周 5 票、单需求 ≤3 票、周一重置
- **全链路埋点**：`analytics_events` 覆盖访问→试学→注册→付费墙→支付→学习→笔记→投票
- **后台审计日志**：`audit_logs` 记录后台操作
- 所有核心页面含 loading / empty / error 态；移动端底部 Tab 适配；支持 reduced-motion

---

## 目录结构

```
prisma/
  schema.prisma        # §9 全部数据模型
  seed.ts              # 8 门冷启动课程 + 套餐 + 需求 + 体验数据
src/
  app/
    (pages)            # 前台页面 + /admin 后台
    api/               # §18 API：public/auth/learning/notes/demands/subscription/admin
  components/          # §13.3 组件库 + admin/*
  lib/
    entitlement.ts     # 权益状态机（§7.3）
    payment.ts         # checkout + 幂等 webhook + 取消/恢复
    demand-score.ts    # 需求综合分（§6.6）
    analytics.ts       # 埋点 SDK 包装层（§10）
    queries.ts         # 服务端查询 + 权益标记
```

详见 [`ACCEPTANCE.md`](./ACCEPTANCE.md) — 对照计划书 §19 验收清单的逐项实现说明。

---

## 当前边界

仓库已包含 SwiftUI iOS/macOS 客户端源码、Stripe 一次性收款实现和单机私有媒体流。商户沙箱/退款对账、大规模 CDN/HLS 或 OSS/S3、APNs/App Store 产品和正式法务/品牌授权仍需在具体部署环境配置并验收。
未获得书面授权前，本仓库中的品牌资料与文案不构成“网易有道官方出品”声明。

---

## 合规口径

健康类内容统一为「健康信息素养 / 就医前信息整理」，不做诊断、处方、用药建议；
防诈骗课仅讲识别与防范。健康/财务/防诈骗课程强制标注审核人与免责声明。

---

_v3.4 工程原型 · 2026-07_
