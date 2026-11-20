import Foundation

/// The setlist operations on the server (`netlify/functions/lib/setlistOps.js`,
/// behind `resync-show`, `propose-setlist`, `accept-proposal`,
/// `reject-proposal`). Every setlist change from a source happens there, in
/// a transaction against the stored show, with the "never lose a rating"
/// guard (`would-lose-notes`). The app sends ids, shows the answer, and
/// writes nothing to `setlist` itself: the listener brings the result.
public struct SetlistOps: Sendable {
    let api: APIClient

    public init(api: APIClient) { self.api = api }

    /// `resync-show`: a band source's setlist merged in and written.
    public func resync(showId: String) async throws(APIError) -> SetlistOpAnswer {
        try await send(.resync(showId: showId))
    }

    /// `propose-setlist`: the merge in memory, for the review sheet
    /// (`action: "review"`, the Internet Archive). Nothing is written.
    public func propose(showId: String) async throws(APIError) -> SetlistOpAnswer {
        try await send(.propose(showId: showId))
    }

    /// `accept-proposal { showId, result }`: what `propose` returned, after
    /// the person looked at it. Re-merged against the stored show.
    /// `onlyIfEmpty`: the Internet Archive backfill saves only while the
    /// show still has no setlist (`has-setlist` otherwise).
    public func accept(showId: String, result: JSONValue, onlyIfEmpty: Bool = false) async throws(APIError) -> SetlistOpAnswer {
        try await api.post(SetlistOperation.acceptFunction,
                           SetlistOperation.acceptBody(showId: showId, result: result, onlyIfEmpty: onlyIfEmpty), as: SetlistOpAnswer.self)
    }

    /// `accept-proposal { showId }`: the stored proposal (`setlistProposal`).
    public func acceptStored(showId: String) async throws(APIError) -> SetlistOpAnswer {
        try await send(.accept(showId: showId))
    }

    /// `reject-proposal`: keep the current setlist; the proposal is recorded as declined.
    public func reject(showId: String) async throws(APIError) -> SetlistOpAnswer {
        try await send(.reject(showId: showId))
    }

    private func send(_ op: SetlistOperation) async throws(APIError) -> SetlistOpAnswer {
        try await api.post(op.function, op.body, as: SetlistOpAnswer.self)
    }
}

extension SetlistOperation {
    static let acceptFunction = "accept-proposal"
    static func acceptBody(showId: String, result: JSONValue, onlyIfEmpty: Bool = false) -> [String: JSONValue] {
        var body: [String: JSONValue] = ["showId": .string(showId), "result": result]
        if onlyIfEmpty { body["onlyIfEmpty"] = .bool(true) }
        return body
    }
}

/// An operation's answer: `{ ok, reason?, detail?, summary?, result?,
/// setlist?, message?, source? }` (lib/setlistOps.js propose / apply).
public struct SetlistOpAnswer: Decodable, Sendable {
    public var ok: Bool
    public var reason: String?
    public var detail: String?
    /// The merge's summary (`existingCount`, `resultCount`, `added`, …).
    public var summary: JSONValue?
    /// The chosen band-source result, sent back on accept.
    public var result: JSONValue?
    /// The proposed setlist (propose only), as raw song maps.
    public var setlist: [JSONValue]?
    public var message: String?
    public var source: Source?

    public struct Source: Decodable, Sendable {
        public var id: String?
        public var label: String?
        public var requiresReview: Bool?
    }

    public init(ok: Bool, reason: String? = nil, detail: String? = nil, summary: JSONValue? = nil, result: JSONValue? = nil,
                setlist: [JSONValue]? = nil, message: String? = nil, source: Source? = nil) {
        self.ok = ok; self.reason = reason; self.detail = detail; self.summary = summary; self.result = result
        self.setlist = setlist; self.message = message; self.source = source
    }

    /// The proposed songs, decoded for display.
    public var proposedSongs: [Song] {
        guard let setlist, let data = try? JSONEncoder().encode(setlist) else { return [] }
        return (try? JSONDecoder().decode([Song].self, from: data)) ?? []
    }

