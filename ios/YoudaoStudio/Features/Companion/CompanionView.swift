import SwiftUI
import Observation

// MARK: - DTO（对齐后端 camelCase）

/// POST /api/ai/companion 请求体。有课程上下文时带 courseId/lessonId。
/// threadId：首条消息不带（服务端创建 ChatThread），后续消息带上 → 服务端按线程取
/// 最近历史注入上下文（后端不读客户端上传的 history，记忆以服务端线程为准）。
private struct CompanionRequest: Encodable {
    let message: String
    let courseId: String?
    let lessonId: String?
    let threadId: String?
}

/// POST /api/ai/companion 响应体：{ threadId, reply }。
private struct CompanionReply: Decodable {
    let threadId: String?
    let reply: String
}

// MARK: - 本地消息模型

/// 聊天气泡数据。本地维护，不落库。
struct CompanionMessage: Identifiable, Equatable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
}

// MARK: - ViewModel

@Observable @MainActor
final class CompanionViewModel {
    /// 可选课程上下文，从 LearnView 进入时注入。
    let courseId: String?
    let lessonId: String?

    /// 本地消息数组（用户发的 + AI 回的，仅供展示）。
    var messages: [CompanionMessage] = []
    /// 输入框内容。
    var input = ""
    /// AI 思考中。
    var sending = false
    /// 行内错误文案（发送失败）。
    var error: String?
    /// 402 积分不足 → 引导充值。
    var needsPaywall = false
    /// 服务端会话线程 id：首条响应返回后保存，本会话后续消息都带上，
    /// 服务端才能续用同一 ChatThread 并注入历史（否则每条消息都新建线程，AI 无记忆）。
    private(set) var threadId: String?

    init(courseId: String? = nil, lessonId: String? = nil) {
        self.courseId = courseId
        self.lessonId = lessonId
    }

    var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending
    }

    /// 发送一条消息：追加用户气泡 → 请求 → 追加 AI 气泡；失败回滚输入。
    func send() async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }

        error = nil
        needsPaywall = false

        messages.append(CompanionMessage(role: .user, text: text))
        input = ""
        sending = true
        defer { sending = false }

        do {
            let resp = try await API.shared.post(
                "/api/ai/companion",
                body: CompanionRequest(
                    message: text,
                    courseId: courseId,
                    lessonId: lessonId,
                    threadId: threadId
                ),
                as: CompanionReply.self
            )
            // 保存/续用服务端线程 id，会话期间的后续消息共享同一 ChatThread（AI 记忆）。
            if let tid = resp.threadId { threadId = tid }
            messages.append(CompanionMessage(role: .assistant, text: resp.reply))
        } catch {
            let apiErr = error as? APIError
            if apiErr?.needsPaywall == true { needsPaywall = true }
            // 线程在服务端已不存在（404）→ 丢弃本地 threadId，下一条消息重新开线程。
            if case .notFound = apiErr, threadId != nil { threadId = nil }
            self.error = apiErr?.errorDescription ?? "发送失败，请重试"
        }
    }
}

// MARK: - View

