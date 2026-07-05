// Mac「记一条」浮窗（openWindow(id:"compose") 打开，⌘N 触发）。
//
// 拉 compose-options（笔记本/标签/课程），填标题+正文，可选笔记本 / 多选标签（可现场建）/
// 关联课程，POST /api/notes 提交（防双击闩）。另有「从链接导入」：POST /api/notes/import-url
// 后端直接建好一条链接笔记并返回 {id,title}，本窗随即 GET 该笔记回填正文供二次编辑，
// 或直接关窗。支持把 URL 拖进窗口触发导入（.dropDestination）。
//
// DTO 均本地建，对齐后端真实响应（已 curl 核对 2026-07-05）：
//   GET  /api/notes/compose-options → data.{notebooks[{id,title,icon}], tags[{id,name,color}],
//                                            courses[{id,slug,title}]}
//   POST /api/note-tags {name}      → data.{id,name,color,...}
//   POST /api/notes {title,contentMd,kind,notebookId?,courseId?,tagIds?} → data.NoteDTO
//   POST /api/notes/import-url {url}→ data.{id,title}（直接建好笔记）
#if os(macOS)
import SwiftUI
import Observation
import UniformTypeIdentifiers

// MARK: - compose-options DTO

fileprivate struct MacComposeNotebook: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? "笔记本"
        icon = try? c.decodeIfPresent(String.self, forKey: .icon)
    }
    enum CodingKeys: String, CodingKey { case id, title, icon }
}

fileprivate struct MacComposeCourse: Decodable, Identifiable, Hashable {
    let id: String
    let slug: String
    let title: String
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = (try? c.decode(String.self, forKey: .slug)) ?? ""
        title = (try? c.decode(String.self, forKey: .title)) ?? "课程"
    }
    enum CodingKeys: String, CodingKey { case id, slug, title }
}

fileprivate struct MacComposeOptions: Decodable {
    let notebooks: [MacComposeNotebook]
    let tags: [MacNoteTag]
    let courses: [MacComposeCourse]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        notebooks = (try? c.decodeIfPresent([MacComposeNotebook].self, forKey: .notebooks)) ?? []
        tags = (try? c.decodeIfPresent([MacNoteTag].self, forKey: .tags)) ?? []
        courses = (try? c.decodeIfPresent([MacComposeCourse].self, forKey: .courses)) ?? []
    }
    enum CodingKeys: String, CodingKey { case notebooks, tags, courses }
}

// MARK: - 请求 / 响应 body

fileprivate struct MacCreateNoteBody: Encodable {
    let title: String
    let contentMd: String
    let kind: String
    let notebookId: String?
    let courseId: String?
    let tagIds: [String]?
}

fileprivate struct MacCreateTagBody: Encodable { let name: String }

/// import-url 直接建好笔记，只回 {id,title}。
fileprivate struct MacImportUrlResult: Decodable {
    let id: String
    let title: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
    }
    enum CodingKeys: String, CodingKey { case id, title }
}

fileprivate struct MacCreateTagResult: Decodable, Identifiable {
    let id: String
    let name: String
    let color: String
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        color = (try? c.decode(String.self, forKey: .color)) ?? "accent"
    }
    enum CodingKeys: String, CodingKey { case id, name, color }
}

// MARK: - ViewModel

