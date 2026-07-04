import SwiftUI

/// 设置页：账号信息 + 会员/积分入口 + 退出登录。
struct SettingsView: View {
    @Environment(AuthManager.self) private var auth
    @State private var loggingOut = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                accountSection
                aboutSection
                logoutButton
            }
            .padding(16)
        }
        .background(Studio.bg)
        .navigationTitle("设置")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: 账号

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("账号")
            VStack(spacing: 0) {
                settingRow(icon: "person.crop.circle", title: "昵称", value: auth.user?.nickname ?? "未设置")
                divider
                settingRow(
                    icon: "number",
                    title: "学号",
                    value: ProfileDerive.studentNumber(from: auth.user?.id ?? "guest"),
                    mono: true
                )
                if let role = auth.user?.role, !role.isEmpty {
                    divider
                    settingRow(icon: "checkmark.seal", title: "身份", value: role)
                }
            }
            .studioCard(padding: 4)
        }
    }

    // MARK: 关于

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("关于")
            VStack(spacing: 0) {
                settingRow(icon: "info.circle", title: "版本", value: appVersion, mono: true)
                divider
                settingRow(icon: "building.columns", title: "有道自习室", value: "STUDIO")
            }
            .studioCard(padding: 4)
        }
    }

    // MARK: 退出登录

    private var logoutButton: some View {
        StudioButton(title: "退出登录", kind: .ghost, loading: loggingOut) {
            Task {
                loggingOut = true
                await auth.logout()
                loggingOut = false
            }
        }
        .padding(.top, 8)
    }

    // MARK: 通用行

    private func settingRow(icon: String, title: String, value: String, mono: Bool = false) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Studio.surface2).frame(width: 30, height: 30)
                Image(systemName: icon).font(.system(size: 14, weight: .medium)).foregroundStyle(Studio.ink2)
            }
            Text(title).font(.studio(15, .medium)).foregroundStyle(Studio.ink)
            Spacer()
            Text(value)
                .font(mono ? .mono(13, .semibold) : .studio(14))
                .foregroundStyle(Studio.ink2)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
    }

    private var divider: some View {
        Divider().overlay(Studio.border).padding(.leading, 54)
    }

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.studio(13, .semibold)).foregroundStyle(Studio.ink3)
            .padding(.leading, 4)
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }
}
