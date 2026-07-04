import SwiftUI
import Observation

// /api/desk 聚合响应（对齐后端 iOS-B 新增接口）
struct DeskData: Decodable {
    let greeting: String
    let nickname: String
    let streak: Int
    let litToday: Bool
    let resumeList: [Resume]
    let myCourseCount: Int
    let recentNotes: [RecentNote]
    let dueReviewCount: Int
    let advice: String

    struct Resume: Decodable, Identifiable {
        var id: String { lessonId }
        let courseSlug, courseTitle, lessonId, lessonTitle: String
        let progressPct: Int
        let remainText: String
    }
    struct RecentNote: Decodable, Identifiable {
        let id: String
        let title: String
        let relativeTime: String
    }
}

@Observable @MainActor
final class DeskViewModel {
    var data: DeskData?
    var error: String?
    var loading = false

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do { data = try await API.shared.get("/api/desk", as: DeskData.self) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "加载失败" }
    }
}

struct DeskView: View {
    @State private var vm = DeskViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(TabRouter.self) private var router
    /// 内容进场：数据到达后翻转，驱动分区交错浮现。
    @State private var appeared = false
    /// 报表小卡详情 sheet（日/周/月）。
    @State private var activeReport: DeskReport?
    /// 「我的书架」弹层（五层分类，按需拉 /api/shelf）。
    @State private var showShelf = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let d = vm.data {
                    content(d)
                } else if vm.error != nil {
                    ErrorRetryView(message: vm.error!) { Task { await vm.load() } }
                } else {
                    loadingSkeleton
                }
            }
            .background(Studio.bg)
            .navigationTitle("书桌")
            .task { if vm.data == nil { await vm.load() } }
            .refreshable { await vm.load() }
            .sheet(item: $activeReport) { report in
                if let d = vm.data {
                    ReportDetailSheet(report: report, data: d)
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                }
            }
            .sheet(isPresented: $showShelf) {
                ShelfView()
            }
        }
    }

    private func content(_ d: DeskData) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            // 1. 问候 + 今日点亮态（招呼，让位给「今天想学」主角）
            greeting(d)
                .riseIn(appeared, index: 0, reduceMotion: reduceMotion)

            // 2. 今天想学 = 主角：大号造课主入口，书桌的心跳
            todaysWishHero
                .riseIn(appeared, index: 1, reduceMotion: reduceMotion)

            // 3. 日 / 周 / 月报小卡一排：关键数字 + 迷你趋势，点开详情
            reportRow(d)
                .riseIn(appeared, index: 2, reduceMotion: reduceMotion)

            // 4. 学习中：videoGradient 缩略 + 续学卡（紧凑，可按压）
            if !d.resumeList.isEmpty {
                sectionHeader("学习中", trailing: d.resumeList.count > 1 ? "\(d.resumeList.count) 门进行中" : nil)
                    .riseIn(appeared, index: 3, reduceMotion: reduceMotion)
                ForEach(Array(d.resumeList.prefix(2).enumerated()), id: \.element.id) { idx, r in
                    resumeCard(r)
                        .riseIn(appeared, index: 4 + idx, reduceMotion: reduceMotion)
                }
            }

            // 5. 我的书桌三卡：材质分级 + 语义色点 + 可按压
            sectionHeader("我的书桌")
                .riseIn(appeared, index: 6, reduceMotion: reduceMotion)
            HStack(spacing: 12) {
                deskStat("\(d.myCourseCount)", "门我的课", "book.fill", tone: .neutral)
                deskStat("\(d.recentNotes.count)", "条最近笔记", "square.and.pencil", tone: .info)
                deskStat("\(d.dueReviewCount)", "张待复习", "rectangle.stack.fill", tone: d.dueReviewCount > 0 ? .warn : .neutral, pulseValue: d.dueReviewCount)
            }
            .riseIn(appeared, index: 7, reduceMotion: reduceMotion)

            // 6. 我的书架入口：一行可按压卡，打开五层分类书架弹层
            shelfEntry
                .riseIn(appeared, index: 8, reduceMotion: reduceMotion)

            // 7. AI 建议：深色展示卡 videoGradient（智能气场）
            adviceCard(d.advice)
                .riseIn(appeared, index: 9, reduceMotion: reduceMotion)
        }
        .padding(16)
        .onAppear {
            guard !appeared else { return }
            withAnimation(reduceMotion ? nil : StudioMotion.smooth) { appeared = true }
        }
    }

    // MARK: 问候 + 点亮仪式

    private func greeting(_ d: DeskData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(d.greeting)，\(d.nickname)")
                .font(.studio(22, .bold)).foregroundStyle(Studio.ink)
            HStack(spacing: 8) {
                // 连续天数：mono 强调 + 火苗点亮态
                HStack(spacing: 5) {
                    Image(systemName: d.litToday ? "flame.fill" : "flame")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(d.litToday ? Studio.ok : Studio.ink4)
                    Text("已连续").font(.studio(12)).foregroundStyle(Studio.ink3)
                    Text("\(d.streak)")
                        .font(.mono(14, .bold))
                        .foregroundStyle(d.litToday ? Studio.ok : Studio.ink)
                        .contentTransition(.numericText())
                        .scaleEffect(appeared && d.litToday && !reduceMotion ? 1 : 0.85)
                        .animation(reduceMotion ? nil : StudioMotion.pop, value: d.streak)
                    Text("天").font(.studio(12)).foregroundStyle(Studio.ink3)
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(d.litToday ? Studio.okSoft : Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                        .strokeBorder(d.litToday ? Studio.ok.opacity(0.28) : Studio.border, lineWidth: 1)
                )
                // 点亮态用语义徽章（绿=已点亮 / 琥珀=待点亮），弃裸文字
                if d.litToday {
                    StatusBadge(text: "今天已点亮", icon: "checkmark", tone: .ok)
                } else {
                    StatusBadge(text: "今天还没点亮", icon: "bolt", tone: .warn)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 今天想学（主角：大号造课主入口）

    private var todaysWishHero: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 眉标 + 主标题：一屏最大字号，绝对视觉重心
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(Studio.red)
                Text("STUDY DESK")
                    .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
            }
            Text("今天想学点什么？")
                .font(.studio(28, .bold)).foregroundStyle(Studio.ink)
                .padding(.top, 10)
            Text("说出想学的，AI 帮你造一门课。")
                .font(.studio(13)).foregroundStyle(Studio.ink3)
                .padding(.top, 4)

            // 主输入按钮：材质精致（surface + inner-hi 感），点击带需求进造课台
            Button {
                Haptics.medium()
                router.startCreate()
            } label: {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(Studio.redSoft).frame(width: 32, height: 32)
                        Image(systemName: "sparkles")
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(Studio.red)
                    }
                    Text("说出想学的，AI 造一门课")
                        .font(.studio(15)).foregroundStyle(Studio.ink3)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    // 红 CTA + 品牌柔光（cta-glow 感）
                    ZStack {
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(Studio.red)
                            .frame(width: 42, height: 42)
                            .shadow(color: Studio.red.opacity(0.34), radius: 12, x: 0, y: 4)
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    }
                }
                .padding(8)
                .padding(.leading, 4)
            }
            .buttonStyle(.plain)
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                    .strokeBorder(Studio.border2, lineWidth: 1)
            )
            // 顶部内高光（inner-hi）：亮色下显现材质厚度
            .overlay(alignment: .top) {
                RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.5), lineWidth: 1)
                    .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .center))
            }
            .shadow(color: Studio.red.opacity(0.10), radius: 16, x: 0, y: 6)
            .pressable(scale: 0.985)
            .padding(.top, 16)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("说出想学的，AI 造一门课")
            .accessibilityAddTraits(.isButton)

            // 快捷需求胶囊：一键带需求进造课（对齐 Web SPARKS）
            FlowSuggestions(items: ["面试英语口语", "用 AI 做周报", "给爸妈的智能手机课", "30 分钟学会番茄炒蛋"]) { s in
                Haptics.selection()
                router.startCreate(prompt: s)
            }
            .padding(.top, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 日 / 周 / 月报小卡一排

    private func reportRow(_ d: DeskData) -> some View {
        HStack(spacing: 10) {
            reportCard(.daily, d)
            reportCard(.weekly, d)
            reportCard(.monthly, d)
        }
    }

    private func reportCard(_ kind: DeskReport, _ d: DeskData) -> some View {
        let m = kind.metric(d)
        return Button {
            Haptics.light()
            activeReport = kind
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: kind.icon)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(kind.tone.ink)
                    Text(kind.title)
                        .font(.studio(11, .semibold)).foregroundStyle(Studio.ink2)
                    Spacer(minLength: 0)
                }
                // 关键数字 mono + 单位
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(m.value)
                        .font(.mono(20, .bold)).foregroundStyle(m.ready ? kind.tone.ink : Studio.ink3)
                        .contentTransition(.numericText())
                    if !m.unit.isEmpty {
                        Text(m.unit).font(.studio(10)).foregroundStyle(Studio.ink3)
                    }
                }
                // 迷你趋势：占位就绪时 3 段迷你柱，否则「敬请期待」
                if m.ready {
                    MiniTrend(levels: m.trend, tint: kind.tone.ink)
                } else {
                    Text(m.hint)
                        .font(.studio(9)).foregroundStyle(Studio.ink4).lineLimit(1)
                        .frame(height: 12, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(11)
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                    .strokeBorder(Studio.border, lineWidth: 1)
            )
            .overlay(alignment: .top) {
                RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.5), lineWidth: 1)
                    .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .center))
            }
            .shadow(color: StudioElevation.l1(.light).color, radius: 8, x: 0, y: 3)
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.96, haptic: false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(kind.title)，\(m.value)\(m.unit)。轻点查看详情")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: 续学卡（深色缩略 + 进度）

    private func resumeCard(_ r: DeskData.Resume) -> some View {
        HStack(spacing: 12) {
            // videoGradient 缩略图（弃死黑平面）
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Studio.videoGradient)
                .frame(width: 90, height: 54)
                .overlay(
                    Image(systemName: "play.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white.opacity(0.92))
                )
                .overlay(alignment: .bottomLeading) {
                    // 进度底条，叠在缩略图上
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Studio.red)
                            .frame(width: geo.size.width * CGFloat(r.progressPct) / 100, height: 3)
                    }
                    .frame(height: 3)
                    .padding(.horizontal, 4)
                    .padding(.bottom, 4)
                }
            VStack(alignment: .leading, spacing: 3) {
                Text("从上次继续 · \(r.courseTitle)")
                    .font(.mono(11)).foregroundStyle(Studio.ink3).lineLimit(1)
                Text(r.lessonTitle)
                    .font(.studio(14, .semibold)).foregroundStyle(Studio.ink).lineLimit(1)
                Text(r.remainText)
                    .font(.mono(11)).foregroundStyle(Studio.ink3)
            }
            Spacer(minLength: 8)
            Text("\(r.progressPct)%")
                .font(.mono(15, .bold)).foregroundStyle(Studio.red)
        }
        .studioCard(padding: 12, elevation: 1)
        .pressable()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("继续学习 \(r.courseTitle)，\(r.lessonTitle)，已完成 \(r.progressPct)%")
    }

    // MARK: 三卡（材质分级 + 语义色点）

    private func deskStat(_ v: String, _ label: String, _ icon: String, tone: StatTone, pulseValue: Int? = nil) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                Circle().fill(tone.soft).frame(width: 30, height: 30)
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tone.ink)
            }
            DeskStatNumber(text: v, pulseValue: pulseValue)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
        .pressable()
    }

    private enum StatTone {
        case neutral, info, warn
        var ink: Color {
            switch self { case .neutral: Studio.ink2; case .info: Studio.info; case .warn: Studio.warn }
        }
        var soft: Color {
            switch self { case .neutral: Studio.surface2; case .info: Studio.infoSoft; case .warn: Studio.warnSoft }
        }
    }

    // MARK: AI 建议（深色展示卡）

    private func adviceCard(_ advice: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(.white.opacity(0.14)).frame(width: 34, height: 34)
                Image(systemName: "sparkles")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("学习建议")
                    .font(.studio(11, .semibold)).foregroundStyle(.white.opacity(0.6))
                Text(advice)
                    .font(.studio(14, .semibold)).foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: 我的书架入口

    /// 打开五层书架弹层（AI造课/导入/在学/集市淘的/已完成）。按需拉 /api/shelf。
    private var shelfEntry: some View {
        Button {
            Haptics.light()
            showShelf = true
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Studio.redSoft).frame(width: 34, height: 34)
                    Image(systemName: "books.vertical.fill")
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Studio.red)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("我的书架")
                        .font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                    Text("AI 造课 · 导入 · 在学 · 集市淘的 · 已完成")
                        .font(.studio(11)).foregroundStyle(Studio.ink3).lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.ink4)
            }
        }
        .buttonStyle(.plain)
        .studioCard(padding: 14)
        .pressable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("我的书架，五层分类：AI 造课、导入、在学、集市淘的、已完成")
        .accessibilityAddTraits(.isButton)
    }

    private func sectionHeader(_ title: String, trailing: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.studio(16, .bold)).foregroundStyle(Studio.ink)
            Spacer()
            if let trailing {
                Text(trailing).font(.mono(11)).foregroundStyle(Studio.ink4)
            }
        }
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 18) {
            SkeletonBar(height: 26, width: 200)
            SkeletonBar(height: 16, width: 140)
            SkeletonBar(height: 132).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { _ in
                    SkeletonBar(height: 74).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
                }
            }
            SkeletonBar(height: 78).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            HStack(spacing: 12) {
                ForEach(0..<3, id: \.self) { _ in
                    SkeletonBar(height: 96).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
                }
            }
            SkeletonBar(height: 62).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            SkeletonBar(height: 72).clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg))
        }.padding(16)
    }
}

