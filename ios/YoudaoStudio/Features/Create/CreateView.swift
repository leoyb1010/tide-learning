import SwiftUI
import Observation

// MARK: - DTO（字段对齐后端 camelCase）

/// POST /api/ai/generate-course 返回。
struct GeneratedCourse: Decodable {
    let courseId: String
    let slug: String
    let lessons: [GeneratedLesson]
}

/// 大纲里的单节。
struct GeneratedLesson: Decodable, Identifiable {
    let id: String
    let title: String
}

/// POST /api/ai/generate-lesson 返回（能拿到的统计用于完成页；缺省兜底）。
/// 后端实际返回 { lessonId, blocks:Int(写入块数), allReady }；quizCount 为可选，
/// 后端暂未下发时解码为 nil（完成页据 quizCount>0 才展示「N 测验」，缺省即不展示，安全）。
/// blockCount 曾定义但从未被后端下发、也无消费点（永远 nil），删除以消除死字段告警。
struct GeneratedLessonResult: Decodable {
    let lessonId: String?
    let quizCount: Int?
}

// MARK: - 造课阶段机

/// 单节写作状态。
enum LessonWriteState: Equatable {
    case pending    // 未开始
    case writing    // 正在写
    case done       // 已完成
    case failed     // 失败（待重试，不阻断）
}

/// 造课流程阶段。
enum CreateStage: Equatable {
    case idle           // 造课台（输入）
    case understanding  // 步骤1 理解需求
    case outlining      // 步骤2 搭建大纲
    case writing        // 步骤3 逐节写作
    case finished       // 完成页
}

// MARK: - ViewModel

@Observable @MainActor
final class CreateViewModel {
    // 输入
    var prompt = ""

    // 阶段
    var stage: CreateStage = .idle

    // 大纲 / 写作进度
    var courseId: String?
    var slug: String?
    var lessons: [GeneratedLesson] = []
    var lessonStates: [String: LessonWriteState] = [:]
    var currentIndex = 0            // 正在写第几节（0-based）

    // 完成页统计
    var quizCount = 0

    // 错误 / 付费墙
    var error: String?
    var needsPaywall = false
    var paywallMessage: String?

    // 取消控制
    //
    // 旧实现用共享布尔 `cancelled`：新 generate() 会把它复位为 false，导致「取消旧任务→立刻发起新任务」
    // 时，旧在途请求返回后 `if cancelled` 判为 false，仍会写入共享 VM 状态、污染新一轮。
    // 现改为「真取消 Task 句柄 + 单调递增 runID 快照」双保险：
    //   1. genTask 持有当前造课 Task，cancel()/新 generate() 里 genTask?.cancel() 真取消在途 URLSession 请求；
    //   2. 每轮 generate() 递增并快照 runID，所有 await 返回后先 `isStale(runID)` 比对，
    //      非当前轮（被取消或已被新轮取代）一律提前返回、绝不写状态，实现新旧任务状态隔离。
    private var generating = false
    private var genTask: Task<Void, Never>?
    /// 单调递增的运行序号：每次 generate() 自增并快照，用于隔离新旧在途任务的状态写入。
    private var runID = 0

    // 示例灵感 chip
    let examples = [
        "用一周学会 SwiftUI",
        "从零理解神经网络",
        "宋词入门与鉴赏",
        "面试常考的算法题",
    ]

