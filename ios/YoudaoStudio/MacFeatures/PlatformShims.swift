// Mac 平台垫片：把散落各处的 #if os 收敛到一处。
//
// 目标：让 MacFeatures 下的业务 View 不再出现条件编译。iOS-only 的 SwiftUI 修饰符
// （如 navigationBarTitleDisplayMode / textInputAutocapitalization / autocorrectionDisabled）
// 在此提供 macOS 上的 no-op 版本，签名与 iOS 一致，调用点两端通用。
//
// 本文件整体仅在 macOS 参与编译（#if os(macOS)），iOS 走原生 SwiftUI 修饰符。
#if os(macOS)
import SwiftUI

extension View {
    /// iOS 有 `.navigationBarTitleDisplayMode(_:)`；macOS 无此概念，提供 no-op 保持调用点一致。
    /// 用自定义枚举避免依赖 UIKit 的 NavigationBarItem.TitleDisplayMode。
    @inlinable
    func navBarInline() -> some View { self }

    /// iOS 输入框大小写策略；macOS 无软键盘，no-op。
    @inlinable
    func noAutocapitalization() -> some View { self }

    /// iOS 自动纠错关闭；macOS 桌面输入默认不纠错，no-op（保留调用点一致）。
    @inlinable
    func noAutocorrection() -> some View { self }
}

/// 桌面文本框统一外观：与 LoginView 的 field 一致（surface + border + 圆角）。
/// 收敛到垫片，Mac 登录/搜索等输入框直接复用，避免各处重写样式。
struct MacFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.studio(15))
            .foregroundStyle(Studio.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Studio.border, lineWidth: 1)
            )
    }
}

extension View {
    /// 应用桌面文本框样式（收敛在垫片，登录/搜索复用）。
    func macField() -> some View { modifier(MacFieldStyle()) }
}
#endif