// MARK: - 报表种类（日 / 周 / 月）

/// 书桌报表小卡种类。日报由 desk 聚合派生，周/月报为占位「敬请期待」（iOS 暂无 weekly-report 接口）。
enum DeskReport: String, Identifiable {
    case daily, weekly, monthly
    var id: String { rawValue }

    var title: String {
        switch self { case .daily: "日报"; case .weekly: "周报"; case .monthly: "月报" }
    }
    var icon: String {
        switch self { case .daily: "sun.max.fill"; case .weekly: "calendar"; case .monthly: "calendar.badge.clock" }
    }
    var tone: ReportTone {
        switch self { case .daily: .ok; case .weekly: .info; case .monthly: .neutral }
    }

    /// 卡面指标（数字 + 单位 + 迷你趋势 + 是否就绪）。
    func metric(_ d: DeskData) -> ReportMetric {
        switch self {
        case .daily:
            // 日报：今日是否点亮 + 连续天数，desk 聚合可直接派生。
            return ReportMetric(
                value: "\(d.streak)", unit: "天连续", ready: true,
                trend: d.litToday ? [2, 3, 3] : [2, 1, 0],
                hint: ""
            )
        case .weekly:
            // 周报：iOS 暂无 weekly-report 接口，用 desk 聚合的「我的课」做近似规模指标，趋势占位。
            return ReportMetric(
                value: "\(d.myCourseCount)", unit: "门在学", ready: true,
                trend: [1, 2, 3],
                hint: ""
            )
        case .monthly:
            // 月报：暂无月度聚合，做成「敬请期待」占位，不报错。
            return ReportMetric(value: "···", unit: "", ready: false, trend: [], hint: "敬请期待")
        }
    }

