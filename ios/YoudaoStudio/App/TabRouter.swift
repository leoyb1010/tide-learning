import SwiftUI
import Observation

/// 全局 Tab 路由 + 跨屏意图桥。
///
/// 纯客户端状态容器（无任何后端链）：持有底部 Tab 选中态，
/// 并承载「从书桌带一句需求跳到造课台」这类跨 Tab 意图。
/// 书桌「今天想学」写入 pendingCreatePrompt 并切到造课 Tab；
/// 造课台在出现时消费该意图，预填输入框。
///
/// Tab tag 对齐 MainTabView：0 书桌 / 1 课程 / 2 造课 / 3 笔记 / 4 我的。
@Observable @MainActor
final class TabRouter {
    /// 当前选中 Tab（0书桌/1课程/2造课/3笔记/4我的）。
    var selection: Int

    /// 待造课台消费的需求文案（书桌「今天想学」写入）。nil = 无待处理意图。
    var pendingCreatePrompt: String?

    init(selection: Int = 0) {
        self.selection = selection
    }

    /// 书桌「今天想学」→ 造课台：带一句需求切到造课 Tab，由造课台出现时预填。
    func startCreate(prompt: String? = nil) {
        let trimmed = prompt?.trimmingCharacters(in: .whitespacesAndNewlines)
        pendingCreatePrompt = (trimmed?.isEmpty == false) ? trimmed : nil
        selection = 2
    }

    /// 造课台消费待处理需求（取走后清空，避免重复预填）。
    func takePendingCreatePrompt() -> String? {
        defer { pendingCreatePrompt = nil }
        return pendingCreatePrompt
    }
}
