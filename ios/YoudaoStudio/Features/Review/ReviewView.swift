import SwiftUI
import Observation

// MARK: - DTO（对齐后端 GET /api/ai/review-card 返回，camelCase）

/// GET /api/ai/review-card → { cards, total, dueToday, streakDays, practice }
struct ReviewDeck: Decodable {
    let cards: [ReviewCard]
    let total: Int
    let dueToday: Int
    let streakDays: Int
    let practice: Bool
}

struct ReviewCard: Decodable, Identifiable, Equatable {
    let id: String
    let front: String            // 问题（Markdown）
    let back: String             // 答案（Markdown）
    let courseTitle: String?     // 可选来源课程
}

/// PATCH /api/ai/review-card { cardId, remembered } 的响应。
/// 后端可能回空对象或简单确认，字段全部可选以容错。
struct ReviewGradeResult: Decodable {
    let ok: Bool?
    let nextDueAt: String?
}

private struct ReviewGradeBody: Encodable {
    let cardId: String
    let remembered: Bool
}

// MARK: - ViewModel

@Observable @MainActor
final class ReviewViewModel {
    // 三态
    var deck: ReviewDeck?
    var error: String?
    var loading = false
    var needsPaywall = false

    // 练习会话阶段
    enum Phase: Equatable { case task, practicing, summary }
    var phase: Phase = .task

    // 会话内进度
    var queue: [ReviewCard] = []          // 本轮待练卡（按序消费）
    var currentIndex = 0                  // 已完成张数指针
    var flipped = false                   // 当前卡是否已翻面
    var flyingOut: FlyDirection = .none   // 飞出方向（用于动画）

    // 统计
    var sessionTotal = 0                  // 本轮总张数
    var rememberedCount = 0               // 记得张数
    var combo = 0                         // 当前连击
    var maxCombo = 0                      // 最高连击

    enum FlyDirection: Equatable { case none, left, right }

    var current: ReviewCard? {
        guard currentIndex < queue.count else { return nil }
        return queue[currentIndex]
    }

    var progressText: String {
        "\(min(currentIndex + 1, sessionTotal)) / \(sessionTotal)"
    }

    var accuracy: Int {
        guard sessionTotal > 0 else { return 0 }
        return Int((Double(rememberedCount) / Double(sessionTotal) * 100).rounded())
    }

    // MARK: 加载

    /// practice=true 时加练 10 张（GET /api/ai/review-card?practice=1）
    func load(practice: Bool = false) async {
        loading = true; error = nil; needsPaywall = false
        defer { loading = false }
        let path = practice ? "/api/ai/review-card?practice=1" : "/api/ai/review-card"
        do {
            let d = try await API.shared.get(path, as: ReviewDeck.self)
            deck = d
            phase = .task
            resetSession()
        } catch let e as APIError {
            if e.needsPaywall { needsPaywall = true }
            error = e.errorDescription ?? "加载失败"
        } catch {
            self.error = "加载失败"
        }
    }

    private func resetSession() {
        queue = []
        currentIndex = 0
        flipped = false
        flyingOut = .none
        sessionTotal = 0
        rememberedCount = 0
        combo = 0
        maxCombo = 0
    }

    // MARK: 会话控制

    func start() {
        guard let d = deck, !d.cards.isEmpty else { return }
        queue = d.cards
        currentIndex = 0
        flipped = false
        flyingOut = .none
        sessionTotal = d.cards.count
        rememberedCount = 0
        combo = 0
        maxCombo = 0
        phase = .practicing
    }

    func flip() {
        flipped.toggle()
    }

    /// 评分：记得→combo++；忘了→combo 归零。乐观推进，后端失败静默（不打断练习）。
    /// 同步更新本地统计（@MainActor，顺序确定）；网络上报 fire-and-forget。
    func grade(remembered: Bool) {
        guard let card = current else { return }
        // 先更新本地统计与连击（同步，保证调用方后续 advance 时状态已就绪）
        if remembered {
            rememberedCount += 1
            combo += 1
            maxCombo = max(maxCombo, combo)
            flyingOut = .right
        } else {
            combo = 0
            flyingOut = .left
        }
        // 上报（失败不阻断本轮）
        Task { [card, remembered] in
            _ = try? await API.shared.patch(
                "/api/ai/review-card",
                body: ReviewGradeBody(cardId: card.id, remembered: remembered),
                as: ReviewGradeResult.self
            )
        }
    }

