import Foundation

/// A delayed 401 from an older request must never invalidate a newer login.
/// Keep this decision pure so both native targets can exercise it without a
/// live account, network request, Keychain access or signing identity.
enum SessionInvalidationPolicy {
    static func shouldInvalidate(status: Int, requestAuthorization: String?, currentToken: String?) -> Bool {
        guard status == 401, let currentToken, !currentToken.isEmpty else { return false }
        return requestAuthorization == "Bearer \(currentToken)"
    }
}

/// Session boundaries also invalidate successful responses and suspended login
/// attempts, including a logout that occurs while the current token is nil.
struct SessionGeneration {
    private(set) var value: UInt64 = 0
    mutating func advance() { value &+= 1 }
    func accepts(_ snapshot: UInt64) -> Bool { snapshot == value }
}
