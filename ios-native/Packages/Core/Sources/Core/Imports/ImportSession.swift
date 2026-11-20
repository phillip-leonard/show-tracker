import Foundation
import Observation
import UIKit

/// One import, from the file to the result (the web's ImportView steps:
/// Upload, Columns, Preview, Import). Holds the table the server returned,
/// the columns, the splits, what's ticked and each show's match; every
/// step that reads the file asks `import-sheet` again with the table.
@MainActor
@Observable
public final class ImportSession {
    public enum Step: Equatable, Sendable { case start, columns, review, importing, done }

    public private(set) var step: Step = .start
    public private(set) var fileName = ""
    public private(set) var table: SheetTable?
    /// Field key → column index.
    public var mapping: [String: Int] = [:]
    public private(set) var dateOrder = "mdy"
    /// The person said how the file writes dates (asked when one could be read two ways).
    public private(set) var dateOrderConfirmed = false
    public private(set) var split: Set<Int> = []
    public private(set) var shows: [PlannedShow] = []
    /// By the show's key (band and day), as the web keeps them.
    public private(set) var matches: [String: SheetMatch] = [:]
    private var picks: [String: Bool] = [:]
    public private(set) var working = false
    public private(set) var problem: String?
    public private(set) var checking = false
    public private(set) var checkingStopped = false
    public private(set) var progress: (done: Int, total: Int) = (0, 0)
    public private(set) var result: ImportResult?
    /// From a screenshot: the columns are known, so there's no columns step.
    public private(set) var fromScreenshot = false

    private let importer: SheetImporter?
    private var stopChecks = false
    private var stopImport = false
    private let gap: Duration

    /// The web paces setlist lookups 600 ms apart (lib/importMatch.js GAP_MS).
    public init(importer: SheetImporter?, gap: Duration = .milliseconds(600)) {
        self.importer = importer
        self.gap = gap
    }

    // MARK: The file

    /// Reads a picked file and asks the server to parse it.
    public func load(fileAt url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if let problem = SheetImporter.problem(fileName: url.lastPathComponent, size: size) { self.problem = problem; return }
        guard let data = try? Data(contentsOf: url) else { problem = "That file couldn\u{2019}t be read. Try saving it again."; return }
        await load(data, fileName: url.lastPathComponent)
    }

    public func load(_ data: Data, fileName: String) async {
        guard let importer else { problem = SheetImporter.message(for: .offline); return }
        if let problem = SheetImporter.problem(fileName: fileName, size: data.count) { self.problem = problem; return }
        working = true
        problem = nil
        defer { working = false }
        do throws(APIError) {
            let parsed = try await importer.parse(data, fileName: fileName)
            begin(parsed, fileName: fileName, screenshot: false)
            step = .columns
        } catch {
            problem = SheetImporter.message(for: error)
        }
    }

    /// Reads the shows in a screenshot, then plans them like a file's.
    public func load(screenshot image: UIImage) async {
        guard let importer else { problem = SheetImporter.message(for: .offline, screenshot: true); return }
        guard let jpeg = TicketScan.prepare(image) else { problem = "That image is too large. Try a smaller screenshot."; return }
        working = true
        problem = nil
        defer { working = false }
        do throws(APIError) {
            let found = try await importer.screenshot(jpeg)
            guard !found.isEmpty else { problem = "No shows were found in this screenshot. Try one that shows your past events."; return }
            begin(.screenshot(found), fileName: "Screenshot", screenshot: true)
        } catch {
            problem = SheetImporter.message(for: error, screenshot: true)
            return
        }
        await plan()
    }

    private func begin(_ parsed: SheetTable, fileName: String, screenshot: Bool) {
        table = parsed
        self.fileName = fileName
        fromScreenshot = screenshot
        mapping = parsed.mapping
        dateOrder = parsed.dateOrder
        dateOrderConfirmed = !parsed.dateOrderAmbiguous
        split = []
        shows = []
        matches = [:]
        picks = [:]
        result = nil
        checkingStopped = false
    }

    // MARK: Columns

    /// The required fields with no column yet ("Choose the column for Artist and Date.").
    public var missingColumns: [SheetColumn] {
        SheetColumn.all.filter { $0.required && mapping[$0.key] == nil }
    }

    public func setColumn(_ key: String, to index: Int?) {
        mapping[key] = index
    }

    /// Columns chosen: plan the rows.
    public func confirmColumns() async {
        guard missingColumns.isEmpty else { return }
        await plan()
    }

    // MARK: Review

    public var ambiguousCount: Int { shows.filter(\.ambiguousDate).count }
    public var needsDateOrder: Bool { ambiguousCount > 0 && !dateOrderConfirmed }

    public func setDateOrder(_ order: String) async {
        dateOrder = order == "dmy" ? "dmy" : "mdy"
        dateOrderConfirmed = true
        await plan()
    }

    /// Rows listing more than one act that aren't split yet.
    public var splittableRows: [Int] {
        Array(Set(shows.filter { $0.canSplit && $0.problem.isEmpty && !split.contains($0.rowIndex) }.map(\.rowIndex))).sorted()
    }

    public func toggleSplit(_ rowIndex: Int) async {
        if split.contains(rowIndex) { split.remove(rowIndex) } else { split.insert(rowIndex) }
        await plan()
    }

    public func splitAll() async {
        split.formUnion(shows.filter { $0.canSplit && $0.problem.isEmpty }.map(\.rowIndex))
        await plan()
    }

