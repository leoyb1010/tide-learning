# 首页升级 · 生图清单（交给 image2 模型）

> 生成日期：2026-07-05 · 分支 feat/studio-v2-redesign
> 说明：本轮首页四大问题已用**代码 + 现成真实图库**修复完毕并上线（详见下方「已用现成资产」）。
> 下列是**进一步升级**需要的生图。每条给出：文件名 · 存储路径 · 尺寸 · 精细正向 prompt · 负向 prompt · 验收要点。
> 生成后直接放到对应 `public/` 路径即可，代码已按文件名就位或只需一行替换（每条注明）。

---

## 全局风格锁定（所有图共用，务必带进每条 prompt）

**设计系统 STUDIO v2 —— 冷灰蓝中性 + 有道红专注信号：**
- 主色调：cool neutral grey-blue（冷灰蓝），背景近 `#E7EAF0`~`#EEF1F6`，中性、安静、专业、有空间感。
- 品牌红：Youdao red `#FC011A`，**仅作专注信号，占比 ≤7%**，一张图里红点/红光 ≤1 处，绝不大面积铺红。
- 文字/物体墨色：冷灰近黑 `#232935`。
- 材质：柔和软光、双层柔投影、微妙内高光；**不要**硬边框、不要廉价渐变、不要塑料反光。
- 光线：晨光/柔光工作室感（晨光亮场版）或深夜台灯暖光（夜航暗场版），克制、电影级布光。
- 气质关键词：premium, editorial, cinematic lighting, minimal, calm, spacious, high-end, tasteful, Apple/Notion/Linear-grade。

**全局负向（每条都加）：**
`no text, no watermark, no logo, no UI chrome, no cartoon, no clip-art, no lowres, no jpeg artifacts, no oversaturation, no rainbow colors, no big red areas, no cluttered composition, no cheap 3D render look, no stock-photo cliché, no fisheye distortion, no people faces in focus`

---

## A. 需要生成的图（按优先级）

### A1 ⭐️ 教室主视觉三联全景（首屏 hero 备选升级）— 最高优先

- **文件名**：`classroom-hero-triptych.jpg`
- **路径**：`public/marketing/classroom-hero-triptych.jpg`
- **尺寸**：16:9，≥ 2560×1440（hero 大图，需清晰）
- **用途**：ActOne 首屏右侧/背景可选升级图。当前首屏用 CSS 场景 + DeskDemo，已很好；此图用于「教室主轴」再上一个台阶——**一张图同时点出三种开学方式**。
- **接线方式**：生成后我在 `src/components/home/ActOne.tsx` 用 `next/image` 或 `<img>` 作首屏氛围底/右侧插画（一行替换，代码位已预留注释）。

**正向 prompt：**
```
A serene modern self-study room bathed in soft morning light, cool grey-blue palette, editorial cinematic composition, wide angle. The room clearly shows THREE zones from left to right, each representing a way to start learning:
(1) LEFT — a tidy minimalist bookshelf with neatly arranged book spines in muted green, warm terracotta and soft violet tones (a curated course library);
(2) CENTER — a clean desk with a glowing thin laptop/monitor showing a soft abstract "course being generated" interface (an AI course-creation station), a single tiny warm-red indicator dot of light on the desk as the only saturated accent;
(3) RIGHT — a second desk with an open notebook, a few loose printed documents and sticky notes being organized (turning your own material into a course).
Cool neutral grey-blue walls (#E7EAF0), pale wood floor, soft diffused daylight from a large window, gentle long shadows, calm and spacious, plenty of negative space, premium high-end interior photography, shallow depth of field, no people. Muji / Kinfolk / Apple-store calm aesthetic.
```
**负向**：（全局负向）+ `no dark horror mood, no night scene, no messy desk, no neon, no glowing screens too bright`
**验收**：一眼能数出「书架 / 带屏的桌 / 摊资料的桌」三个区；整体冷灰蓝、仅一点红；晨光不压抑；留白充足可叠加文字。

---

### A2 教室主视觉 · 深色夜航版（暗场跟随）

- **文件名**：`classroom-hero-triptych-dark.jpg`
- **路径**：`public/marketing/classroom-hero-triptych-dark.jpg`
- **尺寸**：16:9，≥ 2560×1440
- **用途**：同 A1，供 `data-theme=dark`（系统暗色）时切换，保持首屏亮暗两套质感一致。
- **接线**：与 A1 同处，按 `prefers-color-scheme` / `data-theme` 切换（代码支持，给两张即可）。

