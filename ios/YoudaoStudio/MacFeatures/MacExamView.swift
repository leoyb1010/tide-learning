// Mac 考试：出卷入口（范围 + 题量 + 难度）→ 逐题作答 → 交卷 → 成绩单（逐题 review + 错题标注）。
//
// iOS 考试 VM/DTO 在 Features/Exam（整目录从 Mac target 排除），故此处建等价
// @Observable VM + 本地 DTO，打同一系列端点，走同一 APIEnvelope。
// 字段严格对齐后端真实响应（已 curl 核对）：
//   POST /api/ai/generate-exam {scopeType,scopeId?,count,difficulty} → {examId,count}
//     （需订阅 / 积分；402 引导）
//   GET  /api/exams/[examId] → {examId,title,difficulty?,questions[{id,type,stem,options?}]}
//     type ∈ single / judge / short
//   POST /api/exams/[examId]/submit {answers:{qid:answer}}
//     → {score,total,review[{id,type,stem,options?,answer,explanation?,sourceRef?,
//                            userAnswer?,correct,score,max,comment?}]}
//
// 桌面键盘：single 选项 1-4，judge T/F，回车下一题 / 交卷。
#if os(macOS)
import SwiftUI
import Observation

/// 出卷难度。
enum MacExamDifficulty: String, CaseIterable, Identifiable {
    case easy, medium, hard
    var id: String { rawValue }
    var label: String { switch self { case .easy: "简单"; case .medium: "中等"; case .hard: "困难" } }
}

/// 考卷题目（对齐后端）。options 为 nil 即 short（问答）。
struct MacExamQuestion: Decodable, Identifiable {
    let id: String
    let type: String   // single / judge / short
    let stem: String
    let options: [String]?
}

/// 考卷（生成后拉取）。
struct MacExamPaper: Decodable {
    let examId: String
    let title: String
    let difficulty: String?
    let questions: [MacExamQuestion]
}

/// 逐题批改结果。
struct MacExamReviewItem: Decodable, Identifiable {
    let id: String
    let type: String
    let stem: String?
    let options: [String]?
    let answer: String?       // 正解
    let explanation: String?
    let sourceRef: String?
    let userAnswer: String?
    let correct: Bool
    let score: Int
    let max: Int
    let comment: String?
}

/// 交卷成绩单。
struct MacExamResult: Decodable {
    let attemptId: String?
    let examTitle: String?
    let score: Int
    let total: Int
    let review: [MacExamReviewItem]
    var accuracy: Int { total == 0 ? 0 : Int(Double(score) / Double(total) * 100) }
}

private struct GenerateBody: Encodable {
    let scopeType: String
    let scopeId: String?
    let count: Int
    let difficulty: String
}
private struct GenerateResult: Decodable { let examId: String; let count: Int }
private struct SubmitBody: Encodable { let answers: [String: String] }

/// 出卷范围选项（全部 / 某课）。
struct MacExamScope: Identifiable, Hashable {
    let id: String       // "all" 或 courseId
    let title: String
    var isAll: Bool { id == "all" }
    static let all = MacExamScope(id: "all", title: "近期学习（全部）")
}

@Observable @MainActor
final class MacExamViewModel {
    enum Phase { case setup, generating, answering, submitting, done }
    var phase: Phase = .setup
    var error: String?

    // 出卷参数。
    var scope: MacExamScope = .all
    var count = 5
    var difficulty: MacExamDifficulty = .easy
    /// 范围可选项（全部 + 我的课）。课程列表来自 /api/market mine 课或书架，尽力而为。
    var scopes: [MacExamScope] = [.all]

    // 答题态。
    var paper: MacExamPaper?
    var answers: [String: String] = [:]
    var currentIndex = 0

    // 成绩单。
    var result: MacExamResult?

    var questions: [MacExamQuestion] { paper?.questions ?? [] }
    var current: MacExamQuestion? { questions.indices.contains(currentIndex) ? questions[currentIndex] : nil }
    var answeredCount: Int { questions.filter { !(answers[$0.id] ?? "").isEmpty }.count }
    var allAnswered: Bool { !questions.isEmpty && answeredCount == questions.count }

