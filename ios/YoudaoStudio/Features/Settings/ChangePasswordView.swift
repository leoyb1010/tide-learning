import SwiftUI
import Observation

// MARK: - DTO

/// POST /api/account/change-password { currentPassword, newPassword, confirmPassword }
/// 后端无条件校验 newPassword === confirmPassword，confirmPassword 必传（缺省恒判「两次不一致」）。
private struct ChangePasswordBody: Encodable {
    let currentPassword: String
    let newPassword: String
    let confirmPassword: String
}

// MARK: - ViewModel

@Observable @MainActor
final class ChangePasswordViewModel {
    var current = ""
    var next = ""
    var confirm = ""
    var loading = false
    var error: String?
    var done = false

    /// 客户端校验：非空、强度（对齐后端：≥8 位且含字母和数字）、两次一致。
    private func validate() -> String? {
        if current.isEmpty || next.isEmpty || confirm.isEmpty { return "请完整填写所有密码" }
        if next.count < 8 { return "新密码至少 8 位" }
        if next.rangeOfCharacter(from: .letters) == nil || next.rangeOfCharacter(from: .decimalDigits) == nil {
            return "新密码需同时包含字母和数字"
        }
        if next != confirm { return "两次输入的新密码不一致" }
        if next == current { return "新密码不能与当前密码相同" }
        return nil
    }

    func submit() async {
        if let msg = validate() { error = msg; return }
        loading = true; error = nil
        defer { loading = false }
        do {
            _ = try await API.shared.post("/api/account/change-password",
                                          body: ChangePasswordBody(currentPassword: current,
                                                                   newPassword: next,
                                                                   confirmPassword: confirm),
                                          as: EmptyResponse.self)
            done = true
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "修改失败，请重试"
        }
    }
}

// MARK: - View

struct ChangePasswordView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var vm = ChangePasswordViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("为了你的账号安全，请先验证当前密码，再设置新密码。")
                    .font(.studio(13)).foregroundStyle(Studio.ink3)

                VStack(spacing: 12) {
                    secureField("当前密码", text: $vm.current)
                    secureField("新密码（至少 8 位，含字母和数字）", text: $vm.next)
                    secureField("确认新密码", text: $vm.confirm)
                }
                .studioCard(padding: 16)

                if let err = vm.error {
                    Text(err).font(.studio(13)).foregroundStyle(Studio.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                StudioButton(title: "确认修改", kind: .red, loading: vm.loading) {
                    Task { await vm.submit() }
                }
            }
            .padding(16)
        }
        .background(Studio.bg)
        .navigationTitle("修改密码")
        .navigationBarTitleDisplayMode(.inline)
        .alert("密码已更新", isPresented: $vm.done) {
            Button("好") { dismiss() }
        } message: {
            Text("请使用新密码登录。")
        }
    }

    private func secureField(_ ph: String, text: Binding<String>) -> some View {
        SecureField(ph, text: text)
            .font(.studio(15)).foregroundStyle(Studio.ink)
            .textContentType(.password)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))
    }
}
