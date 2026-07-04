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

    private init() {
        token = KeychainStore.read()
    }

    /// 启动引导：有 token 则拉 /auth/me 校验。
    func bootstrap() async {
        defer { didBootstrap = true }
        // DEV：通过启动环境变量 DEV_TOKEN 注入会话（仅调试联调用；生产无此变量不触发）。
        if token == nil, let devToken = ProcessInfo.processInfo.environment["DEV_TOKEN"], !devToken.isEmpty {
            token = devToken
            KeychainStore.save(devToken)
        }
        guard token != nil else { return }
        do {
            // /auth/me 返回 { user, entitlement } 包装。
            let me = try await API.shared.get("/auth/me", as: MeResponse.self)
            user = AuthUser(id: me.user.id, nickname: me.user.nickname, role: me.user.role, sessionToken: nil)
        } catch let e as APIError where e.isAuthExpired {
            await logoutLocal() // 仅 401 视为失效；网络错误保留 token 下次重试
        } catch {
            // 网络等临时错误：保留 token，用已有信息进入（离线优先）
        }
    }

    struct MeResponse: Decodable {
        struct MeUser: Decodable { let id: String; let nickname: String; let role: String? }
        let user: MeUser
    }

    func handleLoginSuccess(_ u: AuthUser) {
        if let t = u.sessionToken {
            token = t
            KeychainStore.save(t)
        }
        user = u
    }

    func logout() async {
        _ = try? await API.shared.post("/auth/logout", body: EmptyBody(), as: EmptyResponse.self)
        await logoutLocal()
    }

    func logoutLocal() async {
        token = nil
        user = nil
        KeychainStore.clear()
    }
}

struct EmptyBody: Encodable {}
struct EmptyResponse: Decodable {}