@Observable @MainActor
fileprivate final class MacComposeViewModel {
    // 选项
    var notebooks: [MacComposeNotebook] = []
    var tags: [MacNoteTag] = []
    var courses: [MacComposeCourse] = []
    var optionsError: String?
    var loadingOptions = false

    // 表单
    var title = ""
    var body = ""
    var selectedNotebookId: String?
    var selectedCourseId: String?
    var selectedTagIds: Set<String> = []

    // 提交态（防双击闩）
    var creating = false
    var submitError: String?

    // 现场建标签
    var newTagName = ""
    var creatingTag = false

    // 链接导入
    var importUrl = ""
    var importing = false
    var importError: String?
    var importNotice: String?

    func loadOptions() async {
        loadingOptions = true; optionsError = nil
        defer { loadingOptions = false }
        do {
            let opt = try await API.shared.get("/api/notes/compose-options", as: MacComposeOptions.self)
            notebooks = opt.notebooks
            tags = opt.tags
            courses = opt.courses
        } catch {
            // 失败保留已有预选，不崩，仅记错供 UI 提示。
            optionsError = (error as? APIError)?.errorDescription ?? "选项加载失败"
        }
    }

    /// 现场建标签：POST /api/note-tags {name}，成功后并入本地列表并自动勾选。
    func createTag() async {
        let name = newTagName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !creatingTag else { return }
        creatingTag = true
        defer { creatingTag = false }
        do {
            let created = try await API.shared.post(
                "/api/note-tags", body: MacCreateTagBody(name: name), as: MacCreateTagResult.self)
            let tag = MacNoteTag(id: created.id, name: created.name, color: created.color)
            if !tags.contains(where: { $0.id == tag.id }) { tags.append(tag) }
            selectedTagIds.insert(tag.id)
            newTagName = ""
        } catch {
            submitError = (error as? APIError)?.errorDescription ?? "建标签失败"
        }
    }

    /// 提交新笔记。成功返回 true（调用方关窗）。
    func submit() async -> Bool {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !creating else { return false }
        guard !(t.isEmpty && b.isEmpty) else {
            submitError = "标题和正文不能都为空"
            return false
        }
        creating = true; submitError = nil
        defer { creating = false }
        let payload = MacCreateNoteBody(
            title: t.isEmpty ? "无标题" : t,
            contentMd: b,
            kind: "text",
            notebookId: selectedNotebookId,
            courseId: selectedCourseId,
            tagIds: selectedTagIds.isEmpty ? nil : Array(selectedTagIds))
        do {
            _ = try await API.shared.post("/api/notes", body: payload, as: MacNote.self)
            Haptics.success()
            return true
        } catch {
            submitError = (error as? APIError)?.errorDescription ?? "保存失败"
            return false
        }
    }

    /// 从链接导入：后端直接建好一条链接笔记（返回 {id,title}），本窗随即 GET 回填正文供二次编辑。
    func importFromURL(_ raw: String? = nil) async {
        let urlStr = (raw ?? importUrl).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !urlStr.isEmpty, !importing else { return }
        guard urlStr.lowercased().hasPrefix("http") else {
            importError = "请输入 http/https 链接"
            return
        }
        importing = true; importError = nil; importNotice = nil
        defer { importing = false }
        do {
            let result = try await API.shared.post(
                "/api/notes/import-url", body: ["url": urlStr], as: MacImportUrlResult.self)
            // 后端已建好该笔记；拉回内容回填当前表单，标题也带上。
            if let full = try? await API.shared.get("/api/notes/\(result.id)", as: MacNote.self) {
                if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    title = full.title
                }
                body = full.contentMd
                importNotice = "已导入「\(full.title)」，可继续编辑后再存为新笔记，或直接关窗保留导入结果。"
            } else {
                title = result.title ?? title
                importNotice = "链接已导入为一条笔记。"
            }
            importUrl = ""
            Haptics.success()
        } catch {
            importError = (error as? APIError)?.errorDescription ?? "导入失败"
        }
    }
}

// MARK: - 视图

