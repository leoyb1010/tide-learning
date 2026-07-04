import SwiftUI
import Observation

// MARK: - DTO（对齐后端 camelCase）

/// GET /api/market -> { items: [...] }（集市：sharedStatus=shared 的课）。
/// 后端若无 /api/market，则回退 GET /api/courses 过滤 sharedStatus == "shared"。
struct MarketResponse: Decodable {
    let items: [MarketCourse]
}

/// 集市课程项。requestStatus 表示当前用户的申请态（后端可选返回）。
struct MarketCourse: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String?
    let coverColor: String
    let authorId: String?
    let authorName: String
    let sharedStatus: String?
    let learnersCount: Int?
    /// 申请态："none" / "pending" / "approved" / "rejected"（后端缺省视为 none）。
    let requestStatus: String?

    var status: MarketRequestStatus {
        MarketRequestStatus(rawValue: (requestStatus ?? "none").lowercased()) ?? .none
    }
}

/// /api/courses 回退时用：需要能读到 sharedStatus。为不改动 Courses 模块的 Course DTO，
/// 这里定义一个宽松解码的回退项，只取集市需要的字段。
private struct FallbackCourse: Decodable {
    let id: String
    let title: String
    let subtitle: String?
    let coverColor: String?
    let authorId: String?
    let authorName: String?
    let sharedStatus: String?
    let learnersCount: Int?
    let requestStatus: String?
}
private struct FallbackCoursesResponse: Decodable {
    let courses: [FallbackCourse]
}

/// 申请学习状态机。
enum MarketRequestStatus: String {
    case none, pending, approved, rejected

