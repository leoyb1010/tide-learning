import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// 分享卡片平台图类型：iOS=UIImage，macOS=NSImage。
#if canImport(UIKit)
typealias ShareImage = UIImage
#else
typealias ShareImage = NSImage
#endif

/// 分享卡片弹窗（v3.2 对齐 Web）：拉服务端出图（/api/share-card），预览 + 深/浅切换 + 保存/分享。
///
/// 之前原生端分享只发公开落地页链接（ShareLink URL）；现改为拉服务端渲染的 1080×1440 卡片图，
/// 与 Web 分享卡完全同款设计，且 Web 改版卡片双端自动同步（零客户端绘图）。
/// Core 组件：iOS 与 Mac 共用；平台差异（存相册 / 存文件）用 #if 收敛。
struct ShareCardSheet: View {
    /// 卡片种类：student-card | week-report | streak | exam-result | course-done | note-quote
    let kind: String
    /// 透传给出图服务的参数（如 examId / courseId / noteId）。
    var params: [String: String] = [:]
    /// 复制链接用的落地页（可空）。
    var shareUrl: URL?
    var title: String = "分享"

    @Environment(\.dismiss) private var dismiss
    @State private var theme = "dark"
    @State private var image: ShareImage?
    @State private var loading = true
    @State private var failed = false
    @State private var savedToast = false

    var body: some View {
        VStack(spacing: 16) {
            // 头
            HStack {
                Text(title).font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Studio.ink3)
                        .frame(width: 30, height: 30).background(Studio.surfaceInset).clipShape(Circle())
                }
                .buttonStyle(.plain)
            }

            // 深/浅切换
            Picker("主题", selection: $theme) {
                Text("深色").tag("dark")
                Text("浅色").tag("light")
            }
            .pickerStyle(.segmented)

            // 预览
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Studio.surfaceInset)
                if let image {
                    platformImage(image)
                        .resizable().scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                } else if failed {
                    Text("预览暂不可用").font(.studio(13)).foregroundStyle(Studio.ink3)
                } else {
                    ProgressView()
                }
            }
            .aspectRatio(1080.0 / 1440.0, contentMode: .fit)
            .frame(maxWidth: 320)

            // 动作
            VStack(spacing: 10) {
                if let image {
                    // 系统分享（iOS16+/macOS 直接分享 Image）
                    ShareLink(item: platformImage(image), preview: SharePreview(title, image: platformImage(image))) {
                        actionLabel("系统分享", "square.and.arrow.up")
                    }
                    .simultaneousGesture(TapGesture().onEnded { Haptics.light() })

                    Button {
                        saveImage(image)
                    } label: { actionLabel(savedToast ? "已保存" : saveActionTitle, savedToast ? "checkmark.circle.fill" : "square.and.arrow.down") }
                    .buttonStyle(.plain)
                }
                if let shareUrl {
                    Button {
                        copyLink(shareUrl)
                    } label: { actionLabel("复制链接", "link") }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(20)
        .frame(minWidth: 320)
        .background(Studio.bg)
        .task(id: theme) { await load() }
    }

    private var saveActionTitle: String {
        #if os(macOS)
        return "存为图片"
        #else
        return "保存到相册"
        #endif
    }

    private func actionLabel(_ text: String, _ icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold))
            Text(text).font(.studio(14, .semibold))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 11)
        .foregroundStyle(Studio.ink)
        .background(Studio.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))
    }

    private func platformImage(_ img: ShareImage) -> Image {
        #if canImport(UIKit)
        Image(uiImage: img)
        #else
        Image(nsImage: img)
        #endif
    }

    private func load() async {
        loading = true; failed = false
        var q = params
        q["theme"] = theme
        let query = q.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
            .joined(separator: "&")
        do {
            let data = try await API.shared.getData("/api/share-card/\(kind)?\(query)")
            if let img = ShareImage(data: data) {
                image = img
            } else {
                failed = true
            }
        } catch {
            failed = true
        }
        loading = false
    }

    private func copyLink(_ url: URL) {
        #if canImport(UIKit)
        UIPasteboard.general.string = url.absoluteString
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
        #endif
        Haptics.success()
    }

    private func saveImage(_ img: ShareImage) {
        #if os(macOS)
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = "\(kind).png"
        if panel.runModal() == .OK, let url = panel.url,
           let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: url)
            savedToast = true
        }
        #else
        UIImageWriteToSavedPhotosAlbum(img, nil, nil, nil)
        Haptics.success()
        savedToast = true
        #endif
    }
}
