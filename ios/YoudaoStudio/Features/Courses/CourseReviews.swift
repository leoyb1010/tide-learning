import SwiftUI
import Observation

// MARK: - DTO（对齐 GET/POST /api/courses/[id]/reviews 返回体）

/// 课程评分聚合：均分 + 评价数 + 1-5 星分布 + 是否占位。
/// 对齐 web CourseRatingAggregate：零真实评价时 isPlaceholder=true（UI 标「示例」）。
struct CourseRatingAggregate: Decodable, Equatable {
    let score: Double
    let count: Int
    let isPlaceholder: Bool
    /// dist[k] = 打 (k+1) 星的条数（索引 0→1 星 … 4→5 星）。
    let dist: [Int]

    /// 真实评价（非占位且有条数）。占位时 UI 不展示分布数字。
    var hasReal: Bool { !isPlaceholder && count > 0 }

    /// 安全取某星（1…5）条数。
    func distValue(star: Int) -> Int {
        guard star >= 1, star <= 5, dist.count >= 5 else { return 0 }
        return dist[star - 1]
    }
}

/// 单条评价视图（列表展示，仅作者公开字段）。
struct CourseReviewItem: Decodable, Identifiable, Equatable {
    let id: String
    let rating: Int
    let comment: String?
    let createdAt: Date
    let author: CourseReviewAuthor
}

struct CourseReviewAuthor: Decodable, Equatable {
    let id: String
    let nickname: String
    let avatarUrl: String?

    /// 头像占位首字。
    var initial: String { String(nickname.prefix(1)).isEmpty ? "学" : String(nickname.prefix(1)) }
}

/// 我的既有评价（回填写评价表单）。
struct MyCourseReview: Decodable, Equatable {
    let rating: Int
    let comment: String?
}

/// GET/POST /api/courses/[id]/reviews 返回体。
struct CourseReviewsPayload: Decodable, Equatable {
    let aggregate: CourseRatingAggregate
    let reviews: [CourseReviewItem]
    /// 我的既有评价（未登录/未评为 null）。
    let mine: MyCourseReview?
    /// 是否可写评价（学过才可评）。GET 时未登录为 false/缺省。
    let canReview: Bool?
}

// MARK: - ViewModel

@Observable @MainActor
final class CourseReviewsViewModel {
    /// 课程 id 或 slug（后端两者皆解析）。
    let courseKey: String

    var payload: CourseReviewsPayload?
    var loaded = false
    var error: String?
    var loading = false

    // 写评价态
    var submitting = false
    var submitError: String?

    init(courseKey: String) { self.courseKey = courseKey }

    private var encodedKey: String {
        courseKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? courseKey
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            payload = try await API.shared.get("/api/courses/\(encodedKey)/reviews", as: CourseReviewsPayload.self)
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "评价没能加载出来"
        }
    }

    /// 提交/修改评价（一人一课一评 upsert）。成功回填最新聚合并返回 true。
    func submit(rating: Int, comment: String) async -> Bool {
        guard rating >= 1, rating <= 5 else { submitError = "请先选择评分"; return false }
        submitting = true; submitError = nil
        defer { submitting = false }
        struct Body: Encodable { let rating: Int; let comment: String? }
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = Body(rating: rating, comment: trimmed.isEmpty ? nil : trimmed)
        do {
            let updated = try await API.shared.post(
                "/api/courses/\(encodedKey)/reviews",
                body: body,
                as: CourseReviewsPayload.self
            )
            // POST 返回体不含 canReview；保留既有值（能写评价说明学过，恒为 true）。
            payload = CourseReviewsPayload(
                aggregate: updated.aggregate,
                reviews: updated.reviews,
                mine: updated.mine,
                canReview: payload?.canReview ?? true
            )
            return true
        } catch {
            submitError = (error as? APIError)?.errorDescription ?? "提交失败，请检查网络后重试"
            return false
        }
    }
}

// MARK: - 星级展示（只读，支持半星）

/// 只读星级：满/半/空叠画（对齐 web RatingStars 的取整逻辑）。
struct RatingStarsView: View {
    let score: Double
    var size: CGFloat = 14

    var body: some View {
        let full = Int(floor(score))
        let frac = score - Double(full)
        let hasHalf = frac >= 0.25 && frac < 0.75
        let rounded = frac >= 0.75 ? full + 1 : full
        HStack(spacing: 1) {
            ForEach(0..<5, id: \.self) { i in
                symbol(index: i, full: full, rounded: rounded, hasHalf: hasHalf)
                    .font(.system(size: size))
                    .foregroundStyle(Studio.warn)
            }
        }
    }

