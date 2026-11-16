import Foundation

/// A show, as stored at `users/{uid}/shows/{id}`.
///
/// Read-only on purpose: not `Encodable`. New shows are built by the
/// server (`normalize-show`), setlist changes happen on the server, and an
/// edit writes one field at a time (`lib/setlistEdits.js`). Writing a whole
/// show from the app's copy would erase another device's edit (R-06).
///
/// The canonical shape is documented at the top of `lib/showInputs.js`;
/// the golden fixtures in `fixtures/shows/` are the contract. Older
/// documents differ in ways production still holds (2026-11-14 scan), each
/// handled here and nowhere else:
///   - `id` is the document id. 58 documents also store an `id` field, so
///     this type doesn't use `@DocumentID` (which refuses a document that
///     has one); `Show.decode(from:)` sets it from the snapshot.
///   - `createdAt` is a Timestamp or an ISO string (`FlexibleDate`).
///   - `tour`: null, `""` or absent all mean none; so do `""` and absent for
///     `country`, `state`, `artistMbid`, `comment` and the setlist.fm fields.
///   - `date` is ISO in every show, but tags still carry `DD-MM-YYYY`; read
///     it through `ShowDate`.
public struct Show: Decodable, Identifiable, Hashable, Sendable {
    public var id: String
    public var artist: String
    public var venue: String
    public var city: String
    public var country: String?
    public var state: String?
    /// As stored. `isoDate` is the calendar day.
    public var date: String
    public var tour: String?
    public var setlist: [Song]
    public var setlistfmId: String?
    public var setlistfmUrl: String?
    public var artistMbid: String?
    public var isManual: Bool?
    public var createdAt: Date?
    public var rating: Int?
    public var comment: String?
    public var venueRating: Int?
    public var festivalId: String?
    public var festivalName: String?
    public var isFestival: Bool?
    public var taggedBy: String?
    public var taggedByUid: String?
    public var taggedFriendUids: [String]
    public var archivalAudioPick: String?
    public var migratedFromLocal: Bool?

    // Band-native sources (lib/bandSetlistRules.js)
    public var setlistSource: String?
    public var sourceShowId: String?
    public var sourcePermalink: String?
    public var setlistNotes: String?
    /// ISO string, not a Timestamp.
    public var setlistFetchedAt: String?
    public var sourceLicenseUrl: String?
    public var needsReview: Bool?
    public var needsReviewReason: ReviewReason?
    public var setlistProposal: SetlistProposal?
    /// The Archive backfill switched the credit with no song changed
    /// (admin-resync-setlists): the show page says so once.
    public var setlistSourceChange: SourceChange?

    // Server bookkeeping
    public var normalizedVersion: Int?
    public var needsNormalization: Bool?

    /// The calendar day, `YYYY-MM-DD`, or `""` when the stored date can't be read.
    public var isoDate: String { ShowDate.isoDay(date) }

    enum CodingKeys: String, CodingKey {
        case id, artist, venue, city, country, state, date, tour, setlist, setlistfmId, setlistfmUrl,
             artistMbid, isManual, createdAt, rating, comment, venueRating, festivalId, festivalName,
             isFestival, taggedBy, taggedByUid, taggedFriendUids, archivalAudioPick, migratedFromLocal,
             setlistSource, sourceShowId, sourcePermalink, setlistNotes, setlistFetchedAt,
             sourceLicenseUrl, needsReview, needsReviewReason, setlistProposal, setlistSourceChange,
             normalizedVersion, needsNormalization
    }

    /// Fields documents carry that the app doesn't read. Listed so the
    /// contract tests can tell a known extra from a field the model forgot.
    public static let ignoredFields: Set<String> = [
        "artistImage", "posterCheckedQuick", "posterCheckedDeep", "posterUrl", "posterSource",
        "posterSourceUrl", "importedByAdmin", "dateNormalizedFrom", "setlistScanAt",
        "setlistFetchAttempted", "populatedAt", "populatedFrom",
    ]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        artist = try c.text(.artist)
        venue = try c.text(.venue)
        city = try c.text(.city)
        country = try c.optionalText(.country)
        state = try c.optionalText(.state)
        date = try c.text(.date)
        tour = try c.optionalText(.tour)
        setlist = try c.list(.setlist, of: Song.self)
        setlistfmId = try c.optionalText(.setlistfmId)
        setlistfmUrl = try c.optionalText(.setlistfmUrl)
        artistMbid = try c.optionalText(.artistMbid)
        isManual = try c.flag(.isManual)
        createdAt = try c.moment(.createdAt)
        rating = try c.rating(.rating)
        comment = try c.optionalText(.comment)
        venueRating = try c.rating(.venueRating)
        festivalId = try c.optionalText(.festivalId)
        festivalName = try c.optionalText(.festivalName)
        isFestival = try c.flag(.isFestival)
        taggedBy = try c.optionalText(.taggedBy)
        taggedByUid = try c.optionalText(.taggedByUid)
        taggedFriendUids = try c.list(.taggedFriendUids, of: String.self)
        archivalAudioPick = try c.optionalText(.archivalAudioPick)
        migratedFromLocal = try c.flag(.migratedFromLocal)
        setlistSource = try c.optionalText(.setlistSource)
        sourceShowId = try c.optionalText(.sourceShowId)
        sourcePermalink = try c.optionalText(.sourcePermalink)
        setlistNotes = try c.optionalText(.setlistNotes)
        setlistFetchedAt = try c.optionalText(.setlistFetchedAt)
        sourceLicenseUrl = try c.optionalText(.sourceLicenseUrl)
        needsReview = try c.flag(.needsReview)
        needsReviewReason = try c.decodeIfPresent(ReviewReason.self, forKey: .needsReviewReason)
        setlistProposal = try c.decodeIfPresent(SetlistProposal.self, forKey: .setlistProposal)
        setlistSourceChange = try c.decodeIfPresent(SourceChange.self, forKey: .setlistSourceChange)
        normalizedVersion = try c.decodeIfPresent(Int.self, forKey: .normalizedVersion)
        needsNormalization = try c.flag(.needsNormalization)
    }
}

