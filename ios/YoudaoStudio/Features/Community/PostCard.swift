import SwiftUI
import Observation

// MARK: - DTO（对齐后端 JSON, camelCase）

/// GET /api/posts 返回体。
struct PostsResponse: Decodable {
    let posts: [CommunityPost]
}

/// 自习室广场帖子。
struct CommunityPost: Decodable, Identifiable, Equatable {
    let id: String
    let type: String            // insight / checkin / question
    let content: String
    let images: [String]?
    var likeCount: Int
    var commentCount: Int
    let createdAt: Date
    let author: Author?
    var likedByMe: Bool

    struct Author: Decodable, Equatable {
        let nickname: String
        let avatarUrl: String?
    }

    /// 类型中文标签。
    var typeLabel: String {
        switch type {
        case "insight": return "心得"
        case "checkin": return "打卡"
        case "question": return "提问"
        default: return "动态"
        }
    }

    var typeIcon: String {
        switch type {
        case "insight": return "lightbulb.fill"
        case "checkin": return "checkmark.seal.fill"
        case "question": return "questionmark.circle.fill"
        default: return "text.bubble.fill"
        }
    }

    /// 类型语义色调：心得=洞见蓝(info) / 打卡=完成绿(ok) / 提问=待答琥珀(warn)。
    var typeTone: StatusBadge.Tone {
        switch type {
        case "insight": return .info
        case "checkin": return .ok
        case "question": return .warn
        default: return .neutral
        }
    }
}

/// GET /api/posts/[id]/comment 返回体。
struct PostCommentsResponse: Decodable {
    let comments: [PostComment]
}

/// 帖子评论。
struct PostComment: Decodable, Identifiable, Equatable {
    let id: String
    let content: String
    let createdAt: Date
    let author: CommunityPost.Author?
}

/// POST /api/posts/[id]/comment 返回体：审核网关。
/// status = approved -> 携带 comment；rejected/pending -> 携带 message。
struct CommentCreateResponse: Decodable {
    let status: String
    let comment: PostComment?
    let message: String?

    var isApproved: Bool { status == "approved" }
}

/// POST /api/posts 返回体：审核网关（不返回完整帖子，仅 status/message/id）。
struct PostCreateResponse: Decodable {
    let status: String
    let message: String?
    let id: String?

    var isApproved: Bool { status == "approved" }
}

// MARK: - 相对时间（模块内自持，避免跨模块依赖）

