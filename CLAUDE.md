# tide-work / 有道自习室 STUDIO — 项目约定

## 部署 / 测试服务器端口（重要）

**不要用默认端口 3000 起 dev/测试服务器。** 用户的 3000 端口另有服务占用，用 3000 会冲突、导致页面卡顿。
- dev server 一律用 **3100**（或 3100 被占时依次 3200/3300）。
- 启动示例：`DATABASE_URL="file:./dev.db" PORT=3100 npm run dev`
- 浏览器验证也访问对应端口，如 `http://localhost:3100`。

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
