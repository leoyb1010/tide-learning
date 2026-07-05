import SwiftUI
import Observation

// MARK: - DTO（对齐 web v4.0 交易市场：摊位卡 + 拿走）

/// 集市摊位项。字段对齐后端 GET /api/market → { items: [...] }
/// （与 web src/lib/market-view.ts 的 MarketStall 共用同一份组装逻辑 buildMarketStalls）。
///
/// 后端字段：id / slug / title / subtitle / category / coverColor / coverSrc / origin /
/// collectCount / learnersCount / priceCredits / isPaid / salesCount / collectedByMe / mine /
/// createdAtMs / seller{id,nickname,avatarUrl,level}。
/// iOS 对少数字段放宽为可选（slug/category/coverColor/coverSrc/origin/createdAtMs），
/// 后端恒返回非空值，可选解码兼容且更抗未来字段调整。
struct MarketStall: Decodable, Identifiable, Equatable {
    let id: String
    let slug: String?
    let title: String
    let subtitle: String?
    let category: String?
    let coverColor: String?
    /// 封面图 URL（后端 coverSrc；当前渲染走 coverColor 渐变，保留字段对齐后端契约）。
    let coverSrc: String?
    let origin: String?              // ai_generated / user_imported / official
    /// 拿走数（有该课学习记录的去重用户数，排除作者本人）。
    let collectCount: Int
    /// 累计学习人数（Course.learnersCount 真值）。
    let learnersCount: Int
    /// 售价（积分）。后端 priceCredits：null/0 = 免费课；>0 = 付费课，
    /// collect 端点会走 purchaseCourse **真实扣积分**（余额不足 402）。
    let priceCredits: Int?
    /// 是否付费课（后端派生真值 (priceCredits ?? 0) > 0；直接解码避免两端派生口径漂移）。
    let isPaid: Bool
    /// 付费成交数（Course.salesCount：仅付费成交 +1，免费拿走不计入）。
    let salesCount: Int
    /// 当前登录用户是否已把此课拿到书架（决定 CTA 初始态）。
    let collectedByMe: Bool
    /// 是否本人摊位（自己造的课不出「拿走」，显示「你的摊位」）。
    let mine: Bool
    /// 上新时间戳（毫秒），用于「最新」排序。
    let createdAtMs: Double?
    let seller: Seller

    /// 摊主。后端还返回 seller.level（等级数字），iOS 卡片按 collectCount 自行派生徽章，
    /// 未解码 level（Decodable 忽略多余字段，不影响解码）。
    struct Seller: Decodable, Equatable {
        let id: String?
        let nickname: String
        let avatarUrl: String?
    }

    /// 展示/确认用售价（免费恒 0）。
    var price: Int { priceCredits ?? 0 }
    /// 付费语义闸门：任一信号（isPaid / priceCredits>0）判付费即走「确认购买」路径，
    /// 防契约漂移导致付费课被当免费课静默扣款（服务端按自己的 priceCredits 分支，为最终真值）。
    var paid: Bool { isPaid || price > 0 }
}

/// GET /api/market → { items: [MarketStall] }。
private struct MarketResponse: Decodable {
    let items: [MarketStall]
}

// MARK: - 排序（对齐 web MarketSort：最热/最新）

/// 排序键。默认最热（交易市场看热货）。对齐 web normalizeSort。
enum MarketSort: String, CaseIterable, Identifiable {
    case hot, new
    var id: String { rawValue }
    var label: String { self == .hot ? "最热" : "最新" }
    var icon: String { self == .hot ? "flame.fill" : "clock.fill" }
}

// MARK: - ViewModel

@Observable @MainActor
final class MarketViewModel {
    var stalls: [MarketStall]?
    var error: String?
    var loading = false

    /// 当前排序键。
    var sort: MarketSort = .hot

    /// 正在拿走/购买的课程 id 集合（按钮内 loading）。
    var collectingIds: Set<String> = []
    /// 单条拿走/购买错误提示（course.id -> 文案）。
    var collectErrors: [String: String] = [:]
    /// 拿走/购买成功后的轻提示（course.id -> 文案），驱动卡内成功态与顶部 toast。
    var lastCollected: (id: String, message: String)?

