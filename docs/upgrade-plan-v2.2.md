# 有道自习室 STUDIO · v2.2 升级方案

> 状态：待实施 ｜ 基线：`feat/studio-v2-redesign` @ `65a61dc`（v2.1 全量已上线）
> 输入：用户 8 点实测反馈 + taste-skill 设计审计 + ponytail 臃肿审计 + LeoJarvis 笔记能力调研 + open-notebook 理念
> 原则：**书桌是家，笔记是资产，进度是身份**。红色只做信号，不做装饰。

---

## 0. 本轮定位

v2.1 把「卖课平台」的骨架换成了「AI 自习室」，但实测暴露出三类残留问题：

1. **信息架构缺位**：书桌寄生在首页、笔记强绑课程、复习页无入口、成长激励还是旧版 —— 核心概念有了，但「家」没建好。
2. **细节假**：侧栏 28 天是硬编码、红色 focus 框无信息量、点击跳转慢 —— 破坏可信度的都是小事。
3. **笔记只有课程笔记**：没有独立笔记、没有笔记本、没有版本与来源 —— 离「知识资产」还差一层。

v2.2 就修这三类。每节含：根因 → 方案 → 涉及文件 → 验收标准。

---

## 1. 【①红框】输入框 focus 视觉降噪

**根因**：`StudyDesk.tsx:130` 输入框容器 `focus-within:border-[var(--red-soft-border)]`，聚焦时整圈红框。红色在 STUDIO 语义里是「专注信号/CTA」，用在 focus ring 上既刺眼又稀释红的信号价值（taste 规则：accent 一旦选定语义就要锁死）。

**方案**：
- focus 态改中性强化：`focus-within:border-[var(--ink3)]`（边框加深一档）+ `focus-within:shadow-[var(--lift)]`（已有，保留）。
- 红只保留在**发送按钮**的可用态（有输入内容时按钮从 ink4 → red，这才是有信息量的红）。
- 全站排查同类：登录表单、搜索框、发帖 textarea、笔记编辑器 —— focus ring 统一走中性 token，一次修完。

**文件**：`StudyDesk.tsx`、`PostComposer.tsx`、`NoteEditor.tsx`、`login/page.tsx`、`Topbar.tsx`（搜索）。

**验收**：聚焦任何输入框无红框；输入内容后发送按钮变红；亮暗两主题下 focus 态清晰可辨。

---

## 2. 【②独立书桌】/desk 成为登录后的「家」+ 断点续学中心

**根因**：自习桌只寄生在 `/` 的登录分支。用户从任何页面想回书桌，只能点「首页」；而「首页」的心智是营销页。断点续学能力（learningProgress 数据已有）没有一个稳定的承载位。

**方案**：
- **新路由 `/desk`**：现 StudyDesk 组件整体迁移至此，成为登录用户的默认落点。
- **路由策略**：
  - `/` 未登录 → 营销版（现状不变）。
  - `/` 已登录 → `redirect("/desk")`（server 端，零闪烁）。
  - 导航「首页」项：登录后 label 显示「书桌」、href 指 `/desk`；未登录仍是「首页」→`/`。
- **断点续学强化**（书桌新增「学习中」区块，替代单一继续学习卡）：
  - 查 learningProgress 按 updatedAt 倒序取 3 门课，每门显示：封面缩略 + 课名 + **精确断点**（第 N 讲 · 播放到 mm:ss / 块课件第 N 块）+ 进度环 + 「从上次继续」按钮直达 `learn/{lessonId}?t={sec}`。
  - 第一张为大卡（现有继续学习卡样式），其余两张降权小行。
- **登录/注册成功后的跳转目标**改为 `/desk`。

**文件**：新建 `src/app/desk/page.tsx` + `desk/loading.tsx`；`src/app/page.tsx`（加 redirect）；`Sidebar.tsx`（导航双态）；`login` 成功回跳。

**验收**：登录后任意页点「书桌」直达；`/` 已登录自动进书桌；三门学习中课程都能一键回到精确断点；未登录 `/` 仍是营销页。

---

## 3. 【③笔记独立】笔记详情页 + 弱化工作台绑定

