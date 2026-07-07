import SwiftUI

/// STUDIO 设计系统 Token（对齐 Web globals.css）。
/// 亮暗双值用 Color(light:dark:) 便捷构造，自动跟随系统 colorScheme。
extension Color {
    init(hex: String) {
        let s = Scanner(string: hex.replacingOccurrences(of: "#", with: ""))
        var v: UInt64 = 0
        s.scanHexInt64(&v)
        let r = Double((v >> 16) & 0xff) / 255
        let g = Double((v >> 8) & 0xff) / 255
        let b = Double(v & 0xff) / 255
        self.init(red: r, green: g, blue: b)
    }

    /// 亮暗双值：SwiftUI 在渲染时按当前外观取值。
    /// iOS 走 UIColor 动态 provider；macOS 走 NSColor 动态 provider（bestMatch → darkAqua 判暗）。
    init(light: String, dark: String) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { tc in
            tc.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light))
        })
        #elseif canImport(AppKit)
        self.init(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(Color(hex: isDark ? dark : light))
        })
        #else
        self.init(hex: light)
        #endif
    }
}

/// STUDIO 语义色板（对齐 Web token）。红=专注信号，~7% 用量。
enum Studio {
    static let bg = Color(light: "#e7eaf0", dark: "#0e1116")
    static let bg2 = Color(light: "#edeff3", dark: "#12151b")
    static let surface = Color(light: "#ffffff", dark: "#191d25")
    static let surface2 = Color(light: "#f4f6f9", dark: "#20252f")
    static let surfaceInset = Color(light: "#eaedf2", dark: "#20252f")
    static let border = Color(light: "#e2e6ec", dark: "#2b3350")
    static let border2 = Color(light: "#d3d9e2", dark: "#39415e")
    static let ink = Color(light: "#232935", dark: "#edeff3")
    static let ink2 = Color(light: "#5b6474", dark: "#aeb6c2")
    static let ink3 = Color(light: "#8790a0", dark: "#9aa3b2")
    static let ink4 = Color(light: "#aeb6c2", dark: "#5b6474")
    static let red = Color(hex: "#fc011a") // 品牌红：亮暗同值
    static let redHover = Color(light: "#e00117", dark: "#ff3347")
    static let redActive = Color(light: "#c8000f", dark: "#ff5563")
    static let redSoft = Color(light: "#fff1f2", dark: "#2a1216")
    static let redSoftBorder = Color(light: "#ffd9dd", dark: "#4c1c22")
    static let redInk = Color(light: "#c8000f", dark: "#ff6b78")

    // 功能辅助色（低饱和，配冷灰蓝）。完课✓=ok / 待复习=warn / 通知=info。
    static let ok = Color(light: "#1f9e6e", dark: "#37c491")
    static let okSoft = Color(light: "#e7f6ef", dark: "#123024")
    static let warn = Color(light: "#b7822c", dark: "#d9a648")
    static let warnSoft = Color(light: "#faf2e0", dark: "#322611")
    static let info = Color(light: "#3b6ef5", dark: "#6b93ff")
    static let infoSoft = Color(light: "#e9f0ff", dark: "#141d33")

    static let videoBg = Color(light: "#232935", dark: "#0a0c10")
    static let newBg = Color(light: "#fff3d0", dark: "#3a3216")
    static let newInk = Color(light: "#8a6a00", dark: "#f5d27a")