    var canSubmit: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !generating
    }

    /// 完成节数（用于进度与完成页）。
    var doneCount: Int {
        lessonStates.values.filter { $0 == .done }.count
    }

    /// 写作总进度（0...1）。
    var writeProgress: Double {
        guard !lessons.isEmpty else { return 0 }
        return Double(doneCount) / Double(lessons.count)
    }

    /// 首节 id（完成页「开始学习」跳转目标）。
    var firstLessonId: String? { lessons.first?.id }

    func fill(_ text: String) {
        prompt = text
    }

    /// 取消进行中的造课，回到造课台。
    /// 真取消在途 Task（触发 URLSession 取消），并递增 runID 让任何仍在途的旧任务变「陈旧」，
    /// 其 await 返回后一律不再写状态。
    func cancel() {
        genTask?.cancel()
        genTask = nil
        runID &+= 1          // 使任何在途旧任务的快照 runID 失效
        generating = false
        resetToIdle()
    }

    /// 某轮任务是否已「陈旧」：被取消（Task.isCancelled）或已被更新一轮 generate() 取代（runID 前进）。
    /// 陈旧任务 await 返回后必须提前退出，绝不写入共享 VM 状态。
    private func isStale(_ snapshot: Int) -> Bool {
        snapshot != runID || Task.isCancelled
    }

    private func resetToIdle() {
        stage = .idle
        courseId = nil
        slug = nil
        lessons = []
        lessonStates = [:]
        currentIndex = 0
        quizCount = 0
        error = nil
        needsPaywall = false
        paywallMessage = nil
    }

    /// 主流程入口：占位守卫 → 递增并快照 runID → 存 Task 句柄 → 跑本轮流程。
    /// 存句柄使 cancel() 能真取消在途请求；快照 runID 使旧任务返回后被判为陈旧、不写状态。
    func generate() async {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !generating else { return }

        // 发起新一轮前先取消上一轮在途任务（防御性：正常情况下 UI 已禁止并发发起）。
        genTask?.cancel()
        runID &+= 1
        let myRun = runID
        generating = true
        error = nil
        needsPaywall = false
        paywallMessage = nil

        let task = Task { [weak self] in
            guard let self else { return }
            await self.runGenerate(trimmed, myRun: myRun)
        }
        genTask = task
        await task.value
    }

    /// 本轮造课流程。每个 await 返回后先 `isStale(myRun)` 比对，陈旧则立即退出、绝不写共享状态。
    private func runGenerate(_ trimmed: String, myRun: Int) async {
        // 步骤1：理解需求（瞬时 ✓，短暂停顿营造过程感）
        stage = .understanding
        try? await Task.sleep(nanoseconds: 500_000_000)
        if isStale(myRun) { return }

        // 步骤2：搭建大纲
        stage = .outlining
        struct CourseBody: Encodable { let prompt: String }
        do {
            let course = try await API.shared.post(
                "/api/ai/generate-course",
                body: CourseBody(prompt: trimmed),
                as: GeneratedCourse.self
            )
            if isStale(myRun) { return }
            courseId = course.courseId
            slug = course.slug
            lessons = course.lessons
            // 大纲逐条浮现：初始化状态，逐条揭示交给 View 的 appear 动画。
            for l in course.lessons { lessonStates[l.id] = .pending }
        } catch let e as APIError {
            if isStale(myRun) { return }
            if e.needsPaywall {
                needsPaywall = true
                paywallMessage = e.errorDescription
            } else {
                error = e.errorDescription ?? "搭建大纲失败"
            }
            generating = false
            return
        } catch {
            if isStale(myRun) { return }
            self.error = "搭建大纲失败"
            generating = false
            return
        }

        guard !lessons.isEmpty else {
            error = "AI 没有生成任何章节，请换个说法再试。"
            generating = false
            return
        }

        // 让大纲浮现动画播放片刻再进入写作。
        try? await Task.sleep(nanoseconds: 600_000_000)
        if isStale(myRun) { return }

        // 步骤3：逐节串行写作。
        stage = .writing
        struct LessonBody: Encodable { let courseId: String; let lessonId: String }
        for (idx, lesson) in lessons.enumerated() {
            if isStale(myRun) { return }
            currentIndex = idx
            lessonStates[lesson.id] = .writing
            do {
                let res = try await API.shared.post(
                    "/api/ai/generate-lesson",
                    body: LessonBody(courseId: courseId ?? "", lessonId: lesson.id),
                    as: GeneratedLessonResult.self
                )
                if isStale(myRun) { return }
                lessonStates[lesson.id] = .done
                quizCount += res.quizCount ?? 0
            } catch let e as APIError {
                if isStale(myRun) { return }
                // 付费墙可能在写作中触发：终止流程去引导。
                if e.needsPaywall {
                    needsPaywall = true
                    paywallMessage = e.errorDescription
                    generating = false
                    return
                }
                // 单节失败：标「待重试」，不阻断后续。
                lessonStates[lesson.id] = .failed
            } catch {
                if isStale(myRun) { return }
                lessonStates[lesson.id] = .failed
            }
        }

        if isStale(myRun) { return }
        stage = .finished
        generating = false
        genTask = nil
    }

    /// 重试单个失败节（完成页可点）。
    func retry(_ lesson: GeneratedLesson) async {
        guard lessonStates[lesson.id] == .failed else { return }
        lessonStates[lesson.id] = .writing
        struct LessonBody: Encodable { let courseId: String; let lessonId: String }
        do {
            let res = try await API.shared.post(
                "/api/ai/generate-lesson",
                body: LessonBody(courseId: courseId ?? "", lessonId: lesson.id),
                as: GeneratedLessonResult.self
            )
            lessonStates[lesson.id] = .done
            quizCount += res.quizCount ?? 0
        } catch let e as APIError {
            if e.needsPaywall {
                needsPaywall = true
                paywallMessage = e.errorDescription
            }
            lessonStates[lesson.id] = .failed
        } catch {
            lessonStates[lesson.id] = .failed
        }
    }

    /// 造好一门后，从头再来。
    func startOver() {
        prompt = ""
        resetToIdle()
    }
}

