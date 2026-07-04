import SwiftUI
import Observation

// MARK: - DTO（对齐 web v4.0 交易市场：摊位卡 + 拿走）

/// 集市摊位项。字段对齐 web src/lib/market-view.ts 的 MarketStall。
///
/// 数据来源说明：web 的 /market 是 server component 直接查库拼装（无 GET /api/market JSON 接口）。
/// iOS 优先请求 GET /api/market（若后端补该接口即命中）；缺省回退 GET /api/courses 过滤
/// sharedStatus=="shared"，把 courses 字段近似映射成摊位（拿走数缺省用 learnersCount 近似）。
struct MarketStall: Decodable, Identifiable, Equatable {
    let id: String
    let slug: String?
    let title: String
    let subtitle: String?
    let category: String?
    let coverColor: String?
    let origin: String?              // ai_generated / user_imported / official
    /// 拿走数（有该课学习记录的去重用户数，排除作者本人）。
    let collectCount: Int
    /// 累计学习人数（Course.learnersCount 真值）。
    let learnersCount: Int
    /// 当前登录用户是否已把此课拿到书架（决定 CTA 初始态）。
    let collectedByMe: Bool
    /// 是否本人摊位（自己造的课不出「拿走」，显示「你的摊位」）。
    let mine: Bool
    /// 上新时间戳（毫秒），用于「最新」排序。
    let createdAtMs: Double?
    let seller: Seller

    struct Seller: Decodable, Equatable {
        let id: String?
        let nickname: String
        let avatarUrl: String?
    }
}

/// GET /api/market → { items: [MarketStall] }（若后端提供）。
private struct MarketResponse: Decodable {
    let items: [MarketStall]
}

/// /api/courses 回退项：宽松解码，只取拼摊位需要的字段。
private struct FallbackCourse: Decodable {
    let id: String
    let slug: String?
    let title: String
    let subtitle: String?
    let category: String?
    let coverColor: String?
    let origin: String?
    let authorId: String?
    let authorName: String?
    let sharedStatus: String?
    let learnersCount: Int?
}
private struct FallbackCoursesResponse: Decodable {
    let courses: [FallbackCourse]
}

// MARK: - 排序（对齐 web MarketSort：最热/最新）

/// 排序键。默认最热（交易市场看热货）。对齐 web normalizeSort。
enum MarketSort: String, CaseIterable, Identifiable {
    case hot, new
    var id: String { rawValue }
    var label: String { self == .hot ? "最热" : "最新" }
    var icon: String { self == .hot ? "flame.fill" : "clock.fill" }
}

// MARK: - ViewModel

@Observable @MainActor
final class MarketViewModel {
    var stalls: [MarketStall]?
    var error: String?
    var loading = false

    /// 当前排序键。
    var sort: MarketSort = .hot

