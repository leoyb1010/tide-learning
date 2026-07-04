import SwiftUI
import Observation

// MARK: - DTO（字段对齐后端 JSON camelCase）

/// 通知类型。未知值兜底为 .system，避免解码失败。
enum NotifType: String, Decodable {
    case system          // 系统通知
    case course          // 课程 / 上新
    case note            // 笔记相关
    case review          // 复习提醒
    case exam            // 测验 / 成绩
    case credit          // 积分 / 充值
    case subscription    // 订阅
    case social          // 互动 / 关注
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NotifType(rawValue: raw) ?? .unknown
    }

    /// SF Symbol（禁 emoji）。
    var icon: String {
        switch self {
        case .system:       return "bell.fill"
        case .course:       return "book.fill"
        case .note:         return "square.and.pencil"
        case .review:       return "rectangle.stack.fill"
        case .exam:         return "checkmark.seal.fill"
        case .credit:       return "creditcard.fill"
        case .subscription: return "star.fill"
        case .social:       return "person.2.fill"
        case .unknown:      return "bell.fill"
        }
    }

    /// 图标底色（红=专注信号，仅关键类型用红）。
    var tint: Color {
        switch self {
        case .review, .exam, .subscription: return Studio.red
        default:                            return Studio.ink2
        }
    }
}

/// 单条通知。
struct StudioNotification: Decodable, Identifiable, Hashable {
    let id: String
    let type: NotifType
    let title: String
    let body: String?
    let refType: String?
    let refId: String?
    /// 后端返回计算后的已读布尔（readAt 是否为空由服务端判定），非日期。
    let read: Bool
    let createdAt: Date

    var isUnread: Bool { !read }
}

/// GET /api/notifications 返回体（后端 data 层：{ items, unread }）。
struct NotificationsResponse: Decodable {
    let items: [StudioNotification]
    let unread: Int?
}

// MARK: - ViewModel

@Observable @MainActor
final class NotificationsViewModel {
    var notifications: [StudioNotification] = []
    /// 后端返回的未读数（可选）；缺省时用本地计算兜底。
    var unreadFromServer: Int?
    var loaded = false
    var error: String?
    var loading = false
    /// "全部已读" 进行中。
    var markingAll = false

    /// 未读数：优先本地实时计算（标已读后即时更新），无数据时退回服务端值。
    var unreadCount: Int {
        if loaded { return notifications.filter { $0.isUnread }.count }
        return unreadFromServer ?? 0
    }

