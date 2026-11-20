import FirebaseCrashlytics
import Foundation
import Observation

/// One entry in the friend activity feed (lib/activityFeed.js), as
/// `friends.js` `activity` answers it (5.60.38): what a friend did, about
/// which show, and when.
public struct ActivityItem: Identifiable, Hashable, Sendable, Decodable {
    public enum Action: String, Sendable, CaseIterable {
        case addedShow = "added_show"
        case ratedShow = "rated_show"
        case commented
        case sharedMedia = "shared_media"
    }

    public let id: String
    public var userId: String
    public var userName: String
    public var action: Action
    public var showId: String?
    public var artist: String
    public var venue: String?
    public var rating: Double?
    /// `photo`, `poster` or `setlist`, for `shared_media`.
    public var mediaCategory: String?
    /// The friend's handle when their public profile was on at the time:
    /// the row can open their public show page.
    public var handle: String?
    public var timestamp: Date

    public init(id: String, userId: String, userName: String = "A friend", action: Action, showId: String? = nil,
                artist: String = "", venue: String? = nil, rating: Double? = nil, mediaCategory: String? = nil,
                handle: String? = nil, timestamp: Date) {
        self.id = id
        self.userId = userId
        self.userName = userName
        self.action = action
        self.showId = showId
        self.artist = artist
        self.venue = venue
        self.rating = rating
        self.mediaCategory = mediaCategory
        self.handle = handle
        self.timestamp = timestamp
    }

    enum CodingKeys: String, CodingKey {
        case id, userId, userName, action, showId, artist, venue, rating, mediaCategory, handle, timestamp
    }

    /// Unknown actions fail to decode, so a page skips them (a newer
    /// server's kind of entry this build can't describe).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = try c.decode(String.self, forKey: .userId)
        let name = try c.decodeIfPresent(String.self, forKey: .userName)?.trimmingCharacters(in: .whitespacesAndNewlines)
        userName = (name?.isEmpty == false ? name : nil) ?? "A friend"
        let raw = try c.decode(String.self, forKey: .action)
        guard let action = Action(rawValue: raw) else {
            throw DecodingError.dataCorruptedError(forKey: .action, in: c, debugDescription: "unknown action \(raw)")
        }
        self.action = action
        showId = try c.decodeIfPresent(String.self, forKey: .showId)
        artist = try c.decodeIfPresent(String.self, forKey: .artist) ?? ""
        venue = try c.decodeIfPresent(String.self, forKey: .venue)
        rating = try c.decodeIfPresent(Double.self, forKey: .rating)
        mediaCategory = try c.decodeIfPresent(String.self, forKey: .mediaCategory)
        handle = try c.decodeIfPresent(String.self, forKey: .handle)
        let ms = try c.decodeIfPresent(Double.self, forKey: .timestamp) ?? 0
        timestamp = Date(timeIntervalSince1970: ms / 1000)
    }

    /// What happened, after the friend's name (ActivityFeedView.jsx):
    /// "added Phish at MSG", "rated Phish 9/10", "commented on Phish",
    /// "shared a poster from Phish".
    public var summary: String {
        let band = artist.isEmpty ? "a show" : artist
        switch action {
        case .addedShow:
            return venue.map { "added \(band) at \($0)" } ?? "added \(band)"
        case .ratedShow:
            guard let rating else { return "rated \(band)" }
            let figure = rating.rounded() == rating ? String(Int(rating)) : String(rating)
            return "rated \(band) \(figure)/10"
        case .commented:
            return "commented on \(band)"
        case .sharedMedia:
            let noun = switch mediaCategory {
            case "poster": "a poster"
            case "setlist": "a setlist photo"
            case "video": "a video"
            default: "a photo"
            }
            return "shared \(noun) from \(band)"
        }
    }

    /// The friend's public show page, when they had a public profile then.
    public var publicShowURL: URL? {
        guard let handle, !handle.isEmpty, let showId, !showId.isEmpty,
              let h = handle.lowercased().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let s = showId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "\(DeepLink.webOrigin.absoluteString)/u/\(h)/shows/\(s)/")
    }
}

/// One page of the feed: `next` is the `before` for the page after it.
public struct ActivityPage: Decodable, Sendable {
    public var items: [ActivityItem]
    public var next: Int64?

    enum CodingKeys: String, CodingKey { case items, next }

