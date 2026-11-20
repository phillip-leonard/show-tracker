import Foundation

// Importing shows from a spreadsheet or a screenshot (Stage 6, 6-7; the
// web's ImportView). Native has no parser of its own (F-10): the file goes
// to `import-sheet` (5.60.39), which reads, plans and matches with the
// web's code, and a screenshot goes to `analyze-screenshot` and becomes the
// same table. Shows are committed as `csv-row` inputs through
// `normalize-show` (`ShowsStore.importRows`).

/// One field the import can fill (lib/importSheet.js IMPORT_COLUMNS).
public struct SheetColumn: Decodable, Hashable, Sendable, Identifiable {
    public let key: String
    public let label: String
    public let required: Bool
    public var id: String { key }

    public init(key: String, label: String, required: Bool) {
        self.key = key; self.label = label; self.required = required
    }

    public static let all: [SheetColumn] = [
        .init(key: "artist", label: "Artist", required: true),
        .init(key: "date", label: "Date", required: true),
        .init(key: "venue", label: "Venue", required: false),
        .init(key: "city", label: "City", required: false),
        .init(key: "state", label: "State", required: false),
        .init(key: "country", label: "Country", required: false),
        .init(key: "rating", label: "Rating", required: false),
        .init(key: "comment", label: "Notes", required: false),
        .init(key: "tour", label: "Tour / festival", required: false),
    ]
}

/// `parse`'s answer: the file as a table, and what the server made of it.
public struct SheetTable: Decodable, Hashable, Sendable {
    public var headers: [String]
    public var rows: [[String]]
    public var mapping: [String: Int]
    /// `mdy` or `dmy`.
    public var dateOrder: String
    public var dateOrderAmbiguous: Bool
    public var signature: String
    /// Rows, columns or cells were cut to the import's limits.
    public var truncated: Bool

    public init(headers: [String], rows: [[String]], mapping: [String: Int], dateOrder: String = "mdy",
                dateOrderAmbiguous: Bool = false, signature: String = "", truncated: Bool = false) {
        self.headers = headers; self.rows = rows; self.mapping = mapping; self.dateOrder = dateOrder
        self.dateOrderAmbiguous = dateOrderAmbiguous; self.signature = signature; self.truncated = truncated
    }

    enum CodingKeys: String, CodingKey { case headers, rows, mapping, dateOrder, dateOrderAmbiguous, signature, truncated }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headers = try c.decode([String].self, forKey: .headers)
        rows = try c.decode([[String]].self, forKey: .rows)
        mapping = try c.decodeIfPresent([String: Int].self, forKey: .mapping) ?? [:]
        dateOrder = try c.decodeIfPresent(String.self, forKey: .dateOrder) ?? "mdy"
        dateOrderAmbiguous = try c.decodeIfPresent(Bool.self, forKey: .dateOrderAmbiguous) ?? false
        signature = try c.decodeIfPresent(String.self, forKey: .signature) ?? ""
        truncated = try c.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
    }

    /// A screenshot's shows as the table the web builds from them.
    public static func screenshot(_ found: [TicketScan.Found]) -> SheetTable {
        SheetTable(headers: ["Artist", "Venue", "Date", "City"],
                   rows: found.map { [$0.artist, $0.venue, $0.date, $0.city] },
                   mapping: ["artist": 0, "venue": 1, "date": 2, "city": 3])
    }
}

/// One show the file would become (`plan`).
public struct PlannedShow: Codable, Hashable, Sendable, Identifiable {
    public var rowIndex: Int
    public var part: Int
    /// Band and day, the duplicate key; matches are kept by it, as the web keeps them.
    public var key: String
    public var artist: String
    /// ISO day, or nil when it couldn't be read.
    public var date: String?
    public var venue: String
    public var city: String
    public var state: String
    public var country: String
    public var rating: Int?
    public var comment: String
    public var tour: String
    public var ambiguousDate: Bool
    public var canSplit: Bool
    /// Why the row can't be imported ("No artist"), or "".
    public var problem: String
    /// Why it's skipped ("Already in your shows"), or nil.
    public var duplicate: String?

    public var id: String { "\(rowIndex)-\(part)" }
    /// Neither a problem nor a duplicate: it can be imported.
    public var importable: Bool { problem.isEmpty && duplicate == nil }

    public init(rowIndex: Int, part: Int = 0, key: String, artist: String, date: String?, venue: String = "",
                city: String = "", state: String = "", country: String = "", rating: Int? = nil, comment: String = "",
                tour: String = "", ambiguousDate: Bool = false, canSplit: Bool = false, problem: String = "",
                duplicate: String? = nil) {
        self.rowIndex = rowIndex; self.part = part; self.key = key; self.artist = artist; self.date = date
        self.venue = venue; self.city = city; self.state = state; self.country = country; self.rating = rating
        self.comment = comment; self.tour = tour; self.ambiguousDate = ambiguousDate; self.canSplit = canSplit
        self.problem = problem; self.duplicate = duplicate
    }
}

