import SwiftUI
import Observation

// MARK: - DTO

/// GET /api/account/export 导出笔记结果（后端返回可下载文本/JSON 字符串或计数）。
private struct ExportResult: Decodable {
    let count: Int
    let text: String? // 可选：后端直接回传导出文本
}

/// 注销账号请求体。POST /api/account/delete { password }
private struct DeleteAccountBody: Encodable {
    let password: String
}

// MARK: - Preferences store

/// 本地偏好：深色跟随系统 / 字号。存 UserDefaults，@Observable 供 UI 绑定。
@Observable @MainActor
final class SettingsPreferences {
    static let shared = SettingsPreferences()

    private let dFollowSystem = "pref_followSystemAppearance"
    private let dFontScale = "pref_fontScale"

    var followSystemAppearance: Bool {
        didSet { UserDefaults.standard.set(followSystemAppearance, forKey: dFollowSystem) }
    }
    /// 字号档位：small/standard/large，用倍率表示（0.9 / 1.0 / 1.15）。
    var fontScale: Double {
        didSet { UserDefaults.standard.set(fontScale, forKey: dFontScale) }
    }

    private init() {
        let ud = UserDefaults.standard
        // 首次默认：跟随系统开、标准字号。
        followSystemAppearance = ud.object(forKey: dFollowSystem) as? Bool ?? true
        fontScale = ud.object(forKey: dFontScale) as? Double ?? 1.0
    }
}

// MARK: - ViewModel

@Observable @MainActor
final class SettingsViewModel {
    // 注销账号弹窗
    var showDeleteSheet = false
    var deletePassword = ""
    var deleting = false
    var deleteError: String?

    // 导出笔记
    var exporting = false
    var exportError: String?
    var exportedText: String?
    var showExportSheet = false

    // 退出登录
    var loggingOut = false

    /// POST /api/account/delete —— 需二次输密码。成功后本地登出。
    func deleteAccount(auth: AuthManager) async {
        guard !deletePassword.isEmpty else { deleteError = "请输入当前密码"; return }
        deleting = true; deleteError = nil
        defer { deleting = false }
        do {
            _ = try await API.shared.post("/api/account/delete",
                                          body: DeleteAccountBody(password: deletePassword),
                                          as: EmptyResponse.self)
            deletePassword = ""
            showDeleteSheet = false
            await auth.logoutLocal()
        } catch {
            deleteError = (error as? APIError)?.errorDescription ?? "注销失败，请重试"
        }
    }

    /// GET /api/account/export —— 拉取导出内容。
    func exportNotes() async {
        exporting = true; exportError = nil
        defer { exporting = false }
        do {
            let res = try await API.shared.get("/api/account/export", as: ExportResult.self)
            exportedText = res.text ?? "已导出 \(res.count) 条笔记。"
            showExportSheet = true
        } catch {
            exportError = (error as? APIError)?.errorDescription ?? "导出失败，请重试"
        }
    }

    func logout(auth: AuthManager) async {
        loggingOut = true
        defer { loggingOut = false }
        await auth.logout()
    }
}

// MARK: - View

