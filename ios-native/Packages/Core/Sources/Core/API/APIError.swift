import Foundation

/// What went wrong calling a Netlify function, in the terms the UI acts on.
public enum APIError: Error, Equatable, Sendable {
    /// 401: no session, or one the server won't accept. Sign in again.
    case signInRequired(message: String?)
    /// 403 `account_required`: a guest (anonymous auth) tried something that
    /// needs an account (docs/ios-native/DECISIONS.md, "Guests"). Offer to
    /// create one.
    case accountRequired(message: String?)
    /// Any other 403.
    case forbidden(message: String?, code: String?)
    /// 429: a daily or hourly limit. `retryAfter` from the Retry-After header.
    case rateLimited(message: String?, retryAfter: TimeInterval?)
    /// No connection, or the request couldn't reach the server.
    case offline
    /// Any other non-2xx answer.
    case server(status: Int, message: String?, code: String?)
    /// A 2xx answer this client couldn't read.
    case invalidResponse(String)

    /// The text to show a person, when the server sent one.
    public var message: String? {
        switch self {
        case .signInRequired(let m), .accountRequired(let m): return m
        case .forbidden(let m, _), .rateLimited(let m, _), .server(_, let m, _): return m
        case .offline: return "You're offline. Try again when you're connected."
        case .invalidResponse: return nil
        }
    }

    /// The request was cancelled (its task ended: a view went away, a
    /// newer request replaced it). Nothing went wrong, so say nothing.
    public var isCancellation: Bool {
        if case .server(0, _, Self.cancelledCode) = self { return true }
        return false
    }

    static let cancelledCode = "cancelled"
    static let cancelled = APIError.server(status: 0, message: nil, code: cancelledCode)

    /// From an HTTP answer. Functions say what went wrong as `{ error, code }`,
    /// or `{ error: { code, message } }` (normalize-show), or
    /// `{ ok: false, error: 'code', code }` (my-poster).
    static func from(status: Int, body: Data, headers: [AnyHashable: Any]) -> APIError {
        var message: String?
        var code: String?
        if let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            code = json["code"] as? String
            if let e = json["error"] as? String { message = e }
            if let e = json["error"] as? [String: Any] {
                message = e["message"] as? String
                code = code ?? e["code"] as? String
            }
        }
        switch status {
        case 401:
            return .signInRequired(message: message)
        case 403 where code == "account_required" || message == "account_required":
            return .accountRequired(message: message == "account_required" ? nil : message)
        case 403:
            return .forbidden(message: message, code: code)
        case 429:
            let header = headers.first { "\($0.key)".lowercased() == "retry-after" }?.value
            let retry = (header as? String).flatMap(TimeInterval.init) ?? (header as? NSNumber)?.doubleValue
            return .rateLimited(message: message, retryAfter: retry)
        default:
            return .server(status: status, message: message, code: code)
        }
    }

    static func from(urlError: URLError) -> APIError {
        switch urlError.code {
        case .cancelled:
            // Its localizedDescription is the bare word "cancelled".
            return .cancelled
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff, .callIsActive:
            return .offline
        default:
            return .server(status: 0, message: urlError.localizedDescription, code: "\(urlError.code.rawValue)")
        }
    }
}