    /// sheet 详情文案（就绪的用 desk 数据，占位的说明即将上线）。
    func detail(_ d: DeskData) -> ReportDetail {
        switch self {
        case .daily:
            return ReportDetail(
                headline: d.litToday ? "今天已点亮" : "今天还没点亮",
                lines: [
                    ("连续天数", "\(d.streak) 天"),
                    ("今日状态", d.litToday ? "已达成" : "去学一课就点亮"),
                    ("待复习", "\(d.dueReviewCount) 张"),
                ],
                note: d.litToday ? "保持节奏，明天见。" : "10 分钟就够，先点亮今天。"
            )
        case .weekly:
            return ReportDetail(
                headline: "本周概览",
                lines: [
                    ("我的课", "\(d.myCourseCount) 门"),
                    ("最近笔记", "\(d.recentNotes.count) 条"),
                    ("待复习", "\(d.dueReviewCount) 张"),
                ],
                note: "更完整的周报（学习分钟、完课、连击）正在路上。"
            )
        case .monthly:
            return ReportDetail(
                headline: "月报敬请期待",
                lines: [
                    ("月度学习分钟", "即将上线"),
                    ("月度完课", "即将上线"),
                    ("月度连击", "即将上线"),
                ],
                note: "月度回望正在打磨，很快与你见面。"
            )
        }
    }
}

