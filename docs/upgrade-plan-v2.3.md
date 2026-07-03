# 有道自习室 STUDIO · v2.3 升级方案（深度分析版）

> 状态：待实施 ｜ 基线：`feat/studio-v2-redesign` @ `13a4e7e`（v2.2 已上线本地测试端）
> 输入：用户 10 点实测反馈（2026-07-03 第二轮）+ 代码级根因排查
> 定位：**v2.2 建好了「家」的骨架，v2.3 要补的是「经济系统 + 社区生态 + 采集管道」三大缺失层，外加一次设计品味的整体拉升。**

---

## 0. 先认错：红框问题的真正根因（三次没修好的原因）

### 0.1 根因（这次是代码级实锤，不是猜测）

`src/app/globals.css:394`：

```css
:focus-visible {
  outline: 2px solid var(--color-accent-600);   /* ← v1 时代的有道红 token */
  outline-offset: 2px;
}
```

这是 **v1 时代的全局无障碍键盘焦点环**，用的是旧红色 token `--color-accent-600`。STUDIO v2 换 token 体系时全站都迁了，唯独漏了这一条全局规则。

**为什么我三次都修错了地方**：
1. 我一直在改 **form 容器的 border**（`focus-within:border-*`）—— 但红框根本不是 border，是画在 **input 元素上的 outline**。
2. 首页输入框有 `autoFocus` —— 页面加载时的自动聚焦会被浏览器按「键盘聚焦」规则判定，命中 `:focus-visible`，于是 2px 红色 outline 出现。
3. 我用 JS `.focus()` 实测时读的是 form 的 computed style（读错了元素），且脚本触发的聚焦多数浏览器不判定为 focus-visible —— 所以我测出「无红框」，和你看到的不一致。

### 0.2 修复方案（保住无障碍，换掉颜色）

- **不能直接删除**这条规则 —— 它是键盘用户的焦点环，删了是无障碍回退（taste 审计的 Preservation Rules 也明确禁止悄悄回退 a11y）。
- 修复：`outline: 2px solid var(--ink3)`（中性深灰，亮暗双主题下都可辨），offset 保留。
- 附加：首页输入框去掉 `autoFocus`（自动聚焦对首屏并非必要，且是触发条件；用户点击输入框的聚焦不会触发 focus-visible）。
- 全站扫尾：grep 所有 `--color-accent-*` 旧 token 残留，一次清完（这次漏网说明 v2 迁移有死角，要系统性扫）。

**验收**：无痕窗口打开 `/desk`，页面加载后无任何红框；Tab 键导航时焦点环为中性灰（无障碍保留）；grep `--color-accent` 全站 0 残留（globals 定义除外）。

---

## 1.【②社区空间】共创广场 → 社区空间：课程共享 + 积分 + X 式广场

### 1.1 现状诊断

- 「共创广场」= 投票排行榜 + 简易帖子列表，两个功能都停在 MVP 骨架：
  - **投票**：一行一条 + 票数进度条，无讨论热度、无趋势、无「为什么值得投」的说服面。
  - **广场**：纯文本帖 + 点赞，无转发/评论/图片/话题，离「社区」还差一整个互动层。
- **课程共享完全缺失**：用户 AI 造的课（`Course.origin=ai_generated/user_imported`）只能自己学，好内容无法流通 —— 而这恰恰是「AI 造课」最强的增长飞轮（我造的课有人想学 → 我有收益 → 更多人认真造课）。

### 1.2 方案设计

**信息架构**：`/demands` 更名 **社区空间**（导航同步），三 Tab：

```
[ 课程集市 ★新 ]  [ 课程共创（重设计） ]  [ 自习室广场（重设计） ]
```

**A. 课程集市（课程共享 + 积分获取，本轮核心新增）**

