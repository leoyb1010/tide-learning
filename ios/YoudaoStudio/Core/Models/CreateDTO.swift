import Foundation

// 造课 / 导入相关 DTO（Core：iOS Features 与 Mac 造课/导入窗共用，避免各写一份）。

/// POST /api/ai/generate-course | import-source | import-file 返回。
struct GeneratedCourse: Decodable {
    let courseId: String
    let slug: String
    let lessons: [GeneratedLesson]
    /// 导入接口附带（可选）：真实课名 / 抽取字数。AI 生成接口不返回，解为 nil。
    let title: String?
    let charCount: Int?
}

/// 大纲里的单节。
struct GeneratedLesson: Decodable, Identifiable {
    let id: String
    let title: String
}

/// POST /api/ai/generate-lesson 返回（统计用于完成页；缺省兜底）。
struct GeneratedLessonResult: Decodable {
    let lessonId: String?
    let quizCount: Int?
}

/// GET /api/ai/models：可选模型（按订阅态过滤）+ 全部课件模板。
struct AiModelsResponse: Decodable {
    struct Model: Decodable, Identifiable {
        let key, label, desc, tier: String
        let costWeight: Double
        var id: String { key }
    }
    struct LockedModel: Decodable, Identifiable {
        let key, label, desc: String
        var id: String { key }
    }
    struct Template: Decodable, Identifiable {
        let key, label, tagline, icon, recommendedFor: String
        var id: String { key }
    }
    let models: [Model]
    let lockedModels: [LockedModel]
    /// 默认模型 key。服务端在「无可用模型（env 未配 key）」时返回 null，故为可选。
    let defaultModel: String?
    let templates: [Template]
    let defaultTemplate: String
    let isSubscriber: Bool
}