enum CommunityTime {
    private static let fmt: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "zh_Hans")
        f.unitsStyle = .short
        return f
    }()

    static func string(from date: Date) -> String {
        fmt.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - 帖子卡组件

struct PostCard: View {
    @Bindable var vm: CommunityViewModel
    let post: CommunityPost
    @State private var commentsExpanded = false
    /// 点赞心跳：按下瞬间放大回弹。
    @State private var heartBeat = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Text(post.content)
                .font(.studio(15))
                .foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let images = post.images, !images.isEmpty {
                imageGrid(images)
            }
            actions
            if commentsExpanded {
                commentsSection
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .move(edge: .top)),
                        removal: .opacity
                    ))
            }
        }
        .studioCard(padding: 14)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: commentsExpanded)
    }

    // MARK: 头部（头像 + 昵称 + 类型 + 时间）

    private var header: some View {
        HStack(spacing: 10) {
            avatar
            VStack(alignment: .leading, spacing: 2) {
                Text(post.author?.nickname ?? "自习室同学")
                    .font(.studio(14, .semibold))
                    .foregroundStyle(Studio.ink)
                    .lineLimit(1)
                Text(CommunityTime.string(from: post.createdAt))
                    .font(.mono(11))
                    .foregroundStyle(Studio.ink3)
            }
            Spacer()
            // 类型语义徽章（心得蓝/打卡绿/提问琥珀），弃裸红。
            StatusBadge(text: post.typeLabel, icon: post.typeIcon, tone: post.typeTone)
        }
    }

    private var avatar: some View {
        Group {
            if let urlStr = post.author?.avatarUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                    case .empty: Studio.surface2
                    case .failure: avatarFallback
                    @unknown default: avatarFallback
                    }
                }
            } else {
                avatarFallback
            }
        }
        .frame(width: 38, height: 38)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Studio.border, lineWidth: 1))
    }

    private var avatarFallback: some View {
        ZStack {
            Studio.surface2
            Image(systemName: "person.fill").font(.system(size: 16)).foregroundStyle(Studio.ink4)
        }
    }

    // MARK: 图片网格

    private func imageGrid(_ images: [String]) -> some View {
        let cols = images.count == 1 ? 1 : (images.count == 2 || images.count == 4 ? 2 : 3)
        let layout = Array(repeating: GridItem(.flexible(), spacing: 6), count: cols)
        return LazyVGrid(columns: layout, spacing: 6) {
            ForEach(images.prefix(9), id: \.self) { urlStr in
                gridImage(urlStr, single: images.count == 1)
            }
        }
    }

    private func gridImage(_ urlStr: String, single: Bool) -> some View {
        ZStack {
            Studio.surface2
            if let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                    case .empty: ProgressView().tint(Studio.ink4)
                    case .failure: Image(systemName: "photo").foregroundStyle(Studio.ink4)
                    @unknown default: EmptyView()
                    }
                }
            } else {
                Image(systemName: "photo").foregroundStyle(Studio.ink4)
            }
        }
        .frame(height: single ? 200 : 108)
        .frame(maxWidth: .infinity)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: 操作行（点赞 / 评论 / 转发）

    private var actions: some View {
        HStack(spacing: 24) {
            // 点赞：心跳放大 + 成功触觉，数字变化弹性强调。
            Button {
                let willLike = !post.likedByMe
                if willLike { Haptics.success() } else { Haptics.light() }
                if willLike && !reduceMotion { pulseHeart() }
                Task { await vm.toggleLike(post) }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: post.likedByMe ? "heart.fill" : "heart")
                        .font(.system(size: 14, weight: .medium))
                        .scaleEffect(heartBeat && !reduceMotion ? 1.35 : 1)
                    Text("\(post.likeCount)")
                        .font(.mono(12))
                        .contentTransition(.numericText())
                }
                .foregroundStyle(post.likedByMe ? Studio.red : Studio.ink3)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
                .animation(reduceMotion ? nil : StudioMotion.pop, value: post.likeCount)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(post.likedByMe ? "取消赞，当前 \(post.likeCount)" : "赞，当前 \(post.likeCount)")

            Button {
                Haptics.selection()
                if reduceMotion {
                    commentsExpanded.toggle()
                } else {
                    withAnimation(StudioMotion.smooth) { commentsExpanded.toggle() }
                }
                if commentsExpanded { Task { await vm.loadComments(for: post.id) } }
            } label: {
                actionLabel(icon: commentsExpanded ? "bubble.right.fill" : "bubble.right",
                            count: post.commentCount,
                            tint: commentsExpanded ? Studio.info : Studio.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("评论，当前 \(post.commentCount) 条")

            Button {
                Haptics.light()
                Task { await vm.repost(post) }
            } label: {
                actionLabel(icon: "arrow.2.squarepath", count: nil, tint: Studio.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("转发")

            Spacer()
        }
    }

    private func actionLabel(icon: String, count: Int?, tint: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 14, weight: .medium))
            if let count {
                Text("\(count)").font(.mono(12)).contentTransition(.numericText())
            } else {
                Text("转发").font(.studio(12))
            }
        }
        .foregroundStyle(tint)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    // MARK: 评论区

    private var commentsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider().overlay(Studio.border)

            HStack(spacing: 8) {
                TextField("写下你的评论…", text: Binding(
                    get: { vm.commentDrafts[post.id] ?? "" },
                    set: { vm.commentDrafts[post.id] = $0 }
                ), axis: .vertical)
                    .font(.studio(13))
                    .foregroundStyle(Studio.ink)
                    .lineLimit(1...3)
                    .padding(10)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button {
                    if canSubmitComment { Haptics.light() }
                    Task {
                        let before = vm.comments[post.id]?.count ?? 0
                        await vm.submitComment(for: post.id)
                        // 评论新增成功给成功触觉。
                        if (vm.comments[post.id]?.count ?? 0) > before { Haptics.success() }
                    }
                } label: {
                    Group {
                        if vm.commentSubmitting == post.id {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(canSubmitComment ? Studio.red : Studio.ink4)
                                .pressable(scale: 0.9)
                        }
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canSubmitComment || vm.commentSubmitting == post.id)
                .accessibilityLabel("发送评论")
            }

            if let err = vm.commentError[post.id] {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 11)).foregroundStyle(Studio.warn)
                    Text(err).font(.studio(12)).foregroundStyle(Studio.warn)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Studio.warnSoft)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }

            if vm.commentsLoading.contains(post.id) {
                HStack(spacing: 8) { SkeletonBar(height: 12, width: 100); Spacer() }
            } else {
                let comments = vm.comments[post.id] ?? []
                if comments.isEmpty {
                    Text("还没有评论，来抢沙发")
                        .font(.studio(12))
                        .foregroundStyle(Studio.ink3)
                } else {
                    ForEach(comments) { c in
                        commentRow(c)
                    }
                }
            }
        }
    }

    private func commentRow(_ c: PostComment) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(c.author?.nickname ?? "同学")
                    .font(.studio(12, .semibold))
                    .foregroundStyle(Studio.ink2)
                Text(CommunityTime.string(from: c.createdAt))
                    .font(.mono(10))
                    .foregroundStyle(Studio.ink4)
            }
            Text(c.content)
                .font(.studio(13))
                .foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var canSubmitComment: Bool {
        !(vm.commentDrafts[post.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// 心跳一次：放大后回弹（两相分帧提交，保证放大可见）。
    private func pulseHeart() {
        withAnimation(StudioMotion.pop) { heartBeat = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
            withAnimation(StudioMotion.spring) { heartBeat = false }
        }
    }
}
