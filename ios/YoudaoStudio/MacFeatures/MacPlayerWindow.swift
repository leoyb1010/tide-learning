// Mac 独立播放器窗（openWindow(id:"player", value: lessonId) 打开）。复用 GET /api/lessons/[id] 聚合响应。
//
// Features/Learn/LearnView.swift 的 LessonAggregate / Lesson / Block DTO 均在 Features/ 目录
// （整目录已从 Mac target 排除，含 iOS-only API），故此处建等价 Decodable + @Observable VM，
// 打同一 /api/lessons/[id]，走同一 APIEnvelope。字段严格对齐后端真实响应（已 curl 核对）：
//   顶层 { snapshot, access:Bool, course, track, lesson, outline, prevLessonId?, nextLessonId? }
//   lesson: { id, title, contentType(String), durationSec:Int, isFree:Bool,
//             videoUrl:String?, articleMd:String?, blocksJson:String? }
//   access==true 且有权时 videoUrl/articleMd/blocksJson 才有值；付费无权则均为 null 且 access==false。
//
// 三态内容渲染：
//   video    → AVKit 的 VideoPlayer(player:)（macOS 可用）。相对 videoUrl 对 apiBaseURL 解析成绝对地址。
//   article  → articleMd 用 Text(.init(md)) 走 Markdown 渲染。
//   ai_block → 解析 blocksJson（JSON 字符串），取每块主要文字 .studioCard() 竖排展示。
// access==false → 付费墙提示（复用 EmptyStateView）。
//
// 进度上报：视频每 5s 采样 + onDisappear 补报 → POST /api/progress {lessonId, progressSec, completed}
//   （后端契约字段：completed:Bool，非 completedSec；见 src/app/api/progress/route.ts）。
// 快捷键：⌘↩ 标记完成（completed=true，progressSec 置为 durationSec）；⌘←/⌘→ 用 prev/nextLessonId 切节（reload 当前 vm）。
#if os(macOS)
import SwiftUI
import Observation
import AVKit

// MARK: - DTO（对齐 GET /api/lessons/[id] 真实响应，等价 iOS LessonAggregate）

/// GET /api/lessons/[id] → { snapshot, access, course, track, lesson, outline, prevLessonId?, nextLessonId? }。
/// 仅声明 UI 需要的字段；access/course/lesson/outline 恒存在，prevLessonId/nextLessonId 首末节为 null。
struct MacLessonAggregate: Decodable {
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

    /// 章节本体（data.lesson）。contentType 用 String（Mac 端不引 Lesson.ContentType 枚举）。
    struct LessonPayload: Decodable {
        let id: String
        let title: String
        let contentType: String
        let durationSec: Int
        let isFree: Bool
        let videoUrl: String?
        let articleMd: String?
        let blocksJson: String?
    }

    /// 大纲项（当前实现暂不消费，保留结构以对齐响应；可后续用于窗内目录）。
    struct OutlineItem: Decodable, Identifiable {
        let id: String
        let title: String
        let isFree: Bool
        let durationSec: Int
        let current: Bool
    }
}

// MARK: - ai_block 解析（等价 iOS BlockDocument，Mac 端本地建）

/// blocksJson 顶层结构：{ version, blocks: [...] }。每块 type 决定主要文字取哪个字段。
struct MacBlockDocument {
    let blocks: [MacBlock]

    /// 从 blocksJson 字符串解析。解析失败（脏 JSON）返回空文档，UI 走空态。
    static func parse(_ json: String?) -> MacBlockDocument {
        guard let json, let data = json.data(using: .utf8) else { return .init(blocks: []) }
        do {
            let raw = try JSONDecoder().decode(RawDoc.self, from: data)
            return .init(blocks: raw.blocks.map(MacBlock.init(raw:)))
        } catch {
            return .init(blocks: [])
        }
    }

    private struct RawDoc: Decodable { let blocks: [RawBlock] }

    /// 块原始 JSON：字段随 type 变化，全声明为可选，取时按 type 兜底。
    struct RawBlock: Decodable {
        let id: String?
        let type: String
        let title: String?
        let markdown: String?
        let items: [String]?
        let points: [String]?
        let caption: String?
        let question: String?
        let front: String?
        let back: String?
    }
}

/// UI 用块模型：把不同 type 的主要文字抽成统一的 heading + body（竖排展示，不复刻富样式）。
struct MacBlock: Identifiable {
    let id: String
    let type: String
    /// 块类型标签（scene/概念/要点/测验…）。
    let kindLabel: String
    /// 块内小标题（可空）。
    let heading: String?
    /// 块主要正文（多行拼好）。
    let body: String

