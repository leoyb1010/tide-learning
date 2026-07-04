import SwiftUI
import Observation
import Charts

// GET /api/credits/me 响应（字段对齐后端 camelCase）。
struct CreditsMe: Decodable {
    let balance: Int
    let recentLedger: [LedgerEntry]

    struct LedgerEntry: Decodable, Identifiable {
        // 后端未必回 id，用 createdAt+delta 合成稳定标识。
        var id: String { "\(createdAt.timeIntervalSince1970)-\(delta)-\(balanceAfter)" }
        let delta: Int              // 正=获得，负=消耗
        let type: String            // 如 "llm_spend" / "recharge" / "signup_bonus"
        let reason: String?
        let createdAt: Date
        let balanceAfter: Int
    }
}

@Observable @MainActor
final class CreditCardViewModel {
    var data: CreditsMe?
    var error: String?
    var loading = false

    /// 本月 llm_spend 消耗汇总（取绝对值）。
    var monthlySpend: Int {
        guard let ledger = data?.recentLedger else { return 0 }
        let cal = Calendar.current
        let now = Date()
        return ledger.reduce(0) { acc, e in
            guard e.type == "llm_spend",
                  cal.isDate(e.createdAt, equalTo: now, toGranularity: .month) else { return acc }
            return acc + abs(e.delta)
        }
    }

    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do { data = try await API.shared.get("/api/credits/me", as: CreditsMe.self) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "加载失败" }
    }

    /// 余额走势点（按时间正序），用于 Swift Charts 面积曲线。纯展示派生，无网络/DTO 改动。
    struct BalancePoint: Identifiable {
        let id: String
        let date: Date
        let balance: Int
    }
    var balanceTrend: [BalancePoint] {
        guard let ledger = data?.recentLedger, !ledger.isEmpty else { return [] }
        return ledger
            .sorted { $0.createdAt < $1.createdAt }
            .map { BalancePoint(id: $0.id, date: $0.createdAt, balance: $0.balanceAfter) }
    }
}

