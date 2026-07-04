import SwiftUI
import Observation
import StoreKit

// MARK: - DTO

/// GET /api/subscription/me —— data 外层：{ subscription, orders, entitlement, switchablePlans }。
/// 后端在无订阅时 subscription / entitlement 返回 null，故全部 Optional。
private struct SubscriptionMe: Decodable {
    let subscription: SubscriptionInfo?
    let entitlement: Entitlement?

    /// 当前订阅记录。
    struct SubscriptionInfo: Decodable {
        let id: String
        let status: String            // active / canceled / ...
        let currentPeriodEnd: Date?   // 当前周期结束（到期/续费时间）
        let cancelAtPeriodEnd: Bool   // true=周期末取消（即不自动续订）
        let plan: PricingPlan         // 内嵌套餐详情
    }

    /// 权益快照（对齐 ProfileView：isSubscriber 等字段）。
    struct Entitlement: Decodable {
        let isSubscriber: Bool
        let statusLabel: String?      // 如「已订阅」
        let validUntil: Date?
    }
}

/// GET /api/pricing —— data 外层是 { plans: [...] }，需先解包。
private struct PricingResponse: Decodable {
    let plans: [PricingPlan]
}

/// 套餐条目（pricing.plans / subscription.plan 共用）。字段对齐后端真实响应。
private struct PricingPlan: Decodable, Identifiable {
    let id: String
    let name: String              // 展示名，如「全站年卡」
    let billingPeriod: String     // month / month_recurring / quarter / year
    let priceCents: Int           // 价格（分）
    let firstPriceCents: Int?     // 首期优惠价（分），可空
    let currency: String          // CNY
    let scope: String             // all / english_oral / ...
    let highlight: Bool           // 是否高亮/推荐档（后端标记）
    let isActive: Bool
}

/// POST /api/iap/verify —— 把 StoreKit 交易凭证交给后端校验入账。
private struct IAPVerifyBody: Encodable {
    let productId: String
    let transactionId: String
    /// StoreKit 2 JWS 签名凭证（后端用它向 Apple 校验）。
    let jws: String
}

// MARK: - StoreKit product IDs

private enum IAPProduct {
    static let all: [String] = ["sub_monthly", "sub_quarterly", "sub_yearly"]

    /// 后端 billingPeriod → StoreKit 产品 ID（用于本地化价格展示与购买）。
    /// 后端不下发 StoreKit product id，故按计费周期映射。
    static func id(for billingPeriod: String) -> String? {
        switch billingPeriod {
        case "month", "month_recurring": return "sub_monthly"
        case "quarter":                  return "sub_quarterly"
        case "year":                     return "sub_yearly"
        default:                         return nil
        }
    }
}

// MARK: - Display helpers

private extension PricingPlan {
    /// StoreKit 产品 ID（按计费周期推导）。
    var storeProductId: String? { IAPProduct.id(for: billingPeriod) }

    /// 计费周期后缀，如「/月」。
    var periodSuffix: String {
        switch billingPeriod {
        case "month", "month_recurring": return "/月"
        case "quarter":                  return "/季"
        case "year":                     return "/年"
        default:                         return ""
        }
    }

    /// 计费周期短标签（用于卡片顶部），如「月卡」。
    var periodLabel: String {
        switch billingPeriod {
        case "month", "month_recurring": return "月卡"
        case "quarter":                  return "季卡"
        case "year":                     return "年卡"
        default:                         return name
        }
    }

    /// 该周期折算的整月数。
    /// 注：每天单价已改为按 365 天摊分（对齐 Web，见 perDayText），不再依赖本属性；
    /// 每月赠额由 monthlyGrant 的固定档位表给出。保留此属性以备后续周期换算复用。
    var monthsInPeriod: Int {
        switch billingPeriod {
        case "quarter": return 3
        case "year":    return 12
        default:        return 1
        }
    }

    /// 后端价格文案，如「¥99/月」。以分为单位换算。
    var priceText: String {
        moneyText(priceCents) + periodSuffix
    }

