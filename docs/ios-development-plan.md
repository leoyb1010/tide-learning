# 有道自习室 STUDIO · iOS 原生 App 全量开发文档

> 版本：v1.0（对齐 Web 平台 v2.3）
> 目标：把 Web 平台（Next.js）的全部能力原生化到 iOS，作为独立可交付的开发规格。
> 读者：iOS 开发工程师、技术负责人、后端联调、测试。
> 平台事实基线：~90 个 REST API、53 张数据表、35 个页面。iOS 复用同一套后端，只做客户端。

---

## 0. 文档导航

1. 产品与范围
2. 技术选型与架构决策（含 iOS 特有的 5 个关键决策）
3. 工程结构与依赖
4. 网络层与 API 契约（全量接口清单）
5. 认证与会话（Cookie→Token 桥接）
6. 数据模型（Swift 侧映射）
7. 设计系统移植（STUDIO → SwiftUI）
8. 功能模块逐一实现（15 个模块 × 屏幕/接口/交互）
9. 原生能力（AVPlayer / 相机截帧 / 文件 / 推送 / 后台）
10. 支付与 Apple IAP 合规（关键法务点）
11. 离线与同步策略
12. AI 能力对接（一次性 + 流式演进）
13. 安全与合规
14. 性能与可访问性
15. 测试策略
16. 分期交付计划（M0-M6）
17. 后端需为 iOS 补的接口清单

---

## 1. 产品与范围

### 1.1 产品定位
「AI 虚拟自习室」：不只是看课，而是 **说出想学的 → AI 造一门课 → 边学边记 → 到点复习 → 社区共创** 的完整学习闭环。iOS 版要 1:1 承载这套心智，并利用移动端优势（随手记、碎片复习、推送召回、摄像头截帧）。

### 1.2 iOS 版范围（P0 必做 / P1 增强 / P2 暂缓）

**P0（首个可交付版本，覆盖学习闭环主干）：**
- 认证：登录/注册/登出/找回密码
- 书桌（首页 dashboard）+ 断点续学
- 课程库 + 课程详情 + 学习台（视频/图文/块课件 + 边学边记 + 进度上报）
- AI 造课（一句话生成 + 逐节写作过程）
- 笔记馆（记录/编辑/详情/笔记本/AI 整理）+ 多源采集（随手写/图片/链接）
- 复习室（间隔重复 + 3D 翻牌 + 模拟考试）
- 成长档案 + 学生证 + 积分卡
- 订阅与积分（含 Apple IAP，见 §10）
- 设置（改密码/偏好/通知）
- 站内通知 + 推送

**P1（社区与深化）：**
- 社区空间（投票共创 + X 式广场：发帖/图片/评论/转发/热门流）
- 课程集市（分享/申请/批准）
- 个人主页
- 资料升维导入（附件/PDF）
- AI 学习伴侣（对话式）

**P2（暂缓，依赖运营/资质）：**
- 管理后台（iOS 不做，管理走 Web；仅保留角色可见的极简审核入口，可选）
- 家庭组（FamilyGroup）
- 真实第三方登录（微信/Apple 登录见 §5.5）

---

## 2. 技术选型与架构决策

### 2.1 技术栈
| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | Swift 5.9+ | 现代并发 async/await |
| UI | **SwiftUI**（iOS 16+ 最低）+ 少量 UIKit 桥接（AVPlayer/相机/富文本） | 声明式与 Web 的组件心智一致，开发快；iOS16+ 覆盖率足够 |
| 架构 | **MVVM + Repository**，Swift Concurrency | ViewModel 持有状态，Repository 封装网络+缓存 |
| 网络 | `URLSession` + 自建轻量 `APIClient`（不引重库） | 与后端零重依赖风格一致；可控 cookie/token |
| 本地存储 | **SwiftData**（iOS 17+）或 Core Data（iOS16 兜底）+ Keychain | 离线缓存笔记/课程/复习卡；Keychain 存 token |
| 图片 | `AsyncImage` + 轻量磁盘缓存（或 Nuke/Kingfisher 二选一） | 课程封面是渐变色为主，图片压力小 |
| 视频 | **AVPlayer / AVPlayerViewController** | HLS m3u8 原生支持 |
| Markdown | `swift-markdown` 或 `Down`（渲染课件/笔记正文） | 后端大量 Markdown |
| 二维码/图表 | Swift 原生 CoreImage（QR）+ Swift Charts（学习节奏柱图） | 无需第三方 |
| 状态/DI | 轻量：`@Observable`(iOS17) / `ObservableObject`(iOS16) + 环境注入 | 不引 Redux 类重框架 |

### 2.2 五个 iOS 关键架构决策

**决策 1：认证从 Cookie 改为 Token（必须）**
- Web 用 httpOnly session cookie（sameSite:strict）。iOS 的 URLSession 虽支持 cookie，但 App 场景下 **Bearer Token 更可控**（Keychain 存储、显式刷新、支持多设备）。
- **方案**：后端为 iOS 增加 `Authorization: Bearer <sessionId>` 支持——登录接口除 Set-Cookie 外，在响应体返回 sessionId（或新增 token 端点）；服务端 `getCurrentUser` 兼容「Cookie 或 Bearer」双读。详见 §5 + §17。

**决策 2：Apple IAP 合规（法务硬约束）**
- App Store 审核要求：**App 内销售数字内容（订阅/积分）必须走 Apple IAP**，不能只用微信/支付宝网页支付（会被拒）。
- **方案**：iOS 上「订阅方案 + 积分充值」走 StoreKit 2 IAP；后端加 `/api/iap/verify` 校验 Apple 收据后发放权益/积分。微信/支付宝支付在 iOS 端隐藏（仅 Web 保留）。详见 §10。

