import SwiftUI
import Observation
import StoreKit

// 三档积分包（product id 对齐 App Store Connect 配置）。
private struct CreditPack: Identifiable {
    let id: String            // StoreKit product identifier
    let credits: Int          // 到账积分
    let priceHint: String     // 兜底展示文案（真实价格以 StoreKit localizedPrice 为准）
    let subtitle: String

    static let all: [CreditPack] = [
        .init(id: "credits_60", credits: 60, priceHint: "¥6", subtitle: "轻度尝鲜"),
        .init(id: "credits_350", credits: 350, priceHint: "¥30", subtitle: "最受欢迎"),
        .init(id: "credits_1300", credits: 1300, priceHint: "¥98", subtitle: "超值囤货"),
    ]
    static let productIDs = all.map(\.id)

    /// 推荐档（纯展示派生）：中间的 350 档最受欢迎，高亮突出。
    var recommended: Bool { id == "credits_350" }

    /// 每档图标（视觉分级）。
    var icon: String {
        switch id {
        case "credits_60": return "sparkle"
        case "credits_350": return "sparkles"
        default: return "crown.fill"
        }
    }
}

// POST /api/iap/verify 请求/响应。
private struct IAPVerifyBody: Encodable {
    let productId: String
    let transactionId: String
}
private struct IAPVerifyResult: Decodable {
    let balance: Int          // 发放后的新余额
}

@Observable @MainActor
final class RechargeViewModel {
    // 加载到的 StoreKit 产品，按 productID 索引。
    var products: [String: Product] = [:]
    var storeAvailable = true      // false → 显示占位（未配置/加载失败）
    var loadingProducts = true
    var purchasingID: String?      // 正在购买的 productID
    var error: String?
    var successCredits: Int?       // 充值成功到账积分（用于提示）

    func loadProducts() async {
        loadingProducts = true; error = nil
        defer { loadingProducts = false }
        do {
            let fetched = try await Product.products(for: CreditPack.productIDs)
            guard !fetched.isEmpty else {
                storeAvailable = false
                return
            }
            products = Dictionary(uniqueKeysWithValues: fetched.map { ($0.id, $0) })
            storeAvailable = true
        } catch {
            // 沙盒未配置 / 无网络 → 优雅占位，不崩溃。
            storeAvailable = false
        }
    }

    /// 展示价格：优先 StoreKit 本地化价，兜底用 priceHint。
    fileprivate func displayPrice(for pack: CreditPack) -> String {
        products[pack.id]?.displayPrice ?? pack.priceHint
    }

    /// 购买 → 校验签名 → 后端发积分 → 完成交易。返回是否成功。
    fileprivate func purchase(_ pack: CreditPack, onSuccess: @escaping () -> Void) async {
        guard let product = products[pack.id] else { return }
        purchasingID = pack.id; error = nil; successCredits = nil
        defer { purchasingID = nil }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    // 后端校验并发放积分。
                    do {
                        let res = try await API.shared.post(
                            "/api/iap/verify",
                            body: IAPVerifyBody(
                                productId: pack.id,
                                transactionId: String(transaction.id)
                            ),
                            as: IAPVerifyResult.self
                        )
                        await transaction.finish()   // 后端确认发放后再 finish
                        successCredits = pack.credits
                        _ = res
                        onSuccess()
                    } catch {
                        // 后端发放失败：不 finish，交易将由系统重试；提示用户。
                        self.error = (error as? APIError)?.errorDescription ?? "积分发放失败，请稍后在“充值”重试"
                    }
                case .unverified:
                    self.error = "交易校验未通过，请稍后重试"
                }
            case .userCancelled:
                break   // 用户取消，不报错
            case .pending:
                self.error = "购买待确认（如家长批准），完成后积分将自动到账"
            @unknown default:
                self.error = "购买未完成"
            }
        } catch {
            self.error = "购买失败，请稍后重试"
        }
    }
}