public struct SheetPlan: Decodable, Hashable, Sendable {
    public var shows: [PlannedShow]
    public init(shows: [PlannedShow]) { self.shows = shows }
}

/// `match`'s answer for one show.
public struct SheetMatch: Decodable, Hashable, Sendable {
    public struct Setlist: Decodable, Hashable, Sendable {
        public var count: Int
        public var source: String
    }
    /// `matched`, `no-setlist`, `unknown-artist` or `error`.
    public var status: String
    public var reason: String
    /// setlist.fm's spelling when it knows the artist.
    public var artist: String
    public var sourceLabel: String
    public var setlist: Setlist?
    /// A tape setlist from the Internet Archive, to review on the show.
    public var proposal: Bool
    /// The `csv-row` input to commit, or nil with `skip`.
    public var input: [String: JSONValue]?
    public var skip: String?

    public init(status: String, reason: String = "", artist: String = "", sourceLabel: String = "",
                setlist: Setlist? = nil, proposal: Bool = false, input: [String: JSONValue]? = nil, skip: String? = nil) {
        self.status = status; self.reason = reason; self.artist = artist; self.sourceLabel = sourceLabel
        self.setlist = setlist; self.proposal = proposal; self.input = input; self.skip = skip
    }

    enum CodingKeys: String, CodingKey { case status, reason, artist, sourceLabel, setlist, proposal, input, skip }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        artist = try c.decodeIfPresent(String.self, forKey: .artist) ?? ""
        sourceLabel = try c.decodeIfPresent(String.self, forKey: .sourceLabel) ?? ""
        setlist = try c.decodeIfPresent(Setlist.self, forKey: .setlist)
        proposal = try c.decodeIfPresent(Bool.self, forKey: .proposal) ?? false
        input = try c.decodeIfPresent([String: JSONValue].self, forKey: .input)
        skip = try c.decodeIfPresent(String.self, forKey: .skip)
    }

    public var unknownArtist: Bool { status == "unknown-artist" }

    /// The input as `normalize-show` takes it, with a minted id.
    public func showInput() -> ShowInput? {
        guard let input else { return nil }
        var fields = input
        fields["kind"] = nil
        return ShowInput(.csvRow(fields))
    }

    /// The "Waiting to sync" row for it.
    public var display: QueuedShow.Display? {
        guard let input else { return nil }
        let text = { (key: String) -> String in if case .string(let s)? = input[key] { s } else { "" } }
        return .init(artist: text("artist"), venue: text("venue"), city: text("city"), date: text("date"))
    }

    public var hasSetlist: Bool {
        if case .array(let songs)? = input?["setlist"] { return !songs.isEmpty }
        return false
    }
}

/// `import-sheet`'s three actions, one body shape each.
enum ImportSheetRequest: Encodable, Sendable {
    case parse(fileName: String, file: String)
    case plan(headers: [String], rows: [[String]], mapping: [String: Int], dateOrder: String, split: [Int])
    case match(PlannedShow)

    static let function = "import-sheet"

    enum Keys: String, CodingKey { case action, fileName, file, headers, rows, mapping, dateOrder, split, show }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .parse(let name, let file):
            try c.encode("parse", forKey: .action); try c.encode(name, forKey: .fileName); try c.encode(file, forKey: .file)
        case .plan(let headers, let rows, let mapping, let order, let split):
            try c.encode("plan", forKey: .action); try c.encode(headers, forKey: .headers); try c.encode(rows, forKey: .rows)
            try c.encode(mapping, forKey: .mapping); try c.encode(order, forKey: .dateOrder); try c.encode(split, forKey: .split)
        case .match(let show):
            try c.encode("match", forKey: .action); try c.encode(show, forKey: .show)
        }
    }
}

/// The calls the import makes. Accounts only (both functions refuse guests).
public struct SheetImporter: Sendable {
    let api: APIClient
    public init(api: APIClient) { self.api = api }

    /// What import-sheet takes (lib/sheetFile.js): checked here first, so a
    /// big file isn't uploaded only to be refused.
    public static let maxFileBytes = 2 * 1024 * 1024
    public static let extensions: Set<String> = ["csv", "txt", "xlsx", "xls"]

    /// Why this file can't be sent, in the server's words, or nil.
    public static func problem(fileName: String, size: Int) -> String? {
        let ext = (fileName as NSString).pathExtension.lowercased()
        if !extensions.contains(ext) { return "That file type isn\u{2019}t supported. Use a .csv or .xlsx file." }
        if size == 0 { return "That file has no rows to import." }
        if size > maxFileBytes { return "That file is over 2 MB. Split it into smaller files, or save it as .csv." }
        return nil
    }

    public func parse(_ data: Data, fileName: String) async throws(APIError) -> SheetTable {
        try await api.post(ImportSheetRequest.function, ImportSheetRequest.parse(fileName: fileName, file: data.base64EncodedString()),
                           auth: .required, as: SheetTable.self)
    }