**决策 3：AI 生成的等待体验（一次性 JSON）**
- 后端 AI 是一次性返回（非流式），造课/出题可能耗时数秒到数十秒。
- **方案**：iOS 做「过程剧场」式 loading（对齐 Web 的 CreateStudio）——分步进度 + 骨架 + 可取消。逐节生成用串行请求 + 实时进度。未来后端上 SSE 时 iOS 换 `URLSession.bytes` 流式渲染。详见 §12。

**决策 4：离线优先的笔记与复习**
- 笔记、复习卡是高频、碎片、可离线的核心资产。
- **方案**：SwiftData 本地缓存 + 乐观写入 + 后台同步队列。断网可记笔记/翻复习卡，联网后同步。详见 §11。

**决策 5：视频受控流**
- 后端 `/api/stream/[assetId]` 返回受控（未来加密）m3u8，非订阅拿不到直链。
- **方案**：AVPlayer 加载签名 m3u8 URL；权益校验在服务端（返回 403 则 App 引导订阅）。截帧用 AVPlayerItemVideoOutput。详见 §9.1。

---

## 3. 工程结构与依赖

```
YoudaoStudio/
├── App/
│   ├── YoudaoStudioApp.swift        // @main, 环境注入(APIClient/Auth/Theme)
│   └── RootView.swift               // Tab 容器 + 未登录/登录路由
├── Core/
│   ├── Network/
│   │   ├── APIClient.swift          // URLSession 封装, Bearer 注入, 错误折叠
│   │   ├── Endpoints.swift          // 全量端点常量 + 请求构造
│   │   └── APIError.swift           // 402/403/429/5xx → 领域错误
│   ├── Auth/
│   │   ├── AuthManager.swift        // 登录态, Keychain token, 刷新
│   │   └── KeychainStore.swift
│   ├── Storage/
│   │   ├── ModelContainer.swift     // SwiftData 容器
│   │   └── SyncQueue.swift          // 离线写入队列
│   ├── Design/
│   │   ├── Tokens.swift             // STUDIO 色板/字体/圆角/阴影 → SwiftUI
│   │   ├── Components/              // Card/Button/Badge/Skeleton/Dialog...
│   │   └── Theme.swift              // 亮暗跟随系统 + 手动覆盖
│   └── Markdown/MarkdownView.swift
├── Features/
│   ├── Auth/  Desk/  Courses/  Learn/  Create/  Notes/  Notebook/
│   ├── Review/  Exam/  Profile/  Credits/  Subscription/  Settings/
│   ├── Community/  Market/  Notifications/  Companion/
│   └── (每个 = Views/ + ViewModels/ + Models/)
├── Shared/
│   ├── Models/                      // Codable DTO (对齐后端 JSON)
│   └── Utils/                       // 日期/时长/格式化(对齐 lib/format)
└── Resources/  (Assets: logo/badges/插画, Localizable.strings)
```

**第三方依赖（尽量少，SPM 管理）：**
- 必需：无重依赖。用系统能力优先。
- 可选：`swift-markdown`(Apple 官方) 或 `Down`；`Kingfisher`(图片缓存，若 AsyncImage 不够)。
- **不引**：Alamofire（URLSession 够用）、Redux 类库、重型 UI 库。

---

## 4. 网络层与 API 契约

### 4.1 统一响应格式（后端 `lib/api.ts` 约定）
所有接口返回：
```json
// 成功
{ "ok": true, "data": { ... } }
// 失败
{ "ok": false, "error": "错误文案" }
```
HTTP 状态码语义：`402`=需订阅/积分不足、`403`=无权限/越权、`404`=不存在、`429`=限流、`5xx`=服务端。

### 4.2 APIClient 设计（Swift）
```swift
struct APIResponse<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
}

actor APIClient {
    private let base = URL(string: AppConfig.apiBaseURL)!  // https://<host>
    private let session = URLSession(configuration: .default)

    func request<T: Decodable>(_ ep: Endpoint, as: T.Type) async throws -> T {
        var req = URLRequest(url: base.appending(path: ep.path))
        req.httpMethod = ep.method
        if let token = await AuthManager.shared.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // 同源写保护：后端 assertSameOrigin 校验 Origin/Referer；App 需带自定义头，见 §5.3
        req.setValue(AppConfig.appOrigin, forHTTPHeaderField: "X-App-Origin")
        if let body = ep.body { req.httpBody = try JSONEncoder().encode(body) }

        let (data, resp) = try await session.data(for: req)
        let http = resp as! HTTPURLResponse
        let decoded = try JSONDecoder.api.decode(APIResponse<T>.self, from: data)
        guard http.statusCode < 400, decoded.ok, let value = decoded.data else {
            throw APIError.from(status: http.statusCode, message: decoded.error)
        }
        return value
    }
}
```

### 4.3 全量 API 清单（iOS 对接映射）

> 分组列出。**★=P0 必接，○=P1，—=iOS 不接（管理后台走 Web）**。

**认证 Auth**
| 端点 | 方法 | 用途 | 优先级 |
|---|---|---|---|
| `/auth/login` | POST | 登录（返回 user + 需后端补 token，见 §17）| ★ |
| `/auth/signup` | POST | 注册 | ★ |
| `/auth/logout` | POST | 登出 | ★ |
| `/auth/me` | GET | 当前用户 | ★ |
| `/auth/password-reset` | POST | 发起找回密码 | ★ |
| `/auth/password-reset/confirm` | POST | 确认重置 | ★ |
| `/account/change-password` | POST | 改密码（登录态）| ★ |

