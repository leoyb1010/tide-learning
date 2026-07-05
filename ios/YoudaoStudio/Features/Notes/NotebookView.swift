import SwiftUI
import Observation

// MARK: - DTO

/// 笔记本（网格项）。后端字段：{id,title,description,icon,noteCount,updatedAt}。
struct Notebook: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String?
    let icon: String?
    let noteCount: Int?
    let updatedAt: Date?

    /// 展示计数。
    var countText: String { "\(noteCount ?? 0) 条" }

    /// 封面色：后端不返回主题色，统一用品牌灰。
    var coverColor: Color { Studio.videoBg }
}

/// GET /api/notebooks 列表响应体：{ notebooks: [] }。
struct NotebooksResponse: Decodable {
    let notebooks: [Notebook]
}

/// GET /api/notebooks/[id] 详情。后端形态：{ notebook:{...}, notes:[] }。
struct NotebookDetail: Decodable {
    let notebook: Notebook
    let notes: [Note]

    /// 便捷透传（兼容旧引用名）。
    var id: String { notebook.id }
    var title: String { notebook.title }
}

// MARK: - 列表 ViewModel

@Observable @MainActor
final class NotebookListViewModel {
    var notebooks: [Notebook] = []
    var loaded = false
    var error: String?
    var loading = false

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            notebooks = try await API.shared.get("/api/notebooks", as: NotebooksResponse.self).notebooks
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }
}

// MARK: - 列表 View（网格）

struct NotebookView: View {
    @State private var vm = NotebookListViewModel()
    @State private var appeared = false
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        Group {
            if vm.loaded {
                content
            } else if let err = vm.error {
                ScrollView { ErrorRetryView(message: err) { Task { await vm.load() } } }
            } else {
                ScrollView { loadingSkeleton }
            }
        }
        .background(Studio.bg)
        .navigationTitle("笔记本")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Notebook.self) { nb in
            NotebookDetailView(notebookId: nb.id, title: nb.title)
        }
        .task { if !vm.loaded { await vm.load() } }
        .refreshable { await vm.load() }
    }

    private var content: some View {
        ScrollView {
            if vm.notebooks.isEmpty {
                EmptyStateView(title: "还没有笔记本", subtitle: "把相关笔记归入笔记本，方便集中复习")
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(vm.notebooks.enumerated()), id: \.element.id) { idx, nb in
                        NavigationLink(value: nb) { cell(nb) }
                            .buttonStyle(.plain)
                            .opacity(appeared || reduceMotion ? 1 : 0)
                            .offset(y: appeared || reduceMotion ? 0 : 14)
                            .animation(
                                reduceMotion ? nil : StudioMotion.smooth.delay(Double(min(idx, 8)) * 0.05),
                                value: appeared
                            )
                    }
                }
                .padding(16)
                .onAppear {
                    if reduceMotion { appeared = true }
                    else { DispatchQueue.main.async { appeared = true } }
                }
            }
        }
    }

    private func cell(_ nb: Notebook) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                // 深色封面用 videoGradient，弃死黑平面。
                Studio.videoGradient
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.white.opacity(0.9))
                // 顶部微高光，材质厚度。
                LinearGradient(colors: [.white.opacity(0.14), .clear], startPoint: .top, endPoint: .center)
                    .allowsHitTesting(false)
            }
            .frame(height: 90)

            VStack(alignment: .leading, spacing: 6) {
                Text(nb.title).font(.studio(14, .semibold)).foregroundStyle(Studio.ink).lineLimit(2)
                StatusBadge(text: nb.countText, tone: .neutral)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
        .shadow(color: StudioElevation.l1(scheme).color, radius: StudioElevation.l1(scheme).radius, x: 0, y: StudioElevation.l1(scheme).y)
        .pressable()
    }

    private var loadingSkeleton: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBar(height: 90).clipShape(RoundedRectangle(cornerRadius: 8))
                    SkeletonBar(height: 14, width: 100)
                    SkeletonBar(height: 12, width: 60)
                }
            }
        }
        .padding(16)
    }
}

// MARK: - 详情 ViewModel

@Observable @MainActor
final class NotebookDetailViewModel {
    let notebookId: String
    var detail: NotebookDetail?
    var loaded = false
    var error: String?
    var loading = false

    init(notebookId: String) { self.notebookId = notebookId }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            detail = try await API.shared.get("/api/notebooks/\(notebookId)", as: NotebookDetail.self)
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }
}

// MARK: - 详情 View

struct NotebookDetailView: View {
    @State private var vm: NotebookDetailViewModel
    /// 复用笔记馆的创建逻辑（记一条 sheet 依赖 NotesViewModel.create）。
    @State private var notesVM = NotesViewModel()
    @State private var showCompose = false
    private let fallbackTitle: String

    init(notebookId: String, title: String) {
        _vm = State(initialValue: NotebookDetailViewModel(notebookId: notebookId))
        fallbackTitle = title
    }

    var body: some View {
        Group {
            if vm.loaded, let detail = vm.detail {
                content(detail)
            } else if let err = vm.error {
                ScrollView { ErrorRetryView(message: err) { Task { await vm.load() } } }
            } else {
                ScrollView { loadingSkeleton }
            }
        }
        .background(Studio.bg)
        .navigationTitle(vm.detail?.title ?? fallbackTitle)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Note.self) { note in
            NoteDetailView(noteId: note.id)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.light(); showCompose = true
                } label: {
                    Label("记一条", systemImage: "plus").font(.studio(14, .semibold))
                }
                .tint(Studio.red)
            }
        }
        .sheet(isPresented: $showCompose) {
            // 预选当前笔记本；保存成功后刷新本页列表，让新笔记即时出现。
            ComposeNoteSheet(
                vm: notesVM,
                presetNotebookId: vm.notebookId,
                onCreated: { Task { await vm.load() } }
            )
        }
        .task { if !vm.loaded { await vm.load() } }
        .refreshable { await vm.load() }
    }

    private func content(_ detail: NotebookDetail) -> some View {
        ScrollView {
            if detail.notes.isEmpty {
                EmptyStateView(
                    title: "笔记本还是空的",
                    subtitle: "把笔记归入这里集中管理",
                    actionTitle: "记一条"
                ) { showCompose = true }
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(detail.notes) { note in
                        NavigationLink(value: note) { NoteCard(note: note) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
        }
    }

    private var loadingSkeleton: some View {
        VStack(spacing: 10) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBar(height: 16, width: 180)
                    SkeletonBar(height: 12)
                    SkeletonBar(height: 12, width: 120)
                }
                .studioCard(padding: 14)
            }
        }
        .padding(16)
    }
}
