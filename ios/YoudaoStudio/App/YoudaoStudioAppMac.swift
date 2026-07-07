// macOS 专属入口。整文件仅在 macOS 参与编译，iOS 走 YoudaoStudioApp.swift。
//
// M0 建 App 入口（本文件）；MacRootView 真身由 M1 建于 MacFeatures/MacRootView.swift。
// M1 补：注入全局 TabRouter（侧边栏选中态与之桥接，语义对齐 iOS 底部 Tab 0-4），
// 并把占位设置面板升级为真实账号面板。
#if os(macOS)
import SwiftUI
import UserNotifications

@main
struct YoudaoStudioAppMac: App {
    @State private var auth = AuthManager.shared
    // 全局 Tab 路由：Mac 侧边栏选中态与 router.selection 桥接（0书桌…4我的），
    // 复用跨屏意图（书桌「今天想学」→ 造课台）。
    @State private var router = TabRouter(selection: 0)

    // 菜单栏依赖的 openWindow(\.openWindow) 只能在 View 环境里取用；App struct 内不可直接调。
    // 命令按钮「记一条 ⌘N」放进持有 @Environment(\.openWindow) 的小 wrapper（NewNoteCommandButton），
    // 保证 App 里能编过（见 .commands）。

    init() {
        // M5：冷启动尽早接管前台通知展示（willPresent 返回 banner/sound/badge），
        // 否则 App 在前台时系统默认不弹横幅。
        UNUserNotificationCenter.current().delegate = MacNotifications.shared
    }