**权益与首页**
| `/entitlement/me` | GET | 订阅权益快照 | ★ |
| `/home` | GET | 首页/营销数据 | ★ |
| `/me/gamification` | GET | 成长档案（streak/日历/徽章）| ★ |

**课程与学习**
| `/courses` | GET | 课程库列表（支持 q/category/sort）| ★ |
| `/courses/[id]` | GET | 课程详情 + 大纲 | ★ |
| `/courses/[id]/lessons` | GET | 章节列表 | ★ |
| `/lessons/[id]` | GET | 单章节内容（video/article/ai_block）| ★ |
| `/progress` | POST | 上报学习进度（progressSec/completed）| ★ |
| `/stream/[assetId]` | GET | 受控视频流地址 | ★ |
| `/updates` | GET | 书架上新 | ★ |

**AI 能力**
| `/ai/generate-course` | POST | 一句话生成课程大纲 | ★ |
| `/ai/generate-lesson` | POST | 逐节生成课件 | ★ |
| `/ai/import-source` | POST | 资料升维成课 | ○ |
| `/ai/companion` | POST | AI 学习伴侣问答 | ○ |
| `/ai/note-summary` | POST | 笔记 AI 总结/复习卡 | ★ |
| `/ai/note-transform` | POST | 笔记转换（大纲/行动项/翻译/周报）| ★ |
| `/ai/review-card` | GET/POST/PATCH | 复习卡队列/建卡/评分 | ★ |
| `/ai/generate-exam` | POST | 模拟考试出卷 | ★ |
| `/ai/search-expand(已废弃 2026-07-18:死端点已下线,语义搜索走 /courses SSR)` | POST | 搜索关键词扩展（可选，客户端可不接）| ○ |

**笔记系统**
| `/notes` | GET/POST | 笔记列表/创建（含独立笔记）| ★ |
| `/notes/[id]` | GET/PATCH/DELETE | 详情/编辑/删除 | ★ |
| `/notes/attachments` | POST | 图片/附件上传 | ○ |
| `/notes/import-url` | POST | 链接导入 | ○ |
| `/notes/export` | GET | 导出（md/html）| ○ |
| `/notebooks` | GET/POST | 笔记本列表/创建 | ★ |
| `/notebooks/[id]` | GET/PATCH/DELETE | 笔记本详情/改/删 | ★ |
| `/note-tags` `/note-tags/[id]` | CRUD | 标签 | ○ |

**复习与考试**
| `/review-card`（见 AI）| | 复习队列 | ★ |
| `/exams/[id]` | GET | 拉试卷题目（不含答案）| ★ |
| `/exams/[id]/submit` | POST | 交卷判分 | ★ |
| `/focus` | POST/PATCH | 专注会话入席/离席 | ○ |

**积分与订阅**
| `/credits/me` | GET | 积分余额 + 流水 | ★ |
| `/credits/recharge` | POST | 充值（iOS 改走 IAP，见 §10）| ★ |
| `/pricing` | GET | 套餐/价格 | ★ |
| `/subscription/me` | GET | 我的订阅 | ★ |
| `/subscription/cancel` `/change` `/restore` | POST | 订阅管理 | ★ |
| `/checkout/session` `/checkout/mock-pay` | POST | 支付（iOS 用 IAP 替代）| — |
| `/coupons/validate` | POST | 优惠券 | ○ |

**社区**
| `/demands` | GET/POST | 需求列表/提交 | ○ |
| `/demands/[id]` | GET | 需求详情 | ○ |
| `/demands/[id]/vote` `/follow` | POST | 投票/关注 | ○ |
| `/demands/[id]/comments` | GET/POST | 需求评论 | ○ |
| `/demands/[id]/stages` | GET | 阶段轨 | ○ |
| `/demands/me/voted` | GET | 我投过的 | ○ |
| `/posts` | GET/POST | 广场帖子列表/发帖 | ○ |
| `/posts/[id]/like` `/comment` `/repost` | POST | 点赞/评论/转发 | ○ |
| `/market/share` `/request` `/decide` | POST | 课程集市分享/申请/批准 | ○ |

**通知**
| `/notifications` | GET/PATCH | 通知列表/标记已读 | ★ |

**管理后台**（iOS 不做，走 Web）
| `/admin/*` | | 全部管理接口 | — |

---

## 5. 认证与会话

### 5.1 现状与问题
- Web：登录 → `createSession` 写 httpOnly cookie（`sameSite:strict`）。App 内 WebView 才能用；原生 URLSession 用 cookie 可行但不理想。
- 登录响应体只返回 `{id, nickname, role}`，**没有可用的 token**。

### 5.2 iOS 方案：Bearer Token
- **后端改动（§17 清单项 1）**：`/auth/login` 和 `/auth/signup` 响应体增加 `sessionToken`（= session.id 或专门签发的不透明 token）；`getCurrentUser` 支持从 `Authorization: Bearer` 读取 session，与 cookie 二选一。
- iOS：
  - 登录成功 → token 存 **Keychain**（`kSecAttrAccessibleAfterFirstUnlock`）。
  - 每个请求注入 `Authorization: Bearer <token>`。
  - 401 → 清 token，跳登录。
  - 登出 → 调 `/auth/logout` + 清 Keychain。