    /// The warnings the web's Archive review shows before you trust a
    /// proposal (ArchiveSetlistReview warningsFor).
    public var reviewWarnings: [String] {
        guard let result else { return [] }
        return Self.reviewWarnings(confidence: result["confidence"]?.stringValue, needsReview: result["needsReview"]?.boolValue == true,
                                   partial: result["partial"]?.boolValue == true,
                                   ambiguousMessage: result["ambiguous"]?.boolValue == true ? result["message"]?.stringValue : nil)
    }

    /// For a stored proposal too (its `confidence`, `needsReview`, `partial`).
    public static func reviewWarnings(confidence: String?, needsReview: Bool, partial: Bool, ambiguousMessage: String? = nil) -> [String] {
        var out: [String] = []
        switch confidence {
        case "tracks-only":
            out.append("This recording doesn\u{2019}t mark set breaks, so every song is listed in one set. You can move songs between sets after saving.")
        case "inferred-sets":
            out.append("This recording\u{2019}s description has no set headers, so the set breaks were worked out from its track list. Check where each set starts.")
        default: break
        }
        if needsReview {
            out.append("The recordings of this show don\u{2019}t agree on the setlist. This one was picked by the recording rules, so check it.")
        }
        if partial {
            out.append("This recording covers only part of the show, so songs may be missing.")
        }
        if let ambiguousMessage, !ambiguousMessage.isEmpty { out.append(ambiguousMessage) }
        return out
    }

    /// What to say after a re-sync or an accept: the web's describeResync
    /// (components/shows/ShowDetailView.jsx), every branch naming the
    /// source and saying what it did or didn't have.
    public func describe(sourceName: String, date: String) -> String {
        if ok {
            let s = summary
            let count = { (key: String) -> Int in
                if case .array(let a)? = s?[key] { return a.count }
                return 0
            }
            var carried = 0
            if case .object(let o)? = s?["carriedOver"] { carried = o.values.compactMap(\.intValue).reduce(0, +) }
            var parts: [String] = []
            if let before = s?["existingCount"]?.intValue, let after = s?["resultCount"]?.intValue { parts.append("\(before) → \(after) songs") }
            if count("added") > 0 { parts.append("\(count("added")) added") }
            if count("removed") > 0 { parts.append("\(count("removed")) removed") }
            if count("keptManual") > 0 { parts.append("\(count("keptManual")) of yours kept") }
            let notListed = count("keptNotInSource")
            if notListed > 0 { parts.append("\(notListed) rated song\(notListed == 1 ? "" : "s") \(sourceName) doesn't list kept") }
            if carried > 0 { parts.append("\(carried) rating\(carried == 1 ? "" : "s")/note\(carried == 1 ? "" : "s") kept") }
            return parts.isEmpty ? "Updated from \(sourceName)." : "Updated from \(sourceName): \(parts.joined(separator: ", "))."
        }
        switch reason {
        case "no-show": return "\(sourceName) has no show listed on \(date). Your setlist is unchanged."
        case "no-songs": return "\(sourceName) lists a show on \(date) but returned no songs. That's a problem on our end, not theirs. Nothing was changed."
        case "nothing-to-change", "already": return "Already matches \(sourceName). Nothing to change."
        case "ambiguous-date": return "\(sourceName) lists more than one show on \(date), and this setlist doesn't clearly match one of them. Nothing was changed."
        case "bad-date": return "This show's date (\(detail ?? "blank")) isn't in a form the archive can be asked about. Nothing was changed."
        case "http-error": return "The setlist service answered with \(detail?.isEmpty == false ? detail! : "an error"). Nothing was changed."
        case "fetch-failed": return "Couldn't reach the setlist service\(detail.map { $0.isEmpty ? "" : " (\($0))" } ?? ""). Nothing was changed."
        case "would-lose-notes": return "Not updated: it would have dropped a rating or comment. Your setlist is unchanged."
        case "has-setlist": return "This show has a setlist now, so it was left as it is."
        case "no-proposal": return "There's no setlist waiting for this show any more."
        case "needs-review": return "This setlist needs your review first. Nothing was changed."
        case "not-a-band-source": return "This band's setlists come from setlist.fm, so there's nothing to re-sync."
        case "show-not-found": return "This show isn't in your shows any more."
        default: return "Nothing was changed\(reason.map { " (\($0))" } ?? "")."
        }
    }
}
