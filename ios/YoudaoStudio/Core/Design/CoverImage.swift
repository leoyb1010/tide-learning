import SwiftUI

/// 课程封面（v3.2 对齐 Web 真实封面）：优先服务端 coverSrc 真图，加载失败/缺省回落赛道渐变。
///
/// 之前 iOS 一律画渐变（coverSrc 字段解码但没用）；接上后书架 / 集市 / 课程库全站换真图，
/// 用户造课/导入课的新封面池也自动生效。渐变始终作为占位骨架与兜底，断网不白屏。
/// Core 组件，iOS 与 Mac 两端共用。
struct CoverImage: View {
    let coverSrc: String?
    let category: String?
    var cornerRadius: CGFloat = 12

    private var url: URL? {
        guard let src = coverSrc, !src.isEmpty else { return nil }
        // coverSrc 是站内相对路径（/covers/...）；拼后端基址。已是绝对 URL 则直接用。
        if src.hasPrefix("http") { return URL(string: src) }
        return URL(string: AppConfig.apiBaseURL + src)
    }

    private var fallback: some View {
        Studio.trackGradient(Studio.trackKey(from: category))
    }

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url, transaction: .init(animation: .easeOut(duration: 0.2))) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    case .failure:
                        fallback
                    case .empty:
                        fallback  // 加载中用渐变骨架，不留空白
                    @unknown default:
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}