    private func symbol(index i: Int, full: Int, rounded: Int, hasHalf: Bool) -> Image {
        let isFull = i < (hasHalf ? full : rounded)
        let isHalf = hasHalf && i == full
        if isHalf { return Image(systemName: "star.leadinghalf.filled") }
        return Image(systemName: isFull ? "star.fill" : "star")
            .renderingMode(.template)
    }
}

// MARK: - 课程评价区块（聚合 + 写入口 + 列表；自持三态）

struct CourseReviewsSection: View {
    @State private var vm: CourseReviewsViewModel
    @State private var formOpen = false
    private let isLoggedIn: Bool

    init(courseKey: String, isLoggedIn: Bool) {
        _vm = State(initialValue: CourseReviewsViewModel(courseKey: courseKey))
        self.isLoggedIn = isLoggedIn
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("学员评价").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                Text("学过的同学怎么说").font(.studio(12)).foregroundStyle(Studio.ink3)
                Spacer(minLength: 0)
            }

            if vm.loaded, let payload = vm.payload {
                body(payload)
            } else if let err = vm.error {
                ErrorRetryView(message: err) { Task { await vm.load() } }
            } else {
                skeleton
            }
        }
        .task { if !vm.loaded { await vm.load() } }
        .sheet(isPresented: $formOpen) {
            WriteReviewSheet(vm: vm, initial: vm.payload?.mine)
        }
    }

    @ViewBuilder
    private func body(_ payload: CourseReviewsPayload) -> some View {
        let agg = payload.aggregate
        let canReview = payload.canReview ?? false

        // 聚合条：均分 + 星级 + 分布。
        aggregateBar(agg)

        // 写评价入口：仅登录且学过可见；已评过改为「修改」。
        if isLoggedIn && canReview {
            Button {
                Haptics.light(); formOpen = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.pencil").font(.system(size: 14, weight: .semibold))
                    Text(payload.mine != nil ? "修改我的评价" : "写下我的评价").font(.studio(13.5, .semibold))
                }
                .foregroundStyle(Studio.red)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .frame(maxWidth: .infinity)
                .background(Studio.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .pressable(scale: 0.98, haptic: false)
        } else if isLoggedIn && !canReview {
            // 登录但没学过：温和引导。
            Text("学过这门课就能写评价，先去学一节，回来分享你的收获。")
                .font(.studio(12.5)).foregroundStyle(Studio.ink2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.border2, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        }

        // 列表 / 空态
        if payload.reviews.isEmpty {
            reviewsEmpty(canReview: canReview)
        } else {
            VStack(spacing: 10) {
                ForEach(payload.reviews) { reviewCard($0) }
            }
        }
    }

    // MARK: 聚合条

    private func aggregateBar(_ agg: CourseRatingAggregate) -> some View {
        let maxDist = max(1, (1...5).map { agg.distValue(star: $0) }.max() ?? 1)
        return HStack(alignment: .center, spacing: 16) {
            // 左：大均分
            VStack(spacing: 4) {
                Text(String(format: "%.1f", agg.score))
                    .font(.mono(38, .heavy)).foregroundStyle(Studio.ink)
                RatingStarsView(score: agg.score, size: 13)
                Text(agg.hasReal ? "\(agg.count) 条评价" : "示例评分")
                    .font(.studio(11)).foregroundStyle(Studio.ink3)
            }
            .frame(minWidth: 84)

            Rectangle().fill(Studio.border).frame(width: 1, height: 72)

            // 右：5→1 星分布
            VStack(spacing: 5) {
                ForEach([5, 4, 3, 2, 1], id: \.self) { star in
                    let n = agg.distValue(star: star)
                    let frac = agg.hasReal ? Double(n) / Double(maxDist) : 0
                    HStack(spacing: 8) {
                        HStack(spacing: 1) {
                            Text("\(star)").font(.mono(11)).foregroundStyle(Studio.ink3)
                            Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(Studio.warn)
                        }
                        .frame(width: 22, alignment: .leading)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Studio.surfaceInset)
                                Capsule().fill(Studio.warn)
                                    .frame(width: max(frac > 0 ? 4 : 0, geo.size.width * frac))
                            }
                        }
                        .frame(height: 7)
                        Text(agg.hasReal ? "\(n)" : "—")
                            .font(.mono(10)).foregroundStyle(Studio.ink4)
                            .frame(width: 22, alignment: .trailing)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .studioCard(padding: 0)
        .padding(.horizontal, 0)
    }

    // MARK: 单条评价

    private func reviewCard(_ r: CourseReviewItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                avatar(r.author)
                Text(r.author.nickname).font(.studio(13.5, .semibold)).foregroundStyle(Studio.ink).lineLimit(1)
                Spacer(minLength: 8)
                HStack(spacing: 1) {
                    ForEach(0..<5, id: \.self) { i in
                        Image(systemName: i < r.rating ? "star.fill" : "star")
                            .font(.system(size: 12))
                            .foregroundStyle(i < r.rating ? Studio.warn : Studio.ink4)
                    }
                }
            }
            if let comment = r.comment, !comment.isEmpty {
                Text(comment).font(.studio(13.5)).foregroundStyle(Studio.ink2).lineSpacing(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(padding: 14)
    }

    private func avatar(_ author: CourseReviewAuthor) -> some View {
        ZStack {
            if let urlStr = author.avatarUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if let img = phase.image { img.resizable().aspectRatio(contentMode: .fill) }
                    else { Studio.redSoft }
                }
            } else {
                Studio.redSoft
                Text(author.initial).font(.studio(12, .bold)).foregroundStyle(Studio.redInk)
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Studio.redSoftBorder, lineWidth: 1))
    }

    // MARK: 空态

    private func reviewsEmpty(canReview: Bool) -> some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Studio.redSoft).frame(width: 48, height: 48)
                Image(systemName: "text.bubble.fill").font(.system(size: 20)).foregroundStyle(Studio.red)
            }
            Text("还没有学员评价").font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
            Text(isLoggedIn && canReview
                 ? "你学过这门课，来当第一个留下评价的人吧。"
                 : "学过这门课的同学可以在这里留下第一条评价。")
                .font(.studio(13)).foregroundStyle(Studio.ink2)
                .multilineTextAlignment(.center).lineSpacing(2)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 24)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border2, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    private var skeleton: some View {
        VStack(spacing: 10) {
            SkeletonBar(height: 96).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBar(height: 14, width: 120)
                    SkeletonBar(height: 12)
                    SkeletonBar(height: 12, width: 180)
                }
                .studioCard(padding: 14)
            }
        }
    }
}