enum ReportTone {
    case ok, info, neutral
    var ink: Color {
        switch self { case .ok: Studio.ok; case .info: Studio.info; case .neutral: Studio.ink2 }
    }
    var soft: Color {
        switch self { case .ok: Studio.okSoft; case .info: Studio.infoSoft; case .neutral: Studio.surface2 }
    }
}

struct ReportMetric {
    let value: String
    let unit: String
    let ready: Bool
    let trend: [Int]   // 迷你柱高档位（0...3）
    let hint: String   // 未就绪时的占位提示
}

struct ReportDetail {
    let headline: String
    let lines: [(String, String)]
    let note: String
}

// MARK: - 迷你趋势柱（3 段档位）

private struct MiniTrend: View {
    let levels: [Int]  // 0...3
    let tint: Color
    var body: some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, lv in
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(lv <= 0 ? Studio.surfaceInset : tint.opacity(0.35 + Double(lv) * 0.22))
                    .frame(width: 5, height: CGFloat(3 + max(0, lv) * 3))
            }
        }
        .frame(height: 12, alignment: .bottomLeading)
        .accessibilityHidden(true)
    }
}

// MARK: - 报表详情 sheet

private struct ReportDetailSheet: View {
    let report: DeskReport
    let data: DeskData
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        let d = report.detail(data)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // 抬头
                HStack(spacing: 10) {
                    ZStack {
                        Circle().fill(report.tone.soft).frame(width: 40, height: 40)
                        Image(systemName: report.icon)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(report.tone.ink)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(report.title).font(.mono(11, .bold)).foregroundStyle(Studio.ink4).tracking(1)
                        Text(d.headline).font(.studio(19, .bold)).foregroundStyle(Studio.ink)
                    }
                    Spacer()
                }

