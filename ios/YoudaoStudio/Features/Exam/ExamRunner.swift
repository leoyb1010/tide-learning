import SwiftUI
import Observation

// MARK: - ViewModel

@Observable @MainActor
final class ExamRunnerViewModel {
    let examId: String

    // 试卷三态
    var paper: ExamPaper?
    var loadError: String?
    var loading = false

    // 答题态
    var index = 0                       // 当前题下标
    var answers: [String: String] = [:] // questionId -> answer（judge 存 "true"/"false"）

    // 交卷态
    var submitting = false
    var submitError: String?
    var needsPaywall = false
    var result: ExamResult?             // 成绩单，非 nil 即跳成绩页

    init(examId: String) {
        self.examId = examId
    }

    // MARK: 派生

    var questions: [ExamQuestion] { paper?.questions ?? [] }
    var current: ExamQuestion? { questions.indices.contains(index) ? questions[index] : nil }
    var isLast: Bool { index >= questions.count - 1 }
    var answeredCount: Int { questions.filter { answers[$0.id]?.isEmpty == false }.count }
    var allAnswered: Bool { !questions.isEmpty && answeredCount == questions.count }

    func isAnswered(_ q: ExamQuestion) -> Bool { answers[q.id]?.isEmpty == false }

    // MARK: 载入试卷

    func load() async {
        loading = true; loadError = nil
        defer { loading = false }
        do {
            paper = try await API.shared.get("/api/exams/\(examId)", as: ExamPaper.self)
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? "试卷加载失败"
        }
    }

    // MARK: 作答

    func setAnswer(_ value: String, for q: ExamQuestion) {
        answers[q.id] = value
    }

    func goPrev() {
        guard index > 0 else { return }
        index -= 1
    }

    func goNext() {
        guard index < questions.count - 1 else { return }
        index += 1
    }

    func jump(to i: Int) {
        guard questions.indices.contains(i) else { return }
        index = i
    }

    // MARK: 交卷

    func submit() async {
        guard !submitting else { return }
        submitting = true; submitError = nil; needsPaywall = false
        defer { submitting = false }
        do {
            let req = SubmitExamRequest(answers: answers)
            result = try await API.shared.post("/api/exams/\(examId)/submit", body: req, as: ExamResult.self)
        } catch let e as APIError {
            if e.needsPaywall { needsPaywall = true }
            submitError = e.errorDescription ?? "交卷失败"
        } catch {
            submitError = "交卷失败，请稍后重试"
        }
    }
}

// MARK: - Runner View（一题一屏）

struct ExamRunnerView: View {
    @State private var vm: ExamRunnerViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(examId: String) {
        _vm = State(initialValue: ExamRunnerViewModel(examId: examId))
    }

