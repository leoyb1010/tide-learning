import SwiftUI

/// 成长足迹：streak 卡（红色数字）+ 徽章墙（StatusBadge 语义色）+ 潮汐日历热力图。
struct GrowthTrailView: View {
    let gamification: GamificationData

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            streakCards
            achievementsWall
            tidalCalendar
        }
        .onAppear {
            guard !reduceMotion else { appeared = true; return }
            withAnimation(StudioMotion.smooth.delay(0.1)) { appeared = true }
        }
    }

    // MARK: streak 卡（当前连续为唯一红色强调 + pop 强调）

    private var streakCards: some View {
        HStack(spacing: 12) {
            streakStat(value: gamification.currentStreak, label: "当前连续", unit: "天", red: true)
            streakStat(value: gamification.longestStreak, label: "最长连续", unit: "天", red: false)
        }
    }

    private func streakStat(value: Int, label: String, unit: String, red: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: red ? "flame.fill" : "trophy.fill")
                .font(.system(size: 15))
                .foregroundStyle(red ? Studio.red : Studio.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text("\(value)")
                    .font(.mono(28, .bold))
                    .foregroundStyle(red ? Studio.red : Studio.ink)
                    .contentTransition(.numericText())
                    // 连击数字入场脉冲，凸显 streak 势能。
                    .scaleEffect(appeared || reduceMotion ? 1 : 0.7)
                Text(unit).font(.studio(12)).foregroundStyle(Studio.ink3)
            }
            Text(label).font(.studio(12)).foregroundStyle(Studio.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(value) 天")
    }

    // MARK: 徽章墙

    @ViewBuilder private var achievementsWall: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("徽章墙").font(.studio(14, .bold)).foregroundStyle(Studio.ink)
                Spacer()
                // 已点亮数量：用 ok 语义徽章替代裸文字。
                StatusBadge(
                    text: "\(unlockedCount) / \(gamification.achievements.count)",
                    icon: "checkmark.seal.fill",
                    tone: unlockedCount > 0 ? .ok : .neutral
                )
            }

            if gamification.achievements.isEmpty {
                EmptyStateView(
                    title: "还没有徽章",
                    subtitle: "完成学习任务，点亮你的第一枚徽章。",
                    icon: "rosette"
                )
            } else {
                LazyVGrid(columns: badgeColumns, spacing: 14) {
                    ForEach(Array(gamification.achievements.enumerated()), id: \.element.id) { idx, badge in
                        badgeCell(badge)
                            .opacity(appeared || reduceMotion ? 1 : 0)
                            .scaleEffect(appeared || reduceMotion ? 1 : 0.85)
                            .animation(
                                reduceMotion ? nil : StudioMotion.smooth.delay(Double(idx) * 0.03),
                                value: appeared
                            )
                    }
                }
            }
        }
        .studioCard()
    }

    private var badgeColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 74), spacing: 14)]
    }

    private func badgeCell(_ badge: GamificationData.Achievement) -> some View {
        VStack(spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                Image(systemName: badge.icon ?? "rosette")
                    .font(.system(size: 22))
                    .foregroundStyle(badge.unlocked ? Studio.ink : Studio.ink4)
                    .frame(width: 52, height: 52)
                    .background(badge.unlocked ? Studio.okSoft : Studio.surfaceInset)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(badge.unlocked ? Studio.ok.opacity(0.35) : Studio.border, lineWidth: 1))
                    .opacity(badge.unlocked ? 1 : 0.55)
                // 已点亮角标（绿色 ✓），语义清晰。
                if badge.unlocked {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Studio.ok)
                        .background(Circle().fill(Studio.surface).padding(1))
                }
            }
            Text(badge.title)
                .font(.studio(10, .medium))
                .foregroundStyle(badge.unlocked ? Studio.ink2 : Studio.ink4)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .pressable(scale: 0.94)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(badge.title)，\(badge.unlocked ? "已点亮" : "未点亮")")
    }

    private var unlockedCount: Int {
        gamification.achievements.filter(\.unlocked).count
    }

    // MARK: 潮汐日历（热力 LazyVGrid）

    private var tidalCalendar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("潮汐日历").font(.studio(14, .bold)).foregroundStyle(Studio.ink)
                Spacer()
                legend
            }

            if gamification.calendar.isEmpty {
                EmptyStateView(
                    title: "潮汐尚未起涨",
                    subtitle: "每学习一天，潮水便涨一分。",
                    icon: "water.waves"
                )
            } else {
                LazyVGrid(columns: heatColumns, spacing: 6) {
                    ForEach(gamification.calendar) { day in
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(heatColor(day.level))
                            .aspectRatio(1, contentMode: .fit)
                            .overlay(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .strokeBorder(Studio.border, lineWidth: day.level == 0 ? 1 : 0)
                            )
                            .accessibilityLabel("\(day.day)，\(day.minutes) 分钟")
                    }
                }
                .opacity(appeared || reduceMotion ? 1 : 0)
                .animation(reduceMotion ? nil : StudioMotion.smooth.delay(0.18), value: appeared)
            }
        }
        .studioCard()
    }

    private var heatColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)
    }

    private var legend: some View {
        HStack(spacing: 4) {
            Text("少").font(.mono(9)).foregroundStyle(Studio.ink4)
            ForEach(0..<5) { lvl in
                RoundedRectangle(cornerRadius: 2)
                    .fill(heatColor(lvl))
                    .frame(width: 10, height: 10)
                    .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Studio.border, lineWidth: lvl == 0 ? 1 : 0))
            }
            Text("多").font(.mono(9)).foregroundStyle(Studio.ink4)
        }
        .accessibilityHidden(true)
    }

    /// 热力配色：0 底色，1…4 由浅到品牌红。
    private func heatColor(_ level: Int) -> Color {
        switch level {
        case 0:  return Studio.surfaceInset
        case 1:  return Studio.red.opacity(0.22)
        case 2:  return Studio.red.opacity(0.45)
        case 3:  return Studio.red.opacity(0.70)
        default: return Studio.red
        }
    }
}
