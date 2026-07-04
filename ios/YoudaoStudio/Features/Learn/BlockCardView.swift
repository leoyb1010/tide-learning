import SwiftUI

/// 单个内容块的卡片渲染。quiz / flashcard 可交互。
///
/// v3.0：12 种块的原生 SwiftUI 渲染，对齐 Web 语义但用原生质感（Studio.* token +
/// StudioMotion 动效 + Haptics 关键交互 + reduce-motion 降级）。
struct BlockCardView: View {
    let block: Block

    /// flashcard「存复习」回调。宿主可注入真实入库逻辑；
    /// 默认 nil 时卡片仍给出本地视觉+触觉确认（自包含，不依赖外部）。
    var onSaveReview: ((_ front: String, _ back: String) -> Void)? = nil

    var body: some View {
        switch block {
        case let .concept(_, title, body):
            ConceptCard(title: title, text: body)
        case let .code(_, lang, code):
            CodeCard(lang: lang, code: code)
        case let .quiz(_, question, options, answer, explanation):
            QuizCard(question: question, options: options, answer: answer, explanation: explanation)
        case let .keypoint(_, points):
            KeypointCard(points: points)
        case let .callout(_, tone, text):
            CalloutCard(tone: tone, text: text)
        case let .objectives(_, items):
            ObjectivesCard(items: items)
        case let .scene(_, title, markdown):
            SceneCard(title: title, text: markdown)
        case let .dialog(_, turns):
            DialogCard(turns: turns)
        case let .steps(_, steps):
            StepsCard(steps: steps)
        case let .compare(_, title, left, right):
            CompareCard(title: title, left: left, right: right)
        case let .example(_, markdown):
            ExampleCard(text: markdown)
        case let .flashcard(_, front, back):
            FlashcardCard(front: front, back: back, onSaveReview: onSaveReview)
        case let .summary(_, markdown, next):
            SummaryCard(text: markdown, next: next)
        case let .image(_, src, caption, alt):
            ImageCard(src: src, caption: caption, alt: alt)
        case let .unknown(_, type):
            UnknownCard(type: type)
        }
    }
}

// MARK: - 小节标签（复用：type 名 + 图标的一致头部）

/// 块内小标签行：图标 + mono 标题，统一各块的语义标识。
private struct BlockLabel: View {
    let icon: String
    let text: String
    var tint: Color = Studio.ink3
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(tint)
            Text(text).font(.mono(11, .semibold)).foregroundStyle(Studio.ink3)
        }
    }
}

// MARK: - concept

private struct ConceptCard: View {
    let title: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !title.isEmpty {
                Text(title).font(.studio(17, .bold)).foregroundStyle(Studio.ink)
            }
            if !text.isEmpty {
                Text(markdown(text)).font(.studio(15)).foregroundStyle(Studio.ink2)
                    .lineSpacing(4)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }
}

// MARK: - code

private struct CodeCard: View {
    let lang: String
    let code: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(lang.uppercased()).font(.mono(11, .semibold)).foregroundStyle(Studio.ink4)
                Spacer()
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: 11)).foregroundStyle(Studio.ink4)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)

            Divider().overlay(Studio.border)

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.mono(13))
                    .foregroundStyle(Studio.ink)
                    .textSelection(.enabled)
                    .padding(14)
            }
        }
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
    }
}

// MARK: - quiz

private struct QuizCard: View {
    let question: String
    let options: [String]
    let answer: Int
    let explanation: String?