    /// 当前用户积分余额（GET /api/credits/me）。nil = 未知/拉取失败——未知不阻断购买，
    /// 服务端事务内二次核验余额并 402 兜底（对齐 web MarketBuyPanel 的降级策略）。
    var balance: Int?
    /// 待确认购买的付费摊位（非 nil 时弹确认层；确认后才发请求，杜绝点击即静默扣积分）。
    var pendingPurchase: MarketStall?
    /// 余额不足（402）的摊位 id 集合：卡内错误行额外露「去充值」引导。
    var paywallIds: Set<String> = []

    /// GET /api/market → { items: [...] }（真实 API，主路径）。
    /// 后端与 web 集市页共用 buildMarketStalls 组装，字段/语义一致，直接解码。
    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let resp = try await API.shared.get("/api/market", as: MarketResponse.self)
            stalls = resp.items
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    /// 客户端排序（对齐 web sortStalls：最新按 createdAtMs 降序，最热按 collectCount 降序；同分保原序）。
    var sortedStalls: [MarketStall] {
        guard let stalls else { return [] }
        let indexed = Array(stalls.enumerated())
        let sorted = indexed.sorted { a, b in
            switch sort {
            case .new:
                let ax = a.element.createdAtMs ?? 0, bx = b.element.createdAtMs ?? 0
                if ax != bx { return ax > bx }
            case .hot:
                if a.element.collectCount != b.element.collectCount {
                    return a.element.collectCount > b.element.collectCount
                }
            }
            return a.offset < b.offset // 同分保稳定原序
        }
        return sorted.map { $0.element }
    }

    /// 今日集市氛围：累计被拿走次数。
    var totalCollects: Int {
        stalls?.reduce(0) { $0 + $1.collectCount } ?? 0
    }

    /// GET /api/credits/me → 只取 balance（氛围条余额徽章 + 购买确认层展示）。
    /// 失败静默保留旧值：余额未知不阻断购买，服务端 402 兜底。
    func loadBalance() async {
        struct CreditsBalance: Decodable { let balance: Int }
        if let me = try? await API.shared.get("/api/credits/me", as: CreditsBalance.self) {
            balance = me.balance
        }
    }

    /// 付费课 CTA 入口：先拉最新余额，再弹确认层（对齐 web MarketBuyPanel「进层拉余额」）。
    /// 确认层展示课名/售价/当前余额，用户确认后才真正发 collect 请求。
    func beginPurchase(_ stall: MarketStall) async {
        guard !stall.mine, !stall.collectedByMe, !collectingIds.contains(stall.id) else { return }
        collectErrors[stall.id] = nil
        paywallIds.remove(stall.id)
        collectingIds.insert(stall.id)
        await loadBalance()
        collectingIds.remove(stall.id)
        pendingPurchase = stall
    }

    /// 「拿走 / 购买」：POST /api/market/collect { courseId }，成功后乐观更新（本人拿走态 + 计数）。
    /// 服务端按课程 priceCredits 分支：免费直接进书架；付费走 purchaseCourse 真实扣积分。
    /// 对齐 web collect 端点：幂等（already=true 时不再重复计数），本人课不可拿走。
    /// 付费课**必须**从 beginPurchase 的确认层进入本方法，禁止直连（防静默扣款）。
    func collect(_ stall: MarketStall) async {
        guard !stall.mine, !stall.collectedByMe, !collectingIds.contains(stall.id) else { return }
        collectingIds.insert(stall.id)
        collectErrors[stall.id] = nil
        paywallIds.remove(stall.id)
        defer { collectingIds.remove(stall.id) }

        struct Body: Encodable { let courseId: String }
        struct CollectResult: Decodable {
            let status: String?
            let already: Bool?
            let message: String?
            /// 付费成交后买家新余额（免费分支不返回）。
            let balance: Int?
            /// 本次实扣积分（幂等命中为 0；免费分支不返回）。
            let spent: Int?
        }
        do {
            let result = try await API.shared.post(
                "/api/market/collect",
                body: Body(courseId: stall.id),
                as: CollectResult.self
            )
            let already = result.already ?? false
            markCollected(stall.id, incrementCount: !already)
            // 付费成交：用服务端回传余额刷新（真值），免费分支余额不变。
            if let newBalance = result.balance { balance = newBalance }
            lastCollected = (stall.id, result.message ?? "已放入书架")
        } catch {
            let apiError = error as? APIError
            collectErrors[stall.id] = apiError?.errorDescription ?? "拿走失败"
            // 402 积分不足：展示后端文案（「积分不足，充值后可购买本课」）+ 卡内「去充值」引导，
            // 并刷新余额让确认层/氛围条数字回到准确值（并发下余额可能已变）。
            if apiError?.needsPaywall == true {
                paywallIds.insert(stall.id)
                await loadBalance()
            }
            Haptics.warning()
        }
    }

