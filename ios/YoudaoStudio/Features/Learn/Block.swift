import Foundation

/// ai_block 章节的内容块模型。
/// 后端 blocksJson 是一段 JSON 字符串：{ version, blocks: [ { type, ... } ] }。
/// 用自定义解码把不同 type 折叠成一个强类型 enum，视图侧 switch 渲染各自卡片。
enum Block: Identifiable, Equatable {
    case concept(id: String, title: String, body: String)
    case code(id: String, lang: String, code: String)
    case quiz(id: String, question: String, options: [String], answer: Int, explanation: String?)
    case keypoint(id: String, points: [String])
    case callout(id: String, tone: CalloutTone, text: String)
    /// 未知 type 的兜底，保证前向兼容不崩。
    case unknown(id: String, type: String)

    var id: String {
        switch self {
        case .concept(let id, _, _),
             .code(let id, _, _),
             .quiz(let id, _, _, _, _),
             .keypoint(let id, _),
             .callout(let id, _, _),
             .unknown(let id, _):
            return id
        }
    }
}

/// callout 语气 → 决定卡片配色/图标。
enum CalloutTone: String, Equatable {
    case info, warn, success, tip

    init(raw: String?) {
        self = CalloutTone(rawValue: (raw ?? "info").lowercased()) ?? .info
    }
}

// MARK: - 解码

/// blocksJson 顶层结构。
struct BlockDocument: Decodable {
    let version: Int
    let blocks: [Block]

    enum CodingKeys: String, CodingKey { case version, blocks }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 1
        var arr = try c.nestedUnkeyedContainer(forKey: .blocks)
        var out: [Block] = []
        var index = 0
        while !arr.isAtEnd {
            let raw = try arr.decode(RawBlock.self)
            out.append(raw.toBlock(fallbackIndex: index))
            index += 1
        }
        blocks = out
    }
}

/// 单个块的松散解码：所有字段可选，按 type 组装。
private struct RawBlock: Decodable {
    let type: String
    let id: String?
    let title: String?
    let body: String?
    let lang: String?
    let code: String?
    let question: String?
    let options: [String]?
    let answer: Int?
    let explanation: String?
    let points: [String]?
    let tone: String?
    let text: String?

    func toBlock(fallbackIndex: Int) -> Block {
        let bid = id ?? "\(type)-\(fallbackIndex)"
        switch type.lowercased() {
        case "concept":
            return .concept(id: bid, title: title ?? "", body: body ?? "")
        case "code":
            return .code(id: bid, lang: lang ?? "text", code: code ?? "")
        case "quiz":
            return .quiz(
                id: bid,
                question: question ?? "",
                options: options ?? [],
                answer: answer ?? 0,
                explanation: explanation
            )
        case "keypoint":
            return .keypoint(id: bid, points: points ?? [])
        case "callout":
            return .callout(id: bid, tone: CalloutTone(raw: tone), text: text ?? "")
        default:
            return .unknown(id: bid, type: type)
        }
    }
}

extension BlockDocument {
    /// 从后端 blocksJson 字符串解析。失败返回空 blocks，视图侧走空态。
    static func parse(_ jsonString: String?) -> BlockDocument {
        guard
            let jsonString,
            let data = jsonString.data(using: .utf8),
            let doc = try? JSONDecoder().decode(BlockDocument.self, from: data)
        else {
            return BlockDocument(version: 1, blocks: [])
        }
        return doc
    }

    /// 便捷构造（parse 兜底用）。
    private init(version: Int, blocks: [Block]) {
        self.version = version
        self.blocks = blocks
    }
}
