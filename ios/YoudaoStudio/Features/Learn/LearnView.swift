import SwiftUI
import Observation
import AVKit

// MARK: - DTO

/// GET /api/lessons/[id] 的 data 是聚合对象（真值源 src/lib/queries.ts getLessonForUser）：
/// { snapshot, access, course, track, lesson, outline, prevLessonId, nextLessonId }。
/// 课时本体嵌在 `lesson`；`lesson` 里没有 courseId，课程归属取 `course.id`。
/// 仅声明 UI 需要的字段，其余后端字段忽略。可选性已按真实响应核对：
/// access / course / lesson / outline 恒存在；prevLessonId / nextLessonId 首末节为 null。
struct LessonAggregate: Decodable {
    /// 服务端访问判定。付费节无权益时为 false，且 videoUrl/articleMd/blocksJson 一律为 null。
    let access: Bool
    let course: CourseRef
    let lesson: LessonPayload
    let outline: [OutlineItem]
    let prevLessonId: String?
    let nextLessonId: String?

    /// 归属课程（后端返回完整 course 对象，此处仅取 id/title）。
    struct CourseRef: Decodable {
        let id: String
        let title: String
    }

    /// 章节本体（data.lesson）。summary/liveStartAt/subtitles 等未消费字段不声明。
    struct LessonPayload: Decodable {
        let id: String
        let title: String
        let contentType: Lesson.ContentType
        let durationSec: Int
        let isFree: Bool
        let videoUrl: String?
        let articleMd: String?
        let blocksJson: String?
    }

    /// 大纲项（可用于「上一节/下一节」等导航）。
    struct OutlineItem: Decodable, Identifiable {
        let id: String
        let title: String
        let isFree: Bool
        let durationSec: Int
        let current: Bool
    }
}

/// 学习台 UI 模型：由 LessonAggregate 平铺而来。
struct Lesson: Identifiable {
    let id: String
    let title: String
    let contentType: ContentType
    let durationSec: Int
    let isFree: Bool
    let videoUrl: String?
    let articleMd: String?
    let blocksJson: String?
    /// 归属课程 id（记笔记时上报；取自聚合响应的 course.id）。
    let courseId: String

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
            let agg = try await API.shared.get("/api/lessons/\(lessonId)", as: LessonAggregate.self)
            // 服务端判无权益：内容字段已被置空，直接走付费墙
            //（避免渲染空内容，更避免空文章把完课哨兵一并渲染出来误标完成）。
            guard agg.access else {
                needsPaywall = true
                return
            }
            let p = agg.lesson
            let l = Lesson(
                id: p.id,
                title: p.title,
                contentType: p.contentType,
                durationSec: p.durationSec,
                isFree: p.isFree,
                videoUrl: p.videoUrl,
                articleMd: p.articleMd,
                blocksJson: p.blocksJson,
                courseId: agg.course.id
            )
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
            // 课程归属来自聚合响应的 course.id（章节本体不含 courseId）。
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
            // Lazy：末尾完课哨兵只有真正滚到底部才被创建，避免首帧即标完成。
            LazyVStack(alignment: .leading, spacing: 16) {
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

// MARK: - ai_block（翻页 / 滚动 双模式）

/// 块课件学习模式：翻页（一屏一块，滑动手势前进）/ 滚动（连续纵向）。
/// 对齐 web 块课件翻页优化：iOS 用左右滑动手势翻页，保证一屏不需额外滚动。
private enum BlockReadMode: String, CaseIterable, Identifiable {
    case page = "翻页"
    case scroll = "滚动"
    var id: String { rawValue }
    var icon: String { self == .page ? "book.pages" : "list.bullet" }
}

private struct BlockLessonView: View {
    let lesson: Lesson
    let vm: LearnViewModel

    /// 默认翻页模式（对齐 web 块课件默认翻页体验）。
    @State private var mode: BlockReadMode = .page
    @State private var pageIndex = 0
    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if vm.blocks.isEmpty {
                ScrollView {
                    VStack(spacing: 14) {
                        LessonHeader(lesson: lesson, completed: vm.completed)
                        EmptyStateView(title: "暂无内容", icon: "square.stack.3d.up")
                    }
                    .padding(16)
                }
            } else {
                VStack(spacing: 0) {
                    // 顶部：章节头 + 模式切换（翻页/滚动）。
                    VStack(alignment: .leading, spacing: 12) {
                        LessonHeader(lesson: lesson, completed: vm.completed)
                        modeToggle
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 10)

                    if mode == .page { pager } else { scroller }
                }
            }
        }
        .onAppear { appeared = true }
    }

