import SwiftUI
import Observation

/// 轻量未读数拉取器：只取 unread，用于铃铛角标。
@Observable @MainActor
final class NotifBadgeViewModel {
    var unread = 0

    func refresh() async {
        do {
            let resp = try await API.shared.get("/api/notifications", as: NotificationsResponse.self)
            // 优先服务端 unread，无则本地计算。
            unread = resp.unread ?? resp.items.filter { $0.isUnread }.count
        } catch {
            // 角标拉取失败不打扰用户，保持上次值。
        }
    }
}

/// 铃铛按钮 + 未读角标，供 DeskView 或导航栏用。
/// 点击弹出通知中心；关闭后刷新角标。
struct NotifBellButton: View {
    @State private var vm = NotifBadgeViewModel()
    @State private var showCenter = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button { showCenter = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Studio.ink2)
                    .frame(width: 34, height: 34)

                if vm.unread > 0 {
                    Text(vm.unread > 99 ? "99+" : "\(vm.unread)")
                        .font(.mono(10, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, vm.unread > 9 ? 4 : 0)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Studio.red)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(Studio.bg, lineWidth: 1.5))
                        .offset(x: 6, y: -4)
                        .contentTransition(.numericText())
                        .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
                }
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : StudioMotion.pop, value: vm.unread)
        .accessibilityLabel(vm.unread > 0 ? "通知，\(vm.unread) 条未读" : "通知")
        .sheet(isPresented: $showCenter, onDismiss: { Task { await vm.refresh() } }) {
            NotificationsView()
        }
        .task { await vm.refresh() }
    }
}
