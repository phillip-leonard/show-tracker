import FirebaseAuth
import FirebaseCore
import FirebaseCrashlytics
import FirebaseFirestore
import Foundation

/// The settings on Me (Stage 2, Part 3), each through the path the web uses
/// (components/profile/ProfileView.js), so a change shows on the web after
/// a reload:
///
/// - Display name and handle: `moderate-content` (the content filter; the
///   rules refuse client writes of `displayName`, `firstName`, `handle`).
///   Accounts only: the function refuses guests.
/// - Photo URL, public profile, leaderboard opt-out: one field each on
///   `userProfiles/{uid}` (`updateData`), never the whole profile. Firestore
///   applies the write to its cache at once, so the profile listener shows
///   it right away, offline too; the server gets it when it can.
/// - Email: `update-email-preferences` (GET the effective state, POST one
///   switch). It also knows about an address-level unsubscribe, so its
///   answer wins over the profile's fields.
public struct ProfileSettings: Sendable {
    let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// The longest name `moderate-content` takes.
    public static let maxNameLength = 120

    // MARK: Name and handle

    struct NameAnswer: Decodable { let displayName: String }

    /// Saves the name through the filter, then on the Firebase Auth account
    /// too (as the web does). Returns the name as saved.
    public func setDisplayName(_ raw: String) async throws(ProfileSettingError) -> String {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = Self.nameProblem(name) { throw .invalid(problem) }
        let answer: NameAnswer
        do {
            answer = try await api.post(ProfileNameRequest.function, ProfileNameRequest(displayName: name), as: NameAnswer.self)
        } catch {
            throw ProfileSettingError(error)
        }
        if FirebaseApp.app() != nil, let user = Auth.auth().currentUser {
            let change = user.createProfileChangeRequest()
            change.displayName = answer.displayName
            try? await change.commitChanges()
        }
        return answer.displayName
    }

    static func nameProblem(_ name: String) -> String? {
        if name.isEmpty { return "Please enter your name." }
        if name.count > maxNameLength { return "Names are limited to \(maxNameLength) characters." }
        return nil
    }

    struct HandleRequest: Encodable, Sendable {
        var target = "handle"
        var handle: String
    }

    struct HandleAnswer: Decodable { let handle: String }

    /// Claims a public handle. Permanent: there is no rename (the server
    /// refuses a second claim). The format and the filter are the server's.
    public func claimHandle(_ raw: String) async throws(ProfileSettingError) -> String {
        let handle = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if handle.isEmpty { throw .invalid("Choose a handle.") }
        do {
            return try await api.post(ProfileNameRequest.function, HandleRequest(handle: handle), as: HandleAnswer.self).handle
        } catch {
            throw ProfileSettingError(error)
        }
    }

    // MARK: Profile fields

    /// The photo is a web address, as on the web (no upload: Stage 2, C-6).
    /// Empty clears it. Also set on the Firebase Auth account, best-effort.
    public func setPhotoURL(_ raw: String, uid: String) async throws(ProfileSettingError) {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = Self.photoProblem(value) { throw .invalid(problem) }
        Self.write(.photoURL(value), uid: uid)
        if let user = Auth.auth().currentUser {
            let change = user.createProfileChangeRequest()
            change.photoURL = value.isEmpty ? nil : URL(string: value)
            try? await change.commitChanges()
        }
    }

