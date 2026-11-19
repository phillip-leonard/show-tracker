import FirebaseCrashlytics
import FirebaseFirestore
import FirebaseStorage
import Foundation
import Observation

/// One concert's photos, videos, posters and setlist photos, kept live
/// while its show page is open (Stage 6, 6-4). Accounts only: guests see no
/// user content (D-1), and the rules refuse their reads.
///
/// Reads are the web's: one listener on `showPhotos where concertKey ==`
/// ordered by `createdAt` descending, split into the three galleries on the
/// phone. Uploads put the file in Storage (storage.rules check the path,
/// size and type), then `moderate-content` writes the document from what
/// Storage holds (5.60.38). Likes go through `engagement-notify`, reports
/// through `report-content`. The direct writes are deleting your own
/// upload and its file, which the rules allow the uploader.
@MainActor
@Observable
public final class ShowMediaStore {
    public enum State: Equatable {
        case loading
        case ready
        /// Nothing from the server yet and no copy on the phone.
        case offline
        case failed(String)
    }

    /// One file of a batch, with its caption.
    public struct Upload: Identifiable, Sendable {
        public let media: PreparedMedia
        public var caption: String
        public var id: UUID { media.id }
        public init(_ media: PreparedMedia, caption: String = "") {
            self.media = media
            self.caption = caption
        }
    }

    /// How far a batch has got: file `index` of `total`, `fraction` of it sent.
    public struct Progress: Equatable, Sendable {
        public var index: Int
        public var total: Int
        public var fraction: Double
    }

    /// Where a batch stopped: the files before `index` are posted.
    public struct BatchFailure: Error, Equatable, Sendable {
        public var index: Int
        public var message: String
    }

    public let concertKey: String
    public let uid: String
    public private(set) var media: [ShowMedia] = []
    public private(set) var state: State = .loading
    /// Reported this session: hidden at once (the queue takes a moment).
    public private(set) var reported: Set<String> = []
    /// Items with a like or delete in flight.
    public private(set) var busy: Set<String> = []

    private let api: APIClient?
    private var listener: ListenerRegistration?
    private var pendingLikes: [String: Bool] = [:]

    public init(concertKey: String, uid: String, api: APIClient?) {
        self.concertKey = concertKey
        self.uid = uid
        self.api = api
    }

    public func gallery(hiding blocked: Set<String>) -> MediaGallery {
        MediaGallery(media.map(withPendingLike), hiding: blocked, reported: reported)
    }

    // MARK: Live

    public func start() {
        guard listener == nil, !concertKey.isEmpty else { return }
        Task { await attach() }
    }

    public func stop() {
        listener?.remove()
        listener = nil
    }