### 5.3 CSRF / 同源保护
- 后端写操作用 `assertSameOrigin`（校验 Origin/Referer）。原生 App 无浏览器 Origin。
- **后端改动（§17 项 2）**：`assertSameOrigin` 放行携带合法 `Authorization: Bearer` 的请求（Token 本身即防 CSRF，无需 Origin 校验）；或接受自定义头 `X-App-Origin: ios-app` + Token 组合。

### 5.4 会话生命周期
- Token 无感续期：接近过期时静默刷新（若后端支持 refresh；否则 30 天有效期到期重新登录）。
- 多设备：session 表已支持多条，天然多设备。

### 5.5 Apple 登录（P2，App Store 建议）
- 若 iOS 提供任何第三方登录（未来微信），Apple 要求**同时提供 Sign in with Apple**。
- 后端加 `/auth/apple`（校验 identityToken，`authProvider="apple"`）。首版可只做手机/邮箱密码登录，规避此要求。

---

## 6. 数据模型（Swift 侧映射）

iOS 只需映射「客户端消费」的模型（管理类如 AuditLog/Lead/Coupon 不需要）。全部 `Codable`，字段对齐后端 JSON（camelCase）。

### 6.1 核心 DTO 示例
```swift
struct UserDTO: Codable, Identifiable {
    let id: String
    let nickname: String
    let role: String
    let avatarUrl: String?
    let createdAt: Date
}

struct EntitlementDTO: Codable {   // 对齐 EntitlementSnapshot
    let isSubscriber: Bool
    let accessLevel: String        // free/premium/family_member
    let subscriptionStatus: String
    let validUntil: String?
    let canUseLLM: Bool
    let canVote: Bool
    let noteFreeLimit: Int
}

struct CourseDTO: Codable, Identifiable {
    let id, slug, title: String
    let subtitle, description: String?
    let category, level, coverColor: String
    let origin: String             // official/ai_generated/user_imported
    let totalDurationSec: Int
    let learnersCount: Int
    let isFeatured: Bool
}

struct LessonDTO: Codable, Identifiable {
    let id, title: String
    let contentType: String        // video/article/ai_block/mixed/live
    let durationSec: Int
    let isFree: Bool
    let videoUrl: String?
    let articleMd: String?
    let blocksJson: String?        // ai_block: 解析成 [Block]
}

struct NoteDTO: Codable, Identifiable {
    let id: String
    let courseId, lessonId: String?
    let title, excerpt, contentMd: String?
    let source: String             // lesson/manual/ai_transform/link_import
    let sourceUrl: String?
    let kind: String               // text/capture/clip
    let captureUrl: String?
    let pinned: Bool
    let notebookId: String?
    let createdAt, updatedAt: Date
}

struct ReviewCardDTO: Codable, Identifiable {
    let id, front, back: String
    let courseTitle: String?
}

struct CreditAccountDTO: Codable {
    let balance: Int
    let recentLedger: [CreditLedgerDTO]
}

struct ExamQuestionDTO: Codable, Identifiable {
    let id, type, stem: String     // single/judge/short
    let options: [String]?         // 不含 answer（防作弊）
}

struct NotificationDTO: Codable, Identifiable {
    let id, type, title: String
    let body: String?
    let refType, refId: String?
    let readAt: String?
    let createdAt: Date
}
```

### 6.2 块课件协议（ai_block）
后端 `blocksJson` 是 `{version, blocks:[...]}`，块类型白名单已扩到 15 种：基础 `concept/code/quiz/keypoint/callout` + v3 叙事 `objectives/scene/dialog/steps/compare/example/flashcard/summary/image` + **v4.3 `diagram`（语义图示：kind=flow/cycle/hub/layers/funnel + items[{label,detail}] + note，2026-07-19 起存量 87/89 节已含）**。iOS 渲染器按白名单消费、未知类型静默跳过（前向兼容铁律）；`diagram` 未实现前跳过不崩，但建议对齐 Web 版实现（信息密度高）。iOS 定义对应 enum + 渲染器（对齐 Web `BlockRenderer`）：
```swift
enum Block: Codable {
    case concept(title: String, body: String)
    case code(lang: String, code: String)
    case quiz(question: String, options: [String], answer: Int, explanation: String?)
    case keypoint(points: [String])
    case callout(tone: String, text: String)
}
```

### 6.3 日期与时长
- 后端返回 ISO8601（含时区）。用 `JSONDecoder.dateDecodingStrategy = .iso8601`（含毫秒的自定义策略）。
- 时长格式化（mmss / "剩 6 分钟"）复刻 `lib/format.ts` 逻辑到 Swift。

---

## 7. 设计系统移植（STUDIO → SwiftUI）

### 7.1 色板 Token（对齐 globals.css）
```swift
enum StudioColor {
    // 亮色
    static let bg = Color(hex: "#e7eaf0")
    static let surface = Color(hex: "#ffffff")
    static let surface2 = Color(hex: "#f4f6f9")
    static let ink = Color(hex: "#232935")
    static let ink2 = Color(hex: "#5b6474")
    static let ink3 = Color(hex: "#8790a0")
    static let ink4 = Color(hex: "#aeb6c2")
    static let border = Color(hex: "#e2e6ec")
    static let red = Color(hex: "#fc011a")          // 有道红：专注信号 ~7%
    static let redSoft = Color(hex: "#fff1f2")
    static let videoBg = Color(hex: "#232935")
    // 暗色值见 Assets Color Set 的 Any/Dark 双值
}
```
**实现**：用 **Asset Catalog Color Set**（Any Appearance + Dark）承载亮暗双值，SwiftUI 自动跟随系统。手动主题覆盖用 `@AppStorage("colorScheme")` + `.preferredColorScheme`。