- **分享**：我的课详情页加「分享到社区」按钮 → 课程进入集市（状态 `shared`），展示：封面、标题、大纲预览（前 3 节标题）、作者、订阅申请数。
- **申请查看**：其他用户点「申请学习」→ 生成 `CourseAccessRequest(pending)` → 作者在「我的分享」里批准/拒绝 → 批准后申请者获得该课的学习权（只读学习，不可再分享）。
- **积分激励**：每次批准一个申请，作者 +N 积分（防刷：同一申请者对同一作者的课每门只计一次；作者自己申请自己 = 0 分）。
- **审核门槛**：分享前走一次 LLM 审核（复用 posts 的审核链路：黑名单秒拒 + LLM 判定），避免垃圾课污染集市。
- 数据模型（详见 §11）：`Course.sharedStatus` + `CourseAccessRequest` 表。

**B. 课程共创（投票重设计）**

现在的问题是「一张排行榜表格」，没有说服力和参与感。重设计为：

- **头部「本周之星」大卡**：票数第一的需求做成大卡（深色 Color Block，含票数趋势、支持者头像堆叠、预计排期），给「投票有用」的即时反馈。
- **需求卡升级**：每条加 讨论数 / 本周新增票数（↑12）/ 支持者头像堆叠(前5) / 一句话理由（发起人的 pitch）。
- **投票动效**：投票成功时票数数字滚动 + 进度条弹性增长 + 小型 confetti（红色粒子，克制），让「投出一票」有仪式感。
- **状态流可视**：collecting → evaluating → scheduled → producing → launched 做成横向阶段轨（已有 DemandStageTrack 组件，接到列表卡上）。

**C. 自习室广场（X/微博式重设计）**

现状是「文本+点赞」，目标是完整微内容流：

- **帖子能力**：文本 + **图片**（1-4 张，走上传框架 mock 存储）+ 话题标签（#面试英语、#AI办公）+ 关联课程卡（分享学习中的课，卡片内嵌）。
- **互动三件套**：点赞（已有）+ **评论**（盖楼一级评论即可，复用 DemandComments 模式）+ **转发/引用**（转发原帖到自己时间线，可附一句话）。
- **Feed 流**：默认「最新」，Tab 切「热门」（按 点赞+评论×2+转发×3 的热度分排序，24h 时间衰减）。
- **个人主页雏形**：点头像 → `/u/[id]`：该用户的帖子流 + 学生证摘要 + 分享的课程。这是社区的身份闭环，也复用 §3 学生证设计。
- **审核延续**：发布前 LLM 审核链路不变（黑名单 + 外链拦截 + 三态判定），图片本轮不做内容审核（标注 P1 风险项）。

### 1.3 涉及文件
`demands/page.tsx`（三 Tab 重构）、新建 `api/market/*`（分享/申请/批准）、`api/posts` 扩展（图片/评论/转发）、新建 `components/CourseMarket.tsx`/`PostCard.tsx`（重写）/`u/[id]/page.tsx`、`Sidebar.tsx`（改名）。

---

## 2.【③学生证】对标参考图重设计（极简高级证件）

### 2.1 参考图解析（你给的截图 2，我逐要素拆解）

| 要素 | 参考图做法 | 设计语言 |
|---|---|---|
| 底色 | 米白/暖纸色（非纯白非黑） | 实体证件卡纸质感 |
| 头像 | 浅灰圆底 + 单字 | 极简，无照片也高级 |
| 姓名 | 大号黑体 + 下方小号拼音 `LIN ZHIYAO` | 双语层次，证件惯例 |
| 右上 | 「静室 QUIETUDE」品牌位 | 主品牌名 + 英文小字 |
| 核心数据 | `1,284h / 128d / Lv.7` 大数字 + 小标签 `TOTAL HOURS / STREAK / 深度专注者` | **数字即视觉主体**，等宽字体，单位缩小上标 |
| 等级 | `Lv.7 深度专注者` —— 等级 + 称号 | 成长体系可视化，称号给情感价值 |
| 编号 | `SR·2024·0817` | 证件编号（年份+序号），比 hash 有意义 |
| 格言 | *"日拱一卒，功不唐捐"* 引号斜体 | 个性化人文层（用户可自定义） |
| 底部 | `JOINED 2023.09 · VALID 2026.09` | 入学/有效期，证件语法 |
| 右下 | 二维码 | 分享/验证入口，也是装饰性平衡 |

