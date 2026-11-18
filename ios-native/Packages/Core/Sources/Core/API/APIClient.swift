import Foundation

/// The signed-in user's Firebase ID token, or nil when signed out.
public protocol IDTokenProvider: Sendable {
    func idToken(forceRefresh: Bool) async throws -> String?
}

/// Calls the Netlify functions at mysetlists.net, the way the web's
/// `authedFetch` does: `Authorization: Bearer <Firebase ID token>`, JSON in
/// and out. Every failure is an `APIError`.
///
/// A 401 on a request that carried a token is retried once with a freshly
/// minted token: right after a guest links a credential, or after a long
/// sleep, the cached token can be stale.
public struct APIClient: Sendable {
    public static let productionBaseURL = URL(string: "https://mysetlists.net")!

    public enum Auth: Sendable { case required, optional, none }

    let baseURL: URL
    let session: URLSession
    let tokens: IDTokenProvider?

    /// The functions this build calls: mysetlists.net, or in a Debug build
    /// launched with `MYSETLISTS_API_BASE=<url>`, that address (functions run
    /// locally against the emulators, with `MYSETLISTS_EMULATORS`; see
    /// ios-native/README.md). Release builds always use production.
    public static var baseURLForThisBuild: URL {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["MYSETLISTS_API_BASE"], let url = URL(string: raw), url.scheme != nil {
            return url
        }
        #endif
        return productionBaseURL
    }

    public init(baseURL: URL = baseURLForThisBuild, session: URLSession = .shared, tokens: IDTokenProvider?) {
        self.baseURL = baseURL
        self.session = session
        self.tokens = tokens
    }

    /// POST `body` to `/.netlify/functions/<function>` and decode the answer.
    public func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ function: String, _ body: Body, auth: Auth = .required, as: Response.Type = Response.self,
        timeout: Duration = APIClient.defaultTimeout
    ) async throws(APIError) -> Response {
        let data = try await send(function, body: body, auth: auth, timeout: timeout)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw .invalidResponse("\(function): \(error)")
        }
    }

    /// For functions whose answer the caller doesn't read.
    public func post<Body: Encodable & Sendable>(_ function: String, _ body: Body, auth: Auth = .required,
                                                 timeout: Duration = APIClient.defaultTimeout) async throws(APIError) {
        _ = try await send(function, body: body, auth: auth, timeout: timeout)
    }

    /// How long a request may take before it's given up on.
    public static let defaultTimeout: Duration = .seconds(30)

    /// GET one of the site's public JSON paths (`/api/artist?slug=…`), the
    /// same URL the web asks for, so both share the CDN's cached copy.
    /// No sign-in. A 404 or 503 comes back as `.server(status:…)`.
    public func get<Response: Decodable & Sendable>(
        path: String, query: [String: String], as: Response.Type = Response.self
    ) async throws(APIError) -> Response {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        components?.queryItems = query.isEmpty ? nil : query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components?.url else { throw .invalidResponse("\(path): bad query") }
        let data = try await perform(path, url: url, method: "GET", payload: nil, token: nil)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw .invalidResponse("\(path): \(error)")
        }
    }

    /// GET `/.netlify/functions/<function>?<query>` (a read-only, cacheable
    /// function such as `setlist-source`) and decode the answer.
    public func get<Response: Decodable & Sendable>(
        _ function: String, query: [String: String], auth: Auth = .none, as: Response.Type = Response.self
    ) async throws(APIError) -> Response {
        var token: String?
        if auth != .none {
            token = try await idToken(forceRefresh: false)
            if token == nil, auth == .required { throw .signInRequired(message: nil) }
        }
        var components = URLComponents(url: baseURL.appendingPathComponent(".netlify/functions/\(function)"), resolvingAgainstBaseURL: false)
        // Sorted, so the same question is the same URL (and the same CDN cache entry).
        components?.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components?.url else { throw .invalidResponse("\(function): bad query") }
        let data = try await perform(function, url: url, method: "GET", payload: nil, token: token)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw .invalidResponse("\(function): \(error)")
        }
    }

    func send<Body: Encodable & Sendable>(_ function: String, body: Body, auth: Auth,
                                          timeout: Duration = APIClient.defaultTimeout) async throws(APIError) -> Data {
        let payload: Data
        do { payload = try JSONEncoder().encode(body) } catch { throw .invalidResponse("encoding \(function): \(error)") }

        var token: String?
        if auth != .none {
            token = try await idToken(forceRefresh: false)
            if token == nil, auth == .required { throw .signInRequired(message: nil) }
        }
        do {
            return try await perform(function, payload: payload, token: token, timeout: timeout)
        } catch .signInRequired(let message) where token != nil {
            // Once, with a fresh token.
            guard let fresh = try await idToken(forceRefresh: true) else { throw .signInRequired(message: message) }
            return try await perform(function, payload: payload, token: fresh, timeout: timeout)
        }
    }

    private func idToken(forceRefresh: Bool) async throws(APIError) -> String? {
        guard let tokens else { return nil }
        do { return try await tokens.idToken(forceRefresh: forceRefresh) } catch {
            if let urlError = error as? URLError { throw APIError.from(urlError: urlError) }
            throw .signInRequired(message: nil)
        }
    }

    private func perform(_ function: String, payload: Data, token: String?, timeout: Duration) async throws(APIError) -> Data {
        try await perform(function, url: baseURL.appendingPathComponent(".netlify/functions/\(function)"),
                          method: "POST", payload: payload, token: token, timeout: timeout)
    }

    private func perform(_ function: String, url: URL, method: String, payload: Data?, token: String?,
                         timeout: Duration = APIClient.defaultTimeout) async throws(APIError) -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let payload {
            request.httpBody = payload
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Functions answer CORS for the website's origin; the app is not a
        // browser, but some functions check the origin they serve.
        request.setValue(APIClient.productionBaseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.timeoutInterval = Double(timeout.components.seconds) + Double(timeout.components.attoseconds) / 1e18

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw APIError.from(urlError: error)
        } catch is CancellationError {
            throw .cancelled
        } catch {
            throw .server(status: 0, message: error.localizedDescription, code: nil)
        }
        guard let http = response as? HTTPURLResponse else { throw .invalidResponse("not HTTP") }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.from(status: http.statusCode, body: data, headers: http.allHeaderFields)
        }
        return data
    }
}