    private func markCollected(_ courseId: String, incrementCount: Bool) {
        guard let idx = stalls?.firstIndex(where: { $0.id == courseId }) else { return }
        let old = stalls![idx]
        stalls![idx] = MarketStall(
            id: old.id,
            slug: old.slug,
            title: old.title,
            subtitle: old.subtitle,
            category: old.category,
            coverColor: old.coverColor,
            coverSrc: old.coverSrc,
            origin: old.origin,
            collectCount: old.collectCount + (incrementCount ? 1 : 0),
            learnersCount: old.learnersCount,
            priceCredits: old.priceCredits,
            isPaid: old.isPaid,
            // 付费成交数乐观 +1（对齐服务端 salesCount increment；免费拿走不计）。
            salesCount: old.salesCount + (incrementCount && old.paid ? 1 : 0),
            collectedByMe: true,
            mine: old.mine,
            createdAtMs: old.createdAtMs,
            seller: old.seller
        )
    }
}

// MARK: - View

/// 课程集市「交易市场」（对齐 web v4.0）。
/// 结构：氛围条（累计被拿走）+ 排序切换（最热/最新）+ 摊位卡网格 + 拿走。
struct MarketView: View {
    @State private var vm = MarketViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 「已放入书架」toast 显示态。
    @State private var showToast = false
    /// 402 引导充值：present RechargeView sheet。
    @State private var showRecharge = false
    /// 拿走后可跳书架：由外部注入（书桌 sheet 内打开时用），缺省仅 toast。
    var onGoShelf: (() -> Void)? = nil

