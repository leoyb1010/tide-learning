import SwiftUI

/// 成长档案「数据总览条 + 学习资产 + 创作者摘要」（v3.2 对齐 Web /me 页）。
/// 数据来自 /api/me/overview。放在学生证下方，一眼看到自己在平台积累了什么。
struct OverviewStrip: View {
    let overview: MeOverview

    private let cols = [GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // 6 格数据总览
            LazyVGrid(columns: cols, spacing: 10) {
                statCell("clock.fill", overview.studyTimeLabel, "累计学习")
                statCell("checkmark.circle.fill", "\(overview.completedCount)", "完成课程")
                statCell("note.text", "\(overview.notesCount)", "笔记")
                statCell("flame.fill", "\(overview.currentStreak)", "连续天数", accent: true)
                statCell("trophy.fill", "\(overview.achievementsCount)", "获得成就")
                statCell("bolt.fill", "\(overview.creditBalance)", "积分")
            }

            // 学习资产：笔记本 + 我的课程
            HStack(spacing: 10) {
                assetCard("book.closed.fill", "我的笔记本",
                          overview.notebookCount > 0 ? "\(overview.notebookCount) 个主题空间" : "把笔记归入主题",
                          tint: Studio.info)
                assetCard("bag.fill", "我的课程",
                          overview.purchasedCount > 0 ? "已入手 \(overview.purchasedCount) 门" : "已购与订阅可学",
                          tint: Studio.ink3)
            }

            // 创作者摘要（有在架课时）
            if overview.creator.stallCount > 0 {
                HStack(spacing: 10) {
                    Image(systemName: "storefront.fill").font(.system(size: 15)).foregroundStyle(Studio.red)
                    Text("创作者").font(.studio(13, .semibold)).foregroundStyle(Studio.ink)
                    Spacer()
                    Text("收益 ")
                        .font(.studio(12)).foregroundStyle(Studio.ink3)
                    + Text("\(overview.creator.totalIncome)").font(.mono(12, .bold)).foregroundStyle(Studio.ok)
                    + Text(" · 在架 \(overview.creator.stallCount) · 成交 \(overview.creator.totalSales)")
                        .font(.studio(12)).foregroundStyle(Studio.ink3)
                }
                .padding(14)
                .frame(maxWidth: .infinity)
                .background(Studio.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))
            }
        }
    }

    private func statCell(_ icon: String, _ value: String, _ label: String, accent: Bool = false) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 15))
                .foregroundStyle(accent ? Studio.red : Studio.ink3)
            Text(value).font(.mono(17, .heavy)).foregroundStyle(accent ? Studio.red : Studio.ink)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Studio.border, lineWidth: 1))
    }

    private func assetCard(_ icon: String, _ title: String, _ sub: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 16)).foregroundStyle(tint)
                .frame(width: 36, height: 36).background(Studio.surfaceInset).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.studio(13, .bold)).foregroundStyle(Studio.ink)
                Text(sub).font(.studio(11)).foregroundStyle(Studio.ink3).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))
    }
}
