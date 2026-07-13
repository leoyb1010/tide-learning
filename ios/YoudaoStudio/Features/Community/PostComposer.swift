import SwiftUI
import Observation

// MARK: - 发帖类型

enum PostComposeType: String, CaseIterable, Identifiable {
    case insight
    case checkin
    case question

    var id: String { rawValue }

    var label: String {
        switch self {
        case .insight: return "心得"
        case .checkin: return "打卡"
        case .question: return "提问"
        }
    }

    var icon: String {
        switch self {
        case .insight: return "lightbulb.fill"
        case .checkin: return "checkmark.seal.fill"
        case .question: return "questionmark.circle.fill"
        }
    }

    var placeholder: String {
        switch self {
        case .insight: return "分享你的学习心得或方法…"
        case .checkin: return "今天学了什么？打个卡记录一下…"
        case .question: return "遇到了什么问题？向自习室的同学请教…"
        }
    }
}

// MARK: - 发帖 sheet

struct PostComposer: View {
    @Bindable var vm: CommunityViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var type: PostComposeType = .insight
    @State private var content = ""
    @State private var imageURLs: [String] = []
    @State private var imageInput = ""
    @FocusState private var contentFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var canPost: Bool {
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !vm.posting
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    typePicker
                    editor
                    imageSection
                    if vm.postNeedsPaywall {
                        paywallHint
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    } else if let err = vm.postError {
                        // 审核未过=警示语义（琥珀），非关键红。
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 13)).foregroundStyle(Studio.warn)
                            Text(err).font(.studio(13)).foregroundStyle(Studio.warn)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer()
                        }
                        .padding(12)
                        .background(Studio.warnSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                .padding(16)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.postNeedsPaywall)
                .animation(reduceMotion ? nil : StudioMotion.smooth, value: vm.postError)
            }
            .background(Studio.bg)
            .navigationTitle("发帖")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("取消") { dismiss() }.tint(Studio.ink2)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if vm.posting {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("发布") {
                            Haptics.light()
                            Task {
                                let ok = await vm.createPost(
                                    type: type.rawValue,
                                    content: content,
                                    images: imageURLs
                                )
                                if ok {
                                    Haptics.success()
                                    dismiss()
                                } else {
                                    // 未过审 / 需订阅：警示触觉。
                                    Haptics.warning()
                                }
                            }
                        }
                        .font(.studio(15, .semibold))
                        .tint(Studio.red)
                        .disabled(!canPost)
                    }
                }
            }
            .onAppear { contentFocused = true }
        }
    }

    // MARK: 类型选择

    private var typePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("类型").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
            HStack(spacing: 8) {
                ForEach(PostComposeType.allCases) { t in
                    Button {
                        Haptics.selection()
                        if reduceMotion { type = t }
                        else { withAnimation(StudioMotion.spring) { type = t } }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: t.icon).font(.system(size: 12, weight: .semibold))
                            Text(t.label).font(.studio(13, .semibold))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .foregroundStyle(type == t ? .white : Studio.ink2)
                        .background(type == t ? Studio.red : Studio.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: StudioRadius.pill, style: .continuous))
                        // 选中态品牌柔光（克制）。
                        .shadow(color: type == t ? Studio.red.opacity(0.28) : .clear, radius: 8, x: 0, y: 3)
                    }
                    .buttonStyle(.plain)
                    .pressable(scale: 0.95, haptic: false)
                }
                Spacer()
            }
        }
    }

    // MARK: 正文

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("正文").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
            ZStack(alignment: .topLeading) {
                if content.isEmpty {
                    Text(type.placeholder)
                        .font(.studio(15))
                        .foregroundStyle(Studio.ink4)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 18)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $content)
                    .font(.studio(15))
                    .foregroundStyle(Studio.ink)
                    .frame(minHeight: 160)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .focused($contentFocused)
            }
            .background(Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    // MARK: 可选图片（URL 附加）

    private var imageSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("图片（可选）").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
            HStack(spacing: 8) {
                TextField("粘贴图片链接后点添加", text: $imageInput)
                    .font(.studio(13))
                    .foregroundStyle(Studio.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(10)
                    .background(Studio.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button {
                    if canAddImage { Haptics.light() }
                    addImage()
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(canAddImage ? Studio.red : Studio.ink4)
                        .pressable(scale: 0.9)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canAddImage)
                .accessibilityLabel("添加图片")
            }

            if !imageURLs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(imageURLs.enumerated()), id: \.offset) { idx, urlStr in
                            imageThumb(urlStr, index: idx)
                        }
                    }
                }
            }
        }
    }

    private func imageThumb(_ urlStr: String, index: Int) -> some View {
        ZStack(alignment: .topTrailing) {
            ZStack {
                Studio.surface2
                if let url = URL(string: urlStr) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                        case .empty: ProgressView().tint(Studio.ink4)
                        case .failure: Image(systemName: "photo").foregroundStyle(Studio.ink4)
                        @unknown default: EmptyView()
                        }
                    }
                }
            }
            .frame(width: 80, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            Button {
                Haptics.light()
                if reduceMotion { imageURLs.remove(at: index) }
                else { withAnimation(StudioMotion.quick) { _ = imageURLs.remove(at: index) } }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(.white, Color.black.opacity(0.5))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("删除图片")
        }
    }

    private var paywallHint: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.fill").font(.system(size: 14)).foregroundStyle(Studio.redInk)
            Text(vm.postError ?? "发帖需要订阅会员，请先开通后再来分享")
                .font(.studio(13))
                .foregroundStyle(Studio.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(12)
        .background(Studio.redSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Studio.redSoftBorder, lineWidth: 1))
    }

    private var canAddImage: Bool {
        let trimmed = imageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && imageURLs.count < 9
    }

    private func addImage() {
        let trimmed = imageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, imageURLs.count < 9 else { return }
        imageURLs.append(trimmed)
        imageInput = ""
    }
}
