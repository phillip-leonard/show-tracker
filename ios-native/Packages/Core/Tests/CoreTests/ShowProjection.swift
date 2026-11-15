import Foundation
@testable import Core

/// A decoded `Show` as the JSON the fixtures write, so the contract tests can
/// compare the two field by field. `Show` itself isn't `Encodable` (the app
/// never writes a whole show), so this lives in the tests.
enum ShowProjection {
    static func json(_ s: Show) -> [String: Any] {
        var d: [String: Any] = [
            "id": s.id, "artist": s.artist, "venue": s.venue, "city": s.city, "date": s.date,
            "setlist": s.setlist.map(json),
        ]
        d["country"] = s.country
        d["state"] = s.state
        d["tour"] = s.tour
        d["setlistfmId"] = s.setlistfmId
        d["setlistfmUrl"] = s.setlistfmUrl
        d["artistMbid"] = s.artistMbid
        d["isManual"] = s.isManual
        d["createdAt"] = s.createdAt.map { JSONCompare.iso.string(from: $0) }
        d["rating"] = s.rating
        d["comment"] = s.comment
        d["venueRating"] = s.venueRating
        d["festivalId"] = s.festivalId
        d["festivalName"] = s.festivalName
        d["isFestival"] = s.isFestival
        d["taggedBy"] = s.taggedBy
        d["taggedByUid"] = s.taggedByUid
        if !s.taggedFriendUids.isEmpty { d["taggedFriendUids"] = s.taggedFriendUids }
        d["archivalAudioPick"] = s.archivalAudioPick
        d["migratedFromLocal"] = s.migratedFromLocal
        d["setlistSource"] = s.setlistSource
        d["sourceShowId"] = s.sourceShowId
        d["sourcePermalink"] = s.sourcePermalink
        d["setlistNotes"] = s.setlistNotes
        d["setlistFetchedAt"] = s.setlistFetchedAt
        d["sourceLicenseUrl"] = s.sourceLicenseUrl
        d["needsReview"] = s.needsReview
        d["normalizedVersion"] = s.normalizedVersion
        d["needsNormalization"] = s.needsNormalization
        if let r = s.needsReviewReason { d["needsReviewReason"] = ["with": r.with, "overlap": r.overlap as Any].compactMapValues { $0 is NSNull ? nil : $0 } }
        return d
    }

    static func json(_ song: Song) -> [String: Any] {
        var d: [String: Any] = ["id": song.id, "name": song.name]
        d["set"] = song.set
        d["setBreak"] = song.setBreak
        d["cover"] = song.cover
        d["tape"] = song.tape
        d["rating"] = song.rating
        d["comment"] = song.comment
        d["manuallyAdded"] = song.manuallyAdded
        d["transitionMark"] = song.transitionMark
        d["footnote"] = song.footnote
        d["jamchart"] = song.jamchart
        d["jamchartNote"] = song.jamchartNote
        d["sourceGap"] = song.sourceGap
        d["debut"] = song.debut
        d["songId"] = song.songId
        d["songSlug"] = song.songSlug
        d["sourceOpener"] = song.sourceOpener
        d["notInSource"] = song.notInSource
        return d
    }

    /// Song fields that keep "" rather than dropping it.
    static let keepEmpty: Set<String> = ["transitionMark", "footnote"]
}
