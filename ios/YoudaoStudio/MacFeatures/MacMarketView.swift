// Mac 课程集市：宽幅网格 + 付费确认 + 402 充值引导 + 积分余额刷新。
//
// iOS 集市 VM/DTO 在 Features/Market（整目录从 Mac target 排除），故此处建等价
// @Observable VM + 本地 DTO，打同一 /api/market、/api/market/collect、/api/credits/me，
// 走同一 APIEnvelope。字段严格对齐后端真实响应（已 curl 核对）：
//   MarketStall{id,slug?,title,subtitle?,category?,coverColor?,coverSrc?,origin?,
//               collectCount,learnersCount,priceCredits?,isPaid,salesCount,
//               collectedByMe,subscriptionCovered?,mine,seller{...}}
//   collect → {status?,already?,message?,balance?,spent?}（付费扣积分，402 余额不足）
//   credits/me → {balance,recentLedger[]}
#if os(macOS)
import SwiftUI
import Observation

/// 集市摊位（对齐后端 /api/market items 真实响应）。仅解码本视图用到的字段。
struct MacMarketStall: Decodable, Identifiable {
    let id: String
    let slug: String?
    let title: String
    let subtitle: String?
    let category: String?
    let coverColor: String?
    let coverSrc: String?
    let origin: String?
    let collectCount: Int
    let learnersCount: Int
    let priceCredits: Int?
    let isPaid: Bool
    let salesCount: Int
    let collectedByMe: Bool
    let subscriptionCovered: Bool?
    let mine: Bool
    let seller: Seller?

    struct Seller: Decodable {
        let id: String?
        let nickname: String
        let avatarUrl: String?
        let level: Int?
    }

    /// 价签文案：已购 / 我的 / 订阅已含 / 免费 / N 积分。
    var priceTag: String {
        if collectedByMe { return "已在书架" }
        if mine { return "我的课" }
        if !isPaid || (priceCredits ?? 0) == 0 { return "免费" }
        if subscriptionCovered == true { return "订阅已含" }
        return "\(priceCredits ?? 0) 积分"
    }

    /// 是否走「确认付费」路径（真正扣积分）：付费、非订阅覆盖、非自己的、未拥有。
    var needsPaidConfirm: Bool {
        isPaid && (priceCredits ?? 0) > 0 && subscriptionCovered != true && !mine && !collectedByMe
    }

    /// 是否可点击拿走 / 购买（自己的课、已拥有不可再拿）。
    var canCollect: Bool { !mine && !collectedByMe }
}

/// 集市响应包裹（{ items: [...] }）。
private struct MacMarketResponse: Decodable { let items: [MacMarketStall] }

/// 拿走 / 购买响应（免费与付费共用；字段按需可选）。
private struct MacCollectResult: Decodable {
    let status: String?
    let already: Bool?
    let message: String?
    let balance: Int?
    let spent: Int?
}

/// 积分账户（复用于集市右上余额胶囊）。
struct MacCreditsAccount: Decodable {
    let balance: Int
    let recentLedger: [Ledger]
    struct Ledger: Decodable, Identifiable {
        var id: String { "\(type)-\(createdAt.timeIntervalSince1970)-\(delta)" }
        let delta: Int
        let type: String
        let reason: String?
        let createdAt: Date
        let balanceAfter: Int?
    }
}

private struct CollectBody: Encodable { let courseId: String }

@Observable @MainActor
final class MacMarketViewModel {
    var items: [MacMarketStall] = []
    var balance: Int?
    var error: String?
    var loading = false

    /// 付费确认目标（非 nil 即弹确认框）。
    var pendingPurchase: MacMarketStall?
    /// 一次性提示（成功文案 / 402 引导等）。
    var banner: Banner?
    /// 正在拿走 / 购买中的课程 id（禁用重复点击 + 显示 spinner）。
    var busyId: String?

