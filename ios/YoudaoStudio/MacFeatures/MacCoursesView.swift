// Mac 课程库（NavigationSplitView 的 Content 列）。复用 GET /api/courses 聚合响应。
//
// Features/Courses/CoursesView.swift 里的 Course DTO / CourseCover / CourseFormat 均在
// Features/ 目录，整目录已从 Mac target 排除（含 iOS-only API），故此处建等价 @Observable VM
// + Decodable DTO + 格式化工具，打同一 /api/courses、走同一 APIEnvelope。字段严格对齐后端
// 真实响应（已 curl 核对）：id/slug/title/subtitle/category/categoryLabel/level/levelLabel/
// coverColor/duration/lessonsCount/freeLessonsCount/learnersCount/isFeatured。
//
// 导航：List(selection:) 选中课程 → 由 MacRootView 的 detail 列渲染 MacCourseDetailView。
#if os(macOS)
import SwiftUI
import Observation

// MARK: - DTO（对齐 GET /api/courses 真实字段）

/// GET /api/courses → { courses: [...] }
struct MacCoursesResponse: Decodable {
    let courses: [MacCourse]
}

/// 课程库列表项。仅声明 UI 需要的字段，其余后端字段忽略。
struct MacCourse: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let slug: String
    let title: String
    let subtitle: String?
    let category: String
    let categoryLabel: String?
    let level: String
    let levelLabel: String?
    let coverColor: String
    let status: String?
    /// 后端已格式化好的时长文案（如 “1 小时 10 分钟” / “59 分钟”）。列表接口不返回秒数。
    let duration: String?
    let lessonsCount: Int?
    let freeLessonsCount: Int?
    let learnersCount: Int
    let isFeatured: Bool

    // 选择/去重仅依赖 id（title 等可能同名）。
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (l: MacCourse, r: MacCourse) -> Bool { l.id == r.id }
}

// MARK: - 赛道映射工具（Mac 端等价，Features 版不可 import）

enum MacCourseFormat {
    /// 任意 category → trackGradient 支持的 4 赛道键（ai/english/elder/life），未知回退 nil。
    static func trackKey(_ category: String?) -> String? {
        guard let c = category?.lowercased() else { return nil }
        if c.contains("ai") || c.contains("智能") || c.contains("人工") { return "ai" }
        if c.contains("english") || c.contains("英语") || c.contains("语言") { return "english" }
        if c.contains("elder") || c.contains("老") || c.contains("银发") || c.contains("养") { return "elder" }
        if c.contains("life") || c.contains("生活") || c.contains("兴趣") { return "life" }
        return nil
    }

    /// 秒 → “1h 10m” / “45m” / “30s”。
    static func duration(_ sec: Int) -> String {
        if sec <= 0 { return "0m" }
        let h = sec / 3600
        let m = (sec % 3600) / 60
        if h > 0 { return m > 0 ? "\(h)h \(m)m" : "\(h)h" }
        if m > 0 { return "\(m)m" }
        return "\(sec)s"
    }

