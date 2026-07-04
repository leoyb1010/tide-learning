import SwiftUI
import Observation
import AVKit

// MARK: - DTO

/// GET /api/lessons/[id] 返回的章节。字段对齐后端 camelCase。
struct Lesson: Decodable, Identifiable {
    let id: String
    let title: String
    let contentType: ContentType
    let durationSec: Int
    let isFree: Bool
    let videoUrl: String?
    let articleMd: String?
    let blocksJson: String?
    /// 归属课程（记笔记时上报 courseId；后端可能返回，缺省兜底空串）。
    let courseId: String?

    enum ContentType: String, Decodable {
        case video, article, ai_block
        /// 未知类型兜底为 article（避免 decode 直接失败）。
        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = ContentType(rawValue: raw) ?? .article
        }
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class LearnViewModel {
    let lessonId: String

    var lesson: Lesson?
    var error: String?
    var loading = false
    var needsPaywall = false

    /// 解析后的 ai_block 内容。
    var blocks: [Block] = []

    /// 进度秒数（video 由播放器回调更新；article/block 到底部即视为完成）。
    var progressSec = 0
    var completed = false

    private var lastReported = -1

    init(lessonId: String) {
        self.lessonId = lessonId
    }

    func load() async {
        loading = true; error = nil; needsPaywall = false
        defer { loading = false }
        do {
            let l = try await API.shared.get("/api/lessons/\(lessonId)", as: Lesson.self)
            lesson = l
            if l.contentType == .ai_block {
                blocks = BlockDocument.parse(l.blocksJson).blocks
            }
        } catch let e as APIError {
            if e.needsPaywall { needsPaywall = true }
            error = e.errorDescription ?? "加载失败"
        } catch {
            self.error = "加载失败"
        }
    }

    // MARK: 进度上报

    struct ProgressBody: Encodable {
        let lessonId: String
        let progressSec: Int
        let completed: Bool
    }

    /// 上报进度。去抖：秒数相同且完成状态未变则跳过。写失败静默（不打断学习）。
    func reportProgress() async {
        let snapshot = progressSec
        guard snapshot != lastReported || completed else { return }
        lastReported = snapshot
        let body = ProgressBody(lessonId: lessonId, progressSec: snapshot, completed: completed)
        _ = try? await API.shared.post("/api/progress", body: body, as: EmptyResponse.self)
    }

    /// 标记完成并立即上报（article/block 滚动到底部时调用）。
    func markCompleted() async {
        guard !completed else { return }
        completed = true
        await reportProgress()
    }

    // MARK: 笔记

    struct NoteBody: Encodable {
        let courseId: String
        let lessonId: String
        let contentMd: String
        let kind: String
    }

    /// 保存笔记。成功返回 true，失败把错误文案回给调用方展示。
    func saveNote(_ contentMd: String) async -> String? {
        let trimmed = contentMd.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "笔记内容不能为空" }
        let body = NoteBody(
            courseId: lesson?.courseId ?? "",
            lessonId: lessonId,
            contentMd: trimmed,
            kind: "text"
        )
        do {
            _ = try await API.shared.post("/api/notes", body: body, as: EmptyResponse.self)
            return nil
        } catch let e as APIError {
            return e.errorDescription ?? "保存失败"
        } catch {
            return "保存失败"
        }
    }
}

// MARK: - View

/// 学习台。进入拉章节，按 contentType 渲染三种内容，底部记笔记，出现/离开上报进度。
struct LearnView: View {
    @State private var vm: LearnViewModel
    @State private var showNoteSheet = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(lessonId: String) {
        _vm = State(initialValue: LearnViewModel(lessonId: lessonId))
    }

    var body: some View {
        Group {
            if let lesson = vm.lesson {
                content(lesson)
                    .transition(.opacity)
            } else if vm.needsPaywall {
                paywall
            } else if let error = vm.error {
                ErrorRetryView(message: error) { Task { await vm.load() } }
            } else {
                loadingSkeleton
            }
        }
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.lesson?.id)
        .background(Studio.bg)
        .navigationTitle(vm.lesson?.title ?? "学习")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                if vm.lesson != nil {
                    StudioButton(title: "记笔记", kind: .red, icon: "square.and.pencil") {
                        showNoteSheet = true
                    }
                }
            }
        }
        .sheet(isPresented: $showNoteSheet) {
            NoteEditorSheet { text in await vm.saveNote(text) }
        }
        .task { if vm.lesson == nil { await vm.load() } }
        .onDisappear { Task { await vm.reportProgress() } }
    }

    // MARK: 内容分发

    @ViewBuilder
    private func content(_ lesson: Lesson) -> some View {
        switch lesson.contentType {
        case .video:
            VideoLessonView(lesson: lesson, vm: vm)
        case .article:
            ArticleLessonView(lesson: lesson, vm: vm)
        case .ai_block:
            BlockLessonView(lesson: lesson, vm: vm)
        }
    }

    // MARK: 付费墙

    private var paywall: some View {
        EmptyStateView(
            title: "需要订阅",
            subtitle: vm.error ?? "开通会员即可解锁本章节",
            icon: "lock.fill",
            actionTitle: "去订阅"
        ) {
            // 订阅入口由 Profile/付费模块承接，此处仅占位跳转信号。
        }
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SkeletonBar(height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
                SkeletonBar(height: 22, width: 220)
                HStack(spacing: 8) {
                    SkeletonBar(height: 14, width: 70)
                    SkeletonBar(height: 14, width: 60)
                }
                SkeletonBar(height: 14)
                SkeletonBar(height: 14)
                SkeletonBar(height: 14, width: 260)
            }
            .padding(16)
        }
    }
}

