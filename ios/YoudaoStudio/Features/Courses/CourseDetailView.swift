import SwiftUI
import Observation

// MARK: - DTO

/// GET /api/courses/{id 或 slug} → { course, snapshot, categoryLabel, levelLabel, durationText, lessons, updateLogs }。
/// 详情接口是聚合结构：课程本体在 `course` 内，展示用大纲在顶层 `lessons`。
struct CourseDetail: Decodable, Equatable {
    let course: CourseDetailCore
    /// 展示用大纲（含 canAccess 访问判定），与 course.lessons 内嵌明细不同。
    let lessons: [CourseLesson]
    /// 后端已本地化的标签/时长文案。
    let categoryLabel: String?
    let levelLabel: String?
    let durationText: String?
}

/// 课程本体（详情接口 `course` 字段）。仅声明 UI 需要的字段，其余后端字段忽略。
struct CourseDetailCore: Decodable, Equatable {
    let id: String
    let slug: String
    let title: String
    let subtitle: String?
    let description: String?
    let category: String
    let level: String
    let coverColor: String
    let origin: String?
    let totalDurationSec: Int
    let learnersCount: Int
    let isFeatured: Bool
}

/// 展示用大纲章节（GET /api/courses/{id} 顶层 lessons 项）。
struct CourseLesson: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let durationSec: Int
    let isFree: Bool
    /// 章节简述（可选）。
    let summary: String?
    /// 内容类型（video / article / live 等，可选）。
    let contentType: String?
    /// 当前用户是否可访问（后端解锁判定，可选）。
    let canAccess: Bool?
}

// MARK: - ViewModel

@Observable @MainActor
final class CourseDetailViewModel {
    var detail: CourseDetail?
    var error: String?
    var loading = false

    /// 付费引导弹层开关（点击未解锁章节触发）。
    var showPaywall = false
    var paywallMessage: String?

    /// 优先用 id 拉；若 id 为空则退回 slug。
    let courseId: String
    let courseSlug: String

    init(courseId: String, courseSlug: String) {
        self.courseId = courseId
        self.courseSlug = courseSlug
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        let key = courseId.isEmpty ? courseSlug : courseId
        let encoded = key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key
        do {
            detail = try await API.shared.get("/api/courses/\(encoded)", as: CourseDetail.self)
        } catch let apiErr as APIError {
            // 404 且用 id 拉失败时，退回 slug 再试一次。
            if case .notFound = apiErr, !courseSlug.isEmpty, key != courseSlug {
                let s = courseSlug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? courseSlug
                do {
                    detail = try await API.shared.get("/api/courses/\(s)", as: CourseDetail.self)
                    return
                } catch {
                    self.error = (error as? APIError)?.errorDescription ?? "加载失败"
                }
            } else {
                self.error = apiErr.errorDescription
            }
        } catch {
            self.error = "加载失败"
        }
    }

    /// 点击未解锁章节 → 弹订阅引导。
    func promptPaywall(_ message: String? = nil) {
        paywallMessage = message
        showPaywall = true
    }
}

// MARK: - View

struct CourseDetailView: View {
    @State private var vm: CourseDetailViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 大纲进场：详情到达后翻转，驱动章节交错浮现。
    @State private var lessonsAppeared = false

    /// 任意 category → trackGradient 支持的 4 赛道键，未知回退 nil。
    private func trackKey(_ category: String?) -> String? {
        guard let c = category?.lowercased() else { return nil }
        if c.contains("ai") || c.contains("智能") || c.contains("人工") { return "ai" }
        if c.contains("english") || c.contains("英语") || c.contains("语言") { return "english" }
        if c.contains("elder") || c.contains("老") || c.contains("银发") || c.contains("养") { return "elder" }
        if c.contains("life") || c.contains("生活") || c.contains("兴趣") { return "life" }
        return nil
    }

    /// 从列表进入：已有 Course 摘要，先渲染封面/标题，避免白屏。
    private let preview: Course?

    init(course: Course) {
        self.preview = course
        _vm = State(initialValue: CourseDetailViewModel(courseId: course.id, courseSlug: course.slug))
    }

