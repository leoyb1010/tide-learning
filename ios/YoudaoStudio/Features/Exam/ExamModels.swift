import Foundation

// MARK: - 出卷入参 / 出卷响应

/// POST /api/ai/generate-exam 入参。
/// scopeType: "all" 全部课程 | "course" 指定课程（需 scopeId）。
struct GenerateExamRequest: Encodable {
    let scopeType: String
    let scopeId: String?
    let count: Int
    let difficulty: String
}

/// 出卷响应：拿到 examId 后再去 GET 试卷。
struct GenerateExamResponse: Decodable {
    let examId: String
    let count: Int
}

// MARK: - 试卷（无 answer，防作弊）

/// 题型。后端下发字符串 single/judge/short。
enum ExamQuestionType: String, Decodable {
    case single   // 单选
    case judge    // 判断
    case short    // 简答

    var label: String {
        switch self {
        case .single: return "单选题"
        case .judge:  return "判断题"
        case .short:  return "简答题"
        }
    }
}

/// GET /api/exams/[examId] 返回的整卷。
struct ExamPaper: Decodable {
    let examId: String
    let title: String
    let questions: [ExamQuestion]
}

/// 单题。options 仅单选题有。
struct ExamQuestion: Decodable, Identifiable {
    let id: String
    let type: ExamQuestionType
    let stem: String
    let options: [String]?
}

// MARK: - 交卷 / 成绩单

/// POST /api/exams/[examId]/submit 入参：{answers:{questionId:answer}}。
/// judge 题 answer 约定为 "true"/"false" 字符串，与单选/简答统一走 String。
struct SubmitExamRequest: Encodable {
    let answers: [String: String]
}

/// 成绩单。
struct ExamResult: Decodable {
    let score: Int
    let total: Int
    let review: [ExamReviewItem]

    /// 正确率（0...1）。total 为 0 时返回 0，避免除零。
    var accuracy: Double {
        guard total > 0 else { return 0 }
        return Double(score) / Double(total)
    }
    var accuracyPct: Int { Int((accuracy * 100).rounded()) }
}

/// 逐题回顾条目。字段容错为可选，后端不同题型下发不全。
/// 注意：后端「正确答案」字段名为 `answer`（非 `correctAnswer`），此处映射对齐。
struct ExamReviewItem: Decodable, Identifiable {
    let id: String
    let type: ExamQuestionType
    let correct: Bool
    let score: Int
    let max: Int
    let stem: String?
    let userAnswer: String?
    let correctAnswer: String?
    let explanation: String?
    let options: [String]?

    private enum CodingKeys: String, CodingKey {
        case id, type, correct, score, max, stem, userAnswer, explanation, options
        case correctAnswer = "answer"   // 后端字段名为 answer
    }
}

// MARK: - 课程范围选择（入口表单用）

/// 供出卷范围选择的轻量课程项。对齐后端 /api/courses camelCase；
/// 字段做最小假设并容错，避免与 Courses 模块耦合。
struct ExamScopeCourse: Decodable, Identifiable {
    let id: String
    let title: String

    private enum CodingKeys: String, CodingKey {
        case id, courseId, slug
        case title, name
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // id 兼容 id / courseId / slug
        if let v = try? c.decode(String.self, forKey: .id) { id = v }
        else if let v = try? c.decode(String.self, forKey: .courseId) { id = v }
        else if let v = try? c.decode(String.self, forKey: .slug) { id = v }
        else { id = UUID().uuidString }
        // title 兼容 title / name
        if let v = try? c.decode(String.self, forKey: .title) { title = v }
        else if let v = try? c.decode(String.self, forKey: .name) { title = v }
        else { title = "未命名课程" }
    }
}