    /// 加载可选范围（从集市取自己拥有 / 造的课作为范围候选）。失败不阻塞（仅「全部」）。
    func loadScopes() async {
        struct Resp: Decodable { let items: [Item]; struct Item: Decodable { let id: String; let title: String; let mine: Bool; let collectedByMe: Bool } }
        if let r = try? await API.shared.get("/api/market", as: Resp.self) {
            let mine = r.items.filter { $0.mine || $0.collectedByMe }
                .map { MacExamScope(id: $0.id, title: $0.title) }
            // 去重（同 id）。
            var seen = Set<String>(); var out: [MacExamScope] = [.all]
            for s in mine where !seen.contains(s.id) { seen.insert(s.id); out.append(s) }
            scopes = out
        }
    }

    func generate() async {
        phase = .generating; error = nil
        do {
            let gen = try await API.shared.post(
                "/api/ai/generate-exam",
                body: GenerateBody(scopeType: scope.isAll ? "all" : "course",
                                   scopeId: scope.isAll ? nil : scope.id,
                                   count: count, difficulty: difficulty.rawValue),
                as: GenerateResult.self)
            let p = try await API.shared.get("/api/exams/\(gen.examId)", as: MacExamPaper.self)
            paper = p
            answers = [:]; currentIndex = 0
            phase = .answering
        } catch let e as APIError where e.needsPaywall {
            error = (e.errorDescription ?? "出卷需要订阅或积分，充值后再试") + "（前往 Web 端充值）"
            phase = .setup
            Haptics.warning()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "出卷失败，请稍后重试"
            phase = .setup
            Haptics.error()
        }
    }

    func setAnswer(_ q: MacExamQuestion, _ value: String) {
        answers[q.id] = value
        Haptics.selection()
    }

    func next() {
        if currentIndex < questions.count - 1 { currentIndex += 1 }
    }
    func prev() {
        if currentIndex > 0 { currentIndex -= 1 }
    }

    func submit() async {
        guard let paper else { return }
        phase = .submitting; error = nil
        do {
            let r = try await API.shared.post("/api/exams/\(paper.examId)/submit",
                                              body: SubmitBody(answers: answers),
                                              as: MacExamResult.self)
            result = r
            phase = .done
            Haptics.success()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "交卷失败，请稍后重试"
            phase = .answering
            Haptics.error()
        }
    }

    func reset() {
        phase = .setup; paper = nil; answers = [:]; currentIndex = 0; result = nil; error = nil
    }
}

