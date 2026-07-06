// Mac 登录页：桌面居中卡片。复用 AuthManager.handleLoginSuccess 与后端
// /api/auth/login|signup（Login/Signup body 与 AuthUser 与 iOS LoginView 完全一致）。
//
// 与 iOS LoginView 的差异：桌面窄卡片居中（maxWidth ~380），无软键盘相关修饰符；
// 登录/注册切换、错误行内展示、StudioButton 主 CTA，其余复用共享 Studio 设计系统。
#if os(macOS)
import SwiftUI

struct MacLoginView: View {
    @Environment(AuthManager.self) private var auth
    @State private var identifier = ""
    @State private var password = ""
    @State private var loading = false
    @State private var error: String?
    @State private var isSignup = false
    @FocusState private var focus: Field?

    private enum Field { case identifier, password }

    // 与 iOS LoginView 相同的请求体（后端契约一致）。
    private struct LoginBody: Encodable { let identifier: String; let password: String }
    private struct SignupBody: Encodable { let nickname: String; let identifier: String; let password: String }

    var body: some View {
        ZStack {
            Studio.bg.ignoresSafeArea()

            VStack(spacing: 20) {
                // 品牌区
                VStack(spacing: 8) {
                    Text("有道自习室")
                        .font(.studio(28, .bold))
                        .foregroundStyle(Studio.ink)
                    Text("STUDIO · macOS")
                        .font(.mono(11, .bold))
                        .foregroundStyle(Studio.ink4)
                        .tracking(3)
                    Text(isSignup ? "创建账号，开启你的自习室" : "登录，回到你的书桌")
                        .font(.studio(14))
                        .foregroundStyle(Studio.ink3)
                        .padding(.top, 2)
                }

                // 表单卡片
                VStack(spacing: 12) {
                    TextField("用户名 / 手机号 / 邮箱", text: $identifier)
                        .macField()
                        .noAutocapitalization()
                        .noAutocorrection()
                        .focused($focus, equals: .identifier)
                        .onSubmit { focus = .password }

                    SecureField("密码", text: $password)
                        .macField()
                        .focused($focus, equals: .password)
                        .onSubmit { Task { await submit() } }

                    if let error {
                        Text(error)
                            .font(.studio(12))
                            .foregroundStyle(Studio.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    StudioButton(title: isSignup ? "注册" : "登录", loading: loading) {
                        Task { await submit() }
                    }

                    Button(isSignup ? "已有账号？去登录" : "没有账号？去注册") {
                        withAnimation { isSignup.toggle(); error = nil }
                    }
                    .buttonStyle(.plain)
                    .font(.studio(13))
                    .foregroundStyle(Studio.ink3)
                    .padding(.top, 2)
                }
                .studioCard(padding: 22, elevation: 2)
                .frame(maxWidth: 380)
            }
            .padding(40)
        }
        .onAppear { focus = .identifier }
    }

    private func submit() async {
        guard !identifier.isEmpty, !password.isEmpty else {
            error = "请填写账号和密码"
            return
        }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let u: AuthUser
            if isSignup {
                // 昵称从邮箱本地部分推断（与 iOS 一致）。
                let nickname = identifier.contains("@")
                    ? String(identifier.split(separator: "@").first ?? "同学")
                    : "同学"
                u = try await API.shared.post(
                    "/api/auth/signup",
                    body: SignupBody(nickname: nickname, identifier: identifier, password: password),
                    as: AuthUser.self
                )
            } else {
                u = try await API.shared.post(
                    "/api/auth/login",
                    body: LoginBody(identifier: identifier, password: password),
                    as: AuthUser.self
                )
            }
            // 复用共享登录成功处理：写 token/Keychain，触发 RootView 切主界面。
            auth.handleLoginSuccess(u)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "登录失败，请重试"
        }
    }
}
#endif
