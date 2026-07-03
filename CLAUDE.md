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
- 主分支：feat/studio-v2-redesign（STUDIO 重构 + AI 自习室）
- 体验账号：demo@tide.learning/demo123(全站订阅)、admin@tide.learning/admin123(后台)
- LLM key 在 .env 的 DEEPSEEK_API_KEY（已 gitignore）；DeepSeek 账户余额为 0，AI 实际生成需充值
