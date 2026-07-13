// Mac 课程详情（NavigationSplitView 的 Detail 列）。复用 GET /api/courses/[id] 聚合响应。
//
// Features/Courses/CourseDetailView.swift 的 CourseDetail / CourseLesson DTO 在 Features/ 目录
// （已从 Mac target 排除），故此处建等价 Decodable + @Observable VM，打同一 /api/courses/[id]。
// 详情接口是聚合结构：课程本体在 `course`，展示用大纲（含 canAccess）在顶层 `lessons`。
//
// 解锁判定与 iOS 一致：canAccess ?? isFree。可访问的节 → openWindow(id:"player", value: lessonId)
// 开独立播放器窗；锁定的节 → 弹付费墙提示（inline，不用 iOS 的 sheet/detents）。
#if os(macOS)
import SwiftUI
import Observation

// MARK: - DTO（对齐 GET /api/courses/[id] 真实响应）

/// GET /api/courses/[id] → { course, snapshot, categoryLabel, levelLabel, durationText, lessons, updateLogs }。
struct MacCourseDetail: Decodable, Equatable {
    let course: MacCourseDetailCore
    /// 展示用大纲（含 canAccess 访问判定）；course 本体不再嵌套章节，避免付费内容泄漏。
    let lessons: [MacCourseLesson]
    let categoryLabel: String?
    let levelLabel: String?
    let durationText: String?
}

/// 课程本体（详情接口 `course` 字段）。仅声明 UI 需要的字段。
struct MacCourseDetailCore: Decodable, Equatable {
    let id: String
    let slug: String
    let title: String
    let subtitle: String?
    let description: String?
    let category: String
    let level: String
    let coverColor: String
    let totalDurationSec: Int
    let learnersCount: Int
    let isFeatured: Bool
}

/// 展示用大纲章节（顶层 lessons 项）。
struct MacCourseLesson: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let durationSec: Int
    let isFree: Bool
    let summary: String?
    let contentType: String?
    /// 当前用户是否可访问（后端解锁判定，可选）。缺省时退回 isFree。
    let canAccess: Bool?
}

// MARK: - ViewModel

@Observable @MainActor
final class MacCourseDetailViewModel {
    var detail: MacCourseDetail?
    var error: String?
    var loading = false

