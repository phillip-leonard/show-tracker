import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import Core

/// Photos, videos, posters and setlist photos (Stage 6, 6-4): the stored
/// document, the three galleries, the limits, the Storage path, YouTube
/// links, the directory's search and image conversion.
struct MediaTests {
    static func item(_ id: String, category: String? = nil, by uid: String = "u1", likes: [String] = [],
                     at seconds: TimeInterval? = 0, size: Int = 1000, type: String = "image") -> ShowMedia {
        var data: [String: Any] = [
            "concertKey": "phish|msg|2025-12-31", "uploadedBy": uid, "uploaderName": "Cam",
            "type": type, "url": "https://firebasestorage.googleapis.com/v0/b/b/o/x?alt=media&token=t",
            "fileSize": size, "likedBy": likes,
        ]
        if let category { data["category"] = category }
        if let seconds { data["createdAt"] = Date(timeIntervalSince1970: seconds) }
        return ShowMedia(id: id, data: data)!
    }

    // MARK: The document

    @Test func decodesTheWebsDocument() throws {
        let doc: [String: Any] = [
            "concertKey": "phish|msg|2025-12-31", "category": "setlist", "artist": "Phish", "venue": "MSG",
            "date": "2025-12-31", "uploadedBy": "u1", "uploaderName": "  Cam ", "type": "image",
            "url": "https://example.com/a.jpg", "storagePath": "showPhotos/x/u1/1-a.jpg", "fileSize": 2048,
            "caption": " Encore! ", "likedBy": ["u2"],
        ]
        let item = try #require(ShowMedia(id: "m1", data: doc))
        #expect(item.category == .setlist && item.kind == .image)
        #expect(item.uploaderName == "Cam" && item.caption == "Encore!")
        #expect(item.fileSize == 2048 && item.storagePath == "showPhotos/x/u1/1-a.jpg")
        #expect(item.isLiked(by: "u2") && !item.isLiked(by: "u1") && item.likeCount == 1)
        #expect(item.artist == "Phish" && item.venue == "MSG" && item.date == "2025-12-31")
    }

    @Test func aDocumentWithoutACategoryIsAPhoto() {
        #expect(Self.item("a").category == .photo, "from before categories existed")
        #expect(Self.item("b", category: "banner").category == .photo, "the web buckets an unknown one as a photo")
    }

    @Test func refusesADocumentItCantShow() {
        #expect(ShowMedia(id: "x", data: ["concertKey": "k", "uploadedBy": "u"]) == nil, "no URL")
        #expect(ShowMedia(id: "x", data: ["concertKey": "k", "url": "https://e.com/a.jpg"]) == nil, "no uploader")
        #expect(ShowMedia(id: "x", data: ["concertKey": "k", "uploadedBy": "u", "url": "not a url"]) == nil)
    }

    @Test func likingIsShownAtOnce() {
        let item = Self.item("a", likes: ["u2"])
        #expect(item.liking(true, uid: "u1").likedBy == ["u2", "u1"])
        #expect(item.liking(false, uid: "u2").likedBy.isEmpty)
        #expect(item.liking(true, uid: "u2").likedBy == ["u2"], "no double like")
    }

    // MARK: YouTube