**结论：参考图的高级感来自「留白 + 大数字排版 + 证件语法（编号/有效期/二维码）+ 人文层（称号/格言）」，而不是深色酷炫。** 我 v2.2 的深色渐变方向本身就错了 —— 应该走**浅色纸质证件**路线。

### 2.2 方案设计

**新学生证（/me 头部 + 侧栏缩微版，同一设计语言两个尺寸）：**

- **底色**：`--surface` 暖白卡 + 极细 `--border`，四角 20px 圆角，纸质感（细噪点纹理，非渐变）。
- **布局**（对齐参考图）：
  - 左上：浅灰圆徽头像 + 姓名（大）+ 昵称拼音（mono 小字，pinyin 库或存储字段，MVP 可用 nickname 转写或留空）
  - 右上：`自习室 STUDIO` 品牌位（小字竖排感）
  - 中部：三个大数字 `累计 {N}h · 连续 {N}d · Lv.{N} {称号}`（mono 大字 + 小标签，单位小写上标风格）
  - 左下：证件编号 `YD·{入学年}·{4位序号}`（比 hash 更像证件；序号 = 注册当年的第几位用户，查询派生）+ **用户格言**（可编辑，默认一句预设，存 UserProfile.motto）
  - 底部：`JOINED {入学} · VALID FOREVER`（订阅用户显示有效期，永久权益显示 FOREVER）
  - 右下：**二维码**（指向 `/u/[id]` 个人主页，用轻量 qr svg 生成，无外部依赖或 `qrcode` 小包）
- **等级体系（新，支撑 Lv.N 称号）**：由累计学习时长派生（纯读时计算，不加表）：
  `Lv1 初来乍到(0h) → Lv2 渐入佳境(5h) → Lv3 小有所成(15h) → Lv4 持之以恒(40h) → Lv5 学有专精(100h) → Lv6 融会贯通(250h) → Lv7 深度专注者(600h) → Lv8 学海无涯(1500h)`
- **红色用量**：整卡几乎无红，只有左上一枚极小的红色校徽点（有道红方块 6px）。这符合参考图的克制，也符合 STUDIO 红=信号原则。
- 侧栏缩微版：同底色同语法，砍掉格言/二维码，保留 头像+姓名+编号+streak。

### 2.3 涉及文件
`me/page.tsx`（学生证 Plus 重写）、`Sidebar.tsx`（缩微版）、`UserProfile` 加 `motto` 字段、新建 `lib/level.ts`（等级派生）、`components/StudentCard.tsx`（抽成共用组件，两处渲染）、轻量 QR 生成。

---

## 3.【④笔记采集与导出】补齐 open-notebook 采集管道

### 3.1 现状诊断（我上轮吸收不全的部分，明确认账）

上轮吸收了 LeoJarvis 的：excerpt / source 来源 / 笔记本 / AI 产物落库。**没吸收的**（正是这次要补的）：

| LeoJarvis 能力 | 现状 | 缺失 |
|---|---|---|
| `POST /personal-notes/import-url` 链接导入（trafilatura 正文提取） | 无 | ★ 核心缺失 |
| `POST /personal-notes/import-attachment` 附件/图片导入 | 无 | ★ 核心缺失 |
| 附件表（file/mime/size/summary） | 无 | 缺 NoteAttachment |
| 多格式导出 | 仅全量 Markdown | 缺 单条/笔记本级 + 格式选择 |
| 版本历史 revisions | 无 | P1（上轮已立契约） |