/// 完整设置中心（settings 模块）。命名为 AppSettingsView 以避免与
/// Features/Profile/SettingsView.swift（另一 agent 的精简版）在同一 target 内重名。
struct AppSettingsView: View {
    @Environment(AuthManager.self) private var auth
    @State private var vm = SettingsViewModel()
    @State private var prefs = SettingsPreferences.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    accountSection
                    subscriptionSection
                    preferenceSection
                    privacySection
                    helpSection
                    logoutSection
                    footer
                }
                .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
        }
        // 注销账号确认弹窗
        .sheet(isPresented: $vm.showDeleteSheet) {
            DeleteAccountSheet(vm: vm)
                .presentationDetents([.medium])
        }
        // 导出结果弹窗
        .sheet(isPresented: $vm.showExportSheet) {
            ExportSheet(text: vm.exportedText ?? "")
        }
        .onChange(of: vm.showExportSheet) { _, shown in
            if shown { Haptics.success() }
        }
        .onChange(of: vm.exportError) { _, new in
            if new != nil { Haptics.error() }
        }
    }

    // MARK: Sections

    private var accountSection: some View {
        section("账号安全") {
            NavigationLink { ChangePasswordView() } label: {
                row(icon: "lock.rotation", title: "修改密码", chevron: true)
                    .studioCard(padding: 0)
                    .pressable()
            }
            .buttonStyle(.plain)
        }
    }

    private var subscriptionSection: some View {
        section("订阅与积分") {
            NavigationLink { SubscriptionView() } label: {
                row(icon: "crown.fill", title: "订阅与积分", subtitle: "查看会员状态、升级套餐", chevron: true)
                    .studioCard(padding: 0)
                    .pressable()
            }
            .buttonStyle(.plain)
        }
    }

    private var preferenceSection: some View {
        section("偏好") {
            VStack(spacing: 0) {
                Toggle(isOn: $prefs.followSystemAppearance) {
                    rowLabel(icon: "circle.lefthalf.filled", title: "深色跟随系统")
                }
                .tint(Studio.red)
                .padding(.vertical, 12).padding(.horizontal, 14)
                .onChange(of: prefs.followSystemAppearance) { _, _ in Haptics.selection() }

                Divider().background(Studio.border)

                VStack(alignment: .leading, spacing: 10) {
                    rowLabel(icon: "textformat.size", title: "字号")
                    Picker("字号", selection: $prefs.fontScale) {
                        Text("小").tag(0.9)
                        Text("标准").tag(1.0)
                        Text("大").tag(1.15)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: prefs.fontScale) { _, _ in Haptics.selection() }
                }
                .padding(.vertical, 12).padding(.horizontal, 14)
            }
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
        }
    }

    private var privacySection: some View {
        section("隐私与数据") {
            VStack(spacing: 0) {
                Button {
                    Haptics.light()
                    Task { await vm.exportNotes() }
                } label: {
                    row(icon: "square.and.arrow.up", title: "导出笔记",
                        subtitle: "打包我的全部笔记", trailing: vm.exporting ? .loading : .idle)
                }
                .buttonStyle(.plain)
                .disabled(vm.exporting)

                Divider().background(Studio.border).padding(.leading, 14)

                Button {
                    Haptics.warning()
                    vm.deleteError = nil
                    vm.deletePassword = ""
                    vm.showDeleteSheet = true
                } label: {
                    row(icon: "trash", title: "注销账号",
                        subtitle: "永久删除账号与数据", destructive: true, chevron: true)
                }
                .buttonStyle(.plain)
            }
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))

            if let err = vm.exportError {
                Text(err).font(.studio(12)).foregroundStyle(Studio.redInk).padding(.horizontal, 4)
            }
        }
    }

    private var helpSection: some View {
        section("帮助") {
            VStack(spacing: 0) {
                NavigationLink { AboutView() } label: {
                    row(icon: "info.circle", title: "关于", chevron: true)
                }
                .buttonStyle(.plain)

                Divider().background(Studio.border).padding(.leading, 14)

                NavigationLink { TermsView() } label: {
                    row(icon: "doc.text", title: "服务条款", chevron: true)
                }
                .buttonStyle(.plain)
            }
            .background(Studio.surface)
            .clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous).strokeBorder(Studio.border, lineWidth: 1))
        }
    }

    private var logoutSection: some View {
        StudioButton(title: "退出登录", kind: .ghost, loading: vm.loggingOut) {
            Task { await vm.logout(auth: auth) }
        }
        .padding(.top, 4)
    }

    private var footer: some View {
        HStack {
            Spacer()
            VStack(spacing: 4) {
                Text("有道自习室").font(.studio(12, .semibold)).foregroundStyle(Studio.ink3)
                Text("v\(appVersion)").font(.mono(11)).foregroundStyle(Studio.ink4)
            }
            Spacer()
        }
        .padding(.top, 8)
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }

    // MARK: Building blocks

    @ViewBuilder
    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.studio(13, .semibold)).foregroundStyle(Studio.ink3)
                .padding(.horizontal, 4)
            content()
        }
    }

    private enum RowTrailing { case idle, loading }

    private func row(icon: String, title: String, subtitle: String? = nil,
                     destructive: Bool = false, trailing: RowTrailing = .idle,
                     chevron: Bool = false) -> some View {
        HStack(spacing: 12) {
            iconTile(icon, destructive: destructive)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.studio(15, .medium))
                    .foregroundStyle(destructive ? Studio.redInk : Studio.ink)
                if let subtitle {
                    Text(subtitle).font(.studio(12)).foregroundStyle(Studio.ink3)
                }
            }
            Spacer()
            switch trailing {
            case .loading: ProgressView().controlSize(.small).tint(Studio.ink3)
            case .idle: EmptyView()
            }
            if chevron {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Studio.ink4)
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 14)
        .contentShape(Rectangle())
    }

    private func rowLabel(icon: String, title: String) -> some View {
        HStack(spacing: 12) {
            iconTile(icon)
            Text(title).font(.studio(15, .medium)).foregroundStyle(Studio.ink)
        }
    }

    /// 分区图标磁贴：柔色底衬（危险=redSoft），提升层次。
    private func iconTile(_ icon: String, destructive: Bool = false) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(destructive ? Studio.redSoft : Studio.surface2)
                .frame(width: 30, height: 30)
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(destructive ? Studio.redInk : Studio.ink2)
        }
    }
}

