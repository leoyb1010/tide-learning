import XCTest

final class SessionInvalidationPolicyTests: XCTestCase {
    func testCurrentTokenUnauthorizedInvalidates() {
        XCTAssertTrue(SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: "Bearer current", currentToken: "current"))
    }
    func testDelayedOldTokenDoesNotLogOutNewSession() {
        XCTAssertFalse(SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: "Bearer old", currentToken: "new"))
    }
    func testAnonymousFailureDoesNotInvalidateLoggedInSession() {
        XCTAssertFalse(SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: nil, currentToken: "current"))
    }
    func testNetworkAndPermissionErrorsDoNotInvalidate() {
        for status in [200, 400, 403, 429, 500, 503] {
            XCTAssertFalse(SessionInvalidationPolicy.shouldInvalidate(status: status, requestAuthorization: "Bearer current", currentToken: "current"))
        }
    }
    func testAlreadyLoggedOutAndMalformedCredentialsAreHarmless() {
        XCTAssertFalse(SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: "Bearer old", currentToken: nil))
        XCTAssertFalse(SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: "Bearer ", currentToken: ""))
        XCTAssertFalse(SessionInvalidationPolicy.shouldInvalidate(status: 401, requestAuthorization: "Basic current", currentToken: "current"))
    }
    func testLateSuccessfulDataIsRejectedAfterAccountSwitch() {
        var generation = SessionGeneration()
        let request = generation.value
        generation.advance()
        XCTAssertFalse(generation.accepts(request))
    }
    func testLogoutDuringAnonymousLoginPreventsSessionReinstallation() {
        var generation = SessionGeneration()
        let pendingLogin = generation.value
        generation.advance() // logout must advance even while the token is nil
        XCTAssertFalse(generation.accepts(pendingLogin))
    }
    func testCurrentSuccessfulResponseIsAccepted() {
        let generation = SessionGeneration()
        XCTAssertTrue(generation.accepts(generation.value))
    }
}
