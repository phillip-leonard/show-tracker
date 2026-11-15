import Foundation
import Testing
@testable import Core

/// The function client against a stubbed URL protocol: no network.
@Suite(.serialized) struct APIClientTests {
    final class Stub: URLProtocol {
        struct Answer: Sendable { let status: Int; let body: String; let headers: [String: String]; let error: URLError? }
        nonisolated(unsafe) static var answers: [Answer] = []
        nonisolated(unsafe) static var requests: [URLRequest] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            var recorded = request
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
                recorded.httpBody = data
            }
            Stub.requests.append(recorded)
            let answer = Stub.answers.isEmpty ? Answer(status: 200, body: "{}", headers: [:], error: nil) : Stub.answers.removeFirst()
            if let error = answer.error { client?.urlProtocol(self, didFailWithError: error); return }
            let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: nil, headerFields: answer.headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(answer.body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    struct Tokens: IDTokenProvider {
        let token: String?
        func idToken(forceRefresh: Bool) async throws -> String? { forceRefresh ? token.map { "\($0)-fresh" } : token }
    }

    func client(token: String? = "tok", answers: [Stub.Answer]) -> APIClient {
        Stub.answers = answers
        Stub.requests = []
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Stub.self]
        return APIClient(baseURL: URL(string: "https://example.test")!, session: URLSession(configuration: config), tokens: Tokens(token: token))
    }

    static func ok(_ body: String) -> Stub.Answer { .init(status: 200, body: body, headers: [:], error: nil) }
    static func status(_ s: Int, _ body: String, _ headers: [String: String] = [:]) -> Stub.Answer { .init(status: s, body: body, headers: headers, error: nil) }

    @Test func postsJSONWithTheTokenAndDecodes() async throws {
        let api = client(answers: [Self.ok(#"{"ok":true}"#)])
        let r = try await api.post("recompute-my-stats", RecomputeStatsRequest(), as: OKResponse.self)
        #expect(r.ok == true)
        let req = try #require(Stub.requests.first)
        #expect(req.url?.absoluteString == "https://example.test/.netlify/functions/recompute-my-stats")
        #expect(req.httpMethod == "POST")
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test func aStale401IsRetriedOnceWithAFreshToken() async throws {
        let api = client(answers: [Self.status(401, #"{"error":"expired"}"#), Self.ok("{}")])
        _ = try await api.post("account-linked", AccountLinkedRequest(ref: nil), as: JSONValue.self)
        #expect(Stub.requests.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer tok", "Bearer tok-fresh"])
    }

    @Test func aSecond401IsSignInRequired() async throws {
        let api = client(answers: [Self.status(401, #"{"error":"Sign in required"}"#), Self.status(401, #"{"error":"Sign in required","code":"auth_required"}"#)])
        await #expect(throws: APIError.signInRequired(message: "Sign in required")) {
            try await api.post("friends", FriendsRequest.referralLink, as: JSONValue.self)
        }
    }

    @Test func aGuestGetsAccountRequired() async throws {
        let api = client(answers: [Self.status(403, #"{"error":"Create an account to add friends.","code":"account_required"}"#)])
        await #expect(throws: APIError.accountRequired(message: "Create an account to add friends.")) {
            try await api.post("friends", FriendsRequest.claimInvites, as: JSONValue.self)
        }
        // my-poster's shape: { ok: false, error: 'account_required', code }
        let poster = client(answers: [Self.status(403, #"{"ok":false,"error":"account_required","code":"account_required"}"#)])
        await #expect(throws: APIError.accountRequired(message: nil)) {
            try await poster.post("my-poster", ["action": "share"], as: JSONValue.self)
        }
    }

    @Test func otherErrorsKeepTheServersWords() async throws {
        await #expect(throws: APIError.forbidden(message: "Not allowed.", code: "forbidden")) {
            try await client(answers: [Self.status(403, #"{"error":"Not allowed.","code":"forbidden"}"#)]).post("x", ["a": 1], as: JSONValue.self)
        }
        await #expect(throws: APIError.rateLimited(message: "Try again tomorrow.", retryAfter: 3600)) {
            try await client(answers: [Self.status(429, #"{"error":"Try again tomorrow."}"#, ["Retry-After": "3600"])]).post("x", ["a": 1], as: JSONValue.self)
        }
        // normalize-show's refused input: { ok: false, error: { code, message } }
        await #expect(throws: APIError.server(status: 400, message: "An artist is required.", code: "bad-input")) {
            try await client(answers: [Self.status(400, #"{"ok":false,"error":{"code":"bad-input","message":"An artist is required."}}"#)]).post("normalize-show", ["a": 1], as: JSONValue.self)
        }
    }

    @Test func noConnectionIsOffline() async throws {
        let api = client(answers: [.init(status: 0, body: "", headers: [:], error: URLError(.notConnectedToInternet))])
        await #expect(throws: APIError.offline) { try await api.post("x", ["a": 1], as: JSONValue.self) }
    }

    @Test func signedOutNeverSendsARequestThatNeedsAToken() async throws {
        let api = client(token: nil, answers: [])
        await #expect(throws: APIError.signInRequired(message: nil)) { try await api.post("delete-account", DeleteAccountRequest(appleAuthorizationCode: nil)) }
        #expect(Stub.requests.isEmpty)
    }

    @Test func passwordResetSendsNoToken() async throws {
        let api = client(token: "tok", answers: [Self.ok(#"{"ok":true}"#)])
        try await api.post(PasswordResetRequest.function, PasswordResetRequest(email: "a@example.com"), auth: .none)
        let req = try #require(Stub.requests.first)
        #expect(req.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(String(data: req.httpBody ?? Data(), encoding: .utf8) == #"{"email":"a@example.com"}"#)
    }

    @Test func unreadableSuccessIsInvalidResponse() async throws {
        let api = client(answers: [Self.ok("not json")])
        await #expect(throws: APIError.self) { try await api.post("x", ["a": 1], as: OKResponse.self) }
    }
}
