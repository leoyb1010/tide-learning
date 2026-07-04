import SwiftUI
import Charts
import Observation

// MARK: - 复习卡建卡 ViewModel

@Observable @MainActor
final class ReviewCardMaker {
    var making = false
    var doneCount = 0          // 已成功建卡数
    var error: String?
    var needsPaywall = false
    var finished = false       // 全部错题处理完

    /// 对错题逐条 POST /api/ai/review-card。任一 402 立即停并引导充值。
    /// 后端要求正面(front)/背面(back)文本，故用题干与正确答案组卡。
    func makeCards(from wrongItems: [ExamReviewItem]) async {
        guard !making, !wrongItems.isEmpty else { return }
        making = true; error = nil; needsPaywall = false
        defer { making = false }
        for item in wrongItems {
            let front = item.stem ?? "复习题"
            let back = ExamResultView.readableAnswer(item.correctAnswer, options: item.options)
            guard !back.isEmpty else { doneCount += 1; continue }
            do {
                _ = try await API.shared.post(
                    "/api/ai/review-card",
                    body: ReviewCardRequest(front: front, back: back),
                    as: EmptyResponse.self
                )
                doneCount += 1
            } catch let e as APIError {
                if e.needsPaywall { needsPaywall = true }
                error = e.errorDescription ?? "建卡失败"
                return
            } catch {
                self.error = "建卡失败，请稍后重试"
                return
            }
        }
        finished = true
    }
}

/// POST /api/ai/review-card 入参。后端要求 front（正面）/ back（背面）文本。
struct ReviewCardRequest: Encodable {
    let front: String
    let back: String
}

// MARK: - 成绩单 View

struct ExamResultView: View {
    let result: ExamResult
    let examId: String
    var onFinish: () -> Void

    @State private var maker = ReviewCardMaker()
    @State private var scorePop = false
    @State private var showConfetti = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var wrongItems: [ExamReviewItem] { result.review.filter { !$0.correct } }
    private var correctCount: Int { result.review.filter { $0.correct }.count }

    /// 达标线：正确率 ≥80% 视为高分，触发彩带庆祝。
    private var isHighScore: Bool { result.accuracyPct >= 80 }