    /// 学习人数 → “1.2w” / “860”。
    static func learners(_ n: Int) -> String {
        if n >= 10_000 { return String(format: "%.1fw", Double(n) / 10_000) }
        if n >= 1_000 { return String(format: "%.1fk", Double(n) / 1_000) }
        return "\(n)"
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class MacCoursesViewModel {
    var courses: [MacCourse]?
    var error: String?
    var loading = false

    /// 搜索关键词（输入防抖后打 GET /api/courses?q=）。
    var query = ""
    /// 当前选中的赛道筛选（nil = 全部）。
    var selectedCategory: String?

    private var searchTask: Task<Void, Never>?

    /// 从已加载课程派生赛道 chips（去重、保序）。
    var categories: [String] {
        guard let courses else { return [] }
        var seen = Set<String>()
        var out: [String] = []
        for c in courses where !seen.contains(c.category) {
            seen.insert(c.category)
            out.append(c.category)
        }
        return out
    }

    /// 赛道筛选后的可见列表（搜索由后端完成；赛道在前端过滤）。
    var visibleCourses: [MacCourse] {
        guard let courses else { return [] }
        guard let cat = selectedCategory else { return courses }
        return courses.filter { $0.category == cat }
    }

    /// category chip 显示名：优先 categoryLabel，回退原值。
    func categoryTitle(_ cat: String) -> String {
        courses?.first { $0.category == cat }?.categoryLabel ?? cat
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let path = Self.coursesPath(query: q.isEmpty ? nil : q)
        do {
            let resp = try await API.shared.get(path, as: MacCoursesResponse.self)
            courses = resp.courses
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 用 URLComponents 组装 /api/courses 路径（带可选 q）。
    /// queryItems 会对特殊字符做正确的百分号编码，避免 & = + ? 破坏查询串。
    static func coursesPath(query: String?) -> String {
        var comps = URLComponents()
        comps.path = "/api/courses"
        if let query, !query.isEmpty {
            comps.queryItems = [URLQueryItem(name: "q", value: query)]
        }
        if let encoded = comps.percentEncodedQuery, !encoded.isEmpty {
            return "\(comps.path)?\(encoded)"
        }
        return comps.path
    }

    /// 输入防抖：停止输入 350ms 后再打网络。
    func onQueryChanged() {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard let self, !Task.isCancelled else { return }
            await self.load()
        }
    }
}

// MARK: - View（Content 列）

/// Mac 课程库：搜索 + 赛道 chips + LazyVGrid 课程卡。
/// 选中课程写回外部 selection，由 detail 列渲染 MacCourseDetailView（NavigationSplitView 三列）。
struct MacCoursesView: View {
    @State private var vm = MacCoursesViewModel()
    /// 与 detail 列联动的选中课程（外部持有，避免选中态随本列重建丢失）。
    @Binding var selection: MacCourse?

    private let columns = [GridItem(.adaptive(minimum: 240, maximum: 420), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                searchField
                if !vm.categories.isEmpty { categoryChips }
                content
            }
            .frame(maxWidth: 980)
            .frame(maxWidth: .infinity)
            .padding(20)
        }
        .background(Studio.bg)
        .task { if vm.courses == nil { await vm.load() } }
    }

    // MARK: 搜索框（用 PlatformShims 的 noAutocapitalization/noAutocorrection）

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Studio.ink3)
            TextField("搜索课程 / 老师 / 主题", text: $vm.query)
                .textFieldStyle(.plain)
                .font(.studio(15))
                .foregroundStyle(Studio.ink)
                .noAutocapitalization()
                .noAutocorrection()
                .onChange(of: vm.query) { _, _ in vm.onQueryChanged() }
                .onSubmit { Task { await vm.load() } }
            if !vm.query.isEmpty {
                Button {
                    vm.query = ""
                    Task { await vm.load() }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Studio.ink4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
    }

    // MARK: 赛道 chips

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(title: "全部", category: nil, active: vm.selectedCategory == nil) {
                    selectCategory(nil)
                }
                ForEach(vm.categories, id: \.self) { cat in
                    chip(title: vm.categoryTitle(cat), category: cat, active: vm.selectedCategory == cat) {
                        selectCategory(vm.selectedCategory == cat ? nil : cat)
                    }
                }
            }
            .padding(.horizontal, 2).padding(.vertical, 2)
        }
    }

    private func selectCategory(_ cat: String?) {
        guard vm.selectedCategory != cat else { return }
        Haptics.selection()
        withAnimation(StudioMotion.smooth) { vm.selectedCategory = cat }
    }

    /// 赛道 pill：选中态用赛道渐变而非全红，红只留给关键信号。
    private func chip(title: String, category: String?, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.studio(13, .semibold))
                .foregroundStyle(active ? .white : Studio.ink2)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background {
                    if active { Studio.trackGradient(MacCourseFormat.trackKey(category)) }
                    else { Studio.surface }
                }
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(active ? Color.clear : Studio.border, lineWidth: 1))
                .shadow(color: active ? Color.black.opacity(0.12) : .clear, radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.95, haptic: false)
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if vm.courses != nil {
            if vm.visibleCourses.isEmpty {
                EmptyStateView(
                    title: vm.query.isEmpty ? "还没有课程" : "没有匹配的课程",
                    subtitle: vm.query.isEmpty ? "稍后再来看看新上架的课" : "换个关键词或赛道试试",
                    icon: "safari"
                )
                .padding(.top, 40)
            } else {
                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(vm.visibleCourses) { course in
                        Button {
                            Haptics.light()
                            selection = course
                        } label: {
                            MacCourseCard(course: course, active: selection?.id == course.id)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(cardLabel(course))
                        .accessibilityAddTraits(.isButton)
                    }
                }
                .animation(StudioMotion.smooth, value: vm.visibleCourses)
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    private func cardLabel(_ c: MacCourse) -> String {
        var parts: [String] = [c.title, c.categoryLabel ?? c.category, c.levelLabel ?? c.level]
        if c.isFeatured { parts.append("精选") }
        parts.append("\(MacCourseFormat.learners(c.learnersCount)) 人在学")
        return parts.joined(separator: "，")
    }

    private var loadingSkeleton: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    SkeletonBar(height: 104).clipShape(RoundedRectangle(cornerRadius: 12))
                    SkeletonBar(height: 14, width: 140)
                    SkeletonBar(height: 11, width: 90)
                }
                .studioCard(padding: 10)
            }
        }
    }
}

