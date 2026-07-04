import SwiftUI

// MARK: - DTO（字段对齐后端 JSON camelCase）

/// 笔记来源。未知值兜底为 .manual，避免解码失败。
enum NoteSource: String, Decodable {
    case lesson, manual, ai_transform, link_import
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NoteSource(rawValue: raw) ?? .unknown
    }

    /// 来源标识文案（列表卡右侧小标）。
    var label: String {
        switch self {
        case .lesson: return "课时笔记"
        case .manual: return "独立笔记"
        case .ai_transform: return "AI 整理"
        case .link_import: return "链接导入"
        case .unknown: return "笔记"
        }
    }
}

/// 笔记形态。
enum NoteKind: String, Decodable {
    case text, capture, clip
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NoteKind(rawValue: raw) ?? .unknown
    }
}

/// 笔记所属课程（锚点）。
struct NoteCourseRef: Decodable, Hashable {
    let title: String
    let slug: String
}

/// 笔记所属课时。
struct NoteLessonRef: Decodable, Hashable {
    let title: String
}

/// 笔记标签（后端返回对象 {id,name,color}）。
struct NoteTag: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let color: String?
}

/// 列表/详情通用笔记模型。
struct Note: Decodable, Identifiable, Hashable {
    let id: String
    let courseId: String?
    let lessonId: String?
    let title: String?
    let excerpt: String?
    let contentMd: String?
    let source: NoteSource
    let kind: NoteKind
    let captureUrl: String?
    let pinned: Bool
    let notebookId: String?
    let createdAt: Date
    let updatedAt: Date
    let course: NoteCourseRef?
    let lesson: NoteLessonRef?
    let tags: [NoteTag]

    /// 展示标题：空 → "未命名"。
    var displayTitle: String {
        let t = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "未命名" : t
    }

    /// 来源标识：优先课程标题，否则来源标签。
    var sourceLabel: String {
        if let c = course { return c.title }
        return source.label
    }
}

/// GET /api/notes 返回体。
struct NotesResponse: Decodable {
    let notes: [Note]
    let groups: [NoteGroup]
}

/// 按课程分组（groups[]）。后端形态：{courseId, course:{title,slug}, items:[]}。
struct NoteGroup: Decodable, Identifiable, Hashable {
    let courseId: String
    let course: NoteCourseRef?
    let items: [Note]
    var id: String { courseId }

    /// 分组标题：优先课程标题。
    var courseTitle: String { course?.title ?? "未分类课程" }
    /// 分组内笔记（兼容旧引用名）。
    var notes: [Note] { items }
}

// MARK: - 相对时间

enum RelativeTime {
    private static let fmt: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "zh_Hans")
        f.unitsStyle = .short
        return f
    }()

    /// 相对当前时间的中文文案（如「3 分钟前」）。
    static func string(from date: Date) -> String {
        fmt.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Markdown 渲染

extension AttributedString {
    /// 宽松解析 Markdown（保留换行）。解析失败退化为纯文本。
    static func fromMarkdown(_ md: String) -> AttributedString {
        var opts = AttributedString.MarkdownParsingOptions()
        opts.interpretedSyntax = .inlineOnlyPreservingWhitespace
        if let s = try? AttributedString(markdown: md, options: opts) { return s }
        return AttributedString(md)
    }
}

// MARK: - 来源标识

extension NoteSource {
    /// 来源徽章语义色调 + 图标（课时=info / AI=红信号 / 链接=neutral / 独立=neutral）。
    var badgeTone: StatusBadge.Tone {
        switch self {
        case .lesson: return .info
        case .ai_transform: return .red
        case .link_import: return .neutral
        case .manual, .unknown: return .neutral
        }
    }

    var badgeIcon: String {
        switch self {
        case .lesson: return "book.closed.fill"
        case .ai_transform: return "sparkles"
        case .link_import: return "link"
        case .manual, .unknown: return "square.and.pencil"
        }
    }
}

// MARK: - 标签行

/// 水平滚动的标签 chips。
struct NoteTagRow: View {
    let tags: [NoteTag]
    var body: some View {
        if !tags.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(tags) { tag in
                        Text("#\(tag.name)")
                            .font(.mono(11, .medium))
                            .foregroundStyle(Studio.ink2)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Studio.surfaceInset)
                            .clipShape(Capsule())
                            .overlay(Capsule().strokeBorder(Studio.border, lineWidth: 0.5))
                    }
                }
            }
        }
    }
}

// MARK: - 笔记卡（列表/时间轴/画廊/课程/笔记本 复用）

/// 单条笔记卡片：标题 + excerpt + 来源标识 + 相对时间 + 标签。
/// 主内容卡 elevation:1，可点按压 .pressable()。
struct NoteCard: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                if note.pinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Studio.red)
                        .padding(.top, 2)
                }
                Text(note.displayTitle)
                    .font(.studio(15, .semibold))
                    .foregroundStyle(Studio.ink)
                    .lineLimit(2)
                Spacer(minLength: 0)
            }

            if let excerpt = note.excerpt, !excerpt.isEmpty {
                Text(excerpt)
                    .font(.studio(13))
                    .foregroundStyle(Studio.ink2)
                    .lineLimit(2)
            }

            NoteTagRow(tags: note.tags)

            HStack(spacing: 8) {
                // 来源徽章：语义色（课时蓝/AI红/独立中性），弃裸文字。
                StatusBadge(text: note.sourceLabel, icon: note.source.badgeIcon, tone: note.source.badgeTone)
                    .lineLimit(1)
                Text(RelativeTime.string(from: note.updatedAt))
                    .font(.mono(11))
                    .foregroundStyle(Studio.ink3)
                Spacer(minLength: 0)
                if let lesson = note.lesson {
                    Text(lesson.title)
                        .font(.mono(11))
                        .foregroundStyle(Studio.ink4)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(padding: 14)
        .pressable()
    }
}
