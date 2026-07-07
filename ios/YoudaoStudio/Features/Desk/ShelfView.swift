import SwiftUI
import Observation

// MARK: - DTO（对齐 web v4.0 GET /api/shelf 返回 { shelf, total }）

/// GET /api/shelf → { shelf: MyShelf, total }
/// 五层书架：ai_created / imported / learning / collected / completed。
/// 字段完全对齐 src/lib/shelf.ts 的 ShelfCourse。
struct ShelfResponse: Decodable {
    let shelf: MyShelf
    let total: Int
}

/// 书架全量（五个分类，每类一组课）。对齐 web MyShelf = Record<ShelfCategory, ShelfCourse[]>。
struct MyShelf: Decodable {
    let aiCreated: [ShelfCourse]
    let imported: [ShelfCourse]
    let learning: [ShelfCourse]
    let collected: [ShelfCourse]
    let completed: [ShelfCourse]

    // 后端 key 为 snake_case（ai_created），显式映射。
    enum CodingKeys: String, CodingKey {
        case aiCreated = "ai_created"
        case imported, learning, collected, completed
    }
}

/// 书架里单门课的展示形状（对齐 web ShelfCourse）。
/// coverSrc 是 web 真实封面图路径；iOS 走 coverColor/赛道渐变体系，故 coverSrc 仅解码不渲染。
struct ShelfCourse: Decodable, Identifiable, Equatable {
    let id: String
    let slug: String
    let title: String
    let category: String
    let categoryLabel: String
    let lessonsCount: Int
    let origin: String       // official / ai_generated / user_imported
    let progress: Int        // 完课百分比 0-100
    let coverSrc: String     // web 真封面路径；iOS 保留字段但用渐变封面
}

// MARK: - 五层分类元数据

/// 书架分类（五层）+ Tab 展示元数据。顺序对齐 web：AI造课 / 导入 / 在学 / 拿走 / 已完成。
enum ShelfCategory: String, CaseIterable, Identifiable {
    case aiCreated, imported, learning, collected, completed
    var id: String { rawValue }

    /// Tab 文案（对齐任务描述的分类命名）。
    var title: String {
        switch self {
        case .aiCreated: "AI 造课"
        case .imported:  "导入的"
        case .learning:  "在学中"
        case .collected: "集市淘的"
        case .completed: "已完成"
        }
    }
    var icon: String {
        switch self {
        case .aiCreated: "sparkles"
        case .imported:  "square.and.arrow.down"
        case .learning:  "book.fill"
        case .collected: "bag.fill"
        case .completed: "checkmark.seal.fill"
        }
    }
    /// 每层的语义色调（红只留给关键信号，这里用中性/功能色）。
    var tint: Color {
        switch self {
        case .aiCreated: Studio.red        // AI 造课 = 品牌信号
        case .imported:  Studio.info
        case .learning:  Studio.ink2
        case .collected: Studio.info
        case .completed: Studio.ok
        }
    }

    /// 从整份书架取本层的课。
    func courses(in shelf: MyShelf) -> [ShelfCourse] {
        switch self {
        case .aiCreated: shelf.aiCreated
        case .imported:  shelf.imported
        case .learning:  shelf.learning
        case .collected: shelf.collected
        case .completed: shelf.completed
        }
    }

    var emptyHint: String {
        switch self {
        case .aiCreated: "还没有 AI 造的课，去书桌说一句想学的"
        case .imported:  "还没导入过课程"
        case .learning:  "还没有在学的课，去课程库逛逛"
        case .collected: "还没从集市拿走课，去集市看看同学的摊位"
        case .completed: "还没有学完的课，先点亮今天"
        }
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class ShelfViewModel {
    var shelf: MyShelf?
    var total = 0
    var error: String?
    var loading = false

    /// 当前选中的分类 Tab。默认「在学」——书架最常回访层。
    var selected: ShelfCategory = .learning

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let resp = try await API.shared.get("/api/shelf", as: ShelfResponse.self)
            shelf = resp.shelf
            total = resp.total
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "书架加载失败"
        }
    }

    /// 各分类册数（Tab 角标用）。
    func count(_ cat: ShelfCategory) -> Int {
        guard let shelf else { return 0 }
        return cat.courses(in: shelf).count
    }
}

// MARK: - View

