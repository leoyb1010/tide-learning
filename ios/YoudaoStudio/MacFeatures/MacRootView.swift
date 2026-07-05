// Mac 根壳（M1 真身，替换 M0 在 YoudaoStudioAppMac.swift 里的占位）。
//
// 据 AuthManager.didBootstrap / isLoggedIn 三态切换：
//   未 bootstrap → SplashMac；未登录 → MacLoginView；已登录 → 主界面（NavigationSplitView）。
// 主界面：侧边栏（书桌/课程/造课/笔记/我的）+ detail。书桌先做真（MacDeskView），
// 其余用 EmptyStateView 占位「即将上线」。侧边栏选中态通过桥接 TabRouter.selection
// （0-4 语义一致）实现跨屏跳转复用：MacDesk「今天想学」→ router.startCreate() 切造课。
#if os(macOS)
import SwiftUI

struct MacRootView: View {
    @Environment(AuthManager.self) private var auth
    /// 复用全局 TabRouter：侧边栏选中态与之双向桥接（rawValue 对齐 selection 0-4）。
    @Environment(TabRouter.self) private var router

    var body: some View {
        Group {
            if !auth.didBootstrap {
                SplashMac()
            } else if auth.isLoggedIn {
                MacMainView()
            } else {
                MacLoginView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: auth.isLoggedIn)
        .animation(.easeInOut(duration: 0.25), value: auth.didBootstrap)
    }
}

/// 启动闪屏（桌面版）。
struct SplashMac: View {
    var body: some View {
        ZStack {
            Studio.bg.ignoresSafeArea()
            VStack(spacing: 10) {
                Text("有道自习室")
                    .font(.studio(22, .bold)).foregroundStyle(Studio.ink)
                Text("STUDIO · macOS")
                    .font(.mono(11, .bold)).foregroundStyle(Studio.ink4).tracking(3)
                ProgressView().tint(Studio.red).padding(.top, 8)
            }
        }
    }
}

/// 主界面：NavigationSplitView（侧边栏 + detail）。
struct MacMainView: View {
    @Environment(TabRouter.self) private var router
    // M5 窗口恢复：记住上次选中的 section（rawValue）。SceneStorage 随窗口场景持久化，
    // 冷启动 / 窗口重建时自动带回。默认 0（书桌）。
    @SceneStorage("lastMacSection") private var lastSection: Int = 0
    /// 是否已从 SceneStorage 恢复过（避免恢复动作被后续写回覆盖，仅在 onAppear 恢复一次）。
    @State private var restored = false

    var body: some View {
        // 侧边栏选中态桥接 TabRouter.selection：
        // 造课台经 router.startCreate() 把 selection 置 2，侧边栏据此高亮「造课」，
        // 反之侧边栏点选写回 selection，语义与 iOS 底部 Tab 一致。
        @Bindable var router = router
        let selectionBinding = Binding<MacSection>(
            get: { MacSection(rawValue: router.selection) ?? .desk },
            // set 同时写回 router 与 SceneStorage：选中态变化即持久化，下次冷启动恢复。
            set: { router.selection = $0.rawValue; lastSection = $0.rawValue }
        )

        NavigationSplitView {
            MacSidebar(selection: selectionBinding)
        } detail: {
            detail(for: selectionBinding.wrappedValue)
                .frame(minWidth: 640, minHeight: 520)
                .background(Studio.bg)
        }
        // 冷启动恢复：把上次记住的 section 写回 router.selection。仅执行一次，
        // 之后深链 / 侧栏点选可自由覆盖。用 onAppear（此时 @State router 已就绪，
        // 避免在 @State 初始化时机读 SceneStorage 的限制）。
        .onAppear {
            guard !restored else { return }
            restored = true
            if let section = MacSection(rawValue: lastSection) {
                router.selection = section.rawValue
            }
        }
    }

    @ViewBuilder
    private func detail(for section: MacSection) -> some View {
        switch section {
        case .desk:
            MacDeskView()
                .navigationTitle("书桌")
        case .courses:
            MacCoursesSection()
                .navigationTitle("课程")
        case .create:
            comingSoon("造课", icon: "sparkles", subtitle: "AI 造课台桌面版即将上线")
                .navigationTitle("造课")
        case .notes:
            MacNotesView()
                .navigationTitle("笔记")
        case .profile:
            MacProfileView()
                .navigationTitle("我的")
        case .market:
            MacMarketView()
                .navigationTitle("集市")
        case .review:
            MacReviewView()
                .navigationTitle("复习")
        case .exam:
            MacExamView()
                .navigationTitle("考试")
        }
    }

    /// 占位区：其余分区统一「即将上线」空态。
    private func comingSoon(_ title: String, icon: String, subtitle: String) -> some View {
        ZStack {
            Studio.bg.ignoresSafeArea()
            EmptyStateView(
                title: "\(title) · 即将上线",
                subtitle: subtitle,
                icon: icon
            )
            .frame(maxWidth: 420)
        }
    }
}

/// 课程分区：课程库（MacCoursesView）+ 选中后 push 课程详情（MacCourseDetailView）。
///
/// MacCoursesView 只把选中课程写回外部 `selection`（不自带导航），故此处用 NavigationStack
/// 承载路由：选中课程即 push 到详情列；详情列里可访问的节 openWindow(id:"player") 开播放器窗。
/// selection 由本视图 @State 持有，跨列表重建保留选中态。
private struct MacCoursesSection: View {
    @State private var selection: MacCourse?

    var body: some View {
        NavigationStack {
            MacCoursesView(selection: $selection)
                .navigationDestination(item: $selection) { course in
                    MacCourseDetailView(course: course)
                }
        }
    }
}
#endif