    static func photoProblem(_ value: String) -> String? {
        if value.isEmpty { return nil }
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http", url.host() != nil else {
            return "Enter a web address that starts with https://"
        }
        return nil
    }

    /// Public profile: needs a handle (the page is mysetlists.net/u/<handle>).
    public func setPublicProfile(_ on: Bool, uid: String) {
        Self.write(.publicProfile(on), uid: uid)
    }

    /// The community leaderboard opt-out. Off takes you off the boards at
    /// once (the recompute); on puts you back at the next rebuild. Your own
    /// rank is unchanged either way.
    public func setShowOnLeaderboard(_ on: Bool, uid: String) {
        Self.write(.showOnLeaderboard(on), uid: uid)
        let api = self.api
        Task { try? await api.post(RecomputeStatsRequest.function, RecomputeStatsRequest()) }
    }

    /// One field. The caller doesn't wait: Firestore applies it to its
    /// cache at once (the listener shows it), and only this task waits for
    /// the server, offline included. A refusal (the rules) is logged; the
    /// listener then shows the stored value again.
    private static func write(_ field: Field, uid: String) {
        Task { @MainActor in
            let db = await Database.ready()
            do {
                try await db.document("userProfiles/\(uid)").updateData(field.data)
            } catch {
                Crashlytics.crashlytics().log("ProfileSettings \(field.key): \(error.localizedDescription)")
            }
        }
    }

    /// The profile fields Me writes, one at a time.
    enum Field: Sendable {
        case photoURL(String)
        case publicProfile(Bool)
        case showOnLeaderboard(Bool)

        var key: String {
            switch self {
            case .photoURL: "photoURL"
            case .publicProfile: "publicProfile"
            case .showOnLeaderboard: "showOnLeaderboard"
            }
        }

        /// The `updateData` payload: exactly one key.
        var data: [String: Any] {
            switch self {
            case .photoURL(let v): [key: v]
            case .publicProfile(let v), .showOnLeaderboard(let v): [key: v]
            }
        }
    }

    // MARK: Email

    public struct EmailPreferences: Codable, Equatable, Sendable {
        /// Every email off (except essential account emails).
        public var emailOptOut: Bool
        /// Product news and announcements off.
        public var announcementsOptOut: Bool

        public init(emailOptOut: Bool, announcementsOptOut: Bool) {
            self.emailOptOut = emailOptOut
            self.announcementsOptOut = announcementsOptOut
        }

        enum CodingKeys: String, CodingKey { case emailOptOut, announcementsOptOut }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            emailOptOut = (try? c.decodeIfPresent(Bool.self, forKey: .emailOptOut)) ?? false
            announcementsOptOut = (try? c.decodeIfPresent(Bool.self, forKey: .announcementsOptOut)) ?? false
        }

        /// The switches as the web shows them: on means "you get these".
        public var allEmails: Bool { !emailOptOut }
        public var announcements: Bool { !emailOptOut && !announcementsOptOut }
    }

    public static let emailFunction = "update-email-preferences"

    public func emailPreferences() async throws(ProfileSettingError) -> EmailPreferences {
        do {
            return try await api.get(Self.emailFunction, query: [:], auth: .required, as: EmailPreferences.self)
        } catch {
            throw ProfileSettingError(error)
        }
    }

    struct EmailChange: Encodable, Sendable {
        var emailOptOut: Bool?
        var announcementsOptOut: Bool?
    }

    /// Turns "All emails" on or off. Returns the server's answer.
    public func setAllEmails(_ on: Bool) async throws(ProfileSettingError) -> EmailPreferences {
        try await change(EmailChange(emailOptOut: !on))
    }

    /// Turns "Product news & announcements" on or off.
    public func setAnnouncements(_ on: Bool) async throws(ProfileSettingError) -> EmailPreferences {
        try await change(EmailChange(announcementsOptOut: !on))
    }

    private func change(_ body: EmailChange) async throws(ProfileSettingError) -> EmailPreferences {
        do {
            return try await api.post(Self.emailFunction, body, as: EmailPreferences.self)
        } catch {
            throw ProfileSettingError(error)
        }
    }

    // MARK: Copies of your data

    /// No data export in v1 (Stage 2, C-1): a copy is requested from
    /// support. A draft the person sends themselves, so it comes from their
    /// own address; the account details help support find it.
    public static func dataRequestEmail(email: String?, uid: String?) -> URL {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = Terms.supportEmail
        let account = [email.map { "Account: \($0)" }, uid.map { "User ID: \($0)" }].compactMap { $0 }.joined(separator: "\n")
        components.queryItems = [
            URLQueryItem(name: "subject", value: "Request a copy of my MySetlists data"),
            URLQueryItem(name: "body", value: "Please send me a copy of the data in my MySetlists account.\n\n\(account)\n"),
        ]
        return components.url ?? URL(string: "mailto:\(Terms.supportEmail)")!
    }

    /// mysetlists.net/u/<handle>/shows/<id>/ (`publicShowUrl`): a show's
    /// public page, which exists only while the profile is public.
    public static func publicShowURL(handle: String, showId: String) -> URL? {
        let slug = handle.lowercased().addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? handle.lowercased()
        let id = showId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? showId
        return URL(string: "https://mysetlists.net/u/\(slug)/shows/\(id)/")
    }

    /// mysetlists.net/u/<handle>/, as lib/publicProfile.js builds it.
    public static func publicProfileURL(handle: String) -> URL? {
        let slug = handle.lowercased().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle.lowercased()
        return URL(string: "https://mysetlists.net/u/\(slug)/")
    }
}

/// Why a setting didn't save, in words to show.
public enum ProfileSettingError: Error, Equatable {
    /// Checked before sending (or the server's own format message).
    case invalid(String)
    /// The server refused it (the filter, a taken handle) with this message.
    case refused(String)
    case offline
    /// Guests can't set this.
    case accountRequired
    case failed(String)

    init(_ error: APIError) {
        switch error {
        case .offline: self = .offline
        case .accountRequired: self = .accountRequired
        case .signInRequired: self = .failed("Your session has expired. Sign out and back in, then try again.")
        default:
            if let message = error.message { self = .refused(message) } else { self = .failed("That didn't save. Please try again.") }
        }
    }

    public var message: String {
        switch self {
        case .invalid(let m), .refused(let m), .failed(let m): m
        case .offline: "You're offline. Connect and try again."
        case .accountRequired: "Create an account to change this."
        }
    }
}
