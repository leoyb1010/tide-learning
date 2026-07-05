import SwiftUI
import Observation

// MARK: - DTO（对齐 GET /api/notes/compose-options 返回体）

/// 「记一条」智能化数据源：一次拉齐笔记本 / 标签 / 我的课程。
/// 后端形态：{ notebooks:[{id,title,icon}], tags:[{id,name,color}], courses:[{id,slug,title}] }。
/// 游客三个空数组（后端不抛 401），前端统一走空态。
struct ComposeOptions: Decodable {
    let notebooks: [ComposeNotebook]
    /// var：现场创建标签后并入本地列表（供多选面板即时可勾选）。
    var tags: [NoteTag]
    let courses: [ComposeCourse]

    static let empty = ComposeOptions(notebooks: [], tags: [], courses: [])
}

/// compose-options.notebooks[] 精简项（仅下拉所需字段）。
struct ComposeNotebook: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String?
}

/// compose-options.courses[] 精简项（我的在学/拥有课程去重后的一份）。
struct ComposeCourse: Decodable, Identifiable, Hashable {
    let id: String
    let slug: String
    let title: String
}

// MARK: - 新建标签响应（POST /api/note-tags → { id,name,color }）

/// POST /api/note-tags 返回体：现场创建标签（同名 upsert）。字段与 NoteTag 对齐。
struct CreatedNoteTag: Decodable {
    let id: String
    let name: String
    let color: String?

    /// 转成列表通用的 NoteTag（供多选面板即时纳入）。
    var asNoteTag: NoteTag { NoteTag(id: id, name: name, color: color) }
}

// MARK: - Options 加载器（compose sheet 专用轻状态机）

/// 「记一条」弹窗打开时拉取三组选项 + 现场创建标签。
/// 与 NotesViewModel 解耦：compose sheet 生命周期短，独立小 VM 更清爽。
@Observable @MainActor
final class ComposeOptionsLoader {
    var options: ComposeOptions = .empty
    var loaded = false
    var loading = false
    /// 最近一次 load 是否失败（网络/解码错误 → 静默降级为空选项）。
    /// 用于区分「加载成功但确实没有笔记本」与「加载失败拿不到列表」：
    /// 前者不该预选（防选到不属于本人的本），后者应保留调用方预选值（无从校验，信任调用方）。
    var loadFailed = false

    /// 现场创建标签中（禁重复点）。
    var creatingTag = false

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        // 拉失败不阻塞记笔记：静默降级为空选项，用户仍可只写正文保存。
        if let opts = try? await API.shared.get("/api/notes/compose-options", as: ComposeOptions.self) {
            options = opts
            loadFailed = false
        } else {
            // 失败：保留空选项但打标 loadFailed，供预选逻辑保留调用方传入的预选值（见 shouldPreselect）。
            loadFailed = true
        }
        loaded = true
    }

    /// 是否应落实调用方传入的预选笔记本 id。
    /// 契约（流2-U1b · 修「compose-options 拉取失败时预选被丢弃」）：
    ///   - 加载成功：仅当该本存在于选项里才预选（防选到不属于本人的本）。
    ///   - 加载失败：无从校验，保留调用方预选值（失败也不丢预选）。
    /// nil 预选恒返回 false（无预选可落）。
    func shouldPreselect(_ notebookId: String?) -> Bool {
        guard let notebookId else { return false }
        if loadFailed { return true }
        return options.notebooks.contains(where: { $0.id == notebookId })
    }

    /// 现场创建标签，成功则并入 options.tags 并返回新标签（供调用方自动勾选）。
    func createTag(name: String) async -> NoteTag? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !creatingTag else { return nil }
        creatingTag = true
        defer { creatingTag = false }
        struct Body: Encodable { let name: String }
        do {
            let created = try await API.shared.post("/api/note-tags", body: Body(name: trimmed), as: CreatedNoteTag.self)
            let tag = created.asNoteTag
            // upsert 语义：同名已存在则合并去重，避免 chips 重复。
            if !options.tags.contains(where: { $0.id == tag.id }) {
                options.tags.append(tag)
            }
            return tag
        } catch {
            return nil
        }
    }
}

// MARK: - 笔记本选择（单选 · Menu 下拉）

/// 「归入笔记本」下拉：默认未归类（不选）。空列表隐藏整块。
struct NotebookPicker: View {
    let notebooks: [ComposeNotebook]
    @Binding var selectedId: String?

    private var selected: ComposeNotebook? {
        guard let selectedId else { return nil }
        return notebooks.first { $0.id == selectedId }
    }

