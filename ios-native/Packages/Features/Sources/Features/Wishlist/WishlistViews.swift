import Core
import DesignSystem
import SwiftUI

// The song wishlist (Stage 4, 4-9), as the web's WishlistView: your
// wishlists by band, a band search (setlist.fm), and for one band the songs
// you want to see, every song (setlist.fm's live catalog plus yours), and
// the songs you've seen. Stars write the web's `wishlists` documents
// (`WishlistService`). Guests too: the rules let them keep their own.

/// `/wishlist`: the bands you've starred songs for, and a search for another.
struct WishlistHome: View {
    @Environment(SessionStore.self) private var session
    @State private var summaries: [WishlistSummary]?
    @State private var loadProblem: String?
    @State private var query = ""
    @State private var results: [SetlistfmSearch.Artist]?
    @State private var searching = false
    @State private var searchProblem: String?

    var body: some View {
        List {
            if searching || results != nil || searchProblem != nil {
                Section {
                    if searching {
                        HStack { Text("Searching setlist.fm"); Spacer(); ProgressView() }
                            .foregroundStyle(Color.textSecondary)
                    } else if let searchProblem {
                        Text(searchProblem).foregroundStyle(Color.amber)
                    } else if let results, results.isEmpty {
                        Text("No bands found. Try a different search.")
                            .foregroundStyle(Color.textSecondary)
                    } else if let results {
                        ForEach(results) { a in
                            NavigationLink(value: AppRoute.wishlistArtist(WishlistArtist(name: a.name, mbid: a.mbid))) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.name)
                                        .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                                        .foregroundStyle(Color.textPrimary)
                                    if let d = a.disambiguation, !d.isEmpty {
                                        Text(d)
                                            .font(.jakarta(size: 13, relativeTo: .footnote))
                                            .foregroundStyle(Color.textSecondary)
                                    }
                                }
                            }
                        }
                    }
                } header: {
                    Text("Bands on setlist.fm")
                }
                .brandRow()
            }

            Section {
                if let summaries {
                    if summaries.isEmpty {
                        Text("Search for a band above to see the songs you've caught live and star the ones you haven't.")
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(Color.textSecondary)
                    } else {
                        ForEach(summaries) { s in
                            NavigationLink(value: AppRoute.wishlistArtist(s.artist)) {
                                HStack {
                                    Text(s.artist.name)
                                        .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                                        .foregroundStyle(Color.textPrimary)
                                    Spacer(minLength: Space.x2)
                                    Text(s.songCount == 1 ? "1 song" : "\(s.songCount) songs")
                                        .font(.jakarta(size: 13, relativeTo: .footnote))
                                        .monospacedDigit()
                                        .foregroundStyle(Color.amber)
                                }
                            }
                        }
                    }
                } else if let loadProblem {
                    HStack {
                        Text(loadProblem).foregroundStyle(Color.amber)
                        Spacer()
                        Button("Try again") { Task { await load() } }.buttonStyle(.borderless)
                    }
                } else {
                    HStack { Text("Loading your wishlists"); Spacer(); ProgressView() }
                        .foregroundStyle(Color.textSecondary)
                }
            } header: {
                Text("Your wishlists")
            } footer: {
                Text("Pick a band, see what you've caught live, and star the songs you're still chasing.")
            }
            .brandRow()
        }
        .navigationTitle("Wishlist")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search for a band")
        .onSubmit(of: .search) { Task { await search() } }
        .onChange(of: query) {
            if query.trimmingCharacters(in: .whitespaces).isEmpty { results = nil; searchProblem = nil }
        }
        // Runs each time the hub appears, so a band's first star shows on the way back.
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let uid = session.user?.uid else { return }
        loadProblem = nil
        do {
            summaries = try await WishlistService.summaries(uid: uid)
        } catch {
            if summaries == nil { loadProblem = "Couldn't load your wishlists. Check your connection." }
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        searching = true
        searchProblem = nil
        defer { searching = false }
        do {
            let found = try await SetlistfmSearch(api: session.api).artists(named: q)
            results = Array(found.prefix(10))
        } catch {
            results = nil
            searchProblem = TourLookups.message(error)
        }
    }
}

