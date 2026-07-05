// Mac 复习：抽卡 → 翻牌（点击 / 空格）→ 评分（记得 → / 忘了 ←）→ 结算。
//
// iOS 复习 VM/DTO 在 Features/Review（整目录从 Mac target 排除），故此处建等价
// @Observable VM + 本地 DTO，打同一 /api/ai/review-card，走同一 APIEnvelope。
// 字段严格对齐后端真实响应（已 curl 核对）：
//   GET /api/ai/review-card(?practice=1) → {cards[{id,front,back,courseTitle?}],
//                                            total,dueToday,streakDays,practice}
//   PATCH /api/ai/review-card {cardId,remembered} → {ok?,nextDueAt?}
//
// 桌面键盘：空格翻面、← 忘了、→ 记得。
#if os(macOS)
import SwiftUI
import Observation

/// 复习卡（对齐后端真实响应）。
struct MacReviewCard: Decodable, Identifiable {
    let id: String
    let front: String
    let back: String
    let courseTitle: String?
}

/// 复习卡组响应。
struct MacReviewDeck: Decodable {
    let cards: [MacReviewCard]
    let total: Int
    let dueToday: Int
    let streakDays: Int
    let practice: Bool
}

private struct GradeBody: Encodable { let cardId: String; let remembered: Bool }
private struct GradeResult: Decodable { let ok: Bool?; let nextDueAt: String? }

@Observable @MainActor
final class MacReviewViewModel {
    var deck: MacReviewDeck?
    var error: String?
    var loading = false

    /// 当前抽到的卡下标。
    var index = 0
    /// 当前卡是否已翻面（显示答案）。
    var flipped = false
    /// 本轮成绩：记得 / 忘了计数。
    var remembered = 0
    var forgot = 0
    /// 是否练习模式（无到期卡时降级练习）。
    var practice = false
    /// 评分提交中，禁重复。
    var grading = false

    var cards: [MacReviewCard] { deck?.cards ?? [] }
    var current: MacReviewCard? { cards.indices.contains(index) ? cards[index] : nil }
    var finished: Bool { !cards.isEmpty && index >= cards.count }
    var graded: Int { remembered + forgot }
    var accuracy: Int { graded == 0 ? 0 : Int(Double(remembered) / Double(graded) * 100) }

    func load(practice requestPractice: Bool = false) async {
        loading = true; error = nil
        defer { loading = false }
        let path = requestPractice ? "/api/ai/review-card?practice=1" : "/api/ai/review-card"
        do {
            let d = try await API.shared.get(path, as: MacReviewDeck.self)
            // 无到期卡且未指定练习：自动降级练习模式再拉一次。
            if d.cards.isEmpty && !requestPractice && !d.practice {
                let p = try await API.shared.get("/api/ai/review-card?practice=1", as: MacReviewDeck.self)
                deck = p; practice = true
            } else {
                deck = d; practice = d.practice || requestPractice
            }
            resetProgress()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "加载失败"
        }
    }

    func resetProgress() {
        index = 0; flipped = false; remembered = 0; forgot = 0
    }

    /// 翻面（点击 / 空格）。
    func flip() {
        guard current != nil, !finished else { return }
        flipped.toggle()
        Haptics.selection()
    }

    /// 评分（记得 → true / 忘了 ← false）。练习模式不写回服务端（不推进 SRS）。
    func grade(remembered rememberedIt: Bool) {
        guard let card = current, flipped, !grading else { return }
        grading = true
        if rememberedIt { remembered += 1; Haptics.success() }
        else { forgot += 1; Haptics.warning() }
        let advance = { [weak self] in
            guard let self else { return }
            self.index += 1
            self.flipped = false
            self.grading = false
        }
        if practice {
            // 练习模式：仅本地推进，不 PATCH。
            advance()
        } else {
            Task {
                _ = try? await API.shared.patch("/api/ai/review-card",
                                                body: GradeBody(cardId: card.id, remembered: rememberedIt),
                                                as: GradeResult.self)
                await MainActor.run { advance() }
            }
        }
    }

