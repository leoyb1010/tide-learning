// macOS 专属入口。整文件仅在 macOS 参与编译，iOS 走 YoudaoStudioApp.swift。
//
// M0 建 App 入口（本文件）；MacRootView 真身由 M1 建于 MacFeatures/MacRootView.swift。
// M1 补：注入全局 TabRouter（侧边栏选中态与之桥接，语义对齐 iOS 底部 Tab 0-4），
// 并把占位设置面板升级为真实账号面板。
#if os(macOS)
import SwiftUI

@main
struct YoudaoStudioAppMac: App {
    @State private var auth = AuthManager.shared
    // 全局 Tab 路由：Mac 侧边栏选中态与 router.selection 桥接（0书桌…4我的），
    // 复用跨屏意图（书桌「今天想学」→ 造课台）。
    @State private var router = TabRouter(selection: 0)

    var body: some Scene {
        WindowGroup {
            MacRootView()
                .environment(auth)
                .environment(router)
                .tint(Studio.red)
                .frame(minWidth: 900, minHeight: 600)
                .task { await auth.bootstrap() }
        }
        .windowStyle(.titleBar)

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

        .commands {
            // 命令菜单雏形：账号相关（退出登录）。M1 可扩展更多命令。
            CommandGroup(replacing: .appInfo) {
                Button("关于 有道自习室") { }
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
}

// MacRootView 真身已移至 MacFeatures/MacRootView.swift（M1）。

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