**正向 prompt：**
```
The SAME three-zone self-study room as a premium night scene: deep cool blue-black ambiance (#0E1116 walls), a single warm desk lamp as the only key light pooling warm light over the center desk, the bookshelf on the left in shadow with faint rim light on the spines, the right desk's notebook softly lit. One tiny warm-red standby indicator dot glows on the center desk (the only saturated accent). Cinematic low-key lighting, moody but calm and inviting (not scary), lots of negative space, premium interior photography, shallow depth of field, no people. "Late-night focused study, the room left a light on for you" mood — warm, safe, not lonely.
```
**负向**：（全局负向）+ `no horror, no cold sterile feeling, no multiple colored lights, no bright overexposed screen`
**验收**：暗但温暖不恐怖；三区仍可辨；仅一点暖红；与 A1 构图呼应。

> 备注：现有 `public/marketing/studyroom-act1-hero.jpg` 是很好的夜景，但只有「一张桌」，没体现三种内容——A2 是它的「三区」升级版。

---

### A3 书脊整排写实图（书架 demo 可选升级）

- **文件名**：`book-spines-row.jpg`
- **路径**：`public/textures/book-spines-row.jpg`
- **尺寸**：约 4:1 横幅，≥ 1600×400（透明或浅底皆可，建议 PNG 保边）
- **用途**：ActTwo 第一张桌的书架 demo。**当前已用 CSS 书脊 + 木纹层板，效果已良好**；若想再真实一档，用此图替换 CSS 书脊层。
- **接线**：替换 `src/components/home/ActTwo.tsx` `MiniShelf` 里 CSS 书脊那段为一张 `<img>`（我可在你出图后接，约 10 行）。

**正向 prompt：**
```
A neat row of standing books photographed straight-on at eye level, shot as a clean product still on a pale wood shelf. Book spines in a refined muted palette grouped by color: a cluster of deep muted green spines, a cluster of warm terracotta/amber spines, and a couple of soft violet spines. Varied heights and thicknesses for a natural hand-curated look, small gaps between books, subtle top page-edge highlights, soft realistic shadows in the gaps, matte cloth-and-paper book texture (not glossy). Cool grey-blue neutral background, soft diffused studio light, premium editorial product photography, high detail, no titles or text on the spines.
```
**负向**：（全局负向）+ `no readable text on spines, no glossy plastic covers, no leaning books, no library clutter, no color rainbow`
**验收**：像真书脊排（有页口高光、缝隙投影、布纹质感）；配色只用 绿/赭/紫 三系；无书名文字（文字由前端叠）。

---

### A4 补齐课程封面池（让新课/AI 造课不撞图）

现有封面池：`ai×3, oral×3, english×2, silver×2, life×2`。已够用但 **AI 赛道新课偏多**（seed 里 `offer-r486`、`30-78dn` 等无专属封面），建议每类各补 1–2 张，丰富度更高、翻页更少撞图。

- **路径统一**：`public/covers/`
- **命名规则**（代码 `coverPoolSrc` 已按此读取，放进去即生效，**无需改代码**）：
  - `cover-pool-ai-4.jpg`、`cover-pool-oral-4.jpg`、`cover-pool-english-3.jpg`、`cover-pool-silver-3.jpg`、`cover-pool-life-3.jpg`
  - ⚠️ 补 AI 池到 4 张后，需在 `src/lib/tracks.ts` 的 `COVER_POOL.ai_skill` 数组加 `"ai-4"`（我可代改；english/silver/life 同理加对应 key）。
- **尺寸**：4:3，≥ 1200×900（与现有封面一致）
- **风格锁定**：**严格对齐现有封面**——扁平品牌插画、有道红为主的暖色系、品类母题符号、右下角一道「潮汐/波浪」弧线母题（现有封面共有元素）。

**各品类母题 + prompt 片段（共用扁平插画风）：**
公共前缀：
```
Flat vector brand illustration, 4:3, clean minimal, Youdao-red (#FC011A) warm gradient background, one large soft symbolic motif centered-right, a subtle lighter tone-on-tone tidal wave arc curving across the bottom, generous negative space, premium editorial flat-design cover art, no text.
```
- `cover-pool-ai-4.jpg` — 母题：`a glowing spark / sparkle-star and a subtle circuit or node motif (AI skills)`，主色可用紫红过渡。
- `cover-pool-oral-4.jpg` — 母题：`two overlapping speech bubbles (spoken English practice)`。
- `cover-pool-english-3.jpg` — 母题：`an open book with a small ear and pencil (listening/reading/writing)`，偏暖橙。
- `cover-pool-silver-3.jpg` — 母题：`a friendly smartphone with a large simple heart (silver-generation, elder-friendly)`，偏暖珊瑚。
- `cover-pool-life-3.jpg` — 母题：`a shield / umbrella motif (life skills, anti-fraud, safety)`，偏暖红。

**负向**：（全局负向）+ `no photo-realism, no gradients banding, no dark background, no multiple motifs, no text/letters`
**验收**：和现有 `cover-oral-smallclass-001.jpg` 一眼同系列（同扁平风、同波浪母题、红为主）；单一母题、无文字。