### 7.2 字体
- Plus Jakarta Sans（UI/数字）+ Noto Sans SC（中文）+ IBM Plex Mono（数据/学号/积分）。
- 打进 bundle（.ttf）+ Info.plist 注册；封装 `Font.studio(_:)` / `.mono`。
- 支持动态字体（长辈模式 = 放大字号，对齐 Web fontScale）。

### 7.3 核心组件（Design/Components）
| 组件 | 对齐 Web | 说明 |
|---|---|---|
| `StudioCard` | 卡片 rounded-16 + border + card 阴影 | ViewModifier |
| `StudioButton` | 主(红/ink)/次/幽灵 三态 + 按压 scale .97 | |
| `Badge` | NEW/标签/状态 | |
| `SkeletonView` | 骨架屏 shimmer | .redacted + 微光 |
| `EmptyState` | 空态插画 + 引导 | 复用 badges/插画资源 |
| `Dialog/Sheet` | 弹窗 | `.sheet`/`.confirmationDialog` |
| `WaveProgress` | 水位进度 | Canvas 绘制 |
| `FlipCard` | 3D 翻牌 | `.rotation3DEffect` |
| `StudentCard` | 学生证 | 纸质卡 + QR(CoreImage) + Lv 等级 |

### 7.4 签名动效（对齐 studio-rise/lightup/poweron）
- 进场：`.transition(.move+opacity)` + spring。
- 点亮/通电：opacity+scale 序列。
- 复习卡飞出：`.offset` + 旋转 + 淡出。
- 全部尊重「减弱动态效果」（`UIAccessibility.isReduceMotionEnabled` → 降级为即时切换）。

---

## 8. 功能模块逐一实现

> 每模块给：屏幕清单 · 关键交互 · 依赖接口 · 离线策略。

### 8.1 认证模块
- **屏幕**：登录、注册、找回密码（发起+确认）。
- **交互**：手机/邮箱 + 密码；表单校验；错误内联；登录成功进书桌。
- **接口**：login/signup/password-reset(/confirm)/logout。
- **安全**：密码字段禁止截屏泄露（`.privacySensitive()`）；Token 存 Keychain；**禁止在 App 内代填密码到任何非本 App 表单**。

### 8.2 书桌（Desk，登录首页）
- **屏幕**：书桌 dashboard。
- **区块**（对齐 Web `/desk`）：问候+今日状态 → 中央「今天想学点什么」输入框 → 学习中（断点续学，最多 3 门）→ 我的书桌三卡（我的课/最近笔记/待复习）→ AI 今日建议 → 自习氛围条 → 书架上新。
- **接口**：`/home` 或组合（gamification + progress + notes + review-card count）。建议后端补一个 `/api/desk` 聚合接口（§17 项 3）减少多次往返。
- **交互**：输入框回车 → 造课或搜索；学习中卡 → 学习台断点。

### 8.3 课程库 + 详情
- **屏幕**：课程库（筛选/搜索/网格）、课程详情（封面渐变+大纲+订阅门）。
- **接口**：`/courses`（q/category/sort）、`/courses/[id]`。
- **交互**：赛道筛选、搜索（可选接 search-expand）；免费章节可试学，付费章节点击 → 订阅引导。

### 8.4 学习台（Learn，核心）
- **屏幕**：学习台（视频/图文/块课件 + 笔记面板 + 目录 + 专注模式）。
- **内容类型**：
  - `video` → AVPlayer（HLS）+ 进度条 + 倍速 + 截帧。
  - `article` → MarkdownView 滚动。
  - `ai_block` → BlockRenderer（concept/code/quiz/keypoint/callout）+ quiz 交互。
- **边学边记**：底部可拖拽笔记 Sheet（对齐 Web SheetDrag）；截帧成卡（video）；字幕划线剪藏。
- **进度**：每 10s 或暂停/退出时 `POST /progress`；`progressSec≥90%时长` 标 completed。
- **接口**：`/lessons/[id]`、`/stream/[assetId]`、`/progress`、`/notes`(POST)。
- **专注模式**（§9.5）：入席仪式 + 番茄钟 + 会话记录（`/focus`）。
- **离线**：已缓存章节可离线看图文/块课件；视频需在线。

### 8.5 AI 造课（Create）
- **屏幕**：造课台（输入需求）→ 备课剧场（理解→搭大纲→逐节写作）→ 完成页。
- **接口**：`/ai/generate-course`（出大纲）→ 循环 `/ai/generate-lesson`（逐节）。
- **交互**：过程剧场式进度（对齐 Web CreateStudio）；单节失败可重试；完成进学习台。
- **等待体验**：见 §12。积分预检（402 → 引导充值/订阅）。
- **导入 Tab**（P1）：资料升维 `/ai/import-source`。

### 8.6 笔记馆（Notes）
- **屏幕**：笔记馆（全部列表/时间轴/画廊/按课程/笔记本 五视图）、笔记详情、记一条采集面板。
- **采集**（对齐 Web ComposeDialog）：随手写(★) / 图片(○,相机+相册) / 链接导入(○) / 附件(○,Files)。
- **AI 整理**：总结/复习卡/大纲/行动项/翻译 → `/ai/note-summary` `/ai/note-transform`；结果可「存为笔记」。
- **接口**：`/notes`(GET/POST)、`/notes/[id]`、`/notebooks`、`/notes/attachments`、`/notes/import-url`。
- **离线**：SwiftData 缓存全部笔记；离线可记/编辑，联网同步（§11）。这是 iOS 最大的离线价值点。

