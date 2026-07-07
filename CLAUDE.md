# tide-work / 有道自习室 STUDIO — 项目约定

## 部署 / 测试服务器端口（重要）

**不要用默认端口 3000 起 dev/测试服务器。** 用户的 3000 端口另有服务占用，用 3000 会冲突、导致页面卡顿。
- dev server 一律用 **3100**（或 3100 被占时依次 3200/3300）。
- 启动示例：`DATABASE_URL="file:./dev.db" PORT=3100 npm run dev`
- 浏览器验证也访问对应端口，如 `http://localhost:3100`。

## 容器宽度规范（STUDIO v2，防对齐漂移）
页面主容器 `max-w-` 只用这几档，别自创中间值：
- `max-w-[1120px]` → 内容网格页默认（成长档案 /me、课程库 /courses、我的课 /me/courses、创作者 /me/creator、收益 /me/earnings、设置 /me/settings、笔记馆、复习室、社区、用户主页等）
- `max-w-[1280px]` → 仅课程集市 /market 与管理后台 /admin（大屏专属）
- `max-w-[880px]` → 表格/双列数据页（学习记录 /me/history）
- `max-w-[760px]` → 单列文章/流式（隐私、条款、需求详情、复习流）
- `max-w-2xl`(640) 及以下 → 登录/支付/订阅管理等单列表单模态
页头统一写法：`<div className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">{英文小标} · {中文}</div>` + `<h1>`。

## 项目速览
- Next.js 15 App Router + Prisma/SQLite + Tailwind v4 + framer-motion + DeepSeek(deepseek-v4-flash)
- 设计系统：STUDIO v2（冷灰蓝 + 有道红 #FC011A 作专注信号 ~7% + 亮暗跟随系统）。见 docs/设计系统-STUDIO-v2.md
- AI 自习室架构（三引擎+中枢）见 docs/AI自习室架构.md
- 主分支：master（唯一主线；STUDIO 重构 + AI 自习室已全部并入。原 feat/studio-v2-redesign、feat/v1.0-upgrade 已合并并删除）
- 体验账号（支持 用户名/手机号/邮箱 登录）：dingyue/demo123(全站订阅, 或 demo@tide.learning)、admin/admin123(后台, 或 admin@tide.learning)。username 为体验账号预置，普通注册不设。
- LLM key 在 .env 的 DEEPSEEK_API_KEY（已 gitignore）；DeepSeek 账户余额为 0，AI 实际生成需充值

## 验证铁律
- **契约冒烟必须全绿**：改动任何 API route / DTO 后，跑 `bash scripts/contract-smoke.sh`，必须输出「契约冒烟 N/N 通过」并 exit 0。
  它以真实 HTTP 响应校验 iOS 消费的高危 DTO（LessonAggregate / MarketStall / ShelfCourse / DeskData / Note 等）的非 Optional 字段与日期格式；任一字段被删/改名/改类型即红，防止 Swift 解码整屏崩。需生产服务器在 3100 运行；脚本只读、可重复跑、不留脏数据。
- `npm test` 全绿（含 `tests/contract.test.ts`，服务器未起时该组自动 skip 不误红）。
- 涉及页面/类型改动跑 `npx tsc --noEmit` 无错。
- 服务端未捕获的 500 会落盘到 `logs/api-errors-YYYY-MM-DD.jsonl`（已 gitignore），在 `/admin/errors`（仅 admin 角色）查看近 200 条 + 今日计数。