    init(raw: MacBlockDocument.RawBlock) {
        id = raw.id ?? UUID().uuidString
        type = raw.type
        kindLabel = MacBlock.label(for: raw.type)
        heading = raw.title
        body = MacBlock.body(for: raw)
    }

    /// type → 中文标签。
    private static func label(for type: String) -> String {
        switch type {
        case "scene": "情境"
        case "objectives": "学习目标"
        case "concept": "概念"
        case "image": "图解"
        case "keypoint": "要点"
        case "compare": "对比"
        case "quiz": "小测"
        case "flashcard": "记忆卡"
        case "summary": "小结"
        default: type
        }
    }

    /// 取每块主要文字：markdown / items / points / question / front-back / caption 依次兜底。
    private static func body(for raw: MacBlockDocument.RawBlock) -> String {
        if let md = raw.markdown, !md.isEmpty { return md }
        if let items = raw.items, !items.isEmpty { return items.map { "· \($0)" }.joined(separator: "\n") }
        if let points = raw.points, !points.isEmpty { return points.map { "· \($0)" }.joined(separator: "\n") }
        if let q = raw.question, !q.isEmpty { return q }
        if let front = raw.front {
            let back = raw.back.map { "\n\($0)" } ?? ""
            return "\(front)\(back)"
        }
        if let caption = raw.caption, !caption.isEmpty { return caption }
        return ""
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class PlayerWindowViewModel {
    var aggregate: MacLessonAggregate?
    var blocks: [MacBlock] = []
    var error: String?
    var loading = false

    /// 当前进度秒数（视频播放回调更新；article/block 到底部视为完成）。
    var progressSec = 0
    /// 完成态（⌘↩ 或视频看完置真）。
    var completed = false

    /// 去抖用：上次上报的秒数。
    private var lastReported = -1

    /// 当前节 id（⌘←/⌘→ 切节时替换后 reload）。
    private(set) var lessonId: String

    init(lessonId: String) {
        self.lessonId = lessonId
    }

    /// 拉 GET /api/lessons/[id]，解码 MacLessonAggregate；ai_block 顺带解析 blocksJson。
    func load() async {
        loading = true; error = nil
        defer { loading = false }
        let encoded = lessonId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? lessonId
        do {
            let agg = try await API.shared.get("/api/lessons/\(encoded)", as: MacLessonAggregate.self)
            aggregate = agg
            // 切节后进度/完成态重置，避免旧节状态串到新节。
            progressSec = 0
            completed = false
            lastReported = -1
            if agg.lesson.contentType == "ai_block" {
                blocks = MacBlockDocument.parse(agg.lesson.blocksJson).blocks
            } else {
                blocks = []
            }
        } catch let apiErr as APIError {
            self.error = apiErr.errorDescription ?? "加载失败"
        } catch {
            self.error = "加载失败"
        }
    }

    /// 切到 prev/next 节：替换 lessonId 后重拉，窗口复用（不新开）。
    func switchTo(_ newLessonId: String?) async {
        guard let newLessonId, !newLessonId.isEmpty else { return }
        lessonId = newLessonId
        await load()
    }

    // MARK: 进度上报（等价 iOS，字段 completed:Bool 对齐后端契约）

    struct ProgressBody: Encodable {
        let lessonId: String
        let progressSec: Int
        let completed: Bool
    }

    /// 上报进度。去抖：秒数相同且未完成则跳过。写失败静默（不打断学习）。
    func reportProgress() async {
        let snapshot = progressSec
        guard snapshot != lastReported || completed else { return }
        lastReported = snapshot
        let body = ProgressBody(lessonId: lessonId, progressSec: snapshot, completed: completed)
        _ = try? await API.shared.post("/api/progress", body: body, as: EmptyResponse.self)
    }

    /// ⌘↩ 标记完成：completed 置真、progressSec 拉满到 durationSec，立即上报。
    func markCompleted() async {
        guard let agg = aggregate, !completed else { return }
        completed = true
        progressSec = max(progressSec, agg.lesson.durationSec)
        await reportProgress()
    }

    /// 把相对 videoUrl（如 /videos/...）解析成对 apiBaseURL 的绝对地址；已是绝对地址则原样返回。
    func absoluteVideoURL() -> URL? {
        guard let raw = aggregate?.lesson.videoUrl, !raw.isEmpty else { return nil }
        if let abs = URL(string: raw), abs.scheme != nil { return abs }
        return URL(string: raw, relativeTo: URL(string: AppConfig.apiBaseURL))?.absoluteURL
    }
}

// MARK: - View（独立播放器窗）

/// Mac 独立播放器窗：接收 lessonId，三态内容（video/article/ai_block）+ 付费墙 + 进度上报 + 快捷键切节。
struct MacPlayerWindow: View {
    @State private var vm: PlayerWindowViewModel

    init(lessonId: String) {
        _vm = State(initialValue: PlayerWindowViewModel(lessonId: lessonId))
    }

    var body: some View {
        Group {
            if let agg = vm.aggregate {
                loaded(agg)
            } else if let error = vm.error {
                ErrorRetryView(message: error) { Task { await vm.load() } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                loadingSkeleton
            }
        }
        .frame(minWidth: 640, minHeight: 480)
        .background(Studio.bg)
        .navigationTitle(vm.aggregate?.lesson.title ?? "播放器")
        // id 变化（切换节）时重拉；首次进入也走这里。
        .task(id: vm.lessonId) { await vm.load() }
        // 离窗补报一次进度（视频 5s 采样之外的兜底）。
        .onDisappear { Task { await vm.reportProgress() } }
        // ⌘↩ 完成、⌘← 上一节、⌘→ 下一节 —— 用隐藏按钮承载快捷键（macOS 惯用法）。
        .background { keyboardShortcuts }
    }

    // MARK: 已加载主体

    @ViewBuilder
    private func loaded(_ agg: MacLessonAggregate) -> some View {
        if !agg.access {
            paywall
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header(agg)
                    content(agg)
                    footerBar(agg)
                }
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
                .padding(20)
            }
        }
    }

    // MARK: 头（课程 · 标题 · 完成态）

    private func header(_ agg: MacLessonAggregate) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(agg.course.title)
                    .font(.mono(11, .semibold)).foregroundStyle(Studio.ink3).tracking(1)
                if vm.completed {
                    StatusBadge(text: "已完成", icon: "checkmark.seal.fill", tone: .ok)
                }
            }
            Text(agg.lesson.title)
                .font(.studio(22, .bold)).foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Label(MacCourseFormat.duration(agg.lesson.durationSec), systemImage: "clock.fill")
                    .font(.mono(11)).foregroundStyle(Studio.ink3).labelStyle(.titleAndIcon)
                Label(contentTypeLabel(agg.lesson.contentType), systemImage: contentTypeIcon(agg.lesson.contentType))
                    .font(.mono(11)).foregroundStyle(Studio.ink3).labelStyle(.titleAndIcon)
                if agg.lesson.isFree {
                    StatusBadge(text: "免费试学", icon: "gift", tone: .ok)
                }
            }
        }
    }

    // MARK: 三态内容

    @ViewBuilder
    private func content(_ agg: MacLessonAggregate) -> some View {
        switch agg.lesson.contentType {
        case "video":
            videoContent
        case "article":
            articleContent(agg.lesson.articleMd)
        case "ai_block":
            blockContent
        default:
            // 未知类型：有正文按图文渲染，否则空态。
            if let md = agg.lesson.articleMd, !md.isEmpty {
                articleContent(md)
            } else {
                EmptyStateView(title: "暂不支持的内容类型", subtitle: "该章节内容正在适配桌面版", icon: "questionmark.square.dashed")
            }
        }
    }

    // MARK: video → AVKit VideoPlayer

    @ViewBuilder
    private var videoContent: some View {
        if let url = vm.absoluteVideoURL() {
            MacVideoPlayerView(url: url, vm: vm)
                .aspectRatio(16.0/9.0, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        } else {
            EmptyStateView(title: "视频不可用", subtitle: "该章节暂无可播放的视频源", icon: "play.slash")
                .studioCard()
        }
    }

    // MARK: article → Markdown 文本

    private func articleContent(_ md: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let md, !md.isEmpty {
                // Text(.init(md)) 走 AttributedString 的 Markdown 内联渲染（标题/加粗/列表等基础样式）。
                Text(.init(md))
                    .font(.studio(15)).foregroundStyle(Studio.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("图文内容整理中").font(.studio(13)).foregroundStyle(Studio.ink3)
            }
        }
        .studioCard()
    }

    // MARK: ai_block → 每块主要文字竖排

    @ViewBuilder
    private var blockContent: some View {
        if vm.blocks.isEmpty {
            EmptyStateView(title: "课件整理中", subtitle: "块课件内容正在适配桌面版", icon: "square.stack.3d.up")
                .studioCard()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(vm.blocks) { block in
                    blockCard(block)
                }
            }
        }
    }

    private func blockCard(_ block: MacBlock) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(block.kindLabel)
                    .font(.mono(10, .bold)).foregroundStyle(Studio.ink3).tracking(1)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Studio.surface2).clipShape(Capsule())
                if let heading = block.heading, !heading.isEmpty {
                    Text(heading).font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !block.body.isEmpty {
                Text(.init(block.body))
                    .font(.studio(14)).foregroundStyle(Studio.ink2)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    // MARK: 底部操作条（完成 + 上/下一节）

    private func footerBar(_ agg: MacLessonAggregate) -> some View {
        HStack(spacing: 12) {
            Button {
                Task { await vm.switchTo(agg.prevLessonId) }
            } label: {
                Label("上一节", systemImage: "chevron.left")
                    .font(.studio(13, .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(agg.prevLessonId == nil ? Studio.ink4 : Studio.ink2)
            .disabled(agg.prevLessonId == nil)

            Spacer(minLength: 0)

            StudioButton(
                title: vm.completed ? "已完成" : "标记完成",
                kind: vm.completed ? .ghost : .red,
                icon: vm.completed ? "checkmark" : "checkmark.circle"
            ) {
                Task { await vm.markCompleted() }
            }
            .frame(maxWidth: 180)
            .disabled(vm.completed)

            Spacer(minLength: 0)

            Button {
                Task { await vm.switchTo(agg.nextLessonId) }
            } label: {
                Label("下一节", systemImage: "chevron.right")
                    .font(.studio(13, .semibold))
                    .labelStyle(TrailingIconLabelStyle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(agg.nextLessonId == nil ? Studio.ink4 : Studio.ink2)
            .disabled(agg.nextLessonId == nil)
        }
        .padding(.top, 4)
    }

    // MARK: 付费墙

    private var paywall: some View {
        VStack(spacing: 16) {
            EmptyStateView(
                title: "该章节需要订阅解锁",
                subtitle: "开通会员即可畅学全部章节，配套笔记与复习卡一并开放。",
                icon: "lock.fill"
            )
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: 快捷键（隐藏按钮承载 ⌘↩ / ⌘← / ⌘→）

    private var keyboardShortcuts: some View {
        ZStack {
            Button("") { Task { await vm.markCompleted() } }
                .keyboardShortcut(.return, modifiers: .command)
            Button("") { Task { await vm.switchTo(vm.aggregate?.prevLessonId) } }
                .keyboardShortcut(.leftArrow, modifiers: .command)
            Button("") { Task { await vm.switchTo(vm.aggregate?.nextLessonId) } }
                .keyboardShortcut(.rightArrow, modifiers: .command)
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: loading

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            SkeletonBar(height: 14, width: 120)
            SkeletonBar(height: 26, width: 260)
            SkeletonBar(height: 240).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            ForEach(0..<3, id: \.self) { _ in
                SkeletonBar(height: 60).clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .frame(maxWidth: 900)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }

    // MARK: 内容类型文案/图标

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
}

/// 尾随图标 Label 样式（“下一节 >”）。
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.title
            configuration.icon
        }
    }
}

// MARK: - AVKit 播放器（NSViewRepresentable 之上用 SwiftUI VideoPlayer + 周期采样上报）

/// macOS 的 VideoPlayer(player:)：播放时每 5s 采样进度上报，看完补 markCompleted。
private struct MacVideoPlayerView: View {
    let url: URL
    let vm: PlayerWindowViewModel
    @State private var player: AVPlayer?
    @State private var timeObserver: Any?

    var body: some View {
        VideoPlayer(player: player)
            .onAppear { setup() }
            .onDisappear { teardown() }
    }

    private func setup() {
        guard player == nil else { return }
        let p = AVPlayer(url: url)
        let interval = CMTime(seconds: 5, preferredTimescale: 1)
        timeObserver = p.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            let secs = Int(time.seconds.isFinite ? time.seconds : 0)
            let total = p.currentItem?.duration.seconds ?? 0
            Task { @MainActor in
                vm.progressSec = secs
                if total.isFinite, total > 0, Double(secs) >= total - 1 {
                    await vm.markCompleted()
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
#endif