    struct Banner: Identifiable {
        let id = UUID()
        let text: String
        let tone: StatusBadge.Tone
        /// 402 场景带「去充值」引导（Mac 端暂提示 Web 充值入口）。
        var showRecharge: Bool = false
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        async let stalls = API.shared.get("/api/market", as: MacMarketResponse.self)
        async let credits = try? API.shared.get("/api/credits/me", as: MacCreditsAccount.self)
        do {
            items = try await stalls.items
            balance = await credits?.balance
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    func refreshBalance() async {
        if let c = try? await API.shared.get("/api/credits/me", as: MacCreditsAccount.self) {
            balance = c.balance
        }
    }

    /// 点击拿走：付费需确认走 pendingPurchase 弹框；免费 / 订阅覆盖直接执行。
    func tapCollect(_ stall: MacMarketStall) {
        guard stall.canCollect, busyId == nil else { return }
        if stall.needsPaidConfirm {
            pendingPurchase = stall
        } else {
            Task { await performCollect(stall) }
        }
    }

    /// 确认后 / 免费直接执行拿走 / 购买。402 展示后端文案 + 去充值提示。
    func performCollect(_ stall: MacMarketStall) async {
        busyId = stall.id
        pendingPurchase = nil
        defer { busyId = nil }
        do {
            let r = try await API.shared.post("/api/market/collect",
                                              body: CollectBody(courseId: stall.id),
                                              as: MacCollectResult.self)
            // 本地乐观更新：标记已拥有 + 采集数 +1。
            if let idx = items.firstIndex(where: { $0.id == stall.id }) {
                let old = items[idx]
                items[idx] = MacMarketStall(
                    id: old.id, slug: old.slug, title: old.title, subtitle: old.subtitle,
                    category: old.category, coverColor: old.coverColor, coverSrc: old.coverSrc,
                    origin: old.origin, collectCount: old.collectCount + 1,
                    learnersCount: old.learnersCount, priceCredits: old.priceCredits,
                    isPaid: old.isPaid, salesCount: old.salesCount, collectedByMe: true,
                    subscriptionCovered: old.subscriptionCovered, mine: old.mine, seller: old.seller
                )
            }
            if let b = r.balance { balance = b } else { await refreshBalance() }
            let msg = r.message ?? (r.already == true ? "这门课已在你的书架" : "已放进你的书架")
            banner = Banner(text: msg, tone: .ok)
            Haptics.success()
        } catch let e as APIError where e.needsPaywall {
            // 402：展示后端文案（如「积分不足，充值后可购买本课」）+ 去充值引导。
            banner = Banner(text: e.errorDescription ?? "积分不足，充值后可购买本课",
                            tone: .warn, showRecharge: true)
            Haptics.warning()
        } catch {
            banner = Banner(text: (error as? APIError)?.errorDescription ?? "操作失败，请稍后重试",
                            tone: .red)
            Haptics.error()
        }
    }
}

struct MacMarketView: View {
    @State private var vm = MacMarketViewModel()

    var body: some View {
        ScrollView {
            Group {
                if !vm.items.isEmpty {
                    content
                } else if let err = vm.error {
                    ErrorRetryView(message: err) { Task { await vm.load() } }
                        .padding(40)
                } else if vm.loading {
                    loadingSkeleton
                } else {
                    EmptyStateView(title: "集市暂时空空如也",
                                   subtitle: "稍后再来看看，或去造一门自己的课。",
                                   icon: "bag")
                }
            }
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)
            .padding(28)
        }
        .background(Studio.bg)
        .task { if vm.items.isEmpty { await vm.load() } }
        // 付费确认：课名 + 价 + 当前余额。
        .confirmationDialog(
            "确认购买",
            isPresented: Binding(get: { vm.pendingPurchase != nil },
                                 set: { if !$0 { vm.pendingPurchase = nil } }),
            titleVisibility: .visible,
            presenting: vm.pendingPurchase
        ) { stall in
            Button("支付 \(stall.priceCredits ?? 0) 积分购买") {
                Task { await vm.performCollect(stall) }
            }
            Button("取消", role: .cancel) { vm.pendingPurchase = nil }
        } message: { stall in
            Text("《\(stall.title)》\n价格 \(stall.priceCredits ?? 0) 积分" +
                 (vm.balance.map { " · 当前余额 \($0) 积分" } ?? ""))
        }
        // 结果提示 / 402 引导。
        .overlay(alignment: .bottom) {
            if let banner = vm.banner {
                bannerBar(banner)
                    .padding(.bottom, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(nanoseconds: 3_600_000_000)
                        withAnimation { vm.banner = nil }
                    }
            }
        }
        .animation(StudioMotion.smooth, value: vm.banner?.id)
    }

    // MARK: 主内容

