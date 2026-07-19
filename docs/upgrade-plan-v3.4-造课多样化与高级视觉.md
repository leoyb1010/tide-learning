# 升级计划 v3.4 —— 造课「模板多样化」与「结果漂亮高级」

> 结论先行：多样化的**架构已经很完整**（6 内容模板 × 9 版式 mode × 9 视觉 art × variance × motif），
> 真正的缺口不在「缺能力」，而在 **上限路径没接进主链路** + **确定性底座还不够高级** + **模板差异用户感知不到**。
> 本计划按「先接通上限、再抬高底座、再放大感知」三步走，绝不推翻现有引擎。

---

## 0. 现状盘点（基于代码，非臆测）

| 层 | 现状 | 文件 |
|---|---|---|
| 内容结构 | 6 模板（经典/案例/故事/思辨/工坊/考点），含硬性签名块 + 遵循度机检 | `src/lib/ai/templates.ts` |
| 内容块 | 13 种块 | `src/lib/blocks.ts` |
| 版式 mode | 9 种（横向讲义/滚动自学/模块导读/编程实训/科技剧场/学术讲义/仪表盘/概念图谱/互动测验） | `src/lib/ai/courseware-catalog.ts` |
| 视觉 art | 9 套配色设计系统（编辑纸刊/深色科技/工程蓝图/银白柔构/冲刺计分/剧场绘本/霓虹剧场/终端代码/学术讲义） | `src/lib/ai/courseware-design.ts` |
| 场景级变化 | variance + hero/corner motif（同一门课逐节不雷同） | `courseware-variance.ts` / `courseware-motifs.ts` |
| 渲染 | 确定性引擎（可复现、沙箱安全、含 CSP/动效/reduce-motion） | `courseware-html.ts` |
| **上限（bespoke）** | LLM 产 bespoke HTML → 过安全/反 slop 校验才用，否则回落确定性 | `courseware-gen.ts` `synthesizeViaLLM` |

### 关键病灶
1. **上限路径没接进主链路（P0，最重要）**
   主造课在 `course-gen.ts:797` 调 `renderAndStoreLessonHtml` → 只走 `renderCoursewareHtml`（确定性）。
   带 `enhance:true` 的 bespoke 路径只在独立按需接口 `generate-lesson-html/route.ts` 被触发。
   → **正常造出来的每一门课都停在确定性「地板」，永远够不到 bespoke「天花板」。** 这是「不够漂亮高级」的根因。
2. **模型现实约束**：CLAUDE.md 记 DeepSeek 余额 0；记忆里已切到有道 NewAPI 网关（gpt-5.6-sol / MiniMax-M3 / glm-5.2 / claude-sonnet-5）。
   上限路径要产**高级 HTML**，必须路由到强模型，且要成本闸门。
3. **模板差异「感知不到」**：模板主要改**块内容**（recipe/口吻），对**长相**影响间接。用户翻两门课觉得「长得差不多」。
4. **确定性底座本身还不够「高级」**：既然 fallback 永远兜底，底座的封面/字阶/留白/节奏就是大多数课的真实观感。

---

## 一阶段 · 接通上限（P0，1–2 天，见效最大）

**目标：让「漂亮高级」真的会发生。**

1. **主链路接 bespoke**：`renderAndStoreLessonHtml` 增加 `opts.enhance/model`，`course-gen` 造课时按「质量档」传入；
   保留铁律——bespoke 必须过 `validateCoursewareHtml`（CSP/内联/无外链/reduce-motion/GPU），不过则回落确定性，**绝不让课件空/崩**。
2. **质量档开关**：课级 `qualityTier`（`standard=确定性` / `premium=先试 bespoke`）。
   订阅会员或用户显式勾「精修」走 premium；游客/免费走 standard。UI 在 `TemplateModelPicker` 加一枚「精修排版（会员）」开关。
3. **模型路由 + 成本闸门**：bespoke 只路由强模型（claude-sonnet-5 / glm-5.2），单课 token 上限 + 逐节超时回落；
   `synthesizeViaLLM` 已具备失败即回落，补：per-course 预算计数、并发上限、命中缓存（同 blocks+design 校验和复用）。
4. **可观测**：落库 `renderEngine`（bespoke/deterministic）+ 被拒原因，进 `/admin`，让「premium 命中率 / 被拒 top 原因」可量化。

**验收**：premium 课件命中 bespoke ≥ 70%；被拒自动回落 0 崩溃；contract-smoke 全绿。

---

## 二阶段 · 抬高确定性底座（P1，2–3 天，保底也高级）