### 3.2 方案设计

**A. 「记一条」升级为多源采集面板**

点「+ 记一条」弹出的不再是单一文本框，而是四个入口的采集面板：

```
[ ✏️ 随手写 ]  [ 🔗 链接导入 ]  [ 🖼 图片 ]  [ 📎 附件 ]
```

- **随手写**：现有独立笔记（保留）。
- **链接导入**：贴 URL → 服务端抓取正文（Node 侧用 fetch + 轻量正文提取：`@mozilla/readability` + `jsdom`，对标 trafilatura）→ 生成笔记（title=页面标题、contentMd=正文转md、source=`link_import`、sourceUrl 存原链）→ 进入编辑态让用户修剪。安全：仅允许 http/https、超时 10s、正文截断 50k 字、**SSRF 防护**（拒绝内网 IP/localhost）。
- **图片**：上传图片（复用 admin 上传框架的 mock 存储 `public/uploads/`）→ 生成 kind=capture 笔记，captureUrl 指向文件；P1 接 OCR/LLM 图片理解。
- **附件**：上传 pdf/docx/txt（≤10MB）→ 存 NoteAttachment → 笔记正文自动生成「附件摘要」（文本类直接抽前 2k 字给 LLM 总结；二进制类只挂附件）。

**B. 导出体系（notebook 项目能力对齐）**

- **单条笔记导出**：详情页「导出」→ Markdown / 纯文本 / **HTML**（带样式单文件，可直接分享/打印为 PDF）。
- **笔记本导出**：笔记本详情页「导出本册」→ 合并该本所有笔记为一个 Markdown/HTML（含目录）。
- **全量导出**：保留现有 `/api/notes/export`，加格式参数 `?format=md|html`。
- PDF 说明：服务端直接生成 PDF 需要重依赖（puppeteer），本轮用「HTML 导出 + 浏览器打印」路径达成同等效果，PDF 原生导出列 P1。

**C. 数据模型**：`Note.sourceUrl`（链接导入原地址）+ 新表 `NoteAttachment(id/noteId/fileName/mimeType/size/path/summary)`（对标 LeoJarvis personal_note_attachments）。

### 3.3 涉及文件
`ComposeDialog` 重构为采集面板、新建 `api/notes/import-url` / `api/notes/attachments`、`api/notes/export` 扩格式、`notes/[id]` 详情页加导出/附件区、schema 迁移。

---

## 4.【⑤复习室】体验升级：从"能用"到"想来"

### 4.1 现状诊断
一张卡翻面 + 记得/忘了，功能成立但体验寡淡：无进入仪式、无连击反馈、无结算成就、无声画层次 —— 复习是最需要「游戏感」来对抗枯燥的场景。

### 4.2 方案设计

- **入场仪式**：进入复习室先展示「今日任务卡」：N 张到期 · 预计 N 分钟 · 连续复习 N 天，点「开始」牌堆展开（卡片从堆叠状态扇形展开的入场动效）。
- **卡片体验**：
  - 3D 翻转保留，加**卡堆视觉**：当前卡后面露出下一张的边缘（堆叠层次），评分后当前卡飞出（记得→右飞+绿色轨迹淡出，忘了→左飞+红色），下一张从堆里上浮。
  - **连击系统**：连续「记得」出现 combo 计数（×3、×5 时卡片边缘微光 + 数字跳动），断掉归零 —— 记忆的正反馈。
  - 手势：桌面支持 ←/→ 方向键评分、空格翻面（键盘党复习效率）；移动端左右滑动评分。
- **结算页**：复习完不再是简单一句话，而是**结算卡**：本轮 N 张 · 正确率 N% · 最难卡 TOP3（忘了次数最多）· 下次到期预告（明天 N 张）· 连击最高 ×N，配 confetti（一次性，reduced-motion 降级）。
- **氛围细节**：复习中顶部一条「潮汐进度」水位线代替直进度条（复用 WaveProgress）；空态改成「今日无到期，去预习」的引导 + 手动「加练 10 张」按钮（从未到期卡里抽最早到期的 10 张）。