    /// 允许仅用 id/slug 进入（例如从其它页面深链）。
    init(courseId: String, courseSlug: String) {
        self.preview = nil
        _vm = State(initialValue: CourseDetailViewModel(courseId: courseId, courseSlug: courseSlug))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if let d = vm.detail {
                    detailBody(d)
                } else if let error = vm.error {
                    ErrorRetryView(message: error) { Task { await vm.load() } }
                        .padding(.top, 24)
                } else {
                    loadingSkeleton
                }
            }
        }
        .background(Studio.bg)
        .navigationTitle(navTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.detail == nil { await vm.load() } }
        .sheet(isPresented: $vm.showPaywall) {
            PaywallSheet(message: vm.paywallMessage)
                .presentationDetents([.medium])
        }
    }

    private var navTitle: String {
        vm.detail?.course.title ?? preview?.title ?? "课程"
    }

    // MARK: 封面头

    private var header: some View {
        let category = vm.detail?.course.category ?? preview?.category
        let title = vm.detail?.course.title ?? preview?.title
        let subtitle = vm.detail?.course.subtitle ?? preview?.subtitle
        let featured = vm.detail?.course.isFeatured ?? preview?.isFeatured ?? false
        return ZStack(alignment: .bottomLeading) {
            Studio.trackGradient(trackKey(category))
                .frame(height: 190)
            // 底部压暗，保证白字标题可读
            LinearGradient(
                colors: [.clear, .black.opacity(0.45)],
                startPoint: .center, endPoint: .bottom
            )
            .frame(height: 190)
            VStack(alignment: .leading, spacing: 8) {
                if featured {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill").font(.system(size: 9, weight: .bold))
                        Text("精选课程").font(.studio(11, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(.white.opacity(0.18))
                    .clipShape(Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(0.25), lineWidth: 1))
                }
                if let title {
                    Text(title)
                        .font(.studio(22, .bold))
                        .foregroundStyle(.white)
                        .lineLimit(3)
                }
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.studio(13))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                }
            }
            .padding(16)
        }
    }

    // MARK: 详情主体

    private func detailBody(_ d: CourseDetail) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            // 元信息行
            HStack(spacing: 14) {
                metaItem(icon: "signpost.right.fill", text: d.levelLabel ?? d.course.level)
                metaItem(icon: "clock.fill", text: d.durationText ?? CourseFormat.duration(d.course.totalDurationSec))
                metaItem(icon: "person.2.fill", text: "\(CourseFormat.learners(d.course.learnersCount)) 人在学")
            }
            .padding(.top, 16)

            // 简介
            if let desc = d.course.description, !desc.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("课程简介").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                    Text(desc).font(.studio(14)).foregroundStyle(Studio.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .studioCard()
            }

            // 大纲
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("课程大纲").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                    Spacer()
                    let freeCount = d.lessons.filter { $0.isFree }.count
                    if freeCount > 0 {
                        StatusBadge(text: "\(freeCount) 节免费试学", icon: "gift", tone: .ok)
                    }
                    Text("\(d.lessons.count) 节").font(.mono(12)).foregroundStyle(Studio.ink3)
                }
                if d.lessons.isEmpty {
                    Text("大纲整理中").font(.studio(13)).foregroundStyle(Studio.ink3)
                        .frame(maxWidth: .infinity).padding(.vertical, 20)
                } else {
                    VStack(spacing: 10) {
                        ForEach(Array(d.lessons.enumerated()), id: \.element.id) { idx, lesson in
                            lessonRow(lesson, index: idx + 1)
                                .opacity(reduceMotion || lessonsAppeared ? 1 : 0)
                                .offset(y: reduceMotion || lessonsAppeared ? 0 : 12)
                                .animation(reduceMotion ? nil : StudioMotion.smooth.delay(Double(idx) * 0.04),
                                           value: lessonsAppeared)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .studioCard()
            .onAppear {
                guard !lessonsAppeared else { return }
                withAnimation(reduceMotion ? nil : StudioMotion.smooth) { lessonsAppeared = true }
            }

            // 订阅说服门（有「不可访问」章节时出现；口径与行级解锁一致：canAccess 缺省退回 isFree）
            let lockedCount = d.lessons.filter { !($0.canAccess ?? $0.isFree) }.count
            if lockedCount > 0 {
                subscribeGate(lockedCount: lockedCount)
            }

            // 学员评价：真实评分聚合 + 列表 + 写评价入口（学过才可评）。
            // key 用真实课程 id（后端 id/slug 皆解析），登录态决定写入口可见性。
            CourseReviewsSection(
                courseKey: d.course.id,
                isLoggedIn: AuthManager.shared.isLoggedIn
            )
        }
        .padding(16)
    }

    // MARK: 订阅说服门

    private func subscribeGate(lockedCount: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(.white.opacity(0.14)).frame(width: 40, height: 40)
                    Image(systemName: "crown.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("订阅会员，畅学全部章节")
                        .font(.studio(16, .bold)).foregroundStyle(.white)
                    Text("解锁剩余 \(lockedCount) 节，配套笔记与复习卡一并开放")
                        .font(.studio(12)).foregroundStyle(.white.opacity(0.7))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            // 权益三点
            VStack(alignment: .leading, spacing: 8) {
                gateBenefit(icon: "checkmark.circle.fill", text: "全部章节无限回看")
                gateBenefit(icon: "checkmark.circle.fill", text: "AI 助学与要点笔记")
                gateBenefit(icon: "checkmark.circle.fill", text: "待复习卡片智能排期")
            }
            StudioButton(title: "去订阅", kind: .red, icon: "sparkles") {
                vm.promptPaywall()
            }
        }
        .padding(18)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func gateBenefit(icon: String, text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Studio.ok)
            Text(text).font(.studio(13)).foregroundStyle(.white.opacity(0.9))
        }
    }

    private func metaItem(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            // 中性 ink3 图标：红只留给 CTA / 试学信号，避免元信息喧宾夺主
            Image(systemName: icon).font(.system(size: 11)).foregroundStyle(Studio.ink3)
            Text(text).font(.studio(12, .semibold)).foregroundStyle(Studio.ink2)
        }
    }

    // MARK: 章节行

    @ViewBuilder
    private func lessonRow(_ lesson: CourseLesson, index: Int) -> some View {
        // 解锁判定以后端 canAccess 为准（订阅/买断等权益由服务端算好）；canAccess 缺省时退回 isFree。
        let unlocked = lesson.canAccess ?? lesson.isFree
        if unlocked {
            // 可访问章节（免费试学或已解锁）→ 直接进学习台
            NavigationLink { LearnView(lessonId: lesson.id) } label: {
                lessonRowContent(lesson, index: index, unlocked: true)
            }
            .buttonStyle(.plain)
            .simultaneousGesture(TapGesture().onEnded { Haptics.light() })
            .pressable(scale: 0.98, haptic: false)
        } else {
            // 不可访问章节 → 点击弹订阅引导（越权/解锁由后端保证）
            Button {
                Haptics.warning()
                vm.promptPaywall()
            } label: {
                lessonRowContent(lesson, index: index, unlocked: false)
            }
            .buttonStyle(.plain)
            .pressable(scale: 0.98, haptic: false)
        }
    }

    private func lessonRowContent(_ lesson: CourseLesson, index: Int, unlocked: Bool) -> some View {
        HStack(spacing: 12) {
            Text(String(format: "%02d", index))
                .font(.mono(13, .bold))
                .foregroundStyle(unlocked ? Studio.ink : Studio.ink4)
                .frame(width: 26, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(lesson.title)
                    .font(.studio(14, .semibold))
                    .foregroundStyle(unlocked ? Studio.ink : Studio.ink2)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 8) {
                    Text(CourseFormat.duration(lesson.durationSec))
                        .font(.mono(11))
                        .foregroundStyle(Studio.ink3)
                    if lesson.isFree {
                        // 试学是正向权益信号 → 语义绿徽章，弃裸红文字
                        StatusBadge(text: "免费试学", icon: "gift", tone: .ok)
                    }
                }
            }
            Spacer(minLength: 8)
            // 可访问=红播放键（关键行动信号），锁定=中性锁
            Image(systemName: unlocked ? "play.circle.fill" : "lock.fill")
                .font(.system(size: unlocked ? 22 : 15))
                .foregroundStyle(unlocked ? Studio.red : Studio.ink4)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                SkeletonBar(height: 14, width: 60)
                SkeletonBar(height: 14, width: 60)
                SkeletonBar(height: 14, width: 80)
            }
            SkeletonBar(height: 80).clipShape(RoundedRectangle(cornerRadius: 16))
            ForEach(0..<5, id: \.self) { _ in
                SkeletonBar(height: 44).clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(16)
        .padding(.top, 4)
    }
}