/// 我的书架：五层分类 Tab + 课卡网格。以 sheet 从书桌打开。
struct ShelfView: View {
    @State private var vm = ShelfViewModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("我的书架")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .font(.studio(15, .semibold))
                        .foregroundStyle(Studio.ink2)
                }
            }
            .task { if vm.shelf == nil { await vm.load() } }
            .refreshable { await vm.load() }
        }
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if let shelf = vm.shelf {
            VStack(alignment: .leading, spacing: 16) {
                // 藏书总量条
                headerBar(total: vm.total)
                // 五层分类 Tab
                categoryTabs
                // 当前层课卡
                categoryBody(shelf)
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    // MARK: 藏书总量条

    private func headerBar(total: Int) -> some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Studio.redSoft).frame(width: 34, height: 34)
                Image(systemName: "books.vertical.fill")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Studio.red)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("藏书")
                    .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(1)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(total)")
                        .font(.mono(20, .bold)).foregroundStyle(Studio.ink)
                        .contentTransition(.numericText())
                    Text("册").font(.studio(12)).foregroundStyle(Studio.ink3)
                }
            }
            Spacer()
        }
        .padding(14)
        .studioCard(padding: 0)
        .frame(maxWidth: .infinity)
    }

    // MARK: 分类 Tab（横向滚动 pill，带角标）

    private var categoryTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ShelfCategory.allCases) { cat in
                    tab(cat)
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 2)
        }
    }

    private func tab(_ cat: ShelfCategory) -> some View {
        let active = vm.selected == cat
        let n = vm.count(cat)
        return Button {
            guard vm.selected != cat else { return }
            Haptics.selection()
            withAnimation(reduceMotion ? nil : StudioMotion.smooth) { vm.selected = cat }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: cat.icon).font(.system(size: 11, weight: .bold))
                Text(cat.title).font(.studio(13, .semibold))
                if n > 0 {
                    Text("\(n)")
                        .font(.mono(11, .bold))
                        .foregroundStyle(active ? .white.opacity(0.9) : Studio.ink3)
                }
            }
            .foregroundStyle(active ? .white : Studio.ink2)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background {
                if active { cat.tint } else { Studio.surface }
            }
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(active ? Color.clear : Studio.border, lineWidth: 1))
            .shadow(color: active ? cat.tint.opacity(0.22) : .clear, radius: 6, y: 2)
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.95, haptic: false)
    }

    // MARK: 当前层内容

    @ViewBuilder
    private func categoryBody(_ shelf: MyShelf) -> some View {
        let list = vm.selected.courses(in: shelf)
        if list.isEmpty {
            EmptyStateView(
                title: "这一层还空着",
                subtitle: vm.selected.emptyHint,
                icon: vm.selected.icon
            )
            .padding(.top, 20)
            .transition(.opacity)
        } else {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(Array(list.enumerated()), id: \.element.id) { idx, course in
                    ShelfCard(course: course, tint: vm.selected.tint)
                        .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                }
            }
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.selected)
        }
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            SkeletonBar(height: 62).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            HStack(spacing: 8) {
                ForEach(0..<4, id: \.self) { _ in
                    SkeletonBar(height: 34, width: 84).clipShape(Capsule())
                }
            }
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(0..<4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 10) {
                        SkeletonBar(height: 84).clipShape(RoundedRectangle(cornerRadius: 12))
                        SkeletonBar(height: 13, width: 110)
                        SkeletonBar(height: 10, width: 70)
                    }
                    .studioCard(padding: 10)
                }
            }
        }
    }
}

// MARK: - 书架课卡

/// 书架单课卡：赛道渐变封面 + 进度底条 + 标题 + 赛道标签 + 章节数。
struct ShelfCard: View {
    let course: ShelfCourse
    var tint: Color = Studio.ink2

    private var done: Bool { course.progress >= 100 && course.lessonsCount > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                // v3.2：真实封面图（服务端 coverSrc），失败回落赛道渐变
                CoverImage(coverSrc: course.coverSrc, category: course.category)
                    .frame(height: 84)
                    .overlay(
                        LinearGradient(colors: [.clear, .black.opacity(0.30)],
                                       startPoint: .center, endPoint: .bottom)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    )
                // 完课印章角标（右上）
                if done {
                    VStack {
                        HStack {
                            Spacer()
                            HStack(spacing: 3) {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 9, weight: .bold))
                                Text("已完成").font(.mono(9, .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Studio.ok.opacity(0.9))
                            .clipShape(Capsule())
                        }
                        Spacer()
                    }
                    .padding(7)
                }
                // 进度底条（未完课时叠在封面底部）
                if !done && course.progress > 0 {
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Studio.red)
                            .frame(width: geo.size.width * CGFloat(course.progress) / 100, height: 3)
                    }
                    .frame(height: 3)
                    .padding(.horizontal, 6)
                    .padding(.bottom, 6)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(course.title)
                    .font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
                    .lineLimit(2).multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(course.categoryLabel)
                        .font(.studio(10, .semibold)).foregroundStyle(Studio.ink2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Studio.surface2)
                        .clipShape(Capsule())
                    Spacer()
                    if course.lessonsCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "rectangle.stack.fill")
                                .font(.system(size: 9)).foregroundStyle(Studio.ink4)
                            Text("\(course.lessonsCount) 节")
                                .font(.mono(10)).foregroundStyle(Studio.ink3)
                        }
                    }
                }
                // 进度文案（未完课时显示百分比）
                if !done && course.progress > 0 {
                    Text("已学 \(course.progress)%")
                        .font(.mono(10)).foregroundStyle(tint)
                }
            }
            .padding(.top, 10)
        }
        .studioCard(padding: 10)
        .pressable()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(course.title)，\(course.categoryLabel)，\(course.lessonsCount) 节" +
            (done ? "，已完成" : (course.progress > 0 ? "，已学 \(course.progress)%" : ""))
        )
    }
}
