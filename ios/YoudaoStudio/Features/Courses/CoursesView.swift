import SwiftUI
import Observation

// MARK: - DTO

/// GET /api/courses → { courses: [...] }
struct CoursesResponse: Decodable {
    let courses: [Course]
}

/// 课程库列表项（对齐后端 GET /api/courses 真实字段）。
struct Course: Decodable, Identifiable, Equatable {
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
    /// 后端已格式化好的时长文案（如 “1 小时 1 分钟” / “59 分钟”）。列表接口不返回秒数。
    let duration: String?
    let lessonsCount: Int?
    let freeLessonsCount: Int?
    let learnersCount: Int
    let isFeatured: Bool
}

// MARK: - 封面渐变映射

/// coverColor 值 → LinearGradient（不同赛道/主题不同色块）。
enum CourseCover {
    /// 语义化命名 + 兜底哈希取色，保证任意 coverColor 值都有稳定渐变。
    static func gradient(for coverColor: String) -> LinearGradient {
        let pair = colors(for: coverColor)
        return LinearGradient(colors: pair, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private static func colors(for key: String) -> [Color] {
        switch key.lowercased() {
        case "red", "crimson":   return [Color(hex: "#fc011a"), Color(hex: "#7a0410")]
        case "blue", "azure":    return [Color(hex: "#2b6cff"), Color(hex: "#0b2a6b")]
        case "green", "emerald": return [Color(hex: "#1fb673"), Color(hex: "#0a4a2e")]
        case "purple", "violet": return [Color(hex: "#8b5cff"), Color(hex: "#3a1a7a")]
        case "orange", "amber":  return [Color(hex: "#ff8a1f"), Color(hex: "#7a3d05")]
        case "teal", "cyan":     return [Color(hex: "#12b5c8"), Color(hex: "#0a4650")]
        case "pink", "rose":     return [Color(hex: "#ff4f9d"), Color(hex: "#7a0a3f")]
        case "slate", "gray", "grey": return [Color(hex: "#5b6474"), Color(hex: "#232935")]
        default:
            // 兜底：用字符串哈希从调色板挑一对，稳定可复现。
            let palette: [[Color]] = [
                [Color(hex: "#fc011a"), Color(hex: "#7a0410")],
                [Color(hex: "#2b6cff"), Color(hex: "#0b2a6b")],
                [Color(hex: "#1fb673"), Color(hex: "#0a4a2e")],
                [Color(hex: "#8b5cff"), Color(hex: "#3a1a7a")],
                [Color(hex: "#ff8a1f"), Color(hex: "#7a3d05")],
                [Color(hex: "#12b5c8"), Color(hex: "#0a4650")]
            ]
            let idx = abs(key.hashValue) % palette.count
            return palette[idx]
        }
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class CoursesViewModel {
    var courses: [Course]?
    var error: String?
    var loading = false

    /// 搜索关键词（输入即触发 GET /api/courses?q=）。
    var query = ""
    /// 当前选中的赛道筛选（nil = 全部）。
    var selectedCategory: String?

    private var searchTask: Task<Void, Never>?

    /// 从已加载课程里派生赛道 chips（去重、保序）。
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
    var visibleCourses: [Course] {
        guard let courses else { return [] }
        guard let cat = selectedCategory else { return courses }
        return courses.filter { $0.category == cat }
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // 用 URLComponents.queryItems 组装：正确转义 & = + ?（"C++"/"R&D" 不再被破坏）。
        // .urlQueryAllowed 不转义这些字符，会把查询词写坏，故弃用。
        let path = Self.coursesPath(query: q.isEmpty ? nil : q)
        do {
            let resp = try await API.shared.get(path, as: CoursesResponse.self)
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

// MARK: - View

struct CoursesView: View {
    @State private var vm = CoursesViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 主网格首屏进场：内容到达后翻转，驱动课程卡索引交错浮现。
    @State private var gridAppeared = false
    /// 集市入口 push 态（课程库 → 课程集市，同为浏览面的姊妹目的地）。
    @State private var goMarket = false

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    searchField
                    if !vm.categories.isEmpty { categoryChips }
                    content
                }
                .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("课程库")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.light()
                        goMarket = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "storefront.fill").font(.system(size: 12, weight: .semibold))
                            Text("集市").font(.studio(14, .semibold))
                        }
                        .foregroundStyle(Studio.red)
                    }
                    .accessibilityLabel("去逛课程集市")
                }
            }
            .navigationDestination(isPresented: $goMarket) {
                MarketView()
            }
            .task { if vm.courses == nil { await vm.load() } }
            .refreshable { await vm.load() }
        }
    }

    /// 任意 category → trackGradient 支持的 4 赛道键（ai/english/elder/life），未知回退 nil（中性灰渐变）。
    private func trackKey(_ category: String?) -> String? {
        guard let c = category?.lowercased() else { return nil }
        if c.contains("ai") || c.contains("智能") || c.contains("人工") { return "ai" }
        if c.contains("english") || c.contains("英语") || c.contains("语言") { return "english" }
        if c.contains("elder") || c.contains("老") || c.contains("银发") || c.contains("养") { return "elder" }
        if c.contains("life") || c.contains("生活") || c.contains("兴趣") { return "life" }
        return nil
    }

    // MARK: 搜索框

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Studio.ink3)
            TextField("搜索课程 / 老师 / 主题", text: $vm.query)
                .font(.studio(15))
                .foregroundStyle(Studio.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onChange(of: vm.query) { _, _ in vm.onQueryChanged() }
                .onSubmit { Task { await vm.load() } }
            if !vm.query.isEmpty {
                Button {
                    Haptics.light()
                    vm.query = ""
                    Task { await vm.load() }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Studio.ink4)
                        // 视觉不变，命中区扩到 44pt。
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
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
                    chip(title: categoryTitle(cat), category: cat, active: vm.selectedCategory == cat) {
                        selectCategory(vm.selectedCategory == cat ? nil : cat)
                    }
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
    }

    /// 筛选切换：selection 触觉 + smooth 过渡（列表随之交叉淡入）。
    private func selectCategory(_ cat: String?) {
        guard vm.selectedCategory != cat else { return }
        Haptics.selection()
        withAnimation(reduceMotion ? nil : StudioMotion.smooth) {
            vm.selectedCategory = cat
        }
    }

    /// 赛道 pill：选中态用赛道渐变而非全红，红只留给关键信号。
    private func chip(title: String, category: String?, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.studio(13, .semibold))
                .foregroundStyle(active ? .white : Studio.ink2)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background {
                    if active {
                        Studio.trackGradient(trackKey(category))
                    } else {
                        Studio.surface
                    }
                }
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(active ? Color.clear : Studio.border, lineWidth: 1))
                .shadow(color: active ? Color.black.opacity(0.12) : .clear, radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.95, haptic: false)
    }

    /// category chip 显示名：优先课程自带 categoryLabel，回退原值。
    private func categoryTitle(_ cat: String) -> String {
        vm.courses?.first { $0.category == cat }?.categoryLabel ?? cat
    }

    /// 课程卡无障碍汇总文案：标题 + 赛道 + 难度 + 在学人数，供 combine 后整体朗读。
    private func courseCardLabel(_ c: Course) -> String {
        var parts: [String] = [c.title]
        parts.append(c.categoryLabel ?? c.category)
        parts.append(c.levelLabel ?? c.level)
        if c.isFeatured { parts.append("精选") }
        parts.append("\(CourseFormat.learners(c.learnersCount)) 人在学")
        return parts.joined(separator: "，")
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if vm.courses != nil {
            if vm.visibleCourses.isEmpty {
                EmptyStateView(
                    title: vm.query.isEmpty ? "还没有课程" : "没有匹配的课程",
                    subtitle: vm.query.isEmpty ? "稍后再来看看新上架的课" : "换个关键词或赛道试试"
                )
                .padding(.top, 40)
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(vm.visibleCourses.enumerated()), id: \.element.id) { idx, course in
                        NavigationLink { CourseDetailView(course: course) } label: {
                            CourseCard(course: course, trackKey: trackKey(course.category))
                                .pressable()
                        }
                        .buttonStyle(.plain)
                        // 课程卡语义汇总：单元素朗读标题/难度/在学人数。
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(courseCardLabel(course))
                        .accessibilityAddTraits(.isButton)
                        // 首屏索引交错进场（每卡递增延迟向上淡入），reduce-motion 直接显示。
                        .opacity(gridAppeared || reduceMotion ? 1 : 0)
                        .offset(y: gridAppeared || reduceMotion ? 0 : 14)
                        .animation(
                            reduceMotion ? nil
                            : StudioMotion.smooth.delay(Double(min(idx, 8)) * 0.05),
                            value: gridAppeared
                        )
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .scale(scale: 0.96)),
                            removal: .opacity
                        ))
                    }
                }
                // 赛道切换/搜索结果变化时，网格随可见集合平滑重排。
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.visibleCourses)
                .onAppear {
                    guard !gridAppeared else { return }
                    gridAppeared = true
                }
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    private var loadingSkeleton: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    SkeletonBar(height: 96).clipShape(RoundedRectangle(cornerRadius: 12))
                    SkeletonBar(height: 14, width: 120)
                    SkeletonBar(height: 11, width: 80)
                }
                .studioCard(padding: 10)
            }
        }
    }
}

