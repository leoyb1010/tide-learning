import Foundation
import Observation

struct AuthUser: Codable, Identifiable, Equatable {
    let id: String
    let nickname: String
    let role: String?
    let sessionToken: String?
}

/// 全局登录态。token 存 Keychain；App 启动读回并校验。
@Observable
@MainActor
final class AuthManager {
    static let shared = AuthManager()

    private(set) var token: String?
    private(set) var user: AuthUser?
    var isLoggedIn: Bool { token != nil }
    private(set) var didBootstrap = false
    private var generation = SessionGeneration()
    var sessionGeneration: UInt64 { generation.value }

    private init() {
        token = KeychainStore.read()
    }

    /// 启动引导：有 token 则拉 /auth/me 校验。
    func bootstrap() async {
        defer { didBootstrap = true }
        // DEV：启动环境变量 DEV_TOKEN 注入会话（仅调试联调用；生产无此变量不触发）。
        // 优先级高于 Keychain：DEV 场景以环境变量为准，覆盖可能残留的旧 token
        // （模拟器卸载 App 不清 Keychain 是已知坑，旧 token 会导致 401）。
        #if DEBUG
        if let devToken = ProcessInfo.processInfo.environment["DEV_TOKEN"], !devToken.isEmpty {
            generation.advance()
            token = devToken
            KeychainStore.save(devToken)
        }
        #endif
        guard let bootstrapToken = token else { return }
        let bootstrapGeneration = generation.value
        do {
            // /auth/me 返回 { user, entitlement } 包装。
            let me = try await API.shared.get("/api/auth/me", as: MeResponse.self)
            guard token == bootstrapToken, generation.accepts(bootstrapGeneration) else { return }
            user = AuthUser(id: me.user.id, nickname: me.user.nickname, role: me.user.role, sessionToken: nil)
        } catch let e as APIError where e.isAuthExpired {
            // API already invalidated only the credential used by this request.
            // A later login must survive a delayed bootstrap failure.
        } catch {
            // 网络等临时错误：保留 token，用已有信息进入（离线优先）
        }
    }

    struct MeResponse: Decodable {
        struct MeUser: Decodable { let id: String; let nickname: String; let role: String? }
        let user: MeUser
    }

    @discardableResult
    func handleLoginSuccess(_ u: AuthUser, expectedGeneration: UInt64) -> Bool {
        guard generation.accepts(expectedGeneration), let credential = u.sessionToken, !credential.isEmpty else { return false }
        generation.advance()
        token = credential
        KeychainStore.save(credential)
        user = u
        // 登录成功是明确的用户动作：此时请求通知权限，并把 APNs token 经 AppDelegate 回传服务端。
        #if os(iOS)
        Task { await PushManager.shared.registerForPush() }
        #endif
        return true
    }

    func logout() async {
        let revokedToken = token
        generation.advance()
        // Clear synchronously before suspension. Revoke only this captured token,
        // never whichever credential a newer login may install while awaiting IO.
        token = nil
        user = nil
        KeychainStore.clear()
        if let revokedToken { await API.shared.revokeSession(revokedToken) }
    }

    func logoutLocal() async {
        generation.advance()
        token = nil
        user = nil
        KeychainStore.clear()
    }

    func requestSnapshot() -> (token: String?, generation: UInt64) {
        (token, generation.value)
    }

    func acceptsResponse(generation snapshot: UInt64, requestAuthorization: String?) -> Bool {
        guard generation.accepts(snapshot) else { return false }
        return requestAuthorization == token.map { "Bearer \($0)" }
    }

    /// 全局 401 钩子：任意请求收到 401（token 失效）时由 `API.send` 调用，
    /// 清本地登录态 → RootView 观察到 isLoggedIn 变化自动回登录页。iOS/Mac 共享。
    ///
    /// 幂等：已登出（token == nil）则跳过，避免 bootstrap 的 401 与并发请求的 401
    /// 重复触发 logoutLocal / 多次 UI 抖动。所有失效都绑定实际发出请求时的凭据。
    func handleAuthExpired(requestAuthorization: String?, generation snapshot: UInt64) {
        guard generation.accepts(snapshot) else { return }
        guard SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: requestAuthorization, currentToken: token) else { return }
        // This check and clear run in the same MainActor turn, without suspension.
        generation.advance()
        token = nil
        user = nil
        KeychainStore.clear()
    }
}

struct EmptyBody: Encodable {}
struct EmptyResponse: Decodable {}