// MARK: - 订阅引导

struct PaywallSheet: View {
    @Environment(\.dismiss) private var dismiss
    var message: String?

    var body: some View {
        VStack(spacing: 20) {
            Capsule().fill(Studio.border2).frame(width: 40, height: 5).padding(.top, 10)
            Spacer(minLength: 0)
            // 深色展示 hero（videoGradient，弃平面红圆）
            ZStack {
                Circle().fill(Studio.videoGradient).frame(width: 72, height: 72)
                Circle().strokeBorder(.white.opacity(0.1), lineWidth: 1).frame(width: 72, height: 72)
                Image(systemName: "crown.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.white)
            }
            VStack(spacing: 8) {
                Text("解锁完整课程")
                    .font(.studio(20, .bold))
                    .foregroundStyle(Studio.ink)
                Text(message ?? "订阅会员即可畅学全部章节，继续你的学习计划。")
                    .font(.studio(14))
                    .foregroundStyle(Studio.ink2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
            }
            // 权益点：浮层内容用 L3 材质浮起，与 sheet 平面拉开层级。
            VStack(alignment: .leading, spacing: 10) {
                benefit(icon: "infinity", text: "全部章节无限回看")
                benefit(icon: "sparkles", text: "AI 助学与要点笔记")
                benefit(icon: "rectangle.stack.fill", text: "待复习卡片智能排期")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .studioCard(elevation: 3)
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                StudioButton(title: "去订阅", kind: .red, icon: "sparkles") {
                    // 订阅/充值入口由「我的」模块承载；此处先关闭引导层。
                    dismiss()
                }
                StudioButton(title: "暂不", kind: .ghost) { dismiss() }
            }
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Studio.surface)
    }

    private func benefit(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Studio.okSoft).frame(width: 28, height: 28)
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Studio.ok)
            }
            Text(text).font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
            Spacer(minLength: 0)
        }
    }
}
