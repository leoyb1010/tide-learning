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
    let highlight: Bool           // 是否高亮/推荐档
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

    /// 后端价格文案，如「¥99/月」。以分为单位换算。
    var priceText: String {
        let yuan = Double(priceCents) / 100
        let symbol = currency == "CNY" ? "¥" : currency + " "
        let amount = yuan == yuan.rounded() ? String(format: "%.0f", yuan) : String(format: "%.2f", yuan)
        return "\(symbol)\(amount)\(periodSuffix)"
    }

    /// 副标题：首期优惠提示 or 权益范围。
    var subtitle: String? {
        if let first = firstPriceCents {
            let yuan = Double(first) / 100
            let amount = yuan == yuan.rounded() ? String(format: "%.0f", yuan) : String(format: "%.2f", yuan)
            let symbol = currency == "CNY" ? "¥" : currency + " "
            return "首期 \(symbol)\(amount)"
        }
        return nil
    }

    /// 是否推荐档（对齐后端 highlight）。
    var recommended: Bool { highlight }
}

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
        VStack(alignment: .leading, spacing: 22) {
            statusCard
            plansSection
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
            restoreButton
            legal
        }
        .padding(16)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.actionMessage)
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
    private func activeStatusCard(planName: String, statusLabel: String, periodEnd: Date?, willRenew: Bool) -> some View {
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
            if let periodEnd {
                Rectangle().fill(.white.opacity(0.14)).frame(height: 1)
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(willRenew ? "下次续费" : "有效期至").font(.studio(11)).foregroundStyle(.white.opacity(0.6))
                        Text(dateText(periodEnd)).font(.mono(16, .bold)).foregroundStyle(.white)
                    }
                    Spacer()
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
            VStack(alignment: .leading, spacing: 12) {
                Text("升级套餐").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                ForEach(Array(vm.plans.enumerated()), id: \.element.id) { idx, plan in
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
        if plan.recommended {
            recommendedPlanCard(plan)
        } else {
            regularPlanCard(plan)
        }
    }

    /// 推荐档：深色 videoGradient 高亮卡 + 推荐徽章 + 红 CTA（最强说服力）。
    private func recommendedPlanCard(_ plan: PricingPlan) -> some View {
        let product = plan.storeProductId.flatMap { vm.storeProduct(for: $0) }
        let isPurchasing = vm.purchasingProductId == plan.storeProductId
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(.white)
                        Text("最超值").font(.studio(10, .bold)).foregroundStyle(.white).tracking(0.5)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Studio.red)
                    .clipShape(Capsule())

                    Text(plan.name).font(.studio(18, .bold)).foregroundStyle(.white)
                    if let sub = plan.subtitle {
                        Text(sub).font(.studio(12)).foregroundStyle(.white.opacity(0.7))
                    }
                }
                Spacer()
                Text(product?.displayPrice ?? plan.priceText)
                    .font(.mono(18, .bold)).foregroundStyle(.white)
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

    /// 常规档：浅色卡。
    private func regularPlanCard(_ plan: PricingPlan) -> some View {
        let product = plan.storeProductId.flatMap { vm.storeProduct(for: $0) }
        let isPurchasing = vm.purchasingProductId == plan.storeProductId
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.name).font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                    if let sub = plan.subtitle {
                        Text(sub).font(.studio(12)).foregroundStyle(Studio.ink3)
                    }
                }
                Spacer()
                Text(product?.displayPrice ?? plan.priceText)
                    .font(.mono(15, .bold)).foregroundStyle(Studio.ink)
            }
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