// MARK: - video

private struct VideoLessonView: View {
    let lesson: Lesson
    let vm: LearnViewModel

    @State private var player: AVPlayer?
    @State private var timeObserver: Any?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 观看水位（0…1）。纯展示，读 vm 只读值，不改进度逻辑。
    private var progressFraction: Double {
        guard lesson.durationSec > 0 else { return 0 }
        return min(1, max(0, Double(vm.progressSec) / Double(lesson.durationSec)))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Group {
                    if let player {
                        VideoPlayer(player: player)
                            .aspectRatio(16.0 / 9.0, contentMode: .fit)
                    } else {
                        // 深色沉浸展示区：用 videoGradient 立体质感，弃死黑平面。
                        ZStack {
                            Studio.videoGradient
                            VStack(spacing: 8) {
                                Image(systemName: "play.slash.fill")
                                    .font(.system(size: 30)).foregroundStyle(.white.opacity(0.72))
                                Text("视频暂不可用").font(.studio(13)).foregroundStyle(.white.opacity(0.72))
                            }
                        }
                        .aspectRatio(16.0 / 9.0, contentMode: .fit)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                        .strokeBorder(Studio.border, lineWidth: 1)
                )

                // 观看进度水位条：完成后转绿并显示已完成徽章。
                progressTrack

                LessonHeader(lesson: lesson, completed: vm.completed)
            }
            .padding(16)
        }
        .onAppear { setup() }
        .onDisappear { teardown() }
    }

    @ViewBuilder
    private var progressTrack: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("观看进度").font(.mono(11, .semibold)).foregroundStyle(Studio.ink3)
                Spacer()
                if vm.completed {
                    StatusBadge(text: "已完成", icon: "checkmark", tone: .ok)
                } else {
                    Text("\(Int(progressFraction * 100))%")
                        .font(.mono(11, .semibold)).foregroundStyle(Studio.ink2)
                        .contentTransition(.numericText())
                }
            }
            ProgressTrack(fraction: vm.completed ? 1 : progressFraction, done: vm.completed)
        }
        .studioCard(padding: 14, elevation: 1)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: progressFraction)
        .animation(reduceMotion ? nil : StudioMotion.pop, value: vm.completed)
    }

    private func setup() {
        guard player == nil,
              let urlString = lesson.videoUrl,
              let url = URL(string: urlString) else { return }
        let p = AVPlayer(url: url)
        // 每 5 秒采样一次播放进度上报。
        let interval = CMTime(seconds: 5, preferredTimescale: 1)
        timeObserver = p.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            let secs = Int(time.seconds.isFinite ? time.seconds : 0)
            let total = p.currentItem?.duration.seconds ?? 0
            Task { @MainActor in
                vm.progressSec = secs
                if total.isFinite, total > 0, Double(secs) >= total - 1 {
                    // 首次看完补 success 触觉，与 article/block 完课体验对齐。
                    let was = vm.completed
                    await vm.markCompleted()
                    if !was, vm.completed { Haptics.success() }
                } else {
                    await vm.reportProgress()
                }
            }
        }
        player = p
    }

    private func teardown() {
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        player?.pause()
        player = nil
    }
}

// MARK: - 进度水位条

/// 观看进度水位：渐变填充 + 顶部高光，完成时转 ok 绿。纯展示。
private struct ProgressTrack: View {
    let fraction: Double
    var done: Bool = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Studio.surfaceInset)
                Capsule()
                    .fill(fillStyle)
                    .frame(width: max(6, geo.size.width * clampedFraction))
                    .overlay(alignment: .top) {
                        // 水位顶部高光，营造液面厚度。
                        Capsule()
                            .fill(Color.white.opacity(0.22))
                            .frame(height: 2)
                            .padding(.horizontal, 3)
                            .padding(.top, 1)
                    }
            }
        }
        .frame(height: 8)
    }

    private var clampedFraction: Double { min(1, max(0, fraction)) }

    private var fillStyle: LinearGradient {
        if done {
            return LinearGradient(colors: [Studio.ok, Studio.ok.opacity(0.82)],
                                  startPoint: .leading, endPoint: .trailing)
        }
        return LinearGradient(colors: [Studio.red, Studio.redHover],
                              startPoint: .leading, endPoint: .trailing)
    }
}

