import Foundation

/// ai_block 章节的内容块模型。
/// 后端 blocksJson 是一段 JSON 字符串：{ version, blocks: [ { type, ... } ] }。
/// 用自定义解码把不同 type 折叠成一个强类型 enum，视图侧 switch 渲染各自卡片。
///
/// v3.0：块协议由 5 种扩展为 12 种，对齐 Web src/lib/blocks.ts 的 JSON 结构。
/// 基础 5 种（concept/code/quiz/keypoint/callout）保留；新增 7 种叙事+交互块。
enum Block: Identifiable, Equatable {
    // 基础 5 种
    case concept(id: String, title: String, body: String)
    case code(id: String, lang: String, code: String)
    case quiz(id: String, question: String, options: [String], answer: Int, explanation: String?)
    case keypoint(id: String, points: [String])
    case callout(id: String, tone: CalloutTone, text: String)
    // v3 新增 7 种
    /// 节首学习目标：本节你将学会。
    case objectives(id: String, items: [String])
    /// 场景引入/钩子：为什么学。
    case scene(id: String, title: String, markdown: String)
    /// 对话示例（口语课刚需）。
    case dialog(id: String, turns: [DialogTurn])
    /// 步骤教程。
    case steps(id: String, steps: [StepItem])
    /// 对比（误区 vs 正确）。
    case compare(id: String, title: String?, left: ComparePane, right: ComparePane)
    /// 例子/案例。
    case example(id: String, markdown: String)
    /// 内联翻转卡，可存复习。
    case flashcard(id: String, front: String, back: String)
    /// 节尾小结 + 下节预告钩子。
    case summary(id: String, markdown: String, next: String?)
    /// 未知 type 的兜底，保证前向兼容不崩。
    case unknown(id: String, type: String)

    var id: String {
        switch self {
        case .concept(let id, _, _),
             .code(let id, _, _),
             .quiz(let id, _, _, _, _),
             .keypoint(let id, _),
             .callout(let id, _, _),
             .objectives(let id, _),
             .scene(let id, _, _),
             .dialog(let id, _),
             .steps(let id, _),
             .compare(let id, _, _, _),
             .example(let id, _),
             .flashcard(let id, _, _),
             .summary(let id, _, _),
             .unknown(let id, _):
            return id
        }
    }
}

// MARK: - 子结构（对齐 Web 字段名）

/// dialog.turns[] 单轮：说话人 + 内容 + 可选注解。
struct DialogTurn: Equatable {
    let speaker: String
    let text: String
    let note: String?
}

/// steps.steps[] 单步：标题 + 可选细节。
struct StepItem: Equatable {
    let title: String
    let detail: String?
}

/// compare.left / compare.right 单栏：小标题 + 条目列表。
struct ComparePane: Equatable {
    let heading: String
    let items: [String]
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
            // 单块解码失败也不整包崩：跳过坏块，尽量往下走。
            if let raw = try? arr.decode(RawBlock.self) {
                out.append(raw.toBlock(fallbackIndex: index))
            } else {
                // 无法解码为 RawBlock（极端脏数据）：吞掉该元素避免死循环。
                _ = try? arr.decode(AnyCodable.self)
            }
            index += 1
        }
        blocks = out
    }
}

/// 单个块的松散解码：所有字段可选，按 type 组装。
/// 字段名对齐 Web（dialog.turns / steps.steps / compare.left.right / objectives.items 等）。
private struct RawBlock: Decodable {
    let type: String
    let id: String?
    // 基础块字段
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
    // v3 新增块字段
    let items: [String]?              // objectives.items
    let markdown: String?             // scene/example/summary.markdown
    let turns: [RawTurn]?             // dialog.turns
    let steps: [RawStep]?             // steps.steps
    let left: RawPane?               // compare.left
    let right: RawPane?              // compare.right
    let front: String?               // flashcard.front
    let back: String?                // flashcard.back
    let next: String?                // summary.next

    func toBlock(fallbackIndex: Int) -> Block {
        let bid = id ?? "\(type)-\(fallbackIndex)"
        switch type.lowercased() {
        // —— 基础 5 种 ——
        case "concept":
            return .concept(id: bid, title: title ?? "", body: body ?? markdown ?? "")
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
            return .callout(id: bid, tone: CalloutTone(raw: tone), text: text ?? markdown ?? "")
        // —— v3 新增 7 种 ——
        case "objectives":
            return .objectives(id: bid, items: cleaned(items))
        case "scene":
            return .scene(id: bid, title: title ?? "", markdown: markdown ?? body ?? "")
        case "dialog":
            let ts = (turns ?? [])
                .map { DialogTurn(speaker: $0.speaker ?? "", text: $0.text ?? "", note: nonEmpty($0.note)) }
                .filter { !$0.text.isEmpty }
            return .dialog(id: bid, turns: ts)
        case "steps":
            let ss = (steps ?? [])
                .map { StepItem(title: $0.title ?? "", detail: nonEmpty($0.detail)) }
                .filter { !$0.title.isEmpty }
            return .steps(id: bid, steps: ss)
        case "compare":
            let l = ComparePane(heading: left?.heading ?? "", items: cleaned(left?.items))
            let r = ComparePane(heading: right?.heading ?? "", items: cleaned(right?.items))
            return .compare(id: bid, title: nonEmpty(title), left: l, right: r)
        case "example":
            return .example(id: bid, markdown: markdown ?? body ?? text ?? "")
        case "flashcard":
            return .flashcard(id: bid, front: front ?? "", back: back ?? "")
        case "summary":
            return .summary(id: bid, markdown: markdown ?? body ?? "", next: nonEmpty(next))
        default:
            return .unknown(id: bid, type: type)
        }
    }

    /// 去空白项 + 过滤空串（对齐 Web clampStrArray 的过滤语义）。
    private func cleaned(_ arr: [String]?) -> [String] {
        (arr ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// 空/纯空白 → nil，便于视图侧 if-let 判空。
    private func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }
}

/// dialog.turns[] 原始解码。
private struct RawTurn: Decodable {
    let speaker: String?
    let text: String?
    let note: String?
}

/// steps.steps[] 原始解码。
private struct RawStep: Decodable {
    let title: String?
    let detail: String?
}

/// compare.left / compare.right 原始解码。
private struct RawPane: Decodable {
    let heading: String?
    let items: [String]?
}

/// 任意 JSON 值的占位解码：用于吞掉无法映射为 RawBlock 的脏元素，避免解码死循环。
private struct AnyCodable: Decodable {
    init(from decoder: Decoder) throws {
        // 消费掉一个值即可，不关心内容。
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { return }
        if (try? c.decode(Bool.self)) != nil { return }
        if (try? c.decode(Double.self)) != nil { return }
        if (try? c.decode(String.self)) != nil { return }
        if (try? c.decode([AnyCodable].self)) != nil { return }
        if (try? c.decode([String: AnyCodable].self)) != nil { return }
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
