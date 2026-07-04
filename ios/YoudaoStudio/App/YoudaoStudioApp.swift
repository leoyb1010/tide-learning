import SwiftUI

@main
struct YoudaoStudioApp: App {
    @State private var auth = AuthManager.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(Studio.red)
                .task { await auth.bootstrap() }
        }
    }
}