    public init(items: [ActivityItem], next: Int64?) {
        self.items = items
        self.next = next
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Entry by entry, so one this build doesn't know doesn't lose the page.
        var list = try c.nestedUnkeyedContainer(forKey: .items)
        var items: [ActivityItem] = []
        while !list.isAtEnd {
            if let item = try? list.decode(ActivityItem.self) { items.append(item) } else { _ = try? list.decode(JSONValue.self) }
        }
        self.items = items
        next = (try c.decodeIfPresent(Double.self, forKey: .next)).map { Int64($0.rounded()) }
    }
}

/// The feed's filters (ActivityFeedView.jsx).
public enum ActivityFilter: String, CaseIterable, Identifiable, Sendable {
    case all, shows, ratings, comments, photos

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: "All"
        case .shows: "Shows"
        case .ratings: "Ratings"
        case .comments: "Comments"
        case .photos: "Photos"
        }
    }

    public func matches(_ item: ActivityItem) -> Bool {
        switch self {
        case .all: true
        case .shows: item.action == .addedShow
        case .ratings: item.action == .ratedShow
        case .comments: item.action == .commented
        case .photos: item.action == .sharedMedia
        }
    }
}

public enum ActivityFeed {
    /// What the feed shows: the server leaves blocks either way out; this
    /// covers a block taken since the page loaded.
    public static func visible(_ items: [ActivityItem], hiding blocked: Set<String>, filter: ActivityFilter = .all) -> [ActivityItem] {
        items.filter { !blocked.contains($0.userId) && filter.matches($0) }
    }

    /// An older page added under what's shown, without repeats.
    public static func appending(_ page: [ActivityItem], to items: [ActivityItem]) -> [ActivityItem] {
        let seen = Set(items.map(\.id))
        return items + page.filter { !seen.contains($0.id) }
    }
}

/// The friend activity feed (Stage 6, 6-6): read through `friends.js`
/// `activity`, mutual friends who share their activity, newest first, 100
/// a page. Accounts only. Read when the Friends tab or the feed appears
/// (not more than once a minute unless asked), and on pull to refresh.
@MainActor
@Observable
public final class ActivityStore {
    public enum State: Equatable {
        case idle
        case loading
        case ready
        case failed(String)
    }

    public private(set) var items: [ActivityItem] = []
    public private(set) var next: Int64?
    public private(set) var state: State = .idle
    public private(set) var loadingMore = false
    /// Set when a refresh or an older page failed but entries are showing.
    public private(set) var problem: String?

    private var api: APIClient?
    private var uid: String?
    private var loadedAt: Date?
    private var generation = 0
    static let freshFor: TimeInterval = 60

    public init() {}

    public func start(uid: String, api: APIClient?) {
        guard self.uid != uid else { self.api = api; return }
        stop()
        self.uid = uid
        self.api = api
    }

    public func stop() {
        generation += 1
        uid = nil
        items = []
        next = nil
        state = .idle
        loadingMore = false
        problem = nil
        loadedAt = nil
    }

    /// Reads the newest page unless one was read in the last minute.
    public func refreshIfStale() async {
        if let loadedAt, Date().timeIntervalSince(loadedAt) < Self.freshFor, state == .ready { return }
        await refresh()
    }

    /// Reads the newest page.
    public func refresh() async {
        guard uid != nil, let api else { return }
        let started = generation
        if items.isEmpty { state = .loading }
        problem = nil
        do {
            let page = try await api.post(FriendsRequest.function, FriendsRequest.activity(before: nil), as: ActivityPage.self)
            guard started == generation else { return }
            items = page.items
            next = page.next
            state = .ready
            loadedAt = Date()
        } catch {
            guard started == generation else { return }
            let message = Self.failure(error)
            if items.isEmpty { state = .failed(message) } else { problem = message }
            Self.log(error)
        }
    }

    /// The page older than what's shown.
    public func loadOlder() async {
        guard let next, !loadingMore, let api else { return }
        let started = generation
        loadingMore = true
        defer { if started == generation { loadingMore = false } }
        do {
            let page = try await api.post(FriendsRequest.function, FriendsRequest.activity(before: next), as: ActivityPage.self)
            guard started == generation else { return }
            items = ActivityFeed.appending(page.items, to: items)
            self.next = page.next
        } catch {
            guard started == generation else { return }
            problem = Self.failure(error)
            Self.log(error)
        }
    }

    static func failure(_ error: APIError) -> String {
        switch error {
        case .offline: "You're offline. Your friends' activity needs a connection."
        case .rateLimited(let message, _): message ?? "That's a lot of refreshing for one day. Try again tomorrow."
        default: error.message ?? "Couldn't load your friends' activity. Try again."
        }
    }

    private static func log(_ error: Error) {
        Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "ActivityStore"])
    }
}
