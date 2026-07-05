// Mac 笔记系统：detail 区三栏（列表 / 阅读·编辑 / 信息）。
//
// iOS 的 NotesView / NoteDetail 定义在 Features/ 内，而 Features/ 整个从 Mac target 排除
// （含大量 iOS-only API），故此处建等价 @Observable VM + 本地 DTO，打同一组 /api/notes 端点、
// 走同一 APIEnvelope。字段严格对齐后端真实响应（已 curl 核对 2026-07-05）：
//   GET /api/notes → data.{ notes[NoteDTO], groups, nextCursor?, total }
//   NoteDTO：id/userId/title/contentMd/excerpt?/source/sourceUrl?/kind/notebookId?/
//            courseId?/starred/pinned/createdAt/updatedAt + course{title,slug}? + tags[Tag]
//   GET /api/notes/[id] → data.NoteDTO（同结构，course 缺省）
//   PATCH /api/notes/[id] {title,contentMd} → data.NoteDTO
// 防御性解码：非 Optional 关系字段 tags 缺省兜底 []（decodeIfPresent ?? []），
//            course/notebookId 等本就 Optional。
#if os(macOS)
import SwiftUI
import Observation

// MARK: - DTO（本地建，字段对齐后端真实响应）

/// 笔记标签（compose-options / note 里的 tags 项）：{id,name,color}。
struct MacNoteTag: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String
}

/// 笔记关联课程（note.course）：{title,slug}。
struct MacNoteCourse: Decodable, Hashable {
    let title: String
    let slug: String
}

/// 单条笔记。非 Optional 关系字段 tags 用防御性解码兜底 []。
struct MacNote: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let contentMd: String
    let excerpt: String?
    let source: String
    let sourceUrl: String?
    let kind: String
    let notebookId: String?
    let courseId: String?
    let starred: Bool
    let pinned: Bool
    let createdAt: Date
    let updatedAt: Date
    let course: MacNoteCourse?
    let tags: [MacNoteTag]

    enum CodingKeys: String, CodingKey {
        case id, title, contentMd, excerpt, source, sourceUrl, kind
        case notebookId, courseId, starred, pinned, createdAt, updatedAt, course, tags
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        contentMd = (try? c.decode(String.self, forKey: .contentMd)) ?? ""
        excerpt = try? c.decodeIfPresent(String.self, forKey: .excerpt)
        source = (try? c.decode(String.self, forKey: .source)) ?? "manual"
        sourceUrl = try? c.decodeIfPresent(String.self, forKey: .sourceUrl)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "text"
        notebookId = try? c.decodeIfPresent(String.self, forKey: .notebookId)
        courseId = try? c.decodeIfPresent(String.self, forKey: .courseId)
        starred = (try? c.decode(Bool.self, forKey: .starred)) ?? false
        pinned = (try? c.decode(Bool.self, forKey: .pinned)) ?? false
        createdAt = (try? c.decode(Date.self, forKey: .createdAt)) ?? Date()
        updatedAt = (try? c.decode(Date.self, forKey: .updatedAt)) ?? Date()
        course = try? c.decodeIfPresent(MacNoteCourse.self, forKey: .course)
        // 防御：tags 缺省/为 null 兜底 []，避免整屏解码崩。
        tags = (try? c.decodeIfPresent([MacNoteTag].self, forKey: .tags)) ?? []
    }
}

/// GET /api/notes 分页响应：notes / nextCursor / total（groups 忽略，Mac 用扁平列表）。
private struct MacNotesPage: Decodable {
    let notes: [MacNote]
    let nextCursor: String?
    let total: Int

    enum CodingKeys: String, CodingKey { case notes, nextCursor, total }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        notes = (try? c.decodeIfPresent([MacNote].self, forKey: .notes)) ?? []
        nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
    }
}

/// PATCH body：{title,contentMd}。
private struct MacNotePatchBody: Encodable {
    let title: String
    let contentMd: String
}

// MARK: - ViewModel

@Observable @MainActor
final class MacNotesViewModel {
    var notes: [MacNote] = []
    var total = 0
    var nextCursor: String?
    /// 首屏加载态（区分骨架 vs 触底 loadMore）。
    var loading = false
    var loadingMore = false
    var error: String?
    var search = ""

    /// 编辑态（中栏）：保存中闩 + 保存错误提示。
    var saving = false
    var saveError: String?

    private let pageSize = 20

    var hasMore: Bool { nextCursor != nil }

