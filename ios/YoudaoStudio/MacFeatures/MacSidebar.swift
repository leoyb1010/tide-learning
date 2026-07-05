// Mac 侧边栏项定义。前 5 项对齐 iOS 底部 5 Tab（书桌/课程/造课/笔记/我的），
// rawValue 与 TabRouter.selection 语义一致（0-4），便于跨屏跳转复用。
// 5/6/7 为 Mac 专属项（集市/复习/考试）——iOS TabRouter 从不读这些值，不影响 iOS。
#if os(macOS)
import SwiftUI

/// 侧边栏分区。
/// rawValue：0-4 对齐 MainTabView tag / TabRouter.selection（书桌…我的，iOS 复用）；
/// 5-7 为 Mac 专属（集市/复习/考试），仅桌面侧栏可达，写回 router.selection 亦安全
/// （iOS 只在 0-4 取用，越界值不渲染任何 iOS Tab）。
enum MacSection: Int, CaseIterable, Identifiable, Hashable {
    case desk = 0      // 书桌
    case courses = 1   // 课程
    case create = 2    // 造课
    case notes = 3     // 笔记
    case profile = 4   // 我的
    case market = 5    // 集市（Mac 专属）
    case review = 6    // 复习（Mac 专属）
    case exam = 7      // 考试（Mac 专属）

    var id: Int { rawValue }

    /// 主分组（对齐 iOS 5 Tab）。
    static let primary: [MacSection] = [.desk, .courses, .create, .notes, .profile]
    /// 学习分组（Mac 专属功能）。
    static let study: [MacSection] = [.market, .review, .exam]

    var title: String {
        switch self {
        case .desk: "书桌"
        case .courses: "课程"
        case .create: "造课"
        case .notes: "笔记"
        case .profile: "我的"
        case .market: "集市"
        case .review: "复习"
        case .exam: "考试"
        }
    }

    var icon: String {
        switch self {
        case .desk: "house.fill"
        case .courses: "safari.fill"
        case .create: "sparkles"
        case .notes: "square.and.pencil"
        case .profile: "person.fill"
        case .market: "bag.fill"
        case .review: "rectangle.stack.fill"
        case .exam: "checklist"
        }
    }
}

/// 侧边栏列表：List(selection:) 驱动 detail 渲染。分两组：主功能 + 学习。
struct MacSidebar: View {
    @Binding var selection: MacSection

    var body: some View {
        List(selection: $selection) {
            Section {
                ForEach(MacSection.primary) { section in
                    Label(section.title, systemImage: section.icon)
                        .font(.studio(14, .medium))
                        .tag(section)
                }
            } header: {
                Text("有道自习室")
                    .font(.studio(13, .bold))
                    .foregroundStyle(Studio.ink2)
            }
            Section {
                ForEach(MacSection.study) { section in
                    Label(section.title, systemImage: section.icon)
                        .font(.studio(14, .medium))
                        .tag(section)
                }
            } header: {
                Text("学习")
                    .font(.studio(12, .bold))
                    .foregroundStyle(Studio.ink3)
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
    }
}
#endif