**根因**：`notes/page.tsx` 里每条笔记卡整体是 `<Link href="/courses/.../learn/...">` —— 点笔记 = 被扔进学习工作台。笔记没有自己的详情视图，「资产」变成了课程的附属品。

**方案**：
- **新建笔记详情页 `/notes/[id]`**：
  - 展示：标题、正文（Markdown 渲染）、标签、创建/更新时间、截帧图（capture 类）、划线原文（clip 类）。
  - **就地编辑**：详情页直接可编辑（复用 NoteEditor 的工具栏），保存走现有 PATCH `/api/notes/[id]`。
  - **来源锚点降级为一个小组件**：卡片底部一行「📍 来自《课名》第 N 讲 mm:ss → 回到此处」，点它才去工作台。笔记卡本体点击进详情页。
- **列表页改造**：笔记卡主体 → `/notes/[id]`；卡内保留课程来源小字（不可点击整卡跳课）。
- AI 整理（AiTidyMenu）在详情页也挂一份（scope=单条笔记）。

**文件**：新建 `src/app/notes/[id]/page.tsx`；改 `notes/page.tsx` 卡片链接；`NoteEditor.tsx` 抽出可复用编辑器。

**验收**：点笔记进详情而非工作台；详情页可编辑保存；「回到课程位置」链接精确带时间戳；AI 整理在详情页可用。

---

## 4. 【④学生证】侧栏底部改为真实数据「学生卡」

**根因**：`Sidebar.tsx:117-130` 的连续学习卡是**硬编码 28 天 + 假格子**，不可点击，长得像个统计残片而非身份物。

**方案**：改成「学生证」（Student ID Card）隐喻：
- **内容**：头像（首字圆徽）+ 昵称 + `mono` 学号（userId 短哈希，如 `STU-8F3K2`）+ 入学时间（注册日期「入学 2026.05」）+ **真实连续天数**（streak 数据服务端传入）+ 会员徽标（已订阅显示小皇冠）。
- **设计**：横向小卡，左侧 3px 红色竖条（学生证的「校色条」），底部一行 `mono` 极小字 `YOUDAO STUDIO · STUDENT ID`。质感用 `--surface` + `--card` 阴影，不做拟物。
- **交互**：整卡可点 → `/me`（成长档案，见 §5）；hover 用 `.studio-lift`。
- **数据**：Sidebar 是 client 组件，由 `layout.tsx` 把 `{nickname, joinedAt, streak, isSubscriber}` 作为 props 传入（layout 已查 user，streak 加一个轻查询并被 React cache 去重）。
- 未登录：这个位置换成「登录，领取你的学生证」引导卡。

**文件**：`Sidebar.tsx`、`src/app/layout.tsx`（补数据）、`src/lib/gamification.ts`（streak 查询复用）。

**验收**：天数与 `/me` 一致（同一数据源）；点击进 `/me`；未登录显示引导卡；无任何硬编码数字。

---

## 5. 【⑤成长档案】/me 重构：学习进度 ⊃ 成长激励

**根因**：`/me` 还是 v1 的「成长激励」（streak+徽章+周节奏+潮汐日历），v2.1 未动。概念也反了 —— 应该是**学习进度为主体，激励是进度的副产品**。

**方案**：`/me` 重构为「成长档案」（三段式）：

1. **学生证 Plus（头部横幅）**：侧栏学生卡的放大版 —— 左：大头像+昵称+学号+入学时间+订阅状态；右：三个 `mono` 核心数（累计学习时长 / 完课数 / 笔记数）。深色卡（`--video-bg`），这是全站唯一的"证件级"深色横幅，红色校条贯穿左缘。
2. **学习进度（主体，新）**：
   - 「学习中」列表：每门课 = 课名 + 进度条 + 当前讲 + 最近学习时间 + 继续按钮（与书桌数据同源，此处是全量列表非 top3）。
   - 「已完成」折叠区：完课列表 + 完成日期。
   - 「我的复习」入口卡：到期卡数 + 直达 `/review`。
3. **成长激励（收编为第三段）**：现有 streak 深卡 / 本周节奏 / 徽章墙 / 潮汐日历整体下移保留，视觉降一档（不再是页面主角）。

**文件**：`src/app/me/page.tsx` 重构；`src/lib/queries.ts` 补「学习中课程全量+进度」查询。

