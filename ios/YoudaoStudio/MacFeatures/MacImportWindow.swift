// Mac「导入资料」窗（菜单栏 文件 → 导入资料… / ⌘⇧I 打开）。
//
// Features/Create 是 iOS 专属（含 iOS-only API），Mac 不编译，故 Mac 端用本窗独立实现：
// 复用 Core 的 API.shared / 共享 DTO（GeneratedCourse / AiModelsResponse），走同一批后端端点
// import-source / import-file / generate-lesson。UI 走原生 macOS 控件（Picker 菜单 / NSOpenPanel）。
#if os(macOS)
import SwiftUI
import Observation
import UniformTypeIdentifiers

@Observable @MainActor
final class MacImportVM {
    var title = ""
    var text = ""
    var template = "classic"
    var model = ""
    var templates: [AiModelsResponse.Template] = []
    var models: [AiModelsResponse.Model] = []

    var busy = false
    var stageText = ""
    var error: String?
    var done: GeneratedCourse?
    var doneCount = 0

    func loadOptions() async {
        guard templates.isEmpty else { return }
        if let res = try? await API.shared.get("/api/ai/models", as: AiModelsResponse.self) {
            templates = res.templates
            models = res.models
            template = res.defaultTemplate
            if let dm = res.defaultModel { model = dm }
        }
    }

    func importText() async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 100 else { error = "资料太短，至少 100 字才好拆成课"; return }
        struct Body: Encodable { let title: String?; let rawText: String; let template: String; let model: String? }
        await run {
            try await API.shared.post("/api/ai/import-source",
                body: Body(title: self.title.isEmpty ? nil : self.title, rawText: t,
                           template: self.template, model: self.model.isEmpty ? nil : self.model),
                as: GeneratedCourse.self)
        }
    }

    func importFile(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), data.count > 0 else { error = "读取文件失败，请重试"; return }
        guard data.count <= 15_000_000 else { error = "文件过大（上限 15MB）"; return }
        let ext = url.pathExtension.lowercased()
        guard ["pdf", "docx", "txt", "md", "markdown"].contains(ext) else {
            error = "仅支持 PDF / Word(.docx) / TXT / Markdown 文件"; return
        }
        var fields = ["template": template]
        if !title.isEmpty { fields["title"] = title }
        if !model.isEmpty { fields["model"] = model }
        await run {
            try await API.shared.upload("/api/ai/import-file",
                fileData: data, fileName: url.lastPathComponent, mimeType: Self.mime(ext), fields: fields,
                as: GeneratedCourse.self)
        }
    }

    private static func mime(_ e: String) -> String {
        switch e {
        case "pdf": return "application/pdf"
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "md", "markdown": return "text/markdown"
        default: return "text/plain"
        }
    }

    private func run(_ fetch: () async throws -> GeneratedCourse) async {
        guard !busy else { return }
        busy = true; error = nil; done = nil; doneCount = 0; stageText = "正在拆分章节…"
        do {
            let course = try await fetch()
            stageText = "正在逐节生成…"
            struct LB: Encodable { let courseId: String; let lessonId: String }
            for l in course.lessons {
                if (try? await API.shared.post("/api/ai/generate-lesson",
                        body: LB(courseId: course.courseId, lessonId: l.id),
                        as: GeneratedLessonResult.self)) != nil {
                    doneCount += 1
                    stageText = "已生成 \(doneCount)/\(course.lessons.count) 节"
                }
            }
            done = course
        } catch let e as APIError {
            error = e.errorDescription ?? "导入失败"
        } catch {
            self.error = "导入失败"
        }
        busy = false
    }
}

struct MacImportWindow: View {
    @Environment(\.openWindow) private var openWindow
    @State private var vm = MacImportVM()
    @State private var showFileImporter = false

    private var importTypes: [UTType] {
        var t: [UTType] = [.pdf, .plainText]
        if let docx = UTType("org.openxmlformats.wordprocessingml.document") { t.append(docx) }
        if let md = UTType(filenameExtension: "md") { t.append(md) }
        return t
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("导入资料，变成一门课")
                    .font(.studio(18, .bold)).foregroundStyle(Studio.ink)

                if let course = vm.done {
                    successCard(course)
                } else {
                    form
                }
            }
            .padding(24)
        }
        .frame(minWidth: 460, minHeight: 560)
        .background(Studio.bg)
        .task { await vm.loadOptions() }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: importTypes, allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first {
                Task { await vm.importFile(url) }
            }
        }
    }

    @ViewBuilder private var form: some View {
        TextField("课程标题（可留空，AI 帮你起）", text: $vm.title)
            .textFieldStyle(.roundedBorder)

        // 模板 + 模型（Mac 用原生菜单 Picker）
        if !vm.templates.isEmpty {
            HStack(spacing: 12) {
                Picker("课件模板", selection: $vm.template) {
                    ForEach(vm.templates) { t in Text(t.label).tag(t.key) }
                }
                if vm.models.count > 1 {
                    Picker("模型", selection: $vm.model) {
                        ForEach(vm.models) { m in Text(m.label).tag(m.key) }
                    }
                }
            }
        }

        Button {
            showFileImporter = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up.doc.fill").foregroundStyle(Studio.red)
                Text("选择文件（PDF / Word / TXT / Markdown，≤15MB）")
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Studio.surfaceInset)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [6])).foregroundStyle(Studio.border2))
        }
        .buttonStyle(.plain)
        .disabled(vm.busy)

        HStack(spacing: 10) {
            Rectangle().fill(Studio.border).frame(height: 1)
            Text("或直接粘贴文本").font(.studio(11)).foregroundStyle(Studio.ink4).fixedSize()
            Rectangle().fill(Studio.border).frame(height: 1)
        }

        TextEditor(text: $vm.text)
            .font(.studio(14))
            .frame(minHeight: 160)
            .padding(6)
            .background(Studio.surfaceInset)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))

        if let err = vm.error {
            Text(err).font(.studio(12)).foregroundStyle(Studio.redInk)
        }
        if vm.busy {
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text(vm.stageText).font(.studio(12)).foregroundStyle(Studio.ink3) }
        }

        StudioButton(title: "把粘贴的资料升维成课", kind: .red, icon: "wand.and.stars") {
            Task { await vm.importText() }
        }
        .disabled(vm.busy || vm.text.trimmingCharacters(in: .whitespacesAndNewlines).count < 100)
    }

    private func successCard(_ course: GeneratedCourse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Studio.ok)
                Text("已生成《\(course.title ?? "导入课")》· \(vm.doneCount)/\(course.lessons.count) 节")
                    .font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
            }
            if let first = course.lessons.first {
                StudioButton(title: "打开第一节", kind: .red, icon: "play.fill") {
                    openWindow(id: "player", value: first.id)
                }
            }
            StudioButton(title: "再导一份", kind: .ghost, icon: "arrow.counterclockwise") {
                vm.done = nil; vm.text = ""; vm.title = ""
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
#endif
