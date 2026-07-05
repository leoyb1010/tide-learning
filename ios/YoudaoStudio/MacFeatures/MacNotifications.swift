// macOS 本地通知：复习提醒。整文件仅 macOS 参与编译（依赖 AppKit / 无 UIKit）。
//
// M5「打磨与分发」：Mac 内测不接 APNs，改用纯本地通知做每日复习召回。
// 参照 iOS PushManager.scheduleReviewReminder，但 macOS 无 UIApplication，
// 用 UNUserNotificationCenter + NSApplication.dockTile 表达。
//
// 接入点（App 侧）：
//   1. 前台展示 delegate：App init() 里
//      UNUserNotificationCenter.current().delegate = MacNotifications.shared
//   2. 授权 + 安排：App 启动 / 登录成功后
//      Task { await MacNotifications.shared.enableReviewReminder() }
#if os(macOS)
import SwiftUI
import Observation
import UserNotifications
import AppKit
import os

/// macOS 本地通知统一入口（每日复习召回 + 前台展示 delegate + Dock 徽标）。
///
/// 纯 Manager 无 UI。全局单例、@MainActor。继承 NSObject 以充当
/// UNUserNotificationCenterDelegate（前台横幅展示）。
@Observable
@MainActor
final class MacNotifications: NSObject {
    static let shared = MacNotifications()

    /// 已获得通知授权（含临时授权）。UI 若需展示状态可读此值。
    private(set) var authorized = false
    /// 最近一次错误的可展示文案。
    private(set) var lastError: String?

    /// 每日复习召回通知的固定标识，便于去重/取消（重复安排会覆盖同 id 请求）。
    private let reviewReminderId = "studio.mac.review.daily"

    private let logger = Logger(subsystem: "com.youdao.studio.mac", category: "notifications")

    private override init() { super.init() }

    // MARK: 对外主入口

    /// App 启动 / 登录成功后调用：请求权限 → 安排每日 20:00 复习提醒。
    /// 幂等：重复调用安全（系统按固定 id 覆盖已排请求，不会堆积）。
    func enableReviewReminder() async {
        lastError = nil
        let granted = await requestAuthorization()
        authorized = granted
        guard granted else {
            logger.info("notification authorization denied")
            return
        }
        await scheduleReviewReminder()
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

    // MARK: 每日复习提醒

    /// 安排每天 20:00 重复的本地复习提醒。固定 id，重复调用覆盖不堆积。
    func scheduleReviewReminder() async {
        let center = UNUserNotificationCenter.current()

        let content = UNMutableNotificationContent()
        content.title = "该复习啦"
        content.body = "打开有道自习室，清一清今天到期的复习卡片。"
        content.sound = .default

        // 每天 20:00 触发（repeats:true → UNCalendarNotificationTrigger 周期重复）。
        var date = DateComponents()
        date.hour = 20
        date.minute = 0
        let trigger = UNCalendarNotificationTrigger(dateMatching: date, repeats: true)

        let request = UNNotificationRequest(
            identifier: reviewReminderId,
            content: content,
            trigger: trigger
        )

        do {
            // 先移除同 id 旧请求再添加，确保内容/时间更新即时生效。
            center.removePendingNotificationRequests(withIdentifiers: [reviewReminderId])
            try await center.add(request)
            logger.info("scheduled daily review reminder at 20:00")
        } catch {
            lastError = "复习提醒安排失败"
            logger.error("scheduleReviewReminder failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// 取消每日复习提醒（如用户在设置里关闭）。
    func cancelReviewReminder() {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [reviewReminderId])
    }
}

// MARK: - UNUserNotificationCenterDelegate（前台展示）

extension MacNotifications: UNUserNotificationCenterDelegate {
    /// App 在前台时也展示横幅 + 声音 + 角标（否则前台默认不弹）。
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }
}
#endif