    @Test func youTubeLinks() {
        for link in ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=3",
                     "https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"] {
            #expect(YouTubeLink.canonical(link) == "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "\(link)")
        }
        #expect(YouTubeLink.id(in: "https://vimeo.com/123") == nil)
        let video = ShowMedia(id: "y", concertKey: "k", kind: .youtube,
                              url: URL(string: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")!, uploadedBy: "u")
        #expect(video.thumbnailURL?.absoluteString == "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg")
        #expect(Self.item("v", type: "video").thumbnailURL == nil, "a video draws a play tile")
    }

    // MARK: The galleries

    @Test func splitsByCategoryNewestFirst() {
        let gallery = MediaGallery([
            Self.item("old", at: 10), Self.item("new", at: 30), Self.item("poster", category: "poster", at: 20),
            Self.item("sheet", category: "setlist", at: 5),
        ])
        #expect(gallery.items(.photo).map(\.id) == ["new", "old"])
        #expect(gallery.items(.poster).map(\.id) == ["poster"])
        #expect(gallery.items(.setlist).map(\.id) == ["sheet"])
    }

    @Test func aSavingUploadSortsFirst() {
        // createdAt is the server's; until it lands, it's the newest.
        let gallery = MediaGallery([Self.item("a", at: 100), Self.item("pending", at: nil)])
        #expect(gallery.items(.photo).first?.id == "pending")
    }

    @Test func mostLikedKeepsNewestFirstOnTies() {
        let gallery = MediaGallery([
            Self.item("a", likes: ["x"], at: 10), Self.item("b", likes: ["x", "y"], at: 5),
            Self.item("c", likes: ["x"], at: 20), Self.item("d", at: 30),
        ])
        #expect(gallery.items(.photo, sort: .mostLiked).map(\.id) == ["b", "c", "a", "d"])
    }

    @Test func hidesBlockedAndReported() {
        let gallery = MediaGallery([Self.item("a", by: "rude"), Self.item("b"), Self.item("c")],
                                   hiding: ["rude"], reported: ["c"])
        #expect(gallery.items.map(\.id) == ["b"])
    }

    // MARK: Limits

    @Test func limitsAreTheServers() {
        #expect(MediaLimits.allows("image/jpeg", in: .poster))
        #expect(MediaLimits.allows("video/mp4", in: .photo))
        #expect(!MediaLimits.allows("video/mp4", in: .setlist), "posters and setlist photos are images only")
        #expect(!MediaLimits.allows("image/heic", in: .photo), "the web can't show HEIC")
    }

    @Test func checksABatchBeforeItStarts() {
        let mb = 1024 * 1024
        #expect(MediaLimits.problem(sizes: [2 * mb], existing: []) == nil)
        #expect(MediaLimits.problem(sizes: [11 * mb], existing: [])?.contains("10MB") == true)
        // Every category counts toward the concert's 50 MB.
        let existing = [Self.item("p", size: 30 * mb), Self.item("s", category: "setlist", size: 15 * mb)]
        #expect(MediaLimits.problem(sizes: [4 * mb], existing: existing) == nil)
        #expect(MediaLimits.problem(sizes: [4 * mb, 2 * mb], existing: existing) == MediaLimits.concertFull)
    }

    @Test func storagePathIsTheOneTheRulesCheck() {
        let path = MediaPaths.storagePath(concertKey: "Phish|Madison Square Garden|2025-12-31", uid: "u1",
                                          fileName: "a/b.jpg", at: Date(timeIntervalSince1970: 1.5))
        #expect(path == "showPhotos/\(ConcertKeys.mediaPathSegment("Phish|Madison Square Garden|2025-12-31"))/u1/1500-a-b.jpg")
    }

    // MARK: Messages

    @Test func refusalsSayWhatTheServerSaid() {
        let filter = APIError.server(status: 422, message: "That contains language we don’t allow.", code: "profanity")
        #expect(MediaWrites.postFailure(filter) == "That contains language we don’t allow.")
        #expect(MediaWrites.postFailure(APIError.offline) == "You're offline. Photos need a connection.")
        #expect(MediaWrites.postFailure(CocoaError(.fileReadUnknown)) == "Couldn't save that upload. Try again.")
        #expect(MediaWrites.failure(.server(status: 500, message: nil, code: nil), fallback: "x") == "x")
    }

    // MARK: The directory

    @Test func directorySearchesBandVenueAndDate() {
        var a = Self.item("a"); a.artist = "Phish"; a.venue = "MSG"; a.date = "2025-12-31"
        var b = Self.item("b"); b.artist = "Goose"; b.venue = "Red Rocks"; b.date = "31-07-2024"
        #expect(SetlistPhotoSearch.filter([a, b], query: "phi").map(\.id) == ["a"])
        #expect(SetlistPhotoSearch.filter([a, b], query: "red rocks").map(\.id) == ["b"])
        #expect(SetlistPhotoSearch.filter([a, b], query: "2024-07").map(\.id) == ["b"], "a legacy date matches its ISO day")
        #expect(SetlistPhotoSearch.filter([a, b], query: "  ").count == 2)
    }

    // MARK: Conversion

    static func encoded(_ type: UTType, width: Int, height: Int) throws -> Data {
        let space = CGColorSpaceCreateDeviceRGB()
        let ctx = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                         space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.setFillColor(red: 0.4, green: 0.2, blue: 0.8, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try #require(ctx.makeImage())
        let out = NSMutableData()
        let dest = try #require(CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        #expect(CGImageDestinationFinalize(dest))
        return out as Data
    }

    @Test func imagesBecomeJPEGNoLargerThan3000() throws {
        let png = try Self.encoded(.png, width: 4000, height: 1000)
        let prepared = try MediaPreparation.image(png, name: "IMG_0001.HEIC")
        #expect(prepared.contentType == "image/jpeg" && prepared.fileName == "IMG_0001.jpg")
        guard case .data(let jpeg) = prepared.payload else { Issue.record("expected data"); return }
        let source = try #require(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let props = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        #expect(props[kCGImagePropertyPixelWidth] as? Int == 3000)
        #expect(props[kCGImagePropertyGPSDictionary] == nil, "no location leaves the phone")
        #expect(prepared.size == jpeg.count)
    }

    @Test func aGIFStaysAGIF() throws {
        let gif = try Self.encoded(.gif, width: 20, height: 20)
        let prepared = try MediaPreparation.image(gif, name: "dance.gif")
        #expect(prepared.contentType == "image/gif" && prepared.fileName == "dance.gif")
    }

    @Test func unreadableDataIsRefused() {
        #expect(throws: MediaPreparation.Failure.unreadable) { try MediaPreparation.image(Data("nope".utf8)) }
    }
}