// MARK: - 写评价 sheet（星选 + 文本）

struct WriteReviewSheet: View {
    @Bindable var vm: CourseReviewsViewModel
    let initial: MyCourseReview?

    @Environment(\.dismiss) private var dismiss
    @State private var rating: Int
    @State private var hover: Int = 0
    @State private var comment: String

    private let hints = ["", "不太满意", "一般", "还不错", "很满意", "非常推荐"]

    init(vm: CourseReviewsViewModel, initial: MyCourseReview?) {
        self.vm = vm
        self.initial = initial
        _rating = State(initialValue: initial?.rating ?? 0)
        _comment = State(initialValue: initial?.comment ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // 星选
                    VStack(alignment: .leading, spacing: 10) {
                        Text("我的评分").font(.studio(13.5, .semibold)).foregroundStyle(Studio.ink)
                        HStack(spacing: 6) {
                            ForEach(1...5, id: \.self) { star in
                                Button {
                                    Haptics.selection(); rating = star
                                } label: {
                                    Image(systemName: star <= rating ? "star.fill" : "star")
                                        .font(.system(size: 30))
                                        .foregroundStyle(star <= rating ? Studio.warn : Studio.ink4)
                                }
                                .buttonStyle(.plain)
                            }
                            if rating > 0 {
                                Text(hints[rating]).font(.studio(13, .medium)).foregroundStyle(Studio.red)
                                    .padding(.leading, 4)
                            }
                        }
                    }

                    // 评语
                    VStack(alignment: .leading, spacing: 6) {
                        Text("评语（选填）").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                        TextEditor(text: $comment)
                            .font(.studio(14))
                            .foregroundStyle(Studio.ink)
                            .frame(minHeight: 120)
                            .scrollContentBackground(.hidden)
                            .padding(10)
                            .background(Studio.surface2)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(alignment: .topLeading) {
                                if comment.isEmpty {
                                    Text("说说这门课哪里帮到你了（最多 500 字）")
                                        .font(.studio(14)).foregroundStyle(Studio.ink4)
                                        .padding(.horizontal, 15).padding(.vertical, 18)
                                        .allowsHitTesting(false)
                                }
                            }
                            .onChange(of: comment) { _, v in
                                if v.count > 500 { comment = String(v.prefix(500)) }
                            }
                        Text("\(comment.count)/500").font(.mono(11)).foregroundStyle(Studio.ink4)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }

                    if let err = vm.submitError {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12))
                            Text(err).font(.studio(13))
                        }
                        .foregroundStyle(Studio.redInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Studio.redSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
                    }

                    StudioButton(
                        title: initial != nil ? "更新评价" : "发布评价",
                        kind: .red,
                        icon: "checkmark.circle.fill",
                        loading: vm.submitting
                    ) {
                        Task {
                            let ok = await vm.submit(rating: rating, comment: comment)
                            if ok { Haptics.success(); dismiss() } else { Haptics.error() }
                        }
                    }
                    .disabled(rating < 1)
                }
                .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("写评价")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }.tint(Studio.ink2)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