struct CompanionView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var vm: CompanionViewModel
    @State private var showRecharge = false
    @FocusState private var inputFocused: Bool

    /// courseId/lessonId 可选，从 LearnView 进入时传入课程上下文。
    init(courseId: String? = nil, lessonId: String? = nil) {
        _vm = State(initialValue: CompanionViewModel(courseId: courseId, lessonId: lessonId))
    }

    var body: some View {
        VStack(spacing: 0) {
            messageList
            Divider().overlay(Studio.border)
            inputBar
        }
        .background(Studio.bg)
        .navigationTitle("学习伴侣")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showRecharge) {
            RechargeView { vm.needsPaywall = false }
        }
    }

    // MARK: 消息列表

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if vm.messages.isEmpty && !vm.sending {
                        emptyHint
                    }
                    ForEach(vm.messages) { msg in
                        MessageBubble(message: msg)
                            .id(msg.id)
                            .transition(
                                reduceMotion
                                ? .opacity
                                : .asymmetric(
                                    insertion: .move(edge: msg.role == .user ? .trailing : .leading)
                                        .combined(with: .opacity),
                                    removal: .opacity
                                )
                            )
                    }
                    if vm.sending {
                        ThinkingBubble().id(Self.thinkingAnchor)
                            .transition(.opacity)
                    }
                    if let err = vm.error {
                        errorRow(err)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.messages)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.sending)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: vm.messages.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: vm.sending) { _, _ in scrollToBottom(proxy) }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let target: AnyHashable
        if vm.sending { target = Self.thinkingAnchor }
        else if let last = vm.messages.last?.id { target = last }
        else { target = Self.thinkingAnchor }
        if reduceMotion {
            proxy.scrollTo(target, anchor: .bottom)
        } else {
            withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(target, anchor: .bottom) }
        }
    }

    private static let thinkingAnchor = "companion.thinking"

    // MARK: 空态提示

    private var emptyHint: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(Studio.redSoft).frame(width: 34, height: 34)
                    Image(systemName: "sparkles").font(.system(size: 15, weight: .semibold)).foregroundStyle(Studio.red)
                }
                Text("你的 AI 学习伴侣").font(.studio(16, .bold)).foregroundStyle(Studio.ink)
            }
            Text(vm.courseId != nil
                 ? "我已了解当前课程内容，随时问我这节课的任何疑问。"
                 : "有任何学习上的问题都可以问我，我会帮你梳理思路。")
                .font(.studio(14)).foregroundStyle(Studio.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard()
        .padding(.top, 8)
    }

    // MARK: 错误行 + 402 充值引导

    private func errorRow(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14)).foregroundStyle(Studio.redInk)
                Text(message).font(.studio(13)).foregroundStyle(Studio.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if vm.needsPaywall {
                StudioButton(title: "去充值积分", kind: .red, icon: "bolt.fill") {
                    showRecharge = true
                }
                .frame(maxWidth: 200)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Studio.redSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
    }

    // MARK: 底部输入栏

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("问点什么…", text: $vm.input, axis: .vertical)
                .font(.studio(15))
                .foregroundStyle(Studio.ink)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Studio.surfaceInset)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(inputFocused ? Studio.red : Studio.border,
                                      lineWidth: inputFocused ? 1.5 : 1)
                )
                .focused($inputFocused)
                .disabled(vm.sending)
                .submitLabel(.send)
                .onSubmit(sendMessage)
                .animation(reduceMotion ? nil : StudioMotion.quick, value: inputFocused)

            Button(action: sendMessage) {
                Group {
                    if vm.sending {
                        ProgressView().controlSize(.small).tint(.white)
                    } else {
                        Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold))
                    }
                }
                .frame(width: 40, height: 40)
                .foregroundStyle(.white)
                .background(vm.canSend ? Studio.red : Studio.ink4)
                .clipShape(Circle())
                .shadow(color: vm.canSend ? Studio.red.opacity(0.28) : .clear, radius: 8, x: 0, y: 3)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!vm.canSend)
            .pressable()
            .animation(reduceMotion ? nil : StudioMotion.quick, value: vm.canSend)
            .accessibilityLabel("发送")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Studio.surface)
    }

    private func sendMessage() {
        guard vm.canSend else { return }
        Haptics.light()
        Task { await vm.send() }
    }
}

// MARK: - 气泡组件

/// 单条消息气泡：用户红右对齐 / AI 灰左对齐。
private struct MessageBubble: View {
    let message: CompanionMessage
    @Environment(\.colorScheme) private var scheme

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isUser { Spacer(minLength: 40) }
            if !isUser {
                // AI 头像徽记，强化「伴侣」人格。
                ZStack {
                    Circle().fill(Studio.redSoft).frame(width: 26, height: 26)
                    Image(systemName: "sparkles").font(.system(size: 11, weight: .semibold)).foregroundStyle(Studio.red)
                }
                .accessibilityHidden(true)
            }
            Text(message.text)
                .font(.studio(15))
                .foregroundStyle(isUser ? .white : Studio.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(bubbleBackground)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    isUser
                    ? nil
                    : RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Studio.border, lineWidth: 1)
                )
                // 气泡材质海拔：轻软阴影托起，脱离平铺感。
                .shadow(
                    color: isUser ? Studio.red.opacity(0.22) : StudioElevation.l1(scheme).color,
                    radius: isUser ? 8 : StudioElevation.l1(scheme).radius,
                    x: 0, y: isUser ? 3 : StudioElevation.l1(scheme).y
                )
                .textSelection(.enabled)
            if !isUser { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isUser ? "我说：\(message.text)" : "伴侣说：\(message.text)")
    }

    @ViewBuilder
    private var bubbleBackground: some View {
        if isUser {
            Studio.red
        } else {
            Studio.surface
        }
    }
}

/// AI 思考中气泡（loading 态）：三点节律跳动，暗示正在生成。
/// 用 TimelineView 驱动（纯 SwiftUI，无外部计时器依赖），reduce-motion 时静止。
private struct ThinkingBubble: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ZStack {
                Circle().fill(Studio.redSoft).frame(width: 26, height: 26)
                Image(systemName: "sparkles").font(.system(size: 11, weight: .semibold)).foregroundStyle(Studio.red)
            }
            .accessibilityHidden(true)
            dots
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Studio.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
            Spacer(minLength: 40)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("伴侣正在思考")
    }

    @ViewBuilder
    private var dots: some View {
        if reduceMotion {
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().fill(Studio.ink3).frame(width: 6, height: 6).opacity(0.6)
                }
            }
        } else {
            TimelineView(.animation) { context in
                // 相位随时间轮转，三点错峰跳动。
                let phase = Int(context.date.timeIntervalSinceReferenceDate / 0.32) % 3
                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle()
                            .fill(Studio.ink3)
                            .frame(width: 6, height: 6)
                            .opacity(phase == i ? 1 : 0.35)
                            .scaleEffect(phase == i ? 1.25 : 1)
                            .animation(.easeInOut(duration: 0.3), value: phase)
                    }
                }
            }
        }
    }
}