    /// createdAt 倒序。
    var sorted: [StudioNotification] {
        notifications.sorted { $0.createdAt > $1.createdAt }
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let resp = try await API.shared.get("/api/notifications", as: NotificationsResponse.self)
            notifications = resp.items
            unreadFromServer = resp.unread
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 标记单条已读（点通知时调用）。乐观更新 + 失败回滚。
    func markRead(_ id: String) async {
        guard let idx = notifications.firstIndex(where: { $0.id == id }),
              notifications[idx].isUnread else { return }
        let before = notifications[idx]
        notifications[idx] = before.markedRead()

        struct Body: Encodable { let id: String }
        do {
            _ = try await API.shared.patch("/api/notifications", body: Body(id: id), as: MarkReadResult.self)
        } catch {
            // 回滚：标已读失败不打扰用户，仅还原状态。
            if let cur = notifications.firstIndex(where: { $0.id == id }) {
                notifications[cur] = before
            }
        }
    }

    /// 全部已读。
    func markAllRead() async {
        guard unreadCount > 0, !markingAll else { return }
        markingAll = true
        defer { markingAll = false }

        let snapshot = notifications
        notifications = notifications.map { $0.isUnread ? $0.markedRead() : $0 }
        unreadFromServer = 0

        struct Body: Encodable { let all: Bool }
        do {
            _ = try await API.shared.patch("/api/notifications", body: Body(all: true), as: MarkReadResult.self)
        } catch {
            // 失败回滚。
            notifications = snapshot
        }
    }
}

/// PATCH /api/notifications 返回体（后端 data 层：{ updated }；宽松可选，仅用于确认成功）。
private struct MarkReadResult: Decodable {
    let updated: Int?
}

private extension StudioNotification {
    /// 返回一个把 read 置为 true 的副本（let 属性不可变，重建结构体）。
    func markedRead() -> StudioNotification {
        StudioNotification(id: id, type: type, title: title, body: body,
                           refType: refType, refId: refId, read: true, createdAt: createdAt)
    }
}

// MARK: - View

struct NotificationsView: View {
    @State private var vm = NotificationsViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            Group {
                if vm.loaded {
                    content
                } else if let err = vm.error {
                    ScrollView { ErrorRetryView(message: err) { Task { await vm.load() } } }
                } else {
                    ScrollView { loadingSkeleton }
                }
            }
            .background(Studio.bg)
            .navigationTitle("通知")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if vm.loaded && vm.unreadCount > 0 {
                        if vm.markingAll {
                            ProgressView().controlSize(.small)
                        } else {
                            Button {
                                Haptics.success()
                                Task { await vm.markAllRead() }
                            } label: {
                                Text("全部已读").font(.studio(14, .semibold))
                            }
                            .tint(Studio.info)
                        }
                    }
                }
            }
            .task { if !vm.loaded { await vm.load() } }
            .refreshable { await vm.load() }
        }
    }

    // MARK: 列表

    private var content: some View {
        Group {
            if vm.sorted.isEmpty {
                ScrollView {
                    EmptyStateView(title: "暂无通知",
                                   subtitle: "课程上新、复习提醒、成绩更新都会出现在这里")
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if vm.unreadCount > 0 {
                            HStack {
                                StatusBadge(text: "\(vm.unreadCount) 条未读", icon: "circle.fill", tone: .info)
                                    .transition(.opacity)
                                Spacer()
                            }
                            .padding(.bottom, 2)
                        }
                        ForEach(Array(vm.sorted.enumerated()), id: \.element.id) { idx, n in
                            NotificationRow(notification: n) {
                                Task { await vm.markRead(n.id) }
                            }
                            .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                        }
                    }
                    .padding(16)
                    .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.unreadCount)
                }
            }
        }
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(spacing: 10) {
            ForEach(0..<5, id: \.self) { _ in
                HStack(alignment: .top, spacing: 12) {
                    SkeletonBar(height: 32, width: 32).clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonBar(height: 14, width: 160)
                        SkeletonBar(height: 12)
                        SkeletonBar(height: 12, width: 90)
                    }
                }
                .studioCard(padding: 14)
            }
        }
        .padding(16)
    }
}

// MARK: - 单条通知行

private struct NotificationRow: View {
    let notification: StudioNotification
    /// 点击回调：暂时只标已读（refType 跳转后续接入）。
    let onTap: () -> Void
    @Environment(\.colorScheme) private var scheme

    /// 未读用「通知蓝」info 语义强调（红仅留给关键类型图标），弃满屏红。
    private var unread: Bool { notification.isUnread }

    var body: some View {
        Button {
            if unread { Haptics.selection() }
            onTap()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                // 类型图标
                Image(systemName: notification.type.icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(notification.type.tint)
                    .frame(width: 34, height: 34)
                    .background(Studio.surfaceInset)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        Text(notification.title)
                            .font(.studio(15, unread ? .semibold : .medium))
                            .foregroundStyle(Studio.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        if unread {
                            Circle().fill(Studio.info).frame(width: 8, height: 8).padding(.top, 5)
                        }
                    }

                    if let body = notification.body, !body.isEmpty {
                        Text(body)
                            .font(.studio(13))
                            .foregroundStyle(Studio.ink2)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                    }

                    Text(RelativeTime.string(from: notification.createdAt))
                        .font(.mono(11))
                        .foregroundStyle(Studio.ink3)
                        .padding(.top, 1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(unread ? Studio.infoSoft : Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(alignment: .leading) {
                // 未读左侧信息色导轨，替代满屏红底。
                if unread {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Studio.info)
                        .frame(width: 3)
                        .padding(.vertical, 12)
                        .padding(.leading, 1)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                    .strokeBorder(unread ? Studio.info.opacity(0.28) : Studio.border, lineWidth: 1)
            )
            .shadow(color: shadow.color, radius: shadow.radius, x: 0, y: shadow.y)
        }
        .buttonStyle(.plain)
        .pressable(haptic: false)
        .accessibilityElement(children: .combine)
        .accessibilityValue(unread ? "未读" : "")
    }

    private var shadow: (color: Color, radius: CGFloat, y: CGFloat) {
        StudioElevation.l1(scheme)
    }
}