    /// 首屏 / 搜索变更：重置游标全量重拉。
    func reload() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let page = try await fetch(cursor: nil)
            notes = page.notes
            nextCursor = page.nextCursor
            total = page.total
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 触底加载下一页（用 nextCursor）。已在加载或无更多则跳过。
    func loadMore() async {
        guard !loadingMore, !loading, let cursor = nextCursor else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await fetch(cursor: cursor)
            // 去重追加（游标翻页理论不重叠，仍防御去重）。
            let existing = Set(notes.map(\.id))
            notes.append(contentsOf: page.notes.filter { !existing.contains($0.id) })
            nextCursor = page.nextCursor
            total = page.total
        } catch {
            // 加载更多失败静默（不打断已有列表），仅在首屏用整屏错误态。
        }
    }

    private func fetch(cursor: String?) async throws -> MacNotesPage {
        var path = "/api/notes?limit=\(pageSize)"
        if let cursor { path += "&cursor=\(cursor)" }
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty,
           let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&q=\(enc)"
        }
        return try await API.shared.get(path, as: MacNotesPage.self)
    }

    /// 保存中栏编辑（PATCH title + contentMd），成功后把新对象合并回列表。
    func save(id: String, title: String, contentMd: String) async -> MacNote? {
        saving = true; saveError = nil
        defer { saving = false }
        do {
            let updated = try await API.shared.patch(
                "/api/notes/\(id)",
                body: MacNotePatchBody(title: title, contentMd: contentMd),
                as: MacNote.self)
            if let idx = notes.firstIndex(where: { $0.id == id }) {
                notes[idx] = updated
            }
            return updated
        } catch {
            saveError = (error as? APIError)?.errorDescription ?? "保存失败"
            return nil
        }
    }
}

// MARK: - 主视图（三栏）

struct MacNotesView: View {
    @State private var vm = MacNotesViewModel()
    @State private var selectedID: MacNote.ID?
    @Environment(\.openWindow) private var openWindow

