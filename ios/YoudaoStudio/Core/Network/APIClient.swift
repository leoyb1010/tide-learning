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

    /// 组装带鉴权头（Bearer + X-App-Origin）的请求。upload/getData 与 send 共用，保证鉴权一致。
    private func authorizedRequest(_ path: String, method: String) async -> URLRequest {
        var req = URLRequest(url: makeURL(path))
        req.httpMethod = method
        req.setValue(AppConfig.appOrigin, forHTTPHeaderField: "X-App-Origin")
        if let token = await AuthManager.shared.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    private func send<B: Encodable, T: Decodable>(_ path: String, method: String, body: B?, as: T.Type) async throws -> T {
        var req = await authorizedRequest(path, method: method)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body, !(body is EmptyBody) {
            req.httpBody = try JSONEncoder().encode(body)
        }
        return try await run(req, as: T.self)
    }

    /// 执行请求并解码统一信封。send/upload 共用。
    private func run<T: Decodable>(_ req: URLRequest, as: T.Type) async throws -> T {
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

    /// multipart/form-data 上传（造课文件导入用；未来笔记截图/头像上传复用）。
    /// 文件字段名固定 `file`；其余标量字段走 `fields`。响应仍是统一信封。
    func upload<T: Decodable>(_ path: String, fileData: Data, fileName: String, mimeType: String,
                             fields: [String: String] = [:], as: T.Type) async throws -> T {
        let boundary = "tide-\(UUID().uuidString)"
        var body = Data()
        for (k, v) in fields {
            body.appendString("--\(boundary)\r\n")
            body.appendString("Content-Disposition: form-data; name=\"\(k)\"\r\n\r\n")
            body.appendString("\(v)\r\n")
        }
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n")
        body.appendString("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        body.appendString("\r\n--\(boundary)--\r\n")

        var req = await authorizedRequest(path, method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        return try await run(req, as: T.self)
    }

    /// 带鉴权拉二进制（分享图 PNG 用）：返回原始 Data，非信封。4xx/5xx 折叠为 APIError。
    func getData(_ path: String) async throws -> Data {
        let req = await authorizedRequest(path, method: "GET")
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: req) }
        catch { throw APIError.network("网络连接失败，请稍后重试") }
        let http = resp as! HTTPURLResponse
        guard http.statusCode < 400 else {
            await handleAuthExpiredIfNeeded(status: http.statusCode)
            throw APIError.from(status: http.statusCode, message: nil)
        }
        return data
    }

    /// 全局 401 处理：任意请求命中 401（token 失效）即触发本地登出，
    /// AuthManager 内部幂等（已登出则跳过），RootView 观察登录态自动回登录页。
    /// iOS / macOS 双端共享此逻辑。
    private func handleAuthExpiredIfNeeded(status: Int) async {
        guard status == 401 else { return }
        await AuthManager.shared.handleAuthExpired()
    }
}

private extension Data {
    /// multipart 拼装用：追加 UTF-8 字符串。
    mutating func appendString(_ s: String) {
        if let d = s.data(using: .utf8) { append(d) }
    }
}