    // 深色展示区渐变（学生证/AI卡/hero），弃死黑平面。
    static let videoGradient = LinearGradient(
        colors: [Color(hex: "#2a3140"), Color(hex: "#1c2331"), Color(hex: "#141a24")],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    /// 任意 category 文本 → trackGradient 的 4 赛道键，无法归类回退 nil（中性灰渐变）。
    /// 收敛原先散落在各卡片里的重复启发式，供 CoverImage / 各卡统一调用。
    static func trackKey(from category: String?) -> String? {
        let c = (category ?? "").lowercased()
        if c.contains("ai") || c.contains("智能") || c.contains("人工") { return "ai" }
        if c.contains("english") || c.contains("英语") || c.contains("语言") || c.contains("oral") || c.contains("口语") { return "english" }
        if c.contains("elder") || c.contains("老") || c.contains("银发") || c.contains("silver") { return "elder" }
        if c.contains("life") || c.contains("生活") || c.contains("兴趣") { return "life" }
        return nil
    }

    /// 赛道渐变封面（按 category 映射）。
    static func trackGradient(_ category: String?) -> LinearGradient {
        let pairs: [String: (String, String)]
        pairs = [
            "ai": ("#5b3fd6", "#7b5cf0"),
            "english": ("#1f7a5a", "#2ba578"),
            "elder": ("#c4632a", "#e0843c"),
            "life": ("#2a6ab0", "#3b8dd6"),
        ]
        let (a, b) = pairs[category ?? ""] ?? ("#4a5262", "#2d3440")
        return LinearGradient(colors: [Color(hex: a), Color(hex: b)],
                              startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// 材质海拔（对齐 Web L0-L3）。原生阴影分级 + 边缘高光。
enum StudioElevation {
    /// L1 主卡：贴地软阴影。
    static func l1(_ scheme: ColorScheme) -> (color: Color, radius: CGFloat, y: CGFloat) {
        scheme == .dark ? (Color.black.opacity(0.4), 10, 4) : (Color(hex: "#232935").opacity(0.10), 10, 4)
    }
    /// L2 浮起（hover/active）：更深更远。
    static func l2(_ scheme: ColorScheme) -> (color: Color, radius: CGFloat, y: CGFloat) {
        scheme == .dark ? (Color.black.opacity(0.5), 20, 8) : (Color(hex: "#232935").opacity(0.16), 20, 8)
    }
    /// L3 浮层（弹窗/sheet）：最深，配模糊背景。
    static func l3(_ scheme: ColorScheme) -> (color: Color, radius: CGFloat, y: CGFloat) {
        scheme == .dark ? (Color.black.opacity(0.6), 30, 14) : (Color(hex: "#232935").opacity(0.24), 30, 14)
    }
}

/// 动效常量（对齐 Web motion system，spring 无过冲用于进场，弹性用于反馈）。
enum StudioMotion {
    /// 进场/布局：平滑无过冲。
    static let smooth = SwiftUI.Animation.spring(response: 0.42, dampingFraction: 0.9)
    /// 反馈/强调：轻微弹性。
    static let spring = SwiftUI.Animation.spring(response: 0.35, dampingFraction: 0.7)
    /// 快速微交互（按压/点亮）。
    static let quick = SwiftUI.Animation.easeOut(duration: 0.18)
    /// 数字/进度强调。
    static let pop = SwiftUI.Animation.spring(response: 0.3, dampingFraction: 0.6)
}

/// 触觉反馈封装（统一调用点，避免各屏散落 UIImpactFeedbackGenerator）。
/// iOS 走 UIKit 反馈生成器；macOS 走 NSHapticFeedbackManager（触控板震感），
/// 无触控板硬件时系统自动降级为静默。签名两端一致，调用点无需条件编译。
#if os(iOS)
import UIKit
enum Haptics {
    static func light()  { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func rigid()  { UIImpactFeedbackGenerator(style: .rigid).impactOccurred() }
    static func soft()   { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    static func success(){ UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning(){ UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func error()  { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func selection(){ UISelectionFeedbackGenerator().selectionChanged() }
}
#elseif canImport(AppKit)
import AppKit
enum Haptics {
    /// macOS 触控板反馈：.alignment 轻、.levelChange 更明显。无硬件时静默。
    private static func perform(_ pattern: NSHapticFeedbackManager.FeedbackPattern) {
        NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .default)
    }
    static func light()  { perform(.alignment) }
    static func medium() { perform(.levelChange) }
    static func rigid()  { perform(.levelChange) }
    static func soft()   { perform(.alignment) }
    static func success(){ perform(.levelChange) }
    static func warning(){ perform(.levelChange) }
    static func error()  { perform(.generic) }
    static func selection(){ perform(.alignment) }
}
#else
enum Haptics {
    static func light()  {}
    static func medium() {}
    static func rigid()  {}
    static func soft()   {}
    static func success(){}
    static func warning(){}
    static func error()  {}
    static func selection(){}
}
#endif

/// 字体（MVP 用系统字体；后续打进 Plus Jakarta / Noto SC / IBM Plex Mono）。
extension Font {
    static func studio(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
    /// mono：数字/学号/积分/时长。
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

/// 圆角/阴影常量。
enum StudioRadius {
    static let card: CGFloat = 16
    static let cardLg: CGFloat = 18
    static let pill: CGFloat = 999
}
