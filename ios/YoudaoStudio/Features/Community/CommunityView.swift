import SwiftUI
import Observation

// MARK: - DTO（课程共创）

/// GET /api/demands 返回体（data 为对象包裹 demands 数组 + 当前用户本周剩余票额）。
struct DemandsResponse: Decodable {
    let demands: [Demand]
    /// 本周剩余票额（后端契约：WEEKLY_VOTE_BUDGET - 本周已用；游客/未登录为 0）。
    /// 后端旧版本未下发时按 nil 处理，UI 不据此禁用（保守放行，投票时的错误兜底仍在）。
    let remainingVotes: Int?
}

/// GET /api/demands 列表项：投票需求。
struct Demand: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String?
    let category: String
    let categoryLabel: String?      // 后端已提供中文分类标签
    var totalVotes: Int
    let status: String
    var votedByMe: Bool?            // 后端已按当前用户逐条下发（未登录/游客为 false）；解码为 Optional 兼容旧版本

    /// 分类展示文案：优先用后端标签，回退原始值。
    var categoryText: String { categoryLabel ?? category }

    /// 状态中文文案（对齐后端 status 取值）。
    var statusLabel: String {
        switch status {
        case "collecting": return "征集中"
        case "evaluating": return "评估中"
        case "scheduled": return "已排期"
        case "producing": return "制作中"
        case "launched": return "已上线"
        case "closed": return "已关闭"
        default: return status
        }
    }

    /// 状态语义色调：上线=绿 / 制作·排期进行中=蓝 / 征集·评估=琥珀 / 关闭=中性。
    var statusTone: StatusBadge.Tone {
        switch status {
        case "launched": return .ok
        case "producing", "scheduled": return .info
        case "collecting", "evaluating": return .warn
        default: return .neutral
        }
    }
}

// MARK: - Tab

enum CommunityTab: String, CaseIterable, Identifiable {
    case demands = "课程共创"
    case posts = "自习室广场"
    var id: String { rawValue }
}

/// 广场排序。
enum PostsSort: String, CaseIterable, Identifiable {
    case latest = "最新"
    case hot = "热门"
    var id: String { rawValue }
}

// MARK: - ViewModel

@Observable @MainActor
final class CommunityViewModel {
    // 共创
    var demands: [Demand] = []
    var demandsLoaded = false
    var demandsError: String?
    var votingId: String?
    /// 本周剩余票额（GET /api/demands 下发）。nil=后端未下发/未知（不据此禁用）；0=已用完本周票。
    var remainingVotes: Int?

    // 广场
    var posts: [CommunityPost] = []
    var postsLoaded = false
    var postsError: String?
    var postsSort: PostsSort = .latest

    // 订阅态（决定「发帖」入口）
    var canPost = false
    private var entitlementChecked = false

    // 发帖 sheet 状态
    var posting = false
    var postError: String?
    var postNeedsPaywall = false

    // 评论展开 & 提交状态（按 postId 键）
    var comments: [String: [PostComment]] = [:]
    var commentsLoading: Set<String> = []
    var commentDrafts: [String: String] = [:]
    var commentError: [String: String] = [:]
    var commentSubmitting: String?

    // MARK: 共创：加载