    var body: some Scene {
        // 主窗设 id:"main"，供菜单栏「打开主窗」用 openWindow(id:"main") 前置。
        WindowGroup(id: "main") {
            MacRootView()
                .environment(auth)
                .environment(router)
                .tint(Studio.red)
                .frame(minWidth: 900, minHeight: 600)
                .task { await auth.bootstrap() }
                // M5：App 启动即拉一次 /api/desk 刷新 Dock 徽标 + 安排每日复习提醒。
                // task(id:isLoggedIn)：登录态从未登录→已登录时再跑一次，保证登录后即时生效。
                .task(id: auth.isLoggedIn) {
                    await MacNotifications.shared.enableReviewReminder()
                    await refreshDockBadge()
                }
                // M5 深链：youdaostudio://note/... | course/... | review | exam | desk 等
                // → 设 router.selection 跳对应 section（详情跳转简化为跳到对应 tab）。
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
        .windowStyle(.titleBar)

        // 「记一条」快速笔记浮窗（openWindow(id:"compose") / ⌘N 打开）。
        // 注入与主窗一致的 auth/router 环境；MacComposeWindow 内走 API.shared，环境一致避免子视图取用崩。
        WindowGroup(id: "compose") {
            MacComposeWindow()
                .environment(auth)
                .environment(router)
                .tint(Studio.red)
                .frame(minWidth: 420, minHeight: 520)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 480, height: 640)

        // 「导入资料」窗（文件 → 导入资料… / ⌘⇧I 打开）：上传/粘贴资料 → AI 拆章生成课。
        WindowGroup(id: "import") {
            MacImportWindow()
                .environment(auth)
                .environment(router)
                .tint(Studio.red)
                .frame(minWidth: 460, minHeight: 560)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 520, height: 680)

        // 菜单栏常驻项：今日学习速览 + 快速入口（记一条 / 打开主窗）。
        // .menu 样式渲染为下拉菜单；注入 auth 供内容判登录态、拉 /api/desk。
        MenuBarExtra("有道自习室", systemImage: "book.closed") {
            MacMenuBarContent()
                .environment(auth)
                .environment(router)
        }
        .menuBarExtraStyle(.menu)

        // 独立播放器窗（course 详情里可访问的节 openWindow(id:"player", value: lessonId) 打开）。
        // for: String.self → 载入 lessonId；注入与主窗一致的 auth/router 环境（VM 走 API.shared，
        // 无强依赖，但保持环境一致避免子视图取用时崩）。macOS 14 支持 WindowGroup(id:for:)。
        WindowGroup(id: "player", for: String.self) { $lessonId in
            if let lessonId {
                MacPlayerWindow(lessonId: lessonId)
                    .environment(auth)
                    .environment(router)
                    .tint(Studio.red)
                    .frame(minWidth: 640, minHeight: 480)
            }
        }
        .windowStyle(.titleBar)

        // M5「关于」独立小窗（openWindow(id:"about") 打开）。固定尺寸、不可缩放。
        Window("关于 有道自习室", id: "about") {
            MacAboutView()
                .tint(Studio.red)
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentSize)
        .defaultPosition(.center)

        .commands {
            // 命令菜单雏形：账号相关（退出登录）。M1 可扩展更多命令。
            // M5：「关于」按钮打开独立 About 窗（用持有 openWindow 的 wrapper）。
            CommandGroup(replacing: .appInfo) {
                AboutCommandButton()
            }
            // 文件菜单「记一条 ⌘N」：openWindow 需 View 环境，故用持有 @Environment(\.openWindow)
            // 的 wrapper 承载（App struct 内不能直接取 openWindow）。
            CommandGroup(after: .newItem) {
                NewNoteCommandButton()
                ImportMaterialCommandButton()
            }
            CommandMenu("账号") {
                Button("退出登录") {
                    Task { await AuthManager.shared.logout() }
                }
                .keyboardShortcut("q", modifiers: [.command, .shift])
            }
        }

        // 偏好设置（⌘,）：账号信息 + 退出登录。注入 auth 环境供面板读取登录态。
        Settings {
            MacSettingsPlaceholder()
                .environment(auth)
                .tint(Studio.red)
        }
    }

    // MARK: - M5 辅助

    /// 拉一次 /api/desk 刷新 Dock 徽标（App 启动 / 登录后兜底）。
    /// 未登录时跳过（无 token，/api/desk 会 401）。失败静默（徽标非关键）。
    @MainActor
    private func refreshDockBadge() async {
        guard auth.isLoggedIn else {
            MacMenuBarViewModel.updateDockBadge(dueReviewCount: 0)
            return
        }
        if let data = try? await API.shared.get("/api/desk", as: MacDeskData.self) {
            MacMenuBarViewModel.updateDockBadge(dueReviewCount: data.dueReviewCount)
        }
    }

    /// 解析深链并跳转到对应 section。仅认自定义 scheme youdaostudio://。
    /// host 决定目标；详情类（note/course）简化为跳到对应 tab，不深入具体 id（最小可用）。
    @MainActor
    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "youdaostudio" else { return }
        // youdaostudio://note/<id> → host = "note"；youdaostudio://review → host = "review"。
        let host = url.host?.lowercased()
        let target: MacSection?
        switch host {
        case "note", "notes":       target = .notes
        case "course", "courses":   target = .courses
        case "desk", "home":        target = .desk
        case "create", "compose":   target = .create
        case "profile", "me":       target = .profile
        case "market":              target = .market
        case "review":              target = .review
        case "exam":                target = .exam
        default:                    target = nil
        }
        if let target {
            router.selection = target.rawValue
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}

/// 「关于 有道自习室」命令按钮 wrapper：持有 @Environment(\.openWindow)，供 .commands 使用。
/// App struct 内无法直接取 openWindow，故封装为 View 放进 CommandGroup(replacing:.appInfo)。
struct AboutCommandButton: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("关于 有道自习室") {
            openWindow(id: "about")
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}

// MacRootView 真身已移至 MacFeatures/MacRootView.swift（M1）。

/// 「记一条 ⌘N」命令按钮 wrapper：持有 @Environment(\.openWindow)，供 App 的 .commands 使用。
/// App struct 内无法直接取 openWindow，故封装为一个 View，放进 CommandGroup。
struct NewNoteCommandButton: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("记一条") {
            openWindow(id: "compose")
        }
        .keyboardShortcut("n", modifiers: .command)
    }
}

/// 「导入资料… ⌘⇧I」命令按钮 wrapper：打开 Mac 导入窗（文件菜单，紧随「记一条」）。
struct ImportMaterialCommandButton: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("导入资料…") {
            openWindow(id: "import")
        }
        .keyboardShortcut("i", modifiers: [.command, .shift])
    }
}

/// 偏好设置面板（⌘,）：账号信息 + 退出登录。
struct MacSettingsPlaceholder: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("偏好设置")
                .font(.studio(16, .bold))
                .foregroundStyle(Studio.ink)

            if let user = auth.user {
                VStack(alignment: .leading, spacing: 6) {
                    Text("当前账号")
                        .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
                    Text(user.nickname)
                        .font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                Text(auth.isLoggedIn ? "已登录" : "未登录")
                    .font(.studio(13)).foregroundStyle(Studio.ink3)
            }

            if auth.isLoggedIn {
                StudioButton(title: "退出登录", kind: .ghost) {
                    Task { await auth.logout() }
                }
            }

            Spacer()
        }
        .padding(24)
        .frame(width: 420, height: 260)
        .background(Studio.bg)
    }
}
#endif