    /// 飞出动画结束后调用：推进到下一张或结算。
    func advance() {
        flyingOut = .none
        flipped = false
        currentIndex += 1
        if currentIndex >= queue.count {
            phase = .summary
        }
    }

    /// 再来一轮：重新拉取（保持 practice 语义交给调用方，这里默认到期卡）。
    func restart() async {
        await load()
    }
}

// MARK: - View

struct ReviewView: View {
    @State private var vm = ReviewViewModel()
    @State private var comboPulse = false
    @State private var showConfetti = false
    @State private var scorePop = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            Group {
                if let deck = vm.deck {
                    content(deck)
                } else if vm.error != nil {
                    ErrorRetryView(message: vm.error!) { Task { await vm.load() } }
                } else {
                    loadingSkeleton
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Studio.bg)
            .navigationTitle("复习室")
            .task { if vm.deck == nil { await vm.load() } }
        }
    }

    // MARK: 阶段路由

    @ViewBuilder
    private func content(_ deck: ReviewDeck) -> some View {
        Group {
            switch vm.phase {
            case .task:
                if deck.dueToday == 0 && !deck.practice {
                    emptyToday
                } else {
                    taskCard(deck)
                }
            case .practicing:
                practicing
            case .summary:
                summary
            }
        }
        .transition(reduceMotion ? .opacity
                    : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                  removal: .opacity))
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.phase)
    }

    // MARK: 任务卡（N 张到期 · 预计 N 分钟 · 连续 N 天）

    private func taskCard(_ deck: ReviewDeck) -> some View {
        let count = deck.practice ? deck.cards.count : deck.dueToday
        let minutes = max(1, Int((Double(count) * 0.5).rounded(.up)))
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(deck.practice ? "加练" : "今日复习").font(.mono(11, .bold))
                            .foregroundStyle(Studio.red).tracking(2)
                        if deck.streakDays > 0 {
                            StatusBadge(text: "连续 \(deck.streakDays) 天",
                                        icon: "flame.fill", tone: .warn)
                        }
                    }
                    Text("\(count) 张待复习").font(.studio(26, .bold)).foregroundStyle(Studio.ink)
                }

                HStack(spacing: 12) {
                    statTile("\(count)", "张到期", "rectangle.stack.fill", index: 0)
                    statTile("\(minutes)", "预计分钟", "clock.fill", index: 1)
                    statTile("\(deck.streakDays)", "连续天", "flame.fill", index: 2)
                }

                StudioButton(title: "开始练习", kind: .red, icon: "play.fill") {
                    Haptics.medium()
                    if reduceMotion { vm.start() }
                    else { withAnimation(StudioMotion.smooth) { vm.start() } }
                }
                .padding(.top, 4)
                .disabled(deck.cards.isEmpty)
            }
            .padding(16)
        }
    }

    /// 统计瓦片：进场交错浮现，图标区柔光衬底。
    private func statTile(_ v: String, _ label: String, _ icon: String, index: Int = 0) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Studio.redSoft)
                    .frame(width: 32, height: 32)
                Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Studio.red)
            }
            Text(v).font(.mono(22, .bold)).foregroundStyle(Studio.ink)
                .contentTransition(.numericText())
            Text(label).font(.studio(11)).foregroundStyle(Studio.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
        .modifier(StaggeredAppear(index: index, reduceMotion: reduceMotion))
    }

    // MARK: 练习（逐张 3D 翻牌）

    @ViewBuilder
    private var practicing: some View {
        VStack(spacing: 16) {
            // 顶部进度 + 连击
            HStack {
                Text(vm.progressText).font(.mono(13, .semibold)).foregroundStyle(Studio.ink2)
                    .contentTransition(.numericText())
                Spacer()
                if vm.combo >= 2 {
                    HStack(spacing: 4) {
                        Image(systemName: "flame.fill").font(.system(size: 12))
                        Text("连击 \(vm.combo)").font(.mono(12, .bold))
                            .contentTransition(.numericText())
                    }
                    .foregroundStyle(Studio.red)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Studio.redSoft)
                    .clipShape(Capsule())
                    .overlay(Capsule().strokeBorder(Studio.redSoftBorder, lineWidth: 1))
                    .scaleEffect(comboPulse && !reduceMotion ? 1.14 : 1)
                    .transition(reduceMotion ? .opacity
                                : .scale.combined(with: .opacity))
                }
            }
            .padding(.horizontal, 16).padding(.top, 8)

            // 水位进度：已完成占比灌满一条横槽
            waterLevel
                .padding(.horizontal, 16)

            Spacer(minLength: 0)

            if let card = vm.current {
                FlipCardView(
                    card: card,
                    flipped: vm.flipped,
                    flyDirection: vm.flyingOut,
                    reduceMotion: reduceMotion,
                    onTap: {
                        if !vm.flipped {
                            Haptics.rigid()
                            if reduceMotion { vm.flip() }
                            else { withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { vm.flip() } }
                        }
                    },
                    onFlyOutFinished: { advanceAfterFly() }
                )
                .padding(.horizontal, 16)
                .id(card.id)   // 换卡时重建视图，重置翻转态
            }

            Spacer(minLength: 0)

            // 记得 / 忘了（翻面后出现）
            if vm.flipped && vm.flyingOut == .none {
                HStack(spacing: 12) {
                    StudioButton(title: "忘了", kind: .ghost, icon: "xmark") {
                        grade(remembered: false)
                    }
                    StudioButton(title: "记得", kind: .red, icon: "checkmark") {
                        grade(remembered: true)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 20)
                .transition(reduceMotion ? .identity : .move(edge: .bottom).combined(with: .opacity))
            } else {
                // 占位保持布局稳定
                Color.clear.frame(height: 68).padding(.bottom, 20)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: vm.flipped)
        .animation(reduceMotion ? nil : StudioMotion.pop, value: vm.combo)
        .onChange(of: vm.combo) { _, new in
            guard new >= 2, !reduceMotion else { return }
            comboPulse = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { comboPulse = false }
        }
    }

    /// 水位进度：已练张数灌满横槽，冷灰蓝底 + 红水位，尾端高光。
    private var waterLevel: some View {
        let ratio: CGFloat = vm.sessionTotal > 0
            ? CGFloat(vm.currentIndex) / CGFloat(vm.sessionTotal) : 0
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Studio.surfaceInset)
                Capsule()
                    .fill(LinearGradient(colors: [Studio.redActive, Studio.red],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(0, geo.size.width * ratio))
                    .overlay(alignment: .trailing) {
                        Circle().fill(Color.white.opacity(0.5))
                            .frame(width: 4, height: 4).padding(.trailing, 3)
                            .opacity(ratio > 0.02 ? 1 : 0)
                    }
            }
        }
        .frame(height: 6)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.currentIndex)
        .accessibilityLabel("练习进度")
        .accessibilityValue("\(Int((ratio * 100).rounded()))%")
    }

    private func grade(remembered: Bool) {
        // 方向性触觉：记得=成功，忘了=警示
        if remembered { Haptics.success() } else { Haptics.warning() }
        // 同步更新统计并设置 flyingOut（触发 FlipCardView 的 onChange 飞出动画）
        vm.grade(remembered: remembered)
        if reduceMotion {
            // 立即切换，无飞出动画
            vm.advance()
        }
        // 非 reduceMotion：飞出动画由 FlipCardView 驱动，完成回调触发 advance
    }

    private func advanceAfterFly() {
        vm.advance()
    }

    // MARK: 结算

    private var summary: some View {
        ZStack(alignment: .top) {
            ScrollView {
                VStack(spacing: 20) {
                    // 深色成绩 hero（弃死黑，用 videoGradient）
                    VStack(spacing: 12) {
                        ZStack {
                            Circle().fill(Color.white.opacity(0.10))
                                .frame(width: 92, height: 92)
                            Circle().strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
                                .frame(width: 92, height: 92)
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 44)).foregroundStyle(.white)
                                .scaleEffect(scorePop && !reduceMotion ? 1 : 0.6)
                                .opacity(scorePop || reduceMotion ? 1 : 0)
                        }
                        Text("本轮完成").font(.studio(22, .bold)).foregroundStyle(.white)
                        Text("正确率 \(vm.accuracy)%")
                            .font(.mono(13, .semibold)).foregroundStyle(.white.opacity(0.72))
                            .contentTransition(.numericText())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
                    .background(Studio.videoGradient)
                    .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
                    .shadow(color: Color.black.opacity(0.28), radius: 22, x: 0, y: 12)

                    HStack(spacing: 12) {
                        statTile("\(vm.sessionTotal)", "本轮张数", "rectangle.stack.fill", index: 0)
                        statTile("\(vm.accuracy)%", "正确率", "target", index: 1)
                        statTile("\(vm.maxCombo)", "最高连击", "flame.fill", index: 2)
                    }

                    VStack(spacing: 10) {
                        StudioButton(title: "再来一轮", kind: .red, icon: "arrow.clockwise") {
                            Task { await vm.restart() }
                        }
                        StudioButton(title: "加练 10 张", kind: .ghost, icon: "plus") {
                            Task { await vm.load(practice: true) }
                        }
                    }
                    .padding(.top, 4)
                }
                .padding(16)
            }

            if showConfetti && !reduceMotion {
                ConfettiView()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .onAppear {
            Haptics.success()
            guard !reduceMotion else { scorePop = true; return }
            withAnimation(StudioMotion.pop) { scorePop = true }
            withAnimation(.easeOut(duration: 0.3)) { showConfetti = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
                withAnimation(.easeOut(duration: 0.4)) { showConfetti = false }
            }
        }
        .onDisappear { scorePop = false; showConfetti = false }
    }

    // MARK: 空态

    private var emptyToday: some View {
        EmptyStateView(
            title: "今日无到期",
            subtitle: "所有卡片都复习完啦，休息一下或加练巩固记忆。",
            actionTitle: "加练 10 张",
            action: { Task { await vm.load(practice: true) } }
        )
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            SkeletonBar(height: 20, width: 120)
            SkeletonBar(height: 32, width: 220)
            HStack(spacing: 12) {
                ForEach(0..<3, id: \.self) { _ in SkeletonBar(height: 90) }
            }
            SkeletonBar(height: 48).clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(16)
    }
}