    /// 月度赠积分（与后端 credits.ts monthlyGrantForPlan 对齐）：
    /// 单赛道固定 200；否则 month 300 / quarter 500 / year 800；兜底 300。
    var monthlyGrant: Int {
        if scope != "all" { return 200 }
        switch billingPeriod {
        case "month", "month_recurring": return 300
        case "quarter":                  return 500
        case "year":                     return 800
        default:                         return 300
        }
    }

    /// 每天单价换算（价格锚定），如「≈ ¥1.37/天」。年卡最具说服力。
    ///
    /// 与 Web 保持同一算法，避免同一年卡在 iOS 与 Web 显示不同金额：
    ///   Web（PricingPlans.tsx: yearPerDayCents = Math.round(priceCents / 365)，
    ///   SubscriptionCard 渲染 `≈ ¥{(cents/100).toFixed(2)}/天`）——
    ///   365 天基准 + 先四舍五入到「分」再两位小数 + 「≈ ¥」前缀。
    ///   此前 iOS 用 monthsInPeriod*30=360 天且一/零位小数，与 Web 不一致，已对齐。
    var perDayText: String? {
        // 与 Web 一致：按 365 天摊分，先四舍五入到「分」（Int），再 /100 两位小数。
        let perDayCents = Int((Double(priceCents) / 365.0).rounded())
        guard perDayCents > 0 else { return nil }
        let amount = String(format: "%.2f", Double(perDayCents) / 100.0)
        return "≈ ¥\(amount)/天"
    }

    /// 首期优惠文案（如有），如「首期 ¥68」。
    var firstPriceText: String? {
        guard let first = firstPriceCents else { return nil }
        return "首期 " + moneyText(first)
    }

    /// 金额格式化：整数省小数，符号跟随币种。
    func moneyText(_ cents: Int) -> String {
        let yuan = Double(cents) / 100
        let symbol = currency == "CNY" ? "¥" : currency + " "
        let amount = yuan == yuan.rounded() ? String(format: "%.0f", yuan) : String(format: "%.2f", yuan)
        return "\(symbol)\(amount)"
    }
}

// MARK: - 权益对比模型（对齐 Web RIGHTS + 档位差异化积分）

/// 一行权益：三态（免费 / 订阅 / 到期）。value 用文本或 ✓/✕ 语义呈现。
private struct RightRow: Identifiable {
    let id = UUID()
    let name: String
    let free: String
    let premium: String
    let expired: String
}

/// 权益清单（镜像 Web pricing/page.tsx 的 RIGHTS，并补齐商业化差异项）。
///
/// 免费列以「服务端真实门禁」为唯一事实源，绝不虚标：
///   AI 造课 / AI 整理笔记 / 模拟考三项在服务端均先做 `!canUseLLM → 402` 硬闸
///   （generate-course / note-transform / generate-exam 三个 route 均如此，且 canUseLLM==isSubscriber，
///   免费用户 canUseLLM=false）。402 在 assertCanSpend 之前抛出，故免费用户「不存在按积分先用」的路径，
///   三项对免费用户一律 ✕。此前 iOS 标「试用 / 1 次/日」属虚标，已按服务端门禁改正。
private let subscriptionRights: [RightRow] = [
    RightRow(name: "订阅赛道课程", free: "✕", premium: "全部解锁", expired: "✕"),
    RightRow(name: "AI 造课",     free: "✕",    premium: "无限",     expired: "✕"),
    RightRow(name: "AI 整理笔记", free: "✕",    premium: "无限",     expired: "仅查看"),
    RightRow(name: "模拟考",      free: "✕",    premium: "无限",     expired: "✕"),
    RightRow(name: "笔记导出",    free: "✕",    premium: "支持",     expired: "✕"),
    RightRow(name: "学习周报",    free: "✕",    premium: "每周推送",  expired: "✕"),
    RightRow(name: "分享成就卡",  free: "基础",  premium: "全部样式",  expired: "基础"),
    RightRow(name: "笔记永久保存", free: "3 篇", premium: "无限",     expired: "仅查看"),
]

