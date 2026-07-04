import SwiftUI
import Observation

// MARK: - 出卷设置 ViewModel

@Observable @MainActor
final class ExamSetupViewModel {
    enum Scope: Equatable { case all, course(String) }

    // 表单态
    var scopeType: String = "all"        // "all" | "course"
    var selectedCourseId: String?
    var count: Int = 5                    // 5 / 10 / 20
    var difficulty: String = "basic"     // "basic" | "advanced"

    // 课程列表（供指定课程用）
    var courses: [ExamScopeCourse] = []
    var coursesLoaded = false

    // 出卷态
    var generating = false
    var error: String?
    var needsPaywall = false
    var generatedExamId: String?         // 非 nil → 跳转答题

    let countOptions = [5, 10, 20]

    var canGenerate: Bool {
        if scopeType == "course" { return selectedCourseId != nil }
        return true
    }

    /// 拉课程列表。失败不阻塞（仍可用「全部课程」出卷），静默降级。
    func loadCourses() async {
        guard !coursesLoaded else { return }
        do {
            courses = try await API.shared.get("/api/courses", as: [ExamScopeCourse].self)
        } catch {
            courses = []
        }
        coursesLoaded = true
    }

    func selectCourse(_ id: String) {
        scopeType = "course"
        selectedCourseId = id
    }

    func selectAll() {
        scopeType = "all"
        selectedCourseId = nil
    }

    /// POST /api/ai/generate-exam。成功后 set generatedExamId 触发导航。
    func generate() async {
        guard !generating, canGenerate else { return }
        generating = true; error = nil; needsPaywall = false
        defer { generating = false }
        let req = GenerateExamRequest(
            scopeType: scopeType,
            scopeId: scopeType == "course" ? selectedCourseId : nil,
            count: count,
            difficulty: difficulty
        )
        do {
            let resp = try await API.shared.post("/api/ai/generate-exam", body: req, as: GenerateExamResponse.self)
            generatedExamId = resp.examId
        } catch let e as APIError {
            if e.needsPaywall { needsPaywall = true }
            error = e.errorDescription ?? "出卷失败"
        } catch {
            self.error = "出卷失败，请稍后重试"
        }
    }
}

// MARK: - 入口 View（出卷表单）

struct ExamView: View {
    @State private var vm = ExamSetupViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    scopeSection
                    countSection
                    difficultySection
                    if let err = vm.error {
                        errorBanner(err)
                            .transition(reduceMotion ? .opacity
                                        : .move(edge: .top).combined(with: .opacity))
                    }
                    StudioButton(
                        title: vm.generating ? "AI 出卷中……" : "开始出卷",
                        kind: .red,
                        icon: "doc.text.magnifyingglass",
                        loading: vm.generating
                    ) {
                        Task { await vm.generate() }
                    }
                    .disabled(!vm.canGenerate || vm.generating)
                    .opacity(vm.canGenerate ? 1 : 0.5)
                    if vm.generating {
                        Text("出卷可能需要几秒到十几秒，请稍候。")
                            .font(.studio(12)).foregroundStyle(Studio.ink3)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .transition(.opacity)
                    }
                }
                .padding(16)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.error)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.generating)
            }
            .background(Studio.bg)
            .navigationTitle("模拟考试")
            .task { await vm.loadCourses() }
            .onChange(of: vm.error) { _, new in
                if new != nil { Haptics.warning() }
            }
            .navigationDestination(isPresented: examIdBinding) {
                if let id = vm.generatedExamId {
                    ExamRunnerView(examId: id)
                }
            }
        }
    }

    // 出卷成功后驱动导航；返回时清空以便再次出卷。
    private var examIdBinding: Binding<Bool> {
        Binding(
            get: { vm.generatedExamId != nil },
            set: { active in if !active { vm.generatedExamId = nil } }
        )
    }

    // MARK: 头

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("模拟考试").font(.studio(24, .bold)).foregroundStyle(Studio.ink)
            Text("AI 依据你的课程与笔记出卷，考完自动批改并整理错题。")
                .font(.studio(13)).foregroundStyle(Studio.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 范围

    private var scopeSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("出卷范围")
            selectRow(title: "全部课程",
                      subtitle: "综合已学内容",
                      selected: vm.scopeType == "all") {
                vm.selectAll()
            }
            if !vm.courses.isEmpty {
                ForEach(vm.courses) { c in
                    selectRow(title: c.title,
                              subtitle: "仅此课程",
                              selected: vm.scopeType == "course" && vm.selectedCourseId == c.id) {
                        vm.selectCourse(c.id)
                    }
                }
            } else if vm.coursesLoaded {
                Text("暂无可选课程，将按「全部课程」出卷。")
                    .font(.studio(12)).foregroundStyle(Studio.ink4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    private func selectRow(title: String, subtitle: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? Studio.red : Studio.ink4)
                    .font(.system(size: 18))
                    .scaleEffect(selected ? 1.08 : 1)
                    .animation(reduceMotion ? nil : StudioMotion.pop, value: selected)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(subtitle).font(.studio(12)).foregroundStyle(Studio.ink3)
                }
                Spacer(minLength: 0)
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
    }

    // MARK: 题量

    private var countSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("题量")
            HStack(spacing: 10) {
                ForEach(vm.countOptions, id: \.self) { n in
                    chip(title: "\(n)", subtitle: "题", selected: vm.count == n) {
                        vm.count = n
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    // MARK: 难度

    private var difficultySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("难度")
            HStack(spacing: 10) {
                chip(title: "基础", subtitle: "basic", selected: vm.difficulty == "basic") {
                    vm.difficulty = "basic"
                }
                chip(title: "进阶", subtitle: "advanced", selected: vm.difficulty == "advanced") {
                    vm.difficulty = "advanced"
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
    }

    private func chip(title: String, subtitle: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            VStack(spacing: 3) {
                Text(title)
                    .font(.mono(18, .bold))
                    .foregroundStyle(selected ? .white : Studio.ink)
                Text(subtitle)
                    .font(.mono(10))
                    .foregroundStyle(selected ? .white.opacity(0.85) : Studio.ink3)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(selected ? Studio.red : Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? Studio.red : Studio.border, lineWidth: 1)
            )
            // 红 CTA 柔光只在选中态克制显现
            .shadow(color: selected ? Studio.red.opacity(0.22) : .clear, radius: 8, x: 0, y: 3)
        }
        .buttonStyle(.plain)
        .pressable(haptic: false)
        .animation(reduceMotion ? nil : StudioMotion.quick, value: selected)
    }

    // MARK: 复用小件

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.studio(15, .bold)).foregroundStyle(Studio.ink)
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Studio.red)
            Text(vm.needsPaywall ? "\(msg)（需订阅/充值后继续）" : msg)
                .font(.studio(13)).foregroundStyle(Studio.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Studio.redSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Studio.redSoftBorder, lineWidth: 1)
        )
    }
}