### 8.7 笔记本（Notebook）
- **屏幕**：笔记本网格、笔记本详情（含该本 AI 整理）。
- **接口**：`/notebooks`、`/notebooks/[id]`。

### 8.8 复习室（Review）
- **屏幕**：任务卡 → 卡堆练习（3D 翻牌 + 连击 + 飞出）→ 结算。
- **交互**：滑动评分（左忘/右记得）、点击翻面、连击 combo、结算 confetti。
- **接口**：`/ai/review-card`（GET 队列 / PATCH 评分）。
- **离线**：复习卡缓存本地，离线可练，评分入同步队列。碎片时间复习是移动端杀手锏 → 配推送召回。

### 8.9 模拟考试（Exam）
- **屏幕**：出卷（范围/题量/难度）→ 答题（一题一屏/进度点）→ 成绩单。
- **接口**：`/ai/generate-exam`（出卷）、`/exams/[id]`（拉题，不含答案）、`/exams/[id]/submit`（判卷）。
- **交互**：单选/判断/简答；成绩单错题解析 + 溯源 + 错题一键转复习卡。

### 8.10 成长档案 + 学生证（Profile）
- **屏幕**：成长档案（学生证 Plus + 积分卡 + 学习进度 + 成长足迹）。
- **学生证**：纸质卡 + 大数字 + Lv 等级称号（`lib/level` 逻辑移植）+ 编号 + 格言 + QR（CoreImage 生成，指向 /u/[id]）。
- **接口**：`/me/gamification`、`/credits/me`、`/entitlement/me`、`/progress`。
- **图表**：本周学习节奏用 Swift Charts；潮汐日历用 LazyVGrid 热力图。

### 8.11 积分（Credits）
- **屏幕**：积分卡（余额+本月消耗+流水明细+充值）。
- **接口**：`/credits/me`；充值走 **IAP**（§10）。
- **显示**：AI 功能出口显示预估消耗（estimateCredits 逻辑移植）。

### 8.12 订阅（Subscription）
- **屏幕**：订阅方案（三档）、订阅管理（当前状态/续期/取消/恢复）。
- **接口**：`/pricing`、`/subscription/me`、`/subscription/*`；购买走 **IAP**（§10）。

### 8.13 设置（Settings）
- **屏幕**：分区设置（账号安全/订阅与积分/偏好/隐私/帮助）。
- **功能**：改密码、长辈模式+字号、通知开关、导出笔记、退出、注销、条款。
- **接口**：`/account/change-password`、`/notes/export`、`/auth/logout`。
- **iOS 特有**：「恢复购买」入口（IAP 必需）；隐私（App Tracking 透明度若接入分析）。

### 8.14 社区（Community，P1）
- **屏幕**：社区空间（投票共创 Tab + 自习室广场 Tab）、个人主页 /u/[id]。
- **广场**：Feed（最新/热门）、发帖（文本+图片+话题）、点赞/评论/转发。
- **接口**：`/demands/*`、`/posts/*`、`/market/*`。
- **合规**：发帖走后端 LLM 审核；UGC 需 App 内举报/屏蔽机制（App Store 要求，见 §13）。

### 8.15 通知（Notifications）
- **屏幕**：通知列表 + 顶部铃铛未读角标。
- **接口**：`/notifications`（GET/PATCH）。
- **推送**：APNs（§9.4）——申请通过/被评论/课程更新/复习召回。

---

## 9. 原生能力

### 9.1 视频播放（AVPlayer）
- 加载 `/stream/[assetId]` 返回的 m3u8。403 → 订阅引导。
- 倍速、进度记忆（seek 到 progressSec）、后台音频（可选）、画中画（可选）。
- **截帧**：`AVPlayerItemVideoOutput.copyPixelBuffer` → UIImage → 存为 capture 笔记（`/notes` kind=capture）。

### 9.2 相机与相册
- 记一条「图片」：`PHPicker`（相册）+ `UIImagePickerController`/AVFoundation（拍照）。
- 上传走 `/notes/attachments`（multipart 或 base64）。
- 权限：Info.plist `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`。

### 9.3 文件（附件导入）
- `.fileImporter`（UIDocumentPicker）选 pdf/docx/txt → `/notes/attachments`。≤10MB 校验。

### 9.4 推送（APNs）
- 场景：社区互动、课程更新、**复习召回**（今日 N 张待复习）、积分到账。
- **后端改动（§17 项 4）**：设备 token 注册端点 `/api/devices`；通知触发时推 APNs。
- 本地通知兜底：复习提醒可用 `UNUserNotificationCenter` 本地定时（无需服务端）。
- 权限：首次在合适时机请求（不在启动即弹）。

### 9.5 专注模式与后台
- 番茄钟：前台计时 + `UNUserNotification` 到点提醒；后台用 `BGAppRefreshTask` 兜底。
- 会话记录 `/focus`（入席/离席）。

### 9.6 Deep Link / Universal Links
- 支持 `youdaostudio://` 与 Universal Links（`/u/[id]`、`/courses/[slug]`、通知跳转）。
- 二维码扫码进个人主页。

---

## 10. 支付与 Apple IAP 合规（关键）

### 10.1 硬约束
App Store 审核指南 3.1.1：**App 内解锁的数字内容/订阅必须用 Apple IAP**。当前 Web 的微信/支付宝支付**不能**直接搬到 iOS（会被拒审）。