                // 关键数据行
                VStack(spacing: 0) {
                    ForEach(Array(d.lines.enumerated()), id: \.offset) { idx, line in
                        HStack {
                            Text(line.0).font(.studio(14)).foregroundStyle(Studio.ink2)
                            Spacer()
                            Text(line.1).font(.mono(14, .semibold)).foregroundStyle(Studio.ink)
                        }
                        .padding(.vertical, 13)
                        if idx < d.lines.count - 1 {
                            Rectangle().fill(Studio.border).frame(height: 1)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .background(Studio.surface)
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                        .strokeBorder(Studio.border, lineWidth: 1)
                )

                // 备注
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(report.tone.ink)
                    Text(d.note).font(.studio(13)).foregroundStyle(Studio.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(13)
                .background(report.tone.soft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                StudioButton(title: "好的", kind: .ghost) { dismiss() }
                    .padding(.top, 4)
            }
            .padding(20)
            .opacity(reduceMotion || shown ? 1 : 0)
            .offset(y: reduceMotion || shown ? 0 : 10)
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: shown)
        }
        .background(Studio.bg)
        .onAppear { shown = true }
    }
}

// MARK: - 统计卡数字（numericText + 出现脉冲）

/// 三统计卡数字：numericText 平滑翻位；当 pulseValue 从 0→非0（如待复习出现）时来一记 pop 脉冲提醒。
private struct DeskStatNumber: View {
    let text: String
    /// 传入则驱动脉冲；仅 0→非0 强调一次。nil = 不脉冲。
    var pulseValue: Int? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Text(text)
            .font(.mono(22, .bold)).foregroundStyle(Studio.ink)
            .contentTransition(.numericText())
            .scaleEffect(pulse && !reduceMotion ? 1.14 : 1)
            .animation(reduceMotion ? nil : StudioMotion.pop, value: pulse)
            .onChange(of: pulseValue) { old, new in
                guard !reduceMotion, (old ?? 0) == 0, let n = new, n > 0 else { return }
                pulse = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { pulse = false }
            }
    }
}

