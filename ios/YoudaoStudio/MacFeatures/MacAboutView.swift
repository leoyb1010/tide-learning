// 「关于 有道自习室」窗内容。整文件仅 macOS 参与编译。
//
// M5「打磨与分发」：CommandGroup(replacing:.appInfo) 的「关于」按钮经 openWindow(id:"about")
// 打开本独立小窗，展示图标 / 名称 / 版本号 / 版权。
// 版本号读 Bundle.main CFBundleShortVersionString + CFBundleVersion（xcodegen 从 project.yml 注入）。
#if os(macOS)
import SwiftUI

struct MacAboutView: View {
    /// 展示版本：CFBundleShortVersionString（营销版本）+ build（CFBundleVersion）。
    private var versionText: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "版本 \(short)（\(build)）"
    }

    /// 版权：读 Info.plist NSHumanReadableCopyright，缺省兜底。
    private var copyrightText: String {
        (Bundle.main.infoDictionary?["NSHumanReadableCopyright"] as? String) ?? "© 有道自习室"
    }

    var body: some View {
        VStack(spacing: 16) {
            // 应用图标：优先取 NSApp.applicationIconImage（catalog 若配了 Mac 图标就用它），
            // 兜底用品牌红书本 SF Symbol，保证无图标时也有像样呈现。
            appIcon
                .frame(width: 96, height: 96)

            VStack(spacing: 4) {
                Text("有道自习室")
                    .font(.studio(20, .bold))
                    .foregroundStyle(Studio.ink)
                Text("STUDIO · macOS")
                    .font(.mono(11, .bold))
                    .foregroundStyle(Studio.ink4)
                    .tracking(3)
            }

            Text(versionText)
                .font(.studio(13, .medium))
                .foregroundStyle(Studio.ink3)

            Spacer(minLength: 0)

            Text(copyrightText)
                .font(.studio(11))
                .foregroundStyle(Studio.ink4)
        }
        .padding(28)
        .frame(width: 320, height: 300)
        .background(Studio.bg)
    }

    @ViewBuilder
    private var appIcon: some View {
        if let icon = NSApp.applicationIconImage {
            Image(nsImage: icon)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Studio.videoGradient)
                .overlay(
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(Studio.red)
                )
        }
    }
}
#endif