### 10.2 方案
- **订阅**：用 StoreKit 2 配置**自动续订订阅**（对齐后端 Plan 的月/季/年档）。
- **积分**：用**消耗型内购**（60/350/1300 积分包，对齐 `/credits/recharge` 档位）。
- **购买流程**：
  1. iOS StoreKit 发起购买 → 得到交易凭证（JWS / receipt）。
  2. 调**后端新接口** `POST /api/iap/verify`（§17 项 5）：后端用 App Store Server API 校验凭证真伪 → 发放订阅权益（写 Subscription/Entitlement）或积分（grantCredits）。
  3. 前端刷新 `/entitlement/me` `/credits/me`。
- **恢复购买**：`AppStore.sync()` + 重新 verify（设置页必须有入口）。
- **退款/退订**：Apple 侧处理；后端接 App Store Server Notifications V2（webhook）同步状态。

### 10.3 价格一致性
- IAP 价格档需与 Web 对齐（或按 Apple 价格梯度就近）。积分数量后端按 productId 映射，**不信客户端传的数量**。

### 10.4 边界
- 实体商品/服务（若未来有）可用外部支付；纯数字内容必须 IAP。
- 微信/支付宝在 iOS 端隐藏（`AppConfig.platform == .ios` 时不展示）。

---

## 11. 离线与同步策略

### 11.1 缓存分层
| 数据 | 策略 |
|---|---|
| 笔记 / 笔记本 / 复习卡 | **离线优先**：SwiftData 全量缓存，可离线读写 |
| 课程/章节内容 | 按需缓存（学过的章节存本地，图文/块课件离线可读；视频在线）|
| 用户/权益/积分 | 内存 + 短缓存，联网刷新 |
| 社区/通知 | 在线为主，缓存最近一页 |

### 11.2 同步队列（SyncQueue）
- 离线写（记笔记/翻复习卡/改笔记）→ 写本地 + 入待同步队列（含操作类型、payload、本地时间戳）。
- 联网 → 按序重放到后端；成功清队列项，失败重试（指数退避）。
- **冲突**：笔记以 `updatedAt` 后写胜；复习卡评分是幂等 PATCH，重放安全。
- **乐观 UI**：本地立即反映，后台同步；失败给非阻断提示。

### 11.3 首屏与预取
- 冷启动先渲染本地缓存（书桌/笔记/复习），再后台刷新，避免白屏。

---

## 12. AI 能力对接

### 12.1 当前（一次性 JSON）
- 造课/出题/整理是一次请求、等完整结果。耗时长（DeepSeek 推理模型）。
- **iOS 体验**：
  - 单次调用：全屏/卡片 loading + 骨架 + 「AI 正在思考」文案 + 可取消（取消即中断请求，不扣积分——扣积分在成功返回后）。
  - 逐节造课：串行请求，实时进度「正在写第 N/M 节」，单节失败标记可重试。
- 超时：客户端设 60s，与后端 45s 对齐留余量；超时给重试。

### 12.2 演进（流式 SSE，P2）
- 后端可为 companion/generate-lesson 加 SSE（`text/event-stream`）。
- iOS 用 `URLSession.bytes(for:)` 逐行读取，边到边渲染（对话式伴侣的关键体验）。
- 文档预留：ViewModel 抽象 `AIStream` 协议，一次性与流式两种实现可切换。

### 12.3 积分与权益
- 每个 AI 入口前查 `/entitlement/me`（canUseLLM）+ `/credits/me`（余额）。
- 不足 → 引导订阅/充值（IAP）。扣费由后端在调用后按实际 token 记账（客户端只读余额）。

---

## 13. 安全与合规

- **Token**：Keychain 存储；不写日志；越狱检测（可选）。
- **传输**：全 HTTPS + ATS；证书校验（可选 pinning）。
- **越权**：客户端只信后端返回的本人数据；不在客户端做权限判断（后端 where userId 已保证）。
- **UGC 合规（社区，App Store 硬要求）**：
  - 用户可**举报**帖子/评论、**屏蔽**用户；
  - 有**内容审核**（后端 LLM + 人工队列已具备）；
  - 有明确的**社区准则** + 违规处理；
  - 24h 内响应举报（运营侧）。
- **隐私**：
  - App Privacy 清单（PrivacyInfo.xcprivacy）声明数据收集；
  - 分析事件（`/analytics`）需符合 ATT（若跨 App 追踪）；本 App 内分析通常无需 ATT。
  - 账号注销：设置页提供，走后端删号逻辑（App Store 要求「可删除账号」）。
- **儿童/银发**：长辈模式；无定向广告。
- **密码/支付红线**：App 内不代填密码到外部；支付走 IAP。

---

## 14. 性能与可访问性

- **启动**：冷启动 < 2s；先本地缓存后刷新。
- **列表**：LazyVStack/LazyVGrid + 分页；图片异步 + 占位。
- **动效**：60fps；尊重减弱动态效果。
- **内存**：视频/大图及时释放；SwiftData 查询分页。
- **可访问性**：VoiceOver 全覆盖；动态字体；对比度达 WCAG AA（复用 Web 已验证的 token 对比度）；触达区 ≥44pt。
- **深色模式**：全站双色，Asset Color Set 自动跟随。

---

## 15. 测试策略

- **单元**：格式化/等级派生/时长/积分预估（对齐 lib 逻辑）；DTO 解码（用真实后端 JSON 样本）。
- **集成**：APIClient 打真实 dev 后端各接口（契约测试）；离线同步队列重放。
- **UI**：关键流 XCUITest（登录→书桌→学习→记笔记→复习→考试）。
- **快照**：核心组件亮暗双主题快照测试。
- **IAP**：StoreKit Testing（本地 .storekit 配置）沙盒测试购买/恢复/退款。
- **可访问性**：Accessibility Inspector 审计。

---