### 4.3 涉及文件
`review/page.tsx` 重构（任务卡/卡堆/连击/结算）、`globals.css` 加卡飞出 keyframes、`api/ai/review-card` GET 加统计字段（今日到期数/连续复习天数）。

---

## 5.【⑥学习台】改名 + 全局续学入口（你提了三次的，这次给系统性方案）

### 5.1 我之前理解偏了什么

你要的不是「书桌页有个继续学习卡」（那个 v2.2 做了），而是：
1. **「工作台」这个词要变成「学习台」**（Player 页面自称、面包屑、文案里所有「工作台」字样）。
2. **学习台要有全局入口** —— 不管在哪个页面，一键回到正在学的课的精确位置，而不是必须 课程库→课程详情→章节 三跳。

### 5.2 方案设计

- **改名**：全站文案「学习工作台/工作台」→「学习台」（grep 全量替换 + Player 页 metadata/面包屑）。
- **全局续学入口（核心）**：**Topbar 常驻「继续学习」胶囊**（登录且有学习进度时显示）：
  - 形态：顶栏搜索框左侧一个紧凑胶囊 `▶ 第1讲·认识AI办公助手 · 29%`（截断课名，红色小播放图标），点击直达 `learn/{lessonId}` 精确断点。
  - 数据：layout 已查 user，多查一条 learningProgress（React cache 去重，零额外成本）。
  - 移动端：底部 Tab 上方悬浮一个 mini 续学条（可滑走关闭，session 内记住）。
- **学习台内的连续性**：学完一节自动弹「下一节」卡（3 秒倒计时自动跳 or 手动点，可关），减少「学完一节就断」。
- 这样续学路径变成：**任何页面 → 1 击 → 精确断点**。

### 5.3 涉及文件
`Topbar.tsx`（续学胶囊）、`layout.tsx`（数据）、`Player.tsx`（改名+下一节卡）、全站文案 grep。

---

## 6.【⑦用户系统】积分 + Token 经济 + 管理后台（本轮最大的系统工程）

### 6.1 现状盘点（哪些有底子，哪些从零）

| 模块 | 现状 | 结论 |
|---|---|---|
| 角色权限 | `session.ts` 有 ROLE_PERMISSIONS（admin/content_manager/demand_moderator/support/finance/reviewer） + requirePermission | **有底子**，扩权限矩阵即可 |
| 管理后台 | /admin 已有 courses/demands/leads/orders/users/content-calendar | **有底子**，缺 积分/帖子审核/权限管理 三个页 |
| 积分 | 无任何字段/表 | **从零** |
| Token 计量 | `llm.ts` **没有记录 usage**（response 里有 usage 字段但被丢弃） | **从零**，这是积分系统的地基 |

### 6.2 积分经济设计

**记账模型（关键决策：流水表 + 余额缓存，不是只存余额）**

```prisma
model CreditAccount {           // 每用户一个账户
  userId  String @id
  balance Int    @default(0)    // 当前余额（由流水派生，写时同步更新）
  ...
}
model CreditLedger {            // 不可变流水（审计与对账的根）
  id        String
  userId    String
  delta     Int                 // 正=入账 负=消耗
  type      String              // monthly_grant / recharge / share_reward / llm_spend / admin_adjust
  refId     String?             // 关联订单/LLM调用/分享申请
  balanceAfter Int              // 快照，便于对账
  createdAt DateTime
}
model LlmUsage {                // Token 计量原始记录
  id        String
  userId    String
  scene     String              // generate_course / companion / note_transform / moderation ...
  promptTokens / completionTokens / totalTokens Int
  creditCost Int                // 本次折算积分
  createdAt DateTime
}
```

