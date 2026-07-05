// Mac 侧边栏项定义。对齐 iOS 底部 5 Tab（书桌/课程/造课/笔记/我的），
// rawValue 与 TabRouter.selection 语义一致（0-4），便于跨屏跳转复用。
#if os(macOS)
import SwiftUI

/// 侧边栏分区。rawValue 对齐 MainTabView tag / TabRouter.selection（0书桌…4我的）。
enum MacSection: Int, CaseIterable, Identifiable, Hashable {
    case desk = 0      // 书桌
    case courses = 1   // 课程
    case create = 2    // 造课
    case notes = 3     // 笔记
    case profile = 4   // 我的

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .desk: "书桌"
        case .courses: "课程"
        case .create: "造课"
        case .notes: "笔记"
        case .profile: "我的"
        }
    }

    var icon: String {
        switch self {
        case .desk: "house.fill"
        case .courses: "safari.fill"
        case .create: "sparkles"
        case .notes: "square.and.pencil"
        case .profile: "person.fill"
        }
    }
}

/// 侧边栏列表：List(selection:) 驱动 detail 渲染。
struct MacSidebar: View {
    @Binding var selection: MacSection

    var body: some View {
        List(selection: $selection) {
            Section {
                ForEach(MacSection.allCases) { section in
                    Label(section.title, systemImage: section.icon)
                        .font(.studio(14, .medium))
                        .tag(section)
                }
            } header: {
                Text("有道自习室")
                    .font(.studio(13, .bold))
                    .foregroundStyle(Studio.ink2)
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
    }
}
#endif