    var body: some View {
        if !notebooks.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("归入笔记本").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                Menu {
                    Button {
                        Haptics.selection(); selectedId = nil
                    } label: {
                        Label("未归类", systemImage: selectedId == nil ? "checkmark" : "tray")
                    }
                    ForEach(notebooks) { nb in
                        Button {
                            Haptics.selection(); selectedId = nb.id
                        } label: {
                            Label(nb.title, systemImage: selectedId == nb.id ? "checkmark" : (nb.icon ?? "book.closed"))
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "books.vertical.fill")
                            .font(.system(size: 13)).foregroundStyle(Studio.ink3)
                        Text(selected?.title ?? "未归类")
                            .font(.studio(15, selected == nil ? .regular : .semibold))
                            .foregroundStyle(selected == nil ? Studio.ink3 : Studio.ink)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(Studio.ink4)
                    }
                    .padding(12)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }
}

// MARK: - 标签多选（勾选已有 + 现场新建）

/// 标签多选面板：横排 chips 勾选，尾部「+ 新标签」现场创建。空列表仍显示新建入口。
struct TagMultiPicker: View {
    let tags: [NoteTag]
    @Binding var selectedIds: Set<String>
    var creating: Bool
    /// 现场创建标签（async，成功由父层并入并勾选）。
    let onCreate: (String) async -> Void

    @State private var showNewTagField = false
    @State private var newTagName = ""
    @FocusState private var newTagFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("标签").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
            FlowTags(
                tags: tags,
                selectedIds: selectedIds,
                onToggle: { id in
                    Haptics.selection()
                    if selectedIds.contains(id) { selectedIds.remove(id) } else { selectedIds.insert(id) }
                },
                trailing: { newTagControl }
            )
        }
    }

    @ViewBuilder
    private var newTagControl: some View {
        if showNewTagField {
            HStack(spacing: 6) {
                TextField("新标签", text: $newTagName)
                    .font(.studio(13, .medium))
                    .foregroundStyle(Studio.ink)
                    .frame(width: 84)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($newTagFocused)
                    .onSubmit { Task { await commitNewTag() } }
                if creating {
                    ProgressView().controlSize(.mini)
                } else {
                    Button {
                        Task { await commitNewTag() }
                    } label: {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 16)).foregroundStyle(Studio.red)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Studio.surface2)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Studio.border2, lineWidth: 1))
        } else {
            Button {
                Haptics.light()
                showNewTagField = true
                newTagFocused = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                    Text("新标签").font(.studio(12, .semibold))
                }
                .foregroundStyle(Studio.ink2)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Studio.surface2)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(Studio.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private func commitNewTag() async {
        let name = newTagName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        await onCreate(name)
        newTagName = ""
        showNewTagField = false
    }
}

/// 标签自动换行布局：可选已有标签 chips + 尾随自定义控件（新建入口）。
/// 用 iOS 16+ 的 Layout 无关方案——直接横向 wrap（简单场景够用）。
private struct FlowTags<Trailing: View>: View {
    let tags: [NoteTag]
    let selectedIds: Set<String>
    let onToggle: (String) -> Void
    @ViewBuilder let trailing: () -> Trailing

    private let columns = [GridItem(.adaptive(minimum: 60, maximum: 160), spacing: 8, alignment: .leading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
            ForEach(tags) { tag in
                let on = selectedIds.contains(tag.id)
                Button { onToggle(tag.id) } label: {
                    Text("#\(tag.name)")
                        .font(.mono(12, .medium))
                        .foregroundStyle(on ? .white : Studio.ink2)
                        .lineLimit(1)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(on ? Studio.red : Studio.surface2)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(on ? Color.clear : Studio.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            trailing()
        }
    }
}

// MARK: - 关联课程（单选 · Menu 下拉，软关联不解锁章节）

/// 「快捷关联课程」下拉：从我的在学/拥有课程选。软关联仅打标不解锁内容。空列表隐藏。
struct CourseAssociationPicker: View {
    let courses: [ComposeCourse]
    @Binding var selectedId: String?

    private var selected: ComposeCourse? {
        guard let selectedId else { return nil }
        return courses.first { $0.id == selectedId }
    }

    var body: some View {
        if !courses.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("关联课程").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                Menu {
                    Button {
                        Haptics.selection(); selectedId = nil
                    } label: {
                        Label("不关联", systemImage: selectedId == nil ? "checkmark" : "minus")
                    }
                    ForEach(courses) { c in
                        Button {
                            Haptics.selection(); selectedId = c.id
                        } label: {
                            Label(c.title, systemImage: selectedId == c.id ? "checkmark" : "book")
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "book.closed.fill")
                            .font(.system(size: 13)).foregroundStyle(Studio.ink3)
                        Text(selected?.title ?? "不关联")
                            .font(.studio(15, selected == nil ? .regular : .semibold))
                            .foregroundStyle(selected == nil ? Studio.ink3 : Studio.ink)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(Studio.ink4)
                    }
                    .padding(12)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }
}