**Token → 积分换算**：
- `llm.ts` 的 chat() 返回值扩为 `{content, usage}`（DeepSeek 响应的 `usage.total_tokens` 现在被丢弃，捡起来）。
- 换算率配置化（AppConfig 表或环境变量）：如 `1000 tokens = 1 积分`，不同场景可加权（造课 1.0x、伴侣问答 0.5x —— 引导高价值使用）。
- **扣费策略**：调用前预检余额（不足 → 402 引导充值），调用后按实际 usage 记账。审核类系统调用（发帖审核）**不扣用户积分**（平台成本）。

**入账**：
- **月度赠送**：订阅用户每月 N 积分（订阅周期续费 webhook 触发 + 兜底：每次登录时惰性检查本月是否已发，避免依赖 cron）。
- **充值**：走现有 Order/mock-pay 链路加「积分包」商品（6/30/98 元档）。
- **分享奖励**：§1 课程集市的批准申请 +N。

**UI**：
- `/me` 学生证下方加「积分卡」：余额大数字 + 本月消耗曲线迷你图 + 明细入口 + 充值按钮。
- LLM 功能出口处显示预估消耗（造课页「本次约消耗 ~N 积分」）。

### 6.3 管理后台补全

- **权限矩阵页 `/admin/permissions`**（admin 专属）：角色 × 权限点表格可视化（现有 ROLE_PERMISSIONS 从代码常量升级为 DB 表 `RolePermission`，admin 可勾选调整，代码保留默认兜底）。
- **积分管理 `/admin/credits`**：用户积分查询/手动调账（记 admin_adjust 流水+操作人）/换算率配置/月度赠送额配置。
- **内容审核台 `/admin/moderation`**：pending 帖子人工复核队列（LLM 拿不准的都在这）+ 课程集市分享审核 + 拒绝理由模板。
- **用户管理增强**（现有 /admin/users）：加 角色调整（仅 admin 可操作）/封禁/积分列。
- **管理入口**：管理员登录后 Topbar 出现「管理后台」按钮（现在藏在 /me 菜单里，问题 ⑧ 顺带解决）。

### 6.4 涉及文件
schema（4 新表）、`llm.ts`（usage 捕获）、`lib/credits.ts`（记账核心：入账/扣费/对账，事务保证）、全部 AI route 接扣费、新建 3 个 admin 页、`me` 积分卡、充值商品接 Order。

---

## 7.【⑧信息架构拆分】/me 与设置系统重构

### 7.1 现状问题（实锤）

`/me` 底部现在堆着：订阅管理 / 我的笔记 / 设置 / 我的共创需求 / 运营后台入口 / 客服反馈 / 退出 / 注销 —— **档案页变成了杂物抽屉**。

### 7.2 拆分原则：「看自己」的留在档案，「改配置」的进设置

```
/me 成长档案（只留身份与成长）        /me/settings 设置中心（重构为分区页）
├─ 学生证（§2 新版）                  ├─ 账号安全：昵称/头像/格言/手机/密码/注销
├─ 积分卡（§6 新增）                  ├─ 订阅与积分：订阅管理入口/积分明细/充值
├─ 学习进度（保留）                    ├─ 偏好：长辈模式/字号/主题/通知开关
├─ 成长足迹（保留）                    ├─ 隐私与数据：导出我的数据(笔记全量)/清除记录
└─ (删除底部杂项菜单)                  └─ 帮助：客服反馈/关于/条款
退出登录 → 移到侧栏学生卡 hover 菜单     运营后台入口 → Topbar（仅管理角色可见）
「我的笔记/共创需求」→ 删（导航已有笔记馆/社区空间，重复入口是混乱源头）
```

设置中心做成**左锚点导航 + 右分区卡**的两栏布局（桌面），移动端为分组列表 —— 对齐主流 App 设置页心智。

