// Mac 书桌：宽幅重排。复用 /api/desk 聚合响应（DTO 与 iOS DeskData 字段一致）。
//
// iOS DeskViewModel/DeskData 定义在 Features/Desk/DeskView.swift 内，而 Features/ 整个
// 从 Mac target 排除（含大量 iOS-only API），故此处建等价 @Observable VM + DTO，
// 打同一 /api/desk、走同一 APIEnvelope。字段严格对齐后端真实响应（已 curl 核对）：
//   greeting / nickname / streak / litToday / resumeList[Resume] / myCourseCount /
//   recentNotes[RecentNote] / dueReviewCount / advice
#if os(macOS)
import SwiftUI
import Observation

/// Mac 书桌数据（与 iOS DeskData 字段一致；后端 /api/desk 真实响应已核对）。
struct MacDeskData: Decodable {
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
final class MacDeskViewModel {
    var data: MacDeskData?
    var error: String?
    var loading = false

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do { data = try await API.shared.get("/api/desk", as: MacDeskData.self) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "加载失败" }
    }
}

struct MacDeskView: View {
    @State private var vm = MacDeskViewModel()
    /// 跨屏意图：点「今天想学」切造课 Tab（复用 TabRouter 语义，selection=2）。
    @Environment(TabRouter.self) private var router