**目标：即便回落，也「漂亮」。底座是大多数课的真实观感。**

1. **封面/Hero 系统**：每门课按 art 生成**确定性封面**（几何 motif + 大标题字阶 + 课程元信息），
   替代当前「进正文就是块流」。课列表 / 详情 / 分享卡统一复用。
2. **排版升级**：引入模块化字阶（1.25 比例）、统一竖向节奏（8pt 网格）、
   concept/example 的「主-辅」双栏在宽屏自动成立、引用/keypoint/callout 的高级描边与底纹（走 art token，不硬编码色）。
3. **块的高级态**：compare 做成真正的双栏卡片对照、steps 做成带序号进度的竖时间线、
   dialog 做成气泡剧场、keypoint 做成「考点墙」网格——都在确定性渲染器内做，零 LLM。
4. **暗/亮双态与 reduce-motion 全覆盖**：每套 art 双态出片，动画只 transform/opacity（已有约束，补测试快照）。

**验收**：9 套 art × 亮暗 = 18 张封面 + 3 类块快照评审通过；无外链、CSP 不破。

---

## 三阶段 · 放大模板感知 + 扩容多样性（P1→P2，3–4 天）

**目标：让「选了不同模板 = 看得出不同」。**

1. **模板↔版式↔视觉强绑定**：`TEMPLATE_MODE` 之外再定义 `TEMPLATE_ART_CANDIDATES`，
   让「故事沉浸」倾向 storybook/剧场绘本、「考点冲刺」倾向 scoreboard/冲刺计分、「工坊」倾向 dev_terminal。
   用户没显式选 art 时，模板即给出**签名视觉**，翻课一眼能分辨。
2. **模板签名视觉元素**：每模板一个专属 hero motif + 专属块（故事=剧集条、考点=倒计时/计分、工坊=交付物清单卡），
   在确定性渲染器按 `design.templateKey` 分流。
3. **扩容**（按数据反馈再做）：
   - 新增 2 个高需求模板：`language_immersion`（语言沉浸：对话+跟读+纠错）、`kids_bright`（少儿明亮：大图少字强反馈）。
   - 新增 2–3 套 art：杂志感 `magazine_bold`、极简 `zen_mono`、手账 `journal_washi`。
   - 每加一项，UI 卡片 / 校验 / prompt 注入 / 落库自动生效（现注册表已支持）。
4. **首页/集市呈现**：造课结果卡带 art 缩略与模板标签，让「多样」在入口就被看见。

**验收**：盲测 6 门不同模板的课，用户能凭封面正确归类 ≥ 5/6。

---

## 四阶段 · 质量护栏与自愈（P2，持续）

1. **反 slop + 遵循度**：沿用 `checkTemplateAdherence` + scoreLesson，bespoke/确定性都过；不达标**自动重试一次**（换 seed/加硬提示）。
2. **视觉「高级分」**：确定性可测指标（对比度、留白比、字阶层级数、首屏信息密度）打分，低分课件回炉。
3. **快照回归**：关键 art×mode×block 组合入快照测试，防「改一处崩全局」。
4. **人审通道**：`/admin` 抽样预览近 N 门课的封面+首屏，一眼质检。

---

## 里程碑与顺序

| 阶段 | 工期 | 产出 | 依赖 |
|---|---|---|---|
| P0 接通上限 | 1–2d | premium 课件真的漂亮；命中率可观测 | 强模型可用 + 预算 |
| P1 抬高底座 | 2–3d | 封面系统 + 排版/块高级态（保底也好看） | 无（纯确定性） |
| P1 模板感知 | 1–2d | 模板签名视觉，翻课可分辨 | P1 底座 |
| P2 扩容 + 护栏 | 3–4d | 新模板/art + 自愈质检 | 数据反馈 |

**建议落地顺序**：先 P1 底座（不依赖模型、立刻拉高每一门课观感）→ 再 P0 接通上限（预算就绪后解锁天花板）→ 再 P1 感知 → P2 扩容。
这样「不花钱先变好看」，「花钱再变高级」，风险与成本都可控。

---

## 附：与本次一并修复

- **输入框点击后出现的黑色描边线**：根因是全局 `:focus-visible { outline: 2px solid var(--ink3); outline-offset: 2px }`
  给自带聚焦态的输入也叠了一圈偏移灰环（在大圆角外缘显成「黑线」）。已对造课/搜索三处输入 `focus-visible:outline-none`，
  并给首页搜索 pill 补 focus-within 红光晕，键盘无障碍不回退。见 `StudyDesk.tsx` / `HeroPromptInput.tsx` / `CreateStudio.tsx`。