### 7.3 涉及文件
`me/page.tsx`（删杂项）、`me/settings/page.tsx` 全重构（顺带把它从旧 token 迁到 STUDIO v2 —— 排查发现它还在用 v1 的 ink-100/paper-raised 旧 token，是全站最后一个没迁的页面）、`Topbar.tsx`（管理入口）、`Sidebar.tsx`（学生卡 hover 退出）。

---

## 8.【⑨模拟考试】复习室的第二引擎

### 8.1 方案设计

**入口**：复习室顶部双 Tab：`[ 每日复习 ]  [ 模拟考试 ★新 ]`

**出卷（AI，根据个人学习内容）**：
- 选范围：某门课 / 某笔记本 / 全部已学内容（默认最近学的课）。
- 选规格：题量（5/10/20）× 题型（单选/判断/简答混合）× 难度（基础/进阶）。
- 生成：新 route `api/ai/generate-exam` —— 服务端拉取范围内的 lesson blocksJson（已有 quiz/keypoint 块是天然题源）+ 用户笔记，LLM 出题输出严格 JSON `{questions:[{type,stem,options?,answer,explanation,sourceRef}]}`；走标准模板（鉴权/限流/积分扣费/注入防御），**校验层**保证选择题 options 含 answer、题量不符自动剔除坏题。
- 落库：`Exam` + `ExamQuestion`（试卷可重考、可回看）。

**考试体验**：
- 答题页：一题一屏（进度点导航可跳题）、倒计时（可选）、简答题自由文本。
- **判卷**：客观题即时判；简答题 LLM 判分（0-10 分 + 一句评语，宽容评分 prompt）。
- **成绩单**：总分大数字 + 各题对错回顾（错题展开解析 + 「来自第 N 讲」溯源链接）+ **错题一键生成复习卡**（错题转 ReviewCard 进每日复习 —— 考试与间隔重复闭环，这是整个学习闭环的最后一块）。

### 8.2 涉及文件
schema（Exam/ExamQuestion/ExamAttempt）、`api/ai/generate-exam` + `api/exams/*`（提交/判卷）、`review/page.tsx`（双 Tab）、新建 `components/ExamRunner.tsx`。

---

## 9.【⑩全局排查】缺失逻辑与环节清单（主动补位）

按「用户生命周期」逐环节扫了一遍，以下是发现的缺口（按严重度）：

| # | 缺口 | 严重度 | 处置 |
|---|---|---|---|
| G1 | **忘记密码/改密码不存在**（login 只有登录注册；settings 无改密码） | 高 | v2.3 做改密码（登录态）；忘记密码依赖短信/邮件通道，mock 通道先做流程 |
| G2 | **移动端底部 Tab 未同步 v2.2**：还是 5 Tab 但「我的」指 /me，无复习室；书桌 Tab 已改但需复核 | 高 | 随 §7 IA 一并修 |
| G3 | **通知系统缺失**：申请通过/帖子被评论/课程更新，用户无从知晓 —— §1 社区做完后是刚需 | 高 | v2.3 做站内通知（Notification 表 + Topbar 铃铛 + 列表页），推送渠道 P1 |
| G4 | **全局搜索（⌘K）覆盖不全**：搜不到帖子/笔记本/自己的课 | 中 | 扩 CommandK 数据源 |
| G5 | **learningProgress.completedAt 从未写入** → 完课数恒 0（v2.2 agent 发现的数据问题） | 中 | Player 进度保存时：progressSec≥90% 时长写 completedAt |
| G6 | **me/settings 还在用 v1 旧 token**（全站最后一页） | 中 | 随 §7 重构顺带迁移 |
| G7 | **speak/微信登录是 authProvider 字段但无入口**；第三方登录缺失 | 低 | P1（依赖微信开放平台资质） |
| G8 | **图片上传无内容审核**（§1 广场图片、§3 附件） | 低 | 标注风险，P1 接图片审核 |
| G9 | **数据导出/账号数据合规**：注销账号有入口但数据处理逻辑未知，需核查是否真删 | 中 | 随 §7 隐私分区一并核查补齐 |
| G10 | **积分/权限等新系统的操作日志**：admin 调账/改权限需要 AuditLog | 中 | 随 §6 一并建 AuditLog 表 |

