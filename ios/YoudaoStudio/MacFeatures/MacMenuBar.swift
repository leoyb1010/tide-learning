// Mac 菜单栏常驻项（MenuBarExtra 内容）：今日学习速览 + 快速入口。
//
// 拉 /api/desk（复用 MacDeskView.swift 里已定义的 MacDeskData，同 target 无需重复声明），
// 展示：连续天数 streak / 今日是否点亮 litToday / 待复习数 dueReviewCount。
// 快捷入口：记一条（openWindow("compose")，⌘N）+ 打开主窗（openWindow(id:"main")）。
//
// 本视图作为 MenuBarExtra 的 content，挂在 YoudaoStudioAppMac 的 Scene 里。
#if os(macOS)
import SwiftUI
import Observation
import AppKit

@Observable @MainActor
final class MacMenuBarViewModel {
    var data: MacDeskData?
    var loading = false
    var error: String?

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            data = try await API.shared.get("/api/desk", as: MacDeskData.self)
            // M5：拉到最新待复习数后刷新 Dock 徽标（>0 显数字，否则清空）。
            Self.updateDockBadge(dueReviewCount: data?.dueReviewCount ?? 0)
        }
        catch { self.error = (error as? APIError)?.errorDescription ?? "加载失败" }
    }

    /// 刷新 Dock 图标右上角徽标。dueReviewCount>0 显数字，否则清空（"" 隐藏）。
    /// static + @MainActor：App 启动兜底拉一次时也可直接调，无需持有 VM 实例。
    static func updateDockBadge(dueReviewCount: Int) {
        NSApp.dockTile.badgeLabel = dueReviewCount > 0 ? "\(dueReviewCount)" : ""
    }
}

/// 菜单栏内容（.menuBarExtraStyle(.menu) 下渲染为下拉菜单项）。
struct MacMenuBarContent: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.openWindow) private var openWindow
    @State private var vm = MacMenuBarViewModel()

    var body: some View {
        Group {
            if auth.isLoggedIn {
                loggedInMenu
            } else {
                Text("未登录 · 打开主窗登录")
                Button("打开主窗") { openMain() }
            }
        }
        .task {
            if auth.isLoggedIn && vm.data == nil { await vm.load() }
        }
    }

    @ViewBuilder
    private var loggedInMenu: some View {
        // 今日学习速览
        if let d = vm.data {
            Text("今日学习")
            Text("🔥 已连续 \(d.streak) 天\(d.litToday ? "（今天已点亮）" : "（今天还没点亮）")")
            Text("📝 待复习 \(d.dueReviewCount) 张")
        } else if vm.loading {
            Text("加载今日学习…")
        } else if vm.error != nil {
            Button("加载失败 · 点此重试") { Task { await vm.load() } }
        }

        Divider()

        Button("记一条 ⌘N") {
            openWindow(id: "compose")
        }
        Button("打开主窗") {
            openMain()
        }

        Divider()

        Button("刷新今日学习") {
            Task { await vm.load() }
        }
    }

    /// 打开/前置主窗。主窗为默认 WindowGroup（未设 id），用 id:"main" 需 App 侧给主窗设同 id。
    private func openMain() {
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }
}
#endif