    // MARK: 模式切换条

    private var modeToggle: some View {
        HStack(spacing: 4) {
            ForEach(BlockReadMode.allCases) { m in
                let on = m == mode
                Button {
                    guard m != mode else { return }
                    Haptics.selection()
                    withAnimation(reduceMotion ? nil : StudioMotion.smooth) { mode = m }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: m.icon).font(.system(size: 11, weight: .semibold))
                        Text(m.rawValue).font(.studio(12.5, on ? .semibold : .medium))
                    }
                    .foregroundStyle(on ? Studio.ink : Studio.ink3)
                    .frame(maxWidth: .infinity, minHeight: 34)
                    .background {
                        if on {
                            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Studio.surface)
                                .shadow(color: .black.opacity(0.08), radius: 4, y: 1)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Studio.surfaceInset)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: 翻页模式（TabView .page，一屏一块，滑动前进）

    private var pager: some View {
        VStack(spacing: 10) {
            TabView(selection: $pageIndex) {
                ForEach(Array(vm.blocks.enumerated()), id: \.element.id) { idx, block in
                    ScrollView {
                        BlockCardView(block: block)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }
                    .tag(idx)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: pageIndex)
            // 翻到最后一页即视为读完（补完成触觉）。
            .onChange(of: pageIndex) { _, idx in
                if idx >= vm.blocks.count - 1 {
                    Task {
                        let was = vm.completed
                        await vm.markCompleted()
                        if !was, vm.completed { Haptics.success() }
                    }
                }
            }

            pagerFooter
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
        }
    }

    /// 页脚：进度点 + 上一/下一，配合滑动手势双通道翻页。
    private var pagerFooter: some View {
        HStack(spacing: 12) {
            Button {
                guard pageIndex > 0 else { return }
                Haptics.light()
                withAnimation(reduceMotion ? nil : StudioMotion.smooth) { pageIndex -= 1 }
            } label: {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(pageIndex > 0 ? Studio.ink : Studio.ink4)
                    .frame(width: 40, height: 40)
                    .background(Studio.surface).clipShape(Circle())
                    .overlay(Circle().strokeBorder(Studio.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(pageIndex <= 0)

            // 进度点（>12 块退化为「n / total」文案，避免点过密）。
            if vm.blocks.count <= 12 {
                HStack(spacing: 5) {
                    ForEach(0..<vm.blocks.count, id: \.self) { i in
                        Circle()
                            .fill(i == pageIndex ? Studio.red : Studio.border2)
                            .frame(width: i == pageIndex ? 7 : 5, height: i == pageIndex ? 7 : 5)
                            .animation(reduceMotion ? nil : StudioMotion.pop, value: pageIndex)
                    }
                }
                .frame(maxWidth: .infinity)
            } else {
                Text("\(pageIndex + 1) / \(vm.blocks.count)")
                    .font(.mono(12, .semibold)).foregroundStyle(Studio.ink2)
                    .frame(maxWidth: .infinity)
            }

            Button {
                guard pageIndex < vm.blocks.count - 1 else { return }
                Haptics.light()
                withAnimation(reduceMotion ? nil : StudioMotion.smooth) { pageIndex += 1 }
            } label: {
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(pageIndex < vm.blocks.count - 1 ? .white : Studio.ink4)
                    .frame(width: 40, height: 40)
                    .background(pageIndex < vm.blocks.count - 1 ? Studio.red : Studio.surface2)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(pageIndex < vm.blocks.count - 1 ? Color.clear : Studio.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(pageIndex >= vm.blocks.count - 1)
        }
    }

    // MARK: 滚动模式（连续纵向，保留原交错进场）

    private var scroller: some View {
        ScrollView {
            // Lazy：末尾完课哨兵只有真正滚到底部才被创建，避免首帧即标完成。
            LazyVStack(alignment: .leading, spacing: 14) {
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
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
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