/// 常见问题（iOS 用 DisclosureGroup 呈现，对齐商业化订阅页）。
private struct FAQItem: Identifiable {
    let id = UUID()
    let q: String
    let a: String
}

private let subscriptionFAQ: [FAQItem] = [
    FAQItem(q: "订阅后每月送多少积分？",
            a: "按档位差异化发放：月卡每月赠 300 积分，季卡每月 500，年卡每月 800。积分用于 AI 造课、AI 整理笔记等消耗，每月自动到账。"),
    FAQItem(q: "可以随时取消吗？",
            a: "可以。在系统「设置 › Apple ID › 订阅」中随时取消，当前周期内权益不受影响，到期后不再续费。"),
    FAQItem(q: "到期后我的笔记会丢吗？",
            a: "不会。停订后赛道课程会锁定，但你创建的笔记与截帧永久保留、可随时查看。"),
    FAQItem(q: "支持退款吗？",
            a: "订阅通过 App Store 计费，退款请在系统「设置 › Apple ID › 订阅」或通过 Apple 支持申请，遵循 App Store 退款政策。"),
    FAQItem(q: "换了新手机怎么办？",
            a: "同一 Apple ID 登录后，点本页底部「恢复购买」即可同步已有订阅，无需重新付费。"),
]

// MARK: - ViewModel

@Observable @MainActor
final class SubscriptionViewModel {
    // 远端状态
    fileprivate var me: SubscriptionMe?
    fileprivate var plans: [PricingPlan] = []
    var loadError: String?
    var loading = false

    // StoreKit
    var storeProducts: [Product] = []
    var purchasingProductId: String?
    var restoring = false
    var actionMessage: String?   // 成功/失败提示（非致命，行内展示）
    var showPaywallHint = false  // 402 引导

    /// 并发拉取订阅状态 + 定价 + StoreKit 商品。任一失败不致命，给占位。
    func load() async {
        loading = true; loadError = nil
        defer { loading = false }

        async let meResult = fetchMe()
        async let pricingResult = fetchPricing()
        async let productsResult = fetchStoreProducts()

        let (meVal, plansVal, prods) = await (meResult, pricingResult, productsResult)

        me = meVal.value
        if let err = meVal.error, plansVal.value == nil {
            // 状态与定价都失败才算整页错误。
            loadError = err
        }
        plans = plansVal.value ?? []
        storeProducts = prods
    }

    private struct Fetched<T> { let value: T?; let error: String? }

    private func fetchMe() async -> Fetched<SubscriptionMe> {
        do {
            let v = try await API.shared.get("/api/subscription/me", as: SubscriptionMe.self)
            return .init(value: v, error: nil)
        } catch {
            return .init(value: nil, error: (error as? APIError)?.errorDescription ?? "加载订阅状态失败")
        }
    }

    private func fetchPricing() async -> Fetched<[PricingPlan]> {
        do {
            let v = try await API.shared.get("/api/pricing", as: PricingResponse.self)
            // 只展示有效套餐。
            return .init(value: v.plans.filter { $0.isActive }, error: nil)
        } catch {
            return .init(value: nil, error: (error as? APIError)?.errorDescription ?? "加载套餐失败")
        }
    }

    private func fetchStoreProducts() async -> [Product] {
        do {
            let prods = try await Product.products(for: IAPProduct.all)
            // 按预定义顺序排序，保证 UI 稳定。
            return prods.sorted { lhs, rhs in
                (IAPProduct.all.firstIndex(of: lhs.id) ?? 0) < (IAPProduct.all.firstIndex(of: rhs.id) ?? 0)
            }
        } catch {
            return []
        }
    }

    func storeProduct(for productId: String) -> Product? {
        storeProducts.first { $0.id == productId }
    }

    // MARK: Purchase