    private var content: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            grid
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "bag.fill")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Studio.red)
                    Text("MARKET")
                        .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
                }
                Text("课程集市")
                    .font(.studio(28, .bold)).foregroundStyle(Studio.ink)
                Text("挑一门喜欢的课，免费拿走或用积分购买。")
                    .font(.studio(14)).foregroundStyle(Studio.ink3)
            }
            Spacer()
            balancePill
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 右上积分余额胶囊（点击刷新）。
    private var balancePill: some View {
        Button {
            Task { await vm.refreshBalance() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "creditcard.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.red)
                Text("积分").font(.studio(12)).foregroundStyle(Studio.ink3)
                Text(vm.balance.map { "\($0)" } ?? "—")
                    .font(.mono(16, .bold)).foregroundStyle(Studio.ink)
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                    .strokeBorder(Studio.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .help("点击刷新余额")
    }

    private var grid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260, maximum: 360), spacing: 16)], spacing: 16) {
            ForEach(vm.items) { stall in
                stallCard(stall)
            }
        }
    }

    // MARK: 摊位卡

    private func stallCard(_ stall: MacMarketStall) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // 封面头：赛道渐变 + 价签徽章。
            ZStack(alignment: .topTrailing) {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Studio.trackGradient(stall.category))
                    .frame(height: 108)
                    .overlay(alignment: .bottomLeading) {
                        Text(stall.title)
                            .font(.studio(15, .bold)).foregroundStyle(.white)
                            .lineLimit(2)
                            .shadow(color: .black.opacity(0.3), radius: 4, y: 1)
                            .padding(12)
                    }
                priceBadge(stall).padding(10)
            }
            VStack(alignment: .leading, spacing: 10) {
                if let sub = stall.subtitle, !sub.isEmpty {
                    Text(sub)
                        .font(.studio(13)).foregroundStyle(Studio.ink3)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 12) {
                    metaChip(icon: "person.2.fill", text: compact(stall.learnersCount))
                    metaChip(icon: "tray.and.arrow.down.fill", text: "\(stall.collectCount)")
                    if let seller = stall.seller {
                        Spacer()
                        Text(seller.nickname)
                            .font(.studio(11)).foregroundStyle(Studio.ink4).lineLimit(1)
                    }
                }
                collectButton(stall)
            }
            .padding(14)
        }
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                .strokeBorder(Studio.border, lineWidth: 1)
        )
        .shadow(color: Color(hex: "#232935").opacity(0.06), radius: 8, x: 0, y: 3)
    }

    private func priceBadge(_ stall: MacMarketStall) -> some View {
        let tone: StatusBadge.Tone =
            stall.collectedByMe ? .ok
            : stall.mine ? .neutral
            : (!stall.isPaid || (stall.priceCredits ?? 0) == 0) ? .info
            : stall.subscriptionCovered == true ? .info
            : .red
        return StatusBadge(text: stall.priceTag,
                           icon: stall.collectedByMe ? "checkmark" : nil,
                           tone: tone)
    }

    private func collectButton(_ stall: MacMarketStall) -> some View {
        let busy = vm.busyId == stall.id
        return Button {
            Haptics.medium()
            vm.tapCollect(stall)
        } label: {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().controlSize(.small).tint(.white)
                } else {
                    Image(systemName: buttonIcon(stall))
                        .font(.system(size: 12, weight: .semibold))
                }
                Text(buttonLabel(stall)).font(.studio(13, .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .foregroundStyle(stall.canCollect ? .white : Studio.ink3)
            .background(stall.canCollect ? Studio.red : Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                stall.canCollect ? nil :
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Studio.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!stall.canCollect || busy)
    }

    private func buttonLabel(_ stall: MacMarketStall) -> String {
        if stall.collectedByMe { return "已在书架" }
        if stall.mine { return "我的课" }
        if stall.needsPaidConfirm { return "购买 · \(stall.priceCredits ?? 0) 积分" }
        return "免费拿走"
    }
    private func buttonIcon(_ stall: MacMarketStall) -> String {
        if stall.collectedByMe { return "checkmark" }
        if stall.mine { return "person.fill" }
        if stall.needsPaidConfirm { return "creditcard.fill" }
        return "tray.and.arrow.down.fill"
    }

    private func metaChip(icon: String, text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(Studio.ink4)
            Text(text).font(.mono(11, .medium)).foregroundStyle(Studio.ink3)
        }
    }

    /// 结果提示条（成功绿 / 402 警示黄含去充值 / 失败红）。
    private func bannerBar(_ banner: MacMarketViewModel.Banner) -> some View {
        HStack(spacing: 10) {
            Image(systemName: banner.tone == .ok ? "checkmark.circle.fill"
                  : banner.tone == .warn ? "exclamationmark.circle.fill"
                  : "xmark.circle.fill")
                .foregroundStyle(bannerFg(banner.tone))
            Text(banner.text)
                .font(.studio(13, .medium)).foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
            if banner.showRecharge {
                Text("· 前往 Web 端充值积分")
                    .font(.studio(12, .semibold)).foregroundStyle(Studio.redInk)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(bannerFg(banner.tone).opacity(0.3), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.15), radius: 16, y: 6)
        .frame(maxWidth: 480)
    }
    private func bannerFg(_ tone: StatusBadge.Tone) -> Color {
        switch tone { case .ok: Studio.ok; case .warn: Studio.warn; case .red: Studio.red
        case .info: Studio.info; case .neutral: Studio.ink2 }
    }

    /// 大数字紧凑显示（12430 → 1.2万）。
    private func compact(_ n: Int) -> String {
        if n >= 10000 { return String(format: "%.1f万", Double(n) / 10000) }
        return "\(n)"
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 20) {
            SkeletonBar(height: 28, width: 200)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260, maximum: 360), spacing: 16)], spacing: 16) {
                ForEach(0..<6, id: \.self) { _ in SkeletonBar(height: 210) }
            }
        }
    }
}
#endif