    /// ImportView's isPicked: never a problem or a duplicate; an artist
    /// setlist.fm has never heard of starts unticked (usually a typo).
    public func isPicked(_ show: PlannedShow) -> Bool {
        guard show.importable else { return false }
        if let pick = picks[show.id] { return pick }
        return matches[show.key]?.unknownArtist != true
    }

    public func setPicked(_ show: PlannedShow, _ on: Bool) {
        guard show.importable else { return }
        picks[show.id] = on
    }

    public var pickedCount: Int { shows.filter(isPicked).count }
    public var importableCount: Int { shows.filter(\.importable).count }
    public var checkedCount: Int { shows.filter { $0.importable && matches[$0.key] != nil }.count }
    public var canImport: Bool { pickedCount > 0 && !needsDateOrder && !working }

    private func plan() async {
        guard let importer, let table else { return }
        working = true
        problem = nil
        defer { working = false }
        do throws(APIError) {
            shows = try await importer.plan(table, mapping: mapping, dateOrder: dateOrder, split: split).shows
            step = .review
        } catch {
            problem = SheetImporter.message(for: error)
        }
    }

    // MARK: Setlists, before anything is saved

    /// Matches each importable show not matched yet, one at a time, paced.
    public func checkSetlists() async {
        guard let importer, !checking else { return }
        checking = true
        checkingStopped = false
        stopChecks = false
        defer { checking = false }
        var seen = Set<String>()
        let queue = shows.filter { $0.importable && matches[$0.key] == nil && seen.insert($0.key).inserted }
        for (i, show) in queue.enumerated() {
            if stopChecks || step != .review { checkingStopped = stopChecks; return }
            if i > 0 { try? await Task.sleep(for: gap) }
            do throws(APIError) {
                matches[show.key] = try await importer.match(show)
            } catch {
                // A daily limit or no connection: stop; the rest are matched as they're saved.
                problem = SheetImporter.message(for: error)
                checkingStopped = true
                return
            }
        }
    }

    public func stopChecking() { stopChecks = true }

    // MARK: Import

    /// Saves the ticked shows (lib/importMatch.js importShows): each matched
    /// first if the review didn't reach it, then committed 25 at a time.
    /// Stop keeps what's saved.
    public func importPicked(into store: ShowsStore) async {
        guard let importer, canImport else { return }
        stopChecks = true
        stopImport = false
        var result = ImportResult()
        let unmatched = { (show: PlannedShow, reason: String) -> ImportResult.Unmatched in
            .init(rowIndex: show.rowIndex, artist: show.part > 0 || self.split.contains(show.rowIndex) ? show.artist : nil, reason: reason)
        }
        var chosen: [PlannedShow] = []
        for show in shows {
            if !show.problem.isEmpty { result.unmatched.append(unmatched(show, show.problem)) }
            else if show.duplicate != nil { result.duplicates += 1 }
            else if isPicked(show) { chosen.append(show) }
            else if let m = matches[show.key], m.unknownArtist { result.unmatched.append(unmatched(show, m.reason)) }
            else { result.leftOut += 1 }
        }
        step = .importing
        progress = (0, chosen.count)
        var batch: [(show: PlannedShow, match: SheetMatch)] = []

        func flush() async {
            guard !batch.isEmpty else { return }
            let items = batch.compactMap { pair in pair.match.showInput().map { ($0, pair.match.display!) } }
            let outcomes = await store.importRows(items)
            for (pair, outcome) in zip(batch, outcomes) {
                switch outcome {
                case .added:
                    result.imported += 1
                    if pair.match.hasSetlist { result.withSetlists += 1 }
                    if pair.match.proposal { result.toReview += 1 }
                case .alreadyThere, .skippedPossible: result.duplicates += 1
                case .queued: result.queued += 1
                case .refused(let why): result.unmatched.append(unmatched(pair.show, "Not saved: \(why)"))
                }
            }
            progress.done += batch.count
            batch = []
        }

        for (i, show) in chosen.enumerated() {
            if stopImport {
                await flush()
                result.cancelled = true
                result.leftOut += chosen.count - i
                break
            }
            var match = matches[show.key]
            if match == nil {
                try? await Task.sleep(for: gap)
                do throws(APIError) {
                    match = try await importer.match(show)
                    matches[show.key] = match
                } catch {
                    // Offline or a limit mid-import: what's saved stays; the rest is left for next time.
                    await flush()
                    problem = SheetImporter.message(for: error)
                    result.cancelled = true
                    result.leftOut += chosen.count - i
                    break
                }
            }
            guard let match else { continue }
            if match.input == nil {
                result.unmatched.append(unmatched(show, match.skip ?? match.reason))
                progress.done += 1
                continue
            }
            batch.append((show, match))
            if batch.count == NormalizeShowRequest.maxInputs { await flush() }
        }
        if !result.cancelled { await flush() }
        self.result = result
        step = .done
    }

    public func stopImporting() { stopImport = true }

    /// Back to the start, for another file.
    public func reset() {
        stopChecks = true
        step = .start
        table = nil
        fileName = ""
        shows = []
        matches = [:]
        picks = [:]
        split = []
        result = nil
        problem = nil
        fromScreenshot = false
    }

    /// Back from the review to the columns (a file only).
    public func editColumns() {
        guard !fromScreenshot, table != nil else { return }
        stopChecks = true
        step = .columns
    }
}
