import SwiftUI
import Observation
import UserNotifications
import UIKit
import os

// MARK: - DTO

/// POST /api/devices 请求体。对齐后端 camelCase：{ token, platform }。
private struct RegisterDeviceBody: Encodable {
    let token: String
    let platform: String // 固定 "ios"
}

/// POST /api/devices 响应。后端只回执成功即可，字段可选以容忍不同实现。
private struct RegisterDeviceResult: Decodable {
    let id: String?
}

// MARK: - PushManager

/// APNs 推送 + 本地复习召回统一入口。
///
/// 纯 Manager，无 UI。生命周期与 `AuthManager` 一致：全局单例、`@MainActor`。
/// 通知中心 delegate 用于前台展示，故继承 `NSObject`。
///
/// ## 接入点（App 侧只需两步，本文件不改 App 入口）
/// 1. 前台展示 delegate：在 `YoudaoStudioApp` 或 AppDelegate 尽早设置一次
///    `UNUserNotificationCenter.current().delegate = PushManager.shared`
///    （建议放在 App `init()`，保证冷启动也能接管前台通知展示）。
/// 2. deviceToken 回传：远程通知注册回调只能经 `UIApplicationDelegate` 拿到，
///    因此需在 App 里用 `@UIApplicationDelegateAdaptor` 挂一个 AppDelegate，把
///    - `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
///    - `application(_:didFailToRegisterForRemoteNotificationsWithError:)`
///    分别转发到 `PushManager.shared.didRegister(deviceToken:)` /
///    `PushManager.shared.didFailToRegister(_:)`。
///
/// ## 调用时机（`registerForPush()`）
/// 不在 App 启动即弹权限（冷启动弹窗转化差、易被拒）。
/// 建议在**登录成功后**、用户完成首个有意义动作时调用，例如：
///   - `LoginView` 登录成功回调里 `Task { await PushManager.shared.registerForPush() }`
///   - 或书桌首次出现「待复习」卡片时再引导。
@Observable
@MainActor
final class PushManager: NSObject {
    static let shared = PushManager()

    /// 已获得通知授权（含临时/时效授权）。UI 若需展示状态可读此值。
    private(set) var authorized = false
    /// 已成功注册并上报 deviceToken 到后端。
    private(set) var registered = false
    /// 最近一次错误的可展示文案（复用 APIError.errorDescription）。
    private(set) var lastError: String?

    /// 本地复习召回通知的固定标识，便于去重/取消。
    private let reviewReminderId = "studio.review.daily"

    private let logger = Logger(subsystem: "com.youdao.studio", category: "push")

    private override init() { super.init() }

    // MARK: 对外主入口

    /// 登录后调用：请求权限 → 注册远程通知 → 安排本地复习兜底。
    /// 幂等：重复调用安全（系统会合并；deviceToken 变化时后端按 token upsert）。
    func registerForPush() async {
        lastError = nil
        let granted = await requestAuthorization()
        authorized = granted
        guard granted else {
            logger.info("push authorization denied")
            return
        }
        // 远程注册必须在主线程发起；回调经 AppDelegate → didRegister(deviceToken:)。
        UIApplication.shared.registerForRemoteNotifications()
        // 本地复习召回作为兜底：即便 APNs 未下发，也能每天提醒。
        await scheduleReviewReminder(dueCount: nil)
    }

    // MARK: 权限

    /// 请求通知权限（alert + sound + badge）。已决定过则直接返回当前授权态，不重复弹窗。
    private func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            do {
                return try await center.requestAuthorization(options: [.alert, .sound, .badge])
            } catch {
                lastError = "通知权限请求失败"
                logger.error("requestAuthorization failed: \(error.localizedDescription, privacy: .public)")
                return false
            }
        @unknown default:
            return false
        }
    }

    // MARK: 远程注册回调（由 AppDelegate 转发）

    /// 拿到 APNs deviceToken：转 hex 字符串 → POST /api/devices。
    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await upload(tokenHex: hex) }
    }

    /// 远程注册失败（模拟器、无网络、APNs 配置缺失等）。
    func didFailToRegister(_ error: Error) {
        lastError = "推送注册失败，稍后重试"
        logger.error("registerForRemoteNotifications failed: \(error.localizedDescription, privacy: .public)")
    }

    /// 上报 token 到后端。失败折叠成可展示文案，不阻断主流程。
    private func upload(tokenHex: String) async {
        do {
            _ = try await API.shared.post(
                "/api/devices",
                body: RegisterDeviceBody(token: tokenHex, platform: "ios"),
                as: RegisterDeviceResult.self
            )
            registered = true
            lastError = nil
            logger.info("device token uploaded")
        } catch {
            registered = false
            lastError = (error as? APIError)?.errorDescription ?? "设备注册失败"
            logger.error("upload device token failed: \(self.lastError ?? "", privacy: .public)")
        }
    }

    // MARK: 本地复习召回（兜底）

    /// 安排每天固定时间的复习召回本地通知。
    /// - Parameter dueCount: 待复习张数；nil 时用通用文案（首次注册尚不知道数量）。
    /// 每天 20:00 触发（`UNCalendarNotificationTrigger`，`repeats: true`）。
    /// 相同 identifier 会覆盖旧请求，避免堆叠；调用方可在书桌数据刷新后带上真实数量再调一次。
    func scheduleReviewReminder(dueCount: Int?, hour: Int = 20, minute: Int = 0) async {
        let center = UNUserNotificationCenter.current()

        let content = UNMutableNotificationContent()
        content.title = "有道自习室"
        if let n = dueCount, n > 0 {
            content.body = "今日 \(n) 张待复习，趁热打铁点亮今天"
        } else {
            content.body = "今日有待复习的卡片，来点亮今天吧"
        }
        content.sound = .default

        var comps = DateComponents()
        comps.hour = hour
        comps.minute = minute
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)

        let request = UNNotificationRequest(identifier: reviewReminderId, content: content, trigger: trigger)
        do {
            try await center.add(request)
            logger.info("review reminder scheduled at \(hour):\(minute)")
        } catch {
            logger.error("schedule review reminder failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// 取消复习召回（例如用户关闭复习提醒开关时调用）。
    func cancelReviewReminder() {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [reviewReminderId])
    }
}

// MARK: - 前台展示 delegate

extension PushManager: UNUserNotificationCenterDelegate {
    /// App 在前台时也展示横幅 + 声音（否则前台推送默认静默）。
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }
}
