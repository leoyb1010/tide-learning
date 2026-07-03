# 有道自习室 STUDIO · AI 自习室架构

> 从"课程网站"跃迁到"AI 自习室"：三引擎 + 一中枢。
> 核心判断：不是接三个大模型系统，而是把已验证的 chatJson 管线从"生成文案"升级为"生成结构化学习对象"，配一个安全渲染器和一层轻记忆。

## 五条硬约束（决定所有取舍）
1. 零重依赖哲学（fetch 直调不引 SDK、手写 markdown 先 esc）——不引 PDF.js/向量库/DOMPurify
2. 权益只在服务端（resolveEntitlement/canAccessLesson 唯一真相）——AI 课复用同一闸门
3. AI 路由同一模板（handle→assertSameOrigin→require→assertUserRateLimit→chatJson→track）
4. 存储 mock 模式——用户上传大文件 MVP 无落点，故引擎B MVP 只做"粘贴文本"
5. SQLite 无向量——RAG 用"上下文直塞"，不引向量库

## 三引擎 + 一中枢

### 引擎A：AI 生成课（核心卖点）
一句话需求 → LLM 生成**交互式块课件**（不是裸 HTML）。
- **块协议**：`blocksJson = {version, blocks[]}`，块类型白名单：`concept/code/quiz/keypoint/callout`
- **渲染**：白名单 React 组件（BlockRenderer），非 dangerouslySetInnerHTML/iframe。文本一律过 renderMarkdown(esc)，XSS 面≈零
- **分步生成**：Step0 大纲(2-4s先落库) → Step1..N 逐节生成 blocks(伪流式点亮)。低温度0.3 + chatJson + 服务端 validateBlocks() 校验修复 + 单节重试 + 失败降级为 concept 块(永不空课)
- **数据**：复用 Course/Lesson，Lesson.contentType 加 "ai_block"，新增 Lesson.blocksJson

### 引擎B：用户自带资料 → 可学的课
- MVP 只做**粘贴文本**（零依赖、覆盖80%场景）。PDF/网页/视频=P1/P2(需对象存储/ASR)
- rawText → 切章节 → 复用引擎A逐节生成 blocks → Course(origin=user_imported, private)
- 网页抓取需防 SSRF(P1)

### 中枢：AI 学习伴侣（有记忆的助教）
- **RAG=上下文直塞(方案c)**：当前课 blocks/字幕 + 用户本课笔记 + 进度，拼进 prompt。零依赖、零延迟。跨课检索=P1(关键词召回复用 expandSearchKeywords)，向量=P2
- 能力分期：P0=学习中当前课答疑 + 复习卡落库(复用note-summary)；P1=划词问/跨课；P2=知识图谱/排计划(需调度)
- UI：P0学习页侧栏"伴侣"Tab

### 共创闭环
需求 → AI 预生成一版(sourceDemandId) → 验证 → 人工精修(origin升级official) → launched。不新增顶层状态，用 Course.genStatus 承载子态。

## 数据模型变更
- Course +origin(official/ai_generated/user_imported) +authorUserId +visibility +genStatus +sourceDemandId
- Lesson contentType加"ai_block" +blocksJson
- Note +anchorRef(块锚点 "block:xxx"，视频课继续用timestampSec)
- 新模型：ImportedSource / GenerationJob / ChatThread+ChatMessage / ReviewCard

## MVP 边界（P0 本轮做完）
- 引擎A：一句话→块课件全链路 + BlockRenderer + 来源标识 + 块笔记锚点
- 引擎B：粘贴文本→结构化块课
- 中枢：学习页侧栏伴侣(当前课答疑) + 复习卡落库
- 共创：sourceDemandId + 运营触发生成
- UI：导航加"AI造课"入口 + 我的课 + 首页Hero生成CTA

## 关键架构风险
- 无队列/调度：单请求只生成"大纲+首节"，其余节前端逐节独立请求(稳落超时内)。GenerationJob表让演进平滑
- 成本：每用户日配额(assertUserRateLimit) + 低价flash + 结果落库复用
- 安全：块协议压XSS + where强制userId防越权 + private默认 + disclaimer
