import SwiftUI
import Observation

// MARK: - ViewModel

@Observable @MainActor
final class ProfileViewModel {
    var gamification: GamificationData?
    var credits: CreditsData?
    var entitlement: EntitlementData?
    var resumeList: [DeskData.Resume] = []
    var overview: MeOverview?   // v3.2 数据总览/资产/创作者摘要

    var error: String?
    var loading = false

    /// 三接口并发拉取；学习中课程复用 /api/desk 的 resumeList（失败不致命）。
    func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            async let g = API.shared.get("/api/me/gamification", as: GamificationData.self)
            async let c = API.shared.get("/api/credits/me", as: CreditsData.self)
            async let e = API.shared.get("/api/entitlement/me", as: EntitlementData.self)
            let (gVal, cVal, eVal) = try await (g, c, e)
            gamification = gVal
            credits = cVal
            entitlement = eVal
        } catch let apiErr as APIError {
            // 402 需订阅/充值：errorDescription 已含引导文案，通过 needsPaywall 可展示付费入口。
            error = apiErr.errorDescription ?? (apiErr.needsPaywall ? "需要订阅或充值" : "加载失败")
        } catch {
            self.error = "加载失败"
        }
        // 学习中课程：非核心数据，独立拉取，失败静默。
        if let desk = try? await API.shared.get("/api/desk", as: DeskData.self) {
            resumeList = desk.resumeList
        }
        // 数据总览：非核心，独立拉取，失败静默（老服务端无此端点时档案页仍正常）。
        if let ov = try? await API.shared.get("/api/me/overview", as: MeOverview.self) {
            overview = ov
        }
    }

    /// 累计学习小时数（优先后端 totalStudyMinutes，否则用日历分钟累加）。
    var totalStudyHours: Double {
        if let mins = gamification?.totalStudyMinutes {
            return Double(mins) / 60.0
        }
        let sum = gamification?.calendar.reduce(0) { $0 + $1.minutes } ?? 0
        return Double(sum) / 60.0
    }
}

// MARK: - View

struct ProfileView: View {
    @Environment(AuthManager.self) private var auth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var vm = ProfileViewModel()
    @State private var goSettings = false
    @State private var showShareCard = false
    /// 进场编排：内容就绪后置真，驱动各分区交错浮现。
    @State private var appeared = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if vm.gamification != nil {
                    content
                } else if vm.error != nil {
                    ErrorRetryView(message: vm.error!) { Task { await vm.load() } }
                } else {
                    loadingSkeleton
                }
            }
            .background(Studio.bg)
            .navigationTitle("我的")
            .navigationDestination(isPresented: $goSettings) {
                SettingsView()
            }
            .task {
                if vm.gamification == nil { await vm.load() }
                triggerAppear()   // 覆盖已缓存直接呈现的情况
            }
            .refreshable { await vm.load() }
            .onChange(of: vm.gamification == nil) { _, isNil in
                if !isNil { triggerAppear() }
            }
        }
    }

    /// 数据到位后触发交错进场。各分区的 SectionEntrance 以 value-scoped
    /// 动画携带递增延迟自行编排，这里只翻转标志位（reduce-motion 由子修饰器降级）。
    private func triggerAppear() {
        guard !appeared else { return }
        appeared = true
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 24) {
            // 1. 学生证
            if let g = vm.gamification {
                StudentCardView(
                    user: auth.user,
                    totalHours: vm.totalStudyHours,
                    entitlement: vm.entitlement,
                    credits: vm.credits,
                    gamification: g
                )
                .modifier(SectionEntrance(index: 0, appeared: appeared, reduceMotion: reduceMotion))
            }

            // 1.5 数据总览条 + 学习资产 + 创作者摘要（v3.2）
            if let ov = vm.overview {
                OverviewStrip(overview: ov)
                    .modifier(SectionEntrance(index: 1, appeared: appeared, reduceMotion: reduceMotion))
            }

            // 2. 学习进度
            if let g = vm.gamification {
                VStack(alignment: .leading, spacing: 24) {
                    sectionHeader("学习进度", icon: "chart.bar.fill")
                    LearningProgressView(gamification: g, resumeList: vm.resumeList)
                }
                .modifier(SectionEntrance(index: 1, appeared: appeared, reduceMotion: reduceMotion))
            }

            // 3. 成长足迹
            if let g = vm.gamification {
                VStack(alignment: .leading, spacing: 24) {
                    sectionHeader("成长足迹", icon: "flame.fill")
                    GrowthTrailView(gamification: g)
                }
                .modifier(SectionEntrance(index: 2, appeared: appeared, reduceMotion: reduceMotion))
            }

            // 底部：分享档案 + 设置入口
            shareProfileRow
                .modifier(SectionEntrance(index: 3, appeared: appeared, reduceMotion: reduceMotion))
            settingsRow
                .modifier(SectionEntrance(index: 4, appeared: appeared, reduceMotion: reduceMotion))

            Text("有道自习室 · STUDIO")
                .font(.mono(11, .semibold)).foregroundStyle(Studio.ink4)
                .tracking(2)
                .frame(maxWidth: .infinity)
                .padding(.top, 4)
        }
        .padding(16)
    }

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.ink3)
            Text(title).font(.studio(16, .bold)).foregroundStyle(Studio.ink)
        }
    }

    /// 分享成长档案：v3.2 弹分享卡片（服务端出周报图 + 深/浅切换），替代旧的仅分享链接。
    @ViewBuilder private var shareProfileRow: some View {
        if let user = auth.user {
            Button {
                Haptics.light()
                showShareCard = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Studio.red)
                    Text("分享成长档案").font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.ink4)
                }
                .studioCard()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("分享成长档案")
            .sheet(isPresented: $showShareCard) {
                ShareCardSheet(
                    kind: "week-report",
                    shareUrl: AppConfig.profileShareURL(userId: user.id),
                    title: "分享学习周报"
                )
                .presentationDetents([.large])
            }
        }
    }

    private var settingsRow: some View {
        Button {
            // 触觉由 .pressable() 在按下时统一给出，避免重复。
            goSettings = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Studio.ink2)
                Text("设置").font(.studio(15, .semibold)).foregroundStyle(Studio.ink)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Studio.ink4)
            }
            .studioCard()
        }
        .buttonStyle(.plain)
        .pressable()
        .accessibilityLabel("设置")
        .accessibilityHint("打开账户与偏好设置")
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: 20) {
            // 学生证占位
            SkeletonBar(height: 210).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            // 分区标题
            SkeletonBar(height: 18, width: 120)
            // 学习节奏卡
            SkeletonBar(height: 200).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
            // 成长足迹标题 + streak 双卡
            SkeletonBar(height: 18, width: 120)
            HStack(spacing: 12) {
                ForEach(0..<2, id: \.self) { _ in
                    SkeletonBar(height: 110).clipShape(RoundedRectangle(cornerRadius: StudioRadius.card, style: .continuous))
                }
            }
        }
        .padding(16)
    }
}

/// 分区交错进场：按 index 递增的微延迟，从下方 12pt 淡入浮现。
private struct SectionEntrance: ViewModifier {
    let index: Int
    let appeared: Bool
    let reduceMotion: Bool
    func body(content: Content) -> some View {
        content
            .opacity(appeared || reduceMotion ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 12)
            .animation(reduceMotion ? nil : StudioMotion.smooth.delay(Double(index) * 0.07), value: appeared)
    }
}