    @State private var selected: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "questionmark.circle.fill").foregroundStyle(Studio.info)
                Text("小测").font(.mono(11, .semibold)).foregroundStyle(Studio.ink3)
            }
            Text(question).font(.studio(16, .semibold)).foregroundStyle(Studio.ink)

            VStack(spacing: 8) {
                ForEach(Array(options.enumerated()), id: \.offset) { idx, opt in
                    optionRow(idx: idx, text: opt)
                }
            }

            if let selected {
                let correct = selected == answer
                VStack(alignment: .leading, spacing: 8) {
                    StatusBadge(
                        text: correct ? "回答正确" : "回答错误",
                        icon: correct ? "checkmark.circle.fill" : "xmark.circle.fill",
                        tone: correct ? .ok : .red
                    )
                    if let explanation, !explanation.isEmpty {
                        Text(explanation).font(.studio(13)).foregroundStyle(Studio.ink2).lineSpacing(3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(correct ? Studio.okSoft : Studio.redSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(correct ? Studio.ok.opacity(0.25) : Studio.redSoftBorder, lineWidth: 1))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: selected)
    }

    private func choose(_ idx: Int) {
        guard selected == nil else { return } // 只允许答一次
        selected = idx
        // 反馈触觉：答对成功、答错错误。
        if idx == answer { Haptics.success() } else { Haptics.error() }
    }

    private func optionRow(idx: Int, text: String) -> some View {
        let isChosen = selected == idx
        let revealed = selected != nil
        let isAnswer = idx == answer

        var borderColor = Studio.border
        var bg = Studio.surface2
        if revealed {
            if isAnswer { borderColor = Studio.ok; bg = Studio.okSoft }
            else if isChosen { borderColor = Studio.red; bg = Studio.redSoft }
        } else if isChosen {
            borderColor = Studio.ink
        }

        return Button {
            choose(idx)
        } label: {
            HStack(spacing: 10) {
                Text(letter(idx))
                    .font(.mono(13, .bold))
                    .foregroundStyle(revealed && isAnswer ? Studio.ok : Studio.ink3)
                    .frame(width: 22, height: 22)
                    .background(revealed && isAnswer ? Studio.okSoft : Studio.surfaceInset)
                    .clipShape(Circle())
                Text(text).font(.studio(14)).foregroundStyle(Studio.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if revealed && isAnswer {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Studio.ok)
                }
            }
            .padding(12)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(borderColor, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.98, haptic: false)
        .disabled(revealed)
    }

    private func letter(_ i: Int) -> String {
        guard i >= 0, i < 26 else { return "\(i + 1)" }
        return String(UnicodeScalar(UInt8(65 + i)))
    }
}

// MARK: - keypoint

private struct KeypointCard: View {
    let points: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet.rectangle.fill").foregroundStyle(Studio.ink2)
                Text("要点").font(.mono(11, .semibold)).foregroundStyle(Studio.ink3)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(points.enumerated()), id: \.offset) { _, p in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Studio.red).frame(width: 6, height: 6).padding(.top, 6)
                        Text(p).font(.studio(15)).foregroundStyle(Studio.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }
}

// MARK: - callout

private struct CalloutCard: View {
    let tone: CalloutTone
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(accent).font(.system(size: 16, weight: .semibold))
            Text(markdown(text)).font(.studio(14)).foregroundStyle(Studio.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineSpacing(3)
        }
        .padding(14)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(accent.opacity(0.35), lineWidth: 1))
    }

    private var icon: String {
        switch tone {
        case .info: return "info.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .success: return "checkmark.seal.fill"
        case .tip: return "lightbulb.fill"
        }
    }
    private var accent: Color {
        switch tone {
        case .info: return Studio.info
        case .warn: return Studio.warn
        case .success: return Studio.ok
        case .tip: return Studio.red
        }
    }
    private var bg: Color {
        switch tone {
        case .info: return Studio.infoSoft
        case .warn: return Studio.warnSoft
        case .success: return Studio.okSoft
        case .tip: return Studio.redSoft
        }
    }
}

// MARK: - objectives（学习目标：✓ 列表）