struct MacComposeWindow: View {
    @State private var vm = MacComposeViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            Divider().overlay(Studio.border)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    importSection
                    titleField
                    bodyField
                    notebookPicker
                    coursePicker
                    tagSection
                    if let err = vm.submitError {
                        Text(err).font(.studio(12)).foregroundStyle(Studio.warn)
                    }
                }
                .padding(20)
            }
            Divider().overlay(Studio.border)
            footer
        }
        .background(Studio.bg)
        .overlay(dropOverlay)
        // 拖 URL 进窗触发链接导入。
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            Task { await vm.importFromURL(url.absoluteString) }
            return true
        } isTargeted: { dropTargeted = $0 }
        .task { if vm.notebooks.isEmpty && vm.courses.isEmpty && vm.tags.isEmpty { await vm.loadOptions() } }
    }

    // MARK: 顶栏

    private var titleBar: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Studio.redSoft).frame(width: 30, height: 30)
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(Studio.red)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("记一条").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                Text("MAC · 快速笔记").font(.mono(9, .bold)).foregroundStyle(Studio.ink4).tracking(2)
            }
            Spacer()
            if vm.loadingOptions {
                ProgressView().controlSize(.small).tint(Studio.red)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(Studio.bg2)
    }

    // MARK: 链接导入

    private var importSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "link").font(.system(size: 11, weight: .bold)).foregroundStyle(Studio.info)
                Text("从链接导入").font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
            }
            HStack(spacing: 8) {
                TextField("粘贴或拖入网页链接…", text: $vm.importUrl)
                    .macField()
                    .noAutocapitalization()
                    .noAutocorrection()
                    .onSubmit { Task { await vm.importFromURL() } }
                Button {
                    Task { await vm.importFromURL() }
                } label: {
                    HStack(spacing: 5) {
                        if vm.importing { ProgressView().controlSize(.small).tint(.white) }
                        else { Image(systemName: "arrow.down.doc").font(.system(size: 12, weight: .semibold)) }
                        Text("导入").font(.studio(13, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Studio.info)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(vm.importing || vm.importUrl.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let notice = vm.importNotice {
                Text(notice).font(.studio(11)).foregroundStyle(Studio.info).fixedSize(horizontal: false, vertical: true)
            }
            if let err = vm.importError {
                Text(err).font(.studio(11)).foregroundStyle(Studio.warn)
            }
        }
        .padding(14)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
    }

    // MARK: 标题 / 正文

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("标题")
            TextField("给这条笔记起个名…", text: $vm.title)
                .macField()
                .noAutocapitalization()
                .noAutocorrection()
        }
    }

    private var bodyField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("正文（Markdown）")
            TextEditor(text: $vm.body)
                .font(.studio(14))
                .foregroundStyle(Studio.ink)
                .scrollContentBackground(.hidden)
                .padding(10)
                .frame(minHeight: 140)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
                .noAutocapitalization()
                .noAutocorrection()
        }
    }

    // MARK: 笔记本

    private var notebookPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("笔记本")
            Menu {
                Button("不放入笔记本") { vm.selectedNotebookId = nil }
                Divider()
                ForEach(vm.notebooks) { nb in
                    Button {
                        vm.selectedNotebookId = nb.id
                    } label: {
                        Text("\(nb.icon ?? "📓") \(nb.title)")
                    }
                }
            } label: {
                menuLabel(icon: "books.vertical", text: selectedNotebookTitle)
            }
            .menuStyle(.borderlessButton)
        }
    }

    private var selectedNotebookTitle: String {
        guard let id = vm.selectedNotebookId,
              let nb = vm.notebooks.first(where: { $0.id == id }) else { return "不放入笔记本" }
        return "\(nb.icon ?? "📓") \(nb.title)"
    }

    // MARK: 关联课程

    private var coursePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("关联课程")
            Menu {
                Button("不关联课程") { vm.selectedCourseId = nil }
                Divider()
                ForEach(vm.courses) { c in
                    Button(c.title) { vm.selectedCourseId = c.id }
                }
            } label: {
                menuLabel(icon: "book", text: selectedCourseTitle)
            }
            .menuStyle(.borderlessButton)
        }
    }

    private var selectedCourseTitle: String {
        guard let id = vm.selectedCourseId,
              let c = vm.courses.first(where: { $0.id == id }) else { return "不关联课程" }
        return c.title
    }

    // MARK: 标签（多选 + 现场建）

    private var tagSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("标签")
            if vm.tags.isEmpty {
                Text("还没有标签，在下面新建一个。")
                    .font(.studio(12)).foregroundStyle(Studio.ink4)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 70, maximum: 160), spacing: 8, alignment: .leading)],
                          alignment: .leading, spacing: 8) {
                    ForEach(vm.tags) { tag in
                        tagChip(tag)
                    }
                }
            }
            // 现场建标签
            HStack(spacing: 8) {
                TextField("新标签名…", text: $vm.newTagName)
                    .macField()
                    .noAutocapitalization()
                    .noAutocorrection()
                    .onSubmit { Task { await vm.createTag() } }
                Button {
                    Task { await vm.createTag() }
                } label: {
                    HStack(spacing: 4) {
                        if vm.creatingTag { ProgressView().controlSize(.small) }
                        else { Image(systemName: "plus").font(.system(size: 11, weight: .bold)) }
                        Text("建标签").font(.studio(12, .semibold))
                    }
                    .foregroundStyle(Studio.ink)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Studio.border2, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(vm.creatingTag || vm.newTagName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func tagChip(_ tag: MacNoteTag) -> some View {
        let on = vm.selectedTagIds.contains(tag.id)
        return Button {
            if on { vm.selectedTagIds.remove(tag.id) } else { vm.selectedTagIds.insert(tag.id) }
            Haptics.selection()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: on ? "checkmark.circle.fill" : "tag")
                    .font(.system(size: 10, weight: .semibold))
                Text(tag.name).font(.studio(12, .semibold)).lineLimit(1)
            }
            .foregroundStyle(on ? .white : Studio.ink2)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(on ? Studio.red : Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                .strokeBorder(on ? Studio.red : Studio.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: 底栏（提交 / 取消）

    private var footer: some View {
        HStack(spacing: 12) {
            if !vm.selectedTagIds.isEmpty {
                Text("已选 \(vm.selectedTagIds.count) 个标签")
                    .font(.studio(11)).foregroundStyle(Studio.ink3)
            }
            Spacer()
            Button("取消") { dismiss() }
                .buttonStyle(.plain)
                .font(.studio(14, .semibold)).foregroundStyle(Studio.ink2)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                .disabled(vm.creating)

            Button {
                Task {
                    let ok = await vm.submit()
                    if ok { dismiss() }
                }
            } label: {
                HStack(spacing: 6) {
                    if vm.creating { ProgressView().controlSize(.small).tint(.white) }
                    else { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)) }
                    Text("保存笔记").font(.studio(14, .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(Studio.red)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                .shadow(color: Studio.red.opacity(0.28), radius: 10, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(vm.creating)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(Studio.bg2)
    }

    // MARK: 拖放高亮

    @ViewBuilder
    private var dropOverlay: some View {
        if dropTargeted {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Studio.info, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                .background(Studio.infoSoft.opacity(0.4))
                .overlay {
                    VStack(spacing: 8) {
                        Image(systemName: "link.badge.plus")
                            .font(.system(size: 28)).foregroundStyle(Studio.info)
                        Text("松手导入链接").font(.studio(14, .semibold)).foregroundStyle(Studio.info)
                    }
                }
                .allowsHitTesting(false)
                .padding(6)
        }
    }

    // MARK: 小工具

    private func fieldLabel(_ t: String) -> some View {
        Text(t).font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
    }

    private func menuLabel(icon: String, text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(Studio.ink3)
            Text(text).font(.studio(14)).foregroundStyle(Studio.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(Studio.ink4)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
    }
}
#endif
