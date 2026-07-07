import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins
#if canImport(AppKit)
import AppKit  // macOS 下 NSImage 需要
#endif

/// 学生证（纸质证件）。深色校徽抬头带（videoGradient）压住卡头，
/// 下方纸质白底承载头像/学号/等级/二维码，积分余额 mono + pop 动画。
struct StudentCardView: View {
    let user: AuthUser?
    let totalHours: Double
    let entitlement: EntitlementData?
    let credits: CreditsData?
    let gamification: GamificationData

    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 积分数字入场脉冲。
    @State private var creditPulse = false
    /// 分享卡片弹窗（v3.2：服务端出图，深/浅可切）。
    @State private var showShareCard = false

    private var userId: String { user?.id ?? "guest" }
    private var nickname: String { user?.nickname ?? "同学" }
    private var studentNo: String { ProfileDerive.studentNumber(from: userId) }
    private var level: ProfileDerive.Level { ProfileDerive.deriveLevel(totalHours: totalHours) }

    var body: some View {
        VStack(spacing: 0) {
            crestBand          // 深色校徽抬头带（videoGradient）
            paperBody          // 纸质白底主体
        }
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                .strokeBorder(Studio.border, lineWidth: 1)
        )
        // 纸面顶部高光：亮色下显现证件厚度。
        .overlay(alignment: .top) {
            if scheme == .light {
                RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.7), lineWidth: 1)
                    .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .center))
            }
        }
        .shadow(color: cardShadow.color, radius: cardShadow.radius, x: 0, y: cardShadow.y)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("学生证，\(nickname)，学号 \(studentNo)，等级 \(level.title)")
        .sheet(isPresented: $showShareCard) {
            ShareCardSheet(
                kind: "student-card",
                shareUrl: AppConfig.profileShareURL(userId: userId),
                title: "分享学生证"
            )
            .presentationDetents([.large])
        }
    }

    private var cardShadow: (color: Color, radius: CGFloat, y: CGFloat) {
        StudioElevation.l2(scheme)   // 证件浮起一档，强调体验高峰
    }

    // MARK: 校徽抬头带（深色展示区，弃死黑）

    private var crestBand: some View {
        HStack(alignment: .center, spacing: 10) {
            // 校徽（浪潮托书圆形浮雕，白芯片衬托），压在深色带上更立体，证件感。
            Image("StudioEmblem")
                .resizable()
                .scaledToFit()
                .frame(width: 22, height: 22)
                .padding(3)
                .background(.white.opacity(0.95))
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            Text("有道自习室")
                .font(.studio(15, .bold))
                .foregroundStyle(.white)
            Spacer()
            if let ent = entitlement, ent.isSubscriber {
                Text(ent.displayTier)
                    .font(.studio(10, .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.white.opacity(0.16))
                    .clipShape(Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(0.22), lineWidth: 1))
            }
            Text("学生证")
                .font(.mono(11, .semibold)).foregroundStyle(.white.opacity(0.7)).tracking(2)
            shareButton
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(Studio.videoGradient)
        // 底缘细高光：抬头带与纸面的材质接缝。
        .overlay(alignment: .bottom) {
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1)
        }
    }

    // MARK: 分享（落地页链接 /u/{id}，公开可访问，无鉴权）

    private var shareButton: some View {
        // 点开分享卡片弹窗（服务端出图 + 深/浅切换 + 存相册/系统分享），替代旧的仅分享 URL。
        Button {
            Haptics.light()
            showShareCard = true
        } label: {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(width: 30, height: 30)
                .background(.white.opacity(0.12))
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("分享学生证")
    }

    // MARK: 纸质主体

    private var paperBody: some View {
        VStack(alignment: .leading, spacing: 16) {
            mainInfo
            Divider().overlay(Studio.border)
            footer
        }
        .padding(18)
    }

    // MARK: 主体：头像 + 昵称 + 学号 + 等级 / 二维码

    private var mainInfo: some View {
        HStack(alignment: .top, spacing: 16) {
            // 头像：昵称首字圆徽
            Text(ProfileDerive.avatarInitial(from: nickname))
                .font(.studio(28, .bold))
                .foregroundStyle(Studio.ink)
                .frame(width: 64, height: 64)
                .background(Studio.surface2)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Studio.border2, lineWidth: 1))
                // 头像顶部柔光，强化证件照凸起感。
                .overlay(alignment: .top) {
                    Circle()
                        .strokeBorder(Color.white.opacity(scheme == .light ? 0.6 : 0.12), lineWidth: 1)
                        .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .center))
                        .frame(width: 64, height: 64)
                }

            VStack(alignment: .leading, spacing: 6) {
                Text(nickname).font(.studio(20, .bold)).foregroundStyle(Studio.ink).lineLimit(1)
                infoRow(label: "学号", value: studentNo, mono: true)
                infoRow(label: "入学", value: ProfileDerive.enrollmentText(from: enrollmentDate))
                levelBadge
            }

            Spacer(minLength: 0)

            // 二维码（可选）：指向 /u/{id}
            qrCode
        }
    }

    private func infoRow(label: String, value: String, mono: Bool = false) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink4)
            Text(value)
                .font(mono ? .mono(13, .semibold) : .studio(13, .medium))
                .foregroundStyle(Studio.ink2)
        }
    }

    private var levelBadge: some View {
        HStack(spacing: 6) {
            Text("Lv.\(level.index)").font(.mono(11, .bold)).foregroundStyle(Studio.ink)
            Text(level.title).font(.studio(12, .semibold)).foregroundStyle(Studio.ink2)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Studio.surfaceInset)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Studio.border, lineWidth: 1))
    }

    @ViewBuilder private var qrCode: some View {
        // 编码完整可扫链接（origin + /u/{id}）而非裸路径，才能真正扫码跳主页。
        if let img = Self.qrImage(for: AppConfig.profileShareURL(userId: userId)?.absoluteString ?? "\(AppConfig.shareBaseURL)/u/\(userId)") {
            VStack(spacing: 4) {
                Self.platformImage(img)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 58, height: 58)
                    .padding(4)
                    .background(Studio.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
                Text("扫码看主页")
                    .font(.system(size: 9)).foregroundStyle(Studio.ink4)
            }
            .accessibilityLabel("个人主页二维码，扫码可访问")
        }
    }

    /// 从平台图构造 SwiftUI Image（iOS 用 uiImage，macOS 用 nsImage）。
    private static func platformImage(_ img: PlatformImage) -> Image {
        #if canImport(UIKit)
        Image(uiImage: img)
        #else
        Image(nsImage: img)
        #endif
    }

    // MARK: 卡脚：格言 + 积分余额

    private var footer: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: "quote.opening").font(.system(size: 12)).foregroundStyle(Studio.ink4)
            Text(ProfileDerive.motto(for: studentNo))
                .font(.studio(13, .medium)).foregroundStyle(Studio.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if let balance = credits?.balance {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill").font(.system(size: 10)).foregroundStyle(Studio.warn)
                    Text("\(balance)")
                        .font(.mono(12, .bold)).foregroundStyle(Studio.ink)
                        .contentTransition(.numericText())
                    Text("积分").font(.studio(10)).foregroundStyle(Studio.ink4)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Studio.surfaceInset)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(Studio.border, lineWidth: 1))
                .fixedSize()
                // 入场脉冲：mono 积分被强调一下（尊重 reduce-motion）。
                .scaleEffect(creditPulse || reduceMotion ? 1 : 0.9)
                .opacity(creditPulse || reduceMotion ? 1 : 0)
                .onAppear {
                    guard !reduceMotion else { creditPulse = true; return }
                    withAnimation(StudioMotion.pop.delay(0.25)) { creditPulse = true }
                }
                .accessibilityLabel("积分余额 \(balance)")
            }
        }
    }

    // MARK: 派生入学时间

    /// 入学时间：取日历最早有记录的一天；无记录则回退今天。
    private var enrollmentDate: Date {
        let earliest = gamification.calendar
            .compactMap { Self.dateParser.date(from: $0.day) }
            .min()
        return earliest ?? Date()
    }

    private static let dateParser: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return f
    }()

    // MARK: 二维码生成（CoreImage）

    private static let ciContext = CIContext()

    /// 平台图类型别名：iOS = UIImage，macOS = NSImage。
    #if canImport(UIKit)
    typealias PlatformImage = UIImage
    #else
    typealias PlatformImage = NSImage
    #endif

    static func qrImage(for path: String) -> PlatformImage? {
        let filter = CIFilter.qrCodeGenerator()
        guard let data = path.data(using: .utf8) else { return nil }
        filter.message = data
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        guard let cg = ciContext.createCGImage(scaled, from: scaled.extent) else { return nil }
        #if canImport(UIKit)
        return UIImage(cgImage: cg)
        #else
        return NSImage(cgImage: cg, size: CGSize(width: cg.width, height: cg.height))
        #endif
    }
}