    var body: some View {
        ScrollView {
            Group {
                if let d = vm.data {
                    content(d)
                } else if let err = vm.error {
                    ErrorRetryView(message: err) { Task { await vm.load() } }
                        .padding(40)
                } else {
                    loadingSkeleton
                }
            }
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)   // 内容居中，宽屏留白
            .padding(28)
        }
        .background(Studio.bg)
        .task { if vm.data == nil { await vm.load() } }
    }

    // MARK: 主内容（宽幅重排）

    private func content(_ d: MacDeskData) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            header(d)
            wishHero
            statRow(d)
            if !d.resumeList.isEmpty {
                sectionHeader("学习中", trailing: d.resumeList.count > 1 ? "\(d.resumeList.count) 门进行中" : nil)
                resumeGrid(d.resumeList)
            }
            adviceCard(d.advice)
        }
    }

    // MARK: 问候 + 连续天数 header

    private func header(_ d: MacDeskData) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(d.greeting)，\(d.nickname)")
                    .font(.studio(28, .bold))
                    .foregroundStyle(Studio.ink)
                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        Image(systemName: d.litToday ? "flame.fill" : "flame")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(d.litToday ? Studio.ok : Studio.ink4)
                        Text("已连续").font(.studio(13)).foregroundStyle(Studio.ink3)
                        Text("\(d.streak)")
                            .font(.mono(15, .bold))
                            .foregroundStyle(d.litToday ? Studio.ok : Studio.ink)
                        Text("天").font(.studio(13)).foregroundStyle(Studio.ink3)
                    }
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .background(d.litToday ? Studio.okSoft : Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                            .strokeBorder(d.litToday ? Studio.ok.opacity(0.28) : Studio.border, lineWidth: 1)
                    )
                    if d.litToday {
                        StatusBadge(text: "今天已点亮", icon: "checkmark", tone: .ok)
                    } else {
                        StatusBadge(text: "今天还没点亮", icon: "bolt", tone: .warn)
                    }
                }
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 今天想学（造课主入口，横向大卡）

    private var wishHero: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(Studio.red)
                Text("STUDY DESK")
                    .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
            }
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("今天想学点什么？")
                        .font(.studio(30, .bold)).foregroundStyle(Studio.ink)
                    Text("说出想学的，AI 帮你造一门课。")
                        .font(.studio(14)).foregroundStyle(Studio.ink3)
                }
                Spacer()
                Button {
                    Haptics.medium()
                    router.startCreate()
                } label: {
                    HStack(spacing: 10) {
                        ZStack {
                            Circle().fill(Studio.redSoft).frame(width: 30, height: 30)
                            Image(systemName: "sparkles")
                                .font(.system(size: 13, weight: .bold)).foregroundStyle(Studio.red)
                        }
                        Text("去造课")
                            .font(.studio(15, .semibold)).foregroundStyle(.white)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Studio.red)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: Studio.red.opacity(0.28), radius: 12, x: 0, y: 4)
                }
                .buttonStyle(.plain)
            }
        }
        .studioCard(padding: 24, elevation: 2)
    }

    // MARK: 三统计卡

    private func statRow(_ d: MacDeskData) -> some View {
        HStack(spacing: 14) {
            statCard("\(d.myCourseCount)", "门我的课", "book.fill", tone: .neutral)
            statCard("\(d.recentNotes.count)", "条最近笔记", "square.and.pencil", tone: .info)
            statCard("\(d.dueReviewCount)", "张待复习", "rectangle.stack.fill",
                     tone: d.dueReviewCount > 0 ? .warn : .neutral)
        }
    }

    private func statCard(_ value: String, _ label: String, _ icon: String, tone: StatusBadge.Tone) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(toneSoft(tone)).frame(width: 44, height: 44)
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(toneInk(tone))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(value).font(.mono(24, .bold)).foregroundStyle(Studio.ink)
                Text(label).font(.studio(12)).foregroundStyle(Studio.ink3)
            }
            Spacer()
        }
        .studioCard(padding: 18)
        .frame(maxWidth: .infinity)
    }

    // MARK: 续学卡横向网格

    private func resumeGrid(_ list: [MacDeskData.Resume]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300, maximum: 520), spacing: 14)], spacing: 14) {
            ForEach(list) { r in
                resumeCard(r)
            }
        }
    }

    private func resumeCard(_ r: MacDeskData.Resume) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // 深色展示头：videoGradient + 剩余时长徽章
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Studio.videoGradient)
                    .frame(height: 84)
                HStack {
                    Text(r.courseTitle)
                        .font(.studio(13, .semibold)).foregroundStyle(.white)
                        .lineLimit(1)
                    Spacer()
                    StatusBadge(text: r.remainText, icon: "clock", tone: .neutral)
                }
                .padding(12)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(r.lessonTitle)
                    .font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
                    .lineLimit(2)
                // 进度条
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Studio.surfaceInset).frame(height: 6)
                        Capsule().fill(Studio.red)
                            .frame(width: max(0, geo.size.width * CGFloat(r.progressPct) / 100), height: 6)
                    }
                }
                .frame(height: 6)
                HStack {
                    Text("已学 \(r.progressPct)%")
                        .font(.mono(11, .semibold)).foregroundStyle(Studio.ink3)
                    Spacer()
                    Text("继续学习")
                        .font(.studio(12, .semibold)).foregroundStyle(Studio.redInk)
                }
            }
            .padding(14)
        }
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                .strokeBorder(Studio.border, lineWidth: 1)
        )
        .pressable()
    }

    // MARK: AI 建议卡（深色展示）

    private func adviceCard(_ advice: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(Color.white.opacity(0.12)).frame(width: 40, height: 40)
                Image(systemName: "sparkles")
                    .font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("AI 建议")
                    .font(.mono(10, .bold)).foregroundStyle(.white.opacity(0.7)).tracking(2)
                Text(advice)
                    .font(.studio(15)).foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
    }

    // MARK: 分区标题

    private func sectionHeader(_ title: String, trailing: String? = nil) -> some View {
        HStack {
            Text(title).font(.studio(17, .bold)).foregroundStyle(Studio.ink)
            Spacer()
            if let trailing {
                Text(trailing).font(.studio(12)).foregroundStyle(Studio.ink3)
            }
        }
    }

    // MARK: 加载骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 10) {
                SkeletonBar(height: 28, width: 260)
                SkeletonBar(height: 20, width: 160)
            }
            SkeletonBar(height: 120)
            HStack(spacing: 14) {
                ForEach(0..<3, id: \.self) { _ in SkeletonBar(height: 76) }
            }
            SkeletonBar(height: 18, width: 120)
            HStack(spacing: 14) {
                SkeletonBar(height: 200); SkeletonBar(height: 200)
            }
        }
    }

    // MARK: tone → 色映射（对齐 StatusBadge 语义色）

    private func toneSoft(_ tone: StatusBadge.Tone) -> Color {
        switch tone {
        case .ok: Studio.okSoft; case .warn: Studio.warnSoft; case .info: Studio.infoSoft
        case .red: Studio.redSoft; case .neutral: Studio.surface2
        }
    }
    private func toneInk(_ tone: StatusBadge.Tone) -> Color {
        switch tone {
        case .ok: Studio.ok; case .warn: Studio.warn; case .info: Studio.info
        case .red: Studio.red; case .neutral: Studio.ink2
        }
    }
}
#endif
