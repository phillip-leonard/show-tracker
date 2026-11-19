import Foundation

/// A photo, video, YouTube link, poster or setlist photo from a concert
/// (lib/photos.js): `showPhotos/{id}`, keyed by the concert
/// (`ConcertKeys.concertKey`) like comments, so everyone who logged the
/// night shares one gallery. One collection for all three galleries,
/// split by `category`.
///
/// Written only by the server (`moderate-content` `showMedia`, which reads
/// the file's size, type and URL from Storage since 5.60.38); likes go
/// through `engagement-notify`. The app deletes only its own.
public struct ShowMedia: Identifiable, Hashable, Sendable {
    public enum Category: String, CaseIterable, Sendable {
        case photo, poster, setlist

        /// Posters and setlist photos are images only; photos also take
        /// MP4 video and YouTube links.
        public var allowsVideo: Bool { self == .photo }
    }

    public enum Kind: String, Sendable {
        case image, video, youtube
    }

    public let id: String
    public var concertKey: String
    public var category: Category
    public var kind: Kind
    public var url: URL
    public var storagePath: String?
    public var fileSize: Int
    public var caption: String
    public var uploadedBy: String
    public var uploaderName: String
    public var likedBy: [String]
    public var createdAt: Date?
    /// The show as the uploader logged it, for the setlist photo directory.
    public var artist: String?
    public var venue: String?
    public var date: String?

    public init(id: String, concertKey: String, category: Category = .photo, kind: Kind = .image, url: URL,
                storagePath: String? = nil, fileSize: Int = 0, caption: String = "", uploadedBy: String,
                uploaderName: String = "Anonymous", likedBy: [String] = [], createdAt: Date? = nil,
                artist: String? = nil, venue: String? = nil, date: String? = nil) {
        self.id = id
        self.concertKey = concertKey
        self.category = category
        self.kind = kind
        self.url = url
        self.storagePath = storagePath
        self.fileSize = fileSize
        self.caption = caption
        self.uploadedBy = uploadedBy
        self.uploaderName = uploaderName
        self.likedBy = likedBy
        self.createdAt = createdAt
        self.artist = artist
        self.venue = venue
        self.date = date
    }