    func loadDemands() async {
        demandsError = nil
        do {
            let resp = try await API.shared.get("/api/demands", as: DemandsResponse.self)
            demands = resp.demands
            remainingVotes = resp.remainingVotes
            demandsLoaded = true
        } catch {
            demandsError = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 本周票是否已用完（仅当后端明确下发 remainingVotes==0 才判定；nil/未知不禁用）。
    var outOfVotesThisWeek: Bool { remainingVotes == 0 }

    /// 按票数倒序（名次用）。
    var rankedDemands: [Demand] {
        demands.sorted { $0.totalVotes > $1.totalVotes }
    }

    /// 本周之星 = 票数第一。
    var topDemand: Demand? { rankedDemands.first }

    /// 全场最高票（进度条基准，至少 1 防除零）。
    var maxVotes: Int { max(rankedDemands.first?.totalVotes ?? 0, 1) }

    /// 投票 POST 响应（消费后端返回的本周剩余票额，保持前端剩余票权威）。
    private struct VoteResult: Decodable {
        let remainingThisWeek: Int?
    }

    /// 投票：POST /api/demands/[id]/vote。乐观更新票数 + 同步本周剩余票额。
    /// 本周票已用完（remainingVotes==0）时不发起请求（前端拦一道，后端仍是最终裁决）。
    func vote(_ demand: Demand) async {
        guard demand.votedByMe != true, votingId == nil, !outOfVotesThisWeek else { return }
        votingId = demand.id
        defer { votingId = nil }
        do {
            let res = try await API.shared.post("/api/demands/\(demand.id)/vote", body: EmptyBody(), as: VoteResult.self)
            if let idx = demands.firstIndex(where: { $0.id == demand.id }) {
                demands[idx].totalVotes += 1
                demands[idx].votedByMe = true
            }
            // 剩余票额以后端返回为准；旧后端未下发时本地兜底自减 1（不低于 0）。
            if let r = res.remainingThisWeek {
                remainingVotes = r
            } else if let cur = remainingVotes {
                remainingVotes = max(0, cur - 1)
            }
        } catch {
            demandsError = (error as? APIError)?.errorDescription ?? "投票失败"
        }
    }

    // MARK: 广场：加载

    func loadPosts() async {
        postsError = nil
        do {
            let resp = try await API.shared.get("/api/posts", as: PostsResponse.self)
            posts = resp.posts
            postsLoaded = true
        } catch {
            postsError = (error as? APIError)?.errorDescription ?? "加载失败"
        }
        await checkEntitlementIfNeeded()
    }

    /// 排序视图：最新 = createdAt 倒序；热门 = 点赞+评论 倒序。
    var sortedPosts: [CommunityPost] {
        switch postsSort {
        case .latest:
            return posts.sorted { $0.createdAt > $1.createdAt }
        case .hot:
            return posts.sorted { ($0.likeCount + $0.commentCount) > ($1.likeCount + $1.commentCount) }
        }
    }

    /// 订阅态检查：仅用于决定是否展示「发帖」入口。失败不阻塞（composer 的 402 兜底）。
    private func checkEntitlementIfNeeded() async {
        guard !entitlementChecked else { return }
        entitlementChecked = true
        struct Ent: Decodable { let isSubscriber: Bool }
        do {
            let ent = try await API.shared.get("/api/entitlement/me", as: Ent.self)
            canPost = ent.isSubscriber
        } catch {
            // 拉取失败：保守展示入口，由发帖时的 402 提示引导订阅。
            canPost = true
        }
    }

    // MARK: 点赞 / 转发

    /// POST /api/posts/[id]/like，乐观切换。
    func toggleLike(_ post: CommunityPost) async {
        guard let idx = posts.firstIndex(where: { $0.id == post.id }) else { return }
        let wasLiked = posts[idx].likedByMe
        posts[idx].likedByMe.toggle()
        posts[idx].likeCount += wasLiked ? -1 : 1
        do {
            _ = try await API.shared.post("/api/posts/\(post.id)/like", body: EmptyBody(), as: EmptyResponse.self)
        } catch {
            // 回滚
            posts[idx].likedByMe = wasLiked
            posts[idx].likeCount += wasLiked ? 1 : -1
            postsError = (error as? APIError)?.errorDescription ?? "操作失败"
        }
    }

    /// POST /api/posts/[id]/repost。
    func repost(_ post: CommunityPost) async {
        do {
            _ = try await API.shared.post("/api/posts/\(post.id)/repost", body: EmptyBody(), as: EmptyResponse.self)
        } catch {
            postsError = (error as? APIError)?.errorDescription ?? "转发失败"
        }
    }

    // MARK: 评论

    /// GET /api/posts/[id]/comment。
    func loadComments(for postId: String) async {
        guard !commentsLoading.contains(postId) else { return }
        commentsLoading.insert(postId)
        commentError[postId] = nil
        defer { commentsLoading.remove(postId) }
        do {
            let resp = try await API.shared.get("/api/posts/\(postId)/comment", as: PostCommentsResponse.self)
            comments[postId] = resp.comments
        } catch {
            commentError[postId] = (error as? APIError)?.errorDescription ?? "评论加载失败"
        }
    }

    /// POST /api/posts/[id]/comment。
    func submitComment(for postId: String) async {
        let text = (commentDrafts[postId] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, commentSubmitting == nil else { return }
        commentSubmitting = postId
        commentError[postId] = nil
        defer { commentSubmitting = nil }
        struct Body: Encodable { let content: String }
        do {
            let resp = try await API.shared.post(
                "/api/posts/\(postId)/comment",
                body: Body(content: text),
                as: CommentCreateResponse.self
            )
            if resp.isApproved, let new = resp.comment {
                comments[postId, default: []].append(new)
                commentDrafts[postId] = ""
                if let idx = posts.firstIndex(where: { $0.id == postId }) {
                    posts[idx].commentCount += 1
                }
            } else {
                // 未通过审核：保留草稿，展示后端提示。
                commentError[postId] = resp.message ?? "评论未通过审核"
            }
        } catch {
            commentError[postId] = (error as? APIError)?.errorDescription ?? "评论失败"
        }
    }

    // MARK: 发帖

    /// POST /api/posts。返回是否成功；402 置 postNeedsPaywall。
    func createPost(type: String, content: String, images: [String]) async -> Bool {
        posting = true; postError = nil; postNeedsPaywall = false
        defer { posting = false }
        struct Body: Encodable {
            let type: String
            let content: String
            let images: [String]?
        }
        do {
            let resp = try await API.shared.post(
                "/api/posts",
                body: Body(type: type, content: content, images: images.isEmpty ? nil : images),
                as: PostCreateResponse.self
            )
            guard resp.isApproved else {
                // 未通过审核：展示后端提示，不关闭 sheet。
                postError = resp.message ?? "内容未通过审核"
                return false
            }
            // 创建成功但返回体不含完整帖子，重新拉取列表以插入新帖。
            await loadPosts()
            return true
        } catch {
            let apiErr = error as? APIError
            postError = apiErr?.errorDescription ?? "发布失败"
            if apiErr?.needsPaywall == true { postNeedsPaywall = true }
            return false
        }
    }
}

// MARK: - View

struct CommunityView: View {
    @State private var vm = CommunityViewModel()
    @State private var tab: CommunityTab = .demands
    @State private var showComposer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("视图", selection: $tab) {
                    ForEach(CommunityTab.allCases) { t in Text(t.rawValue).tag(t) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .onChange(of: tab) { _, _ in Haptics.selection() }

                ZStack {
                    switch tab {
                    case .demands: demandsTab
                    case .posts: postsTab
                    }
                }
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: tab)
            }
            .background(Studio.bg)
            .navigationTitle("社区广场")
            .toolbar {
                if tab == .posts && vm.canPost {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Haptics.light()
                            showComposer = true
                        } label: {
                            Label("发帖", systemImage: "square.and.pencil")
                                .font(.studio(14, .semibold))
                        }
                        .tint(Studio.red)
                    }
                }
            }
            .sheet(isPresented: $showComposer) {
                PostComposer(vm: vm)
                    .presentationDragIndicator(.visible)
            }
            .task { if !vm.demandsLoaded { await vm.loadDemands() } }
        }
    }

    // MARK: - 课程共创 Tab

    private var demandsTab: some View {
        Group {
            if vm.demandsLoaded {
                if vm.demands.isEmpty {
                    ScrollView { EmptyStateView(title: "还没有需求", subtitle: "投票决定下一门要做的课程") }
                        .refreshable { await vm.loadDemands() }
                } else {
                    demandsList
                }
            } else if let err = vm.demandsError {
                ScrollView { ErrorRetryView(message: err) { Task { await vm.loadDemands() } } }
            } else {
                ScrollView { demandsSkeleton }
            }
        }
    }

    private var demandsList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if let top = vm.topDemand {
                    weekStarCard(top)
                    HStack(alignment: .firstTextBaseline) {
                        Text("需求榜")
                            .font(.studio(16, .bold))
                            .foregroundStyle(Studio.ink)
                        Spacer()
                        // 本周剩余票额提示（仅后端下发 remainingVotes 时展示；0 票用中性提示）。
                        if let rv = vm.remainingVotes {
                            HStack(spacing: 4) {
                                Image(systemName: rv > 0 ? "ticket.fill" : "hourglass")
                                    .font(.system(size: 10, weight: .semibold))
                                Text(rv > 0 ? "本周剩余 \(rv) 票" : "本周票已用完")
                                    .font(.studio(11, .semibold))
                            }
                            .foregroundStyle(rv > 0 ? Studio.ink3 : Studio.ink4)
                        }
                    }
                    .padding(.top, 4)
                }
                ForEach(Array(vm.rankedDemands.enumerated()), id: \.element.id) { idx, demand in
                    demandCard(rank: idx + 1, demand: demand)
                        .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                }
            }
            .padding(16)
        }
        .refreshable { await vm.loadDemands() }
    }

    /// 本周之星大卡（深色 videoGradient 展示区，弃死黑平面）。
    private func weekStarCard(_ demand: Demand) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "star.fill").font(.system(size: 12)).foregroundStyle(Studio.red)
                Text("本周之星").font(.studio(12, .bold)).foregroundStyle(.white.opacity(0.85)).tracking(1)
                Spacer()
                // 领先趋势徽章（深色区自绘，用白半透明保对比）。
                HStack(spacing: 4) {
                    Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 10, weight: .bold))
                    Text(demand.statusLabel).font(.studio(11, .semibold))
                }
                .foregroundStyle(.white.opacity(0.82))
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(Color.white.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
            }
            Text(demand.title)
                .font(.studio(20, .bold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            if let desc = demand.description, !desc.isEmpty {
                Text(desc)
                    .font(.studio(13))
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(2)
            }
            HStack {
                HStack(spacing: 5) {
                    Image(systemName: "person.3.fill").font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                    Text("\(demand.totalVotes)")
                        .font(.mono(18, .bold)).foregroundStyle(.white)
                        .contentTransition(.numericText())
                        .animation(reduceMotion ? nil : StudioMotion.pop, value: demand.totalVotes)
                    Text("票").font(.studio(12)).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
                voteButton(demand, onDark: true)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        // 深色浮层海拔（L2 参数手绘，配深底大卡的浮起感）。
        .shadow(color: Color.black.opacity(scheme == .dark ? 0.5 : 0.22), radius: 20, x: 0, y: 8)
    }

    /// 榜单卡：名次 + 标题 + 票占比进度条 + 票数 + 投票。
    private func demandCard(rank: Int, demand: Demand) -> some View {
        let pct = Double(demand.totalVotes) / Double(vm.maxVotes)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(rank)")
                    .font(.mono(18, .bold))
                    .foregroundStyle(rank <= 3 ? Studio.red : Studio.ink4)
                    .frame(width: 28, alignment: .center)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(demand.categoryText)
                            .font(.studio(10, .semibold))
                            .foregroundStyle(Studio.ink3)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Studio.surfaceInset)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        StatusBadge(text: demand.statusLabel, tone: demand.statusTone)
                    }
                    Text(demand.title)
                        .font(.studio(15, .semibold))
                        .foregroundStyle(Studio.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let desc = demand.description, !desc.isEmpty {
                        Text(desc).font(.studio(12)).foregroundStyle(Studio.ink3).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }

            // 票占比进度条（红仅做榜首领先信号，动画注入宽度变化）。
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Studio.surfaceInset)
                    Capsule()
                        .fill(rank <= 3 ? Studio.red : Studio.ink3)
                        .frame(width: max(6, geo.size.width * pct))
                        .animation(reduceMotion ? nil : StudioMotion.smooth, value: pct)
                }
            }
            .frame(height: 6)

            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill").font(.system(size: 11)).foregroundStyle(Studio.ink3)
                    Text("\(demand.totalVotes)")
                        .font(.mono(14, .semibold)).foregroundStyle(Studio.ink)
                        .contentTransition(.numericText())
                        .animation(reduceMotion ? nil : StudioMotion.pop, value: demand.totalVotes)
                    Text("票").font(.studio(11)).foregroundStyle(Studio.ink3)
                }
                Spacer()
                voteButton(demand, onDark: false)
            }
        }
        .studioCard(padding: 14)
        .pressable()
    }

    /// 投票按钮：已投→禁用显示「已投」；未投但本周票已用完→禁用显示「票已用完」；否则可投。
    private func voteButton(_ demand: Demand, onDark: Bool) -> some View {
        let voted = demand.votedByMe == true
        let loading = vm.votingId == demand.id
        // 未投过本需求但本周票已用完（后端下发 remainingVotes==0）→ 置灰不可投。
        let exhausted = !voted && vm.outOfVotesThisWeek
        // 置灰态（已投 或 票用完）共用中性底色；仅可投态用有道红。
        let dimmed = voted || exhausted
        return Button {
            // 仅在真正会计票时给成功触觉（与 VM guard 一致）。
            if !voted && !exhausted && vm.votingId == nil { Haptics.success() }
            Task { await vm.vote(demand) }
        } label: {
            HStack(spacing: 5) {
                if loading {
                    ProgressView().controlSize(.small).tint(dimmed ? Studio.ink3 : .white)
                } else {
                    Image(systemName: voted ? "checkmark" : (exhausted ? "hourglass" : "hand.thumbsup.fill"))
                        .font(.system(size: 12, weight: .semibold))
                }
                Text(voted ? "已投" : (exhausted ? "票已用完" : "投票")).font(.studio(13, .semibold))
            }
            .foregroundStyle(dimmed ? Studio.ink3 : .white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(dimmed ? (onDark ? Color.white.opacity(0.12) : Studio.surfaceInset) : Studio.red)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(voted || exhausted || loading)
        .pressable(scale: 0.94, haptic: false)
        .animation(reduceMotion ? nil : StudioMotion.quick, value: voted)
    }

    private var demandsSkeleton: some View {
        VStack(alignment: .leading, spacing: 14) {
            SkeletonBar(height: 120).clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg))
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    SkeletonBar(height: 16, width: 200)
                    SkeletonBar(height: 6)
                    SkeletonBar(height: 12, width: 80)
                }
                .studioCard(padding: 14)
            }
        }
        .padding(16)
    }

    // MARK: - 自习室广场 Tab

    private var postsTab: some View {
        Group {
            if vm.postsLoaded {
                postsFeed
            } else if let err = vm.postsError {
                ScrollView { ErrorRetryView(message: err) { Task { await vm.loadPosts() } } }
            } else {
                ScrollView { postsSkeleton }
                    .task { if !vm.postsLoaded { await vm.loadPosts() } }
            }
        }
    }

    private var postsFeed: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Picker("排序", selection: $vm.postsSort) {
                    ForEach(PostsSort.allCases) { s in Text(s.rawValue).tag(s) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .onChange(of: vm.postsSort) { _, _ in Haptics.selection() }

                if vm.sortedPosts.isEmpty {
                    EmptyStateView(
                        title: "广场还很安静",
                        subtitle: vm.canPost ? "点右上角发帖，分享你的学习动态" : "订阅会员后即可发帖分享"
                    )
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(Array(vm.sortedPosts.enumerated()), id: \.element.id) { idx, post in
                            PostCard(vm: vm, post: post)
                                .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                        }
                    }
                    .padding(.horizontal, 16)
                    .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.postsSort)
                }
            }
            .padding(.vertical, 4)
            .padding(.bottom, 24)
        }
        .refreshable { await vm.loadPosts() }
    }

    private var postsSkeleton: some View {
        VStack(alignment: .leading, spacing: 12) {
            SkeletonBar(height: 32).clipShape(RoundedRectangle(cornerRadius: 8))
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Circle().fill(Studio.surfaceInset).frame(width: 38, height: 38)
                        VStack(alignment: .leading, spacing: 6) {
                            SkeletonBar(height: 12, width: 100)
                            SkeletonBar(height: 10, width: 60)
                        }
                    }
                    SkeletonBar(height: 12)
                    SkeletonBar(height: 12, width: 200)
                }
                .studioCard(padding: 14)
            }
        }
        .padding(16)
    }
}

// MARK: - 交错浮现进场

/// 列表项按索引交错淡入 + 微上浮。首帧后落定，尊重 reduce-motion（直接显示）。
struct FeedStaggerAppear: ViewModifier {
    let index: Int
    let reduceMotion: Bool
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 10)
            .onAppear {
                guard !reduceMotion, !shown else { shown = true; return }
                let delay = min(Double(index) * 0.05, 0.4)
                withAnimation(StudioMotion.smooth.delay(delay)) { shown = true }
            }
    }
}
