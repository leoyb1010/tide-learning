# 潮汐学习 · 升级优化计划 v1.0

> **对象**：[github.com/leoyb1010/tide-learning](https://github.com/leoyb1010/tide-learning)（v0.6，Next.js 15 + Tailwind v4 + framer-motion + Prisma/SQLite）
> **目标**：把一个「功能框架完整的 MVP」升级为「动效设计耳目一新、差异化能力（共创互动 + 笔记）拉满、系统能力贯通、达到商业化标准」的产品。
> **审查方式**：三路深度代码审查（UI/动效、产品功能、工程/安全）+ 全量构建验证（`npm run build` 通过，无编译错误）。
> **日期**：2026-07-02

---

## 0. 总体判断（TL;DR）

| 维度 | 现状评分 | 一句话诊断 |
|---|:---:|---|
| 设计系统 | 7.5/10 | Token 体系、动效原语（Reveal/Stagger/Magnetic/Spotlight/CountUp）已是同类 MVP 少见的高水准，但**应用不均、场景深度不足** |
| 核心学习体验 | 5/10 | 播放器是模拟的，**笔记「截取」能力完全缺失**——差异化卖点只做了一半 |
| 共创系统 | 6.5/10 | 提交→投票→审核→上新主闭环完整，但**没有讨论、没有进度透明化**，「共创」还只是「投票」 |
| 工程/安全 | 5/10 | 权益状态机、webhook 幂等等骨架正确，但存在 **10 个 P0 级安全/正确性问题**（含支付 webhook 无签名校验） |
| 商业化就绪度 | ~30% | 支付全 mock、SQLite 不能上生产、无速率限制、无监控 |

**核心策略**：不推翻现有设计系统（它是资产），而是围绕产品名「潮汐」建立一套 **签名级动效语言（Tide Motion System）**，把差异化能力（笔记捕捉 + 共创剧场）做成「别人没有、一眼记住」的体验，同时并行修掉商业化拦路的工程问题。

---

## Part A · 当前问题清单（可立即修复项）

### A1. 工程/安全 P0（上线拦路虎，全部已核实）

| # | 问题 | 位置 | 说明与修复 |
|---|---|---|---|
| A1-1 | **支付 webhook 无签名校验** 🔴 | `src/app/api/webhooks/payment/[channel]/route.ts` | 任何人 POST 一个订单号即可伪造 `payment.succeeded` 激活订阅。修复：每渠道配置密钥，HMAC 签名 + `crypto.timingSafeEqual` 校验，拒绝无签名请求 |
| A1-2 | **订阅状态机恒真表达式** | `src/lib/payment.ts:85` | `billingPeriod === "month_recurring" ? "active" : "active"` 两个分支相同——连续包月的 trial/自动续费状态从未被区分。修复：补全 `trial → active → grace_period → billing_retry → expired` 状态流转 |
| A1-3 | **投票周界时区错误** | `src/lib/week.ts` | `weekKey()` 按 UTC 计算 ISO 周，注释却写「每周一 00:00 重置」——北京时间周一 00:00–08:00 投的票会算进上一周。修复：按 `Asia/Shanghai` 计算周界，并在投票组件展示重置倒计时 |
| A1-4 | **笔记配额竞态条件** | `src/app/api/notes/route.ts:45-50` | `count → 判断 → create` 非原子，并发下免费用户可超 3 篇限制。修复：包进 `prisma.$transaction` |
| A1-5 | **admin 权限粒度不足** | `src/lib/session.ts:78-79` | 所有后台角色（content_manager 等）可访问全部 `/api/admin/*`，含订单财务数据。修复：按计划书 §8.1 落地 RBAC，每个 admin API 声明所需 permission |
| A1-6 | **API 错误信息泄露** | `src/lib/api.ts:19` | Prisma/系统异常 message 直接返回客户端。修复：白名单业务错误直出，其余记日志、返回通用文案 |
| A1-7 | **无速率限制** | 全部 API | 登录/注册/投票/留资可被暴力枚举与刷量。修复：middleware 层按 IP+用户限流；登录失败锁定；留资按 phone+source 每日去重 |
| A1-8 | **SQLite 不能上生产** | `prisma/schema.prisma:8` | 多进程并发写会锁库，serverless 部署直接崩溃。修复：生产迁移 PostgreSQL（Prisma 切换成本低），SQLite 仅保留本地开发 |
| A1-9 | **需求合并非原子** | `src/app/api/admin/demands/[id]/merge/route.ts:21-32` | 循环 update/delete 中途失败会丢投票；且未校验合并目标状态。修复：`$transaction` 包裹 + 目标需求状态校验 |
| A1-10 | **弱密码 + 无找回** | `src/app/api/auth/signup/route.ts:16` | 密码只查 `length < 6`，且全站无密码重置通路。修复：≥8 位 + 常见密码黑名单；补 password-reset 流程 |

### A2. 工程 P1（尽快修）

- **权益快照 TOCTOU**（`src/lib/entitlement.ts:57-116`）：每请求重算+落库，并发下快照可能不一致 → 加内存/Redis 缓存（TTL 60s），支付/取消时主动失效。
- **分赛道有效期未隔离**（`entitlement.ts:131-139` vs `api/stream/[assetId]/route.ts:22`）：多条订阅时赛道过期时间未独立校验。
- **slug 用 `Math.random()` 生成**（`api/admin/courses/route.ts:39`）→ 换 cuid。
- **Cookie `sameSite:"lax"` 且无 CSRF token**（`session.ts:39`）→ 写操作加 CSRF 校验或改 strict。
- **N+1 查询**：`demand-score.ts:37-43` 的 `votes.include.user` 拉全量用户对象，排行榜只需要计票 → 移除 include，改聚合查询。
- **缺关键索引**：`DemandVote(weekKey,userId)`、`Subscription(userId,status,currentPeriodEnd)`、`Note(userId,createdAt)`、`Lesson(courseId,sortOrder)`。
- **`.env.example` 内置弱默认值**：`SESSION_SECRET="change-me-in-production"` → 留空 + 启动时强校验。
- **零测试、零 CI**：全仓库无一个测试文件 → 至少给 entitlement 状态机、demand-score、webhook 幂等三个核心纯逻辑上单测 + GitHub Actions。

### A3. 设计/体验立即可修项（小工作量高收益）

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| A3-1 | 投票动效用 Tailwind 默认 `animate-pulse`（2s），与全站 ease-out-expo 体系不统一 | `VoteButton.tsx:65` | 换成设计系统缓动的自定义动画（见 B2） |
| A3-2 | Hero 右侧 chips 固定 `grid-cols-3`，小屏挤爆 | `page.tsx:99` | `grid-cols-2 md:grid-cols-3` |
| A3-3 | 需求榜 rank>3 数字用 `text-ink-300`，对比度不达标 | `DemandCard.tsx:32` | 改 `text-ink-600`（≥4.5:1） |
| A3-4 | 移动端底部 Tab 图标 fill/regular 切换无过渡，闪变 | `Nav.tsx:73` | 加 scale+opacity 过渡 |
| A3-5 | 笔记删除瞬间消失、无撤销 | `NoteEditor.tsx` | exit 动画（见 B2）+ Toast 撤销 |
| A3-6 | Paywall 双按钮并列，主次不清 | `Paywall.tsx:36-38` | 单主 CTA + 次级文字链接 |
| A3-7 | Spotlight 高光移动端完全失效 | `motion.tsx:104-127` | `@media (hover:hover)` 门控，触屏改 tap 高光 |
| A3-8 | 骨架屏只占 2-4 行，长列表加载体验差 | `notes/page.tsx:71` | 按典型数据量渲染 8-10 条 |
| A3-9 | 课程封面无 `next/image`、无懒加载 | `CourseCard.tsx` | 换 next/image |
| A3-10 | 禁用按钮 hover 时箭头仍位移 | `ui.tsx:42` | disabled 覆盖 |

---

## Part B · 「耳目一新」设计升级方案（本计划的核心）

### B1. 设计理念：从 Calm Premium 到 **「潮汐引力」（Tidal Pull）**

现状的问题不是「丑」，而是**没有记忆点**：Calm Premium + 有道红做到了「不像 AI 生成」，但它可以是任何一家高端 SaaS。产品叫「潮汐」，这个隐喻目前只活在名字里——**这是最大的浪费，也是最大的机会**。

升级方向：让「潮汐」成为贯穿全站的可感知系统——

1. **动效即潮汐**：所有进场动效统一为「涨潮」（内容自下而上、由远及近涌入，带 0.5–1% 的过冲回落），所有退场统一为「退潮」（加速离场、留下短暂的「湿痕」余韵——一层 80ms 渐隐的低透明度色斑）。用户说不出来为什么，但全站的动效会有统一的「呼吸节律」。
2. **进度即水位**：学习进度、投票热度、需求→课程的制作进度，全部用**水位/波形**可视化（SVG path 波浪 + `<clipPath>`，波幅随进度衰减——快完成时水面渐平静，隐喻「学完了，心静了」）。这是一个别家没有的、可注册商标级的视觉资产。
3. **深浅双潮**：新增暗色主题「深海模式」（学习页默认可选）——`#0c1418` 基座 + 有道红降饱和为 `#ff5462`，学习场景沉浸感立刻拉开与竞品差距。现有 token 体系（`--color-ink-*` / `--color-paper`）天然支持换肤，成本低。
4. **有道红的使用宪法**：现状红色使用不一致（播放按钮白色、投票初始纸色、CTA 红色）。定死三条：**红 = 行动**（CTA/激活态）、**红 ≤ 同屏 2 处**（计划书 §13.2 已有此约束但未执行）、**大面积红只允许出现在水位/波形填充中**。

### B2. Tide Motion System 2.0（动效系统全规格）

现有 5 个 motion 原语保留，向上扩展为完整的 motion token + 组件规格体系。

#### B2.1 Motion Tokens（写入 `globals.css` @theme + `motion.tsx` 常量）

```
时长阶梯   --dur-instant: 100ms   按钮按压、开关
          --dur-fast:    200ms   hover、图标切换
          --dur-normal:  320ms   抽屉、卡片、Toast
          --dur-slow:    560ms   页面转场、水位变化
          --dur-tide:    900ms   签名级动效（笔记飞入、涨潮进场）

缓动      --ease-out-expo:  cubic-bezier(0.16,1,0.3,1)    （保留，退场/揭示）
          --ease-tide:      cubic-bezier(0.22,1.2,0.36,1)  （新增：轻微过冲，涨潮感）
          --ease-anticipate: cubic-bezier(0.36,0,0.66,-0.3)（新增：退场预备）

弹簧      spring-firm   { stiffness: 380, damping: 30 }   （按钮、小元件）
          spring-tide   { stiffness: 170, damping: 22 }   （卡片、抽屉）
          spring-gentle { stiffness: 90,  damping: 18 }   （大面积水位）
```

规则：**任何新动效必须引用 token，禁止裸写数值**（当前 `VoteButton` 的 `animate-pulse`、Player 播放键复用磁吸弹簧参数，都是没有 token 约束导致的走样）。

#### B2.2 新增动效原语（`motion.tsx` 扩展）

| 原语 | 行为 | 用在哪 |
|---|---|---|
| `TidalReveal` | 现 Reveal 升级：y 24→0 + scale 0.98→1 + 1% 过冲，`--ease-tide` | 全站替换 Reveal |
| `Ripple` | 点击点扩散一圈水波纹（radial-gradient scale+fade，320ms） | 投票、打卡、播放键、所有主按钮按压 |
| `WaveProgress` | SVG 波形填充进度，波幅=f(1-progress)，`spring-gentle` | 课程进度、需求热度、订阅周期 |
| `FlipCounter` | 数字翻牌（旧数字上移退出 + 新数字下方涌入，per-digit stagger 40ms） | 票数 +1、笔记计数、价格 |
| `CaptureFly` | 元素克隆 → 沿贝塞尔曲线飞向笔记抽屉入口 → 抽屉图标弹一下（scale 1→1.15→1，spring-firm） | **笔记捕捉签名动效**（见 C1） |
| `SheetDrag` | 可拖拽 bottom sheet（drag 约束 + snap 三档 + velocity 甩出关闭） | 移动端笔记面板、Paywall |
| `PageTide` | 路由转场：旧页 opacity→0.6 + y -8（退潮），新页自下 2% 涌入（涨潮），共 560ms | `layout.tsx` 挂 AnimatePresence（或 Next 15 View Transitions） |

#### B2.3 组件级动效验收规格（替换计划书 §13.5 的粗表）

| 交互 | 规格 | 现状差距 |
|---|---|---|
| 按钮按压 | Ripple + scale 0.985，100ms | 现只有 scale |
| 投票成功 | Ripple + FlipCounter + 票数徽章色相 120ms 内从 ink→accent；**周票余额显示 5 格水滴，消耗一格时水滴缩没** | 现为 animate-pulse 闪烁 |
| 笔记保存 | 「保存中」三个点做 4px 波浪起伏；成功后勾从 path 0→100% 画出（240ms） | 现纯文字切换 |
| 笔记删除 | 卡片 scale 0.96 + opacity→0 + 高度塌陷 320ms，Toast「已删除 · 撤销」 | 现瞬间消失 |
| 时间戳跳转 | 点击 → 播放器进度条泛起一道从当前位置流向目标位置的高光波（560ms）→ 到达后对应笔记卡左缘亮 2px 红线 1.2s | 现无任何反馈 |
| 抽屉/Sheet | spring-tide 入场，背景 scrim 0→40%；拖拽跟手，松手 snap | 现 CSS 硬切 |
| Toast | 自下涌入（y 16→0 + spring-firm），4s 后退潮式离场；可堆叠 3 条 | **全站无 Toast 组件** |
| 骨架屏 | shimmer 保留，但改为波浪相位错开（每行 delay 80ms），形成「浪扫过列表」 | 现全行同步扫 |
| 空态 | 自绘潮汐主题 SVG 插画（低潮的滩涂/贝壳），入场时波形线 path 生长 | 现 Wind 图标 + 文字 |
| 付费墙 | 内容底部做「水面遮罩」：内容沉入半透明水面之下，水面有缓慢波动；CTA 浮在水面上 | 现静态渐变遮罩 |

#### B2.4 性能与降级红线

- 只动 `transform/opacity/clip-path`（现有原则保留）；`Spotlight` 的 radial-gradient 重绘改为 `mask` + transform 方案。
- 全部新增动效过 `prefers-reduced-motion` 降级（现有全局降级保留）。
- `Magnetic`/`Spotlight` 用 `@media (hover:hover) and (pointer:fine)` 门控，触屏禁用。
- 路由转场必须 < 600ms 且不阻塞数据加载（转场与 RSC streaming 并行）。

### B3. 布局升级

#### B3.1 学习页 →「学习工作台」（最重要的一版改动）

现状：桌面端「视频 + 380px 右抽屉」尚可，移动端 Tab 切换（视频/笔记二选一，`Player.tsx:162-173`）直接杀死「边学边记」卖点。

升级为三种形态：

```
桌面 ≥1280px   [ 大纲 240px | 播放器 + 字幕流 | 笔记面板 360px ]
               三栏可折叠；折叠动效用 spring-tide；大纲收起后悬浮为左缘手柄

平板/窄桌面    [ 播放器 | 笔记 ] 双栏，大纲收进顶部 Popover

移动端         上：视频吸顶（16:9）
               下：SheetDrag 笔记面板，三档 snap：
                   峰值 25%（只看视频+快速记一行）
                   峰值 55%（边看边记，默认）
                   峰值 92%（全屏整理笔记）
               草稿实时写 localStorage，切走不丢
```

配套：**焦点模式**（键盘 `F`）——大纲与笔记同时退潮离场，播放器放大居中，背景切深海色；再按恢复。这是「沉浸学习」的仪式感开关。

#### B3.2 笔记页 → 「笔记馆」三视图

现状是单一列表（`notes/page.tsx`）。升级为：

- **时间轴视图**（默认）：按学习日期分组，左侧垂直潮汐线（波形 SVG），笔记卡挂在线上，滚动时当前日期节点水波高亮。
- **画廊视图**：截帧笔记以图片卡瀑布流展示（为 C1 的截帧能力服务）。
- **课程视图**：现有按课程分组，补充折叠/展开（现无折叠）+ 每课程进度水位条。
- 顶部筛选：课程 / 标签 / 日期范围 / 仅截帧（现只有全文搜索，`notes/page.tsx:27-42`）。

#### B3.3 首页微调（现有 bento + zig-zag 保留，是资产）

- Hero 的 mesh 渐变升级为**实时波形 shader 感 SVG**（2-3 层正弦波缓慢相位移动，替代现在的两个 blur 圆斑），首屏即点题「潮汐」。
- 「本周上新」rail 加滚动进度水位条；卡片露出比例从随意改为规范的 20%（计划书 §13.4 要求）。
- 数据证明区的 CountUp 升级为 FlipCounter。
- 布局宽度 `max-w-[1200px]`（`layout.tsx:35`）→ `max-w-[1280px]`，2K 屏留白过多。

### B4. UI 组件体系补全

| 新组件 | 说明 |
|---|---|
| `Toast` | 全站操作反馈基座（投票/保存/删除/复制/支付结果），支持 action 按钮（撤销） |
| `Dialog/Sheet` | 统一模态基座（focus trap + 滚动锁 + 动效 token），替换现散落实现 |
| `CommandK` | ⌘K 命令面板：搜课程/笔记/需求、跳转、切换深海模式——学习工具的「高级感开关」，工作量约 2 天 |
| `EmptyState 插画库` | 6 张潮汐主题 SVG（无笔记/无课程/无需求/无搜索结果/断网/404） |
| `Tooltip` | 现全站无 tooltip，键盘快捷键与图标按钮需要 |
| 深海模式 | `data-theme="deep"`，token 已就绪，学习页优先支持 |

---

## Part C · 差异化能力升级：把「共创 + 笔记」做成护城河

### C1. 笔记系统 2.0：「捕捉 Capture」

**现状**：纯文本 + 时间戳锚点 + 自动保存（这部分实现质量不错，`NoteEditor.tsx` 的 700ms debounce PATCH、停订可查看都已落地）。**但用户嘴里的卖点「随时保存笔记、截取笔记」中的「截取」完全不存在**，且无标签/导出/分享（`schema.prisma` Note 模型无对应字段）。

**升级为三种捕捉动作**（快捷键 + 播放器悬浮捕捉条）：

1. **截帧捕捉**（`S` 键 / 相机按钮）：canvas 抓取当前视频帧 → 生成带时间戳的图片卡笔记 → `CaptureFly` 动画飞入笔记面板。帧图走 `/api/stream` 同源策略，服务端出图兜底（防 CORS 污染 canvas）。
2. **字幕划线捕捉**（选中字幕文本 → 浮出「收进笔记」）：需要字幕数据模型（`Subtitle` 表 + WebVTT 存储），选中即引用原文（Note 模型已有 `sourceText` 字段，**留着没用上，直接激活它**）+ 自动带时间戳。
3. **快速批注**（`N` 键）：不打断播放，底部浮出单行输入，回车即存，视频不暂停。

**配套资产化能力**（让笔记从「记录」变「资产」，支撑续费理由）：

- **标签系统**：新增 `NoteTag` + 多对多关联表；`#` 快捷打标。
- **导出**：Markdown 打包 / PDF（截帧图内嵌），兑现计划书 §1.3「笔记永久保留可导出」承诺。
- **分享卡片**：单条笔记生成精美分享图（截帧 + 划线原文 + 课程名 + 品牌波形水印）——**这是免费的增长裂变入口**，笔记卡片即广告。
- **时间戳可编辑**（修复 `NoteEditor.tsx:121-125` 的只读歧义）+ Markdown 渲染（现在原样显示纯文本）。
- P2 预留：AI 笔记整理/本课总结（计划书 §2.4 已规划，数据结构此期就位）。

**验收口径**：从「看到重点」到「完成一条截帧笔记」≤ 2 次操作、≤ 3 秒，全程不暂停视频。

### C2. 共创系统 2.0：「共创剧场」

**现状**：投票机制完整（周 5 票/单需求 3 票/综合分排行 `demand-score.ts`），后台审核/合并/状态流转齐全。**缺的是「互动」**——没有评论、没有进度透明化、没有共创者荣誉，用户投完票就没事干了。

1. **需求讨论区**：新增 `Comment` 通用表（demandId/courseId 多态挂载，同时服务 P2 课程评论区）；楼层 + 官方回复置顶 + 折叠。
2. **制作进度剧场**（Kickstarter 式）：需求进入「制作中」后，详情页展示 `WaveProgress` 制作进度（脚本→录制→剪辑→审核→上线，数据源用现成的 `ContentCalendar` 表，**后台已有排期数据，前台展示为零**——纯增量开发）+ 每阶段更新推送。
3. **共创者荣誉**：投票用户在课程上线时进入「共创名单」（课程详情页滚动 credits），首批投票者获「首潮徽章」。让「我投的课上线了」成为可炫耀事件。
4. **需求进度订阅**：`DemandFollow` 表 + 状态变更时站内信/邮件通知。
5. **机制修复**：综合分加时间衰减因子（现新旧需求权重相同）；投票风控加同 IP 聚集检测；提交需求加草稿暂存（现刷新即丢）。
6. **投票体验**：B2 规格的水滴票额 + FlipCounter + Ripple 全量应用。

### C3. 学习激励（轻量、不做重游戏化，符合计划书「不做强制打卡」）

- `Streak` 连续学习记录 + 「潮汐日历」（月历上每天一格水位，学得越多水位越高——把打卡也潮汐化）。
- 学习周报（每周一封：学时/笔记数/投票的需求进展），复用 `analytics_events` 现有数据。
- 结课卡分享（P2，计划书 §2.4）。

---

## Part D · 系统能力贯通（商业化标准）

### D1. 支付真实化（收入的前提）

1. 抽象 `PaymentProvider` 接口（createSession / verifyWebhook / refund），mock 成为其中一个 provider（保留用于开发/演示）。
2. 首接 **微信 Native 扫码 + 支付宝当面付**（Web 端最短路径），Stripe 留海外位。
3. webhook 签名校验（A1-1）+ 证书管理 + 对账任务（每日核对 Order 与渠道账单）。
4. 补全订阅状态机：`trial → active → grace_period(3天) → billing_retry → expired`，连续包月到期前 24h 扣款重试，失败进宽限期（计划书 §7.3 有设计、代码未实现）。
5. 增加 `Coupon` 兑换码表（运营必需）+ 订阅升级/降级差价换算 + `/me` 账单历史页。

### D2. 数据与基础设施

- SQLite → **PostgreSQL**（Prisma 迁移 + A2 索引一次到位）；权益快照加缓存。
- 部署形态：Docker Compose（web + postgres + redis）或 Vercel + Neon；封面图上 CDN + next/image。
- 观测：Sentry（错误）+ 请求日志 middleware（method/path/userId/status/duration）+ 健康检查端点。

### D3. 质量体系

- 单测：entitlement 状态机、demand-score、weekKey、webhook 幂等（纯逻辑，最易测最该测）。
- E2E：Playwright 跑通「注册→试学→付费墙→mock 支付→学习→截帧笔记→投票」黄金链路。
- CI：GitHub Actions（lint + typecheck + test + build）；动效场景录制视觉回归（Playwright screenshot diff）。

### D4. 增长与合规

- SEO：课程/需求详情页动态 metadata + OG 分享图（笔记分享卡复用同一套出图服务）、sitemap.xml、robots.txt。
- 埋点补全（现覆盖 ~62%）：`note_capture`（截帧）、`note_share`、`note_export`、`live_class_book`、`login_*`、`paywall_dismiss`、UTM 归因参数落 `analytics_events`。
- 合规：`/terms`、`/privacy` 页面；笔记/需求 UGC 敏感词过滤（服务端）；健康类内容合规口径已在计划书 §0.2，需求提交处补充 riskLevel 自动标记。

---

## Part E · 迭代路线图（8 周 · 4 个 Sprint）

> 原则：安全修复与设计升级**并行**；每个 Sprint 结束都是一个可演示、可回滚的版本。

### Sprint 1（第 1–2 周）：止血 + 动效基建 —— v0.7「潮律」

| 工作项 | 内容 | 验收 |
|---|---|---|
| 安全 P0 批量修复 | A1-1/2/3/4/6/7/9/10 + A2 的 CSRF/slug/索引 | 渗透自测通过；伪造 webhook 被拒绝 |
| Motion Tokens + 新原语 | B2.1/B2.2 全部落地 `motion.tsx` | 原语 Storybook/演示页 |
| Toast/Dialog/Tooltip 基座 | B4 | 投票/保存/删除全部接入 Toast |
| A3 快修清单 | A3-1 ~ A3-10 全部 | 逐项过 |
| 测试与 CI | D3 单测 + GitHub Actions | CI 绿 |

### Sprint 2（第 3–4 周）：学习工作台 + 笔记捕捉 —— v0.8「捕捉」

| 工作项 | 内容 | 验收 |
|---|---|---|
| 学习工作台三形态 | B3.1（三栏/双栏/SheetDrag）+ 焦点模式 | 移动端可边看边记，草稿不丢 |
| 真视频播放器 | hls.js + 缓冲/全屏/记忆倍速；mock 流保留演示模式 | 时间戳 seek 精度 ±1s |
| 截帧捕捉 + 快速批注 | C1 动作 1、3 + `CaptureFly` 签名动效 | 「2 次操作 3 秒完成截帧笔记」 |
| 笔记标签 + Markdown 渲染 + 时间戳编辑 | C1 资产化第一批 | — |
| 笔记馆三视图 | B3.2 | 画廊视图展示截帧 |
| PageTide 路由转场 + 深海模式（学习页） | B2.2 / B1.3 | reduced-motion 降级通过 |

### Sprint 3（第 5–6 周）：共创剧场 + 支付真实化 —— v0.9「共潮」

| 工作项 | 内容 | 验收 |
|---|---|---|
| 需求讨论区 + 进度剧场 + 共创名单 + 订阅通知 | C2.1–C2.4 | 需求详情页完整闭环 |
| 综合分衰减 + 投票风控 + 水滴票额 UI | C2.5/C2.6 | — |
| 微信/支付宝真实接入 + 状态机补全 + Coupon | D1 | 真实 1 分钱订单跑通全链路 |
| PostgreSQL 迁移 + Redis 缓存 + Sentry | D2 | 压测 200 并发投票无超卖 |
| 字幕数据模型 + 划线捕捉 | C1 动作 2 | 选中字幕 → 笔记含原文引用 |

### Sprint 4（第 7–8 周）：激励 + 打磨 + 上线 —— v1.0「满潮」

| 工作项 | 内容 | 验收 |
|---|---|---|
| Streak + 潮汐日历 + 学习周报 | C3 | — |
| 笔记导出 + 分享卡片 + OG 出图服务 | C1 资产化第二批 | 分享图 < 1.5s 生成 |
| CommandK + 空态插画库 + 首页波形 Hero | B4 / B3.3 | — |
| E2E 黄金链路 + 视觉回归 + 压测 | D3 | Playwright 全绿 |
| SEO/合规/埋点补全 + 上线清单 | D4 | Lighthouse：Perf ≥ 90 / A11y ≥ 95 |

### 上线 KPI 基线（对应计划书 §2.1 的 90 天验证目标）

| 指标 | 目标 | 依赖 |
|---|---|---|
| 试学 → 订阅转化率 | ≥ 8% | 付费墙水面改版 + 真实支付 |
| 学习者笔记创建率 | ≥ 35%（截帧占 ≥ 40%） | 捕捉体验 |
| 笔记分享卡带来的新访客 | 占新增 ≥ 10% | 分享卡片 |
| 订阅用户周投票参与率 | ≥ 25% | 共创剧场 |
| 次月续订率 | ≥ 60% | 激励 + 更新节奏 + 共创进度感 |

---

## 附 · 保留清单（审查确认的现有资产，升级时不要破坏）

- 设计 token 体系与「无纯黑、阴影染色、单强调色」原则（`globals.css`）
- Geist + 中文栈、`.overline` 等宽标签、噪点固定层
- 5 个 motion 原语的实现质量（motion value 不触发 re-render 的写法是对的）
- 服务端权益判断架构（客户端只读快照）、webhook 幂等骨架、埋点 SDK 分层
- 首页 bento/zig-zag 反 AI 味布局、全站 reduced-motion 降级
- 后台 CMS 全套（课程/排期/需求审核/建联队列/看板）——共创剧场直接复用其数据

---

*本计划由三路并行深度代码审查（UI/动效 88k tokens、产品功能 105k tokens、工程安全 102k tokens）+ 构建验证综合而成，所有问题均带文件:行号可直接定位。建议按 Sprint 1 → 4 顺序执行；每个 Sprint 的工作项都可以直接拆解为独立的 agent 任务。*