// MARK: - 3D 翻牌卡片

private struct FlipCardView: View {
    let card: ReviewCard
    let flipped: Bool
    let flyDirection: ReviewViewModel.FlyDirection
    let reduceMotion: Bool
    let onTap: () -> Void
    let onFlyOutFinished: () -> Void

    @State private var flyOffset: CGFloat = 0
    @State private var flyOpacity: Double = 1

    var body: some View {
        ZStack {
            // 正面（问题）
            cardFace(
                tag: "问题",
                tagColor: Studio.ink3,
                text: card.front,
                courseTitle: card.courseTitle
            )
            .opacity(flipped ? 0 : 1)
            .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))

            // 背面（答案）
            cardFace(
                tag: "答案",
                tagColor: Studio.red,
                text: card.back,
                courseTitle: nil
            )
            .opacity(flipped ? 1 : 0)
            .rotation3DEffect(.degrees(flipped ? 0 : -180), axis: (x: 0, y: 1, z: 0))
        }
        // 飞出方向色晕：记得右滑透绿、忘了左滑透红（反馈叙事）
        .overlay {
            RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
                .fill(flyTint)
                .opacity(flyDirection == .none ? 0 : 0.22)
                .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 320)
        .offset(x: flyOffset)
        .opacity(flyOpacity)
        .rotationEffect(.degrees(flyOffset / 30))
        .contentShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg))
        .onTapGesture { onTap() }
        .onChange(of: flyDirection) { _, dir in
            handleFly(dir)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(flipped ? "答案：\(card.back)" : "问题：\(card.front)")
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(flipped ? "" : "轻点两下查看答案")
    }

    private var flyTint: Color {
        switch flyDirection {
        case .right: return Studio.ok
        case .left:  return Studio.red
        case .none:  return .clear
        }
    }

    private func handleFly(_ dir: ReviewViewModel.FlyDirection) {
        guard dir != .none else {
            flyOffset = 0; flyOpacity = 1
            return
        }
        let target: CGFloat = dir == .right ? 600 : -600
        if reduceMotion {
            // reduce motion 下不做飞出位移（切换由 VM.advance 立即处理）
            return
        }
        withAnimation(.easeIn(duration: 0.32)) {
            flyOffset = target
            flyOpacity = 0
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) {
            flyOffset = 0
            flyOpacity = 1
            onFlyOutFinished()
        }
    }

    private func cardFace(tag: String, tagColor: Color, text: String, courseTitle: String?) -> some View {
        let isAnswer = tag == "答案"
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 5) {
                    Circle().fill(tagColor).frame(width: 5, height: 5)
                    Text(tag).font(.mono(10, .bold)).tracking(2)
                        .foregroundStyle(tagColor)
                }
                Spacer()
                if let courseTitle {
                    Text(courseTitle).font(.mono(10)).foregroundStyle(Studio.ink4)
                        .lineLimit(1)
                }
            }
            MarkdownText(text)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            if tag == "问题" {
                HStack(spacing: 6) {
                    Image(systemName: "hand.tap.fill").font(.system(size: 11))
                    Text("点击卡片查看答案").font(.studio(12))
                }
                .foregroundStyle(Studio.ink4)
                .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .studioCard(padding: 0, radius: StudioRadius.cardLg, elevation: 2)
        // 答案面左侧红脊（裁到圆角内），正面纯净：材质区分正反
        .overlay(alignment: .leading) {
            if isAnswer {
                Rectangle().fill(Studio.red).frame(width: 3)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
    }
}

// MARK: - Markdown 渲染（用系统 AttributedString，无第三方依赖）

/// 轻量 Markdown 文本：保留换行、支持行内加粗/斜体/代码/链接。
/// 用 SwiftUI 原生 AttributedString(markdown:)，失败则回退纯文本。
private struct MarkdownText: View {
    let raw: String
    init(_ raw: String) { self.raw = raw }

    var body: some View {
        Text(attributed)
            .font(.studio(16))
            .foregroundStyle(Studio.ink)
            .textSelection(.enabled)
    }

    private var attributed: AttributedString {
        var options = AttributedString.MarkdownParsingOptions()
        options.interpretedSyntax = .inlineOnlyPreservingWhitespace
        if let a = try? AttributedString(markdown: raw, options: options) {
            return a
        }
        return AttributedString(raw)
    }
}

// MARK: - 交错浮现（列表/瓦片进场，按 index 递延，尊重 reduce-motion）

/// 进场时从下方 8pt + 透明度渐入，index 越大延迟越久，形成瀑布浮现。
private struct StaggeredAppear: ViewModifier {
    let index: Int
    let reduceMotion: Bool
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(StudioMotion.smooth.delay(Double(index) * 0.06)) {
                    shown = true
                }
            }
    }
}