/// One band's wishlist: the songs you want to see, every song, the songs
/// you've seen. A star is saved at once and goes back if the write fails.
struct WishlistArtistScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    let artist: WishlistArtist

    private enum Catalog {
        case loading
        case ready([ArtistSongStats.Song])
        case failed(String)
    }

    @State private var entries: [String: WishlistEntry]?
    @State private var catalog: Catalog = .loading
    @State private var pending: Set<String> = []
    @State private var failed: Set<String> = []
    @State private var notice: String?
    @State private var query = ""
    @State private var attempt = 0

    private var catalogSongs: [ArtistSongStats.Song] {
        if case .ready(let songs) = catalog { return songs }
        return []
    }

    private var catalogLoading: Bool {
        if case .loading = catalog { return true }
        return false
    }

    private var catalogProblem: String? {
        if case .failed(let message) = catalog { return message }
        return nil
    }

    var body: some View {
        let seen = Wishlist.seen(store.shows, artist: artist.name)
        let all = Wishlist.allSongs(catalog: catalogSongs, seen: seen)
        let starred = (entries.map { Array($0.values) } ?? [])
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        List {
            wantSection(starred)
            allSection(all, seen: seen)
            seenSection(seen)
        }
        .navigationTitle(artist.name)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Songs")
        .task(id: attempt) { await load() }
        .refreshable { attempt += 1 }
        .notice($notice)
    }

    private func matches(_ title: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty || title.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }

    // MARK: Sections

    @ViewBuilder private func wantSection(_ starred: [WishlistEntry]) -> some View {
        Section {
            if entries == nil {
                HStack { Text("Loading your wishlist"); Spacer(); ProgressView() }
                    .foregroundStyle(Color.textSecondary)
            } else if starred.isEmpty {
                Text("Star songs below to add them to your wishlist.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            } else {
                ForEach(starred.filter { matches($0.title) }) { entry in
                    starRow(entry.title, key: entry.key, meta: nil, sub: nil)
                }
            }
        } header: {
            Text(entries.map { "Songs I want to see · \($0.count)" } ?? "Songs I want to see")
        }
        .brandRow()
    }

    @ViewBuilder private func allSection(_ all: [Wishlist.Song], seen: [Wishlist.Seen]) -> some View {
        Section {
            if catalogLoading {
                HStack { Text("Loading the catalog from setlist.fm"); Spacer(); ProgressView() }
                    .foregroundStyle(Color.textSecondary)
            } else {
                if let message = catalogProblem {
                    VStack(alignment: .leading, spacing: Space.x2) {
                        Text("Couldn't load the catalog")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                        Text(message)
                            .font(.jakarta(size: 13, relativeTo: .footnote))
                            .foregroundStyle(Color.textSecondary)
                        if artist.mbid != nil {
                            Button("Try again") { attempt += 1 }.buttonStyle(.bordered).tint(.brand)
                        }
                    }
                    .padding(.vertical, Space.x1)
                }
                if all.isEmpty {
                    if catalogProblem == nil {
                        Text("No catalog data available for this band.")
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(Color.textSecondary)
                    }
                } else {
                    if Wishlist.seenEverything(catalog: catalogSongs, seen: seen) {
                        Text("You've seen everything setlist.fm has on record for \(artist.name) live. Nice.")
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(Color.brand)
                    }
                    ForEach(all.filter { matches($0.title) }) { song in
                        starRow(song.title, key: song.key,
                                meta: song.plays > 0 ? "played \(song.plays.formatted())×" : nil,
                                sub: song.seenCount > 0 ? "you've seen this \(song.seenCount)×" : nil)
                    }
                }
            }
        } header: {
            Text(all.isEmpty ? "All songs" : "All songs · \(all.count.formatted())")
        } footer: {
            if !catalogSongs.isEmpty { Text("Song catalog from setlist.fm.") }
        }
        .brandRow()
    }

    @ViewBuilder private func seenSection(_ seen: [Wishlist.Seen]) -> some View {
        Section {
            if seen.isEmpty {
                Text("No logged shows for \(artist.name) yet. Songs you've seen live show up here.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            } else {
                ForEach(seen.filter { matches($0.title) }) { song in
                    let slug = SongIndex.songSlug(song.title)
                    let row = HStack(spacing: Space.x2) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(song.title)
                                .font(.jakarta(size: 15, relativeTo: .body))
                                .foregroundStyle(Color.textPrimary)
                            if !catalogSongs.isEmpty, !Wishlist.isInCatalog(song.title, catalog: catalogSongs) {
                                Text("NO SETLIST.FM RECORD")
                                    .font(.jakarta(size: 10, weight: .semibold, relativeTo: .caption2))
                                    .tracking(0.5)
                                    .foregroundStyle(Color.textMuted)
                            }
                        }
                        Spacer(minLength: Space.x2)
                        Text("\(song.count)×")
                            .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                            .monospacedDigit()
                            .foregroundStyle(Color.brand)
                    }
                    if slug.isEmpty {
                        row
                    } else {
                        NavigationLink(value: AppRoute.song(artist: SongIndex.artistSlug(artist.name), song: slug)) { row }
                    }
                }
            }
        } header: {
            Text("The songs I've seen · \(seen.count)")
        }
        .brandRow()
    }

    /// A song with its star: starred amber, a short note while a save failed.
    private func starRow(_ title: String, key: String, meta: String?, sub: String?) -> some View {
        let checked = entries?[key] != nil
        let busy = pending.contains(key)
        return Button { toggle(title) } label: {
            HStack(spacing: Space.x3) {
                Image(systemName: checked ? "star.fill" : "star")
                    .foregroundStyle(checked ? Color.amber : Color.textMuted)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: Space.x2) {
                        Text(title)
                            .font(.jakarta(size: 15, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                            .multilineTextAlignment(.leading)
                        if let meta {
                            Text(meta)
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .monospacedDigit()
                                .foregroundStyle(Color.textMuted)
                        }
                    }
                    if let sub {
                        Text(sub)
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                    }
                    if failed.contains(key) {
                        Text("Couldn't save. Try again.")
                            .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                            .foregroundStyle(Color.amber)
                    }
                }
                Spacer(minLength: 0)
                if busy { ProgressView().controlSize(.small) }
            }
            .frame(minHeight: TouchTarget.minimum)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy || entries == nil)
        .accessibilityLabel(checked ? "Remove \(title) from your wishlist" : "Add \(title) to your wishlist")
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    // MARK: Loading and saving

    private func load() async {
        if let uid = session.user?.uid {
            do {
                let list = try await WishlistService.entries(uid: uid, artist: artist)
                entries = Dictionary(list.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
            } catch {
                if entries == nil { entries = [:] }
                notice = "Couldn't load your wishlist for \(artist.name). Pull to try again."
            }
        }
        guard let mbid = artist.mbid else {
            catalog = .failed("This band doesn't have a matched setlist.fm profile, so catalog data isn't available.")
            return
        }
        if case .ready = catalog { return }
        catalog = .loading
        do {
            catalog = .ready(try await WishlistService.catalog(mbid: mbid, api: session.api))
        } catch {
            catalog = .failed(TourLookups.message(error))
        }
    }

    private func toggle(_ title: String) {
        guard let uid = session.user?.uid, let key = Wishlist.songKey(title), !pending.contains(key) else { return }
        let starring = entries?[key] == nil
        failed.remove(key)
        pending.insert(key)
        if starring { entries?[key] = WishlistEntry(key: key, title: title, addedAt: nil) } else { entries?[key] = nil }
        let artist = self.artist
        Task {
            do {
                if starring {
                    try await WishlistService.add(uid: uid, artist: artist, title: title)
                } else {
                    try await WishlistService.remove(uid: uid, artist: artist, title: title)
                }
            } catch {
                // Back as it was, with a note on the row for a few seconds.
                if starring { entries?[key] = nil } else { entries?[key] = WishlistEntry(key: key, title: title, addedAt: nil) }
                failed.insert(key)
                notice = "Couldn't save your wishlist change. Try again."
                Task {
                    try? await Task.sleep(for: .seconds(5))
                    failed.remove(key)
                }
            }
            pending.remove(key)
        }
    }
}