---

## 10. 数据模型变更汇总（v2.3 全量）

```prisma
// §1 课程集市
Course { sharedStatus String @default("private") }  // private/pending/shared/rejected
model CourseAccessRequest { id userId courseId status(pending/approved/rejected) createdAt decidedAt }

// §1 广场升级
Post { images String? /*json数组*/  topicTags String?  repostOfId String?  commentCount Int }
model PostComment { id postId userId content status createdAt }

// §2 学生证
UserProfile { motto String? }

// §3 笔记采集
Note { sourceUrl String? }
model NoteAttachment { id noteId fileName mimeType size path summary? createdAt }

// §6 积分经济（核心）
model CreditAccount { userId balance monthlyGrantedAt }
model CreditLedger  { id userId delta type refId balanceAfter createdAt }
model LlmUsage      { id userId scene promptTokens completionTokens totalTokens creditCost createdAt }
model RolePermission{ role permission }           // 权限矩阵落库
model AuditLog      { id actorId action targetType targetId detail createdAt }

// §8 模拟考试
model Exam         { id userId title scope difficulty status createdAt }
model ExamQuestion { id examId type stem optionsJson answer explanation sourceRef order }
model ExamAttempt  { id examId userId answersJson score total finishedAt }

// §9 通知
model Notification { id userId type title body refType refId readAt createdAt }
```

---

## 11. 分期实施计划（依赖排序）

| 批次 | 内容 | 为什么这个顺序 |
|---|---|---|
| **P0 热修** | §0 红框根因修复 + 旧 token 全站扫尾 + G2 移动 Tab + G5 completedAt | 全是小改，先还清人品债 |
| **C1 经济地基** | §6 llm.ts usage 捕获 → 积分四表 + 记账核心 + AI route 接扣费 | 一切奖励/消耗系统的地基，集市与考试都依赖它 |
| **C2 身份层** | §2 学生证重设计 + 等级体系 + §7 /me与设置拆分 + G1 改密码 | 学生证是社区个人主页的原料 |
| **C3 社区** | §1 课程集市 + 投票重设计 + X式广场 + G3 通知系统 | 依赖 C1 积分（分享奖励）+ C2 身份（个人主页） |
| **C4 学习深化** | §3 笔记采集/导出 + §4 复习室升级 + §8 模拟考试 + §5 学习台全局入口 | 相互独立，可并行 |
| **C5 管理后台** | §6 后台三页 + 权限矩阵 + AuditLog + G10 | 收口全部新系统的管理面 |
| **C6 验证** | tsc/test/build + 生产实测 + 全链路走查（积分记账对账/考试闭环/集市申请流）+ push | 硬标准同 v2.2，另加「积分流水与余额对账一致」专项 |

**风险与边界声明**：
- 积分涉及「钱」（充值），mock 支付链路继续沿用，真实支付仍等商户资质 —— 但**记账模型按真实标准建**（流水不可变、余额可对账、调账留审计），后续接真支付零改造。
- 链接导入的 SSRF 防护、图片无审核、简答题 AI 判分的争议性，三处风险已在各节标注。
- X 式广场做到「文本+图+评论+转发」即止，私信/关注流/推荐算法明确不做（社交产品的深水区，等社区冷启动数据）。

---

## 12. 一句话总结

v2.2 建了「家」，v2.3 要建的是**经济系统（积分/Token）、社区生态（集市/广场）、采集管道（链接/附件）、考试闭环（错题→复习卡）** 四根柱子，外加把学生证拉到参考图的品味线上。红框的真凶（globals.css:394 全局红色 focus 环 + autoFocus）这次是代码级实锤，P0 必修。
