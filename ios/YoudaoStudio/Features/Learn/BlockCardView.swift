import SwiftUI

/// 单个内容块的卡片渲染。quiz 可交互（选择后显示对错 + 解析）。
struct BlockCardView: View {
    let block: Block

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
        case let .unknown(_, type):
            UnknownCard(type: type)
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