    /// 正在拿走的课程 id 集合（按钮内 loading）。
    var collectingIds: Set<String> = []
    /// 单条拿走错误提示（course.id -> 文案）。
    var collectErrors: [String: String] = [:]
    /// 拿走成功后的「已放入书架」轻提示（course.id -> 文案），驱动卡内成功态与顶部 toast。
    var lastCollected: (id: String, message: String)?

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let resp = try await API.shared.get("/api/market", as: MarketResponse.self)
            stalls = resp.items
        } catch let e as APIError where isMissingEndpoint(e) {
            await loadFallback()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 回退到 /api/courses，仅保留 sharedStatus == "shared" 的课，近似映射成摊位。
    private func loadFallback() async {
        do {
            let resp = try await API.shared.get("/api/courses", as: FallbackCoursesResponse.self)
            let myUserId = AuthManager.shared.user?.id  // 同为 @MainActor，直接读取
            stalls = resp.courses
                .filter { ($0.sharedStatus ?? "").lowercased() == "shared" }
                .map { c in
                    let learners = c.learnersCount ?? 0
                    return MarketStall(
                        id: c.id,
                        slug: c.slug,
                        title: c.title,
                        subtitle: c.subtitle,
                        category: c.category,
                        coverColor: c.coverColor,
                        origin: c.origin,
                        // 回退无独立「拿走数」，用学习人数近似（保持排序/展示可用）。
                        collectCount: learners,
                        learnersCount: learners,
                        collectedByMe: false,
                        mine: (myUserId != nil && c.authorId == myUserId),
                        createdAtMs: nil,
                        seller: MarketStall.Seller(
                            id: c.authorId,
                            nickname: c.authorName ?? "匿名同学",
                            avatarUrl: nil
                        )
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

    /// 客户端排序（对齐 web sortStalls：最新按 createdAtMs 降序，最热按 collectCount 降序；同分保原序）。
    var sortedStalls: [MarketStall] {
        guard let stalls else { return [] }
        let indexed = Array(stalls.enumerated())
        let sorted = indexed.sorted { a, b in
            switch sort {
            case .new:
                let ax = a.element.createdAtMs ?? 0, bx = b.element.createdAtMs ?? 0
                if ax != bx { return ax > bx }
            case .hot:
                if a.element.collectCount != b.element.collectCount {
                    return a.element.collectCount > b.element.collectCount
                }
            }
            return a.offset < b.offset // 同分保稳定原序
        }
        return sorted.map { $0.element }
    }

    /// 今日集市氛围：累计被拿走次数。
    var totalCollects: Int {
        stalls?.reduce(0) { $0 + $1.collectCount } ?? 0
    }

    /// 「拿走」：POST /api/market/collect { courseId }，成功后乐观更新（本人拿走态 + 拿走数 +1）。
    /// 对齐 web collect 端点：幂等（already=true 时不再重复计数），本人课不可拿走。
    func collect(_ stall: MarketStall) async {
        guard !stall.mine, !stall.collectedByMe else { return }
        collectingIds.insert(stall.id)
        collectErrors[stall.id] = nil
        defer { collectingIds.remove(stall.id) }

        struct Body: Encodable { let courseId: String }
        struct CollectResult: Decodable {
            let status: String?
            let already: Bool?
            let message: String?
        }
        do {
            let result = try await API.shared.post(
                "/api/market/collect",
                body: Body(courseId: stall.id),
                as: CollectResult.self
            )
            let already = result.already ?? false
            markCollected(stall.id, incrementCount: !already)
            lastCollected = (stall.id, result.message ?? "已放入书架")
        } catch {
            collectErrors[stall.id] = (error as? APIError)?.errorDescription ?? "拿走失败"
        }
    }

    private func markCollected(_ courseId: String, incrementCount: Bool) {
        guard let idx = stalls?.firstIndex(where: { $0.id == courseId }) else { return }
        let old = stalls![idx]
        stalls![idx] = MarketStall(
            id: old.id,
            slug: old.slug,
            title: old.title,
            subtitle: old.subtitle,
            category: old.category,
            coverColor: old.coverColor,
            origin: old.origin,
            collectCount: old.collectCount + (incrementCount ? 1 : 0),
            learnersCount: old.learnersCount,
            collectedByMe: true,
            mine: old.mine,
            createdAtMs: old.createdAtMs,
            seller: old.seller
        )
    }
}

// MARK: - View

/// 课程集市「交易市场」（对齐 web v4.0）。
/// 结构：氛围条（累计被拿走）+ 排序切换（最热/最新）+ 摊位卡网格 + 拿走。
struct MarketView: View {
    @State private var vm = MarketViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 「已放入书架」toast 显示态。
    @State private var showToast = false
    /// 拿走后可跳书架：由外部注入（书桌 sheet 内打开时用），缺省仅 toast。
    var onGoShelf: (() -> Void)? = nil

    var body: some View {
        // 不自带 NavigationStack：本视图从课程库 push 进来，复用父级导航栈（避免嵌套栈布局问题）。
        // navigationTitle 由父级栈渲染。
        ScrollView {
            content
                .padding(16)
        }
        .background(Studio.bg)
        .navigationTitle("课程集市")
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.stalls == nil { await vm.load() } }
        .refreshable { await vm.load() }
        .overlay(alignment: .top) { toast }
        .onChange(of: vm.lastCollected?.id) { _, new in
            guard new != nil else { return }
            Haptics.success()
            withAnimation(reduceMotion ? nil : StudioMotion.smooth) { showToast = true }
            Task {
                try? await Task.sleep(nanoseconds: 2_600_000_000)
                withAnimation(reduceMotion ? nil : StudioMotion.smooth) { showToast = false }
            }
        }
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if let stalls = vm.stalls {
            if stalls.isEmpty {
                EmptyStateView(
                    title: "集市还没开张",
                    subtitle: "还没有同学把课摆上摊，去造一门课分享到集市",
                    icon: "storefront"
                )
                .padding(.top, 40)
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    ambienceBar
                    sortBar(count: stalls.count)
                    LazyVStack(spacing: 14) {
                        ForEach(Array(vm.sortedStalls.enumerated()), id: \.element.id) { idx, stall in
                            MarketStallCard(
                                stall: stall,
                                collecting: vm.collectingIds.contains(stall.id),
                                collectError: vm.collectErrors[stall.id]
                            ) {
                                Task { await vm.collect(stall) }
                            }
                            .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                        }
                    }
                    .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.sort)
                }
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    // MARK: 氛围条（累计被拿走）

    private var ambienceBar: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Studio.infoSoft).frame(width: 32, height: 32)
                Image(systemName: "bag.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.info)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("累计被拿走")
                    .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(1)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(CourseFormat.learners(vm.totalCollects))
                        .font(.mono(17, .bold)).foregroundStyle(Studio.ink)
                        .contentTransition(.numericText())
                    Text("次").font(.studio(11)).foregroundStyle(Studio.ink3)
                }
            }
            Spacer()
            Text("看中就免费拿走")
                .font(.studio(11)).foregroundStyle(Studio.ink3)
        }
        .padding(12)
        .studioCard(padding: 0)
        .frame(maxWidth: .infinity)
    }

    // MARK: 排序切换（最热/最新）

    private func sortBar(count: Int) -> some View {
        HStack {
            Text("共 \(count) 个课摊")
                .font(.studio(12)).foregroundStyle(Studio.ink3)
            Spacer()
            HStack(spacing: 4) {
                ForEach(MarketSort.allCases) { s in
                    let active = vm.sort == s
                    Button {
                        guard vm.sort != s else { return }
                        Haptics.selection()
                        withAnimation(reduceMotion ? nil : StudioMotion.smooth) { vm.sort = s }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: s.icon).font(.system(size: 10, weight: .bold))
                            Text(s.label).font(.studio(12, .semibold))
                        }
                        .foregroundStyle(active ? .white : Studio.ink2)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(active ? Studio.ink : Studio.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(active ? Color.clear : Studio.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .pressable(scale: 0.95, haptic: false)
                }
            }
            .padding(3)
            .background(Studio.surface2)
            .clipShape(Capsule())
        }
    }

    // MARK: 「已放入书架」toast

    @ViewBuilder
    private var toast: some View {
        if showToast, let msg = vm.lastCollected?.message {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Studio.ok)
                Text(msg).font(.studio(13, .semibold)).foregroundStyle(Studio.ink)
                    .lineLimit(1)
                if onGoShelf != nil {
                    Button {
                        Haptics.light()
                        onGoShelf?()
                    } label: {
                        Text("去书架")
                            .font(.studio(12, .bold)).foregroundStyle(Studio.red)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Studio.surface)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Studio.border2, lineWidth: 1))
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
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

// MARK: - 摊位卡

/// 集市摊位卡：渐变封面 + 标题 + 摊主行（作者/头像）+ 拿走数/在学数 + 拿走 CTA。
struct MarketStallCard: View {
    let stall: MarketStall
    var collecting: Bool = false
    var collectError: String? = nil
    let onCollect: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 来源是否 AI 造课（决定封面来源徽标：AI 造课 / 整理导入）。对齐 web origin==="ai_generated"。
    private var originIsAI: Bool { (stall.origin ?? "") == "ai_generated" }

    /// 摊主等级徽章（对齐 web sellerBadge：按被拿走数分档）。
    private var sellerBadge: (label: String, tone: StatusBadge.Tone) {
        let n = stall.collectCount
        if n >= 50 { return ("金牌摊主", .red) }
        if n >= 20 { return ("人气摊主", .warn) }
        if n >= 5  { return ("活跃摊主", .info) }
        return ("新摊主", .neutral)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 渐变封面 + 标题叠字 + 来源徽标 + 免费拿走价签（对齐 web 摊位卡封面区）
            ZStack(alignment: .bottomLeading) {
                CourseCover.gradient(for: stall.coverColor ?? "slate")
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                LinearGradient(colors: [.clear, .black.opacity(0.45)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                // 顶部两角：左=来源徽标（AI造课/整理导入），右=免费拿走价签 / 本人摊位
                VStack {
                    HStack {
                        // 来源徽标（左上）
                        HStack(spacing: 4) {
                            Image(systemName: originIsAI ? "sparkles" : "list.bullet.rectangle.fill")
                                .font(.system(size: 9, weight: .bold))
                            Text(originIsAI ? "AI 造课" : "整理导入").font(.studio(10, .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.black.opacity(0.34))
                        .clipShape(Capsule())
                        Spacer()
                        // 价签（右上）：本人摊位 → 你的摊位；否则 → 免费拿走
                        if stall.mine {
                            HStack(spacing: 4) {
                                Image(systemName: "storefront.fill").font(.system(size: 9, weight: .bold))
                                Text("你的摊位").font(.studio(10, .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.white.opacity(0.18))
                            .clipShape(Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                        } else {
                            HStack(spacing: 4) {
                                Image(systemName: "gift.fill").font(.system(size: 9, weight: .bold))
                                Text("免费拿走").font(.studio(10, .bold))
                            }
                            .foregroundStyle(Studio.ok)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.white.opacity(0.92))
                            .clipShape(Capsule())
                        }
                    }
                    Spacer()
                    // 拿走热度气泡（左下，交易气息）
                    if stall.collectCount > 0 {
                        HStack {
                            HStack(spacing: 4) {
                                Image(systemName: "bag.fill").font(.system(size: 9, weight: .bold))
                                Text("\(CourseFormat.learners(stall.collectCount)) 人拿走")
                                    .font(.mono(10, .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.black.opacity(0.42))
                            .clipShape(Capsule())
                            Spacer()
                        }
                    }
                }
                .padding(10)
                Text(stall.title)
                    .font(.studio(16, .bold)).foregroundStyle(.white)
                    .lineLimit(2).multilineTextAlignment(.leading)
                    .padding(12)
                    // 标题避让底部热度气泡：热度存在时下移标题起点。
                    .padding(.bottom, stall.collectCount > 0 ? 20 : 0)
            }

            // 摊主行：头像 + 昵称 + 摊主等级徽章
            HStack(spacing: 8) {
                Circle()
                    .fill(Studio.surface2)
                    .frame(width: 26, height: 26)
                    .overlay(
                        Text(ProfileDerive.avatarInitial(from: stall.seller.nickname))
                            .font(.studio(12, .bold)).foregroundStyle(Studio.ink2)
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text(stall.seller.nickname)
                        .font(.studio(13, .semibold)).foregroundStyle(Studio.ink).lineLimit(1)
                    if let subtitle = stall.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.studio(11)).foregroundStyle(Studio.ink3).lineLimit(1)
                    }
                }
                Spacer()
                StatusBadge(text: sellerBadge.label, tone: sellerBadge.tone)
            }

            // 交易信号行：拿走数 + 在学数
            HStack(spacing: 14) {
                metric(icon: "bag.fill", value: CourseFormat.learners(stall.collectCount), label: "拿走", tone: Studio.info)
                metric(icon: "person.2.fill", value: CourseFormat.learners(stall.learnersCount), label: "在学", tone: Studio.ink3)
                Spacer()
            }

            // CTA：本人摊位 → 提示不可拿；已拿走 → 已在书架徽章；否则 → 拿走红按钮
            if stall.mine {
                collectDisabled(text: "你的摊位", icon: "person.crop.circle.fill", tone: .neutral)
            } else if stall.collectedByMe {
                collectDisabled(text: "已在你的书架", icon: "checkmark.seal.fill", tone: .ok)
            } else {
                StudioButton(
                    title: "免费拿走",
                    kind: .red,
                    icon: "bag.badge.plus",
                    loading: collecting
                ) {
                    onCollect()
                }
            }

            if let collectError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 11)).foregroundStyle(Studio.warn)
                    Text(collectError).font(.studio(12)).foregroundStyle(Studio.warn)
                }
            }
        }
        .studioCard(padding: 12)
        .pressable()
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: stall.collectedByMe)
    }

    private func metric(icon: String, value: String, label: String, tone: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(tone)
            Text(value).font(.mono(12, .bold)).foregroundStyle(Studio.ink)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
    }

    private func collectDisabled(text: String, icon: String, tone: StatusBadge.Tone) -> some View {
        HStack {
            StatusBadge(text: text, icon: icon, tone: tone)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10).padding(.horizontal, 12)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .transition(.opacity)
    }
}