// MARK: - Delete account sheet

private struct DeleteAccountSheet: View {
    @Bindable var vm: SettingsViewModel
    @Environment(AuthManager.self) private var auth
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(Studio.redSoft).frame(width: 44, height: 44)
                        Image(systemName: "trash.fill").font(.system(size: 18)).foregroundStyle(Studio.red)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("注销账号").font(.studio(20, .bold)).foregroundStyle(Studio.ink)
                        Text("永久删除，无法恢复").font(.studio(12, .medium)).foregroundStyle(Studio.redInk)
                    }
                }

                Text("此操作将永久删除你的账号、课程与笔记。请输入当前密码确认。")
                    .font(.studio(13)).foregroundStyle(Studio.ink3)

                SecureField("当前密码", text: $vm.deletePassword)
                    .font(.studio(15)).foregroundStyle(Studio.ink)
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .background(Studio.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Studio.border, lineWidth: 1))
                    .textContentType(.password)

                if let err = vm.deleteError {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12))
                        Text(err).font(.studio(12))
                    }
                    .foregroundStyle(Studio.redInk)
                }

                StudioButton(title: "确认注销", kind: .red, loading: vm.deleting) {
                    Task { await vm.deleteAccount(auth: auth) }
                }

                StudioButton(title: "取消", kind: .ghost) { Haptics.light(); dismiss() }

                Spacer()
            }
            .padding(20)
            .background(Studio.bg)
            .onChange(of: vm.deleteError) { _, new in
                if new != nil { Haptics.error() }
            }
        }
    }
}

// MARK: - Export sheet

private struct ExportSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text.isEmpty ? "暂无可导出的内容" : text)
                    .font(.mono(12))
                    .foregroundStyle(Studio.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(16)
            }
            .background(Studio.bg)
            .navigationTitle("导出笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if !text.isEmpty {
                        ShareLink(item: text) { Image(systemName: "square.and.arrow.up") }
                            .tint(Studio.red)
                            .accessibilityLabel("分享导出内容")
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭") { dismiss() }.tint(Studio.ink2)
                }
            }
        }
    }
}

// MARK: - About / Terms (static help pages)

private struct AboutView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("有道自习室").font(.studio(22, .bold)).foregroundStyle(Studio.ink)
                Text("STUDIO").font(.mono(11, .bold)).foregroundStyle(Studio.ink4).tracking(3)
                Text("专注的 AI 自习室。造课、学习、记笔记、复习，一处完成。")
                    .font(.studio(14)).foregroundStyle(Studio.ink2)
                Divider().background(Studio.border)
                labeled("版本", value: version)
                labeled("开发", value: "有道 STUDIO 团队")
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(Studio.bg)
        .navigationTitle("关于")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        return v
    }

    private func labeled(_ k: String, value: String) -> some View {
        HStack {
            Text(k).font(.studio(14)).foregroundStyle(Studio.ink3)
            Spacer()
            Text(value).font(.mono(13)).foregroundStyle(Studio.ink)
        }
    }
}

private struct TermsView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("服务条款").font(.studio(20, .bold)).foregroundStyle(Studio.ink)
                Text("欢迎使用有道自习室。使用本应用即表示你同意以下条款：")
                    .font(.studio(14)).foregroundStyle(Studio.ink2)
                clause("1. 账号", "你需对账号下的一切活动负责，请妥善保管密码。")
                clause("2. 内容", "你在应用内创建的课程与笔记归你所有；请勿上传违法内容。")
                clause("3. 订阅", "会员订阅通过 App Store 计费，可在系统设置中管理与取消。")
                clause("4. 隐私", "我们仅收集为提供服务所必需的数据，详见隐私政策。")
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(Studio.bg)
        .navigationTitle("服务条款")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func clause(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
            Text(body).font(.studio(13)).foregroundStyle(Studio.ink2)
        }
    }
}