    public func plan(_ table: SheetTable, mapping: [String: Int], dateOrder: String, split: Set<Int>) async throws(APIError) -> SheetPlan {
        try await api.post(ImportSheetRequest.function,
                           ImportSheetRequest.plan(headers: table.headers, rows: table.rows, mapping: mapping,
                                                   dateOrder: dateOrder, split: split.sorted()),
                           auth: .required, as: SheetPlan.self)
    }

    public func match(_ show: PlannedShow) async throws(APIError) -> SheetMatch {
        try await api.post(ImportSheetRequest.function, ImportSheetRequest.match(show), auth: .required, as: SheetMatch.self)
    }

    struct ScreenshotRequest: Encodable, Sendable { let image: String; let mediaType: String }
    struct ScreenshotAnswer: Decodable { let shows: [TicketScan.Found]? }

    /// The shows in a screenshot of a ticket site's past events
    /// (`analyze-screenshot`), from a JPEG prepared like a ticket photo.
    public func screenshot(_ jpeg: Data) async throws(APIError) -> [TicketScan.Found] {
        let answer = try await api.post("analyze-screenshot", ScreenshotRequest(image: jpeg.base64EncodedString(), mediaType: "image/jpeg"),
                                        auth: .required, as: ScreenshotAnswer.self)
        return answer.shows ?? []
    }

    /// What to say when a call fails.
    public static func message(for error: APIError, screenshot: Bool = false) -> String {
        switch error {
        case .offline: "You're offline. Importing needs a connection, and nothing has been sent."
        case .signInRequired: "Your session has expired. Sign out and back in, then try again."
        case .accountRequired(let m): m ?? "Create a free account to import shows."
        case .rateLimited(let m, _): m ?? "That\u{2019}s a lot of importing for one day. Please try again tomorrow."
        case .server(let status, let m, _):
            if screenshot, status == 422 { m ?? "No shows were found in this screenshot. Try one that shows your past events." } else {
                m ?? (screenshot ? "Couldn\u{2019}t read that screenshot right now. Please try again." : "Something went wrong. Please try again.")
            }
        case .forbidden(let m, _): m ?? "Something went wrong. Please try again."
        case .invalidResponse: "Something went wrong. Please try again."
        }
    }
}

/// What an import came to (lib/importMatch.js importShows' counts).
public struct ImportResult: Equatable, Sendable {
    public var imported = 0
    public var withSetlists = 0
    public var toReview = 0
    public var duplicates = 0
    public var unmatched: [Unmatched] = []
    public var leftOut = 0
    /// Saved on the phone, waiting for a connection.
    public var queued = 0
    public var cancelled = false

    public struct Unmatched: Equatable, Sendable {
        public var rowIndex: Int
        /// The act, when a split row's one act wasn't imported.
        public var artist: String?
        public var reason: String
    }

    public init() {}

    /// lib/importSheet.js summaryLine: "Imported 212 shows; 180 with
    /// setlists; 9 skipped as duplicates; 23 not matched".
    public var summary: String {
        let plural = { (n: Int, one: String) in "\(n) \(n == 1 ? one : one + "s")" }
        var parts = ["Imported \(plural(imported, "show"))", "\(withSetlists) with setlists"]
        if toReview > 0 { parts.append("\(plural(toReview, "tape setlist")) to review") }
        parts.append("\(duplicates) skipped as duplicates")
        parts.append("\(unmatched.count) not matched")
        if leftOut > 0 { parts.append("\(leftOut) left out by you") }
        if queued > 0 { parts.append("\(queued) saved on this iPhone until you're online") }
        return parts.joined(separator: "; ") + (cancelled ? " (stopped early)" : "")
    }

    /// lib/importSheet.js unmatchedCsv: the file's own columns for each row
    /// not imported, plus why, so it can be fixed and imported again.
    public func unmatchedCSV(_ table: SheetTable, artistColumn: Int?) -> String {
        func cell(_ s: String) -> String {
            s.contains(where: { "\",\n\r".contains($0) }) ? "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\"" : s
        }
        var lines = [(table.headers + ["Why not imported"]).map(cell).joined(separator: ",")]
        for miss in unmatched {
            var cells = table.rows.indices.contains(miss.rowIndex) ? table.rows[miss.rowIndex] : []
            cells += Array(repeating: "", count: max(0, table.headers.count - cells.count))
            cells = Array(cells.prefix(table.headers.count))
            if let artist = miss.artist, let col = artistColumn, cells.indices.contains(col) { cells[col] = artist }
            lines.append((cells + [miss.reason]).map(cell).joined(separator: ","))
        }
        return lines.joined(separator: "\r\n") + "\r\n"
    }
}

/// What committing one imported show came to (`ShowsStore.importRows`).
public enum ImportCommit: Equatable, Sendable {
    case added
    /// The same show was already logged.
    case alreadyThere
    /// Same band and day at another venue: skipped, as the web's import does.
    case skippedPossible
    /// Saved on the phone; it finishes when the server can be reached.
    case queued
    case refused(String)
}