// MARK: - 结算彩带（纯 SwiftUI 粒子，无第三方依赖，自动 reduce-motion 由调用方判断）

/// 从顶部两侧洒落的彩纸片，落地渐隐。仅在非 reduce-motion 时挂载。
private struct ConfettiView: View {
    private let pieces: [ConfettiPiece] = ConfettiView.makePieces()
    @State private var launched = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(pieces) { p in
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(p.color)
                        .frame(width: p.size, height: p.size * 0.5)
                        .rotationEffect(.degrees(launched ? p.spin : 0))
                        .position(
                            x: geo.size.width * p.startX,
                            y: launched ? geo.size.height * p.endY : -30
                        )
                        .opacity(launched ? 0 : 1)
                        .animation(
                            .easeIn(duration: p.duration).delay(p.delay),
                            value: launched
                        )
                }
            }
        }
        .onAppear { launched = true }
    }

    private struct ConfettiPiece: Identifiable {
        let id = UUID()
        let startX: CGFloat
        let endY: CGFloat
        let size: CGFloat
        let color: Color
        let spin: Double
        let duration: Double
        let delay: Double
    }

    private static func makePieces() -> [ConfettiPiece] {
        let palette: [Color] = [Studio.red, Studio.ok, Studio.info, Studio.warn, Studio.redHover]
        return (0..<44).map { i in
            ConfettiPiece(
                startX: CGFloat.random(in: 0.05...0.95),
                endY: CGFloat.random(in: 0.85...1.08),
                size: CGFloat.random(in: 7...12),
                color: palette[i % palette.count],
                spin: Double.random(in: 220...620),
                duration: Double.random(in: 1.4...2.1),
                delay: Double.random(in: 0...0.35)
            )
        }
    }
}