    /// 再来一轮（结算后）。
    func restart() async {
        await load(practice: practice)
    }
}

struct MacReviewView: View {
    @State private var vm = MacReviewViewModel()
    /// 键盘焦点（承载 ← / → / 空格 快捷键）。
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            Group {
                if let _ = vm.deck {
                    content
                } else if let err = vm.error {
                    ErrorRetryView(message: err) { Task { await vm.load() } }
                        .padding(40)
                } else {
                    loadingSkeleton
                }
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(28)
        }
        .background(Studio.bg)
        .task { if vm.deck == nil { await vm.load() } }
        // 桌面键盘：空格翻面、← 忘了、→ 记得。
        .focusable()
        .focused($focused)
        .onAppear { focused = true }
        .onKeyPress(.space) { vm.flip(); return .handled }
        .onKeyPress(.leftArrow) { if vm.flipped { vm.grade(remembered: false) }; return .handled }
        .onKeyPress(.rightArrow) { if vm.flipped { vm.grade(remembered: true) }; return .handled }
    }

    // MARK: 主内容

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            if vm.cards.isEmpty {
                emptyDeck
            } else if vm.finished {
                summary
            } else {
                progressBar
                cardStage
                gradeControls
                keyboardHint
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "rectangle.stack.fill")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Studio.red)
                    Text(vm.practice ? "PRACTICE" : "REVIEW")
                        .font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
                }
                Text(vm.practice ? "自由练习" : "今日复习")
                    .font(.studio(28, .bold)).foregroundStyle(Studio.ink)
            }
            Spacer()
            if let d = vm.deck {
                HStack(spacing: 10) {
                    miniStat("\(d.dueToday)", "待复习", tone: d.dueToday > 0 ? .warn : .neutral)
                    miniStat("\(d.streakDays)", "连击天", tone: d.streakDays > 0 ? .ok : .neutral)
                }
            }
        }
    }

    private func miniStat(_ value: String, _ label: String, tone: StatusBadge.Tone) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.mono(20, .bold))
                .foregroundStyle(tone == .warn ? Studio.warn : tone == .ok ? Studio.ok : Studio.ink)
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .studioCard(padding: 0)
        .frame(width: 80)
    }

    private var progressBar: some View {
        VStack(spacing: 6) {
            HStack {
                Text("第 \(min(vm.index + 1, vm.cards.count)) / \(vm.cards.count) 张")
                    .font(.mono(12, .semibold)).foregroundStyle(Studio.ink3)
                Spacer()
                if vm.graded > 0 {
                    Text("正确率 \(vm.accuracy)%")
                        .font(.mono(12, .semibold)).foregroundStyle(Studio.ok)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Studio.surfaceInset).frame(height: 6)
                    Capsule().fill(Studio.red)
                        .frame(width: max(0, geo.size.width * CGFloat(vm.index) / CGFloat(max(vm.cards.count, 1))),
                               height: 6)
                }
            }
            .frame(height: 6)
        }
    }

    // MARK: 卡片舞台（点击翻面）

    @ViewBuilder
    private var cardStage: some View {
        if let card = vm.current {
            Button {
                vm.flip()
            } label: {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        StatusBadge(text: vm.flipped ? "答案" : "问题",
                                    icon: vm.flipped ? "lightbulb.fill" : "questionmark.circle.fill",
                                    tone: vm.flipped ? .info : .neutral)
                        Spacer()
                        if let ct = card.courseTitle, !ct.isEmpty {
                            Text(ct).font(.studio(12)).foregroundStyle(Studio.ink4).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    Text(vm.flipped ? card.back : card.front)
                        .font(.studio(22, .semibold))
                        .foregroundStyle(vm.flipped ? Studio.ink : Studio.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .id(vm.flipped)   // 内容切换过渡
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    Spacer(minLength: 0)
                    HStack {
                        Spacer()
                        Text(vm.flipped ? "已翻面 · 请评分" : "点击或按空格翻面")
                            .font(.studio(12)).foregroundStyle(Studio.ink4)
                    }
                }
                .padding(24)
                .frame(minHeight: 280)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(vm.flipped ? Studio.surface : Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                        .strokeBorder(vm.flipped ? Studio.info.opacity(0.3) : Studio.border, lineWidth: 1.5)
                )
                .shadow(color: Color(hex: "#232935").opacity(0.08), radius: 12, y: 4)
            }
            .buttonStyle(.plain)
            .animation(StudioMotion.smooth, value: vm.flipped)
        }
    }

    // MARK: 评分控件（记得 / 忘了）

    private var gradeControls: some View {
        HStack(spacing: 14) {
            gradeButton(title: "忘了", icon: "arrow.left", tone: .warn, remembered: false)
            gradeButton(title: "记得", icon: "arrow.right", tone: .ok, remembered: true)
        }
        .opacity(vm.flipped ? 1 : 0.45)
        .disabled(!vm.flipped || vm.grading)
        .animation(StudioMotion.quick, value: vm.flipped)
    }

    private func gradeButton(title: String, icon: String, tone: StatusBadge.Tone, remembered: Bool) -> some View {
        let fg: Color = tone == .ok ? Studio.ok : Studio.warn
        let bg: Color = tone == .ok ? Studio.okSoft : Studio.warnSoft
        return Button {
            vm.grade(remembered: remembered)
        } label: {
            HStack(spacing: 8) {
                if !remembered { Image(systemName: icon).font(.system(size: 14, weight: .bold)) }
                Text(title).font(.studio(16, .semibold))
                if remembered { Image(systemName: icon).font(.system(size: 14, weight: .bold)) }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(fg)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(fg.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var keyboardHint: some View {
        HStack(spacing: 16) {
            keyCap("空格", "翻面")
            keyCap("←", "忘了")
            keyCap("→", "记得")
        }
        .frame(maxWidth: .infinity)
    }

    private func keyCap(_ key: String, _ label: String) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .font(.mono(11, .bold)).foregroundStyle(Studio.ink2)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Studio.border, lineWidth: 1))
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink4)
        }
    }

    // MARK: 结算

    private var summary: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().fill(Studio.okSoft).frame(width: 80, height: 80)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 38)).foregroundStyle(Studio.ok)
            }
            Text("这轮复习完成！")
                .font(.studio(22, .bold)).foregroundStyle(Studio.ink)
            HStack(spacing: 14) {
                summaryStat("\(vm.remembered)", "记得", Studio.ok)
                summaryStat("\(vm.forgot)", "忘了", Studio.warn)
                summaryStat("\(vm.accuracy)%", "正确率", Studio.info)
            }
            HStack(spacing: 12) {
                StudioButton(title: "再来一轮", icon: "arrow.clockwise") {
                    Task { await vm.restart() }
                }
                .frame(maxWidth: 200)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .studioCard(padding: 24, elevation: 2)
    }

    private func summaryStat(_ value: String, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.mono(28, .bold)).foregroundStyle(color)
            Text(label).font(.studio(12)).foregroundStyle(Studio.ink3)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var emptyDeck: some View {
        EmptyStateView(
            title: vm.practice ? "暂时没有可练习的卡" : "今天没有待复习的卡",
            subtitle: vm.practice ? "去学一门课，积累知识点后再来练习。" : "已全部复习完，休息一下吧。",
            icon: "checkmark.circle",
            actionTitle: "刷新",
            action: { Task { await vm.load() } }
        )
        .studioCard(padding: 8)
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 20) {
            SkeletonBar(height: 28, width: 200)
            SkeletonBar(height: 6)
            SkeletonBar(height: 280)
            HStack(spacing: 14) { SkeletonBar(height: 52); SkeletonBar(height: 52) }
        }
    }
}
#endif
