import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth
    @State private var identifier = ""
    @State private var password = ""
    @State private var loading = false
    @State private var error: String?
    @State private var isSignup = false

    struct LoginBody: Encodable { let identifier: String; let password: String }
    struct SignupBody: Encodable { let nickname: String; let identifier: String; let password: String }

    var body: some View {
        ZStack {
            Studio.bg.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                VStack(spacing: 6) {
                    Text("有道自习室").font(.studio(26, .bold)).foregroundStyle(Studio.ink)
                    Text(isSignup ? "创建账号，开启你的自习室" : "登录，回到你的书桌")
                        .font(.studio(14)).foregroundStyle(Studio.ink3)
                }
                VStack(spacing: 12) {
                    field("手机号 / 邮箱", text: $identifier, secure: false)
                    field("密码", text: $password, secure: true)
                    if let error {
                        Text(error).font(.studio(12)).foregroundStyle(Studio.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    StudioButton(title: isSignup ? "注册" : "登录", loading: loading) { Task { await submit() } }
                    Button(isSignup ? "已有账号？去登录" : "没有账号？去注册") {
                        withAnimation { isSignup.toggle(); error = nil }
                    }
                    .font(.studio(13)).foregroundStyle(Studio.ink3)
                }
                .studioCard(padding: 20)
                .padding(.horizontal, 24)
                Spacer()
            }
        }
    }

    private func field(_ ph: String, text: Binding<String>, secure: Bool) -> some View {
        Group {
            if secure { SecureField(ph, text: text) } else { TextField(ph, text: text).textInputAutocapitalization(.never) }
        }
        .font(.studio(15)).foregroundStyle(Studio.ink)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))
    }

    private func submit() async {
        guard !identifier.isEmpty, !password.isEmpty else { error = "请填写账号和密码"; return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let u: AuthUser
            if isSignup {
                let nickname = identifier.contains("@") ? String(identifier.split(separator: "@").first ?? "同学") : "同学"
                u = try await API.shared.post("/auth/signup", body: SignupBody(nickname: nickname, identifier: identifier, password: password), as: AuthUser.self)
            } else {
                u = try await API.shared.post("/auth/login", body: LoginBody(identifier: identifier, password: password), as: AuthUser.self)
            }
            auth.handleLoginSuccess(u)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "登录失败，请重试"
        }
    }
}
