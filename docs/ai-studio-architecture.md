# 潮汐学习 STUDIO · AI 造课架构

> 本文记录当前可执行契约，不是愿景文档。发布时以数据库真值、生产态 E2E 和同一 commit 的 CI 为准。

## 1. 六条不可破坏的约束

1. **内容与表现分层**：`blocksJson` 是事实、教学动作、答案和复习的真值；`htmlJson` 是可重建的表现层，不得反向成为答案或完课真值。
2. **一门课只有一条生成流水线**：前端只发起任务并轮询 DB 进度，不再自动逐节 POST 与后台抢写。
3. **任务所有权必须可持久**：`GenerationJob` 用唯一业务键、lease 和 fencing token 认领；长 LLM 阶段续租，旧 owner 不得落库或改终态。
4. **AI 供应商调用前必须预占**：每个真实调用有独立幂等键和 `CreditReservation`；成功按 usage 结算，未交付原子退回，用量不明时先留下不含课程正文的耐久对账事件。
5. **`ready` 是发布真值，不是“有一串 JSON”**：逐节严格质量档案、整课 coverage verdict、当前 blocks/design 同源 HTML 全部成立后才能就绪。
6. **敌意内容不是平台指令**：用户文本、导入资料、中间模型产物一律放入明确的 untrusted 边界；LLM HTML 自带脚本不被执行，学习协议只由平台 adapter 发出。

## 2. 生成主链

```text
用户需求 / 导入资料
  → 来源与时效硬门
  → 大纲 + 课程内容总纲 + 检验地图
  → 可选大纲检查点
  → 耐久 GenerationJob 认领
  → 逐节：教学导演 → 作者候选稿 → 内容/教学双评审 → 确定性规则门
  → 整课：目标 → 证据 → 检验 → capstone 覆盖终审
  → 逐节课件：内容专属设计 → LLM 原创 HTML 或确定性安全排版
  → 表现层 contract/checksum/sourceHash 验收
  → Course + GenerationJob 在同一 fencing 事务收敛
```

课程生成态：

- `outline_draft`：等待用户确认最终课名、目标和资料边界。
- `generating`：仅活跃 lease owner 可推进。
- `paused`：协作式暂停；已开始的不可中断调用完成结算与当前阶段落库，下一边界停止。
- `failed`：空节、逐节质量失败、整课终审失败或表现层不完整，可显式续造。
- `ready`：内容档案和表现层真值同时通过。确定性 HTML 可以是 `degraded` 但仍可学；界面必须说明“安全基础排版”，不得冒充原创精品。

## 3. 内容真值

- `Course.contentBriefJson` 长期保存原始需求、学习成果、范围、capstone、主题类型、资料截止日和用户确认的执行大纲。
- 时事、快变事实与医疗/法律/金融高风险主题没有可核查资料时 fail closed；时效主题还必须有截至日期。确认大纲时会对最终持久化的课名和逐节目标重新执行。
- `Lesson.qualityJson` 是版本化严格质量档案；仅 `{"passed":true}` 、破损 JSON 或历史无状态对象不能让 AI/导入课就绪。
- quiz 的正确答案与解析以结构化 assessment manifest 进入评审；超大题集分批保持完整 JSON，不做字符串硬截断。
- 课程级终审档案绑定当前内容指纹；复用时重放分数阈值、blocking issues 和全节 ID 覆盖，不信任存储对象自报 `passed`。

## 4. 课件表现和学习协议

- `renderEngine=llm`：内容专属的原创课件；`deterministic`：安全基础排版；未知引擎只标“互动课件”。
- 读取 LLM HTML 时会再次移除模型/历史 adapter 脚本，注入带随机 nonce 的平台 adapter，并用 iframe sandbox + 响应 CSP 限权。
- 分页课件只有显式完成动作才发 `ct-complete`；进入末页、单页加载、继读到末页或 reduced-motion 都不会自动完课。
- 滚动课件等待当前布局的有效 `ct-height` 才开放进度与底部 sentinel；完课不会把续读锚点覆盖回 1。
- 只有 `quiz` 进入当前服务端掌握度/错题管道；客户端只提交 `answerIndex`，服务端从 `blocksJson` 重算正误。`fillblank` / `dragwords` / 有答案热区是明确的本地形成性练习，可发匿名化 `ct-practice` 埋点，不写 `LessonQuizResult`。
- 进度写入单调；只有 API 2xx 且数据库落库成功后才展示完课/自动下一节。

## 5. 表现层变更与集市

- 换肤、单节精修和整课重排是表现层 mutation，必须使用课级 `presentationRevision` 围栏。旧请求即使晚返回，也不得覆盖新课件或把课程恢复为 `ready`。
- 表现层变更会让已上架课回到待审；私有/被拒课不会因换肤自动进入审核队列。
- AI/导入课新上架、列表、搜索、OG、领取和付费交易都必须重验 `published + shared + ready + 当前内容档案 + 当前 presentationRevision`。交易在事务内再验一次，失配时在扣款/建所有权前 409。
- `user_created` 继续使用人工审核真值；课程归档后不再对新访客展示或交易，但作者和已购用户保留访问权。

## 6. 恢复、运维与验收

- Node runtime（dev 与 production，NODE_ENV=test 除外）默认启动 recovery worker：进程启动立即扫描，之后定时扫描；可用 `GENERATION_WORKER_ENABLED=0` 显式停用、`=1` 强制打开。worker 只能通过 DB lease 接管，不依赖原请求进程存活。
- 前端 `gen-progress` GET 严格只读，不在轮询路径启动付费评审或凭 JSON “自愈”终态。
- 发布门至少包含：空库与旧基线迁移、lint、TypeScript、全量测试、依赖审计、production build/start、学习协议 E2E（请求+响应+DB+刷新）、备份恢复演练。
- 视觉质量与工程可用性分开验收：确定性回落可让课程安全可学，但不计入“原创精品命中率”。视觉 95+ 必须用经确认的黄金课件样本、真实生成结果和浏览器截图评审，不能只看 prompt 或单元测试。
