// Mac 我的：学生证 + 积分钱包 + 创作者中心入口 + 退出登录。
//
// iOS Profile 在 Features/Profile（整目录从 Mac target 排除），故此处建等价
// @Observable VM + 本地 DTO，聚合多个只读端点，走同一 APIEnvelope。
// 字段严格对齐后端真实响应（已 curl 核对）：
//   GET /api/auth/me → {user{id,nickname,email?,phone?,role?},entitlement{isSubscriber,
//                        statusLabel,accessLevel,validUntil?,monthlyGrant?,...}}
//   GET /api/credits/me → {balance,recentLedger[{delta,type,reason?,createdAt,balanceAfter?}]}
//   GET /api/me/gamification → {currentStreak,longestStreak,...}
//   GET /api/me/creator → {totalIncome,totalSales,courses[],recentSales[]}
//
// 退出登录走 AuthManager.logout()；创作者中心 Mac 端暂提示前往 Web /me/creator。
#if os(macOS)
import SwiftUI
import Observation

/// /auth/me 完整响应（含订阅权益）。
struct MacMeResponse: Decodable {
    let user: User
    let entitlement: Entitlement?
    struct User: Decodable {
        let id: String
        let nickname: String
        let email: String?
        let phone: String?
        let role: String?
    }
    struct Entitlement: Decodable {
        let isSubscriber: Bool
        let statusLabel: String?
        let accessLevel: String?
        let validUntil: Date?
        let monthlyGrant: Int?
    }
}

/// /me/gamification（仅取连击天数）。
struct MacGamification: Decodable {
    let currentStreak: Int
    let longestStreak: Int
}

/// /me/creator（创作者中心摘要）。
struct MacCreatorSummary: Decodable {
    let totalIncome: Int
    let totalSales: Int
}

@Observable @MainActor
final class MacProfileViewModel {
    var me: MacMeResponse?
    var credits: MacCreditsAccount?
    var game: MacGamification?
    var creator: MacCreatorSummary?
    var error: String?
    var loading = false

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        async let meCall = API.shared.get("/api/auth/me", as: MacMeResponse.self)
        async let creditsCall = try? API.shared.get("/api/credits/me", as: MacCreditsAccount.self)
        async let gameCall = try? API.shared.get("/api/me/gamification", as: MacGamification.self)
        async let creatorCall = try? API.shared.get("/api/me/creator", as: MacCreatorSummary.self)
        do {
            me = try await meCall
            credits = await creditsCall
            game = await gameCall
            creator = await creatorCall
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }
}

struct MacProfileView: View {
    @State private var vm = MacProfileViewModel()
    @Environment(AuthManager.self) private var auth
    @State private var showLogoutConfirm = false

    var body: some View {
        ScrollView {
            Group {
                if let me = vm.me {
                    content(me)
                } else if let err = vm.error {
                    ErrorRetryView(message: err) { Task { await vm.load() } }
                        .padding(40)
                } else {
                    loadingSkeleton
                }
            }
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .padding(28)
        }
        .background(Studio.bg)
        .task { if vm.me == nil { await vm.load() } }
        .confirmationDialog("退出登录", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await auth.logout() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("退出后需重新登录才能继续学习。")
        }
    }

    // MARK: 主内容

