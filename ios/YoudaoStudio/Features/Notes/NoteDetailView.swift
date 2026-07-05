import SwiftUI
import Observation

// MARK: - AI 整理动作

enum NoteAIAction: String, CaseIterable, Identifiable {
    case summary = "总结"
    case reviewCards = "复习卡"
    case outline = "大纲"
    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .summary: return "text.append"
        case .reviewCards: return "rectangle.stack"
        case .outline: return "list.bullet.indent"
        }
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class NoteDetailViewModel {
    let noteId: String

    var note: Note?
    var loaded = false
    var error: String?
    var loading = false

    // 编辑态
    var editing = false
    var saving = false
    var saveError: String?
    var editTitle = ""
    var editContent = ""

    // AI 整理态
    var aiRunning = false
    var aiResult: String?
    var aiTitle: String?
    var aiError: String?

    init(noteId: String) { self.noteId = noteId }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let n = try await API.shared.get("/api/notes/\(noteId)", as: Note.self)
            note = n
            editTitle = n.title ?? ""
            editContent = n.contentMd ?? ""
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    func beginEdit() {
        guard let n = note else { return }
        editTitle = n.title ?? ""
        editContent = n.contentMd ?? ""
        saveError = nil
        editing = true
    }

    func cancelEdit() {
        editing = false
        saveError = nil
    }

    func save() async {
        saving = true; saveError = nil
        defer { saving = false }
        struct Body: Encodable { let title: String; let contentMd: String }
        do {
            let updated = try await API.shared.patch(
                "/api/notes/\(noteId)",
                body: Body(title: editTitle, contentMd: editContent),
                as: Note.self
            )
            note = updated
            editing = false
        } catch {
            saveError = (error as? APIError)?.errorDescription ?? "保存失败"
        }
    }

    // MARK: AI 三端点契约 DTO（对齐后端真实请求/响应）

    /// POST /api/ai/note-summary 请求：{ noteIds:[String], mode:"summary"|"flashcards" }。
    private struct SummaryBody: Encodable { let noteIds: [String]; let mode: String }
    /// note-summary 响应：{ summary:[String], flashcards?:[{q,a}] }（LLM 产物，宽松解码）。
    private struct SummaryResponse: Decodable { let summary: [String]? }

    /// POST /api/ai/note-transform 请求：{ noteIds:[String], action:"outline"|"actions"|"translate"|"weekly" }。
    private struct TransformBody: Encodable { let noteIds: [String]; let action: String }
    /// note-transform 响应：{ action, markdown, items }（outline 走 markdown）。
    private struct TransformResponse: Decodable { let markdown: String?; let items: [String]? }

    /// POST /api/ai/review-card 请求（批量生成分支）：{ noteIds:[String] }。
    private struct ReviewCardBody: Encodable { let noteIds: [String] }
    /// review-card 响应：{ cards:[{id,front,back,...}], count }。只取展示所需字段。
    private struct ReviewCardResponse: Decodable {
        struct Card: Decodable { let front: String; let back: String }
        let cards: [Card]?
        let count: Int?
    }

    /// AI 整理三动作，各走各的后端端点：
    /// - 总结  → POST /api/ai/note-summary   { noteIds, mode:"summary" } → { summary:[要点] }
    /// - 大纲  → POST /api/ai/note-transform { noteIds, action:"outline" } → { markdown }
    /// - 复习卡 → POST /api/ai/review-card    { noteIds } → { cards:[{front,back}] }（生成并落库）
    /// 三端点均以 noteIds 数组定位笔记（服务端强制 userId 重拉，防越权）。
    func runAI(_ action: NoteAIAction) async {
        aiRunning = true; aiError = nil; aiResult = nil; aiTitle = nil
        defer { aiRunning = false }
        do {
            switch action {
            case .summary:
                let resp = try await API.shared.post(
                    "/api/ai/note-summary",
                    body: SummaryBody(noteIds: [noteId], mode: "summary"),
                    as: SummaryResponse.self
                )
                let points = (resp.summary ?? [])
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                guard !points.isEmpty else { throw APIError.message("AI 未返回总结内容，请稍后重试") }
                aiTitle = "总结"
                aiResult = points.map { "- \($0)" }.joined(separator: "\n")

            case .outline:
                let resp = try await API.shared.post(
                    "/api/ai/note-transform",
                    body: TransformBody(noteIds: [noteId], action: "outline"),
                    as: TransformResponse.self
                )
                let md = (resp.markdown ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !md.isEmpty else { throw APIError.message("AI 未返回大纲内容，请稍后重试") }
                aiTitle = "大纲"
                aiResult = md

            case .reviewCards:
                let resp = try await API.shared.post(
                    "/api/ai/review-card",
                    body: ReviewCardBody(noteIds: [noteId]),
                    as: ReviewCardResponse.self
                )
                let cards = resp.cards ?? []
                guard !cards.isEmpty else { throw APIError.message("AI 未返回复习卡，请稍后重试") }
                aiTitle = "复习卡"
                aiResult = cards.enumerated()
                    .map { i, c in "**Q\(i + 1)：\(c.front)**\n\n答：\(c.back)" }
                    .joined(separator: "\n\n")
            }
        } catch {
            aiError = (error as? APIError)?.errorDescription ?? "AI 整理失败"
        }
    }
}

// MARK: - View

struct NoteDetailView: View {
    @State private var vm: NoteDetailViewModel

    init(noteId: String) {
        _vm = State(initialValue: NoteDetailViewModel(noteId: noteId))
    }

    var body: some View {
        Group {
            if vm.loaded, let note = vm.note {
                ScrollView {
                    if vm.editing { editor(note) } else { reader(note) }
                }
            } else if let err = vm.error {
                ScrollView { ErrorRetryView(message: err) { Task { await vm.load() } } }
            } else {
                ScrollView { loadingSkeleton }
            }
        }
        .background(Studio.bg)
        .navigationTitle(vm.note?.displayTitle ?? "笔记")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .sheet(item: aiSheetBinding) { result in
            AIResultSheet(title: result.title, content: result.content)
        }
        .onChange(of: vm.aiResult) { _, new in
            if new != nil { Haptics.success() }
        }
        .onChange(of: vm.aiError) { _, new in
            if new != nil { Haptics.error() }
        }
        .task { if !vm.loaded { await vm.load() } }
    }

    // MARK: 工具栏

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if vm.editing {
                if vm.saving {
                    ProgressView().controlSize(.small)
                } else {
                    Button("保存") {
                        Task {
                            let wasEditing = vm.editing
                            await vm.save()
                            // editing 变 false 表示保存成功。
                            if wasEditing && !vm.editing { Haptics.success() }
                            else if vm.saveError != nil { Haptics.error() }
                        }
                    }
                    .font(.studio(15, .semibold))
                    .tint(Studio.red)
                }
            } else if vm.loaded {
                HStack(spacing: 14) {
                    Menu {
                        ForEach(NoteAIAction.allCases) { action in
                            Button {
                                Haptics.light()
                                Task { await vm.runAI(action) }
                            } label: {
                                Label(action.rawValue, systemImage: action.systemImage)
                            }
                        }
                    } label: {
                        if vm.aiRunning {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("AI 整理", systemImage: "sparkles")
                        }
                    }
                    .tint(Studio.red)
                    .disabled(vm.aiRunning)

                    Button("编辑") { Haptics.light(); vm.beginEdit() }
                        .font(.studio(15, .semibold))
                        .tint(Studio.ink)
                }
            }
        }
        if vm.editing {
            ToolbarItem(placement: .topBarLeading) {
                Button("取消") { vm.cancelEdit() }.tint(Studio.ink2)
            }
        }
    }

    // MARK: 阅读态

    private func reader(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // 标题
            HStack(alignment: .top, spacing: 8) {
                if note.pinned {
                    Image(systemName: "pin.fill").font(.system(size: 14)).foregroundStyle(Studio.red).padding(.top, 4)
                }
                Text(note.displayTitle).font(.studio(22, .bold)).foregroundStyle(Studio.ink)
            }

            // 元信息
            HStack(spacing: 8) {
                StatusBadge(text: note.source.label, icon: note.source.badgeIcon, tone: note.source.badgeTone)
                Text("更新于 \(RelativeTime.string(from: note.updatedAt))").font(.mono(12)).foregroundStyle(Studio.ink3)
            }

            NoteTagRow(tags: note.tags)

            if let ai = vm.aiError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12))
                    Text(ai).font(.studio(13))
                }
                .foregroundStyle(Studio.redInk)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Studio.redSoft)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
            }

            // 截帧图（capture）：深色载入区用 videoGradient。
            if note.kind == .capture, let urlStr = note.captureUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if let img = phase.image {
                        img.resizable().aspectRatio(contentMode: .fit)
                    } else {
                        Studio.videoGradient.frame(height: 180)
                            .overlay(ProgressView().tint(.white))
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            // 正文 Markdown
            if let md = note.contentMd, !md.isEmpty {
                Text(AttributedString.fromMarkdown(md))
                    .font(.studio(15))
                    .foregroundStyle(Studio.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineSpacing(4)
                    .textSelection(.enabled)
            } else {
                Text("（空白笔记）").font(.studio(14)).foregroundStyle(Studio.ink4)
            }

            // 来源锚点小卡
            if let course = note.course {
                sourceAnchor(course: course, lesson: note.lesson)
            }
        }
        .padding(16)
    }

    private func sourceAnchor(course: NoteCourseRef, lesson: NoteLessonRef?) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Studio.infoSoft)
                    .frame(width: 36, height: 36)
                Image(systemName: "book.closed.fill").font(.system(size: 15)).foregroundStyle(Studio.info)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("来自《\(course.title)》").font(.studio(13, .semibold)).foregroundStyle(Studio.ink)
                if let lesson { Text(lesson.title).font(.studio(12)).foregroundStyle(Studio.ink3).lineLimit(1) }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Studio.ink4)
        }
        .studioCard(padding: 12)
        .pressable()
    }

    // MARK: 编辑态

    private func editor(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("标题").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                TextField("未命名", text: $vm.editTitle)
                    .font(.studio(18, .semibold))
                    .foregroundStyle(Studio.ink)
                    .padding(12)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("正文").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                TextEditor(text: $vm.editContent)
                    .font(.studio(15))
                    .foregroundStyle(Studio.ink)
                    .frame(minHeight: 260)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            if let err = vm.saveError {
                Text(err).font(.studio(13)).foregroundStyle(Studio.red)
            }
        }
        .padding(16)
    }

    // MARK: AI 结果 sheet 绑定

    private struct AIResult: Identifiable { let id = UUID(); let title: String; let content: String }

    private var aiSheetBinding: Binding<AIResult?> {
        Binding(
            get: {
                guard let content = vm.aiResult else { return nil }
                return AIResult(title: vm.aiTitle ?? "AI 整理", content: content)
            },
            set: { newValue in
                if newValue == nil { vm.aiResult = nil; vm.aiTitle = nil }
            }
        )
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 14) {
            SkeletonBar(height: 26, width: 220)
            SkeletonBar(height: 14, width: 160)
            SkeletonBar(height: 14)
            SkeletonBar(height: 14)
            SkeletonBar(height: 14, width: 240)
        }
        .padding(16)
    }
}

