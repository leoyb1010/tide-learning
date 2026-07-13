import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class StudioAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushManager.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushManager.shared.didRegister(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        PushManager.shared.didFailToRegister(error)
    }
}

@main
struct YoudaoStudioApp: App {
    @UIApplicationDelegateAdaptor(StudioAppDelegate.self) private var appDelegate
    @State private var auth = AuthManager.shared
    // DEV：启动环境变量 DEV_TAB 指定初始 Tab（0书桌/1课程/2造课/3笔记/4我的），便于逐屏验证。
    @State private var router = TabRouter(
        selection: Int(ProcessInfo.processInfo.environment["DEV_TAB"] ?? "0") ?? 0
    )

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(router)
                .tint(Studio.red)
                .task { await auth.bootstrap() }
                // 深链：youdaostudio://note|course|desk|create|profile|review|exam|market
                // → 切到对应底部 Tab（详情类简化为跳 Tab，最小可用，与 Mac 端对齐）。
                .onOpenURL { url in handleDeepLink(url) }
        }
    }

    /// 解析深链并切到对应 Tab。仅认自定义 scheme youdaostudio://。
    /// Tab 索引对齐 TabRouter：0书桌 / 1课程 / 2造课 / 3笔记 / 4我的。
    @MainActor
    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "youdaostudio" else { return }
        let host = url.host?.lowercased()
        let tab: Int?
        switch host {
        case "desk", "home":              tab = 0
        case "course", "courses", "market": tab = 1
        case "create", "compose":         tab = 2
        case "note", "notes", "review", "exam": tab = 3
        case "profile", "me":             tab = 4
        default:                          tab = nil
        }
        if let tab { router.selection = tab }
    }
}
