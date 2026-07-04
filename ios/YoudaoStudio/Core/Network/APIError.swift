import Foundation

/// 领域错误：把 HTTP 状态码 + 后端 error 文案折叠成可展示/可分支的错误。
enum APIError: LocalizedError, Equatable {
    case needSubscription(String)   // 402：需订阅 / 积分不足
    case forbidden(String)          // 403：无权限 / 越权
    case notFound(String)           // 404
    case rateLimited(String)        // 429
    case unauthorized(String)       // 401：未登录 / token 失效
    case server(String)             // 5xx
    case message(String)            // 其它业务失败（ok:false）
    case network(String)            // 网络/解码

    static func from(status: Int, message: String?) -> APIError {
        let m = message ?? "请求失败"
        switch status {
        case 401: return .unauthorized(m)
        case 402: return .needSubscription(m)
        case 403: return .forbidden(m)
        case 404: return .notFound(m)
        case 429: return .rateLimited(m)
        case 500...599: return .server(m)
        default: return .message(m)
        }
    }

    var errorDescription: String? {
        switch self {
        case .needSubscription(let m), .forbidden(let m), .notFound(let m),
             .rateLimited(let m), .unauthorized(let m), .server(let m),
             .message(let m), .network(let m):
            return m
        }
    }

    /// 是否应触发跳登录（token 失效）。
    var isAuthExpired: Bool { if case .unauthorized = self { return true }; return false }
    /// 是否应引导订阅/充值。
    var needsPaywall: Bool { if case .needSubscription = self { return true }; return false }
}