// MARK: - 快捷需求胶囊（自动换行）

/// 书桌「今天想学」快捷胶囊：一键带需求进造课。轻量自动换行布局。
private struct FlowSuggestions: View {
    let items: [String]
    let onTap: (String) -> Void
    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { s in
                Button {
                    onTap(s)
                } label: {
                    Text(s)
                        .font(.studio(12)).foregroundStyle(Studio.ink2)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Studio.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                                .strokeBorder(Studio.border, lineWidth: 1)
                        )
                        // 触达 ≥44：视觉胶囊紧凑，点击区扩到 44 高。
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .pressable(scale: 0.95, haptic: false)
            }
        }
    }
}

/// 轻量自动换行布局（iOS 16+ Layout）。用于快捷胶囊。
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[CGSize]] = [[]]
        var x: CGFloat = 0
        var rowHeights: [CGFloat] = [0]
        for sub in subviews {
            let sz = sub.sizeThatFits(.unspecified)
            if x + sz.width > maxWidth, x > 0 {
                rows.append([]); rowHeights.append(0); x = 0
            }
            rows[rows.count - 1].append(sz)
            rowHeights[rowHeights.count - 1] = max(rowHeights[rowHeights.count - 1], sz.height)
            x += sz.width + spacing
        }
        let totalH = rowHeights.reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: totalH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for sub in subviews {
            let sz = sub.sizeThatFits(.unspecified)
            if x + sz.width > bounds.minX + maxWidth, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            sub.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(sz))
            x += sz.width + spacing
            rowHeight = max(rowHeight, sz.height)
        }
    }
}

// MARK: - 交错进场修饰

private extension View {
    /// 分区交错浮现：进场时按 index 递增延迟，向上淡入。reduce-motion 直接显示。
    func riseIn(_ appeared: Bool, index: Int, reduceMotion: Bool) -> some View {
        modifier(RiseInModifier(appeared: appeared, index: index, reduceMotion: reduceMotion))
    }
}

private struct RiseInModifier: ViewModifier {
    let appeared: Bool
    let index: Int
    let reduceMotion: Bool
    func body(content: Content) -> some View {
        content
            .opacity(reduceMotion || appeared ? 1 : 0)
            .offset(y: reduceMotion || appeared ? 0 : 14)
            .animation(reduceMotion ? nil : StudioMotion.smooth.delay(Double(index) * 0.05), value: appeared)
    }
}