**验收**：/me 首屏是"我是谁+学到哪"而非徽章；每门课可直接继续；激励内容完整保留在下方；亮暗双主题通过。

---

## 6. 【⑥卡顿】导航跳转性能补齐

**根因**（双层）：
1. dev 模式按需编译是主因（生产 build 后消失，已验证 build 通过）。
2. 但**四个页面缺 loading.tsx**：`me/courses`、`me/subscription`、`me/settings`、`demands/[demandId]` —— 点过去无任何反馈，感知为"卡死"。

**方案**：
- 补上述 4 个 `loading.tsx`（贴合各页真实布局的骨架）。
- `Sidebar`/`Topbar` 的 `<Link>` 保持默认 prefetch（Next 15 视口内自动预取，确认没有被 `prefetch={false}` 关掉）。
- 重查询页面二次优化：`demands/[demandId]`（详情+评论+投票三查询并行化 `Promise.all`）。
- **交付一个生产模式验证脚本**：`npm run build && PORT=3100 npm start`，方案落地后用生产模式实测页面切换 <300ms，并把结果记录在验收里 —— 回应「担心线上更糟」：线上只会比 dev 快一个数量级。

**文件**：4 个新 loading.tsx；`demands/[demandId]/page.tsx` 查询并行化。

**验收**：dev 模式下任何导航点击 ≤100ms 出现骨架；生产模式实测切换 <300ms 并截图留档。

---

## 7. 【⑦营销首页】确认存在 + 内容升级

**澄清**：营销首页**一直在** —— 未登录访问 `/` 就是它（Hero+赛道+共创/订阅 teaser）。你全程登录态所以没见过。

**方案**（顺手升级它，让它配得上 v2.2 的产品叙事）：
- Hero 叙事从「订阅课程」转向「AI 自习室」：主标题突出「说出你想学的，AI 帮你造一门课」，副 CTA 才是浏览课程库。
- 新增「三引擎」区块：AI 造课 / 资料升维 / AI 伴侣，各配一句能力说明 + 微演示（静态截图即可，不做假 UI）。
- 新增「学习闭环」区块：学 → 记 → 复习 → 社区，对应书桌/笔记馆/复习室/广场四入口。
- 底部保留课程赛道 + 订阅 teaser。
- 顶部导航给未登录态一个明显的「免费体验」CTA（注册后直接落到 `/desk`）。

**文件**：`src/app/page.tsx` 的 MarketingHome 函数。

**验收**：无痕窗口访问 `/` 能一屏看懂「这是 AI 自习室不是网课商城」；注册转化路径 ≤2 步进书桌。

---

## 8. 【⑧笔记系统】升维为独立知识引擎（借鉴 LeoJarvis + open-notebook）

**根因**：现在笔记 = 课程笔记（Note.courseId/lessonId **必填**），没有独立笔记；「时间轴」是默认视图所以点了没反应；没有普通列表；v2.1 建的 **Notebook/NotebookEntry 表零使用**；`/review` 无导航入口。

**LeoJarvis 可借鉴的核心设计**（调研结论，文件佐证在 LeoJarvis-runtime）：

| LeoJarvis 设计 | 借鉴到 STUDIO |
|---|---|
| `excerpt` 独立存储，列表不动态截断 | Note 加 `excerpt` 字段，写入时生成 |
| 每次编辑自动版本化（revisions 表 + reason） | 新表 NoteRevision（P1，详情页「历史版本」+一键回滚） |
| `source` 来源追踪（manual/link/attachment/ai_transform） | Note 加 `source` 字段：`lesson`（课程内记）/ `manual`（独立记）/ `ai_transform`（AI 整理产物） |
| project_name 笔记本分组 + pinned/favorite/archived | **激活 Notebook 表**：笔记可归入笔记本；Note 加 `pinned` |
| AI 转化产物存为一级笔记（可编辑可回滚），不是临时弹窗 | AI 整理结果从 Dialog 展示改为「存为新笔记」（source=ai_transform，标签「AI 整理」），Dialog 只做预览+确认 |
| Notebook RAG 问答，逐句 [n] 引用可回链 | P1：笔记本级「问我的笔记」，引用回链到具体笔记 |
| 工作室模板（概览/FAQ/时间线/学习指南） | 已有 note-transform 四 action，补「学习指南」模板并支持按笔记本为范围 |