    /// 搜索防抖任务：输入停顿 300ms 后重拉。
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        HSplitView {
            listColumn
                .frame(minWidth: 260, idealWidth: 300, maxWidth: 380)
            detailColumn
                .frame(minWidth: 320)
            infoColumn
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 320)
        }
        .background(Studio.bg)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Haptics.medium()
                    openWindow(id: "compose")
                } label: {
                    Label("记一条", systemImage: "square.and.pencil")
                }
                .keyboardShortcut("n", modifiers: .command)
                .help("记一条新笔记（⌘N）")
            }
        }
        .task { if vm.notes.isEmpty && vm.error == nil { await vm.reload() } }
    }

    private var selectedNote: MacNote? {
        guard let id = selectedID else { return nil }
        return vm.notes.first { $0.id == id }
    }

    // MARK: 左栏：列表 + 搜索

    private var listColumn: some View {
        VStack(spacing: 0) {
            searchBar
            Divider().overlay(Studio.border)
            listBody
        }
        .background(Studio.bg2)
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Studio.ink4)
            TextField("搜索笔记", text: $vm.search)
                .textFieldStyle(.plain)
                .font(.studio(13))
                .foregroundStyle(Studio.ink)
                .noAutocapitalization()
                .noAutocorrection()
                .onChange(of: vm.search) { _, _ in scheduleSearch() }
            if !vm.search.isEmpty {
                Button {
                    vm.search = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Studio.ink4)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
        .padding(12)
    }

    @ViewBuilder
    private var listBody: some View {
        if vm.loading && vm.notes.isEmpty {
            listSkeleton
        } else if let err = vm.error, vm.notes.isEmpty {
            ErrorRetryView(message: err) { Task { await vm.reload() } }
        } else if vm.notes.isEmpty {
            EmptyStateView(
                title: vm.search.isEmpty ? "还没有笔记" : "没有匹配的笔记",
                subtitle: vm.search.isEmpty ? "点右上角「记一条」开始你的第一条笔记。" : "换个关键词再试试。",
                icon: "square.and.pencil")
        } else {
            List(selection: $selectedID) {
                ForEach(vm.notes) { note in
                    NoteRow(note: note)
                        .tag(note.id)
                        .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                        .listRowBackground(Color.clear)
                        .onAppear {
                            // 触底预取：滚到最后几条即拉下一页。
                            if note.id == vm.notes.last?.id { Task { await vm.loadMore() } }
                        }
                }
                if vm.hasMore {
                    HStack {
                        Spacer()
                        ProgressView().controlSize(.small).tint(Studio.red)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .padding(.vertical, 6)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private var listSkeleton: some View {
        VStack(spacing: 10) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    SkeletonBar(height: 14, width: 180)
                    SkeletonBar(height: 11)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Studio.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            Spacer()
        }
        .padding(12)
    }

    // MARK: 中栏：阅读 + 编辑

    private var detailColumn: some View {
        Group {
            if let note = selectedNote {
                MacNoteDetailPane(note: note, vm: vm)
                    .id(note.id) // 切换笔记时重建编辑态
            } else {
                ZStack {
                    Studio.bg.ignoresSafeArea()
                    EmptyStateView(
                        title: "选择一条笔记",
                        subtitle: "从左侧列表选一条查看与编辑，或点右上角「记一条」新建。",
                        icon: "doc.text")
                    .frame(maxWidth: 360)
                }
            }
        }
    }

    // MARK: 右栏：信息

    private var infoColumn: some View {
        Group {
            if let note = selectedNote {
                MacNoteInfoPane(note: note)
            } else {
                ZStack {
                    Studio.bg2.ignoresSafeArea()
                    VStack(spacing: 8) {
                        Image(systemName: "info.circle")
                            .font(.system(size: 22, weight: .light))
                            .foregroundStyle(Studio.ink4)
                        Text("笔记信息")
                            .font(.studio(13)).foregroundStyle(Studio.ink3)
                    }
                }
            }
        }
        .background(Studio.bg2)
    }

    // MARK: 搜索防抖

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await vm.reload()
        }
    }
}

// MARK: - 列表行

private struct NoteRow: View {
    let note: MacNote

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if note.pinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 9)).foregroundStyle(Studio.red)
                }
                Text(note.title.isEmpty ? "无标题" : note.title)
                    .font(.studio(14, .semibold))
                    .foregroundStyle(Studio.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            let preview = note.excerpt?.isEmpty == false ? note.excerpt! : note.contentMd
            if !preview.isEmpty {
                Text(preview)
                    .font(.studio(12))
                    .foregroundStyle(Studio.ink3)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            HStack(spacing: 6) {
                if note.source == "link_import" {
                    StatusBadge(text: "链接", icon: "link", tone: .info)
                }
                if let c = note.course {
                    StatusBadge(text: c.title, icon: "book", tone: .neutral)
                }
                ForEach(note.tags.prefix(2)) { t in
                    StatusBadge(text: t.name, tone: .neutral)
                }
                Spacer(minLength: 0)
                Text(Self.rel.localizedString(for: note.updatedAt, relativeTo: Date()))
                    .font(.mono(10)).foregroundStyle(Studio.ink4)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private static let rel: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "zh_Hans")
        f.unitsStyle = .abbreviated
        return f
    }()
}

// MARK: - 中栏详情面板（阅读 / 编辑切换）

private struct MacNoteDetailPane: View {
    let note: MacNote
    let vm: MacNotesViewModel

