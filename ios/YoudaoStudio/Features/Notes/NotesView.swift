import SwiftUI
import Observation

// MARK: - ViewModel

@Observable @MainActor
final class NotesViewModel {
    var notes: [Note] = []
    var groups: [NoteGroup] = []
    var loaded = false
    var error: String?
    var loading = false

    /// 创建独立笔记中的状态（compose sheet）。
    var creating = false
    var createError: String?

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let resp = try await API.shared.get("/api/notes", as: NotesResponse.self)
            notes = resp.notes
            groups = resp.groups
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// pinned 优先 → updatedAt 倒序。
    var allSorted: [Note] {
        notes.sorted { a, b in
            if a.pinned != b.pinned { return a.pinned && !b.pinned }
            return a.updatedAt > b.updatedAt
        }
    }

    /// 时间轴：纯 updatedAt 倒序。
    var timeline: [Note] {
        notes.sorted { $0.updatedAt > $1.updatedAt }
    }

    /// 画廊：有截帧图的笔记（kind == capture 且有 captureUrl）。
    var galleryNotes: [Note] {
        notes.filter { $0.kind == .capture && $0.captureUrl != nil }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    /// 笔记本入口用：有 notebookId 的笔记计数（NotebookView 负责真实网格）。
    var notebookCount: Int { notes.filter { $0.notebookId != nil }.count }

    /// 创建独立笔记（不传 courseId）。
    func create(title: String, contentMd: String) async -> Bool {
        creating = true; createError = nil
        defer { creating = false }
        struct Body: Encodable { let title: String; let contentMd: String }
        do {
            let new = try await API.shared.post(
                "/api/notes",
                body: Body(title: title, contentMd: contentMd),
                as: Note.self
            )
            notes.insert(new, at: 0)
            return true
        } catch {
            createError = (error as? APIError)?.errorDescription ?? "保存失败"
            return false
        }
    }
}

// MARK: - 五视图枚举

enum NotesTab: String, CaseIterable, Identifiable {
    case all = "全部"
    case timeline = "时间轴"
    case gallery = "画廊"
    case byCourse = "按课程"
    case notebook = "笔记本"
    var id: String { rawValue }
}

// MARK: - View

struct NotesView: View {
    @State private var vm = NotesViewModel()
    @State private var tab: NotesTab = .all
    @State private var showCompose = false
    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
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
            .navigationTitle("笔记馆")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.light()
                        showCompose = true
                    } label: {
                        Label("记一条", systemImage: "plus")
                            .font(.studio(14, .semibold))
                    }
                    .tint(Studio.red)
                }
            }
            .navigationDestination(for: Note.self) { note in
                NoteDetailView(noteId: note.id)
            }
            .sheet(isPresented: $showCompose) {
                ComposeNoteSheet(vm: vm)
            }
            .task { if !vm.loaded { await vm.load() } }
            .refreshable { await vm.load() }
        }
    }

    // MARK: 主体（含 Picker）

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                NotesTabBar(tab: $tab)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                // 视图切换：淡入 + 轻微上移，避免生硬跳变。
                Group {
                    switch tab {
                    case .all: allList
                    case .timeline: timelineList
                    case .gallery: galleryGrid
                    case .byCourse: courseList
                    case .notebook: notebookEntry
                    }
                }
                .transition(reduceMotion ? .opacity : .asymmetric(
                    insertion: .opacity.combined(with: .offset(y: 8)),
                    removal: .opacity))
                .id(tab)
            }
            .padding(.bottom, 24)
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: tab)
        }
        // 切视图时重置进场标记，让下一视图重新编排交错入场。
        .onChange(of: tab) { _, _ in
            appeared = false
            if reduceMotion { appeared = true }
            else { DispatchQueue.main.async { appeared = true } }
        }
        .onAppear {
            if reduceMotion { appeared = true }
            else { DispatchQueue.main.async { appeared = true } }
        }
    }

    /// 四列表统一：ForEach 索引驱动的交错进场；reduceMotion 直接落终态。
    private func stagger<V: View>(_ idx: Int, _ view: V) -> some View {
        view
            .opacity(appeared || reduceMotion ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 14)
            .animation(
                reduceMotion ? nil : StudioMotion.smooth.delay(Double(min(idx, 8)) * 0.05),
                value: appeared
            )
    }

    // MARK: 全部（pinned 优先列表）

    private var allList: some View {
        Group {
            if vm.allSorted.isEmpty {
                EmptyStateView(title: "还没有笔记", subtitle: "点右上角「记一条」开始记录",
                               actionTitle: "记一条") { showCompose = true }
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(Array(vm.allSorted.enumerated()), id: \.element.id) { idx, note in
                        stagger(idx, NavigationLink(value: note) { NoteCard(note: note) }
                            .buttonStyle(.plain))
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: 时间轴

    private var timelineList: some View {
        Group {
            if vm.timeline.isEmpty {
                EmptyStateView(title: "时间轴为空", subtitle: "记录后按时间倒序展示")
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(vm.timeline.enumerated()), id: \.element.id) { idx, note in
                        stagger(idx, HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                // 首节点用红点做焦点信号，其余中性描边点。
                                Circle()
                                    .fill(idx == 0 ? Studio.red : Studio.surface)
                                    .overlay(Circle().strokeBorder(idx == 0 ? Studio.red : Studio.border2, lineWidth: 1.5))
                                    .frame(width: 9, height: 9)
                                    .padding(.top, 18)
                                Rectangle().fill(Studio.border).frame(width: 1).frame(maxHeight: .infinity)
                            }
                            .frame(width: 9)
                            NavigationLink(value: note) { NoteCard(note: note) }
                                .buttonStyle(.plain)
                                .padding(.bottom, 10)
                        })
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: 画廊（截帧）

    private var galleryGrid: some View {
        Group {
            if vm.galleryNotes.isEmpty {
                EmptyStateView(title: "画廊为空", subtitle: "课时截帧的笔记会展示在这里")
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(Array(vm.galleryNotes.enumerated()), id: \.element.id) { idx, note in
                        stagger(idx, NavigationLink(value: note) { galleryCell(note) }
                            .buttonStyle(.plain))
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func galleryCell(_ note: Note) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                // 深色展示区用 videoGradient，弃死黑平面。
                Studio.videoGradient
                if let urlStr = note.captureUrl, let url = URL(string: urlStr) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                        case .empty: ProgressView().tint(.white)
                        case .failure: Image(systemName: "photo").foregroundStyle(.white.opacity(0.6))
                        @unknown default: EmptyView()
                        }
                    }
                } else {
                    Image(systemName: "photo").font(.system(size: 22)).foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(height: 110)
            .clipped()

            VStack(alignment: .leading, spacing: 4) {
                Text(note.displayTitle).font(.studio(13, .semibold)).foregroundStyle(Studio.ink).lineLimit(1)
                Text(RelativeTime.string(from: note.updatedAt)).font(.mono(10)).foregroundStyle(Studio.ink3)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
        .pressable()
    }

    // MARK: 按课程（groups）

    private var courseList: some View {
        Group {
            if vm.groups.isEmpty {
                EmptyStateView(title: "还没有课程笔记", subtitle: "学习课程时记录的笔记会按课程归类")
            } else {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(vm.groups.enumerated()), id: \.element.id) { idx, group in
                        stagger(idx, VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 8) {
                                Image(systemName: "book.fill").font(.system(size: 12)).foregroundStyle(Studio.ink2)
                                Text(group.courseTitle).font(.studio(15, .bold)).foregroundStyle(Studio.ink)
                                StatusBadge(text: "\(group.notes.count) 条", tone: .neutral)
                                Spacer()
                            }
                            ForEach(group.notes) { note in
                                NavigationLink(value: note) { NoteCard(note: note) }
                                    .buttonStyle(.plain)
                            }
                        })
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: 笔记本入口

    private var notebookEntry: some View {
        VStack(spacing: 12) {
            NavigationLink { NotebookView() } label: {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Studio.redSoft)
                            .frame(width: 40, height: 40)
                        Image(systemName: "books.vertical.fill").font(.system(size: 18)).foregroundStyle(Studio.red)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("我的笔记本").font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                        Text("\(vm.notebookCount) 条已归入笔记本").font(.studio(12)).foregroundStyle(Studio.ink3)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.ink4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .studioCard()
                .pressable()
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 12) {
            SkeletonBar(height: 32).clipShape(RoundedRectangle(cornerRadius: 8))
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

// MARK: - 五视图切换条（Studio 风格 + selection 触觉 + 滑动指示）

private struct NotesTabBar: View {
    @Binding var tab: NotesTab
    @Namespace private var ns
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let elev = StudioElevation.l1(scheme)
        return HStack(spacing: 4) {
            ForEach(NotesTab.allCases) { t in
                let selected = t == tab
                Text(t.rawValue)
                    .font(.studio(13, selected ? .semibold : .medium))
                    .foregroundStyle(selected ? Studio.ink : Studio.ink3)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(Studio.surface)
                                .shadow(color: elev.color, radius: 5, x: 0, y: 2)
                                .matchedGeometryEffect(id: "notesTab", in: ns)
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        guard t != tab else { return }
                        Haptics.selection()
                        if reduceMotion { tab = t }
                        else { withAnimation(StudioMotion.smooth) { tab = t } }
                    }
                    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(4)
        .background(Studio.surfaceInset)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - 记一条 sheet

private struct ComposeNoteSheet: View {
    @Bindable var vm: NotesViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var contentMd = ""
    @FocusState private var contentFocused: Bool

    private var canSave: Bool {
        !contentMd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !vm.creating
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("标题").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                        TextField("未命名", text: $title)
                            .font(.studio(16, .semibold))
                            .foregroundStyle(Studio.ink)
                            .padding(12)
                            .background(Studio.surface2)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("正文").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                        TextEditor(text: $contentMd)
                            .font(.studio(15))
                            .foregroundStyle(Studio.ink)
                            .frame(minHeight: 220)
                            .scrollContentBackground(.hidden)
                            .padding(10)
                            .background(Studio.surface2)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .focused($contentFocused)
                    }

                    if let err = vm.createError {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12))
                            Text(err).font(.studio(13))
                        }
                        .foregroundStyle(Studio.redInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Studio.redSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
                    }
                }
                .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("记一条")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }.tint(Studio.ink2)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if vm.creating {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("保存") {
                            Task {
                                let ok = await vm.create(title: title, contentMd: contentMd)
                                if ok { Haptics.success(); dismiss() }
                                else { Haptics.error() }
                            }
                        }
                        .font(.studio(15, .semibold))
                        .tint(Studio.red)
                        .disabled(!canSave)
                    }
                }
            }
            .onAppear { contentFocused = true }
        }
    }
}