**方案（P0 本轮）**：

- **8.1 数据迁移**：Note.courseId/lessonId 改**可空**（独立笔记无课程）；加 `excerpt`、`source`、`pinned` 字段。SQLite `db push` 直接生效，现有数据 source 回填 `lesson`。
- **8.2 独立笔记（日常笔记）**：
  - 笔记馆头部加「+ 记一条」按钮 → 独立笔记编辑（无课程绑定，复用 NoteEditor 全能力：工具栏/模板）。
  - 视图 Tab 重构为：**「全部」（默认，普通列表：pinned 优先 + 更新时间倒序，每条=标题+excerpt+来源标识+标签）/「时间轴」（现有）/「画廊」（现有）/「按课程」（现有）/「笔记本」（新）**。默认落在「全部」——解决"时间轴点了没反应"（它不再是默认态，且列表是普通可点击列表）。
- **8.3 激活笔记本（Notebook 表）**：
  - 「笔记本」Tab：网格展示用户的笔记本（icon+标题+条数），可新建/重命名/删除。
  - 笔记详情页可「归入笔记本」；笔记本详情 = 该本笔记列表 + 本级 AI 整理（大纲/学习指南，range=notebook）。
  - CRUD route：`/api/notebooks`（GET/POST）、`/api/notebooks/[id]`（GET/PATCH/DELETE，全部强制 where userId）。
- **8.4 复习入口**：Sidebar「学习」组加「复习室」`/review`（icon: Cards）；书桌「待复习」卡与 /me 复习卡均指向 `/review`（改现指向 /notes 的链接）。
- **8.5 AI 整理产物落库**：note-transform 各 action 的结果 Dialog 增加「存为笔记」按钮 → POST /api/notes（source=ai_transform，可选归入当前笔记本）。

**P1（下轮，本方案先立契约）**：NoteRevision 版本历史 + 回滚；笔记本 RAG 问答（引用回链）；链接导入（URL → 正文提取 → 笔记）。

**文件**：`prisma/schema.prisma`；`notes/page.tsx`（视图重构）；新建 `notes/[id]/page.tsx`、`notes/new`（或 Dialog 内建）、`api/notebooks/*`；`Sidebar.tsx`；`StudyDesk.tsx`（复习链接）。

**验收**：不进任何课程也能记笔记；默认视图是可点击的普通列表；笔记本可建可归档可整理；AI 整理结果能沉淀为笔记；复习室在导航可达。

---

## 9. 设计优化专项（taste-skill 审计 · 已完成）

**整体设计健康度：7/10** —— 品牌一致性 9/10（红占比 ~6.5% 执行到位）、无致命 slop；短板在**布局多样性与交互深度**。三 Dial 现状：`DESIGN_VARIANCE 6 / MOTION_INTENSITY 6 / VISUAL_DENSITY 6`，目标 `7 / 7 / 6`。

### 9.1 确认违规与修复（按优先级）

| 级别 | 问题 | 证据 | 修复 |
|---|---|---|---|
| HIGH | **首页营销态 eyebrow 5 段里 4 个**（TRACKS/CO-CREATE/SUBSCRIBE/CATEGORY…） | `page.tsx:187,266,349,374,431` | 配额「每 3 section 最多 1 个」：只留 `SHELF · NEW`，其余改常规小标题（§7 营销首页升级时一并做） |
| HIGH | **/me 布局重复 66%**：6 个同款 `studio-rise` 白卡 section | `me/page.tsx:59-223` | §5 重构直接解决（三段式 = 深色证件横幅 + 进度列表 + 激励区，三种 layout family） |
| MED | **StudyDesk 4 个 eyebrow**（DESK/NOTES/ADVICE/FOCUS） | `StudyDesk.tsx:118,176,219,292` | 只留首屏 1 个，其余 3 个改 h3 常规标题 |
| MED | **课程卡网格宽屏无上界** | `courses/page.tsx:54` 等 3 页 | `lg:grid-cols-3` → `lg:grid-cols-3 xl:grid-cols-4` |
| MED | **侧栏 28 天硬编码** | `Sidebar.tsx:123` | §4 学生证真实数据，根治 |
| MED | **页面转场过简**：路由切换仅淡入淡出 | 全站 | 轻量「点亮」转场：进入页面时主内容 `.studio-rise` 已有，补 Sidebar active 指示条滑动动画（一个 layoutId 即可，不做全屏转场） |
| LOW | **主 CTA 缺物理反馈** | 全站按钮 | 主 CTA（发送/生成课程/进入专注）加轻磁吸 hover（Motion useMotionValue，仅 3-4 处，不全站铺） |
| LOW | **头部留白过大** | `courses`/`notes` 页头 | 压缩 section 头部垂直间距一档 |