    @State private var editing = false
    @State private var editTitle = ""
    @State private var editBody = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                Divider().overlay(Studio.border)
                if editing {
                    editor
                } else {
                    reader
                }
            }
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(28)
        }
        .background(Studio.bg)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                if editing {
                    TextField("标题", text: $editTitle)
                        .textFieldStyle(.plain)
                        .font(.studio(22, .bold))
                        .foregroundStyle(Studio.ink)
                        .noAutocapitalization()
                        .noAutocorrection()
                } else {
                    Text(note.title.isEmpty ? "无标题" : note.title)
                        .font(.studio(22, .bold))
                        .foregroundStyle(Studio.ink)
                        .textSelection(.enabled)
                }
                if let saveErr = vm.saveError, editing {
                    Text(saveErr).font(.studio(12)).foregroundStyle(Studio.warn)
                }
            }
            Spacer(minLength: 8)
            controls
        }
    }

    @ViewBuilder
    private var controls: some View {
        if editing {
            HStack(spacing: 8) {
                Button("取消") { cancelEdit() }
                    .buttonStyle(.plain)
                    .font(.studio(13, .semibold))
                    .foregroundStyle(Studio.ink2)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .disabled(vm.saving)

                Button {
                    Task { await commitEdit() }
                } label: {
                    HStack(spacing: 6) {
                        if vm.saving { ProgressView().controlSize(.small).tint(.white) }
                        else { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)) }
                        Text("保存").font(.studio(13, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(Studio.red)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(vm.saving)
            }
        } else {
            Button {
                startEdit()
            } label: {
                Label("编辑", systemImage: "pencil")
                    .font(.studio(13, .semibold))
                    .foregroundStyle(Studio.ink)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Studio.border2, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    /// 阅读态：Markdown 渲染（Text(.init(md)) 支持基础语法）。
    private var reader: some View {
        Group {
            if note.contentMd.isEmpty {
                Text("（空白笔记）")
                    .font(.studio(14)).foregroundStyle(Studio.ink4)
            } else {
                Text(markdown(note.contentMd))
                    .font(.studio(15))
                    .foregroundStyle(Studio.ink2)
                    .lineSpacing(5)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    /// 编辑态：TextEditor。
    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("正文（Markdown）")
                .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(1)
            TextEditor(text: $editBody)
                .font(.studio(15))
                .foregroundStyle(Studio.ink)
                .scrollContentBackground(.hidden)
                .padding(12)
                .frame(minHeight: 320)
                .background(Studio.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
                .noAutocapitalization()
                .noAutocorrection()
        }
    }

    /// 解析 Markdown；失败退化为纯文本，绝不崩。
    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }

    private func startEdit() {
        editTitle = note.title
        editBody = note.contentMd
        vm.saveError = nil
        editing = true
    }

    private func cancelEdit() {
        editing = false
        vm.saveError = nil
    }

    private func commitEdit() async {
        let t = editTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = await vm.save(id: note.id, title: t.isEmpty ? note.title : t, contentMd: editBody)
        if result != nil {
            Haptics.success()
            editing = false
        }
    }
}

// MARK: - 右栏信息面板

private struct MacNoteInfoPane: View {
    let note: MacNote

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                sectionTitle("笔记信息")

                infoRow(label: "来源", icon: note.source == "link_import" ? "link" : "square.and.pencil",
                        value: sourceLabel)
                if let url = note.sourceUrl, !url.isEmpty {
                    linkRow(url)
                }

                Divider().overlay(Studio.border)

                labelHead("关联课程")
                if let c = note.course {
                    HStack(spacing: 8) {
                        Image(systemName: "book.fill")
                            .font(.system(size: 12)).foregroundStyle(Studio.red)
                        Text(c.title).font(.studio(13, .semibold)).foregroundStyle(Studio.ink)
                            .lineLimit(2)
                    }
                } else {
                    emptyHint("未关联课程")
                }

                Divider().overlay(Studio.border)

                labelHead("标签")
                if note.tags.isEmpty {
                    emptyHint("暂无标签")
                } else {
                    FlowTags(tags: note.tags)
                }

                Divider().overlay(Studio.border)

                labelHead("时间")
                infoRow(label: "创建", icon: "calendar", value: Self.fmt.string(from: note.createdAt))
                infoRow(label: "更新", icon: "clock", value: Self.fmt.string(from: note.updatedAt))

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(Studio.bg2)
    }

    private var sourceLabel: String {
        switch note.source {
        case "link_import": "链接导入"
        case "manual": "手动记录"
        default: note.source
        }
    }

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.studio(15, .bold)).foregroundStyle(Studio.ink)
    }

    private func labelHead(_ t: String) -> some View {
        Text(t).font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
    }

    private func infoRow(label: String, icon: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12)).foregroundStyle(Studio.ink3)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.studio(11)).foregroundStyle(Studio.ink4)
                Text(value).font(.studio(13)).foregroundStyle(Studio.ink2)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
    }

    private func linkRow(_ url: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "globe")
                .font(.system(size: 12)).foregroundStyle(Studio.info)
                .frame(width: 16)
            if let u = URL(string: url) {
                Link(destination: u) {
                    Text(url).font(.studio(12)).foregroundStyle(Studio.info)
                        .lineLimit(2).multilineTextAlignment(.leading)
                }
            } else {
                Text(url).font(.studio(12)).foregroundStyle(Studio.ink3).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
    }

    private func emptyHint(_ t: String) -> some View {
        Text(t).font(.studio(12)).foregroundStyle(Studio.ink4)
    }

    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_Hans")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f
    }()
}

/// 标签流式排布（右栏用）。
private struct FlowTags: View {
    let tags: [MacNoteTag]
    var body: some View {
        // 简单换行网格：LazyVGrid 自适应。
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 60, maximum: 140), spacing: 6, alignment: .leading)],
                  alignment: .leading, spacing: 6) {
            ForEach(tags) { t in
                StatusBadge(text: t.name, icon: "tag", tone: .neutral)
            }
        }
    }
}
#endif
