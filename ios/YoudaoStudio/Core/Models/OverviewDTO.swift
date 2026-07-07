import Foundation

/// GET /api/me/overview —— 成长档案聚合（v3.2，iOS/Mac 共用）。
struct MeOverview: Decodable {
    let totalStudySec: Int
    let completedCount: Int
    let notesCount: Int
    let notebookCount: Int
    let purchasedCount: Int
    let dueReviewCount: Int
    let currentStreak: Int
    let longestStreak: Int
    let achievementsCount: Int
    let creditBalance: Int
    let isSubscriber: Bool
    let subscriptionStatus: String
    let statusLabel: String
    let validUntil: Date?
    let creator: Creator

    struct Creator: Decodable {
        let totalIncome: Int
        let totalSales: Int
        let stallCount: Int
    }

    /// 累计学习时长的紧凑文案（<1 小时显分钟，否则显小时）。
    var studyTimeLabel: String {
        let mins = totalStudySec / 60
        if mins < 60 { return "\(mins)分" }
        let h = Double(totalStudySec) / 3600
        return h >= 10 ? "\(Int(h))时" : String(format: "%.1f时", h)
    }
}