### 9.2 审计通过项（不动）

- **深色岛 4 处**（共创 banner / AI 建议卡 / 订阅深卡 / streak 卡）：全部属于刻意 Color Block，占比 <2%，符合 STUDIO「对比强调」哲学。§5 学生证 Plus 加入后仍守「每页 ≤1 处」。
- **中文双破折号（——）**：3 处 UI 文案保留 —— 中文排版规范允许，不套英文 em-dash 禁令。
- **装饰圆点**：3 处均为有语义的状态点（live/badge），合规。
- **对比度**：ink4 亮色 4.1:1 / 暗色 5.8:1，AA 达标。
- **动效债务**：无 scroll listener、无 useState 追踪连续值；8 处 infinite 动画均有语义、占比 <3%。
- **z-index**：40/50/60 三层有序。

### 9.3 Variance 深化（把 6 提到 7 的三个具体动作）

1. **/me 三段式**（§5）：证件横幅（深色横向）+ 进度列表（行式）+ 激励网格（卡式）—— 一页三种 layout family。
2. **书桌非对称**：「我的书桌」三卡从等宽 grid-cols-3 改为 `2fr 1fr 1fr`（最近笔记为主卡，课数/复习为窄卡）。
3. **笔记馆「全部」列表**（§8.2）：行式列表 + pinned 置顶区，与画廊/时间轴形成三种密度形态。

## 10. 代码瘦身专项（ponytail 审计 · 已完成）

**总体臃肿度：6.0/10（中等偏高）**。结论：架构不烂，问题是「机械重复没打包 + 大组件没拆」；安全样板（每个 route 显式鉴权/限流/越权防护）属于**有道理的显式重复，不动**。

### 10.1 确认的瘦身项（按 ROI 排序）

| 级别 | 项目 | 证据 | 动作 | 削减 |
|---|---|---|---|---|
| P0 | **卡片样式串重复 30 次** | `rounded-[16px] border border-[var(--border)] bg-[var(--surface)]` 遍布 14+ 文件 | globals.css 加 `.card-base` 组件类，全站搜替 | ~2KB 噪音 |
| P0 | **8 个 loading.tsx 高度重复** | 除 courses 外 7 个全是内联骨架，模式逐字相似 | 抽 `SkeletonCard/SkeletonRow/SkeletonStat` 三原语 + 各页组合（**不做**配置驱动大一统——复杂页布局差异真实存在，过度抽象降低可读性） | ~250 行 |
| P0 | **slugify() 两处逐字重复** | `generate-course/route.ts:13` 与 `import-source/route.ts:13` | 提到 `lib/format.ts` | 4 行 |
| P1 | **CreateStudio.tsx 846 行** | 生成+导入两条完整流程挤在一个文件 | 拆 `GenerateFlow` + `ImportFlow` + 共用 `TheaterProgress` | ~250 行 |
| P1 | **notes/page.tsx 584 行** | 列表+筛选+AI 菜单+Dialog 全在一页 | 拆 `NotesList` / `NoteFilters` / `AiTidyMenu`（§8 笔记重构时顺手做，不单独立项） | ~230 行 |
| P1 | **AI route 拉笔记/拼上下文逻辑三处重复** | review-card / note-transform / note-summary 各写一遍「拉本人未删笔记 + map 成纯文本」 | 提 `lib/note-context.ts`（`fetchUserNotes` + `notesToPrompt`） | ~30 行 |
| P2 | **motion.tsx 303 行包装层** | 大量薄包装组件 | 仅删除确认零引用的包装；有引用的不动（历史组件依赖） | ~100 行 |
| P2 | **geist 依赖疑似未用** | package.json 有、grep 零导入 | 验证后 `npm rm geist` | 依赖-1 |
| P3 | **死 keyframes** | `wave-x`/`dot-wave`/`breathe`/`ripple` 等疑似零引用 | 逐个 grep 确认后删除（`shimmer`/`riseIn`/`slideIn`/`lightUp` 在用，保留） | ~40 行 |
| P3 | **visibility="shared_later"** | schema 字段零读写 | 保留字段（分享是明确的产品方向，删了还得加回来），标注 P1 用途 | 0 |