    /// 付费提示（点击锁定章节触发；Mac 端用 inline 条而非 sheet）。
    var showPaywall = false

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
            detail = try await API.shared.get("/api/courses/\(encoded)", as: MacCourseDetail.self)
        } catch let apiErr as APIError {
            // 404 且用 id 拉失败时，退回 slug 再试一次。
            if case .notFound = apiErr, !courseSlug.isEmpty, key != courseSlug {
                let s = courseSlug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? courseSlug
                do {
                    detail = try await API.shared.get("/api/courses/\(s)", as: MacCourseDetail.self)
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
}

// MARK: - View

/// Mac 课程详情：课程头（赛道渐变）+ 元信息 + 简介 + 大纲。
/// 可访问的节 → openWindow 开独立播放器窗；锁定的节 → 弹付费墙。
struct MacCourseDetailView: View {
    @State private var vm: MacCourseDetailViewModel
    /// 从列表进入：已有 MacCourse 摘要，先渲染封面/标题避免白屏。
    private let preview: MacCourse?
    @Environment(\.openWindow) private var openWindow

    init(course: MacCourse) {
        self.preview = course
        _vm = State(initialValue: MacCourseDetailViewModel(courseId: course.id, courseSlug: course.slug))
    }

    init(courseId: String, courseSlug: String) {
        self.preview = nil
        _vm = State(initialValue: MacCourseDetailViewModel(courseId: courseId, courseSlug: courseSlug))
    }

    private func trackKey(_ category: String?) -> String? { MacCourseFormat.trackKey(category) }

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
            .frame(maxWidth: 860)
            .frame(maxWidth: .infinity)
        }
        .background(Studio.bg)
        .navigationTitle(vm.detail?.course.title ?? preview?.title ?? "课程")
        // id 变化（切换课程）时重拉。preview 进入用 .task 首拉。
        .task(id: vm.courseId) { await vm.load() }
    }

    // MARK: 封面头

    private var header: some View {
        let category = vm.detail?.course.category ?? preview?.category
        let title = vm.detail?.course.title ?? preview?.title
        let subtitle = vm.detail?.course.subtitle ?? preview?.subtitle
        let featured = vm.detail?.course.isFeatured ?? preview?.isFeatured ?? false
        return ZStack(alignment: .bottomLeading) {
            Studio.trackGradient(trackKey(category))
                .frame(height: 200)
            LinearGradient(colors: [.clear, .black.opacity(0.45)], startPoint: .center, endPoint: .bottom)
                .frame(height: 200)
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
                    Text(title).font(.studio(24, .bold)).foregroundStyle(.white).lineLimit(3)
                }
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.studio(14)).foregroundStyle(.white.opacity(0.9)).lineLimit(2)
                }
            }
            .padding(20)
        }
    }

    // MARK: 详情主体

    private func detailBody(_ d: MacCourseDetail) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 16) {
                metaItem(icon: "signpost.right.fill", text: d.levelLabel ?? d.course.level)
                metaItem(icon: "clock.fill", text: d.durationText ?? MacCourseFormat.duration(d.course.totalDurationSec))
                metaItem(icon: "person.2.fill", text: "\(MacCourseFormat.learners(d.course.learnersCount)) 人在学")
            }
            .padding(.top, 18)

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
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .studioCard()

            // 订阅说服门（有锁定节时出现；口径与行级一致：canAccess ?? isFree）
            let lockedCount = d.lessons.filter { !($0.canAccess ?? $0.isFree) }.count
            if lockedCount > 0 {
                subscribeGate(lockedCount: lockedCount)
            }

            // 付费提示条（点击锁定节触发；inline 出现，可关闭）。
            if vm.showPaywall {
                paywallNotice
            }
        }
        .padding(20)
    }

    // MARK: 章节行

    @ViewBuilder
    private func lessonRow(_ lesson: MacCourseLesson, index: Int) -> some View {
        // 解锁判定以后端 canAccess 为准；缺省退回 isFree。
        let unlocked = lesson.canAccess ?? lesson.isFree
        Button {
            if unlocked {
                Haptics.light()
                // 独立播放器窗：value 注入 lessonId，多开互不串状态。
                openWindow(id: "player", value: lesson.id)
            } else {
                Haptics.warning()
                withAnimation(StudioMotion.smooth) { vm.showPaywall = true }
            }
        } label: {
            lessonRowContent(lesson, index: index, unlocked: unlocked)
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.98, haptic: false)
    }

    private func lessonRowContent(_ lesson: MacCourseLesson, index: Int, unlocked: Bool) -> some View {
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
                    Text(MacCourseFormat.duration(lesson.durationSec))
                        .font(.mono(11)).foregroundStyle(Studio.ink3)
                    if let ct = lesson.contentType {
                        Label(contentTypeLabel(ct), systemImage: contentTypeIcon(ct))
                            .font(.mono(10)).foregroundStyle(Studio.ink3)
                            .labelStyle(.titleAndIcon)
                    }
                    if lesson.isFree {
                        StatusBadge(text: "免费试学", icon: "gift", tone: .ok)
                    }
                }
            }
            Spacer(minLength: 8)
            // 可访问=红播放键，锁定=中性锁
            Image(systemName: unlocked ? "play.circle.fill" : "lock.fill")
                .font(.system(size: unlocked ? 22 : 15))
                .foregroundStyle(unlocked ? Studio.red : Studio.ink4)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .contentShape(Rectangle())
    }

    private func contentTypeLabel(_ ct: String) -> String {
        switch ct {
        case "video": "视频"
        case "article": "图文"
        case "ai_block": "块课件"
        case "live": "直播"
        default: ct
        }
    }
    private func contentTypeIcon(_ ct: String) -> String {
        switch ct {
        case "video": "play.rectangle"
        case "article": "doc.text"
        case "ai_block": "square.stack.3d.up"
        case "live": "dot.radiowaves.left.and.right"
        default: "book"
        }
    }

    // MARK: 订阅说服门

    private func subscribeGate(lockedCount: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(.white.opacity(0.14)).frame(width: 40, height: 40)
                    Image(systemName: "crown.fill")
                        .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("订阅会员，畅学全部章节").font(.studio(16, .bold)).foregroundStyle(.white)
                    Text("解锁剩余 \(lockedCount) 节，配套笔记与复习卡一并开放")
                        .font(.studio(12)).foregroundStyle(.white.opacity(0.7))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 8) {
                gateBenefit("全部章节无限回看")
                gateBenefit("AI 助学与要点笔记")
                gateBenefit("待复习卡片智能排期")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func gateBenefit(_ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.ok)
            Text(text).font(.studio(13)).foregroundStyle(.white.opacity(0.9))
        }
    }

    // MARK: 付费提示条（inline）

    private var paywallNotice: some View {
        HStack(spacing: 12) {
            Image(systemName: "lock.fill")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Studio.redInk)
            VStack(alignment: .leading, spacing: 2) {
                Text("该章节需要订阅解锁").font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
                Text("开通会员即可畅学全部章节。").font(.studio(12)).foregroundStyle(Studio.ink3)
            }
            Spacer(minLength: 0)
            Button {
                withAnimation(StudioMotion.smooth) { vm.showPaywall = false }
            } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Studio.ink3)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.redSoft)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
            .strokeBorder(Studio.redSoftBorder, lineWidth: 1))
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func metaItem(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11)).foregroundStyle(Studio.ink3)
            Text(text).font(.studio(12, .semibold)).foregroundStyle(Studio.ink2)
        }
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                SkeletonBar(height: 14, width: 60)
                SkeletonBar(height: 14, width: 60)
                SkeletonBar(height: 14, width: 80)
            }
            SkeletonBar(height: 80).clipShape(RoundedRectangle(cornerRadius: 16))
            ForEach(0..<5, id: \.self) { _ in
                SkeletonBar(height: 48).clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(20)
        .padding(.top, 4)
    }
}
#endif
