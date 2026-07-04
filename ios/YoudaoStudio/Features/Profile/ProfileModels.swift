import Foundation

// MARK: - DTO（对齐后端 JSON, camelCase）

/// GET /api/me/gamification
struct GamificationData: Decodable {
    let currentStreak: Int
    let longestStreak: Int
    let calendar: [CalendarDay]
    let achievements: [Achievement]
    /// 累计学习分钟（用于派生 Lv 等级）。后端可选字段，缺省按日历估算。
    let totalStudyMinutes: Int?

    struct CalendarDay: Decodable, Identifiable {
        let day: String       // 后端字段名 "day"，"yyyy-MM-dd"
        let minutes: Int      // 当日学习分钟
        let notes: Int?       // 当日新增笔记数
        var id: String { day }
        /// 热力强度 0…4（无/低/中/高/满）。
        var level: Int {
            switch minutes {
            case 0: return 0
            case 1..<15: return 1
            case 15..<30: return 2
            case 30..<60: return 3
            default: return 4
            }
        }
    }

    struct Achievement: Decodable, Identifiable {
        let key: String           // 后端字段：key/name/description/icon/unlockedAt
        let name: String
        let description: String?
        let icon: String?         // 后端给的图标 key（如 "NotePencil"），展示时映射到 SF Symbol
        let unlockedAt: Date?
        var id: String { key }
        var unlocked: Bool { unlockedAt != nil }
        var title: String { name }
    }
}

/// GET /api/credits/me
struct CreditsData: Decodable {
    let balance: Int
    let recentLedger: [LedgerEntry]

    struct LedgerEntry: Decodable, Identifiable {
        let delta: Int            // +/- 积分变动
        let type: String          // signup_bonus/monthly_grant/recharge/llm_spend/...
        let reason: String?
        let createdAt: Date
        let balanceAfter: Int
        var id: String { "\(createdAt.timeIntervalSince1970)-\(delta)-\(type)" }
        var displayReason: String { reason ?? type }
    }
}

/// GET /api/entitlement/me（对齐 EntitlementSnapshot）
struct EntitlementData: Decodable {
    let isSubscriber: Bool
    let subscriptionStatus: String
    let statusLabel: String?
    let validUntil: String?
    let canUseLLM: Bool?

    /// 展示用等级名。
    var displayTier: String {
        statusLabel ?? (isSubscriber ? "已订阅" : "免费学员")
    }
}

// MARK: - 派生逻辑（纯函数, 便于测试与复用）

enum ProfileDerive {

    /// 由 userId 派生 5 位 base32 学号（去掉易混字符 0/O/1/I/L/U）。
    /// 稳定：同一 id 恒定得到同一学号。
    static func studentNumber(from userId: String) -> String {
        // Crockford-ish 字母表去混淆
        let alphabet = Array("23456789ABCDEFGHJKMNPQRSTVWXYZ")
        // 用 FNV-1a 64 位哈希得到稳定数值
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in userId.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        var value = hash
        var chars: [Character] = []
        let base = UInt64(alphabet.count)
        for _ in 0..<5 {
            let idx = Int(value % base)
            chars.append(alphabet[idx])
            value /= base
        }
        return String(chars)
    }

    /// 昵称首字（用于圆形头像徽标）。
    static func avatarInitial(from nickname: String) -> String {
        let trimmed = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "学" }
        return String(first).uppercased()
    }

    /// 等级派生：按累计学习小时数映射到「书院式」称号。
    struct Level {
        let title: String
        let index: Int          // 0…6
        let hoursThreshold: Int // 当前等级门槛（小时）
        let nextThreshold: Int? // 下一级门槛（小时），nil 表示满级
    }

    private static let ladder: [(hours: Int, title: String)] = [
        (0,   "初来乍到"),
        (5,   "渐入佳境"),
        (15,  "小有所成"),
        (40,  "持之以恒"),
        (100, "学有专精"),
        (250, "融会贯通"),
        (600, "深度专注者"),
    ]

    static func deriveLevel(totalHours: Double) -> Level {
        var idx = 0
        for (i, step) in ladder.enumerated() where totalHours >= Double(step.hours) {
            idx = i
        }
        let cur = ladder[idx]
        let next: Int? = idx + 1 < ladder.count ? ladder[idx + 1].hours : nil
        return Level(title: cur.title, index: idx, hoursThreshold: cur.hours, nextThreshold: next)
    }

    /// 入学时间格式化（yyyy 年 M 月）。
    static func enrollmentText(from date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "yyyy 年 M 月"
        return f.string(from: date)
    }

    /// 每日格言（按学号稳定选择, 无网络依赖）。
    static func motto(for studentNumber: String) -> String {
        let mottos = [
            "把今天的一小时，交给未来的自己。",
            "慢即是快，稳即是进。",
            "专注是最短的捷径。",
            "点亮每一天，照亮每一程。",
            "所学皆为舟，渡己亦渡人。",
            "沉得下心，才走得远。",
            "日拱一卒，功不唐捐。",
        ]
        let sum = studentNumber.utf8.reduce(0) { $0 + Int($1) }
        return mottos[sum % mottos.count]
    }
}
