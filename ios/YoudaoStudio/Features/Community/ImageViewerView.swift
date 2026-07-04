import SwiftUI

// MARK: - 全屏图片查看器（Lightbox 对齐 web v4.0）
//
// 对齐 src/components/Lightbox.tsx 的行为：
// · 全屏深色背景（scrim black/85 等价），沉浸放大。
// · 多图左右滑动切换（TabView .page，原生手势 + 底部圆点指示当前）。
// · 关闭：右上角关闭按钮 + 向下拖拽手势（iOS 原生退出习惯）。
// · 计数 i / n（多图才显示，与 web 一致）。
// · 图片 .scaledToFit（object-contain 等价），不裁切，深底居中。
// · 触觉：打开由调用方（fullScreenCover 触发点）给轻触觉；此处切换页给 selection 触觉。
// · 仅透传调用方给定的站内/mock url，不额外引外链。
//
// 用法（PostCard 内）：
//   .fullScreenCover(isPresented: $viewerShown) {
//       ImageViewerView(images: images, index: $viewerIndex)
//   }
struct ImageViewerView: View {
    let images: [String]
    @Binding var index: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 下拉退出的实时位移（跟手 + 背景随距离渐隐）。
    @State private var dragOffset: CGFloat = 0

    private var count: Int { images.count }

    /// 背景不透明度：随下拉距离衰减，给出「拉离」的物理反馈。
    private var scrimOpacity: Double {
        let progress = min(abs(dragOffset) / 320, 1)
        return 0.85 * (1 - progress * 0.55)
    }

    var body: some View {
        ZStack {
            // 深色背景（点击退出，随下拉渐隐）。
            Color.black.opacity(scrimOpacity)
                .ignoresSafeArea()
                .onTapGesture { close() }

            pager
                .offset(y: dragOffset)
                .gesture(dismissDrag)

            controls
        }
        .statusBarHidden(true)
        .transition(reduceMotion ? .identity : .opacity)
    }

    // MARK: 分页图片区

    private var pager: some View {
        TabView(selection: $index) {
            ForEach(Array(images.enumerated()), id: \.offset) { i, urlStr in
                zoomableImage(urlStr)
                    .tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
        // 页面切换轻触觉（对齐 iOS 原生浏览节奏）。
        .onChange(of: index) { _, _ in Haptics.selection() }
    }

    private func zoomableImage(_ urlStr: String) -> some View {
        Group {
            if let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFit()   // object-contain 等价
                    case .empty:
                        ProgressView().tint(.white.opacity(0.7))
                    case .failure:
                        failurePlaceholder
                    @unknown default:
                        failurePlaceholder
                    }
                }
            } else {
                failurePlaceholder
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var failurePlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "photo").font(.system(size: 34)).foregroundStyle(.white.opacity(0.4))
            Text("图片加载失败").font(.studio(13)).foregroundStyle(.white.opacity(0.5))
        }
    }

    // MARK: 覆盖控件（关闭 + 计数 + 圆点）

    private var controls: some View {
        VStack {
            // 顶部：计数（多图居中）+ 关闭按钮（右上，命中区 ≥44）。
            ZStack {
                if count > 1 {
                    Text("\(min(index, count - 1) + 1) / \(count)")
                        .font(.mono(13))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(.black.opacity(0.4), in: Capsule())
                }
                HStack {
                    Spacer()
                    Button { close() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(.black.opacity(0.4), in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("关闭")
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)

            Spacer()

            // 底部圆点指示器（多图才显示，与 web 一致）。
            if count > 1 {
                HStack(spacing: 8) {
                    ForEach(0..<count, id: \.self) { i in
                        Circle()
                            .fill(i == index ? Color.white : Color.white.opacity(0.4))
                            .frame(width: i == index ? 8 : 6, height: i == index ? 8 : 6)
                            .animation(reduceMotion ? nil : StudioMotion.quick, value: index)
                    }
                }
                .padding(.bottom, 28)
            }
        }
    }

    // MARK: 下拉退出手势

    private var dismissDrag: some Gesture {
        DragGesture()
            .onChanged { value in
                // 仅响应竖向为主的下拉，避免与 TabView 横向翻页冲突。
                guard value.translation.height > 0,
                      abs(value.translation.height) > abs(value.translation.width) else { return }
                dragOffset = value.translation.height
            }
            .onEnded { value in
                if value.translation.height > 120 {
                    close()
                } else {
                    withAnimation(reduceMotion ? nil : StudioMotion.spring) { dragOffset = 0 }
                }
            }
    }

    private func close() {
        Haptics.light()
        dismiss()
    }
}