/// 积分卡组件：余额大数字 + 本月消耗 + 明细列表 + 充值按钮。供 Profile 内嵌使用。
struct CreditCardView: View {
    @State private var vm = CreditCardViewModel()
    @State private var showRecharge = false
    @State private var balancePulse = false
    @State private var spendPulse = false
    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let d = vm.data {
                content(d)
            } else if let err = vm.error {
                ErrorRetryView(message: err) { Task { await vm.load() } }
            } else {
                loadingSkeleton
            }
        }
        .task { if vm.data == nil { await vm.load() } }
        .sheet(isPresented: $showRecharge) {
            RechargeView { Task { await vm.load() } }
        }
    }

    private func content(_ d: CreditsMe) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // 余额 + 本月消耗
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("积分余额").font(.studio(12)).foregroundStyle(Studio.ink3)
                    Text("\(d.balance)")
                        .font(.mono(40, .bold))
                        .foregroundStyle(Studio.red)
                        .contentTransition(.numericText())
                        .scaleEffect(balancePulse && !reduceMotion ? 1.06 : 1)
                        .animation(reduceMotion ? nil : StudioMotion.pop, value: balancePulse)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text("本月消耗").font(.studio(12)).foregroundStyle(Studio.ink3)
                    HStack(spacing: 4) {
                        Text("\(vm.monthlySpend)").font(.mono(22, .semibold)).foregroundStyle(Studio.ink)
                            .contentTransition(.numericText())
                        Text("分").font(.studio(12)).foregroundStyle(Studio.ink4)
                    }
                    // 与余额脉冲收敛：消耗变动时同套 pop，避免只有余额动、权重打架。
                    .scaleEffect(spendPulse && !reduceMotion ? 1.06 : 1)
                    .animation(reduceMotion ? nil : StudioMotion.pop, value: spendPulse)
                }
            }

            // 消耗趋势曲线（Swift Charts）。
            if vm.balanceTrend.count >= 2 {
                spendTrendChart
            }

            StudioButton(title: "充值", kind: .red, icon: "plus.circle.fill") {
                showRecharge = true
            }

            Divider().overlay(Studio.border)

            // 明细
            HStack {
                Text("积分明细").font(.studio(14, .bold)).foregroundStyle(Studio.ink)
                Spacer()
                if !d.recentLedger.isEmpty {
                    StatusBadge(text: "\(d.recentLedger.count) 条", tone: .neutral)
                }
            }
            if d.recentLedger.isEmpty {
                EmptyStateView(title: "暂无积分记录",
                               subtitle: "充值或使用 AI 后会在这里生成明细",
                               icon: "list.bullet.rectangle")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(d.recentLedger.enumerated()), id: \.element.id) { idx, e in
                        ledgerRow(e)
                            .opacity(appeared || reduceMotion ? 1 : 0)
                            .offset(y: appeared || reduceMotion ? 0 : 14)
                            .animation(
                                reduceMotion ? nil : StudioMotion.smooth.delay(Double(min(idx, 8)) * 0.05),
                                value: appeared
                            )
                        if idx < d.recentLedger.count - 1 {
                            Divider().overlay(Studio.border).padding(.leading, 2)
                        }
                    }
                }
            }
        }
        .studioCard()
        .onAppear {
            if reduceMotion { appeared = true }
            else { DispatchQueue.main.async { appeared = true } }
        }
        .onChange(of: vm.data?.balance) { old, new in
            // 仅在余额真实变动（如充值到账）时脉冲反馈，跳过首次加载 nil→值。
            guard let old, let new, old != new, !reduceMotion else { return }
            balancePulse = true
            Haptics.rigid()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { balancePulse = false }
        }
        .onChange(of: vm.monthlySpend) { old, new in
            // 本月消耗真实变动时同步脉冲，与余额权重收敛。
            guard old != new, !reduceMotion else { return }
            spendPulse = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { spendPulse = false }
        }
    }

    // MARK: 消耗趋势曲线

    private var spendTrendChart: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("余额走势").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                Spacer()
                Text("近 \(vm.balanceTrend.count) 笔").font(.mono(10)).foregroundStyle(Studio.ink4)
            }
            Chart(vm.balanceTrend) { p in
                AreaMark(
                    x: .value("时间", p.date),
                    y: .value("余额", p.balance)
                )
                .foregroundStyle(
                    LinearGradient(colors: [Studio.red.opacity(0.22), Studio.red.opacity(0.02)],
                                   startPoint: .top, endPoint: .bottom)
                )
                .interpolationMethod(.monotone)

                LineMark(
                    x: .value("时间", p.date),
                    y: .value("余额", p.balance)
                )
                .foregroundStyle(Studio.red)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.monotone)
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(Studio.border)
                    AxisValueLabel().font(.mono(9)).foregroundStyle(Studio.ink4)
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                    AxisValueLabel(format: .dateTime.month().day()).font(.mono(9)).foregroundStyle(Studio.ink4)
                }
            }
            .frame(height: 96)
        }
        .padding(12)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func ledgerRow(_ e: CreditsMe.LedgerEntry) -> some View {
        let gain = e.delta >= 0
        return HStack(spacing: 12) {
            // 收支方向图标：获得=绿上箭头 / 消耗=中性下箭头。
            ZStack {
                Circle().fill(gain ? Studio.okSoft : Studio.surface2).frame(width: 30, height: 30)
                Image(systemName: gain ? "arrow.down.left" : "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(gain ? Studio.ok : Studio.ink3)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(label(for: e)).font(.studio(14, .medium)).foregroundStyle(Studio.ink).lineLimit(1)
                Text(relativeTime(e.createdAt)).font(.mono(11)).foregroundStyle(Studio.ink3)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(deltaText(e.delta))
                    .font(.mono(14, .semibold))
                    .foregroundStyle(gain ? Studio.ok : Studio.ink2)
                Text("余 \(e.balanceAfter)").font(.mono(11)).foregroundStyle(Studio.ink4)
            }
        }
        .padding(.vertical, 10)
    }

    private func deltaText(_ delta: Int) -> String {
        delta >= 0 ? "+\(delta)" : "\(delta)"
    }

    private func label(for e: CreditsMe.LedgerEntry) -> String {
        if let reason = e.reason, !reason.isEmpty { return reason }
        switch e.type {
        case "llm_spend": return "AI 消耗"
        case "recharge": return "充值到账"
        case "signup_bonus": return "注册赠送"
        case "refund": return "退款返还"
        default: return e.type
        }
    }

    private func relativeTime(_ date: Date) -> String {
        let fmt = RelativeDateTimeFormatter()
        fmt.locale = Locale(identifier: "zh_CN")
        fmt.unitsStyle = .short
        return fmt.localizedString(for: date, relativeTo: Date())
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    SkeletonBar(height: 12, width: 60)
                    SkeletonBar(height: 40, width: 120)
                }
                Spacer()
                SkeletonBar(height: 22, width: 60)
            }
            SkeletonBar(height: 44).clipShape(RoundedRectangle(cornerRadius: 12))
            ForEach(0..<3, id: \.self) { _ in SkeletonBar(height: 40) }
        }
        .studioCard()
    }
}
