import SwiftUI

// AiModelsResponse DTO 已上移至 Core/Models/CreateDTO.swift（iOS/Mac 共用）。

// MARK: - 选择器

/// 造课「课件模板 + 生成模型」选择器（对齐 Web TemplateModelPicker）。
/// 数据由父 VM 拉取（GET /api/ai/models）后传入；选择态双向绑定，透传进生成请求体。
struct TemplateModelPicker: View {
    let templates: [AiModelsResponse.Template]
    let models: [AiModelsResponse.Model]
    let lockedModels: [AiModelsResponse.LockedModel]
    @Binding var template: String
    @Binding var model: String
    var onLockedTap: () -> Void = {}

    private var showModelRow: Bool { models.count > 1 || !lockedModels.isEmpty }
    private let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // 课件模板
            VStack(alignment: .leading, spacing: 10) {
                Text("课件模板").font(.mono(11, .bold)).foregroundStyle(Studio.ink3).tracking(1)
                LazyVGrid(columns: cols, spacing: 10) {
                    ForEach(templates) { t in
                        templateCard(t)
                    }
                }
            }

            // 生成模型（≥2 可选 或 有会员专享锁定项才显示）
            if showModelRow {
                VStack(alignment: .leading, spacing: 10) {
                    Text("生成模型").font(.mono(11, .bold)).foregroundStyle(Studio.ink3).tracking(1)
                    FlowLayoutSimple {
                        ForEach(models) { m in modelPill(m) }
                        ForEach(lockedModels) { m in lockedPill(m) }
                    }
                }
            }
        }
    }

    private func templateCard(_ t: AiModelsResponse.Template) -> some View {
        let active = (template.isEmpty ? "classic" : template) == t.key
        return Button {
            Haptics.selection()
            template = t.key
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                // 缩略图（服务端生图），失败回落 SF Symbol
                ZStack {
                    CoverImage(coverSrc: "/templates/template-\(t.key).jpg", category: nil, cornerRadius: 8)
                        .frame(height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    // 缩略图作背景；若加载失败 CoverImage 内部回落渐变，图标叠加保证辨识
                }
                .overlay(alignment: .topTrailing) {
                    if active {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 15)).foregroundStyle(Studio.red)
                            .padding(5)
                    }
                }
                Text(t.label)
                    .font(.studio(13, .semibold))
                    .foregroundStyle(active ? Studio.red : Studio.ink)
                Text(t.tagline)
                    .font(.studio(11)).foregroundStyle(Studio.ink4)
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.leading)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? Studio.redSoft : Studio.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(active ? Studio.red : Studio.border, lineWidth: active ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .pressable(scale: 0.97)
    }

    private func modelPill(_ m: AiModelsResponse.Model) -> some View {
        let active = (model.isEmpty ? models.first?.key : model) == m.key
        return Button {
            Haptics.selection()
            model = m.key
        } label: {
            HStack(spacing: 5) {
                if m.tier == "premium" { Image(systemName: "sparkles").font(.system(size: 11)) }
                Text(m.label).font(.studio(12.5, .medium))
                if m.costWeight > 1 {
                    Text("\(Int(m.costWeight))×").font(.mono(10)).opacity(0.7)
                }
            }
            .foregroundStyle(active ? Studio.red : Studio.ink3)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(active ? Studio.redSoft : Studio.surface2)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(active ? Studio.red : Studio.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func lockedPill(_ m: AiModelsResponse.LockedModel) -> some View {
        Button {
            Haptics.selection()
            onLockedTap()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "lock.fill").font(.system(size: 11))
                Text(m.label).font(.studio(12.5, .medium))
                Text("会员").font(.system(size: 10))
            }
            .foregroundStyle(Studio.ink4)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Studio.surface)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3]))
                .foregroundStyle(Studio.border2))
        }
        .buttonStyle(.plain)
    }
}

/// 极简自适应流式排布（模型胶囊用）：iOS17 无原生 flow，用自适应网格近似。
struct FlowLayoutSimple<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 8)], alignment: .leading, spacing: 8) {
            content
        }
    }
}