    /// 发起购买 → 校验签名 → 交后端入账 → 刷新状态。
    func purchase(_ product: Product) async {
        purchasingProductId = product.id
        actionMessage = nil
        defer { purchasingProductId = nil }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                try await handle(verification: verification, productId: product.id)
                actionMessage = "订阅成功，欢迎升级！"
                await refreshMe()
            case .userCancelled:
                break // 用户主动取消，静默。
            case .pending:
                actionMessage = "购买待确认，完成后将自动开通。"
            @unknown default:
                actionMessage = "购买状态未知，请稍后在「恢复购买」确认。"
            }
        } catch let apiErr as APIError {
            if apiErr.needsPaywall { showPaywallHint = true }
            actionMessage = apiErr.errorDescription
        } catch {
            actionMessage = "购买失败，请重试"
        }
    }

    /// 恢复购买：与 App Store 同步后，遍历当前有效权益重新入账。
    func restore() async {
        restoring = true; actionMessage = nil
        defer { restoring = false }
        do {
            try await AppStore.sync()
        } catch {
            actionMessage = "同步 App Store 失败，请重试"
            return
        }
        var restored = 0
        for await entitlement in StoreKit.Transaction.currentEntitlements {
            if case .verified(let transaction) = entitlement,
               IAPProduct.all.contains(transaction.productID) {
                do {
                    try await verifyWithBackend(productId: transaction.productID,
                                                transactionId: String(transaction.id),
                                                jws: entitlement.jwsRepresentation)
                    restored += 1
                } catch {
                    // 单笔失败不阻断其余凭证。
                    continue
                }
            }
        }
        if restored > 0 {
            actionMessage = "已恢复 \(restored) 项订阅。"
            await refreshMe()
        } else {
            actionMessage = "未找到可恢复的订阅。"
        }
    }

    // MARK: Helpers

    /// 校验 StoreKit 签名 → 交后端 → finish 交易。
    private func handle(verification: VerificationResult<StoreKit.Transaction>, productId: String) async throws {
        switch verification {
        case .verified(let transaction):
            try await verifyWithBackend(productId: productId,
                                        transactionId: String(transaction.id),
                                        jws: verification.jwsRepresentation)
            await transaction.finish()
        case .unverified:
            throw APIError.message("交易凭证校验未通过")
        }
    }

    private func verifyWithBackend(productId: String, transactionId: String, jws: String) async throws {
        _ = try await API.shared.post("/api/iap/verify",
                                      body: IAPVerifyBody(productId: productId, transactionId: transactionId, jws: jws),
                                      as: EmptyResponse.self)
    }

    private func refreshMe() async {
        let r = await fetchMe()
        if let v = r.value { me = v }
    }

    // MARK: 商业化派生

    /// 三档展示顺序：月 → 季 → 年（年在最后视觉压轴）。
    fileprivate var orderedPlans: [PricingPlan] {
        let rank: (String) -> Int = { p in
            switch p {
            case "month", "month_recurring": return 0
            case "quarter": return 1
            case "year": return 2
            default: return 3
            }
        }
        // 只保留全站三档主套餐用于三档卡；单赛道等其余套餐仍按 isActive 保留在后。
        let full = plans.filter { $0.scope == "all" }
        let others = plans.filter { $0.scope != "all" }
        let sortedFull = full.sorted { rank($0.billingPeriod) < rank($1.billingPeriod) }
        return sortedFull + others
    }

    /// 推荐档（年卡）id。仅一个，修复「两卡都挂最受欢迎」问题。
    /// 优先后端 highlight 的年卡；否则取任一年卡；再兜底后端 highlight。
    fileprivate var recommendedPlanId: String? {
        let full = plans.filter { $0.scope == "all" }
        if let year = full.first(where: { $0.billingPeriod == "year" }) { return year.id }
        if let hl = full.first(where: { $0.highlight }) { return hl.id }
        return full.last?.id
    }

    /// 全站月卡整年价（用于年卡「立省」锚定）。取全站 month 档 × 12。
    fileprivate var monthlyYearlyBaselineCents: Int? {
        plans.first { $0.scope == "all" && ($0.billingPeriod == "month" || $0.billingPeriod == "month_recurring") }
            .map { $0.priceCents * 12 }
    }
}

// MARK: - View

