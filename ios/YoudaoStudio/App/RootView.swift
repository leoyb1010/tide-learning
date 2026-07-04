import SwiftUI

/// 根视图：未登录 → 登录页；登录 → 底部 5 Tab（对齐 Web 移动 Tab，造课居中）。
struct RootView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        Group {
            if !auth.didBootstrap {
                SplashView()
            } else if auth.isLoggedIn {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: auth.isLoggedIn)
        .animation(.easeInOut(duration: 0.25), value: auth.didBootstrap)
    }
}

struct SplashView: View {
    var body: some View {
        ZStack {
            Studio.bg.ignoresSafeArea()
            VStack(spacing: 10) {
                Text("有道自习室")
                    .font(.studio(20, .bold)).foregroundStyle(Studio.ink)
                Text("STUDIO").font(.mono(11, .bold)).foregroundStyle(Studio.ink4)
                    .tracking(3)
                ProgressView().tint(Studio.red).padding(.top, 8)
            }
        }
    }
}

struct MainTabView: View {
    // 选中态由全局 TabRouter 托管，支持跨屏跳转（书桌「今天想学」→ 造课台）。
    @Environment(TabRouter.self) private var router
    var body: some View {
        @Bindable var router = router
        return TabView(selection: $router.selection) {
            DeskView()
                .tabItem { Label("书桌", systemImage: "house.fill") }.tag(0)
            CoursesView()
                .tabItem { Label("课程", systemImage: "safari.fill") }.tag(1)
            CreateView()
                .tabItem { Label("造课", systemImage: "sparkles") }.tag(2)
            NotesView()
                .tabItem { Label("笔记", systemImage: "square.and.pencil") }.tag(3)
            ProfileView()
                .tabItem { Label("我的", systemImage: "person.fill") }.tag(4)
        }
        .tint(Studio.red)
    }
}