private struct ObjectivesCard: View {
    let items: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            BlockLabel(icon: "target", text: "本节目标", tint: Studio.ok)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Studio.ok)
                            .padding(.top, 1)
                        Text(markdown(item)).font(.studio(15)).foregroundStyle(Studio.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Studio.okSoft)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
            .strokeBorder(Studio.ok.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - scene（场景钩子：深色渐变卡 + 大字）

private struct SceneCard: View {
    let title: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                Text("场景").font(.mono(11, .semibold)).foregroundStyle(.white.opacity(0.7))
            }
            if !title.isEmpty {
                Text(title).font(.studio(21, .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !text.isEmpty {
                Text(markdown(text)).font(.studio(15)).foregroundStyle(.white.opacity(0.82))
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous)
            .strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }
}

// MARK: - dialog（对话：气泡左右分列）

private struct DialogCard: View {
    let turns: [DialogTurn]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BlockLabel(icon: "bubble.left.and.bubble.right.fill", text: "对话")
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(turns.enumerated()), id: \.offset) { idx, turn in
                    DialogBubble(turn: turn, isRight: rightSide(turn.speaker))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    /// 稳定分列：首个出现的说话人固定在左，其余在右（保证同一人始终同侧）。
    private func rightSide(_ speaker: String) -> Bool {
        guard let first = turns.first?.speaker else { return false }
        return speaker != first
    }
}

private struct DialogBubble: View {
    let turn: DialogTurn
    let isRight: Bool

    var body: some View {
        HStack {
            if isRight { Spacer(minLength: 32) }
            VStack(alignment: isRight ? .trailing : .leading, spacing: 4) {
                if !turn.speaker.isEmpty {
                    Text(turn.speaker).font(.mono(10, .semibold)).foregroundStyle(Studio.ink3)
                }
                Text(markdown(turn.text)).font(.studio(15)).foregroundStyle(Studio.ink)
                    .multilineTextAlignment(isRight ? .trailing : .leading)
                    .frame(maxWidth: .infinity, alignment: isRight ? .trailing : .leading)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(isRight ? Studio.redSoft : Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(isRight ? Studio.redSoftBorder : Studio.border, lineWidth: 1))
                if let note = turn.note {
                    Text(note).font(.studio(12)).foregroundStyle(Studio.ink3)
                        .italic()
                        .frame(maxWidth: .infinity, alignment: isRight ? .trailing : .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: isRight ? .trailing : .leading)
            if !isRight { Spacer(minLength: 32) }
        }
    }
}

// MARK: - steps（步骤条：序号 + 竖向连接线）

private struct StepsCard: View {
    let steps: [StepItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BlockLabel(icon: "list.number", text: "步骤")
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                    StepRow(index: idx + 1, step: step, isLast: idx == steps.count - 1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }
}

private struct StepRow: View {
    let index: Int
    let step: StepItem
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // 序号点 + 连接竖线（步骤条视觉）。
            VStack(spacing: 0) {
                Text("\(index)")
                    .font(.mono(12, .bold)).foregroundStyle(.white)
                    .frame(width: 24, height: 24)
                    .background(Studio.red)
                    .clipShape(Circle())
                if !isLast {
                    Rectangle().fill(Studio.border2)
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(markdown(step.title)).font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let detail = step.detail {
                    Text(markdown(detail)).font(.studio(14)).foregroundStyle(Studio.ink2)
                        .lineSpacing(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.bottom, isLast ? 0 : 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - compare（对比：双栏，误区 vs 正确）

private struct CompareCard: View {
    let title: String?
    let left: ComparePane
    let right: ComparePane

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title, !title.isEmpty {
                Text(title).font(.studio(16, .semibold)).foregroundStyle(Studio.ink)
            } else {
                BlockLabel(icon: "arrow.left.arrow.right", text: "对比")
            }
            HStack(alignment: .top, spacing: 10) {
                comparePane(left, tone: .warn, icon: "xmark")
                comparePane(right, tone: .ok, icon: "checkmark")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    private enum PaneTone { case warn, ok }

    @ViewBuilder
    private func comparePane(_ pane: ComparePane, tone: PaneTone, icon: String) -> some View {
        let accent = tone == .ok ? Studio.ok : Studio.warn
        let bg = tone == .ok ? Studio.okSoft : Studio.warnSoft
        VStack(alignment: .leading, spacing: 8) {
            if !pane.heading.isEmpty {
                HStack(spacing: 5) {
                    Image(systemName: tone == .ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(accent)
                    Text(pane.heading).font(.studio(13, .semibold)).foregroundStyle(accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            ForEach(Array(pane.items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: icon).font(.system(size: 10, weight: .bold))
                        .foregroundStyle(accent).padding(.top, 4)
                    Text(item).font(.studio(13)).foregroundStyle(Studio.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(accent.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - example（例子：左侧竖条引用卡）

private struct ExampleCard: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle().fill(Studio.red).frame(width: 3)
            VStack(alignment: .leading, spacing: 8) {
                BlockLabel(icon: "text.quote", text: "例子")
                Text(markdown(text)).font(.studio(15)).foregroundStyle(Studio.ink2)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
            .strokeBorder(Studio.border, lineWidth: 1))
    }
}

// MARK: - flashcard（内联翻转卡：点击翻面 + 存复习）

private struct FlashcardCard: View {
    let front: String
    let back: String
    var onSaveReview: ((_ front: String, _ back: String) -> Void)?

    @State private var flipped = false
    @State private var saved = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                BlockLabel(icon: "rectangle.on.rectangle.angled", text: "翻转卡")
                Spacer()
                Text(flipped ? "答案" : "点击翻面")
                    .font(.mono(10, .semibold)).foregroundStyle(Studio.ink4)
            }

            // 卡面：3D 翻转。front/back 各自反面镜像回正，避免镜像文字。
            ZStack {
                cardFace(text: front, isBack: false)
                    .opacity(flipped ? 0 : 1)
                cardFace(text: back, isBack: true)
                    .opacity(flipped ? 1 : 0)
                    .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
            }
            .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
            .animation(reduceMotion ? nil : StudioMotion.spring, value: flipped)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .onTapGesture {
                if reduceMotion {
                    flipped.toggle()
                } else {
                    withAnimation(StudioMotion.spring) { flipped.toggle() }
                }
                Haptics.soft()
            }

            // 存复习按钮：本地视觉+触觉确认，若宿主注入回调则同时入库。
            Button {
                guard !saved else { return }
                saved = true
                Haptics.success()
                onSaveReview?(front, back)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: saved ? "checkmark" : "bookmark")
                        .font(.system(size: 12, weight: .semibold))
                    Text(saved ? "已存复习" : "存复习").font(.studio(13, .semibold))
                }
                .foregroundStyle(saved ? Studio.ok : Studio.redInk)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(saved ? Studio.okSoft : Studio.redSoft)
                .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous)
                    .strokeBorder(saved ? Studio.ok.opacity(0.3) : Studio.redSoftBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .pressable(scale: 0.96, haptic: false)
            .disabled(saved)
            .animation(reduceMotion ? nil : StudioMotion.quick, value: saved)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    private func cardFace(text: String, isBack: Bool) -> some View {
        Text(markdown(text))
            .font(.studio(isBack ? 15 : 17, isBack ? .regular : .semibold))
            .foregroundStyle(isBack ? Studio.ink2 : Studio.ink)
            .lineSpacing(4)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 96)
            .padding(16)
            .background(isBack ? Studio.surface2 : Studio.surfaceInset)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isBack ? Studio.border2 : Studio.border, lineWidth: 1))
    }
}

// MARK: - summary（小结 + 下节预告）

private struct SummaryCard: View {
    let text: String
    let next: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BlockLabel(icon: "flag.checkered", text: "小结", tint: Studio.ink2)
            if !text.isEmpty {
                Text(markdown(text)).font(.studio(15)).foregroundStyle(Studio.ink)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            if let next, !next.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.redInk)
                        .padding(.top, 1)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("下节预告").font(.mono(10, .semibold)).foregroundStyle(Studio.ink3)
                        Text(markdown(next)).font(.studio(14)).foregroundStyle(Studio.ink2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Studio.redSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Studio.redSoftBorder, lineWidth: 1))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }
}

// MARK: - image（课件图解：AsyncImage 加载站内图 + 可选说明）

private struct ImageCard: View {
    let src: String       // 站内 / 开头路径（已过白名单）
    let caption: String?
    let alt: String?

    /// 完整图 URL：Web 根地址（shareBaseURL，去掉 /api）+ 站内路径。
    /// src 已保证以 / 开头，直接拼接即可。
    private var url: URL? { URL(string: AppConfig.shareBaseURL + src) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AsyncImage(url: url) { phase in
                if let img = phase.image {
                    img.resizable().aspectRatio(contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(Text(alt ?? caption ?? "课件图解"))
                } else if phase.error != nil {
                    // 加载失败：占位区 + 图标，不留破图。
                    placeholder(loading: false)
                } else {
                    placeholder(loading: true)
                }
            }
            if let caption, !caption.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "photo").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Studio.ink3).padding(.top, 1)
                    Text(caption).font(.studio(13)).foregroundStyle(Studio.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .overlay(alignment: .top) { Divider().overlay(Studio.border) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
            .strokeBorder(Studio.border, lineWidth: 1))
    }

    private func placeholder(loading: Bool) -> some View {
        Studio.surfaceInset
            .frame(height: 180)
            .frame(maxWidth: .infinity)
            .overlay {
                if loading {
                    ProgressView().tint(Studio.ink3)
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "photo").font(.system(size: 20)).foregroundStyle(Studio.ink4)
                        Text("图解暂不可用").font(.studio(13)).foregroundStyle(Studio.ink3)
                    }
                }
            }
    }
}

// MARK: - unknown

private struct UnknownCard: View {
    let type: String
    var body: some View {
        Text("暂不支持的内容块（\(type)）")
            .font(.studio(13)).foregroundStyle(Studio.ink4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .studioCard()
    }
}

// MARK: - Markdown 兜底

/// 用系统 AttributedString(markdown:) 做行内 Markdown（粗体/斜体/行内代码/链接）。
/// 解析失败退化为纯文本。inlineOnlyPreservingWhitespace 保留换行。
func markdown(_ s: String) -> AttributedString {
    if let a = try? AttributedString(
        markdown: s,
        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    ) {
        return a
    }
    return AttributedString(s)
}
