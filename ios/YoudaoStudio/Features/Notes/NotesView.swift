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

    /// cursor 分页态：nextCursor 为下一页起点（nil = 没有更多）；total 供「共 N 条」展示。
    var nextCursor: String?
    var total: Int?
    var loadingMore = false
    /// 加载代际：refresh 会重置 cursor，代际号自增使 in-flight 的旧 loadMore 结果作废。
    private var loadGeneration = 0

    /// 创建独立笔记中的状态（compose sheet）。
    var creating = false
    var createError: String?

    /// 首页加载 / 下拉刷新：重置 cursor，从第一页重新拉。
    func load() async {
        loading = true; error = nil
        loadGeneration += 1
        defer { loading = false }
        do {
            let resp = try await API.shared.get("/api/notes", as: NotesResponse.self)
            notes = resp.notes
            groups = resp.groups
            nextCursor = resp.nextCursor
            total = resp.total
            loaded = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 是否还有下一页。
    var hasMore: Bool { nextCursor != nil }

    /// 滚动到底自动加载下一页。防抖（loadingMore 闩）+ 按 id 去重 + 代际校验（刷新后丢弃旧页）。
    func loadMore() async {
        guard let cursor = nextCursor, !loadingMore, !loading else { return }
        loadingMore = true
        let generation = loadGeneration
        defer { loadingMore = false }
        do {
            let resp = try await API.shared.get("/api/notes?cursor=\(cursor)", as: NotesResponse.self)
            // 等待期间发生过刷新 → 本页数据基于旧 cursor，直接作废。
            guard generation == loadGeneration else { return }
            let existing = Set(notes.map(\.id))
            notes.append(contentsOf: resp.notes.filter { !existing.contains($0.id) })
            mergeGroups(resp.groups)
            nextCursor = resp.nextCursor
            total = resp.total
        } catch {
            // 触底加载失败不打断浏览；保留 cursor，下次触底自动重试。
        }
    }

    /// 把新页的课程分组并入已有分组（按 courseId 合并、组内按 id 去重）。
    private func mergeGroups(_ incoming: [NoteGroup]) {
        for g in incoming {
            if let idx = groups.firstIndex(where: { $0.courseId == g.courseId }) {
                let existingIds = Set(groups[idx].items.map(\.id))
                let merged = groups[idx].items + g.items.filter { !existingIds.contains($0.id) }
                groups[idx] = NoteGroup(courseId: g.courseId,
                                        course: groups[idx].course ?? g.course,
                                        items: merged)
            } else {
                groups.append(g)
            }
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

    /// 创建独立笔记，支持智能化字段：归入笔记本 / 关联标签 / 软关联课程。
    /// notebookId/courseId 为空则不传；tagIds 空则不传（对齐 web POST /api/notes 语义）。
    /// 软关联课程（仅 courseId、无 lessonId）不解锁章节内容，后端只校验课程可浏览。
    func create(
        title: String,
        contentMd: String,
        notebookId: String? = nil,
        courseId: String? = nil,
        tagIds: [String] = []
    ) async -> Bool {
        // 防双击重复创建：已在提交中直接拒绝（UI 禁用之外的最后闸门，防同一 runloop 双 Task）。
        guard !creating else { return false }
        creating = true; createError = nil
        defer { creating = false }
        // 可空字段用 Optional 编码；JSONEncoder 默认跳过 nil，不会发多余键。
        struct Body: Encodable {
            let title: String
            let contentMd: String
            let notebookId: String?
            let courseId: String?
            let tagIds: [String]?
        }
        let body = Body(
            title: title,
            contentMd: contentMd,
            notebookId: notebookId,
            courseId: courseId,
            tagIds: tagIds.isEmpty ? nil : tagIds
        )
        do {
            let new = try await API.shared.post("/api/notes", body: body, as: Note.self)
            if !notes.contains(where: { $0.id == new.id }) {
                notes.insert(new, at: 0)
                if let t = total { total = t + 1 }
            }
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

    /// 触底自动翻页：仅当出现的是列表最后一项时才拉下一页（去重防抖由 VM 负责）。
    private func loadMoreIfLast(_ idx: Int, of count: Int) {
        guard idx == count - 1, vm.hasMore else { return }
        Task { await vm.loadMore() }
    }

    /// 分页 footer：加载中转圈；还有更多但未触发时留白占位。
    @ViewBuilder
    private var pagingFooter: some View {
        if vm.loadingMore {
            HStack {
                Spacer()
                ProgressView().controlSize(.small)
                Text("加载更多…").font(.studio(12)).foregroundStyle(Studio.ink3)
                Spacer()
            }
            .padding(.vertical, 12)
        }
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
                            .onAppear { loadMoreIfLast(idx, of: vm.allSorted.count) }
                    }
                    pagingFooter
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
                        .onAppear { loadMoreIfLast(idx, of: vm.timeline.count) }
                    }
                    pagingFooter
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
                            // 画廊是过滤后的子集，后续页可能才有截帧笔记 → 同样触底翻页。
                            .onAppear { loadMoreIfLast(idx, of: vm.galleryNotes.count) }
                    }
                }
                .padding(.horizontal, 16)
                pagingFooter
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
                        // 最后一组出现 → 拉下一页，分组随 mergeGroups 增量并入。
                        .onAppear { loadMoreIfLast(idx, of: vm.groups.count) }
                    }
                    pagingFooter
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

// MARK: - 记一条 sheet（智能化：标题 / 正文 / 笔记本 / 标签 / 关联课程）

struct ComposeNoteSheet: View {
    @Bindable var vm: NotesViewModel
    /// 从笔记本详情页进入时预选的笔记本 id（其它入口为 nil）。
    var presetNotebookId: String? = nil
    /// 保存成功回调（笔记本详情页据此刷新自身列表）。
    var onCreated: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var options = ComposeOptionsLoader()

    @State private var title = ""
    @State private var contentMd = ""
    @State private var selectedNotebookId: String?
    @State private var selectedCourseId: String?
    @State private var selectedTagIds: Set<String> = []
    @State private var didApplyPreset = false
    @FocusState private var contentFocused: Bool

    private var canSave: Bool {
        !contentMd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !vm.creating
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    fieldGroup("标题") {
                        TextField("未命名", text: $title)
                            .font(.studio(16, .semibold))
                            .foregroundStyle(Studio.ink)
                            .padding(12)
                            .background(Studio.surface2)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    fieldGroup("正文") {
                        TextEditor(text: $contentMd)
                            .font(.studio(15))
                            .foregroundStyle(Studio.ink)
                            .frame(minHeight: 180)
                            .scrollContentBackground(.hidden)
                            .padding(10)
                            .background(Studio.surface2)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .focused($contentFocused)
                    }

                    // 智能化三件套：笔记本 / 标签 / 关联课程。空数据源自动隐藏对应块。
                    NotebookPicker(
                        notebooks: options.options.notebooks,
                        selectedId: $selectedNotebookId
                    )
                    TagMultiPicker(
                        tags: options.options.tags,
                        selectedIds: $selectedTagIds,
                        creating: options.creatingTag,
                        onCreate: { name in
                            if let tag = await options.createTag(name: name) {
                                selectedTagIds.insert(tag.id)
                            }
                        }
                    )
                    CourseAssociationPicker(
                        courses: options.options.courses,
                        selectedId: $selectedCourseId
                    )

                    if let err = vm.createError {
                        errorBanner(err)
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
                        Button("保存") { Task { await save() } }
                            .font(.studio(15, .semibold))
                            .tint(Studio.red)
                            .disabled(!canSave)
                    }
                }
            }
            .task {
                await options.load()
                applyPresetIfNeeded()
            }
            .onAppear { contentFocused = true }
        }
    }

    private func save() async {
        let ok = await vm.create(
            title: title,
            contentMd: contentMd,
            notebookId: selectedNotebookId,
            courseId: selectedCourseId,
            tagIds: Array(selectedTagIds)
        )
        if ok {
            Haptics.success()
            onCreated?()
            dismiss()
        } else {
            Haptics.error()
        }
    }

    /// 预选笔记本：仅当该本存在于选项里才落选（避免选到不属于本人的本）。
    private func applyPresetIfNeeded() {
        guard !didApplyPreset, let preset = presetNotebookId else { return }
        didApplyPreset = true
        if options.options.notebooks.contains(where: { $0.id == preset }) {
            selectedNotebookId = preset
        }
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
            content()
        }
    }

    private func errorBanner(_ err: String) -> some View {
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