---

### A5（可选）AI 赛道 2 门无封面课的专属封面

若想让 AI 赛道那两门无专属封面的课（`offer-r486`、`30-78dn`）也有独立封面：

- **文件名**：`cover-offer-r486.jpg`、`cover-30-78dn.jpg`
- **路径**：`public/covers/`
- **接线**：需在 `src/lib/tracks.ts` 的 `DEDICATED_COVER_SLUGS` 加这两个 slug（我可代改）。
- **尺寸/风格**：同 A4（4:3，扁平品牌插画）。母题按课程主题（拿到确切课名后再定），暂缓——优先 A4 池补齐更划算。

---

### A6 ⭐️ AI 造课台卡片背景纹理（首屏右侧「AI 造课工作台」演示卡）

- **文件名**：`ai-forge-panel-bg.jpg`（亮版）、`ai-forge-panel-bg-dark.jpg`（暗版）
- **路径**：`public/marketing/ai-forge-panel-bg.jpg` / `public/marketing/ai-forge-panel-bg-dark.jpg`
- **尺寸**：16:10（配 DeskDemo 卡片比例），≥ 1600×1000
- **用途**：首屏右侧那张会动的「AI 造课工作台」演示卡（DeskDemo），目前卡内背景是纯 CSS 的紫红淡彩渐变（`demo-ai-flow` 流光），略显平。用这张作卡片**屏内底纹**，让它更像一台真在跑 AI 的「智能造课台」。
- **接线**：我在 `src/components/home/DeskDemo.tsx` 的「显示器外框」内层加一张 `<img>` 作底（叠在 `--scene-screen` 之上、内容之下，低透明度），亮/暗两版按主题切（约 15 行，你出图后我接）。
- **关键约束**：**极简、克制、可当底纹**——上面要叠中文 UI（输入行、四步进度、成品卡），所以背景**不能有强图形/文字/高对比**，只做「智性蓝图 + 柔光」氛围。

**正向 prompt（亮版）：**
```
An abstract minimal "AI blueprint" background texture for a light UI panel, 16:10. Very subtle: a faint cool grey-blue technical grid (thin hairlines) fading out toward the edges, a soft diffuse glow of gentle violet-to-blue light blooming from the center-right (like an AI core quietly working), a few faint flowing connection lines / nodes dissolving into the background. Pale, low-contrast, lots of clean empty space, cool neutral grey-blue base (#EEF1F6). Feels like the screen of a calm, high-end AI course-authoring tool at rest. Flat, no depth, no objects, no text.
```
**正向 prompt（暗版）：** 同上，改 `deep blue-black base (#12171F), the grid and glow slightly more visible as luminous cool-blue/violet light on dark, still very subtle and low-contrast`。

**负向**：（全局负向）+ `no strong graphics, no icons, no charts, no readable text, no high contrast, no busy pattern, no 3D objects, no logo, no bright saturated colors, nothing that competes with foreground UI`
**验收**：放大能看到细网格 + 中右柔光 + 几根淡连线；缩小几乎就是一层「有科技感的柔光底」；叠上中文 UI 后文字依然清晰（背景对比度足够低）。

---

## B. 已用「现成真实资产」（本轮无需生图，说明来龙去脉）

- **课程抽屉封面**（问题③）→ 直接用了代码库已有的 `public/covers/cover-*.jpg`（`resolveCoverSrc` 映射），**8 张真实封面已全部加载验证通过**，零生图。
- **书架木纹层板**（问题②）→ 用了现成 `public/textures/shelf-wood-texture.jpg`（真实深胡桃木纹），书脊用 CSS + 赛道渐变绘制。
- **首屏 / 三桌 / 邻座卡 / 结尾**（问题①④）→ 纯代码 + `--scene-*` token，亮暗自适应，无需图。

> 现有 `public/marketing/studyroom-act*.jpg`（3 张高质量夜景）当前**未被首页引用**（首页改用 CSS 场景）。它们质量很高但都是「深夜单桌」，不含三种内容并置——所以列了 A1/A2 作「三区」升级版；若你更想直接复用旧夜景，也可，我把 A2 换成引用 `studyroom-act1-hero.jpg` 即可（省一张图）。

---

## C. 生成后交给我做什么

按你出图的范围，我做对应接线（都在已改的首页文件内，改动小、可单独验证）：
1. **A1/A2** → 在 ActOne 首屏接教室主视觉图（亮暗两套切换）。
2. **A3** → 用真实书脊图替换 MiniShelf 的 CSS 书脊层。
3. **A4** → 把新封面文件名登记进 `COVER_POOL`（每类数组加 key）。
4. **A5** → 登记进 `DEDICATED_COVER_SLUGS`。

每步都会走一遍验证铁律（tsc / build / 浏览器实测封面 200）再交付。