    private func attach() async {
        let db = await Database.ready()
        guard listener == nil else { return }
        // The web's query; its index (concertKey asc, createdAt desc) exists.
        let query = db.collection("showPhotos").whereField("concertKey", isEqualTo: concertKey)
            .order(by: "createdAt", descending: true)
        listener = query.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self else { return }
                if let error {
                    MediaWrites.log(error, stage: "listen")
                    if self.media.isEmpty { self.state = .failed("Photos couldn't load. Try again later.") }
                    return
                }
                guard let snapshot else { return }
                self.media = snapshot.documents.compactMap(MediaWrites.decode)
                self.settleLikes()
                self.state = snapshot.metadata.isFromCache && snapshot.documents.isEmpty ? .offline : .ready
            }
        }
    }

    // MARK: Uploads

    /// Uploads a batch in order: each file to Storage, then its document.
    /// Stops at the first refusal (a caption the filter turns down, the
    /// concert's 50 MB) and says which file, so the rest can be fixed and
    /// sent again.
    public func upload(_ batch: [Upload], category: ShowMedia.Category, show: Show,
                       progress: @escaping @MainActor (Progress) -> Void) async throws(BatchFailure) {
        guard let api else { throw BatchFailure(index: 0, message: MediaWrites.failure(.offline)) }
        if let problem = MediaLimits.problem(sizes: batch.map(\.media.size), existing: media) {
            throw BatchFailure(index: 0, message: problem)
        }
        let storage = Storage.storage()
        for (i, item) in batch.enumerated() {
            progress(Progress(index: i + 1, total: batch.count, fraction: 0))
            let path = MediaPaths.storagePath(concertKey: concertKey, uid: uid, fileName: item.media.fileName)
            let ref = storage.reference(withPath: path)
            let metadata = StorageMetadata()
            metadata.contentType = item.media.contentType
            let onProgress: @Sendable (Foundation.Progress?) -> Void = { p in
                guard let p, p.totalUnitCount > 0 else { return }
                let fraction = Double(p.completedUnitCount) / Double(p.totalUnitCount)
                Task { @MainActor in progress(Progress(index: i + 1, total: batch.count, fraction: fraction)) }
            }
            do {
                switch item.media.payload {
                case .data(let data): _ = try await ref.putDataAsync(data, metadata: metadata, onProgress: onProgress)
                case .file(let url): _ = try await ref.putFileAsync(from: url, metadata: metadata, onProgress: onProgress)
                }
            } catch {
                MediaWrites.log(error, stage: "upload")
                throw BatchFailure(index: i, message: MediaWrites.storageFailure(error))
            }
            if case .file(let url) = item.media.payload { try? FileManager.default.removeItem(at: url) }
            let request = PostMediaRequest.upload(
                concertKey: concertKey, category: category, isVideo: item.media.isVideo, storagePath: path,
                caption: String(item.caption.trimmingCharacters(in: .whitespacesAndNewlines).prefix(MediaLimits.maxCaption)),
                show: ContentShow(artist: show.artist, venue: show.venue, date: show.date), showId: show.id)
            do {
                _ = try await api.post(PostMediaRequest.function, request, as: PostedMedia.self)
            } catch {
                // Nothing points at the file now; the server removes the
                // ones it refuses for type or size, this covers the rest.
                MediaWrites.removeFile(ref)
                throw BatchFailure(index: i, message: MediaWrites.postFailure(error))
            }
        }
    }

    /// Adds a YouTube link (photos only). Returns a message when it failed.
    public func addYouTube(_ link: String, caption: String, show: Show) async -> String? {
        guard let url = YouTubeLink.canonical(link) else { return "Not a recognizable YouTube link." }
        guard let api else { return MediaWrites.failure(.offline) }
        let request = PostMediaRequest.youtube(
            concertKey: concertKey, url: url,
            caption: String(caption.trimmingCharacters(in: .whitespacesAndNewlines).prefix(MediaLimits.maxCaption)),
            show: ContentShow(artist: show.artist, venue: show.venue, date: show.date), showId: show.id)
        do {
            _ = try await api.post(PostMediaRequest.function, request, as: PostedMedia.self)
            return nil
        } catch {
            return MediaWrites.postFailure(error)
        }
    }

    // MARK: Likes, deletes, reports

    /// Likes or unlikes: shown at once, put back if the server says no.
    public func toggleLike(_ item: ShowMedia) async -> String? {
        guard let api else { return MediaWrites.failure(.offline) }
        guard !busy.contains(item.id) else { return nil }
        let liked = !withPendingLike(item).isLiked(by: uid)
        pendingLikes[item.id] = liked
        busy.insert(item.id)
        defer { busy.remove(item.id) }
        do throws(APIError) {
            try await MediaWrites.like(api, item.id, liked: liked)
            return nil
        } catch {
            pendingLikes[item.id] = nil
            return MediaWrites.failure(error, fallback: "Couldn't update your like. Try again.")
        }
    }

    /// Deletes one of your own uploads: the document, then the file (best
    /// effort, as the web: a leftover file is only space).
    public func delete(_ item: ShowMedia) async -> String? {
        guard item.uploadedBy == uid else { return nil }
        busy.insert(item.id)
        defer { busy.remove(item.id) }
        return await MediaWrites.delete(item)
    }

    /// Reports someone else's upload; it disappears for you at once.
    public func report(_ item: ShowMedia, reason: ReportReason, details: String) async throws(APIError) {
        guard let api else { throw .offline }
        try await MediaWrites.report(api, item.id, reason: reason, details: details)
        reported.insert(item.id)
    }

    private func withPendingLike(_ item: ShowMedia) -> ShowMedia {
        guard let liked = pendingLikes[item.id] else { return item }
        return item.liking(liked, uid: uid)
    }

    private func settleLikes() {
        for (id, liked) in pendingLikes {
            guard let item = media.first(where: { $0.id == id }) else { pendingLikes[id] = nil; continue }
            if item.isLiked(by: uid) == liked { pendingLikes[id] = nil }
        }
    }
}

/// The setlist photo directory (`/setlist-photos`, SetlistPhotoDirectory.jsx):
/// setlist photos from every concert, newest 300, read once and searched on
/// the phone. Browse only; setlist photos are added from a show's page.
@MainActor
@Observable
public final class SetlistPhotosStore {
    public enum State: Equatable { case loading, ready, failed(String) }

    public static let limit = 300

    public let uid: String
    public private(set) var items: [ShowMedia] = []
    public private(set) var state: State = .loading
    public private(set) var reported: Set<String> = []
    public private(set) var busy: Set<String> = []
    private let api: APIClient?

    public init(uid: String, api: APIClient?) {
        self.uid = uid
        self.api = api
    }

    public func visible(hiding blocked: Set<String>, query: String) -> [ShowMedia] {
        let shown = items.filter { !blocked.contains($0.uploadedBy) && !reported.contains($0.id) }
        // Blocked and reported come out before the search, so a search
        // can't bring them back.
        return SetlistPhotoSearch.filter(shown, query: query)
    }