// MARK: - article

private struct ArticleLessonView: View {
    let lesson: Lesson
    let vm: LearnViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                LessonHeader(lesson: lesson, completed: vm.completed)

                if let md = lesson.articleMd, !md.isEmpty {
                    Text(articleMarkdown(md))
                        .font(.studio(16))
                        .foregroundStyle(Studio.ink)
                        .lineSpacing(6)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .studioCard(padding: 18, elevation: 1)
                } else {
                    EmptyStateView(title: "暂无正文", icon: "doc.text")
                }

                // 到底部标记：出现即视为读完。逻辑不变，仅补完成触觉。
                Color.clear.frame(height: 1)
                    .onAppear {
                        Task {
                            let was = vm.completed
                            await vm.markCompleted()
                            if !was, vm.completed { Haptics.success() }
                        }
                    }
            }
            .padding(16)
        }
    }

    /// 文章级 Markdown：完整语法（含标题/列表按块解析）。失败退化纯文本。
    private func articleMarkdown(_ s: String) -> AttributedString {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .full)) {
            return a
        }
        return AttributedString(s)
    }
}

// MARK: - ai_block

private struct BlockLessonView: View {
    let lesson: Lesson
    let vm: LearnViewModel

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LessonHeader(lesson: lesson, completed: vm.completed)

                if vm.blocks.isEmpty {
                    EmptyStateView(title: "暂无内容", icon: "square.stack.3d.up")
                } else {
                    ForEach(Array(vm.blocks.enumerated()), id: \.element.id) { idx, block in
                        BlockCardView(block: block)
                            .opacity(appeared || reduceMotion ? 1 : 0)
                            .offset(y: appeared || reduceMotion ? 0 : 14)
                            .animation(
                                reduceMotion ? nil
                                : StudioMotion.smooth.delay(Double(min(idx, 8)) * 0.05),
                                value: appeared
                            )
                    }
                    Color.clear.frame(height: 1)
                        .onAppear {
                            Task {
                                let was = vm.completed
                                await vm.markCompleted()
                                if !was, vm.completed { Haptics.success() }
                            }
                        }
                }
            }
            .padding(16)
        }
        .onAppear { appeared = true }
    }
}

// MARK: - 章节头

private struct LessonHeader: View {
    let lesson: Lesson
    var completed: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(lesson.title).font(.studio(20, .bold)).foregroundStyle(Studio.ink)
            HStack(spacing: 8) {
                Label(durationText, systemImage: "clock")
                    .font(.mono(11)).foregroundStyle(Studio.ink3)
                    .labelStyle(.titleAndIcon)
                if lesson.isFree {
                    StatusBadge(text: "免费试看", icon: "gift.fill", tone: .info)
                }
                if completed {
                    StatusBadge(text: "已完成", icon: "checkmark", tone: .ok)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : StudioMotion.pop, value: completed)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private var durationText: String {
        let m = lesson.durationSec / 60
        let s = lesson.durationSec % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - 记笔记 Sheet

private struct NoteEditorSheet: View {
    /// 返回错误文案；nil 表示保存成功。
    let onSave: (String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextEditor(text: $text)
                    .font(.studio(16))
                    .foregroundStyle(Studio.ink)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(Studio.surface)
                    .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                        .strokeBorder(focused ? Studio.border2 : Studio.border, lineWidth: 1))
                    .overlay(alignment: .topLeading) {
                        if text.isEmpty {
                            Text("写下你的想法…")
                                .font(.studio(16)).foregroundStyle(Studio.ink4)
                                .padding(.horizontal, 17).padding(.vertical, 20)
                                .allowsHitTesting(false)
                        }
                    }
                    .focused($focused)
                    .animation(reduceMotion ? nil : StudioMotion.quick, value: focused)
                    .frame(minHeight: 180)

                if let error {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 12, weight: .semibold))
                        Text(error).font(.studio(12, .semibold))
                    }
                    .foregroundStyle(Studio.redInk)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Studio.redSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Studio.redSoftBorder, lineWidth: 1))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                StudioButton(title: "保存笔记", kind: .red, icon: "checkmark", loading: saving) {
                    Task { await save() }
                }
                Spacer()
            }
            .padding(16)
            .background(Studio.bg)
            .animation(reduceMotion ? nil : StudioMotion.quick, value: error)
            .navigationTitle("记笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }.foregroundStyle(Studio.ink3)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(StudioRadius.cardLg)
    }

    private func save() async {
        saving = true; error = nil
        defer { saving = false }
        if let msg = await onSave(text) {
            error = msg
            Haptics.error()
        } else {
            Haptics.success()
            dismiss()
        }
    }
}