    var label: String {
        switch self {
        case .none:     return "申请学习"
        case .pending:  return "申请中"
        case .approved: return "已通过"
        case .rejected: return "已拒绝"
        }
    }
    /// 是否可点击发起申请。
    var canApply: Bool { self == .none || self == .rejected }
    var buttonKind: StudioButton.Kind { canApply ? .red : .ghost }
    var icon: String {
        switch self {
        case .none:     return "paperplane.fill"
        case .pending:  return "hourglass"
        case .approved: return "checkmark.seal.fill"
        case .rejected: return "xmark.circle.fill"
        }
    }
    /// 已申请态徽章色调：通过=绿 / 申请中=蓝 / 拒绝=琥珀。
    var badgeTone: StatusBadge.Tone {
        switch self {
        case .approved: return .ok
        case .pending:  return .info
        case .rejected: return .warn
        case .none:     return .neutral
        }
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class MarketViewModel {
    var items: [MarketCourse]?
    var error: String?
    var loading = false

    /// 正在申请的课程 id 集合（按钮内 loading）。
    var applyingIds: Set<String> = []
    /// 单条申请错误提示（course.id -> 文案）。
    var applyErrors: [String: String] = [:]

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            // 优先集市专用接口。
            let resp = try await API.shared.get("/api/market", as: MarketResponse.self)
            items = resp.items
        } catch let e as APIError where isMissingEndpoint(e) {
            // 回退：/api/courses 过滤 sharedStatus == shared。
            await loadFallback()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 回退到 /api/courses，仅保留 sharedStatus == "shared" 的课。
    private func loadFallback() async {
        do {
            let resp = try await API.shared.get("/api/courses", as: FallbackCoursesResponse.self)
            items = resp.courses
                .filter { ($0.sharedStatus ?? "").lowercased() == "shared" }
                .map {
                    MarketCourse(
                        id: $0.id,
                        title: $0.title,
                        subtitle: $0.subtitle,
                        coverColor: $0.coverColor ?? "slate",
                        authorId: $0.authorId,
                        authorName: $0.authorName ?? "匿名作者",
                        sharedStatus: $0.sharedStatus,
                        learnersCount: $0.learnersCount,
                        requestStatus: $0.requestStatus
                    )
                }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 404 视为「接口不存在」，触发回退。
    private func isMissingEndpoint(_ e: APIError) -> Bool {
        if case .notFound = e { return true }
        return false
    }

    /// 发起申请学习：POST /api/market/request { courseId }。
    func requestLearn(_ course: MarketCourse) async {
        guard course.status.canApply else { return }
        applyingIds.insert(course.id)
        applyErrors[course.id] = nil
        defer { applyingIds.remove(course.id) }

        struct Body: Encodable { let courseId: String }
        struct RequestResult: Decodable { let requestStatus: String? }
        do {
            let result = try await API.shared.post(
                "/api/market/request",
                body: Body(courseId: course.id),
                as: RequestResult.self
            )
            // 后端返回态优先，缺省乐观置为 pending。
            let newStatus = result.requestStatus ?? MarketRequestStatus.pending.rawValue
            updateStatus(courseId: course.id, to: newStatus)
        } catch {
            applyErrors[course.id] = (error as? APIError)?.errorDescription ?? "申请失败"
        }
    }

    private func updateStatus(courseId: String, to newStatus: String) {
        guard let idx = items?.firstIndex(where: { $0.id == courseId }) else { return }
        let old = items![idx]
        items![idx] = MarketCourse(
            id: old.id,
            title: old.title,
            subtitle: old.subtitle,
            coverColor: old.coverColor,
            authorId: old.authorId,
            authorName: old.authorName,
            sharedStatus: old.sharedStatus,
            learnersCount: old.learnersCount,
            requestStatus: newStatus
        )
    }
}

// MARK: - View

struct MarketView: View {
    @State private var vm = MarketViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("课程集市")
            .task { if vm.items == nil { await vm.load() } }
            .refreshable { await vm.load() }
        }
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if let items = vm.items {
            if items.isEmpty {
                EmptyStateView(
                    title: "集市暂时空空如也",
                    subtitle: "还没有同学分享课程，晚点再来逛逛"
                )
                .padding(.top, 40)
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { idx, course in
                        MarketCard(
                            course: course,
                            applying: vm.applyingIds.contains(course.id),
                            applyError: vm.applyErrors[course.id]
                        ) {
                            Task { await vm.requestLearn(course) }
                        }
                        .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                    }
                }
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    private var loadingSkeleton: some View {
        LazyVStack(spacing: 14) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 12) {
                    SkeletonBar(height: 110).clipShape(RoundedRectangle(cornerRadius: 12))
                    SkeletonBar(height: 16, width: 180)
                    SkeletonBar(height: 12, width: 100)
                    SkeletonBar(height: 40).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .studioCard(padding: 12)
            }
        }
    }
}

// MARK: - 集市卡

struct MarketCard: View {
    let course: MarketCourse
    var applying: Bool = false
    var applyError: String? = nil
    let onApply: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 渐变封面 + 标题叠字 + 分享标记（集市来自同学分享）
            ZStack(alignment: .bottomLeading) {
                CourseCover.gradient(for: course.coverColor)
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                LinearGradient(
                    colors: [.clear, .black.opacity(0.45)],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 110)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                // 右上角「共享」角标，强化集市分享感（深色封面上白半透明）。
                VStack {
                    HStack {
                        Spacer()
                        HStack(spacing: 4) {
                            Image(systemName: "square.and.arrow.up.fill")
                                .font(.system(size: 9, weight: .bold))
                            Text("共享").font(.studio(10, .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.white.opacity(0.18))
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                    }
                    Spacer()
                }
                .padding(10)
                Text(course.title)
                    .font(.studio(16, .bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(12)
            }

            // 作者行
            HStack(spacing: 8) {
                Circle()
                    .fill(Studio.surface2)
                    .frame(width: 26, height: 26)
                    .overlay(
                        Text(ProfileDerive.avatarInitial(from: course.authorName))
                            .font(.studio(12, .bold))
                            .foregroundStyle(Studio.ink2)
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text(course.authorName)
                        .font(.studio(13, .semibold))
                        .foregroundStyle(Studio.ink)
                        .lineLimit(1)
                    if let subtitle = course.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.studio(11))
                            .foregroundStyle(Studio.ink3)
                            .lineLimit(1)
                    }
                }
                Spacer()
                if let n = course.learnersCount {
                    HStack(spacing: 4) {
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(Studio.ink4)
                        Text(CourseFormat.learners(n))
                            .font(.mono(11))
                            .foregroundStyle(Studio.ink3)
                    }
                }
            }

            // 申请态：可申请→红 CTA 按钮；已申请→语义徽章（不再可点）。
            if course.status.canApply {
                StudioButton(
                    title: course.status.label,
                    kind: course.status.buttonKind,
                    icon: course.status.icon,
                    loading: applying
                ) {
                    onApply()
                }
            } else {
                HStack {
                    StatusBadge(
                        text: course.status.label,
                        icon: course.status.icon,
                        tone: course.status.badgeTone
                    )
                    Spacer()
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal, 12)
                .transition(.opacity)
            }

            if let applyError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 11)).foregroundStyle(Studio.warn)
                    Text(applyError).font(.studio(12)).foregroundStyle(Studio.warn)
                }
            }
        }
        .studioCard(padding: 12)
        .pressable()
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: course.status)
        .onChange(of: course.status) { old, new in
            // 申请成功落定（none/rejected → pending/approved）给成功触觉。
            if old.canApply && !new.canApply { Haptics.success() }
        }
    }
}
