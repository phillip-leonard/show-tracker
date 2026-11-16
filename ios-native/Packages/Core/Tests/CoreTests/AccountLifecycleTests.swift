import FirebaseAuth
import Foundation
import Testing
@testable import Core

/// Stage 2, Part 4: what this phone keeps for an account goes with it, a
/// guest's unsent changes block an adoption, and a deletion that fails
/// without a clear "no" is checked before it's reported as failed.
@Suite struct AccountLifecycleTests {
    private func dir() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }

    private func queuedShow(_ id: String) -> QueuedShow {
        QueuedShow(showId: id,
                   input: ShowInput(.manual(.init(artist: "Goose", venue: "Ryman", date: "2026-11-14"), .none), showId: id),
                   display: .init(artist: "Goose", venue: "Ryman", city: "", date: "2026-11-14"),
                   enqueuedAt: Date(timeIntervalSince1970: 1))
    }

    @Test func forgettingAnAccountRemovesItsQueuesAndTermsRecordOnly() throws {
        let dir = dir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let defaults = try #require(UserDefaults(suiteName: "test-\(UUID().uuidString)"))
        let terms = TermsAcceptanceRecord(defaults: defaults)
        for uid in ["gone", "other"] {
            try ShowOutbox.save([queuedShow("1")], uid: uid, in: dir)
            try SetlistEditQueue.save([QueuedSetlistEdit(showId: "1", edit: .rate(songId: "s1", rating: 9), enqueuedAt: Date())], uid: uid, in: dir)
            terms.record(Terms.version, uid: uid)
        }
        #expect(LocalAccountData.unsentCount(uid: "gone", in: dir) == 2)

        LocalAccountData.forget(uid: "gone", terms: terms, in: dir)

        #expect(ShowOutbox.load(uid: "gone", in: dir).isEmpty)
        #expect(SetlistEditQueue.load(uid: "gone", in: dir).isEmpty)
        #expect(terms.version(uid: "gone") == nil)
        #expect(LocalAccountData.unsentCount(uid: "gone", in: dir) == 0)
        #expect(LocalAccountData.unsentCount(uid: "other", in: dir) == 2, "another account's files stay")
        #expect(terms.version(uid: "other") == Terms.version)
    }

    @Test func everyQueuedAddCountsWhateverItsState() throws {
        let dir = dir()
        defer { try? FileManager.default.removeItem(at: dir) }
        var waiting = queuedShow("1")
        waiting.state = .needsAnswer
        var refused = queuedShow("2")
        refused.state = .failed
        try ShowOutbox.save([queuedShow("3"), waiting, refused], uid: "guest", in: dir)
        #expect(LocalAccountData.unsentCount(uid: "guest", in: dir) == 3)
    }

    @Test func theUnsentMessageSaysHowManyAndWhatToDo() {
        #expect(LocalAccountData.unsentMessage(1).hasPrefix("1 change you made as a guest hasn't reached the server yet, and moving now would lose it."))
        #expect(LocalAccountData.unsentMessage(3).hasPrefix("3 changes you made as a guest haven't reached the server yet, and moving now would lose them."))
        #expect(LocalAccountData.unsentMessage(2).contains("Connect to the internet"))
    }

    @Test func onlyAClearRefusalIsTakenAsNotDeleted() {
        #expect(AccountDeletionCheck.mightHaveDeleted(.offline), "a timeout or a lost connection")
        #expect(AccountDeletionCheck.mightHaveDeleted(.server(status: 502, message: nil, code: nil)), "the function ran out of time")
        #expect(AccountDeletionCheck.mightHaveDeleted(.server(status: 0, message: nil, code: nil)))
        #expect(AccountDeletionCheck.mightHaveDeleted(.invalidResponse("garbled")))
        #expect(!AccountDeletionCheck.mightHaveDeleted(.server(status: 400, message: "Type DELETE", code: nil)))
        #expect(AccountDeletionCheck.mightHaveDeleted(.signInRequired(message: nil)), "a retry after the account went: its token can't be refreshed")
        #expect(!AccountDeletionCheck.mightHaveDeleted(.accountRequired(message: nil)))
        #expect(!AccountDeletionCheck.mightHaveDeleted(.rateLimited(message: nil, retryAfter: nil)))
    }

    @Test func aRefusedTokenRefreshMeansTheAccountIsGone() {
        func authError(_ code: AuthErrorCode) -> NSError { NSError(domain: AuthErrorDomain, code: code.rawValue) }
        #expect(AccountDeletionCheck.answer(forRefreshError: authError(.userDisabled)) == .gone, "disabled before the purge starts")
        #expect(AccountDeletionCheck.answer(forRefreshError: authError(.userNotFound)) == .gone)
        #expect(AccountDeletionCheck.answer(forRefreshError: authError(.userTokenExpired)) == .gone, "tokens revoked")
        #expect(AccountDeletionCheck.answer(forRefreshError: authError(.networkError)) == .unknown, "offline: can't tell")
        #expect(AccountDeletionCheck.answer(forRefreshError: URLError(.notConnectedToInternet)) == .unknown)
    }

    @Test func aReasonWrappedInAnInternalErrorIsRead() {
        // The SDK's shape: internal error → underlying error → the server's JSON.
        func wrapped(_ message: String) -> NSError {
            let underlying = NSError(domain: "FIRAuthInternalErrorDomain", code: 3, userInfo: [
                "FIRAuthErrorUserInfoDeserializedResponseKey": ["message": message, "code": 400] as [String: Any],
            ])
            return NSError(domain: AuthErrorDomain, code: AuthErrorCode.internalError.rawValue, userInfo: [NSUnderlyingErrorKey: underlying])
        }
        #expect(AccountDeletionCheck.answer(forRefreshError: wrapped("INVALID_REFRESH_TOKEN")) == .gone, "the Auth emulator, account deleted")
        #expect(AccountDeletionCheck.answer(forRefreshError: wrapped("TOKEN_EXPIRED : revoked")) == .gone, "sessions revoked")
        #expect(AccountDeletionCheck.answer(forRefreshError: wrapped("USER_DISABLED")) == .gone)
        #expect(AccountDeletionCheck.answer(forRefreshError: wrapped("QUOTA_EXCEEDED")) == .unknown)
        #expect(AccountDeletionCheck.answer(forRefreshError: NSError(domain: AuthErrorDomain, code: AuthErrorCode.internalError.rawValue)) == .unknown)
    }

    @Test func deletionWaitsLongerThanOtherCalls() {
        #expect(SessionStore.deletionTimeout > APIClient.defaultTimeout)
    }
}

extension APIClientTests {
    @Test func aRequestCarriesItsTimeout() async throws {
        let api = client(answers: [Self.ok("{}"), Self.ok("{}")])
        try await api.post("delete-account", ["confirmText": "DELETE"], timeout: .seconds(90))
        try await api.post("recompute-my-stats", [String: String]())
        #expect(Stub.requests.first?.timeoutInterval == 90)
        #expect(Stub.requests.last?.timeoutInterval == 30, "the default")
    }
}
