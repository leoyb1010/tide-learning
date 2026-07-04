import SwiftUI
import Charts

/// 学习进度：本周学习节奏柱状图（Swift Charts + 动画 + 网格）+ 学习中课程。
struct LearningProgressView: View {
    let gamification: GamificationData
    let resumeList: [DeskData.Resume]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 柱状图入场动画：0→1 驱动柱高生长。
    @State private var chartProgress: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            weeklyRhythmCard
            if !resumeList.isEmpty {
                resumeCards
            }
        }
    }

    // MARK: 本周学习节奏（Swift Charts 柱状图）

    private var weeklyRhythmCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("本周学习节奏").font(.studio(14, .bold)).foregroundStyle(Studio.ink)
                Spacer()
                if weeklyTotal > 0 {
                    // 本周总量：mono 数字 + 语义徽章。
                    StatusBadge(text: "本周 \(weeklyTotal) 分钟", icon: "clock.fill", tone: .info)
                } else {
                    Text("分钟 / 天").font(.mono(10)).foregroundStyle(Studio.ink4)
                }
            }

            if weekData.contains(where: { $0.minutes > 0 }) {
                Chart(weekData) { day in
                    BarMark(
                        x: .value("日", day.weekdayLabel),
                        y: .value("分钟", Double(day.minutes) * Double(chartProgress))
                    )
                    // 今日用品牌红点亮，其余用墨色，弱化空天。
                    .foregroundStyle(barStyle(for: day))
                    .cornerRadius(5)
                    // 峰值标注：本周最高的一天。
                    .annotation(position: .top, alignment: .center) {
                        if day.id == peakDayID && day.minutes > 0 && chartProgress > 0.9 {
                            Text("\(day.minutes)")
                                .font(.mono(9, .bold))
                                .foregroundStyle(Studio.ink2)
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { _ in
                        AxisGridLine().foregroundStyle(Studio.border)
                        AxisValueLabel().font(.mono(9)).foregroundStyle(Studio.ink4)
                    }
                }
                .chartXAxis {
                    AxisMarks { value in
                        let label = value.as(String.self)
                        let isToday = label != nil && label == todayWeekdayLabel
                        AxisValueLabel().font(.mono(10)).foregroundStyle(isToday ? Studio.red : Studio.ink3)
                    }
                }
                // 固定 Y 轴上限，避免生长动画期间坐标轴跳动。
                .chartYScale(domain: 0...Double(maxMinutes))
                .frame(height: 140)
                .onAppear {
                    if reduceMotion { chartProgress = 1 }
                    else { withAnimation(StudioMotion.smooth.delay(0.15)) { chartProgress = 1 } }
                }
                .accessibilityLabel("本周学习节奏图，共 \(weeklyTotal) 分钟")
            } else {
                EmptyStateView(
                    title: "本周还没有记录",
                    subtitle: "去点亮第一天，让节奏跑起来。",
                    icon: "chart.bar"
                )
            }
        }
        .studioCard()
    }

    /// 柱色：今日红，其它天墨色，无记录浅底。
    private func barStyle(for day: WeekPoint) -> Color {
        if day.minutes == 0 { return Studio.surfaceInset }
        return day.isToday ? Studio.red : Studio.ink
    }

    /// 今日在 X 轴上的中文星期标签（用于高亮今日刻度）。
    private var todayWeekdayLabel: String? {
        weekData.first(where: { $0.isToday })?.weekdayLabel
    }

    // MARK: 学习中课程（复用 /api/desk resumeList 样式）

    private var resumeCards: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("学习中").font(.studio(13, .semibold)).foregroundStyle(Studio.ink2)
            ForEach(resumeList) { r in
                NavigationLink {
                    LearnView(lessonId: r.lessonId)
                } label: {
                    HStack(spacing: 12) {
                        // 缩略图：深色展示区用 videoGradient，弃平面死色。
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Studio.videoGradient)
                            .frame(width: 80, height: 48)
                            .overlay(
                                Image(systemName: "play.fill")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(.white.opacity(0.9))
                            )
                            .overlay(alignment: .bottomTrailing) {
                                // 进度条压在缩略图底缘。
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        Rectangle().fill(.white.opacity(0.2))
                                        Rectangle().fill(Studio.red)
                                            .frame(width: geo.size.width * CGFloat(r.progressPct) / 100)
                                    }
                                }
                                .frame(height: 3)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                        VStack(alignment: .leading, spacing: 3) {
                            Text(r.courseTitle).font(.mono(11)).foregroundStyle(Studio.ink3).lineLimit(1)
                            Text(r.lessonTitle).font(.studio(14, .semibold)).foregroundStyle(Studio.ink).lineLimit(1)
                            Text(r.remainText).font(.mono(11)).foregroundStyle(Studio.ink3)
                        }
                        Spacer()
                        Text("\(r.progressPct)%")
                            .font(.mono(14, .semibold))
                            .foregroundStyle(Studio.red)
                            .contentTransition(.numericText())
                    }
                    .studioCard(padding: 12)
                }
                .buttonStyle(.plain)
                .pressable()
                .accessibilityElement(children: .combine)
                .accessibilityLabel("继续学习 \(r.lessonTitle)，进度 \(r.progressPct)%")
            }
        }
    }

    // MARK: 本周数据整理（取日历最近 7 天）

    private struct WeekPoint: Identifiable {
        let id: String
        let date: Date
        let minutes: Int
        let weekdayLabel: String
        let isToday: Bool
    }

    private var weeklyTotal: Int {
        weekData.reduce(0) { $0 + $1.minutes }
    }

    private var peakDayID: String? {
        weekData.max(by: { $0.minutes < $1.minutes })?.id
    }

    /// Y 轴上限：本周峰值再留一点顶部空间给标注，最少 30 分钟。
    private var maxMinutes: Int {
        let peak = weekData.map(\.minutes).max() ?? 0
        return max(30, Int(ceil(Double(peak) * 1.15)))
    }

    private var weekData: [WeekPoint] {
        let cal = Calendar(identifier: .gregorian)
        let today = Date()
        // 建立 date->minutes 索引
        var map: [String: Int] = [:]
        for d in gamification.calendar { map[d.day] = d.minutes }

        let outFmt = DateFormatter()
        outFmt.locale = Locale(identifier: "zh_CN")
        outFmt.dateFormat = "EEE"           // 周一/周二…

        let keyFmt = DateFormatter()
        keyFmt.locale = Locale(identifier: "en_US_POSIX")
        keyFmt.dateFormat = "yyyy-MM-dd"

        let todayKey = keyFmt.string(from: today)

        var points: [WeekPoint] = []
        for offset in stride(from: 6, through: 0, by: -1) {
            guard let day = cal.date(byAdding: .day, value: -offset, to: today) else { continue }
            let key = keyFmt.string(from: day)
            points.append(WeekPoint(
                id: key,
                date: day,
                minutes: map[key] ?? 0,
                weekdayLabel: outFmt.string(from: day),
                isToday: key == todayKey
            ))
        }
        return points
    }
}
