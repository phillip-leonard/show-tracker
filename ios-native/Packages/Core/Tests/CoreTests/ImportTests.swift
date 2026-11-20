import Foundation
import Testing
@testable import Core

/// Importing a spreadsheet or a screenshot (Stage 6, 6-7): import-sheet's
/// answers as the server gives them, the request bodies, the summary and
/// the not-imported CSV (lib/importSheet.js), and the checks made before a
/// file is sent.
struct ImportTests {
    /// netlify/functions/import-sheet.js's real answers (5.60.39) for a
    /// three-row CSV: parse, plan, then match for the first show.
    static let answers = #"""
{
 "parse": {
  "headers": [
   "Artist",
   "Date",
   "Venue",
   "Rating"
  ],
  "rows": [
   [
    "Phish",
    "12/31/2024",
    "",
    "9"
   ],
   [
    "Billy Strings; Sierra Hull",
    "06/15/2019",
    "Great Stage Park",
    ""
   ],
   [
    "",
    "01/01/2020",
    "X",
    ""
   ]
  ],
  "mapping": {
   "artist": 0,
   "date": 1,
   "venue": 2,
   "rating": 3
  },
  "dateOrder": "mdy",
  "dateOrderAmbiguous": false,
  "signature": "artist|date|venue|rating",
  "truncated": false,
  "columns": [
   {
    "key": "artist",
    "label": "Artist",
    "required": true
   },
   {
    "key": "date",
    "label": "Date",
    "required": true
   },
   {
    "key": "venue",
    "label": "Venue",
    "required": false
   },
   {
    "key": "city",
    "label": "City",
    "required": false
   },
   {
    "key": "state",
    "label": "State",
    "required": false
   },
   {
    "key": "country",
    "label": "Country",
    "required": false
   },
   {
    "key": "rating",
    "label": "Rating",
    "required": false
   },
   {
    "key": "comment",
    "label": "Notes",
    "required": false
   },
   {
    "key": "tour",
    "label": "Tour / festival",
    "required": false
   }
  ]
 },
 "plan": {
  "shows": [
   {
    "rowIndex": 0,
    "part": 0,
    "key": "phish|2024-12-31",
    "artist": "Phish",
    "date": "2024-12-31",
    "venue": "",
    "city": "",
    "state": "",
    "country": "",
    "rating": 9,
    "comment": "",
    "tour": "",
    "ambiguousDate": false,
    "canSplit": false,
    "problem": "",
    "duplicate": null
   },
   {
    "rowIndex": 1,
    "part": 0,
    "key": "billystringssierrahull|2019-06-15",
    "artist": "Billy Strings; Sierra Hull",
    "date": "2019-06-15",
    "venue": "Great Stage Park",
    "city": "",
    "state": "",
    "country": "",
    "rating": null,
    "comment": "",
    "tour": "",
    "ambiguousDate": false,
    "canSplit": true,
    "problem": "",
    "duplicate": null
   },
   {
    "rowIndex": 2,
    "part": 0,
    "key": "",
    "artist": "",
    "date": null,
    "venue": "",
    "city": "",
    "state": "",
    "country": "",
    "rating": null,
    "comment": "",
    "tour": "",
    "ambiguousDate": false,
    "canSplit": false,
    "problem": "No artist",
    "duplicate": null
   }
  ],
  "counts": {
   "rows": 3,
   "shows": 3,
   "ready": 2,
   "problems": 1,
   "duplicates": 0,
   "ambiguous": 0
  }
 },
 "match": {
  "status": "matched",
  "reason": "",
  "artist": "Phish",
  "sourceLabel": "setlist.fm",
  "setlist": {
   "count": 1,
   "source": "setlistfm"
  },
  "proposal": false,
  "input": {
   "kind": "csv-row",
   "artist": "Phish",
   "venue": "Madison Square Garden",
   "date": "2024-12-31",
   "city": "New York",
   "state": "NY",
   "country": "United States",
   "rating": 9,
   "comment": "",
   "tour": "",
   "setlist": [
    {
     "id": "mwoetvxzizzuy1",
     "name": "Tweezer",
     "set": "Set I",
     "cover": null,
     "tape": false
    }
   ],
   "setlistSource": "setlistfm",
   "setlistfmId": "63de4613",
   "setlistfmUrl": "https://www.setlist.fm/setlist/x.html"
  },
  "skip": null
 }
}
"""#

    struct Answers: Decodable { let parse: SheetTable; let plan: SheetPlan; let match: SheetMatch }

    static func decoded() throws -> Answers {
        try JSONDecoder().decode(Answers.self, from: Data(answers.utf8))
    }

    static func body(_ request: ImportSheetRequest) throws -> NSDictionary {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! NSDictionary
    }

    @Test func decodesTheServersAnswers() throws {
        let a = try Self.decoded()
        #expect(a.parse.headers == ["Artist", "Date", "Venue", "Rating"])
        #expect(a.parse.rows.count == 3)
        #expect(a.parse.mapping == ["artist": 0, "date": 1, "venue": 2, "rating": 3])
        #expect(a.parse.dateOrder == "mdy" && !a.parse.dateOrderAmbiguous && !a.parse.truncated)

        let shows = a.plan.shows
        #expect(shows.map(\.id) == ["0-0", "1-0", "2-0"])
        #expect(shows[0].artist == "Phish" && shows[0].date == "2024-12-31" && shows[0].rating == 9 && shows[0].importable)
        #expect(shows[1].canSplit, "a bill in one cell can be split")
        #expect(shows[2].problem == "No artist" && !shows[2].importable && shows[2].date == nil, "a row that can't be imported carries only why")

        let m = a.match
        #expect(m.status == "matched" && m.artist == "Phish")
        #expect(m.setlist?.count == 1 && m.setlist?.source == "setlistfm")
        #expect(m.hasSetlist && !m.proposal && m.skip == nil)
        #expect(m.display == QueuedShow.Display(artist: "Phish", venue: "Madison Square Garden", city: "New York", date: "2024-12-31"),
                "the file had no venue; setlist.fm's fills it")
    }

    @Test func aMatchBecomesTheCsvRowInputWithAMintedId() throws {
        let input = try #require(try Self.decoded().match.showInput())
        #expect(input.showId != nil)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
        #expect(json["kind"] as? String == "csv-row")
        #expect(json["artist"] as? String == "Phish")
        #expect(json["setlistfmId"] as? String == "63de4613")
        #expect(json["showId"] as? String == input.showId)
        #expect(SheetMatch(status: "unknown-artist", skip: "No venue").showInput() == nil)
    }

    @Test func requestBodiesAreTheFunctions() throws {
        #expect(try Self.body(.parse(fileName: "shows.csv", file: "QQ==")) == ["action": "parse", "fileName": "shows.csv", "file": "QQ=="])
        let plan = try Self.body(.plan(headers: ["Artist", "Date"], rows: [["Phish", "1/1/2020"]], mapping: ["artist": 0, "date": 1],
                                       dateOrder: "dmy", split: [3, 1]))
        #expect(plan["action"] as? String == "plan")
        #expect(plan["mapping"] as? NSDictionary == ["artist": 0, "date": 1])
        #expect(plan["dateOrder"] as? String == "dmy")
        #expect(plan["split"] as? [Int] == [3, 1])
        let show = try Self.decoded().plan.shows[0]
        let match = try Self.body(.match(show))
        #expect((match["show"] as? NSDictionary)?["artist"] as? String == "Phish")
        #expect((match["show"] as? NSDictionary)?["date"] as? String == "2024-12-31")
    }

    @Test func aScreenshotIsTheWebsTable() {
        let table = SheetTable.screenshot([TicketScan.Found(artist: "Goose", venue: "Red Rocks", date: "2024-07-31", city: "Morrison")])
        #expect(table.headers == ["Artist", "Venue", "Date", "City"])
        #expect(table.rows == [["Goose", "Red Rocks", "2024-07-31", "Morrison"]])
        #expect(table.mapping == ["artist": 0, "venue": 1, "date": 2, "city": 3])
    }

    @Test func filesAreCheckedBeforeSending() {
        #expect(SheetImporter.problem(fileName: "shows.CSV", size: 10) == nil)
        #expect(SheetImporter.problem(fileName: "shows.xlsx", size: 2 * 1024 * 1024) == nil)
        #expect(SheetImporter.problem(fileName: "shows.xlsx", size: 2 * 1024 * 1024 + 1)?.contains("over 2 MB") == true)
        #expect(SheetImporter.problem(fileName: "shows.numbers", size: 10)?.contains("isn\u{2019}t supported") == true)
        #expect(SheetImporter.problem(fileName: "shows.csv", size: 0) != nil)
    }

    @Test func summaryIsTheWebsLine() {
        var r = ImportResult()
        r.imported = 212; r.withSetlists = 180; r.duplicates = 9
        r.unmatched = Array(repeating: .init(rowIndex: 0, artist: nil, reason: "x"), count: 23)
        #expect(r.summary == "Imported 212 shows; 180 with setlists; 9 skipped as duplicates; 23 not matched")
        var s = ImportResult()
        s.imported = 1; s.toReview = 1; s.cancelled = true
        #expect(s.summary == "Imported 1 show; 0 with setlists; 1 tape setlist to review; 0 skipped as duplicates; 0 not matched (stopped early)")
        var q = ImportResult()
        q.queued = 2; q.leftOut = 3
        #expect(q.summary.hasSuffix("3 left out by you; 2 saved on this iPhone until you're online"))
    }

    @Test func notImportedCSVKeepsTheFilesColumns() {
        let table = SheetTable(headers: ["Artist", "Date", "Notes"],
                               rows: [["Billy Strngs", "2018-02-02", "said \"wow\", twice"], ["Greensky Bluegrass"], ["Phish; Goose", "2019-06-15", ""]],
                               mapping: ["artist": 0, "date": 1, "comment": 2])
        var r = ImportResult()
        r.unmatched = [
            .init(rowIndex: 0, artist: nil, reason: "setlist.fm has no artist called \"Billy Strngs\"."),
            .init(rowIndex: 1, artist: nil, reason: "No date"),
            .init(rowIndex: 2, artist: "Goose", reason: "No venue"),
        ]
        let lines = r.unmatchedCSV(table, artistColumn: 0).components(separatedBy: "\r\n")
        #expect(lines[0] == "Artist,Date,Notes,Why not imported")
        #expect(lines[1] == "Billy Strngs,2018-02-02,\"said \"\"wow\"\", twice\",\"setlist.fm has no artist called \"\"Billy Strngs\"\".\"")
        #expect(lines[2] == "Greensky Bluegrass,,,No date")
        #expect(lines[3] == "Goose,2019-06-15,,No venue", "a split row names the act that wasn't imported")
    }

    @Test func columnsAreTheWebs() {
        #expect(SheetColumn.all.map(\.key) == ["artist", "date", "venue", "city", "state", "country", "rating", "comment", "tour"])
        #expect(SheetColumn.all.filter(\.required).map(\.key) == ["artist", "date"])
    }
}