    var body: some View {
        // 不自带 NavigationStack：本视图从课程库 push 进来，复用父级导航栈（避免嵌套栈布局问题）。
        // navigationTitle 由父级栈渲染。
        ScrollView {
            content
                .padding(16)
        }
        .background(Studio.bg)
        .navigationTitle("课程集市")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard vm.stalls == nil else { return }
            // 摊位与余额并行拉取（余额供付费确认层/氛围条，失败静默不阻断）。
            async let balance: Void = vm.loadBalance()
            await vm.load()
            await balance
        }
        .refreshable {
            await vm.load()
            await vm.loadBalance()
        }
        .overlay(alignment: .top) { toast }
        .onChange(of: vm.lastCollected?.id) { _, new in
            guard new != nil else { return }
            Haptics.success()
            withAnimation(reduceMotion ? nil : StudioMotion.smooth) { showToast = true }
            Task {
                try? await Task.sleep(nanoseconds: 2_600_000_000)
                withAnimation(reduceMotion ? nil : StudioMotion.smooth) { showToast = false }
            }
        }
        // 付费课确认层：课名 + 售价 + 当前余额，确认后才发请求（杜绝点击即静默扣积分）。
        // 余额已知且不足时不给「确认」，改为引导充值（对齐 web MarketBuyPanel 够/不够分支）。
        .alert("确认购买", isPresented: purchaseBinding, presenting: vm.pendingPurchase) { stall in
            if let balance = vm.balance, balance < stall.price {
                Button("去充值") { showRecharge = true }
                Button("取消", role: .cancel) {}
            } else {
                Button("确认购买 · \(stall.price) 积分") {
                    Task { await vm.collect(stall) }
                }
                Button("取消", role: .cancel) {}
            }
        } message: { stall in
            Text(purchaseMessage(for: stall))
        }
        // 充值页（StoreKit IAP）；充值成功回来刷新余额。
        .sheet(isPresented: $showRecharge) {
            RechargeView { Task { await vm.loadBalance() } }
        }
    }

    /// 确认层显隐绑定（pendingPurchase 有值即弹；关闭即清）。
    private var purchaseBinding: Binding<Bool> {
        Binding(
            get: { vm.pendingPurchase != nil },
            set: { if !$0 { vm.pendingPurchase = nil } }
        )
    }

    /// 确认层正文：课名 / 售价 / 当前余额；不足时给出差额与充值引导。
    private func purchaseMessage(for stall: MarketStall) -> String {
        let balanceText = vm.balance.map { "\($0) 积分" } ?? "未知（以服务端为准）"
        var lines = [
            "《\(stall.title)》",
            "售价 \(stall.price) 积分 · 当前余额 \(balanceText)",
        ]
        if let balance = vm.balance, balance < stall.price {
            lines.append("还差 \(stall.price - balance) 积分，充值后即可购买。")
        } else {
            lines.append("确认后将扣除积分，课程永久进入你的书架，作者获得收益分成。")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: 三态内容

    @ViewBuilder
    private var content: some View {
        if let stalls = vm.stalls {
            if stalls.isEmpty {
                EmptyStateView(
                    title: "集市还没开张",
                    subtitle: "还没有同学把课摆上摊，去造一门课分享到集市",
                    icon: "storefront"
                )
                .padding(.top, 40)
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    ambienceBar
                    sortBar(count: stalls.count)
                    LazyVStack(spacing: 14) {
                        ForEach(Array(vm.sortedStalls.enumerated()), id: \.element.id) { idx, stall in
                            MarketStallCard(
                                stall: stall,
                                collecting: vm.collectingIds.contains(stall.id),
                                collectError: vm.collectErrors[stall.id],
                                needsRecharge: vm.paywallIds.contains(stall.id),
                                onRecharge: { showRecharge = true },
                                // 免费课：直接拿走。付费课：先进确认层（beginPurchase），确认后才扣款。
                                onCollect: { Task { await vm.collect(stall) } },
                                onPurchase: { Task { await vm.beginPurchase(stall) } }
                            )
                            .modifier(FeedStaggerAppear(index: idx, reduceMotion: reduceMotion))
                        }
                    }
                    .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.sort)
                }
            }
        } else if let error = vm.error {
            ErrorRetryView(message: error) { Task { await vm.load() } }
                .padding(.top, 40)
        } else {
            loadingSkeleton
        }
    }

    // MARK: 氛围条（累计被拿走）

    private var ambienceBar: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Studio.infoSoft).frame(width: 32, height: 32)
                Image(systemName: "bag.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.info)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("累计被拿走")
                    .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(1)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text(CourseFormat.learners(vm.totalCollects))
                        .font(.mono(17, .bold)).foregroundStyle(Studio.ink)
                        .contentTransition(.numericText())
                    Text("次").font(.studio(11)).foregroundStyle(Studio.ink3)
                }
            }
            Spacer()
            // 右侧：积分余额徽章（购买货币；成交/充值后随 vm.balance 刷新）。
            // 余额未知（游客/拉取失败）回落中性引导文案。
            if let balance = vm.balance {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 10)).foregroundStyle(Studio.warn)
                    Text("\(balance)")
                        .font(.mono(12, .bold)).foregroundStyle(Studio.ink)
                        .contentTransition(.numericText())
                    Text("积分").font(.studio(10)).foregroundStyle(Studio.ink4)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Studio.surfaceInset)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(Studio.border, lineWidth: 1))
                .animation(reduceMotion ? nil : StudioMotion.pop, value: balance)
                .accessibilityLabel("积分余额 \(balance)")
            } else {
                Text("看中就拿走或购买")
                    .font(.studio(11)).foregroundStyle(Studio.ink3)
            }
        }
        .padding(12)
        .studioCard(padding: 0)
        .frame(maxWidth: .infinity)
    }

    // MARK: 排序切换（最热/最新）

    private func sortBar(count: Int) -> some View {
        HStack {
            Text("共 \(count) 个课摊")
                .font(.studio(12)).foregroundStyle(Studio.ink3)
            Spacer()
            HStack(spacing: 4) {
                ForEach(MarketSort.allCases) { s in
                    let active = vm.sort == s
                    Button {
                        guard vm.sort != s else { return }
                        Haptics.selection()
                        withAnimation(reduceMotion ? nil : StudioMotion.smooth) { vm.sort = s }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: s.icon).font(.system(size: 10, weight: .bold))
                            Text(s.label).font(.studio(12, .semibold))
                        }
                        .foregroundStyle(active ? .white : Studio.ink2)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(active ? Studio.ink : Studio.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(active ? Color.clear : Studio.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .pressable(scale: 0.95, haptic: false)
                }
            }
            .padding(3)
            .background(Studio.surface2)
            .clipShape(Capsule())
        }
    }

    // MARK: 「已放入书架」toast

    @ViewBuilder
    private var toast: some View {
        if showToast, let msg = vm.lastCollected?.message {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Studio.ok)
                Text(msg).font(.studio(13, .semibold)).foregroundStyle(Studio.ink)
                    .lineLimit(1)
                if onGoShelf != nil {
                    Button {
                        Haptics.light()
                        onGoShelf?()
                    } label: {
                        Text("去书架")
                            .font(.studio(12, .bold)).foregroundStyle(Studio.red)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(Studio.surface)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Studio.border2, lineWidth: 1))
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private var loadingSkeleton: some View {
        LazyVStack(spacing: 14) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 12) {
                    SkeletonBar(height: 110).clipShape(RoundedRectangle(cornerRadius: 12))
                    SkeletonBar(height: 16, width: 180)
                    SkeletonBar(height: 12, width: 100)
                    SkeletonBar(height: 40).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .studioCard(padding: 12)
            }
        }
    }
}

