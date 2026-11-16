import Foundation
import UIKit

/// Scanning tickets (Stage 1, Part 5): `analyze-tickets` reads photos of
/// ticket stubs, wristbands or mobile tickets and returns the shows on them.
/// Accounts only (a guest's token gets 403 `account_required`; DECISIONS.md
/// "Guests"), 20 scans a day per account (lib/aiScan.js).
///
/// Nothing leaves the phone until the person taps Scan. The images are
/// resized in memory, sent once, and not kept: no file is written.
public struct TicketScan: Sendable {
    let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// The limits lib/aiScan.js enforces.
    public static let maxImages = 10
    public static let maxImageBytes = 4 * 1024 * 1024
    /// The web resizes to fit 1600 × 1600 before upload (TicketScanner.jsx).
    public static let maxDimension: CGFloat = 1600

    /// One show read off a ticket. Any field can be "" when it wasn't legible.
    public struct Found: Decodable, Hashable, Sendable {
        public var artist: String
        public var venue: String
        public var date: String
        public var city: String

        enum CodingKeys: String, CodingKey { case artist, venue, date, city }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            artist = (try? c.decodeIfPresent(String.self, forKey: .artist)) ?? ""
            venue = (try? c.decodeIfPresent(String.self, forKey: .venue)) ?? ""
            date = (try? c.decodeIfPresent(String.self, forKey: .date)) ?? ""
            city = (try? c.decodeIfPresent(String.self, forKey: .city)) ?? ""
        }
        public init(artist: String, venue: String, date: String, city: String) {
            self.artist = artist; self.venue = venue; self.date = date; self.city = city
        }
    }

    struct Request: Encodable, Sendable {
        struct Image: Encodable, Sendable { let base64: String; let mediaType: String }
        let images: [Image]
    }

    struct Answer: Decodable { let shows: [Found]? }

    /// The shows on these images (JPEG data, already prepared), or a typed
    /// error whose `message` is what to show (`scanMessage`).
    public func scan(_ jpegs: [Data]) async throws(APIError) -> [Found] {
        let request = Request(images: jpegs.map { .init(base64: $0.base64EncodedString(), mediaType: "image/jpeg") })
        let answer = try await api.post("analyze-tickets", request, auth: .required, as: Answer.self)
        return answer.shows ?? []
    }

    // MARK: Images

    /// An image as the scan sends it: fitted inside 1600 × 1600, JPEG, under
    /// the 4 MB limit (quality stepped down until it fits). Nil when it can't
    /// be made small enough.
    public static func prepare(_ image: UIImage) -> Data? {
        let size = image.size
        let scale = min(1, maxDimension / max(size.width, size.height, 1))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        for quality in [0.85, 0.7, 0.55, 0.4] as [CGFloat] {
            if let data = resized.jpegData(compressionQuality: quality), data.count <= maxImageBytes { return data }
        }
        return nil
    }

    // MARK: What to say

    /// The web's wording for a failed scan (TicketScanner.jsx with
    /// lib/api.js apiErrorMessage): the server's own sentence where it has
    /// one (the daily limit, an unreadable image, nothing found), the
    /// session line for a 401.
    public static func message(for error: APIError) -> String {
        switch error {
        case .signInRequired:
            return "Your session has expired. Sign out and back in, then try again."
        case .accountRequired(let m):
            return m ?? "Create a free account to scan tickets."
        case .rateLimited(let m, _):
            return m ?? "You\u{2019}ve reached today\u{2019}s limit. Try again tomorrow."
        case .offline:
            return "You're offline. Connect to scan your tickets; nothing has been sent."
        case .server(let status, let m, _):
            if status == 413 { return m ?? "That image is too large. Try a smaller photo or a screenshot." }
            if status == 422 { return m ?? "No shows detected in the ticket images. Try different or clearer images." }
            return m ?? "Failed to analyze tickets. Please try again."
        case .forbidden(let m, _):
            return m ?? "Failed to analyze tickets. Please try again."
        case .invalidResponse:
            return "Failed to analyze tickets. Please try again."
        }
    }
}

/// One scanned show on the review screen: what the ticket said, as edited,
/// and whether to add it.
public struct ScannedShow: Identifiable, Hashable, Sendable {
    public let id = UUID()
    public var artist: String
    public var venue: String
    public var city: String
    /// ISO day, or "" when the ticket's date couldn't be read.
    public var date: String
    public var selected: Bool

    public init(_ found: TicketScan.Found, today: String = ShowDate.today()) {
        artist = found.artist.trimmingCharacters(in: .whitespacesAndNewlines)
        venue = found.venue.trimmingCharacters(in: .whitespacesAndNewlines)
        city = found.city.trimmingCharacters(in: .whitespacesAndNewlines)
        date = ShowDate.isoDay(found.date)
        selected = true
        selected = problem(today: today) == nil
    }

    public init(artist: String, venue: String, city: String, date: String, selected: Bool = true) {
        self.artist = artist; self.venue = venue; self.city = city; self.date = date; self.selected = selected
    }

    /// What has to be fixed before it can be added, or nil.
    public func problem(today: String = ShowDate.today()) -> String? {
        if artist.trimmingCharacters(in: .whitespaces).isEmpty { return "Add the band." }
        if venue.trimmingCharacters(in: .whitespaces).isEmpty { return "Add the venue." }
        if ShowDate.isoDay(date).isEmpty { return "Add the date." }
        if ShowDate.isoDay(date) > today { return "This show hasn't happened yet. Add it as an upcoming show instead." }
        return nil
    }

    public var display: QueuedShow.Display {
        .init(artist: artist.trimmingCharacters(in: .whitespaces), venue: venue.trimmingCharacters(in: .whitespaces),
              city: city.trimmingCharacters(in: .whitespaces), date: ShowDate.isoDay(date))
    }

    /// What goes to `normalize-show`: setlist.fm's setlist for that night
    /// when one was found (the server takes the date, songs and source from
    /// it), otherwise the reviewed fields as a manual show.
    public func input(match: SetlistfmSearch.Setlist?) -> ShowInput {
        if let match { return ShowInput(.setlistfm(.setlist(match.raw), .none)) }
        let d = display
        return ShowInput(.manual(.init(artist: d.artist, venue: d.venue, city: d.city.isEmpty ? nil : d.city, date: d.date), .none))
    }
}