// MARK: - AI 结果 sheet

private struct AIResultSheet: View {
    let title: String
    let content: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // AI 结果 hero：深色 videoGradient 展示区，弃死黑。
                    HStack(spacing: 10) {
                        ZStack {
                            Circle().fill(.white.opacity(0.12)).frame(width: 40, height: 40)
                            Image(systemName: "sparkles").font(.system(size: 18)).foregroundStyle(.white)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text("AI 整理").font(.mono(10, .semibold)).foregroundStyle(.white.opacity(0.6)).tracking(1.5)
                            Text(title).font(.studio(17, .bold)).foregroundStyle(.white).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Studio.videoGradient)
                    .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))

                    Text(AttributedString.fromMarkdown(content))
                        .font(.studio(15))
                        .foregroundStyle(Studio.ink)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .studioCard()
                }
                .padding(16)
                .opacity(appeared || reduceMotion ? 1 : 0)
                .offset(y: appeared || reduceMotion ? 0 : 10)
            }
            .background(Studio.bg)
            .navigationTitle("AI 整理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { Haptics.light(); dismiss() }.tint(Studio.red)
                }
            }
            .onAppear {
                guard !reduceMotion else { appeared = true; return }
                withAnimation(StudioMotion.smooth) { appeared = true }
            }
        }
    }
}