// MARK: - 摊位卡

/// 集市摊位卡：渐变封面 + 价签（免费/N积分/已拥有）+ 标题 + 摊主行 + 交易信号 + 三态 CTA。
struct MarketStallCard: View {
    let stall: MarketStall
    var collecting: Bool = false
    var collectError: String? = nil
    /// 余额不足（402）：错误行额外露「去充值」引导。
    var needsRecharge: Bool = false
    var onRecharge: (() -> Void)? = nil
    /// 免费课 CTA：直接拿走。
    let onCollect: () -> Void
    /// 付费课 CTA：进确认层（课名/售价/余额），确认后才扣款。
    let onPurchase: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 来源是否 AI 造课（决定封面来源徽标：AI 造课 / 整理导入）。对齐 web origin==="ai_generated"。
    private var originIsAI: Bool { (stall.origin ?? "") == "ai_generated" }

    /// 成交量口径（对齐 web MarketStallCard）：付费课看成交数 salesCount，免费课看拿走数 collectCount。
    private var volume: Int { stall.paid ? stall.salesCount : stall.collectCount }

    /// 摊主等级徽章（对齐 web sellerBadge：按被拿走数分档）。
    private var sellerBadge: (label: String, tone: StatusBadge.Tone) {
        let n = stall.collectCount
        if n >= 50 { return ("金牌摊主", .red) }
        if n >= 20 { return ("人气摊主", .warn) }
        if n >= 5  { return ("活跃摊主", .info) }
        return ("新摊主", .neutral)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 渐变封面 + 标题叠字 + 来源徽标 + 价签（免费/N积分/已拥有，对齐 web 摊位卡封面区）
            ZStack(alignment: .bottomLeading) {
                CourseCover.gradient(for: stall.coverColor ?? "slate")
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                LinearGradient(colors: [.clear, .black.opacity(0.45)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                // 顶部两角：左=来源徽标（AI造课/整理导入），右=免费拿走价签 / 本人摊位
                VStack {
                    HStack {
                        // 来源徽标（左上）
                        HStack(spacing: 4) {
                            Image(systemName: originIsAI ? "sparkles" : "list.bullet.rectangle.fill")
                                .font(.system(size: 9, weight: .bold))
                            Text(originIsAI ? "AI 造课" : "整理导入").font(.studio(10, .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.black.opacity(0.34))
                        .clipShape(Capsule())
                        Spacer()
                        // 价签（右上）：你的摊位 / 已拥有 / N 积分（付费红）/ 免费（绿）。
                        // 颜色语义对齐 web：免费绿、付费红（价格是交易市场核心信号，红只用在这里与购买 CTA）。
                        if stall.mine {
                            HStack(spacing: 4) {
                                Image(systemName: "storefront.fill").font(.system(size: 9, weight: .bold))
                                Text("你的摊位").font(.studio(10, .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.white.opacity(0.18))
                            .clipShape(Capsule())
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.22), lineWidth: 1))
                        } else if stall.collectedByMe {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 9, weight: .bold))
                                Text(stall.paid ? "已购买" : "已拥有").font(.studio(10, .bold))
                            }
                            .foregroundStyle(Studio.ok)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.white.opacity(0.92))
                            .clipShape(Capsule())
                        } else if stall.paid {
                            HStack(spacing: 3) {
                                Text("\(stall.price)").font(.mono(11, .bold))
                                Text("积分").font(.studio(10, .bold))
                            }
                            .foregroundStyle(Studio.redInk)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.white.opacity(0.92))
                            .clipShape(Capsule())
                        } else {
                            HStack(spacing: 4) {
                                Image(systemName: "gift.fill").font(.system(size: 9, weight: .bold))
                                Text("免费").font(.studio(10, .bold))
                            }
                            .foregroundStyle(Studio.ok)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.white.opacity(0.92))
                            .clipShape(Capsule())
                        }
                    }
                    Spacer()
                    // 成交热度气泡（左下，交易气息）：付费课「入手」/ 免费课「拿走」。
                    if volume > 0 {
                        HStack {
                            HStack(spacing: 4) {
                                Image(systemName: "bag.fill").font(.system(size: 9, weight: .bold))
                                Text("\(CourseFormat.learners(volume)) 人\(stall.paid ? "入手" : "拿走")")
                                    .font(.mono(10, .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.black.opacity(0.42))
                            .clipShape(Capsule())
                            Spacer()
                        }
                    }
                }
                .padding(10)
                Text(stall.title)
                    .font(.studio(16, .bold)).foregroundStyle(.white)
                    .lineLimit(2).multilineTextAlignment(.leading)
                    .padding(12)
                    // 标题避让底部热度气泡：热度存在时下移标题起点。
                    .padding(.bottom, volume > 0 ? 20 : 0)
            }