    /// From a stored document. `createdAt` arrives as a Date (converted by
    /// the store) or is missing. A document with no `category` is a photo
    /// (from before categories existed); an unknown one is a photo too, as
    /// the web buckets it.
    public init?(id: String, data: [String: Any]) {
        guard let concertKey = data["concertKey"] as? String,
              let uploadedBy = data["uploadedBy"] as? String, !uploadedBy.isEmpty,
              let raw = data["url"] as? String, let url = URL(string: raw), url.scheme != nil else { return nil }
        let kind = Kind(rawValue: data["type"] as? String ?? "") ?? .image
        let text = { (key: String) -> String? in
            (data[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
        self.init(
            id: id, concertKey: concertKey,
            category: Category(rawValue: data["category"] as? String ?? "") ?? .photo,
            kind: kind, url: url, storagePath: text("storagePath"),
            fileSize: (data["fileSize"] as? NSNumber)?.intValue ?? 0,
            caption: text("caption") ?? "", uploadedBy: uploadedBy,
            uploaderName: text("uploaderName") ?? "Anonymous",
            likedBy: (data["likedBy"] as? [String]) ?? [], createdAt: data["createdAt"] as? Date,
            artist: text("artist"), venue: text("venue"), date: text("date"))
    }

    public func isLiked(by uid: String?) -> Bool { uid.map(likedBy.contains) ?? false }
    public var likeCount: Int { likedBy.count }

    /// The like as the server will store it, shown at once.
    public func liking(_ liked: Bool, uid: String) -> ShowMedia {
        var copy = self
        copy.likedBy.removeAll { $0 == uid }
        if liked { copy.likedBy.append(uid) }
        return copy
    }

    /// The YouTube video's id, for a link.
    public var youtubeId: String? { kind == .youtube ? YouTubeLink.id(in: url.absoluteString) : nil }

    /// The image a grid shows: the picture itself, or a YouTube link's
    /// thumbnail. A video has none (the grid draws a play tile).
    public var thumbnailURL: URL? {
        switch kind {
        case .image: url
        case .youtube: youtubeId.flatMap { URL(string: "https://img.youtube.com/vi/\($0)/hqdefault.jpg") }
        case .video: nil
        }
    }
}

/// YouTube links (lib/photos.js `extractYoutubeId`, the server's
/// `YOUTUBE_ID`): watch, embed, shorts and youtu.be links.
public enum YouTubeLink {
    public static func id(in text: String) -> String? {
        let pattern = #"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    /// The canonical link the server stores.
    public static func canonical(_ text: String) -> String? {
        id(in: text).map { "https://www.youtube.com/watch?v=\($0)" }
    }
}

/// One concert's media as the show page shows it (ShowMediaSection.jsx):
/// split into the three galleries, without people you blocked or what you
/// reported this session (Guideline 1.2).
public struct MediaGallery: Equatable, Sendable {
    public enum Sort: String, CaseIterable, Identifiable, Sendable {
        case newest, mostLiked
        public var id: String { rawValue }
        public var label: String { self == .newest ? "Newest" : "Most Liked" }
    }

    /// Every item, newest first, hidden ones left out.
    public let items: [ShowMedia]

    public init(_ media: [ShowMedia], hiding blocked: Set<String> = [], reported: Set<String> = []) {
        items = media
            .filter { !blocked.contains($0.uploadedBy) && !reported.contains($0.id) }
            .sorted(by: Self.newestFirst)
    }

    public func items(_ category: ShowMedia.Category, sort: Sort = .newest) -> [ShowMedia] {
        let list = items.filter { $0.category == category }
        guard sort == .mostLiked else { return list }
        // Stable: equal likes stay newest first.
        return list.enumerated().sorted {
            ($0.element.likeCount, -$0.offset) > ($1.element.likeCount, -$1.offset)
        }.map(\.element)
    }

    static func newestFirst(_ a: ShowMedia, _ b: ShowMedia) -> Bool {
        (a.createdAt ?? .distantFuture, a.id) > (b.createdAt ?? .distantFuture, b.id)
    }
}

/// The upload limits (lib/photos.js, storage.rules, and the server since
/// 5.60.38) and the web's words for them.
public enum MediaLimits {
    public static let maxFileBytes = 10 * 1024 * 1024
    /// Shared across photos, posters and setlist photos.
    public static let maxConcertBytes = 50 * 1024 * 1024
    public static let maxCaption = 500

    public static let imageTypes: Set<String> = ["image/jpeg", "image/png", "image/gif", "image/webp"]

    public static func allows(_ contentType: String, in category: ShowMedia.Category) -> Bool {
        imageTypes.contains(contentType) || (contentType == "video/mp4" && category.allowsVideo)
    }

    /// Before a batch starts: the first file the server would refuse, with
    /// its words, or nil. `existing` is the concert's whole gallery (every
    /// category, hidden items included: they still count).
    public static func problem(sizes: [Int], existing: [ShowMedia]) -> String? {
        if sizes.contains(where: { $0 > maxFileBytes }) { return "That file is over the 10MB per-file limit." }
        let total = existing.reduce(0) { $0 + $1.fileSize } + sizes.reduce(0, +)
        if total > maxConcertBytes { return concertFull }
        return nil
    }

    public static let concertFull = "This show's media is at the 50MB limit (shared across photos, posters, and setlist photos). Remove something first."
}

/// The Storage path an upload goes to (lib/photos.js `uploadShowMedia`):
/// `showPhotos/{segment}/{uid}/{ms}-{name}`, which storage.rules and the
/// server both check.
public enum MediaPaths {
    public static func storagePath(concertKey: String, uid: String, fileName: String, at date: Date = .now) -> String {
        let ms = Int64((date.timeIntervalSince1970 * 1000).rounded())
        let name = fileName.replacingOccurrences(of: "/", with: "-")
        return "showPhotos/\(ConcertKeys.mediaPathSegment(concertKey))/\(uid)/\(ms)-\(name)"
    }
}

/// The setlist photo directory's search (SetlistPhotoDirectory.jsx): the
/// band, the venue or the date as stored.
public enum SetlistPhotoSearch {
    public static func filter(_ items: [ShowMedia], query: String) -> [ShowMedia] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter {
            ($0.artist ?? "").lowercased().contains(q)
                || ($0.venue ?? "").lowercased().contains(q)
                || ($0.date ?? "").contains(q)
                || ShowDate.isoDay($0.date).contains(q)
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