struct SubscriptionView: View {
    @State private var vm = SubscriptionViewModel()
    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            if vm.loadError != nil, vm.me == nil, vm.plans.isEmpty {
                ErrorRetryView(message: vm.loadError!) { Task { await vm.load() } }
                    .padding(.top, 40)
            } else if vm.loading && vm.me == nil && vm.plans.isEmpty {
                loadingSkeleton
            } else {
                content
            }
        }
        .background(Studio.bg)
        .navigationTitle("订阅与积分")
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.me == nil && vm.plans.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
        .onChange(of: vm.actionMessage) { _, new in
            // 订阅/恢复成功文案含「成功」「已恢复」→ 成功触觉；其余为提示。
            guard let m = new else { return }
            if m.contains("成功") || m.contains("已恢复") { Haptics.success() }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 26) {
            statusCard
            plansSection
            actionMessageBanner
            benefitsSection
            faqSection
            restoreButton
            legal
        }
        .padding(16)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.actionMessage)
    }

    // MARK: 行内提示 banner

    @ViewBuilder
    private var actionMessageBanner: some View {
        if let msg = vm.actionMessage {
            let ok = msg.contains("成功") || msg.contains("已恢复")
            HStack(spacing: 6) {
                Image(systemName: ok ? "checkmark.circle.fill" : "info.circle.fill")
                    .font(.system(size: 13))
                Text(msg).font(.studio(13, .medium))
            }
            .foregroundStyle(ok ? Studio.ok : Studio.info)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(10)
            .background(ok ? Studio.okSoft : Studio.infoSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .transition(.opacity.combined(with: .scale(scale: 0.97)))
        }
    }

    // MARK: Status

    @ViewBuilder
    private var statusCard: some View {
        if let me = vm.me {
            // 是否有效会员：优先 entitlement.isSubscriber，回退 subscription.status。
            let isActive = me.entitlement?.isSubscriber ?? (me.subscription?.status == "active")
            // 展示名：当前订阅套餐名，无订阅则「免费用户」。
            let planName = me.subscription?.plan.name ?? "免费用户"
            // 到期/续费时间：cancelAtPeriodEnd=true → 到期；false → 续费。
            let periodEnd = me.subscription?.currentPeriodEnd ?? me.entitlement?.validUntil
            let willRenew = me.subscription.map { !$0.cancelAtPeriodEnd } ?? false
            if isActive {
                activeStatusCard(planName: planName,
                                 statusLabel: me.entitlement?.statusLabel ?? "会员有效",
                                 monthlyGrant: me.subscription?.plan.monthlyGrant,
                                 periodEnd: periodEnd, willRenew: willRenew)
            } else {
                freeStatusCard(planName: planName,
                               statusLabel: me.entitlement?.statusLabel ?? "未订阅")
            }
        } else {
            // 状态拉取失败但定价可展示：给占位卡，不崩。
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Studio.warn)
                Text("暂时无法获取会员状态").font(.studio(13)).foregroundStyle(Studio.ink3)
                Spacer()
            }
            .studioCard()
        }
    }

    /// 会员有效：深色 videoGradient 尊享卡（premium 质感）。
    private func activeStatusCard(planName: String, statusLabel: String, monthlyGrant: Int?, periodEnd: Date?, willRenew: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Image(systemName: "crown.fill").font(.system(size: 13)).foregroundStyle(Studio.newInk)
                        Text(statusLabel).font(.mono(10, .semibold)).foregroundStyle(.white.opacity(0.7)).tracking(1)
                    }
                    Text(planName).font(.studio(20, .bold)).foregroundStyle(.white)
                }
                Spacer()
            }
            Rectangle().fill(.white.opacity(0.14)).frame(height: 1)
            HStack(alignment: .top) {
                if let monthlyGrant {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("每月赠积分").font(.studio(11)).foregroundStyle(.white.opacity(0.6))
                        HStack(spacing: 4) {
                            Image(systemName: "sparkles").font(.system(size: 12)).foregroundStyle(Studio.newInk)
                            Text("\(monthlyGrant)").font(.mono(16, .bold)).foregroundStyle(.white)
                        }
                    }
                }
                Spacer()
                if let periodEnd {
                    VStack(alignment: .trailing, spacing: 3) {
                        Text(willRenew ? "下次续费" : "有效期至").font(.studio(11)).foregroundStyle(.white.opacity(0.6))
                        Text(dateText(periodEnd)).font(.mono(16, .bold)).foregroundStyle(.white)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .shadow(color: StudioElevation.l2(.dark).color, radius: 16, x: 0, y: 8)
    }

    /// 免费用户：浅色卡 + 升级引导。
    private func freeStatusCard(planName: String, statusLabel: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(planName).font(.studio(18, .bold)).foregroundStyle(Studio.ink)
                Text(statusLabel).font(.studio(12, .medium)).foregroundStyle(Studio.ink3)
            }
            Spacer()
            ZStack {
                Circle().fill(Studio.surface2).frame(width: 44, height: 44)
                Image(systemName: "crown").font(.system(size: 20)).foregroundStyle(Studio.ink4)
            }
        }
        .studioCard()
    }

    // MARK: Plans

    @ViewBuilder
    private var plansSection: some View {
        if vm.plans.isEmpty {
            EmptyStateView(title: "套餐加载失败", subtitle: "下拉刷新重试")
        } else {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("选择套餐").font(.studio(18, .bold)).foregroundStyle(Studio.ink)
                    Text("一次订阅，解锁全部赛道，随时可取消").font(.studio(13)).foregroundStyle(Studio.ink3)
                }
                let planList = vm.orderedPlans
                ForEach(Array(planList.enumerated()), id: \.element.id) { idx, plan in
                    planCard(plan)
                        .opacity(appeared || reduceMotion ? 1 : 0)
                        .offset(y: appeared || reduceMotion ? 0 : 14)
                        .animation(
                            reduceMotion ? nil : StudioMotion.smooth.delay(Double(min(idx, 8)) * 0.05),
                            value: appeared
                        )
                }
            }
            .onAppear {
                if reduceMotion { appeared = true }
                else { DispatchQueue.main.async { appeared = true } }
            }
        }
    }

    @ViewBuilder
    private func planCard(_ plan: PricingPlan) -> some View {
        if plan.id == vm.recommendedPlanId {
            recommendedPlanCard(plan)
        } else {
            regularPlanCard(plan)
        }
    }

    /// 年卡 vs 全站单月×12 的立省文案（价格锚定）。
    private func savingText(for plan: PricingPlan) -> String? {
        guard plan.billingPeriod == "year",
              let baseline = vm.monthlyYearlyBaselineCents,
              baseline > plan.priceCents else { return nil }
        let saved = baseline - plan.priceCents
        return "较按月订阅立省 " + plan.moneyText(saved)
    }

    /// 推荐档（年卡）：深色 videoGradient 高亮卡 + 单一推荐徽章 + 每月赠积分 + 价格锚定 + 红 CTA。
    private func recommendedPlanCard(_ plan: PricingPlan) -> some View {
        let product = plan.storeProductId.flatMap { vm.storeProduct(for: $0) }
        let isPurchasing = vm.purchasingProductId == plan.storeProductId
        return VStack(alignment: .leading, spacing: 14) {
            // 顶行：周期标签 + 单一「最超值」徽章
            HStack {
                Text(plan.periodLabel).font(.mono(11, .semibold))
                    .foregroundStyle(.white.opacity(0.72)).tracking(1)
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(.white)
                    Text("最超值").font(.studio(10, .bold)).foregroundStyle(.white).tracking(0.5)
                }
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(Studio.red)
                .clipShape(Capsule())
            }

            // 价格行：主价 + 每天换算
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(product?.displayPrice ?? plan.moneyText(plan.priceCents))
                    .font(.mono(26, .bold)).foregroundStyle(.white)
                Text(plan.periodSuffix).font(.studio(14, .medium)).foregroundStyle(.white.opacity(0.7))
                Spacer()
                if let perDay = plan.perDayText {
                    Text(perDay).font(.mono(12, .medium))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.white.opacity(0.12))
                        .clipShape(Capsule())
                }
            }

            // 立省锚定
            if let saving = savingText(for: plan) {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.down.circle.fill").font(.system(size: 11)).foregroundStyle(Studio.ok)
                    Text(saving).font(.studio(12, .semibold)).foregroundStyle(.white.opacity(0.92))
                }
            }

            // 每月赠积分（差异化卖点）
            grantPill(plan.monthlyGrant, onDark: true)

            // 首期优惠（如有）
            if let first = plan.firstPriceText {
                Text(first).font(.studio(12)).foregroundStyle(.white.opacity(0.7))
            }

            StudioButton(title: product == nil ? "暂不可购买" : "立即订阅",
                         kind: .red,
                         loading: isPurchasing) {
                guard let product else { return }
                Task { await vm.purchase(product) }
            }
            .disabled(product == nil || isPurchasing)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
            .strokeBorder(Studio.red.opacity(0.55), lineWidth: 1.5))
        .shadow(color: Studio.red.opacity(0.22), radius: 18, x: 0, y: 8)
    }

    /// 常规档（月/季）：浅色卡 + 每月赠积分 + 每天换算 + ink CTA。
    private func regularPlanCard(_ plan: PricingPlan) -> some View {
        let product = plan.storeProductId.flatMap { vm.storeProduct(for: $0) }
        let isPurchasing = vm.purchasingProductId == plan.storeProductId
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(plan.periodLabel).font(.mono(11, .semibold))
                        .foregroundStyle(Studio.ink3).tracking(0.5)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(product?.displayPrice ?? plan.moneyText(plan.priceCents))
                            .font(.mono(20, .bold)).foregroundStyle(Studio.ink)
                        Text(plan.periodSuffix).font(.studio(12, .medium)).foregroundStyle(Studio.ink3)
                    }
                    if let first = plan.firstPriceText {
                        Text(first).font(.studio(12)).foregroundStyle(Studio.redInk)
                    }
                }
                Spacer()
                if let perDay = plan.perDayText {
                    Text(perDay).font(.mono(11, .medium))
                        .foregroundStyle(Studio.ink3)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Studio.surface2)
                        .clipShape(Capsule())
                }
            }

            grantPill(plan.monthlyGrant, onDark: false)

            StudioButton(title: product == nil ? "暂不可购买" : "订阅",
                         kind: .ink,
                         loading: isPurchasing) {
                guard let product else { return }
                Task { await vm.purchase(product) }
            }
            .disabled(product == nil || isPurchasing)
        }
        .studioCard()
    }

    /// 「每月赠 N 积分」药丸（深色/浅色两态）。差异化卖点统一样式。
    private func grantPill(_ grant: Int, onDark: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "sparkles").font(.system(size: 11))
            Text("每月赠 ").font(.studio(12, .medium))
                + Text("\(grant)").font(.mono(13, .bold))
                + Text(" 积分").font(.studio(12, .medium))
        }
        .foregroundStyle(onDark ? Studio.newInk : Studio.redInk)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(onDark ? Color.white.opacity(0.10) : Studio.redSoft)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(onDark ? Color.white.opacity(0.16) : Studio.redSoftBorder, lineWidth: 1))
    }

    // MARK: 权益对比

    private var benefitsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("权益对比").font(.studio(18, .bold)).foregroundStyle(Studio.ink)
            VStack(spacing: 0) {
                // 表头：权益 / 免费 / 订阅 / 到期（订阅列红竖带贯穿至各行）
                HStack(spacing: 0) {
                    Text("权益").font(.studio(12, .medium)).foregroundStyle(Studio.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("免费").font(.studio(12, .medium)).foregroundStyle(Studio.ink4)
                        .frame(width: 72, alignment: .center)
                    Text("订阅").font(.studio(12, .bold)).foregroundStyle(Studio.redInk)
                        .frame(width: 72, alignment: .center)
                        .frame(maxHeight: .infinity)
                        .background(Studio.redSoft)
                    Text("到期").font(.studio(12, .medium)).foregroundStyle(Studio.ink4)
                        .frame(width: 72, alignment: .center)
                }
                .padding(.leading, 14)
                .frame(height: 40)

                Rectangle().fill(Studio.border).frame(height: 1)

                ForEach(Array(subscriptionRights.enumerated()), id: \.element.id) { idx, row in
                    rightRowView(row)
                    if idx < subscriptionRights.count - 1 {
                        Rectangle().fill(Studio.border).frame(height: 1)
                    }
                }
            }
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                .strokeBorder(Studio.border, lineWidth: 1))
            .shadow(color: StudioElevation.l1(.light).color, radius: 10, x: 0, y: 4)

            Text("停订后课程锁定，但笔记永久保留、可查看。健康类内容仅供健康信息素养学习。")
                .font(.studio(11)).foregroundStyle(Studio.ink4)
                .lineSpacing(2)
        }
    }

    private func rightRowView(_ row: RightRow) -> some View {
        HStack(spacing: 0) {
            Text(row.name).font(.studio(13, .medium)).foregroundStyle(Studio.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            cell(row.free, strong: false)
                .frame(width: 72, alignment: .center)
            cell(row.premium, strong: true)
                .frame(width: 72, alignment: .center)
                .frame(maxHeight: .infinity)
                .background(Studio.redSoft)
            cell(row.expired, strong: false)
                .frame(width: 72, alignment: .center)
        }
        .padding(.leading, 14)
        .frame(minHeight: 46)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// 权益单元格：✓ 用 ok 语义、✕ 弱化，其余文本原样。strong 用于订阅列强调。
    @ViewBuilder
    private func cell(_ value: String, strong: Bool) -> some View {
        if value == "✓" || value == "支持" {
            Image(systemName: "checkmark")
                .font(.system(size: strong ? 13 : 11, weight: strong ? .bold : .semibold))
                .foregroundStyle(Studio.ok.opacity(strong ? 1 : 0.85))
        } else if value == "✕" {
            Image(systemName: "minus")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Studio.ink4)
        } else {
            Text(value)
                .font(.studio(strong ? 12 : 11, strong ? .bold : .regular))
                .foregroundStyle(strong ? Studio.redInk : Studio.ink3)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 3)
        }
    }

    // MARK: FAQ

    private var faqSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("常见问题").font(.studio(18, .bold)).foregroundStyle(Studio.ink)
            VStack(spacing: 10) {
                ForEach(subscriptionFAQ) { item in
                    FAQRow(item: item)
                }
            }
        }
    }

    // MARK: Restore / legal

    private var restoreButton: some View {
        StudioButton(title: "恢复购买", kind: .ghost, loading: vm.restoring) {
            Task { await vm.restore() }
        }
    }

    private var legal: some View {
        Text("订阅通过 App Store 计费，将在当前订阅周期结束前 24 小时自动续订。你可在系统「设置 › Apple ID › 订阅」中随时管理或取消。")
            .font(.studio(11)).foregroundStyle(Studio.ink4)
            .multilineTextAlignment(.leading)
            .padding(.top, 4)
    }

    private func dateText(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            SkeletonBar(height: 100).clipShape(RoundedRectangle(cornerRadius: 16))
            SkeletonBar(height: 18, width: 120)
            ForEach(0..<3, id: \.self) { _ in
                SkeletonBar(height: 130).clipShape(RoundedRectangle(cornerRadius: 16))
            }
        }
        .padding(16)
    }
}

// MARK: - FAQ Row（自定义展开，尊重 reduce-motion）

private struct FAQRow: View {
    let item: FAQItem
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                Haptics.selection()
                if reduceMotion { expanded.toggle() }
                else { withAnimation(StudioMotion.smooth) { expanded.toggle() } }
            } label: {
                HStack(spacing: 10) {
                    Text(item.q).font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Studio.ink3)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                Text(item.a)
                    .font(.studio(13)).foregroundStyle(Studio.ink2)
                    .lineSpacing(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 10)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(14)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
            .strokeBorder(Studio.border, lineWidth: 1))
    }
}
