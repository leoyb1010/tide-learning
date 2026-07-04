# 有道自习室 STUDIO · iOS App

SwiftUI 原生 App，对齐 Web 平台 v2.3 的全部能力。「AI 虚拟自习室」：说出想学的 → AI 造课 → 边学边记 → 到点复习 → 社区共创。

## 现状（本轮交付）

**P0+P1 全量落地，47 个 Swift 文件，`BUILD SUCCEEDED`，模拟器实测多屏端到端跑通真实数据。**

### 已实测通过（模拟器 + 真实后端）
- ✅ **认证**：登录/注册，Bearer Token 存 Keychain，端到端打通
- ✅ **书桌**：问候/连续天数/学习中续学/三卡/AI 建议（`/api/desk` 聚合）
- ✅ **课程库**：搜索/赛道筛选/渐变封面课程网格（真实课程数据）
- ✅ **造课**：过程剧场输入框/示例/积分预检
- ✅ **笔记馆**：五视图/标签/课程来源/章节锚点（真实笔记）
- ✅ **成长档案**：学生证（纸质卡+学号+Lv等级+二维码+格言）+ 积分600 + Swift Charts 学习节奏图

### 代码完成 + 编译通过（待逐屏手测）
- 学习台（video/article/ai_block 三类型 + 边学边记 + 进度上报）
- 课程详情、笔记详情/编辑、笔记本
- 复习室（3D 翻牌/连击/结算）、模拟考试（出卷/答题/成绩单/错题转卡）
- 积分卡/充值、订阅（StoreKit2 IAP 骨架）、设置分区/改密码/注销
- 社区（投票共创 + X 式广场/发帖/评论/转发）、课程集市、个人主页
- 通知中心、APNs 推送 Manager、AI 学习伴侣

## 技术栈
- SwiftUI (iOS 17+) + MVVM + `@Observable` ViewModel
- `URLSession` 自建 `API.shared`（Bearer 注入 + 错误折叠 + ISO8601 日期）
- Keychain 存 token；StoreKit 2 做 IAP；AVKit 播视频；Swift Charts 画图表；CoreImage 生成二维码
- 设计系统 `Studio.*` token（对齐 Web STUDIO，亮暗跟随系统）

## 工程结构
```
App/            入口 + RootView(TabBar) + AppConfig
Core/
  Network/      APIClient / APIError / Endpoints
  Auth/         AuthManager / KeychainStore
  Design/       Tokens + Components(卡片/按钮/骨架/空态)
Features/       Auth Desk Courses Learn Create Notes Notebook
                Review Exam Profile Credits Settings
                Community Market Notifications Push Companion
```

## 运行

**前置**：Web 后端跑在 `http://localhost:3100`（`AppConfig.apiBaseURL`）。真机需改成局域网 IP。

```bash
# 1. 生成工程（首次或改了 project.yml 后）
xcodegen generate

# 2. Xcode 打开 YoudaoStudio.xcodeproj，选模拟器运行
# 或命令行：
xcodebuild -project YoudaoStudio.xcodeproj -scheme YoudaoStudio \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

**联调便利**（仅调试，生产无这些环境变量不触发）：
- 启动环境变量 `DEV_TOKEN=<sessionToken>` 跳过登录（AuthManager.bootstrap 读取）
- 启动环境变量 `DEV_TAB=0..4` 指定初始 Tab（0书桌/1课程/2造课/3笔记/4我的）

## 后端依赖（已在 Web 侧完成）
- `/auth/login`·`/auth/signup` 返回 `sessionToken`；`getCurrentUser` 兼容 `Authorization: Bearer`
- `assertSameOrigin` 放行 Bearer 请求
- `GET /api/desk` 书桌聚合
- `POST /api/iap/verify` Apple 收据校验（幂等）
- `POST/DELETE /api/devices` APNs 设备注册
- `POST /api/account/delete` 注销

## 上架前 TODO（M6 收尾 → 提审）
1. **IAP 真实配置**：App Store Connect 建订阅/消耗型内购产品；`/api/iap/verify` 接 App Store Server API 真实校验（当前 mock 发放）
2. **APNs 证书**：配 Push 能力 + 服务端推送触发
3. **字体**：打进 Plus Jakarta / Noto Sans SC / IBM Plex Mono（当前用系统字体）
4. **图标/启动图**：AppIcon + LaunchScreen
5. **UGC 合规**：社区加举报/屏蔽（App Store 硬要求）
6. **隐私清单**：PrivacyInfo.xcprivacy + App Privacy 声明
7. **离线同步**：笔记/复习卡 SwiftData 本地缓存 + 同步队列（文档 §11，当前在线为主）
8. **可访问性**：VoiceOver 全覆盖走查
9. **Sign in with Apple**：若接第三方登录则必需
10. **签名**：配 Team + Provisioning，真机 + TestFlight

详见 `../tide-work/docs/ios-development-plan.md`（完整开发规格）。
```
基线：Web 平台 v2.3（commit 100a952）
```