    var body: some View {
        ZStack {
            Studio.bg.ignoresSafeArea()
            if vm.result != nil {
                ExamResultView(result: vm.result!, examId: vm.examId, onFinish: { dismiss() })
                    .transition(reduceMotion ? .opacity
                                : .move(edge: .bottom).combined(with: .opacity))
            } else if let _ = vm.paper {
                answeringBody
                    .transition(.opacity)
            } else if let err = vm.loadError {
                ErrorRetryView(message: err) { Task { await vm.load() } }
            } else {
                loadingSkeleton
            }
        }
        .navigationTitle("模拟考试")
        .navigationBarTitleDisplayMode(.inline)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.result != nil)
        .task { if vm.paper == nil { await vm.load() } }
    }

    // MARK: 答题主体

    private var answeringBody: some View {
        VStack(spacing: 0) {
            progressDots
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 4)

            ScrollView {
                if let q = vm.current {
                    questionCard(q)
                        .padding(16)
                        .id(q.id) // 换题时重置滚动位置
                        .transition(reduceMotion ? .identity
                                    : .asymmetric(
                                        insertion: .move(edge: .trailing).combined(with: .opacity),
                                        removal: .move(edge: .leading).combined(with: .opacity)))
                }
            }
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.index)

            bottomBar
        }
    }

    // MARK: 进度点

    private var progressDots: some View {
        VStack(spacing: 8) {
            HStack {
                Text("第 \(vm.index + 1) / \(vm.questions.count) 题")
                    .font(.mono(12, .semibold)).foregroundStyle(Studio.ink2)
                    .contentTransition(.numericText())
                Spacer()
                StatusBadge(
                    text: "已答 \(vm.answeredCount)/\(vm.questions.count)",
                    icon: vm.allAnswered ? "checkmark" : "pencil",
                    tone: vm.allAnswered ? .ok : .info
                )
                .animation(reduceMotion ? nil : StudioMotion.pop, value: vm.answeredCount)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(vm.questions.enumerated()), id: \.element.id) { i, q in
                        dot(index: i, answered: vm.isAnswered(q), current: i == vm.index)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                            .onTapGesture {
                                Haptics.selection()
                                if reduceMotion { vm.jump(to: i) }
                                else { withAnimation(StudioMotion.smooth) { vm.jump(to: i) } }
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("第 \(i + 1) 题")
                            .accessibilityValue(i == vm.index ? "当前" : (vm.isAnswered(q) ? "已答" : "未答"))
                            .accessibilityAddTraits(.isButton)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func dot(index i: Int, answered: Bool, current: Bool) -> some View {
        ZStack {
            Circle()
                .fill(current ? Studio.red : (answered ? Studio.okSoft : Studio.surfaceInset))
                .frame(width: 26, height: 26)
                .overlay(
                    Circle().strokeBorder(current ? Studio.red
                                          : (answered ? Studio.ok.opacity(0.4) : Studio.border),
                                          lineWidth: 1)
                )
            if answered && !current {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Studio.ok)
            } else {
                Text("\(i + 1)")
                    .font(.mono(11, .semibold))
                    .foregroundStyle(current ? .white : Studio.ink3)
            }
        }
        .scaleEffect(current ? 1.14 : 1)
        .animation(reduceMotion ? nil : StudioMotion.pop, value: current)
        .animation(reduceMotion ? nil : StudioMotion.quick, value: answered)
    }

    // MARK: 题卡

    private func questionCard(_ q: ExamQuestion) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                StatusBadge(text: q.type.label, tone: .info)
                Spacer()
                if vm.isAnswered(q) {
                    StatusBadge(text: "已答", icon: "checkmark", tone: .ok)
                        .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : StudioMotion.pop, value: vm.isAnswered(q))
            Text(q.stem)
                .font(.studio(17, .semibold)).foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)

            switch q.type {
            case .single: singleOptions(q)
            case .judge:  judgeOptions(q)
            case .short:  shortEditor(q)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(elevation: 1)
    }

    // 单选：选项按钮
    @ViewBuilder
    private func singleOptions(_ q: ExamQuestion) -> some View {
        VStack(spacing: 10) {
            ForEach(Array((q.options ?? []).enumerated()), id: \.offset) { i, opt in
                let letter = optionLetter(i)
                let selected = vm.answers[q.id] == letter
                Button {
                    Haptics.selection()
                    if reduceMotion { vm.setAnswer(letter, for: q) }
                    else { withAnimation(StudioMotion.quick) { vm.setAnswer(letter, for: q) } }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Text(letter)
                            .font(.mono(13, .bold))
                            .foregroundStyle(selected ? .white : Studio.ink2)
                            .frame(width: 26, height: 26)
                            .background(selected ? Studio.red : Studio.surfaceInset)
                            .clipShape(Circle())
                            .scaleEffect(selected ? 1.06 : 1)
                        Text(opt)
                            .font(.studio(15)).foregroundStyle(Studio.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .background(selected ? Studio.redSoft : Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(selected ? Studio.red : Studio.border, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .pressable(haptic: false)
                .animation(reduceMotion ? nil : StudioMotion.pop, value: selected)
            }
        }
    }

    // 判断：对 / 错
    private func judgeOptions(_ q: ExamQuestion) -> some View {
        HStack(spacing: 12) {
            judgeButton(q, value: "true", title: "正确", icon: "checkmark")
            judgeButton(q, value: "false", title: "错误", icon: "xmark")
        }
    }

    private func judgeButton(_ q: ExamQuestion, value: String, title: String, icon: String) -> some View {
        let selected = vm.answers[q.id] == value
        return Button {
            Haptics.selection()
            if reduceMotion { vm.setAnswer(value, for: q) }
            else { withAnimation(StudioMotion.quick) { vm.setAnswer(value, for: q) } }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 14, weight: .bold))
                Text(title).font(.studio(15, .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(selected ? .white : Studio.ink)
            .background(selected ? Studio.red : Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? Studio.red : Studio.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .pressable(haptic: false)
        .animation(reduceMotion ? nil : StudioMotion.quick, value: selected)
    }

    // 简答：TextEditor
    private func shortEditor(_ q: ExamQuestion) -> some View {
        let binding = Binding<String>(
            get: { vm.answers[q.id] ?? "" },
            set: { vm.setAnswer($0, for: q) }
        )
        return VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: binding)
                .font(.studio(15))
                .foregroundStyle(Studio.ink)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 140)
                .padding(10)
                .background(Studio.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Studio.border, lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    if (vm.answers[q.id] ?? "").isEmpty {
                        Text("在此作答……")
                            .font(.studio(15)).foregroundStyle(Studio.ink4)
                            .padding(.horizontal, 15).padding(.vertical, 18)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    // MARK: 底部导航条

    private var bottomBar: some View {
        VStack(spacing: 8) {
            if let err = vm.submitError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 12)).foregroundStyle(Studio.red)
                    Text(err).font(.studio(12)).foregroundStyle(Studio.redInk)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
            HStack(spacing: 12) {
                StudioButton(title: "上一题", kind: .ghost, icon: "chevron.left") {
                    if reduceMotion { vm.goPrev() }
                    else { withAnimation(StudioMotion.smooth) { vm.goPrev() } }
                }
                .frame(maxWidth: 130)
                .opacity(vm.index == 0 ? 0.4 : 1)
                .disabled(vm.index == 0)

                if vm.isLast {
                    StudioButton(title: vm.allAnswered ? "交卷" : "交卷（还有未答）",
                                 kind: .red, loading: vm.submitting) {
                        Task { await vm.submit() }
                    }
                } else {
                    StudioButton(title: "下一题", kind: .ink, icon: "chevron.right") {
                        if reduceMotion { vm.goNext() }
                        else { withAnimation(StudioMotion.smooth) { vm.goNext() } }
                    }
                }
            }
        }
        .padding(16)
        .background(Studio.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Divider().overlay(Studio.border) }
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.submitError)
        .onChange(of: vm.submitError) { _, new in
            if new != nil { Haptics.error() }
        }
        .onChange(of: vm.result != nil) { _, done in
            if done { Haptics.success() }
        }
    }

    // MARK: 骨架

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 16) {
            SkeletonBar(height: 20, width: 160)
            SkeletonBar(height: 200).clipShape(RoundedRectangle(cornerRadius: 16))
            SkeletonBar(height: 48).clipShape(RoundedRectangle(cornerRadius: 12))
            SkeletonBar(height: 48).clipShape(RoundedRectangle(cornerRadius: 12))
            Spacer()
        }.padding(16)
    }

    // A/B/C/D…
    private func optionLetter(_ i: Int) -> String {
        guard i >= 0, i < 26 else { return "\(i + 1)" }
        return String(UnicodeScalar(65 + i)!)
    }
}
