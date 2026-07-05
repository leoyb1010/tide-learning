import Foundation

/// 后端统一响应：{ ok, data?, error? }
struct APIEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
}

extension JSONDecoder {
    /// 后端 ISO8601（含毫秒/时区）。
    static var api: JSONDecoder {
        let d = JSONDecoder()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoPlain = ISO8601DateFormatter()
        isoPlain.formatOptions = [.withInternetDateTime]
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let dt = iso.date(from: s) ?? isoPlain.date(from: s) { return dt }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "bad date \(s)"))
        }
        return d
    }
}

/// 网络客户端。注入 Bearer token + X-App-Origin；折叠错误。
final class API {
    static let shared = API()
    private let base = URL(string: AppConfig.apiBaseURL)!
    private let session: URLSession
    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.httpShouldSetCookies = false // 用 Bearer，不用 cookie
        session = URLSession(configuration: cfg)
    }

    func get<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
        try await send(path, method: "GET", body: Optional<EmptyBody>.none, as: T.self)
    }
    func post<B: Encodable, T: Decodable>(_ path: String, body: B, as: T.Type) async throws -> T {
        try await send(path, method: "POST", body: body, as: T.self)
    }
    func patch<B: Encodable, T: Decodable>(_ path: String, body: B, as: T.Type) async throws -> T {
        try await send(path, method: "PATCH", body: body, as: T.self)
    }
    func delete<B: Encodable, T: Decodable>(_ path: String, body: B, as: T.Type) async throws -> T {
        try await send(path, method: "DELETE", body: body, as: T.self)
    }

    /// 由 `path`（可含 `?query`）拼出请求 URL。
    ///
    /// `URL.appending(path:)` 会把 `?`/`=`/`&` 当作路径字符转义（`courses?q=x` → `courses%3Fq=x`），
    /// 导致 query 根本到不了服务端。这里在首个 `?` 处切分：路径段走 `appending(path:)`，
    /// query 段作为 **已编码** 串直接挂到 `percentEncodedQuery`（调用方用 URLComponents.queryItems
    /// 组装，特殊字符 `& = + ?` 已正确转义，此处不得二次编码）。
    private func makeURL(_ path: String) -> URL {
        guard let qIdx = path.firstIndex(of: "?") else {
            return base.appending(path: path)
        }
        let rawPath = String(path[path.startIndex..<qIdx])
        let rawQuery = String(path[path.index(after: qIdx)...])
        guard var comps = URLComponents(url: base.appending(path: rawPath),
                                        resolvingAgainstBaseURL: false) else {
            return base.appending(path: path)
        }
        comps.percentEncodedQuery = rawQuery
        return comps.url ?? base.appending(path: rawPath)
    }

    private func send<B: Encodable, T: Decodable>(_ path: String, method: String, body: B?, as: T.Type) async throws -> T {
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(AppConfig.appOrigin, forHTTPHeaderField: "X-App-Origin")
        if let token = await AuthManager.shared.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body, !(body is EmptyBody) {
            req.httpBody = try JSONEncoder().encode(body)
        }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: req) }
        catch { throw APIError.network("网络连接失败，请稍后重试") }

        let http = resp as! HTTPURLResponse
        let env: APIEnvelope<T>
        do { env = try JSONDecoder.api.decode(APIEnvelope<T>.self, from: data) }
        catch {
            if http.statusCode >= 400 {
                await handleAuthExpiredIfNeeded(status: http.statusCode)
                throw APIError.from(status: http.statusCode, message: nil)
            }
            throw APIError.network("数据解析失败")
        }
        guard http.statusCode < 400, env.ok, let value = env.data else {
            await handleAuthExpiredIfNeeded(status: http.statusCode)
            throw APIError.from(status: http.statusCode, message: env.error)
        }
        return value
    }

    /// 全局 401 处理：任意请求命中 401（token 失效）即触发本地登出，
    /// AuthManager 内部幂等（已登出则跳过），RootView 观察登录态自动回登录页。
    /// iOS / macOS 双端共享此逻辑。
    private func handleAuthExpiredIfNeeded(status: Int) async {
        guard status == 401 else { return }
        await AuthManager.shared.handleAuthExpired()
    }
}
