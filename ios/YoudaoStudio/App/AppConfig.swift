import Foundation

/// 全局配置。apiBaseURL 指向 Web 后端（开发用局域网/模拟器 localhost，生产用正式域名）。
enum AppConfig {
    /// 模拟器可直接访问宿主机 localhost。真机需改成局域网 IP 或正式域名。
    /// 后端跑在 3100 端口（项目约定，非 3000）。
    static let apiBaseURL = "http://localhost:3100"

    /// 原生 App 标识（写操作时带上，配合后端 assertSameOrigin 的 Bearer 放行）。
    static let appOrigin = "ios-app"

    /// 当前是否 iOS（用于隐藏微信/支付宝支付，只走 IAP）。
    static let isIOS = true
}