// MARK: - 课程卡

struct CourseCard: View {
    let course: Course
    /// 赛道键（ai/english/elder/life/nil）→ trackGradient 封面。
    var trackKey: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 赛道渐变封面
            ZStack(alignment: .topLeading) {
                Studio.trackGradient(trackKey)
                    .frame(height: 96)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    // 底部压暗，保证白字文案在浅色渐变上可读
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
                    .font(.studio(14, .semibold))
                    .foregroundStyle(Studio.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if let subtitle = course.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.studio(11))
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
                    Text(CourseFormat.learners(course.learnersCount))
                        .font(.mono(10))
                        .foregroundStyle(Studio.ink3)
                }
                .padding(.top, 2)
            }
            .padding(.top, 10)
        }
        .studioCard(padding: 10)
    }
}

// MARK: - 格式化工具

enum CourseFormat {
    /// 秒 → “1h 20m” / “45m” / “30s”。
    static func duration(_ sec: Int) -> String {
        if sec <= 0 { return "0m" }
        let h = sec / 3600
        let m = (sec % 3600) / 60
        if h > 0 { return m > 0 ? "\(h)h \(m)m" : "\(h)h" }
        if m > 0 { return "\(m)m" }
        return "\(sec)s"
    }

    /// 学习人数 → “1.2k 人在学” / “860 人在学”。
    static func learners(_ n: Int) -> String {
        if n >= 10_000 {
            let w = Double(n) / 10_000
            return String(format: "%.1fw", w)
        }
        if n >= 1_000 {
            let k = Double(n) / 1_000
            return String(format: "%.1fk", k)
        }
        return "\(n)"
    }
}