    private func content(_ me: MacMeResponse) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            studentCard(me)
            HStack(alignment: .top, spacing: 18) {
                walletCard.frame(maxWidth: .infinity)
                creatorCard.frame(maxWidth: .infinity)
            }
            logoutRow
        }
    }

    // MARK: 学生证（深色展示卡）

    private func studentCard(_ me: MacMeResponse) -> some View {
        let ent = me.entitlement
        return VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 6) {
                // v3.2 校徽（与 iOS / 分享卡一致），白芯片衬托
                Image("StudioEmblem")
                    .resizable().scaledToFit().frame(width: 16, height: 16)
                    .padding(2).background(.white.opacity(0.95))
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                Text("STUDENT ID · 有道自习室")
                    .font(.mono(10, .bold)).foregroundStyle(.white.opacity(0.7)).tracking(2)
            }
            HStack(alignment: .center, spacing: 16) {
                ZStack {
                    Circle().fill(Color.white.opacity(0.14)).frame(width: 64, height: 64)
                    Text(String(me.user.nickname.prefix(1)))
                        .font(.studio(28, .bold)).foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(me.user.nickname)
                        .font(.studio(24, .bold)).foregroundStyle(.white)
                    HStack(spacing: 8) {
                        if let ent {
                            statusChip(ent.statusLabel ?? (ent.isSubscriber ? "已订阅" : "未订阅"),
                                       tone: ent.isSubscriber ? .ok : .neutral)
                        }
                        if let streak = vm.game?.currentStreak, streak > 0 {
                            statusChip("连续 \(streak) 天", icon: "flame.fill", tone: .warn)
                        }
                    }
                }
                Spacer()
            }
            // 卡脚信息行。
            HStack(spacing: 24) {
                idField("学号", String(me.user.id.suffix(8)).uppercased())
                if let email = me.user.email, !email.isEmpty {
                    idField("邮箱", email)
                }
                if let ent = me.entitlement, let until = ent.validUntil, ent.isSubscriber {
                    idField("订阅至", dateShort(until))
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
    }

    private func statusChip(_ text: String, icon: String? = nil, tone: StatusBadge.Tone) -> some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(text).font(.studio(11, .semibold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(Color.white.opacity(0.16))
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
    }

    private func idField(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.mono(9, .bold)).foregroundStyle(.white.opacity(0.55)).tracking(1)
            Text(value).font(.mono(12, .semibold)).foregroundStyle(.white.opacity(0.92)).lineLimit(1)
        }
    }

    // MARK: 积分钱包

    private var walletCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("积分钱包", systemImage: "creditcard.fill")
                    .font(.studio(15, .bold)).foregroundStyle(Studio.ink)
                Spacer()
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(vm.credits.map { "\($0.balance)" } ?? "—")
                    .font(.mono(34, .bold)).foregroundStyle(Studio.red)
                Text("积分").font(.studio(14)).foregroundStyle(Studio.ink3)
            }
            Divider().overlay(Studio.border)
            Text("近期流水")
                .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(1)
            if let ledger = vm.credits?.recentLedger, !ledger.isEmpty {
                VStack(spacing: 8) {
                    ForEach(ledger.prefix(5)) { entry in
                        ledgerRow(entry)
                    }
                }
            } else {
                Text("暂无流水记录")
                    .font(.studio(12)).foregroundStyle(Studio.ink4)
                    .padding(.vertical, 8)
            }
        }
        .studioCard(padding: 20)
    }

    private func ledgerRow(_ entry: MacCreditsAccount.Ledger) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.reason ?? entry.type)
                    .font(.studio(13, .medium)).foregroundStyle(Studio.ink).lineLimit(1)
                Text(dateShort(entry.createdAt))
                    .font(.studio(11)).foregroundStyle(Studio.ink4)
            }
            Spacer()
            Text(entry.delta >= 0 ? "+\(entry.delta)" : "\(entry.delta)")
                .font(.mono(14, .bold))
                .foregroundStyle(entry.delta >= 0 ? Studio.ok : Studio.ink2)
        }
    }

    // MARK: 创作者中心入口

    private var creatorCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("创作者中心", systemImage: "wand.and.stars")
                    .font(.studio(15, .bold)).foregroundStyle(Studio.ink)
                Spacer()
            }
            if let c = vm.creator {
                HStack(spacing: 14) {
                    creatorStat("\(c.totalIncome)", "累计收益")
                    creatorStat("\(c.totalSales)", "累计销量")
                }
            } else {
                Text("发布课程后可在此查看收益与销量。")
                    .font(.studio(12)).foregroundStyle(Studio.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 12)).foregroundStyle(Studio.ink3)
                Text("完整创作者中心请前往 Web 端 /me/creator")
                    .font(.studio(12)).foregroundStyle(Studio.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .studioCard(padding: 20)
    }

    private func creatorStat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.mono(22, .bold)).foregroundStyle(Studio.ink)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 10).padding(.horizontal, 12)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: 退出登录

    private var logoutRow: some View {
        Button {
            showLogoutConfirm = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 14, weight: .semibold))
                Text("退出登录").font(.studio(14, .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .foregroundStyle(Studio.red)
            .background(Studio.redSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Studio.redSoftBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: 工具

    private func dateShort(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 22) {
            SkeletonBar(height: 160)
            HStack(spacing: 18) {
                SkeletonBar(height: 220); SkeletonBar(height: 220)
            }
            SkeletonBar(height: 48)
        }
    }
}
#endif