### 10.2 审计结论的两处纠偏（以本方案为准）

- 审计建议「删 Notebook/NotebookEntry 死表」→ **不删，§8.3 激活它**。零使用是 v2.1 只建表没建 UI 的欠账，不是 YAGNI。
- 「AI route 样板 withAIRoute HOC」→ 采纳审计的最终判断：**现状保留**。显式样板让每个 route 的安全边界一目了然，10 个 route 不到抽象阈值；route 数 >20 时再抽。

### 10.3 明确不动的「合理臃肿」

- 每个 route 显式的 assertSameOrigin/requireUser/限流/越权 where userId —— 安全代码要显眼，不要藏进 HOC。
- Player.tsx 722 行 —— 学习工作台核心交互，内聚复杂度合理；§8 笔记重构若顺手抽出笔记面板则降到 ~550，不强求。
- 各 loading.tsx 的布局差异 —— 骨架必须贴合真实页面，统一原语即可，不做大一统。

---

## 11. 信息架构（v2.2 定稿）

```
学习 LEARN          社区 COMMUNITY       我的
├─ 书桌 /desk★      ├─ 社区广场 /demands  ├─ 成长档案 /me★(重构)
├─ 课程库 /courses   └─ 订阅方案 /pricing  └─ 设置 /me/settings
├─ AI 造课 /create
├─ 我的课 /me/courses
├─ 笔记馆 /notes★(重构)
└─ 复习室 /review★(新入口)

未登录: / = 营销首页★(内容升级)   登录: / → redirect /desk
移动端 5 Tab: 书桌 · 课程 · [造课凸起] · 笔记 · 我的
```
（★ = 本轮变更；「成长激励」改名「成长档案」）

## 12. 数据模型变更

```prisma
model Note {
  courseId String?   // 改可空：独立笔记
  lessonId String?   // 改可空
  excerpt  String?   // 新增：列表预览（写入时生成，≤120字）
  source   String @default("lesson") // 新增：lesson/manual/ai_transform
  pinned   Boolean @default(false)   // 新增：置顶
  notebookId String?                 // 新增：归属笔记本（可空）
  notebook  Notebook? @relation(...)
}
// Notebook/NotebookEntry 已存在 → NotebookEntry 简化：直接用 Note.notebookId，
// NotebookEntry 保留给 P1 的「外部来源条目」（链接导入等），本轮不动。
// P1 预留：model NoteRevision { noteId, title, contentMd, reason, createdAt }
```

## 13. 实施顺序与验证

| 批次 | 内容 | 依赖 |
|---|---|---|
| B1 地基 | §12 schema 迁移 + §1 focus 降噪 + §6 四个 loading + §8.4 复习入口 | 无 |
| B2 骨架 | §2 /desk + 路由策略 + §4 学生卡 | B1 |
| B3 笔记 | §3 详情页 + §8.2/8.3/8.5 笔记引擎 | B1 |
| B4 档案 | §5 /me 重构 + §7 营销首页升级 | B2 |
| B5 打磨 | §9 设计审计修复 + §10 瘦身 | B1-B4 |
| B6 验证 | tsc + test + build + **生产模式性能实测** + 浏览器亮暗×3视口走查 + AI 场景真跑 + push | 全部 |

**验证硬标准**：tsc 0 错 / 测试全绿 / build 成功 / 生产模式导航 <300ms 实测留档 / 独立笔记-笔记本-复习全链路可用 / 无硬编码统计数残留。

## 14. 本轮不做（边界）

- NoteRevision 版本历史、笔记本 RAG 问答、链接导入 → P1（契约已在 §8 立好）。
- 真实支付/视频转码/ASR → 维持 mock（等云资源）。
- 社区帖子评论/关注关系 → 广场先跑通发帖+点赞的冷启动。