## 16. 分期交付计划

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M0 地基**（2-3w）| 工程搭建 + 设计系统 Token/组件 + APIClient + 认证（需后端补 token/§17项1-2）+ 书桌骨架 | 后端 token 支持 |
| **M1 学习主干**（3-4w）| 课程库/详情/学习台（视频+图文+块课件）+ 进度上报 + 边学边记 | M0 |
| **M2 笔记与复习**（3w）| 笔记馆五视图 + 采集面板 + 笔记本 + 复习室 3D 翻牌 + 离线同步 | M1 |
| **M3 AI 与考试**（2-3w）| AI 造课过程剧场 + AI 整理 + 模拟考试闭环 | M1 |
| **M4 身份与商业化**（3w）| 成长档案/学生证 + 积分卡 + 订阅 + **IAP 合规**（需后端 §17项5）+ 设置 | 后端 IAP verify |
| **M5 社区与通知**（3w，P1）| 社区空间 + 广场 + 集市 + 个人主页 + 通知 + APNs 推送 | 后端 §17项4 |
| **M6 打磨与上架**（2w）| 性能/可访问性/隐私清单/举报屏蔽/审核材料 + TestFlight + 提审 | 全部 |

总计约 5-6 个月（单人；并行可压缩）。P0 交付（M0-M4）约 3-3.5 个月。

---

## 17. 后端需为 iOS 补的接口清单（联调前置）

| # | 改动 | 用途 | 优先级 |
|---|---|---|---|
| 1 | `/auth/login` `/auth/signup` 响应体加 `sessionToken`；`getCurrentUser` 兼容 `Authorization: Bearer` | iOS Token 认证 | 阻塞 M0 |
| 2 | `assertSameOrigin` 放行携带合法 Bearer Token 的请求（或认 `X-App-Origin`）| App 写操作 | 阻塞 M0 |
| 3 | 新增 `/api/desk` 聚合接口（问候+续学+书桌三卡+建议+氛围）| 减少书桌多次往返 | M0（可选，先用组合）|
| 4 | `/api/devices` 注册 APNs device token + 服务端推送触发 | 推送 | M5 |
| 5 | `/api/iap/verify` 校验 Apple 收据 → 发订阅/积分 + App Store Server Notifications webhook | IAP 合规 | 阻塞 M4 |
| 6 | 账号注销接口确认（App Store 要求可删号）| 合规 | M4 |
| 7 | `/auth/apple`（Sign in with Apple，若做第三方登录）| 合规 | P2 |
| 8 | 分页游标统一（列表接口 cursor/limit），移动端瀑布流 | 性能 | M1 |

---

## 18. 与 Web 的能力对齐检查表

> 交付前逐项核对 iOS 是否覆盖 Web v2.3 能力（★P0 必须对齐）。

- [x] ★ 认证（登录/注册/找回/改密/登出/注销）
- [x] ★ 书桌 + 断点续学
- [x] ★ 课程库/详情/学习台（video/article/ai_block）+ 进度
- [x] ★ AI 造课（过程剧场）
- [x] ★ 笔记（五视图/详情/编辑/笔记本/AI整理/采集）+ 离线
- [x] ★ 复习室（3D翻牌/连击/结算）
- [x] ★ 模拟考试（出卷/判卷/错题转卡）
- [x] ★ 成长档案 + 学生证 + 等级
- [x] ★ 积分（余额/流水）+ 订阅（IAP）
- [x] ★ 设置（分区）+ 通知
- [ ] ○ 社区空间（投票/广场/评论/转发）
- [ ] ○ 课程集市（分享/申请/批准）
- [ ] ○ 个人主页
- [ ] ○ 资料升维导入 + AI 伴侣
- [ ] ○ 推送召回
- [ ] — 管理后台（走 Web，iOS 不做）

---

## 附录 A：关键差异速查（Web → iOS）

| 维度 | Web | iOS |
|---|---|---|
| 认证 | httpOnly session cookie | Bearer Token（Keychain）|
| 支付 | mock/微信/支付宝 + webhook | **Apple IAP**（StoreKit 2）+ /iap/verify |
| 布局 | 顶部导航 + 全宽内容 | TabBar（书桌/课程/造课/笔记/我的）+ 导航栈 |
| AI 等待 | 过程剧场（DOM）| 过程剧场（SwiftUI）+ 可取消 |
| 视频 | mock-hls / video 标签 | AVPlayer HLS |
| 离线 | 无（SSR）| SwiftData 缓存 + 同步队列 |
| 主题 | prefers-color-scheme + data-theme | Asset Color Set + preferredColorScheme |
| 通知 | 站内铃铛 | 站内 + APNs 推送 |
| Markdown | renderMarkdown | swift-markdown |
| 二维码 | qrcode(svg) | CoreImage CIQRCodeGenerator |

---

## 附录 B：移动端信息架构（TabBar）

```
底部 5 Tab（对齐 Web 移动 Tab，造课居中凸起）：
[书桌] [课程] [＋造课(凸起)] [笔记] [我的]

各 Tab 内导航栈：
- 书桌 → 学习台 / 造课 / 搜索
- 课程 → 课程详情 → 学习台
- 造课 → 备课剧场 → 完成 → 学习台
- 笔记 → 笔记详情 / 笔记本 / 采集
- 我的 → 成长档案 / 复习室 / 考试 / 积分 / 订阅 / 社区 / 设置 / 通知

（复习室/社区/考试从「我的」或书桌卡片进入，不占一级 Tab，与 Web 一致）
```

---

*本文档随 Web 平台演进同步更新。当前基线 Web v2.3（commit 61c472d）。*