// MARK: - View

/// 造课台。中央大输入框 → 过程剧场（理解/大纲/写作）→ 完成页。
struct CreateView: View {
    @State private var vm = CreateViewModel()
    @State private var showRecharge = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // 消费书桌「今天想学」带来的需求，出现时预填输入框。
    @Environment(TabRouter.self) private var router

    var body: some View {
        NavigationStack {
            Group {
                switch vm.stage {
                case .idle:
                    composer
                case .understanding, .outlining, .writing:
                    ProcessTheaterView(vm: vm, reduceMotion: reduceMotion)
                case .finished:
                    FinishedView(vm: vm, reduceMotion: reduceMotion)
                }
            }
            .background(Studio.bg)
            .navigationTitle("造课")
            // 书桌「今天想学」切来时预填需求：进入本 Tab（出现）与待处理意图变化都消费一次。
            .onAppear { consumePendingPrompt() }
            .onChange(of: router.pendingCreatePrompt) { _, _ in consumePendingPrompt() }
            // 生成中不可返回：隐藏返回并锁交互式下滑关闭。
            .toolbar {
                if isGenerating {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("取消") {
                            Haptics.rigid()
                            vm.cancel()
                        }
                        .font(.studio(14, .semibold))
                        .tint(Studio.ink2)
                    }
                }
            }
            .navigationBarBackButtonHidden(isGenerating)
            .navigationDestination(for: String.self) { lessonId in
                LearnView(lessonId: lessonId)
            }
            .sheet(isPresented: $showRecharge) {
                RechargeView()
            }
            // 付费墙引导。
            .sheet(isPresented: paywallBinding) {
                PaywallSheet(message: vm.paywallMessage)
                    .presentationDetents([.medium])
            }
        }
    }

    private var isGenerating: Bool {
        switch vm.stage {
        case .understanding, .outlining, .writing: return true
        default: return false
        }
    }

    /// 消费书桌带来的待处理需求：仅在造课台空闲态预填，避免打断进行中的生成。
    private func consumePendingPrompt() {
        guard case .idle = vm.stage, let text = router.takePendingCreatePrompt() else { return }
        vm.fill(text)
    }

    private var paywallBinding: Binding<Bool> {
        Binding(
            get: { vm.needsPaywall },
            set: { if !$0 { vm.needsPaywall = false } }
        )
    }

    // MARK: 造课台（输入）

    private var composer: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                // 标语
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles").foregroundStyle(Studio.red)
                        Text("AI 造课").font(.mono(12, .bold)).foregroundStyle(Studio.ink3).tracking(1)
                    }
                    Text("今天想学点什么？")
                        .font(.studio(26, .bold))
                        .foregroundStyle(Studio.ink)
                    Text("描述你的目标，AI 为你从大纲到讲解逐节生成一门课。")
                        .font(.studio(14))
                        .foregroundStyle(Studio.ink3)
                }
                .padding(.top, 8)

                // 中央大输入框
                promptField

                // 示例灵感
                VStack(alignment: .leading, spacing: 10) {
                    Text("试试这些").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                    FlowChips(items: vm.examples) { vm.fill($0) }
                }

                // 积分预估
                estimateHint

                if let err = vm.error {
                    Text(err)
                        .font(.studio(13))
                        .foregroundStyle(Studio.redInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(Studio.redSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                StudioButton(title: "开始生成", kind: .red, icon: "wand.and.stars") {
                    Task { await vm.generate() }
                }
                .disabled(!vm.canSubmit)
                .opacity(vm.canSubmit ? 1 : 0.5)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.canSubmit)
            }
            .padding(16)
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.error)
        }
    }

    @FocusState private var promptFocused: Bool

    private var promptField: some View {
        ZStack(alignment: .topLeading) {
            if vm.prompt.isEmpty {
                Text("例如：帮我做一门讲清楚 Swift 并发的课")
                    .font(.studio(16))
                    .foregroundStyle(Studio.ink4)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 18)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $vm.prompt)
                .font(.studio(16))
                .foregroundStyle(Studio.ink)
                .scrollContentBackground(.hidden)
                .padding(10)
                .frame(minHeight: 130)
                .focused($promptFocused)
        }
        // 输入区用 surfaceInset 传达「凹槽」质感，聚焦时红边点亮。
        .background(Studio.surfaceInset)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous)
                .strokeBorder(promptFocused ? Studio.red : Studio.border,
                              lineWidth: promptFocused ? 1.5 : 1)
        )
        // 聚焦时品牌红柔光晕，强化「正在书写」的舞台感。
        .shadow(color: promptFocused ? Studio.red.opacity(0.18) : .clear, radius: 10, x: 0, y: 4)
        .animation(reduceMotion ? nil : StudioMotion.quick, value: promptFocused)
    }

    private var estimateHint: some View {
        HStack(spacing: 10) {
            Image(systemName: "bolt.circle.fill").foregroundStyle(Studio.info)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("预计消耗积分").font(.studio(12, .semibold)).foregroundStyle(Studio.ink2)
                    StatusBadge(text: "生成前不扣费", icon: "checkmark.shield.fill", tone: .ok)
                }
                Text("按课程规模结算，余额不足会提示充值。")
                    .font(.studio(11)).foregroundStyle(Studio.ink3)
            }
            Spacer()
            Button {
                Haptics.selection()
                showRecharge = true
            } label: {
                Text("查看积分")
                    .font(.studio(12, .semibold))
                    .foregroundStyle(Studio.redInk)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Studio.surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - 过程剧场（步骤 1/2/3）

private struct ProcessTheaterView: View {
    @Bindable var vm: CreateViewModel
    let reduceMotion: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // 顶部提示
                VStack(alignment: .leading, spacing: 6) {
                    Text(headline).font(.studio(20, .bold)).foregroundStyle(Studio.ink)
                        .contentTransition(.opacity)
                        .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.stage)
                    Text(vm.prompt.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(.studio(13)).foregroundStyle(Studio.ink3)
                        .lineLimit(2)
                }
                .padding(.top, 8)

                // 三步骤进度条（主卡）
                stepper

                // 大纲逐条浮现（浮起卡，承载核心剧场）
                if !vm.lessons.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("课程大纲").font(.studio(14, .bold)).foregroundStyle(Studio.ink)
                            Spacer()
                            if vm.stage == .writing {
                                Text("\(vm.doneCount)/\(vm.lessons.count)")
                                    .font(.mono(12, .semibold)).foregroundStyle(Studio.redInk)
                                    // 完成计数跳动强调（每完成一节数字弹一下）。
                                    .id(vm.doneCount)
                                    .transition(reduceMotion ? .identity : .scale.combined(with: .opacity))
                            }
                        }
                        .animation(reduceMotion ? nil : StudioMotion.pop, value: vm.doneCount)
                        VStack(spacing: 8) {
                            ForEach(Array(vm.lessons.enumerated()), id: \.element.id) { idx, lesson in
                                OutlineRow(
                                    index: idx,
                                    title: lesson.title,
                                    state: vm.lessonStates[lesson.id] ?? .pending,
                                    reduceMotion: reduceMotion
                                )
                            }
                        }
                    }
                    .studioCard(elevation: 2)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }

                // 写作进行提示（深色展示区，videoGradient 不用死黑）
                if vm.stage == .writing, vm.currentIndex < vm.lessons.count {
                    writingBanner
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .padding(16)
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.lessons.count)
            .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.stage)
        }
    }

    private var headline: String {
        switch vm.stage {
        case .understanding: return "正在理解你的需求…"
        case .outlining: return "正在搭建课程大纲…"
        case .writing: return "正在逐节写作…"
        default: return "生成中…"
        }
    }

    // MARK: 三步骤

    private var stepper: some View {
        VStack(spacing: 0) {
            stepRow(idx: 1, title: "理解需求", state: state(for: .understanding))
            stepConnector(active: state(for: .outlining) != .upcoming)
            stepRow(idx: 2, title: "搭建大纲", state: state(for: .outlining))
            stepConnector(active: state(for: .writing) != .upcoming)
            stepRow(idx: 3, title: "逐节写作", state: state(for: .writing))
        }
        .studioCard()
    }

    private enum StepState { case done, active, upcoming }

    private func state(for stage: CreateStage) -> StepState {
        let order: [CreateStage] = [.understanding, .outlining, .writing]
        guard let cur = order.firstIndex(of: vm.stage),
              let this = order.firstIndex(of: stage) else { return .upcoming }
        if this < cur { return .done }
        if this == cur { return .active }
        return .upcoming
    }

    private func stepRow(idx: Int, title: String, state: StepState) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(state == .upcoming ? Studio.surfaceInset : (state == .done ? Studio.ok : Studio.red))
                    .frame(width: 26, height: 26)
                switch state {
                case .done:
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                case .active:
                    ProgressView().controlSize(.mini).tint(.white)
                case .upcoming:
                    Text("\(idx)").font(.mono(12, .bold)).foregroundStyle(Studio.ink4)
                }
            }
            .animation(reduceMotion ? nil : StudioMotion.pop, value: state)
            Text(title)
                .font(.studio(15, state == .upcoming ? .regular : .semibold))
                .foregroundStyle(state == .upcoming ? Studio.ink3 : Studio.ink)
            Spacer()
            switch state {
            case .done:
                StatusBadge(text: "已完成", icon: "checkmark", tone: .ok)
            case .active:
                StatusBadge(text: "进行中", tone: .red)
            case .upcoming:
                EmptyView()
            }
        }
        .padding(.vertical, 6)
        .animation(reduceMotion ? nil : StudioMotion.smooth, value: state)
    }

    private func stepConnector(active: Bool) -> some View {
        HStack {
            Rectangle().fill(active ? Studio.ok : Studio.border).frame(width: 2, height: 14)
                .padding(.leading, 12)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: active)
            Spacer()
        }
    }

    private var writingBanner: some View {
        let lesson = vm.lessons[vm.currentIndex]
        return HStack(spacing: 12) {
            ProgressView().controlSize(.small).tint(.white)
            VStack(alignment: .leading, spacing: 3) {
                Text("正在写第 \(vm.currentIndex + 1)/\(vm.lessons.count) 节")
                    .font(.mono(11)).foregroundStyle(.white.opacity(0.85))
                Text(lesson.title)
                    .font(.studio(14, .semibold)).foregroundStyle(.white).lineLimit(1)
            }
            Spacer()
        }
        .padding(16)
        .background(Studio.videoGradient)
        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
        // 深色浮层海拔。
        .shadow(color: .black.opacity(0.28), radius: 16, x: 0, y: 8)
    }
}