    var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    scoreHeader
                    if result.review.count >= 2 { breakdownChart }
                    if !wrongItems.isEmpty { reviewCardSection }
                    Text("逐题回顾").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
                    ForEach(Array(result.review.enumerated()), id: \.element.id) { i, item in
                        reviewRow(item)
                            .modifier(ResultStagger(index: min(i, 6), reduceMotion: reduceMotion))
                    }
                    StudioButton(title: "完成", kind: .ghost) {
                        Haptics.light()
                        onFinish()
                    }
                    .padding(.top, 4)
                }
                .padding(16)
            }

            if showConfetti && !reduceMotion {
                ResultConfetti().allowsHitTesting(false).transition(.opacity)
            }
        }
        .background(Studio.bg)
        .onAppear {
            // 高分成功、及格中性、低分警示：语义化触觉
            if isHighScore { Haptics.success() } else { Haptics.light() }
            guard !reduceMotion else { scorePop = true; return }
            withAnimation(StudioMotion.pop) { scorePop = true }
            if isHighScore {
                withAnimation(.easeOut(duration: 0.3)) { showConfetti = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
                    withAnimation(.easeOut(duration: 0.4)) { showConfetti = false }
                }
            }
        }
    }

    // MARK: 头部：大分数（深色 hero，弃死黑，用 videoGradient）

    private var scoreHeader: some View {
        VStack(spacing: 12) {
            Text("你的得分").font(.studio(13)).foregroundStyle(.white.opacity(0.7))
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(result.score)")
                    .font(.mono(64, .bold)).foregroundStyle(.white)
                    .contentTransition(.numericText())
                    .scaleEffect(scorePop || reduceMotion ? 1 : 0.7)
                    .opacity(scorePop || reduceMotion ? 1 : 0)
                Text("/ \(result.total)")
                    .font(.mono(22, .semibold)).foregroundStyle(.white.opacity(0.55))
            }
            HStack(spacing: 8) {
                StatusBadge(
                    text: "正确率 \(result.accuracyPct)%",
                    icon: isHighScore ? "star.fill" : "chart.bar.fill",
                    tone: isHighScore ? .ok : (result.accuracyPct >= 60 ? .info : .warn)
                )
                Text("答对 \(correctCount) / \(result.review.count) 题")
                    .font(.studio(12)).foregroundStyle(.white.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 16)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .shadow(color: Color.black.opacity(0.28), radius: 22, x: 0, y: 12)
    }

    // MARK: 对错分布（Swift Charts 环形，配 Studio 语义色）

    private var breakdownChart: some View {
        HStack(spacing: 18) {
            Chart {
                SectorMark(
                    angle: .value("答对", correctCount),
                    innerRadius: .ratio(0.62), angularInset: 2
                )
                .foregroundStyle(Studio.ok)
                .cornerRadius(3)
                SectorMark(
                    angle: .value("答错", wrongItems.count),
                    innerRadius: .ratio(0.62), angularInset: 2
                )
                .foregroundStyle(Studio.red)
                .cornerRadius(3)
            }
            .chartLegend(.hidden)
            .frame(width: 96, height: 96)
            .overlay {
                VStack(spacing: 0) {
                    Text("\(result.accuracyPct)")
                        .font(.mono(20, .bold)).foregroundStyle(Studio.ink)
                    Text("%").font(.mono(10)).foregroundStyle(Studio.ink3)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                legendRow(color: Studio.ok, label: "答对", value: correctCount)
                legendRow(color: Studio.red, label: "答错", value: wrongItems.count)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(elevation: 1)
    }

    private func legendRow(color: Color, label: String, value: Int) -> some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.studio(13)).foregroundStyle(Studio.ink2)
            Spacer(minLength: 12)
            Text("\(value)").font(.mono(15, .bold)).foregroundStyle(Studio.ink)
                .contentTransition(.numericText())
            Text("题").font(.studio(11)).foregroundStyle(Studio.ink3)
        }
    }

    // MARK: 错题生成复习卡

    private var reviewCardSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "rectangle.stack.badge.plus").foregroundStyle(Studio.warn)
                Text("共 \(wrongItems.count) 道错题")
                    .font(.studio(14, .semibold)).foregroundStyle(Studio.ink)
                Spacer()
                if !maker.finished {
                    StatusBadge(text: "待巩固", icon: "clock", tone: .warn)
                }
            }
            if maker.finished {
                // 完成态用语义绿徽章，非裸红文字
                HStack(spacing: 6) {
                    StatusBadge(text: "已生成 \(maker.doneCount) 张复习卡",
                                icon: "checkmark.circle.fill", tone: .ok)
                    Spacer()
                }
                .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
            } else {
                StudioButton(
                    title: maker.making ? "生成中 \(maker.doneCount)/\(wrongItems.count)" : "错题生成复习卡",
                    kind: .red,
                    icon: "sparkles",
                    loading: maker.making
                ) {
                    Task { await maker.makeCards(from: wrongItems) }
                }
                if let err = maker.error {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 12)).foregroundStyle(Studio.red)
                        Text(maker.needsPaywall ? "\(err)（需订阅或充值后继续）" : err)
                            .font(.studio(12)).foregroundStyle(Studio.redInk)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: maker.finished)
        .onChange(of: maker.finished) { _, done in
            if done { Haptics.success() }
        }
        .onChange(of: maker.error) { _, new in
            if new != nil { Haptics.warning() }
        }
    }

    // MARK: 单题回顾行

    private func reviewRow(_ item: ExamReviewItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                StatusBadge(
                    text: item.correct ? "答对" : "答错",
                    icon: item.correct ? "checkmark" : "xmark",
                    tone: item.correct ? .ok : .red
                )
                Text(item.type.label)
                    .font(.mono(11, .semibold)).foregroundStyle(Studio.ink3)
                Spacer()
                Text("\(item.score) / \(item.max)")
                    .font(.mono(12, .semibold))
                    .foregroundStyle(item.correct ? Studio.ok : Studio.redInk)
            }
            if let stem = item.stem {
                Text(stem).font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            answerLine(label: "我的答案",
                       value: displayAnswer(item.userAnswer, options: item.options),
                       tint: item.correct ? Studio.ok : Studio.redInk)
            if !item.correct, let ca = item.correctAnswer {
                answerLine(label: "正确答案",
                           value: displayAnswer(ca, options: item.options),
                           tint: Studio.ink)
            }
            if let ex = item.explanation, !ex.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("解析").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                    Text(ex).font(.studio(13)).foregroundStyle(Studio.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // 错题左侧红脊，答对无脊：一眼扫出需重点回顾的题
        .studioCard()
        .overlay(alignment: .leading) {
            if !item.correct {
                Rectangle().fill(Studio.red).frame(width: 3)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
    }

    private func answerLine(label: String, value: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label).font(.studio(12)).foregroundStyle(Studio.ink3)
                .frame(width: 56, alignment: .leading)
            Text(value.isEmpty ? "（未作答）" : value)
                .font(.studio(13, .semibold)).foregroundStyle(value.isEmpty ? Studio.ink4 : tint)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// 将 judge 的 true/false、single 的字母映射为可读文案。
    private func displayAnswer(_ raw: String?, options: [String]?) -> String {
        ExamResultView.readableAnswer(raw, options: options)
    }

    /// 将答案原始值映射为可读文案（供展示与建卡复用）。
    /// judge: true/false → 正确/错误；single: 字母 A/B… 或后端 1-based 数字 → 选项原文。
    static func readableAnswer(_ raw: String?, options: [String]?) -> String {
        guard let raw, !raw.isEmpty else { return "" }
        switch raw.lowercased() {
        case "true":  return "正确"
        case "false": return "错误"
        default: break
        }
        // 单选：字母（A→0）
        if let options, raw.count == 1, let scalar = raw.uppercased().unicodeScalars.first {
            let letterIdx = Int(scalar.value) - 65
            if options.indices.contains(letterIdx) {
                return "\(raw). \(options[letterIdx])"
            }
            // 后端正确答案下发为 1-based 数字字符串（如 "1"/"3"）
            if let n = Int(raw) {
                let numIdx = n - 1
                if options.indices.contains(numIdx) {
                    let letter = String(UnicodeScalar(65 + numIdx)!)
                    return "\(letter). \(options[numIdx])"
                }
            }
        }
        return raw
    }
}

// MARK: - 逐题回顾交错浮现（尊重 reduce-motion）

/// 回顾行进场从下方 10pt + 透明度渐入，按 index 递延形成瀑布。
private struct ResultStagger: ViewModifier {
    let index: Int
    let reduceMotion: Bool
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 10)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(StudioMotion.smooth.delay(0.15 + Double(index) * 0.05)) {
                    shown = true
                }
            }
    }
}

// MARK: - 高分彩带（纯 SwiftUI 粒子，仅非 reduce-motion 挂载）

/// 从顶部两侧洒落的彩纸片，落地渐隐。庆祝高分成绩。
private struct ResultConfetti: View {
    private let pieces: [Piece] = ResultConfetti.make()
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
                        .animation(.easeIn(duration: p.duration).delay(p.delay), value: launched)
                }
            }
        }
        .onAppear { launched = true }
    }

    private struct Piece: Identifiable {
        let id = UUID()
        let startX: CGFloat
        let endY: CGFloat
        let size: CGFloat
        let color: Color
        let spin: Double
        let duration: Double
        let delay: Double
    }

    private static func make() -> [Piece] {
        let palette: [Color] = [Studio.red, Studio.ok, Studio.info, Studio.warn, Studio.redHover]
        return (0..<44).map { i in
            Piece(
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