    public func load() async {
        let db = await Database.ready()
        do {
            let snapshot = try await withDeadline(.seconds(15)) {
                try await db.collection("showPhotos").whereField("category", isEqualTo: ShowMedia.Category.setlist.rawValue)
                    .order(by: "createdAt", descending: true).limit(to: Self.limit).getDocuments()
            }
            items = snapshot.documents.compactMap(MediaWrites.decode)
            state = .ready
        } catch {
            MediaWrites.log(error, stage: "directory")
            if items.isEmpty { state = .failed("Setlist photos couldn't load. Check your connection and try again.") }
        }
    }

    /// Likes or unlikes, then shows what the server stored.
    public func toggleLike(_ item: ShowMedia) async -> String? {
        guard let api else { return MediaWrites.failure(.offline) }
        guard !busy.contains(item.id) else { return nil }
        let liked = !item.isLiked(by: uid)
        busy.insert(item.id)
        defer { busy.remove(item.id) }
        do throws(APIError) {
            try await MediaWrites.like(api, item.id, liked: liked)
            if let i = items.firstIndex(where: { $0.id == item.id }) { items[i] = items[i].liking(liked, uid: uid) }
            return nil
        } catch {
            return MediaWrites.failure(error, fallback: "Couldn't update your like. Try again.")
        }
    }

    public func delete(_ item: ShowMedia) async -> String? {
        guard item.uploadedBy == uid else { return nil }
        busy.insert(item.id)
        defer { busy.remove(item.id) }
        let problem = await MediaWrites.delete(item)
        if problem == nil { items.removeAll { $0.id == item.id } }
        return problem
    }

    public func report(_ item: ShowMedia, reason: ReportReason, details: String) async throws(APIError) {
        guard let api else { throw .offline }
        try await MediaWrites.report(api, item.id, reason: reason, details: details)
        reported.insert(item.id)
    }
}

/// The writes both screens share.
enum MediaWrites {
    static func decode(_ doc: QueryDocumentSnapshot) -> ShowMedia? {
        var data = doc.data(with: .estimate)
        if let ts = data["createdAt"] as? Timestamp { data["createdAt"] = ts.dateValue() }
        guard var item = ShowMedia(id: doc.documentID, data: data) else { return nil }
        item.url = MediaURLs.display(item.url)
        return item
    }

    static func like(_ api: APIClient, _ id: String, liked: Bool) async throws(APIError) {
        _ = try await api.post(LikeRequest.function, LikeRequest(.photo, id: id, liked: liked), as: LikeResponse.self)
    }

    static func report(_ api: APIClient, _ id: String, reason: ReportReason, details: String) async throws(APIError) {
        let request = ReportContentRequest(contentType: .showMedia, contentId: id, reason: reason, details: details)
        _ = try await api.post(ReportContentRequest.function, request, as: JSONValue.self)
    }

    @MainActor
    static func delete(_ item: ShowMedia) async -> String? {
        do {
            try await Database.ready().collection("showPhotos").document(item.id).delete()
        } catch {
            log(error, stage: "delete")
            return "Couldn't delete that. Try again."
        }
        if let path = item.storagePath { removeFile(Storage.storage().reference(withPath: path)) }
        return nil
    }

    /// Deletes a file without waiting: it's only space, and nothing on
    /// screen should wait for it.
    static func removeFile(_ ref: StorageReference) {
        ref.delete { error in if let error { log(error, stage: "delete file") } }
    }

    static func failure(_ error: APIError, fallback: String = "Couldn't save that upload. Try again.") -> String {
        switch error {
        case .accountRequired: "Create an account to share photos."
        case .offline: "You're offline. Photos need a connection."
        case .rateLimited(let message, _): message ?? "That's a lot of uploads for one day. Try again tomorrow."
        default: error.message ?? fallback
        }
    }

    /// Any error from posting: the server's words when it's an `APIError`.
    static func postFailure(_ error: any Error) -> String {
        guard let api = error as? APIError else { return "Couldn't save that upload. Try again." }
        return failure(api, fallback: "Couldn't save that upload. Try again.")
    }

    static func storageFailure(_ error: any Error) -> String {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { return failure(.offline) }
        if ns.domain == StorageErrorDomain, let code = StorageErrorCode(rawValue: ns.code) {
            switch code {
            case .unauthorized, .unauthenticated: return "That upload wasn't allowed. Sign in again and try again."
            case .retryLimitExceeded: return failure(.offline)
            case .cancelled: return "Upload cancelled."
            default: break
            }
        }
        return "Couldn't upload that. Try again."
    }

    static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "Media \(stage)"])
    }
}

/// Download URLs as the phone can open them. Debug builds pointed at the
/// local emulators read files from the Storage emulator, not production.
public enum MediaURLs {
    nonisolated(unsafe) static var emulatorHost: String?

    public static func display(_ url: URL) -> URL {
        guard let host = emulatorHost, url.host == "firebasestorage.googleapis.com",
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.scheme = "http"
        parts.host = host
        parts.port = 9199
        return parts.url ?? url
    }
}