/// 充值页：三档积分包。iOS 走 StoreKit2 IAP。
struct RechargeView: View {
    var onRecharged: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var vm = RechargeViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if vm.loadingProducts {
                        loadingSkeleton
                    } else if !vm.storeAvailable {
                        placeholder
                    } else {
                        packs
                    }
                }
                .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("充值积分")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }.foregroundStyle(Studio.ink2)
                }
            }
            .task { if vm.products.isEmpty { await vm.loadProducts() } }
            .onChange(of: vm.successCredits) { _, new in
                if new != nil { Haptics.success() }
            }
            .onChange(of: vm.error) { _, new in
                if new != nil { Haptics.error() }
            }
            .alert("充值成功", isPresented: successBinding) {
                Button("好") { dismiss() }
            } message: {
                Text("已到账 \(vm.successCredits ?? 0) 积分")
            }
        }
    }

    // 成功提示的绑定（有值即弹）。
    private var successBinding: Binding<Bool> {
        Binding(
            get: { vm.successCredits != nil },
            set: { if !$0 { vm.successCredits = nil } }
        )
    }

    private var packs: some View {
        VStack(spacing: 14) {
            if let err = vm.error {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill").font(.system(size: 13))
                    Text(err).font(.studio(13))
                }
                .foregroundStyle(Studio.redInk)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Studio.redSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
            }
            ForEach(CreditPack.all) { pack in
                packRow(pack)
            }
            HStack(spacing: 5) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 11)).foregroundStyle(Studio.ok)
                Text("购买通过 App Store 完成，积分即时到账。")
                    .font(.studio(11)).foregroundStyle(Studio.ink3)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 4)
        }
    }

    private func packRow(_ pack: CreditPack) -> some View {
        let isBusy = vm.purchasingID == pack.id
        let disabled = vm.purchasingID != nil
        return HStack(spacing: 14) {
            // 图标磁贴：推荐档用 videoGradient 深色高亮，其余中性。
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(pack.recommended ? AnyShapeStyle(Studio.videoGradient) : AnyShapeStyle(Studio.surface2))
                    .frame(width: 46, height: 46)
                Image(systemName: pack.icon)
                    .font(.system(size: 20))
                    .foregroundStyle(pack.recommended ? .white : Studio.ink3)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("\(pack.credits)").font(.mono(24, .bold)).foregroundStyle(Studio.ink)
                    Text("积分").font(.studio(13)).foregroundStyle(Studio.ink3)
                    if pack.recommended {
                        StatusBadge(text: pack.subtitle, icon: "flame.fill", tone: .red)
                    }
                }
                if !pack.recommended {
                    Text(pack.subtitle).font(.studio(12)).foregroundStyle(Studio.ink3)
                }
            }
            Spacer()
            Button {
                Haptics.selection()
                Task {
                    await vm.purchase(pack) { onRecharged?() }
                }
            } label: {
                HStack(spacing: 6) {
                    if isBusy { ProgressView().controlSize(.small).tint(.white) }
                    Text(vm.displayPrice(for: pack)).font(.mono(15, .bold))
                }
                .frame(minWidth: 76)
                .padding(.vertical, 10).padding(.horizontal, 14)
                .foregroundStyle(.white)
                .background(Studio.red)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: Studio.red.opacity(0.28), radius: 10, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .opacity(disabled && !isBusy ? 0.5 : 1)
        }
        .studioCard(elevation: pack.recommended ? 2 : 1)
        .overlay(
            pack.recommended
                ? RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                    .strokeBorder(Studio.red.opacity(0.45), lineWidth: 1.5)
                : nil
        )
        .pressable()
    }

    private var placeholder: some View {
        EmptyStateView(
            title: "充值功能需在正式环境配置",
            subtitle: "App 内购买产品尚未就绪，请在正式环境或配置沙盒账号后重试。",
            actionTitle: "重新加载"
        ) {
            Task { await vm.loadProducts() }
        }
    }

    private var loadingSkeleton: some View {
        VStack(spacing: 16) {
            ForEach(0..<3, id: \.self) { _ in
                SkeletonBar(height: 72).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card))
            }
        }
    }
}
