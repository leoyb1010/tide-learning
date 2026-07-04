import SwiftUI
import Observation

// MARK: - DTO（对齐后端 camelCase）
//
// 帖子流复用 Community 模块已有模型：
//   - PostsResponse { posts: [CommunityPost] }（GET /api/posts）
//   - CommunityPost（含 author / content / createdAt / likeCount / commentCount / type）
// 个人主页仅额外需要「身份摘要」，故这里只声明 PublicProfile。

/// GET /api/u/[id] -> 个人主页身份摘要（对齐后端公开字段；缺省用派生值兜底）。
///
/// 后端返回：id / nickname / avatarUrl? / studentNo / bio? / level? / joinedAt(ISO8601) /
/// postsCount? / coursesCount?。其中 level/postsCount/coursesCount 受目标用户 showProfile.stats
/// 开关控制（非本人且关闭时后端不回传，故为可选）。绝不含 email/phone/私密设置。
struct PublicProfile: Decodable {
    let id: String
    let nickname: String?
    let avatarUrl: String?
    let studentNo: String?
    let bio: String?
    let level: String?
    let joinedAt: Date?
    let postsCount: Int?
    let coursesCount: Int?
}

// MARK: - ViewModel

@Observable @MainActor
final class ProfilePageViewModel {
    let userId: String

    var profile: PublicProfile?
    var posts: [CommunityPost]?

    /// 三态以 posts 为主数据源（profile 允许缺省用派生兜底）。
    var error: String?
    var loading = false

    init(userId: String) {
        self.userId = userId
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }

        // profile 与 posts 并发拉取；profile 失败不阻塞主页（用派生兜底）。
        async let profileResult = fetchProfile()
        async let postsResult = fetchPosts()

        let (p, postsOutcome) = await (profileResult, postsResult)
        profile = p

        switch postsOutcome {
        case .success(let list):
            posts = list
        case .failure(let msg):
            // 帖子是主数据源：失败进入错误三态。
            if posts == nil { error = msg }
        }
    }

    private func fetchProfile() async -> PublicProfile? {
        do {
            return try await API.shared.get("/api/u/\(userId)", as: PublicProfile.self)
        } catch {
            // 主页身份摘要不确定即缺省：返回 nil，由 View 用派生值兜底。
            return nil
        }
    }

    private enum PostsOutcome { case success([CommunityPost]); case failure(String) }

    private func fetchPosts() async -> PostsOutcome {
        // 用 URLComponents.queryItems 组装 userId，正确转义特殊字符（与搜索词编码同理）。
        let path = Self.postsPath(userId: userId)
        do {
            let resp = try await API.shared.get(path, as: PostsResponse.self)
            return .success(resp.posts)
        } catch {
            return .failure((error as? APIError)?.errorDescription ?? "加载失败")
        }
    }

    /// 用 URLComponents 组装 /api/posts?userId= 路径，避免手写百分号编码漏转义。
    static func postsPath(userId: String) -> String {
        var comps = URLComponents()
        comps.path = "/api/posts"
        comps.queryItems = [URLQueryItem(name: "userId", value: userId)]
        if let encoded = comps.percentEncodedQuery, !encoded.isEmpty {
            return "\(comps.path)?\(encoded)"
        }
        return comps.path
    }

    // MARK: 展示派生（profile 缺省时兜底）

    var displayNickname: String {
        profile?.nickname?.nonEmpty ?? "学员"
    }
    var displayStudentNo: String {
        profile?.studentNo?.nonEmpty ?? ProfileDerive.studentNumber(from: userId)
    }
    var displayLevel: String? {
        profile?.level?.nonEmpty
    }
    var displayBio: String? {
        profile?.bio?.nonEmpty
    }
    var avatarInitial: String {
        ProfileDerive.avatarInitial(from: displayNickname)
    }
    var joinedText: String? {
        guard let d = profile?.joinedAt else { return nil }
        return ProfileDerive.enrollmentText(from: d)
    }
}

private extension String {
    /// 去空白后非空则返回自身，否则 nil。
    var nonEmpty: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

// MARK: - View

struct ProfilePageView: View {
    @State private var vm: ProfilePageViewModel
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(userId: String) {
        _vm = State(initialValue: ProfilePageViewModel(userId: userId))
    }