// MARK: - 大纲行（逐条浮现 + 状态）

private struct OutlineRow: View {
    let index: Int
    let title: String
    let state: LessonWriteState
    let reduceMotion: Bool

    @State private var appeared = false

    var body: some View {
        HStack(spacing: 12) {
            stateIcon
                .animation(reduceMotion ? nil : StudioMotion.pop, value: state)
            Text(title)
                .font(.studio(14, state == .done ? .semibold : .regular))
                .foregroundStyle(state == .pending ? Studio.ink2 : Studio.ink)
                .lineLimit(2)
            Spacer()
            if state == .failed {
                StatusBadge(text: "待重试", icon: "arrow.clockwise", tone: .warn)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared || reduceMotion ? 0 : 8)
        .onAppear {
            if reduceMotion {
                appeared = true
            } else {
                withAnimation(StudioMotion.smooth.delay(Double(index) * 0.06)) {
                    appeared = true
                }
            }
        }
    }

    @ViewBuilder
    private var stateIcon: some View {
        switch state {
        case .pending:
            Circle().strokeBorder(Studio.border2, lineWidth: 1.5).frame(width: 20, height: 20)
        case .writing:
            ProgressView().controlSize(.mini).tint(Studio.red).frame(width: 20, height: 20)
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 20)).foregroundStyle(Studio.ok)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 20)).foregroundStyle(Studio.warn)
        }
    }
}

