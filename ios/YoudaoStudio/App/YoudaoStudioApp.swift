import SwiftUI

@main
struct YoudaoStudioApp: App {
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
        }
    }
}