    var body: some View {
        ScrollView {
            content
                .padding(16)
        }
        .background(Studio.bg)
        .navigationTitle("个人主页")
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.posts == nil && vm.error == nil { await vm.load() } }
        .refreshable { await vm.load() }
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if vm.posts != nil {
            VStack(alignment: .leading, spacing: 20) {
                identityCard
                postsSection
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    // MARK: 身份摘要卡（深色资料头图 + 叠头像）

    private var identityCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 资料头图：深色 videoGradient 展示带（弃死黑），头像下沉叠压。
            ZStack(alignment: .bottomLeading) {
                Studio.videoGradient
                    .frame(height: 84)
                    .overlay(alignment: .topTrailing) {
                        if let level = vm.displayLevel {
                            Text(level)
                                .font(.studio(11, .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(Color.white.opacity(0.16))
                                .clipShape(Capsule())
                                .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                                .padding(12)
                        }
                    }
                Circle()
                    .fill(Studio.surface)
                    .frame(width: 68, height: 68)
                    .overlay(
                        Text(vm.avatarInitial)
                            .font(.studio(26, .bold))
                            .foregroundStyle(Studio.ink2)
                    )
                    .overlay(Circle().strokeBorder(Studio.surface, lineWidth: 3))
                    .offset(x: 16, y: 34)
            }

            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(vm.displayNickname)
                        .font(.studio(19, .bold))
                        .foregroundStyle(Studio.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Image(systemName: "number")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Studio.ink4)
                        Text(vm.displayStudentNo)
                            .font(.mono(13, .semibold))
                            .foregroundStyle(Studio.ink2)
                    }
                }
                .padding(.top, 40)

                if let bio = vm.displayBio {
                    Text(bio)
                        .font(.studio(14))
                        .foregroundStyle(Studio.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // 摘要统计行
                HStack(spacing: 18) {
                    statItem(value: "\(vm.posts?.count ?? vm.profile?.postsCount ?? 0)", label: "帖子")
                    if let n = vm.profile?.coursesCount {
                        statItem(value: "\(n)", label: "课程")
                    }
                    if let joined = vm.joinedText {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(joined).font(.mono(13, .semibold)).foregroundStyle(Studio.ink)
                            Text("加入").font(.studio(11)).foregroundStyle(Studio.ink3)
                        }
                    }
                    Spacer()
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                .strokeBorder(Studio.border, lineWidth: 1)
        )
        .shadow(color: cardShadow.color, radius: cardShadow.radius, x: 0, y: cardShadow.y)
    }

    private var cardShadow: (color: Color, radius: CGFloat, y: CGFloat) {
        StudioElevation.l1(scheme)
    }

    private func statItem(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.mono(16, .bold)).foregroundStyle(Studio.ink)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
    }

    // MARK: 发帖流

    @ViewBuilder
    private var postsSection: some View {
        Text("发帖")
            .font(.studio(16, .bold))
            .foregroundStyle(Studio.ink)

        if let posts = vm.posts, posts.isEmpty {
            EmptyStateView(title: "还没有发帖", subtitle: "TA 还没有分享过内容", icon: "square.and.pencil")
        } else if let posts = vm.posts {
            LazyVStack(spacing: 10) {
                ForEach(Array(posts.enumerated()), id: \.element.id) { idx, post in
                    ProfilePostCard(post: post)
                        .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                }
            }
        }
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    Circle().fill(Studio.surfaceInset).frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonBar(height: 18, width: 140)
                        SkeletonBar(height: 12, width: 90)
                    }
                }
                SkeletonBar(height: 12)
            }
            .studioCard()

            SkeletonBar(height: 18, width: 80)
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBar(height: 14, width: 160)
                    SkeletonBar(height: 12)
                    SkeletonBar(height: 12, width: 120)
                }
                .studioCard(padding: 14)
            }
        }
    }
}

// MARK: - 帖子卡（个人主页只读版；点赞/评论交互见 Community/PostCard）

struct ProfilePostCard: View {
    let post: CommunityPost

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                StatusBadge(text: post.typeLabel, icon: post.typeIcon, tone: post.typeTone)
                Spacer()
                Text(CommunityTime.string(from: post.createdAt))
                    .font(.mono(11))
                    .foregroundStyle(Studio.ink3)
            }

            Text(post.content)
                .font(.studio(14))
                .foregroundStyle(Studio.ink)
                .lineLimit(6)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 16) {
                Spacer()
                metaLabel(icon: "heart", value: post.likeCount)
                metaLabel(icon: "bubble.right", value: post.commentCount)
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(padding: 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(post.typeLabel)：\(post.content)，\(post.likeCount) 赞，\(post.commentCount) 评论")
    }

    private func metaLabel(icon: String, value: Int) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundStyle(Studio.ink4)
            Text("\(value)")
                .font(.mono(11))
                .foregroundStyle(Studio.ink3)
        }
    }
}