            // 摊主行：头像 + 昵称 + 摊主等级徽章
            HStack(spacing: 8) {
                Circle()
                    .fill(Studio.surface2)
                    .frame(width: 26, height: 26)
                    .overlay(
                        Text(ProfileDerive.avatarInitial(from: stall.seller.nickname))
                            .font(.studio(12, .bold)).foregroundStyle(Studio.ink2)
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text(stall.seller.nickname)
                        .font(.studio(13, .semibold)).foregroundStyle(Studio.ink).lineLimit(1)
                    if let subtitle = stall.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.studio(11)).foregroundStyle(Studio.ink3).lineLimit(1)
                    }
                }
                Spacer()
                StatusBadge(text: sellerBadge.label, tone: sellerBadge.tone)
            }

            // 交易信号行：成交/拿走数（按付费口径切换）+ 在学数
            HStack(spacing: 14) {
                metric(
                    icon: "bag.fill",
                    value: CourseFormat.learners(volume),
                    label: stall.paid ? "成交" : "拿走",
                    tone: Studio.info
                )
                metric(icon: "person.2.fill", value: CourseFormat.learners(stall.learnersCount), label: "在学", tone: Studio.ink3)
                Spacer()
            }

            // CTA 三态：本人摊位 → 不可拿；已拥有 → 已在书架；
            // 付费 → 「N 积分 · 购买」（进确认层，确认后才扣款）；免费 → 「免费拿走」直接拿。
            if stall.mine {
                collectDisabled(text: "你的摊位", icon: "person.crop.circle.fill", tone: .neutral)
            } else if stall.collectedByMe {
                collectDisabled(text: "已在书架", icon: "checkmark.seal.fill", tone: .ok)
            } else if stall.paid {
                StudioButton(
                    title: "\(stall.price) 积分 · 购买",
                    kind: .red,
                    icon: "bag.fill",
                    loading: collecting
                ) {
                    onPurchase()
                }
            } else {
                StudioButton(
                    title: "免费拿走",
                    kind: .red,
                    icon: "bag.badge.plus",
                    loading: collecting
                ) {
                    onCollect()
                }
            }

            if let collectError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 11)).foregroundStyle(Studio.warn)
                    Text(collectError).font(.studio(12)).foregroundStyle(Studio.warn)
                    // 402 余额不足：后端文案 + 充值引导（不静默失败）。
                    if needsRecharge, let onRecharge {
                        Button {
                            Haptics.light()
                            onRecharge()
                        } label: {
                            Text("去充值")
                                .font(.studio(12, .bold)).foregroundStyle(Studio.red)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .studioCard(padding: 12)
        .pressable()
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: stall.collectedByMe)
    }

    private func metric(icon: String, value: String, label: String, tone: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(tone)
            Text(value).font(.mono(12, .bold)).foregroundStyle(Studio.ink)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
    }

    private func collectDisabled(text: String, icon: String, tone: StatusBadge.Tone) -> some View {
        HStack {
            StatusBadge(text: text, icon: icon, tone: tone)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10).padding(.horizontal, 12)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .transition(.opacity)
    }
}