// MARK: - 完成页

private struct FinishedView: View {
    @Bindable var vm: CreateViewModel
    let reduceMotion: Bool

    @State private var celebrate = false

    private var failedLessons: [GeneratedLesson] {
        vm.lessons.filter { vm.lessonStates[$0.id] == .failed }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // 庆祝头
                VStack(spacing: 12) {
                    ZStack {
                        // 点亮光环。
                        Circle()
                            .fill(Studio.okSoft)
                            .frame(width: 96, height: 96)
                            .scaleEffect(celebrate || reduceMotion ? 1 : 0.4)
                            .opacity(celebrate || reduceMotion ? 1 : 0)
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 54))
                            .foregroundStyle(Studio.ok)
                            .scaleEffect(celebrate || reduceMotion ? 1 : 0.6)
                            .opacity(celebrate || reduceMotion ? 1 : 0)
                    }
                    Text("这门课已经准备好了")
                        .font(.studio(21, .bold)).foregroundStyle(Studio.ink)
                    Text(summaryLine)
                        .font(.studio(14)).foregroundStyle(Studio.ink2)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                // 完成清单：状态徽章 + 完成率一目了然
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("章节清单").font(.studio(13, .bold)).foregroundStyle(Studio.ink)
                        Spacer()
                        StatusBadge(
                            text: "\(vm.doneCount)/\(vm.lessons.count) 已写成",
                            icon: "checkmark.circle.fill",
                            tone: failedLessons.isEmpty ? .ok : .warn
                        )
                    }
                    VStack(spacing: 8) {
                        ForEach(Array(vm.lessons.enumerated()), id: \.element.id) { idx, lesson in
                            HStack(spacing: 12) {
                                OutlineRow(
                                    index: idx,
                                    title: lesson.title,
                                    state: vm.lessonStates[lesson.id] ?? .done,
                                    reduceMotion: true
                                )
                                if vm.lessonStates[lesson.id] == .failed {
                                    Button {
                                        Haptics.medium()
                                        Task { await vm.retry(lesson) }
                                    } label: {
                                        Text("重试").font(.studio(12, .semibold)).foregroundStyle(Studio.redInk)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                .studioCard(elevation: 2)

                if !failedLessons.isEmpty {
                    Text("有 \(failedLessons.count) 节暂未写成，可点重试补齐，不影响先开始学习。")
                        .font(.studio(12)).foregroundStyle(Studio.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                // 开始学习（主 CTA，按压+触觉）
                if let first = vm.firstLessonId {
                    NavigationLink(value: first) {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill").font(.system(size: 14, weight: .semibold))
                            Text("开始学习").font(.studio(14, .semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundStyle(.white)
                        .background(Studio.red)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .shadow(color: Studio.red.opacity(0.28), radius: 12, x: 0, y: 4)
                    }
                    .buttonStyle(.plain)
                    .pressable()
                    .simultaneousGesture(TapGesture().onEnded { Haptics.success() })
                }

                StudioButton(title: "再造一门", kind: .ghost, icon: "arrow.counterclockwise") {
                    vm.startOver()
                }
            }
            .padding(16)
        }
        .onAppear {
            guard !reduceMotion else { celebrate = true; return }
            Haptics.success()
            withAnimation(StudioMotion.spring) { celebrate = true }
        }
    }

    private var summaryLine: String {
        var parts = ["\(vm.lessons.count) 节"]
        if vm.quizCount > 0 { parts.append("\(vm.quizCount) 测验") }
        let done = vm.doneCount
        if done < vm.lessons.count { parts.append("已写成 \(done) 节") }
        return "这门课包含 " + parts.joined(separator: " · ")
    }
}

// MARK: - 灵感 Chip 流式布局

private struct FlowChips: View {
    let items: [String]
    let onTap: (String) -> Void

    var body: some View {
        // iOS17：用自适应网格近似流式排布，避免自定义 Layout 复杂度。
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 130), spacing: 8)],
            alignment: .leading,
            spacing: 8
        ) {
            ForEach(items, id: \.self) { item in
                Button {
                    Haptics.selection()
                    onTap(item)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "lightbulb").font(.system(size: 11))
                        Text(item).font(.studio(13)).lineLimit(1)
                    }
                    .foregroundStyle(Studio.ink2)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .pressable(scale: 0.95)
            }
        }
    }
}