struct MacExamView: View {
    @State private var vm = MacExamViewModel()
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            Group {
                switch vm.phase {
                case .setup: setupView
                case .generating: generatingView
                case .answering, .submitting: answeringView
                case .done: resultView
                }
            }
            .frame(maxWidth: 800)
            .frame(maxWidth: .infinity)
            .padding(28)
        }
        .background(Studio.bg)
        .task { await vm.loadScopes() }
        // 桌面键盘：答题态下 single 选项 1-4、judge T/F、回车下一题 / 交卷。
        .focusable()
        .focused($focused)
        .onAppear { focused = true }
        .onKeyPress { press in handleKey(press) }
    }

    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        guard vm.phase == .answering, let q = vm.current else { return .ignored }
        let ch = press.characters.lowercased()
        switch q.type {
        case "single":
            if let n = Int(ch), let opts = q.options, n >= 1, n <= opts.count {
                vm.setAnswer(q, "\(n - 1)"); return .handled   // 后端选项索引 0-based
            }
        case "judge":
            if ch == "t" { vm.setAnswer(q, "true"); return .handled }
            if ch == "f" { vm.setAnswer(q, "false"); return .handled }
        default: break
        }
        if press.key == .return {
            if vm.currentIndex == vm.questions.count - 1 {
                if vm.allAnswered { Task { await vm.submit() } }
            } else { vm.next() }
            return .handled
        }
        return .ignored
    }

    // MARK: 出卷设置

    private var setupView: some View {
        VStack(alignment: .leading, spacing: 20) {
            header(title: "AI 出卷", subtitle: "选范围、题量与难度，AI 为你生成一套模拟考。",
                   badge: "EXAM", icon: "checklist")
            if let err = vm.error {
                inlineError(err)
            }
            VStack(alignment: .leading, spacing: 18) {
                setupSection("考试范围") {
                    Picker("范围", selection: Binding(get: { vm.scope }, set: { vm.scope = $0 })) {
                        ForEach(vm.scopes) { s in Text(s.title).tag(s) }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .frame(maxWidth: 360, alignment: .leading)
                }
                setupSection("题量") {
                    HStack(spacing: 10) {
                        ForEach([3, 5, 8, 10], id: \.self) { n in
                            chipToggle("\(n) 题", selected: vm.count == n) { vm.count = n }
                        }
                    }
                }
                setupSection("难度") {
                    HStack(spacing: 10) {
                        ForEach(MacExamDifficulty.allCases) { d in
                            chipToggle(d.label, selected: vm.difficulty == d) { vm.difficulty = d }
                        }
                    }
                }
            }
            .studioCard(padding: 22)
            StudioButton(title: "生成试卷", icon: "sparkles") {
                Task { await vm.generate() }
            }
            .frame(maxWidth: 260)
            Text("出卷会消耗 AI 额度（需订阅或积分）。")
                .font(.studio(12)).foregroundStyle(Studio.ink4)
        }
    }

    private func setupSection<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.studio(14, .semibold)).foregroundStyle(Studio.ink2)
            content()
        }
    }

    private func chipToggle(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection(); action()
        } label: {
            Text(label)
                .font(.studio(14, .semibold))
                .foregroundStyle(selected ? .white : Studio.ink2)
                .padding(.horizontal, 16).padding(.vertical, 9)
                .background(selected ? Studio.red : Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    selected ? nil :
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Studio.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var generatingView: some View {
        VStack(spacing: 16) {
            ProgressView().controlSize(.large).tint(Studio.red)
            Text("AI 正在出卷…").font(.studio(16, .semibold)).foregroundStyle(Studio.ink)
            Text("根据你的学习范围生成题目，请稍候。")
                .font(.studio(13)).foregroundStyle(Studio.ink3)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 80)
    }

    // MARK: 答题

    @ViewBuilder
    private var answeringView: some View {
        if let q = vm.current {
            VStack(alignment: .leading, spacing: 18) {
                answerHeader
                questionCard(q)
                navRow
                keyboardHint(for: q)
            }
        }
    }

    private var answerHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(vm.paper?.title ?? "模拟考")
                    .font(.studio(20, .bold)).foregroundStyle(Studio.ink).lineLimit(1)
                Spacer()
                Text("已答 \(vm.answeredCount) / \(vm.questions.count)")
                    .font(.mono(12, .semibold)).foregroundStyle(Studio.ink3)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Studio.surfaceInset).frame(height: 6)
                    Capsule().fill(Studio.red)
                        .frame(width: max(0, geo.size.width * CGFloat(vm.answeredCount) / CGFloat(max(vm.questions.count, 1))),
                               height: 6)
                }
            }
            .frame(height: 6)
        }
    }

    private func questionCard(_ q: MacExamQuestion) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                StatusBadge(text: "第 \(vm.currentIndex + 1) 题", tone: .neutral)
                StatusBadge(text: typeLabel(q.type), icon: typeIcon(q.type), tone: .info)
            }
            Text(q.stem)
                .font(.studio(18, .semibold)).foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
            answerArea(q)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(padding: 0)
    }

    @ViewBuilder
    private func answerArea(_ q: MacExamQuestion) -> some View {
        switch q.type {
        case "single":
            VStack(spacing: 10) {
                ForEach(Array((q.options ?? []).enumerated()), id: \.offset) { idx, opt in
                    optionRow(q, index: idx, label: opt)
                }
            }
        case "judge":
            HStack(spacing: 12) {
                judgeButton(q, value: "true", label: "正确 (T)", icon: "checkmark")
                judgeButton(q, value: "false", label: "错误 (F)", icon: "xmark")
            }
        default:  // short
            TextEditor(text: Binding(
                get: { vm.answers[q.id] ?? "" },
                set: { vm.answers[q.id] = $0 }))
                .font(.studio(15))
                .frame(minHeight: 120)
                .padding(8)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Studio.border, lineWidth: 1))
                .scrollContentBackground(.hidden)
        }
    }

    private func optionRow(_ q: MacExamQuestion, index: Int, label: String) -> some View {
        let selected = vm.answers[q.id] == "\(index)"
        return Button {
            vm.setAnswer(q, "\(index)")
        } label: {
            HStack(spacing: 12) {
                Text("\(index + 1)")
                    .font(.mono(13, .bold))
                    .foregroundStyle(selected ? .white : Studio.ink3)
                    .frame(width: 26, height: 26)
                    .background(selected ? Studio.red : Studio.surface2)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(selected ? .clear : Studio.border, lineWidth: 1))
                Text(label)
                    .font(.studio(15)).foregroundStyle(Studio.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(selected ? Studio.redSoft : Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(selected ? Studio.red.opacity(0.5) : Studio.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func judgeButton(_ q: MacExamQuestion, value: String, label: String, icon: String) -> some View {
        let selected = vm.answers[q.id] == value
        let tone: Color = value == "true" ? Studio.ok : Studio.warn
        return Button {
            vm.setAnswer(q, value)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 14, weight: .bold))
                Text(label).font(.studio(15, .semibold))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .foregroundStyle(selected ? .white : tone)
            .background(selected ? tone : (value == "true" ? Studio.okSoft : Studio.warnSoft))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(tone.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var navRow: some View {
        HStack(spacing: 12) {
            Button {
                vm.prev()
            } label: {
                Label("上一题", systemImage: "chevron.left").font(.studio(14, .semibold))
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .foregroundStyle(Studio.ink2)
                    .background(Studio.surface).clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Studio.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(vm.currentIndex == 0)
            .opacity(vm.currentIndex == 0 ? 0.4 : 1)

            Spacer()

            if vm.currentIndex == vm.questions.count - 1 {
                StudioButton(title: vm.phase == .submitting ? "交卷中…" : "交卷",
                             icon: "paperplane.fill",
                             loading: vm.phase == .submitting) {
                    Task { await vm.submit() }
                }
                .frame(maxWidth: 200)
                .disabled(!vm.allAnswered)
                .opacity(vm.allAnswered ? 1 : 0.5)
            } else {
                Button {
                    vm.next()
                } label: {
                    Label("下一题", systemImage: "chevron.right")
                        .font(.studio(14, .semibold)).labelStyle(TrailingIconLabel())
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .foregroundStyle(.white)
                        .background(Studio.ink).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func keyboardHint(for q: MacExamQuestion) -> some View {
        HStack(spacing: 16) {
            switch q.type {
            case "single": keyCap("1-\((q.options ?? []).count)", "选项")
            case "judge": keyCap("T / F", "对错")
            default: EmptyView()
            }
            keyCap("↵", vm.currentIndex == vm.questions.count - 1 ? "交卷" : "下一题")
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: 成绩单

    @ViewBuilder
    private var resultView: some View {
        if let r = vm.result {
            VStack(alignment: .leading, spacing: 20) {
                scoreCard(r)
                Text("逐题解析")
                    .font(.studio(18, .bold)).foregroundStyle(Studio.ink)
                ForEach(Array(r.review.enumerated()), id: \.element.id) { idx, item in
                    reviewCard(idx: idx, item: item)
                }
                HStack {
                    StudioButton(title: "再考一次", icon: "arrow.clockwise") { vm.reset() }
                        .frame(maxWidth: 220)
                    Spacer()
                }
                .padding(.top, 4)
            }
        }
    }

    private func scoreCard(_ r: MacExamResult) -> some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text(r.examTitle ?? "模拟考成绩单")
                    .font(.studio(20, .bold)).foregroundStyle(.white)
                Text("正确率 \(r.accuracy)% · 共 \(r.review.count) 题")
                    .font(.studio(13)).foregroundStyle(.white.opacity(0.75))
            }
            Spacer()
            VStack(spacing: 0) {
                Text("\(r.score)")
                    .font(.mono(40, .bold)).foregroundStyle(.white)
                Text("/ \(r.total)")
                    .font(.mono(14, .semibold)).foregroundStyle(.white.opacity(0.6))
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.cardLg, style: .continuous))
    }

    private func reviewCard(idx: Int, item: MacExamReviewItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("第 \(idx + 1) 题").font(.studio(13, .bold)).foregroundStyle(Studio.ink2)
                StatusBadge(text: typeLabel(item.type), tone: .neutral)
                Spacer()
                StatusBadge(text: item.correct ? "答对 +\(item.score)" : "答错",
                            icon: item.correct ? "checkmark" : "xmark",
                            tone: item.correct ? .ok : .red)
                Text("\(item.score)/\(item.max)").font(.mono(12, .semibold)).foregroundStyle(Studio.ink4)
            }
            if let stem = item.stem {
                Text(stem).font(.studio(15, .medium)).foregroundStyle(Studio.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // 用户作答 vs 正解（选项映射为文字）。
            answerLine("你的作答", display(item.userAnswer, item),
                       tone: item.correct ? .ok : .red)
            if !item.correct {
                answerLine("参考答案", display(item.answer, item), tone: .ok)
            }
            if let exp = item.explanation, !exp.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "text.book.closed.fill")
                        .font(.system(size: 12)).foregroundStyle(Studio.info).padding(.top, 2)
                    Text(exp).font(.studio(13)).foregroundStyle(Studio.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Studio.infoSoft)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            if let src = item.sourceRef, !src.isEmpty {
                Text(src).font(.studio(11)).foregroundStyle(Studio.ink4).lineLimit(2)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                .strokeBorder(item.correct ? Studio.ok.opacity(0.25) : Studio.red.opacity(0.25), lineWidth: 1)
        )
    }

    private func answerLine(_ label: String, _ value: String, tone: StatusBadge.Tone) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label).font(.studio(12, .semibold)).foregroundStyle(Studio.ink3).frame(width: 64, alignment: .leading)
            Text(value.isEmpty ? "（未作答）" : value)
                .font(.studio(13, .medium))
                .foregroundStyle(tone == .ok ? Studio.ok : tone == .red ? Studio.red : Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// 把作答 / 正解值转为可读文字：single 用选项索引取选项文本；judge 转对/错；short 原样。
    private func display(_ raw: String?, _ item: MacExamReviewItem) -> String {
        guard let raw, !raw.isEmpty else { return "" }
        switch item.type {
        case "single":
            if let i = Int(raw), let opts = item.options, opts.indices.contains(i) {
                return "\(i + 1). \(opts[i])"
            }
            return raw
        case "judge":
            return raw == "true" ? "正确" : raw == "false" ? "错误" : raw
        default:
            return raw
        }
    }

    // MARK: 复用小件

    private func header(title: String, subtitle: String, badge: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(Studio.red)
                Text(badge).font(.mono(10, .bold)).foregroundStyle(Studio.ink4).tracking(2)
            }
            Text(title).font(.studio(28, .bold)).foregroundStyle(Studio.ink)
            Text(subtitle).font(.studio(14)).foregroundStyle(Studio.ink3)
        }
    }

    private func inlineError(_ msg: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Studio.warn)
            Text(msg).font(.studio(13, .medium)).foregroundStyle(Studio.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.warnSoft)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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

    private func typeLabel(_ t: String) -> String {
        switch t { case "single": "单选"; case "judge": "判断"; case "short": "问答"; default: t }
    }
    private func typeIcon(_ t: String) -> String {
        switch t { case "single": "list.bullet"; case "judge": "checkmark.circle"; case "short": "text.alignleft"; default: "questionmark" }
    }
}

/// 尾随图标 Label 样式（下一题按钮：文字在前、箭头在后）。
private struct TrailingIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.title; configuration.icon }
    }
}
#endif