// MARK: - 课程卡

struct MacCourseCard: View {
    let course: MacCourse
    /// 选中态（对应 detail 列正在展示的课程）→ 描红边高亮。
    var active: Bool = false

    private var trackKey: String? { MacCourseFormat.trackKey(course.category) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 赛道渐变封面
            ZStack(alignment: .topLeading) {
                Studio.trackGradient(trackKey)
                    .frame(height: 104)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        LinearGradient(colors: [.clear, .black.opacity(0.28)],
                                       startPoint: .center, endPoint: .bottom)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    )
                if course.isFeatured {
                    HStack(spacing: 3) {
                        Image(systemName: "star.fill").font(.system(size: 8, weight: .bold))
                        Text("精选").font(.mono(10, .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(.black.opacity(0.32))
                    .clipShape(Capsule())
                    .padding(8)
                }
                VStack {
                    Spacer()
                    HStack {
                        Text(course.levelLabel ?? course.level)
                            .font(.mono(10, .semibold))
                            .foregroundStyle(.white.opacity(0.92))
                        Spacer()
                        if let duration = course.duration, !duration.isEmpty {
                            Text(duration)
                                .font(.mono(10, .semibold))
                                .foregroundStyle(.white.opacity(0.92))
                        }
                    }
                    .padding(8)
                }
            }
            // 文本区
            VStack(alignment: .leading, spacing: 4) {
                Text(course.title)
                    .font(.studio(15, .semibold))
                    .foregroundStyle(Studio.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let subtitle = course.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.studio(12))
                        .foregroundStyle(Studio.ink3)
                        .lineLimit(1)
                }
                HStack(spacing: 6) {
                    Text(course.categoryLabel ?? course.category)
                        .font(.studio(10, .semibold))
                        .foregroundStyle(Studio.ink2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Studio.surface2)
                        .clipShape(Capsule())
                    Spacer()
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(Studio.ink4)
                    Text(MacCourseFormat.learners(course.learnersCount))
                        .font(.mono(10))
                        .foregroundStyle(Studio.ink3)
                }
                .padding(.top, 2)
            }
            .padding(.top, 10)
        }
        .studioCard(padding: 10)
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                .strokeBorder(active ? Studio.red : Color.clear, lineWidth: 2)
        )
        .pressable()
    }
}
#endif
