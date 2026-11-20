import Core
import DesignSystem
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Importing shows (Stage 6, 6-7; the web's ImportView), from + on Shows,
// accounts only: a spreadsheet (.csv, .xlsx) read by `import-sheet`, or a
// screenshot of a ticket site's past events read by `analyze-screenshot`.
// Columns, then a review where each show is matched to its setlist before
// anything is saved, then the import.

struct ImportShowsView: View {
    @Environment(ShowsStore.self) private var store
    let finish: () -> Void
    @State private var model: ImportSession?

    var body: some View {
        Group {
            if let model {
                switch model.step {
                case .start: ImportStartView(model: model)
                case .columns: ImportColumnsView(model: model)
                case .review: ImportReviewView(model: model)
                case .importing: ImportProgressView(model: model)
                case .done: ImportDoneView(model: model, finish: finish)
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Import shows")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.map { $0.step == .importing } ?? false)
        .onAppear { if model == nil { model = ImportSession(importer: store.sheetImporter) } }
    }
}

// MARK: - Start

private struct ImportStartView: View {
    let model: ImportSession
    @State private var choosingFile = false
    @State private var screenshot: PhotosPickerItem?
    @State private var pickingScreenshot = false
    @State private var template: URL?

    /// The web's template (ImportView downloadTemplate).
    static let templateCSV = "Artist,Date,Venue,City,State,Country,Rating,Notes,Tour\r\n\"Goose\",\"2024-06-15\",\"Forest Hills Stadium\",\"Queens\",\"NY\",\"USA\",\"9\",\"Incredible Arcadia\",\"\"\r\n"

    private static let types: [UTType] = [.commaSeparatedText, .plainText, .spreadsheet]
        + ["xlsx", "xls"].compactMap { UTType(filenameExtension: $0) }

    var body: some View {
        List {
            Section {
                Button { choosingFile = true } label: {
                    Label("Choose a spreadsheet", systemImage: "tablecells")
                }
                .disabled(model.working)
            } header: {
                Text("A file of your shows")
            } footer: {
                Text("A .csv or .xlsx file, one show per row, with an artist and a date. Venue, city, state, country, rating, notes and tour come along if they're there. Column names don't matter: you'll match them up next. Up to 2 MB and 2,000 rows.\n\nFrom Google Sheets: File → Download → CSV or Excel. From Concert Archives: export or copy your concerts into a spreadsheet.")
            }
            .brandRow()

            if let template {
                Section {
                    ShareLink(item: template) { Label("Get a template (.csv)", systemImage: "doc.badge.arrow.up") }
                } footer: {
                    Text("The columns the import knows, with one example row.")
                }
                .brandRow()
            }

            Section {
                // The modifier, not an inline PhotosPicker: a one-photo picker
                // in a List row closed the whole add sheet when it closed.
                Button { pickingScreenshot = true } label: {
                    Label("Choose a screenshot", systemImage: "photo")
                }
                .disabled(model.working)
            } header: {
                Text("A screenshot")
            } footer: {
                Text("Of a ticket site's past events or order history, like Ticketmaster, AXS or SeatGeek. It's read once and not kept.")
            }
            .brandRow()

            if model.working {
                Section {
                    HStack(spacing: Space.x2) {
                        ProgressView()
                        Text("Reading it…").font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                }
                .brandRow()
            }
            if let problem = model.problem {
                Section { Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber) }
                    .brandRow()
            }
        }
        .brandScreen()
        .task {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("mysetlists-import-template.csv")
            if (try? Self.templateCSV.write(to: url, atomically: true, encoding: .utf8)) != nil { template = url }
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: Self.types) { picked in
            guard case .success(let url) = picked else { return }
            Task { await model.load(fileAt: url) }
        }
        .photosPicker(isPresented: $pickingScreenshot, selection: $screenshot, matching: .images)
        .onChange(of: screenshot) {
            guard let item = screenshot else { return }
            screenshot = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return }
                await model.load(screenshot: image)
            }
        }
    }
}

// MARK: - Columns

private struct ImportColumnsView: View {
    @Bindable var model: ImportSession

    var body: some View {
        let table = model.table
        List {
            Section {
                Text("\(rowsText(table?.rows.count ?? 0)) in \(model.fileName). Fix any column that's wrong.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
                if table?.truncated == true {
                    Text("Only the first 2,000 rows and 30 columns are imported, and very long cells are cut.")
                        .font(.brand(.sm)).foregroundStyle(Color.amber)
                }
            }
            .brandRow()

            Section("Columns") {
                ForEach(SheetColumn.all) { column in
                    Picker(selection: Binding(get: { model.mapping[column.key] }, set: { model.setColumn(column.key, to: $0) })) {
                        Text("Not in this file").tag(Int?.none)
                        ForEach(Array((table?.headers ?? []).enumerated()), id: \.offset) { i, header in
                            Text(header.isEmpty ? "Column \(i + 1)" : header).tag(Int?.some(i))
                        }
                    } label: {
                        Text(column.required ? "\(column.label) *" : column.label)
                    }
                }
            }
            .brandRow()

            if let table, !table.rows.isEmpty {
                Section("First rows") {
                    ForEach(Array(table.rows.prefix(3).enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(value(row, "artist").isEmpty ? "No artist" : value(row, "artist")).font(.brand(.sm, weight: .semibold))
                            Text([value(row, "date"), value(row, "venue"), value(row, "city")].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .brandRow()
            }

            Section {
                if !model.missingColumns.isEmpty {
                    Text("Choose the column for \(model.missingColumns.map(\.label).joined(separator: " and ")).")
                        .font(.brand(.sm)).foregroundStyle(Color.amber)
                }
                if let problem = model.problem {
                    Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber)
                }
            }
            .brandRow()
        }
        .brandScreen()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Another file") { model.reset() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button { Task { await model.confirmColumns() } } label: {
                    if model.working { ProgressView() } else { Text("Next") }
                }
                .disabled(!model.missingColumns.isEmpty || model.working)
            }
        }
    }

    private func value(_ row: [String], _ key: String) -> String {
        guard let i = model.mapping[key], row.indices.contains(i) else { return "" }
        return row[i]
    }

    private func rowsText(_ n: Int) -> String { n == 1 ? "1 row" : "\(n) rows" }
}

// MARK: - Review

private struct ImportReviewView: View {
    @Environment(ShowsStore.self) private var store
    let model: ImportSession

    var body: some View {
        List {
            Section {
                Text("Each show is matched to its setlist. Untick anything you don't want. Nothing is saved until you import.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
            }
            .brandRow()

            if model.needsDateOrder {
                Section {
                    Text("\(model.ambiguousCount == 1 ? "1 date" : "\(model.ambiguousCount) dates") could be read two ways (like 03/04/2019). How does this file write dates?")
                        .font(.brand(.sm)).foregroundStyle(Color.amber)
                    Button("Month first (03/04 is March 4)") { Task { await model.setDateOrder("mdy") } }
                    Button("Day first (03/04 is 3 April)") { Task { await model.setDateOrder("dmy") } }
                }
                .brandRow()
            }

            if !model.splittableRows.isEmpty {
                Section {
                    Text("\(model.splittableRows.count == 1 ? "1 row lists" : "\(model.splittableRows.count) rows list") more than one artist, like a festival or a bill.")
                        .font(.brand(.sm))
                    Button("Split all into separate shows", systemImage: "scissors") { Task { await model.splitAll() } }
                }
                .brandRow()
            }

            Section {
                checkingStatus
                ForEach(model.shows) { show in
                    ImportShowRow(model: model, show: show)
                }
            } header: {
                Text("\(model.pickedCount) of \(model.shows.count) to import")
            } footer: {
                Text("Setlists come from the band's own archive where it has one, then the Internet Archive, then setlist.fm.")
            }
            .brandRow()

            if let problem = model.problem {
                Section { Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber) }
                    .brandRow()
            }
        }
        .brandScreen()
        .disabled(model.working)
        .overlay { if model.working { ProgressView() } }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if model.fromScreenshot {
                    Button("Start over") { model.reset() }
                } else {
                    Button("Columns") { model.editColumns() }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Import \(model.pickedCount)") { Task { await model.importPicked(into: store) } }
                    .disabled(!model.canImport)
            }
        }
        // Again after a re-plan (a split, the date order): only the new shows are asked about.
        .task(id: model.shows.map(\.key)) { await model.checkSetlists() }
    }

    @ViewBuilder private var checkingStatus: some View {
        let total = model.importableCount
        if model.checking {
            HStack(spacing: Space.x2) {
                ProgressView()
                Text("Finding setlists: \(model.checkedCount) of \(total)").font(.brand(.sm)).foregroundStyle(.secondary)
                Spacer()
                Button("Stop") { model.stopChecking() }.buttonStyle(.borderless)
            }
        } else if model.checkedCount < total {
            HStack {
                Text("\(total - model.checkedCount) not checked yet; they'll be checked as they're saved.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
                Spacer()
                Button("Check now") { Task { await model.checkSetlists() } }.buttonStyle(.borderless)
            }
        } else if total > 0 {
            Text("All \(total) checked.").font(.brand(.sm)).foregroundStyle(.secondary)
        }
    }
}

private struct ImportShowRow: View {
    let model: ImportSession
    let show: PlannedShow

    var body: some View {
        let match = model.matches[show.key]
        let picked = model.isPicked(show)
        HStack(alignment: .top, spacing: Space.x3) {
            Button {
                model.setPicked(show, !picked)
            } label: {
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(show.importable ? (picked ? Color.brand : Color.textMuted) : Color.textMuted.opacity(0.4))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderless)
            .disabled(!show.importable)
            .accessibilityLabel(picked ? "Import, ticked" : "Import, not ticked")

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(show.artist.isEmpty ? "No artist" : show.artist).font(.brand(.base, weight: .semibold))
                    if let m = match, !m.unknownArtist, !m.artist.isEmpty, m.artist != show.artist {
                        Text("→ \(m.artist)").font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                }
                Text(place).font(.caption).foregroundStyle(.secondary)
                status(match).font(.caption)
                if show.canSplit, show.problem.isEmpty {
                    Button(model.split.contains(show.rowIndex) ? "Keep as one show" : "Split into separate shows", systemImage: "scissors") {
                        Task { await model.toggleSplit(show.rowIndex) }
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.borderless)
                }
            }
        }
        .opacity(show.importable ? 1 : 0.6)
    }

    private var place: String {
        let date = show.date.map { ShowDateText.display($0) } ?? ""
        return [date, show.venue, show.city].filter { !$0.isEmpty }.joined(separator: " · ")
            + (show.ambiguousDate && model.needsDateOrder ? " (check the date)" : "")
    }

    @ViewBuilder private func status(_ m: SheetMatch?) -> some View {
        if !show.problem.isEmpty {
            Text("Can't import: \(show.problem)").foregroundStyle(Color.danger)
        } else if let dup = show.duplicate {
            Text("Skipped: \(dup)").foregroundStyle(.secondary)
        } else if let m {
            if let setlist = m.setlist {
                Text("Setlist from \(m.sourceLabel.isEmpty ? setlist.source : m.sourceLabel) · \(setlist.count == 1 ? "1 song" : "\(setlist.count) songs")")
                    .foregroundStyle(Color.brand)
            } else if m.proposal {
                Text("Setlist from a tape on the Internet Archive, to review").foregroundStyle(Color.amber)
            } else if m.unknownArtist, show.canSplit, !model.split.contains(show.rowIndex) {
                Text("Not matched: this row lists more than one artist. Split it to match each one.").foregroundStyle(Color.danger)
            } else if m.unknownArtist {
                Text("Not matched: \(m.reason) Tick to import anyway.").foregroundStyle(Color.danger)
            } else if let skip = m.skip {
                Text("Can't import: \(skip)").foregroundStyle(Color.danger)
            } else {
                Text("No setlist found\(m.status == "error" ? " (\(m.reason))" : ""); imports without one").foregroundStyle(.secondary)
            }
        } else {
            Text("Checking…").foregroundStyle(.secondary)
        }
    }
}

// MARK: - Importing and done

private struct ImportProgressView: View {
    let model: ImportSession

    var body: some View {
        VStack(spacing: Space.x4) {
            ProgressView(value: Double(model.progress.done), total: Double(max(model.progress.total, 1)))
                .tint(.brand)
            Text("Importing… \(model.progress.done) of \(model.progress.total)")
                .font(.brand(.base, weight: .semibold))
            Button("Stop (keeps what's saved)") { model.stopImporting() }
                .buttonStyle(.bordered)
        }
        .padding(Space.x6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .brandScreen()
        .interactiveDismissDisabled()
    }
}

private struct ImportDoneView: View {
    let model: ImportSession
    let finish: () -> Void
    @State private var csvURL: URL?

    var body: some View {
        let result = model.result ?? ImportResult()
        List {
            Section {
                Label(result.cancelled ? "Import stopped" : "Import complete", systemImage: "checkmark.circle.fill")
                    .font(.brand(.lg, weight: .semibold))
                    .foregroundStyle(Color.brand)
                Text(result.summary).font(.brand(.sm))
                if result.toReview > 0 {
                    Text("Tape setlists from the Internet Archive are waiting for you to review on the show's page. Tape setlists can be incomplete, so nothing is written until you accept one.")
                        .font(.brand(.sm)).foregroundStyle(.secondary)
                }
                if let problem = model.problem {
                    Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber)
                }
            }
            .brandRow()

            if !result.unmatched.isEmpty {
                Section {
                    ForEach(Array(result.unmatched.prefix(100).enumerated()), id: \.offset) { _, miss in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name(miss)).font(.brand(.sm, weight: .semibold))
                            Text(miss.reason).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if let csvURL {
                        ShareLink(item: csvURL) {
                            Label("Share the \(result.unmatched.count) not imported as a CSV", systemImage: "square.and.arrow.up")
                        }
                    }
                } header: {
                    Text("Not imported")
                } footer: {
                    Text("Fix them in the spreadsheet and import that file again; the shows already saved are skipped as duplicates.")
                }
                .brandRow()
            }
        }
        .brandScreen()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Import another") { model.reset() } }
            ToolbarItem(placement: .confirmationAction) { Button("Done") { finish() } }
        }
        .task { csvURL = writeCSV(result) }
    }

    private func name(_ miss: ImportResult.Unmatched) -> String {
        if let artist = miss.artist { return "Row \(miss.rowIndex + 2): \(artist)" }
        guard let table = model.table, table.rows.indices.contains(miss.rowIndex),
              let col = model.mapping["artist"], table.rows[miss.rowIndex].indices.contains(col) else { return "Row \(miss.rowIndex + 2)" }
        let artist = table.rows[miss.rowIndex][col]
        return artist.isEmpty ? "Row \(miss.rowIndex + 2)" : "Row \(miss.rowIndex + 2): \(artist)"
    }

    private func writeCSV(_ result: ImportResult) -> URL? {
        guard let table = model.table, !result.unmatched.isEmpty else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("not-imported.csv")
        do {
            try result.unmatchedCSV(table, artistColumn: model.mapping["artist"]).write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            return nil
        }
    }
}