/// One song in a setlist: from setlist.fm, a band-native source, or the user.
public struct Song: Decodable, Identifiable, Hashable, Sendable {
    /// Always a string; three formats in production (decimal ms, base-36,
    /// the server's `mintSongId`).
    public var id: String
    public var name: String
    /// "Set I", "Set II", "Encore", "Set 9"… Absent on about a quarter of
    /// stored songs (soundchecks and older imports), never null.
    public var set: String?
    /// A set break label from a band source; string or null.
    public var setBreak: String?
    /// The original artist for a cover; null when it isn't one.
    public var cover: String?
    public var tape: Bool?
    public var rating: Int?
    public var comment: String?
    public var manuallyAdded: Bool?
    public var transitionMark: String?
    public var footnote: String?
    public var jamchart: Bool?
    public var jamchartNote: String?
    public var sourceGap: Int?
    public var debut: Bool?
    public var songId: String?
    public var songSlug: String?
    public var sourceOpener: Bool?
    public var notInSource: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, set, setBreak, cover, tape, rating, comment, manuallyAdded, transitionMark, footnote,
             jamchart, jamchartNote, sourceGap, debut, songId, songSlug, sourceOpener, notInSource
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.text(.id)
        name = try c.text(.name)
        set = try c.optionalText(.set)
        setBreak = try c.optionalText(.setBreak)
        cover = try c.optionalText(.cover)
        tape = try c.flag(.tape)
        rating = try c.rating(.rating)
        comment = try c.optionalText(.comment)
        manuallyAdded = try c.flag(.manuallyAdded)
        // transitionMark and footnote keep "" (a band source writes it for "none").
        transitionMark = try c.decodeIfPresent(String.self, forKey: .transitionMark)
        footnote = try c.decodeIfPresent(String.self, forKey: .footnote)
        jamchart = try c.flag(.jamchart)
        jamchartNote = try c.optionalText(.jamchartNote)
        sourceGap = try c.decodeIfPresent(Int.self, forKey: .sourceGap)
        debut = try c.flag(.debut)
        songId = try c.optionalText(.songId)
        songSlug = try c.optionalText(.songSlug)
        sourceOpener = try c.flag(.sourceOpener)
        notInSource = try c.flag(.notInSource)
    }
}

/// A change of the setlist's credit (`setlistSourceChange`): from one
/// source to another, and whether any song changed.
public struct SourceChange: Decodable, Hashable, Sendable {
    public var from: String?
    public var to: String?
    public var songsChanged: Bool?

    enum CodingKeys: String, CodingKey { case from, to, songsChanged }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.optionalText(.from)
        to = try c.optionalText(.to)
        songsChanged = try c.flag(.songsChanged)
    }
}

/// Why a band-source setlist needs a person to look at it.
public struct ReviewReason: Decodable, Hashable, Sendable {
    /// The other source it disagrees with.
    public var with: String
    public var overlap: Double?
}

/// A setlist waiting for the user's decision (the Internet Archive
/// backfill), and what they decided. Accept and reject go through
/// `accept-proposal` / `reject-proposal`, never a client write.
public struct SetlistProposal: Decodable, Hashable, Sendable {
    public var source: String?
    public var songs: [Song]
    public var sourceShowId: String?
    public var sourcePermalink: String?
    public var setlistNotes: String?
    public var licenseUrl: String?
    public var needsReview: Bool?
    public var disagreement: ReviewReason?
    public var confidence: String?
    public var partial: Bool?
    /// `nil` while pending; then accepted, declined or blocked.
    public var status: String?
    /// ISO string.
    public var decidedAt: String?

    enum CodingKeys: String, CodingKey {
        case source, songs, sourceShowId, sourcePermalink, setlistNotes, licenseUrl, needsReview,
             disagreement, confidence, partial, status, decidedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.optionalText(.source)
        songs = try c.list(.songs, of: Song.self)
        sourceShowId = try c.optionalText(.sourceShowId)
        sourcePermalink = try c.optionalText(.sourcePermalink)
        setlistNotes = try c.optionalText(.setlistNotes)
        licenseUrl = try c.optionalText(.licenseUrl)
        needsReview = try c.flag(.needsReview)
        disagreement = try c.decodeIfPresent(ReviewReason.self, forKey: .disagreement)
        confidence = try c.optionalText(.confidence)
        partial = try c.flag(.partial)
        status = try c.optionalText(.status)
        decidedAt = try c.optionalText(.decidedAt)
    }
}
