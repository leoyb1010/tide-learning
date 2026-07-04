import SwiftUI

/// 卡片修饰：rounded + border + 材质海拔（对齐 Web L0-L3）。
/// elevation: 1 主卡 / 2 浮起 / 3 浮层。深色区自动切深阴影。
struct StudioCardModifier: ViewModifier {
    var padding: CGFloat = 16
    var radius: CGFloat = StudioRadius.card
    var elevation: Int = 1
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        let e = elevation >= 3 ? StudioElevation.l3(scheme)
              : elevation == 2 ? StudioElevation.l2(scheme)
              : StudioElevation.l1(scheme)
        content
            .padding(padding)
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(elevation >= 2 ? Studio.border2 : Studio.border, lineWidth: 1)
            )
            // 边缘顶部高光（inner-hi）：只在亮色下显现材质厚度。
            .overlay(alignment: .top) {
                if scheme == .light {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.6), lineWidth: 1)
                        .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .center))
                }
            }
            .shadow(color: e.color, radius: e.radius, x: 0, y: e.y)
    }
}
extension View {
    func studioCard(padding: CGFloat = 16, radius: CGFloat = StudioRadius.card, elevation: Int = 1) -> some View {
        modifier(StudioCardModifier(padding: padding, radius: radius, elevation: elevation))
    }
}

/// 按压反馈：轻微缩放 + 触觉。用于可点卡片/大按钮，模拟物理下压。
struct PressableModifier: ViewModifier {
    var scale: CGFloat = 0.97
    var haptic: Bool = true
    @State private var pressed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .scaleEffect(pressed && !reduceMotion ? scale : 1)
            .animation(StudioMotion.quick, value: pressed)
            .onLongPressGesture(minimumDuration: 0, pressing: { p in
                pressed = p
                if p && haptic { Haptics.light() }
            }, perform: {})
    }
}
extension View {
    func pressable(scale: CGFloat = 0.97, haptic: Bool = true) -> some View {
        modifier(PressableModifier(scale: scale, haptic: haptic))
    }
}

/// 主按钮：red/ink/ghost 三态 + 按压反馈 + 触觉。
struct StudioButton: View {
    enum Kind { case red, ink, ghost }
    let title: String
    var kind: Kind = .red
    var icon: String? = nil
    var loading: Bool = false
    let action: () -> Void
    @State private var pressed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            Haptics.medium()
            action()
        } label: {
            HStack(spacing: 6) {
                if loading { ProgressView().controlSize(.small).tint(fg) }
                else if let icon { Image(systemName: icon).font(.system(size: 14, weight: .semibold)) }
                Text(title).font(.studio(14, .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .foregroundStyle(fg)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(kind == .ghost ? RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border2, lineWidth: 1) : nil)
            // 红 CTA 品牌柔光（克制）。
            .shadow(color: kind == .red ? Studio.red.opacity(0.28) : .clear, radius: 12, x: 0, y: 4)
        }
        .buttonStyle(.plain)
        .scaleEffect(pressed && !reduceMotion ? 0.98 : 1)
        .animation(StudioMotion.quick, value: pressed)
        .onLongPressGesture(minimumDuration: 0, pressing: { pressed = $0 }, perform: {})
        .disabled(loading)
    }
    private var bg: Color { kind == .red ? Studio.red : kind == .ink ? Studio.ink : Studio.surface }
    private var fg: Color { kind == .ghost ? Studio.ink : .white }
}

/// 骨架条：贴合布局形状的加载占位（shimmer 尊重 reduce-motion）。
struct SkeletonBar: View {
    var height: CGFloat = 12
    var width: CGFloat? = nil
    @State private var shimmer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Studio.surfaceInset)
            .frame(width: width, height: height)
            .opacity(shimmer ? 0.5 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { shimmer = true }
            }
    }
}

/// 空态：图形化构图（图标底衬圆 + 标题 + 引导 + CTA），非裸灰图标。
struct EmptyStateView: View {
    let title: String
    var subtitle: String? = nil
    var icon: String = "tray"
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Studio.surface2).frame(width: 72, height: 72)
                Circle().strokeBorder(Studio.border, lineWidth: 1).frame(width: 72, height: 72)
                Image(systemName: icon).font(.system(size: 30, weight: .light)).foregroundStyle(Studio.ink3)
            }
            Text(title).font(.studio(16, .semibold)).foregroundStyle(Studio.ink)
            if let subtitle {
                Text(subtitle).font(.studio(13)).foregroundStyle(Studio.ink3)
                    .multilineTextAlignment(.center).lineSpacing(2)
            }
            if let actionTitle, let action {
                StudioButton(title: actionTitle, action: action).frame(maxWidth: 200).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 44).padding(.horizontal, 32)
    }
}

/// 错误行内展示 + 重试。
struct ErrorRetryView: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Studio.warnSoft).frame(width: 56, height: 56)
                Image(systemName: "exclamationmark.triangle").font(.system(size: 22)).foregroundStyle(Studio.warn)
            }
            Text(message).font(.studio(14)).foregroundStyle(Studio.ink2).multilineTextAlignment(.center)
            StudioButton(title: "重试", kind: .ghost, action: retry).frame(maxWidth: 160)
        }.frame(maxWidth: .infinity).padding(32)
    }
}

/// 语义状态徽章：完课/待复习/通知等，用功能色而非红。
struct StatusBadge: View {
    enum Tone { case ok, warn, info, red, neutral }
    let text: String
    var icon: String? = nil
    var tone: Tone = .neutral
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(text).font(.studio(11, .semibold))
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous).strokeBorder(border, lineWidth: 1))
    }
    private var fg: Color {
        switch tone { case .ok: Studio.ok; case .warn: Studio.warn; case .info: Studio.info; case .red: Studio.red; case .neutral: Studio.ink2 }
    }
    private var bg: Color {
        switch tone { case .ok: Studio.okSoft; case .warn: Studio.warnSoft; case .info: Studio.infoSoft; case .red: Studio.redSoft; case .neutral: Studio.surface2 }
    }
    private var border: Color {
        switch tone { case .red: Studio.redSoftBorder; default: fg.opacity(0.2) }
    }
}
