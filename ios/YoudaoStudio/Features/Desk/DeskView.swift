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
    /// 内容进场：数据到达后翻转，驱动分区交错浮现。
    @State private var appeared = false

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
        }
    }

    private func content(_ d: DeskData) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            greeting(d)
                .riseIn(appeared, index: 0, reduceMotion: reduceMotion)

            // 学习中：videoGradient 缩略 + 续学卡（可点按压）
            if !d.resumeList.isEmpty {
                sectionHeader("学习中")
                    .riseIn(appeared, index: 1, reduceMotion: reduceMotion)
                ForEach(Array(d.resumeList.enumerated()), id: \.element.id) { idx, r in
                    resumeCard(r)
                        .riseIn(appeared, index: 2 + idx, reduceMotion: reduceMotion)
                }
            }

            // 我的书桌三卡：材质分级 + pressable
            sectionHeader("我的书桌")
                .riseIn(appeared, index: 2 + d.resumeList.count, reduceMotion: reduceMotion)
            HStack(spacing: 12) {
                deskStat("\(d.myCourseCount)", "门我的课", "book.fill", tone: .neutral)
                deskStat("\(d.recentNotes.count)", "条最近笔记", "square.and.pencil", tone: .info)
                deskStat("\(d.dueReviewCount)", "张待复习", "rectangle.stack.fill", tone: d.dueReviewCount > 0 ? .warn : .neutral, pulseValue: d.dueReviewCount)
            }
            .riseIn(appeared, index: 3 + d.resumeList.count, reduceMotion: reduceMotion)

            // AI 建议：深色展示卡 videoGradient
            adviceCard(d.advice)
                .riseIn(appeared, index: 4 + d.resumeList.count, reduceMotion: reduceMotion)
        }
        .padding(16)
        .onAppear {
            guard !appeared else { return }
            withAnimation(reduceMotion ? nil : StudioMotion.smooth) { appeared = true }
        }
    }

    // MARK: 问候 + 点亮仪式

    private func greeting(_ d: DeskData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(d.greeting)，\(d.nickname)")
                .font(.studio(24, .bold)).foregroundStyle(Studio.ink)
            HStack(spacing: 8) {
                // 连续天数：mono 强调 + 火苗点亮态
                HStack(spacing: 5) {
                    Image(systemName: d.litToday ? "flame.fill" : "flame")
                        .font(.system(size: 13, weight: .semibold))
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

    private func sectionHeader(_ title: String) -> some View {
        Text(title).font(.studio(16, .bold)).foregroundStyle(Studio.ink)
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            SkeletonBar(height: 28, width: 200)
            SkeletonBar(height: 16, width: 140)
            SkeletonBar(height: 78).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            HStack(spacing: 12) {
                ForEach(0..<3, id: \.self) { _ in
                    SkeletonBar(height: 96).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
                }
            }
            SkeletonBar(height: 72).clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg))
        }.padding(16)
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
