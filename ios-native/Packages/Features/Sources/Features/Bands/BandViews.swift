import Core
import DesignSystem
import SwiftUI

// Bands (Stage 4, 4-5): the band page and the band's song page, replacing
// the #451 stand-in (Follow + a web link). Your side comes from your own
// shows (`BandPersonal`); a band in config/public-artists.json also gets its
// own stats from the public snapshot (`BandService`, /api/artist), as the
// web's BandScreen draws them. Artist info is "About <band>".

/// What loading a snapshot came to.
enum SnapshotState<T> {
    case loading
    case ready(T)
    case failed(BandLoadError)
    /// No snapshot for this band (not a public band, or not shown now).
    case none
}

/// Where `/bands/?band=<slug>` leads: any band you've logged or follow.
struct BandScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    let slug: String
    @State private var snapshot: SnapshotState<BandSnapshot> = .loading
    @State private var attempt = 0
    @State private var follow = FollowFlow()

    /// The public band this slug names, if any.
    private var publicBand: PublicBand? { BandDirectory.band(forSlug: slug) }

    /// The band's name: the public band's, else as you log or follow it.
    private var name: String {
        publicBand?.name ?? BandFollows.name(forSlug: slug, follows: session.profile?.favoriteArtists ?? [],
                                             seen: store.shows.map(\.artist) + store.upcoming.map(\.artist))
    }

    var body: some View {
        let personal = BandPersonal(shows: store.shows, name: name, key: StatsKeys.bandKey(name))
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) {
                header
                YouAndBand(name: name, personal: personal, slugs: slugs, bandSlug: publicBand?.slug)
                AboutBand(name: name)
                snapshotSections(personal)
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) } }
        .followFlow(follow, session: session)
        .refreshable { attempt += 1 }
        .task(id: "\(slug)|\(attempt)") { await load() }
    }

    private var slugs: BandSongSlugs? {
        guard case .ready(let s) = snapshot, let band = publicBand else { return nil }
        return BandSongSlugs(s, band: band)
    }

    private func load() async {
        guard let band = publicBand else { snapshot = .none; return }
        if let hit = BandService.shared.cachedBand(band.slug) { snapshot = .ready(hit); return }
        guard await BandService.shared.isShowable(band, api: session.api) else { snapshot = .none; return }
        snapshot = .loading
        do {
            snapshot = .ready(try await BandService.shared.band(band.slug, api: session.api))
        } catch {
            snapshot = .failed(error)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            HStack(alignment: .firstTextBaseline, spacing: Space.x3) {
                Text(name)
                    .font(.jakarta(size: 28, weight: .heavy, relativeTo: .largeTitle))
                    .foregroundStyle(Color.amber)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Space.x2)
                FollowBandButton(name: name, flow: follow)
            }
            if case .ready(let s) = snapshot {
                let stats = s.band
                Text(BandText.showsLine(stats))
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                FigureGrid(figures: [
                    (stats.totalShows.formatted(), "Shows", nil),
                    (stats.songCount.formatted(), stats.isWindowed(s.artist) ? "Songs (recent)" : "Songs", nil),
                    (ShowDateText.display(stats.firstShow?.date ?? ""), "First show", nil),
                    (ShowDateText.display(stats.lastShow?.date ?? ""), "Last show", nil),
                ])
                if stats.isWindowed(s.artist), let c = s.artist.coverage {
                    Text("Song stats cover the \((c.shows ?? 0).formatted()) most recent setlists, \(ShowDateText.display(c.from ?? "")) to \(ShowDateText.display(c.to ?? "")).")
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textMuted)
                }
            }
        }
    }

    // MARK: The band's own stats

    @ViewBuilder
    private func snapshotSections(_ personal: BandPersonal) -> some View {
        switch snapshot {
        case .none:
            EmptyView()
        case .loading:
            ProgressView("Loading \(name) stats")
                .frame(maxWidth: .infinity)
                .padding(.vertical, Space.x6)
        case .failed(let error):
            BandLoadErrorView(error: error, name: name) { attempt += 1 }
        case .ready(let s):
            BandStatsSections(snapshot: s, band: publicBand, personal: personal, slugs: slugs)
        }
    }
}

/// The band's lists, from its snapshot: most played, overdue, not played in
/// five years, bust-outs, recent shows, and the source's credit.
private struct BandStatsSections: View {
    let snapshot: BandSnapshot
    let band: PublicBand?
    let personal: BandPersonal
    let slugs: BandSongSlugs?

    var body: some View {
        let artist = snapshot.artist
        let stats = snapshot.band
        let name = artist.name
        let split = stats.overdueOriginals != nil
        let inWindow = artist.coverage?.kind == "window" ? " in these setlists" : ""
        let recently = "in the five years up to their latest show"

        if !stats.mostPlayed.isEmpty {
            BandSection(title: "Most played \(name) songs", note: nil) {
                ForEach(Array(stats.mostPlayed.enumerated()), id: \.offset) { i, song in
                    songRow(song) {
                        Text(song.timesPlayed.formatted())
                            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                            .monospacedDigit()
                            .foregroundStyle(Color.textPrimary)
                    } leading: {
                        Text("\(i + 1)")
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .monospacedDigit()
                            .foregroundStyle(Color.textMuted)
                            .frame(minWidth: 20, alignment: .leading)
                    }
                    if i < stats.mostPlayed.count - 1 { RowDivider() }
                }
            }
        }

        gapList(split ? "\(name) songs most overdue" : "\(name) songs with the longest gaps",
                note: "Originals played at least 5 times\(inWindow)\(split ? " and at least once \(recently)" : ""), by shows since they were last played.",
                list: split ? (stats.overdueOriginals ?? []) : stats.originalGapLeaders)
        gapList(split ? "\(name) covers most overdue" : "\(name) covers with the longest gaps",
                note: "Covers played at least 5 times\(inWindow)\(split ? " and at least once \(recently)" : ""), by shows since \(name) last played them.",
                list: split ? stats.overdueCovers : stats.coverGapLeaders)
        gapList("\(name) songs not played in 5+ years",
                note: "Originals played at least 5 times\(inWindow) but not \(recently), longest ago first.",
                list: stats.notPlayedSince)

        if !stats.bustOuts.isEmpty {
            BandSection(title: "Biggest \(name) bust-outs",
                        note: "Originals that went the most shows without being played, counted as \(artist.sourceName ?? "the source") counts them.") {
                ForEach(Array(stats.bustOuts.enumerated()), id: \.offset) { i, song in
                    VStack(alignment: .leading, spacing: 2) {
                        songRow(song) {
                            Text("\((song.longestGap ?? 0).formatted()) shows")
                                .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                                .monospacedDigit()
                                .foregroundStyle(Color.textPrimary)
                        } leading: { EmptyView() }
                        Text("\(ShowDateText.display(song.gapStart?.date ?? "")) to \(ShowDateText.display(song.gapEnd?.date ?? ""))")
                            .font(.jakarta(size: 11, relativeTo: .caption2))
                            .foregroundStyle(Color.textMuted)
                        if let show = personal.show(on: song.gapEnd?.date) { ThereBadge(showId: show.id) }
                    }
                    .padding(.bottom, Space.x2)
                    if i < stats.bustOuts.count - 1 { RowDivider() }
                }
            }
        }

        if !stats.recentShows.isEmpty {
            BandSection(title: "Recent \(name) shows", note: nil) {
                ForEach(Array(stats.recentShows.enumerated()), id: \.offset) { i, night in
                    NightRow(night: night, mine: personal.show(on: night.date))
                    if i < stats.recentShows.count - 1 { RowDivider() }
                }
            }
        }

        SourceCredit(artist: artist, extra: nil)
    }

    @ViewBuilder
    private func gapList(_ title: String, note: String, list: [SnapshotSong]) -> some View {
        if !list.isEmpty {
            BandSection(title: title, note: note) {
                ForEach(Array(list.enumerated()), id: \.offset) { i, song in
                    songRow(song) {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(song.currentGap.formatted()) shows")
                                .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                                .monospacedDigit()
                                .foregroundStyle(Color.textPrimary)
                            Text("last \(ShowDateText.display(song.lastPlayed ?? ""))")
                                .font(.jakarta(size: 11, relativeTo: .caption2))
                                .foregroundStyle(Color.textMuted)
                        }
                    } leading: { EmptyView() }
                    if i < list.count - 1 { RowDivider() }
                }
            }
        }
    }

    /// A song: its name (opening its song page when the band has them), a
    /// cover mark, "heard N×", and the row's figure.
    private func songRow<Trailing: View, Leading: View>(_ song: SnapshotSong, @ViewBuilder trailing: () -> Trailing,
                                                         @ViewBuilder leading: () -> Leading) -> some View {
        let heard = personal.song(titled: song.name)?.timesSeen ?? 0
        let content = HStack(alignment: .center, spacing: Space.x3) {
            leading()
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Space.x2) {
                    Text(song.name)
                        .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                        .foregroundStyle(Color.textPrimary)
                        .multilineTextAlignment(.leading)
                    if song.isOriginal == false { CoverTag() }
                }
                if heard > 0 { HeardBadge(count: heard) }
            }
            Spacer(minLength: Space.x2)
            trailing()
        }
        .frame(minHeight: TouchTarget.minimum)
        .contentShape(Rectangle())
        return Group {
            if let band, snapshot.artist.songPages, let slug = song.slug {
                NavigationLink(value: AppRoute.bandSong(band: band.slug, song: slug)) { content }
                    .buttonStyle(.plain)
            } else {
                content
            }
        }
    }
}

/// "You and <band>": your shows, songs heard, first and last, most heard.
private struct YouAndBand: View {
    let name: String
    let personal: BandPersonal
    let slugs: BandSongSlugs?
    let bandSlug: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            SectionTitle("You and \(name)")
            if personal.shows.isEmpty {
                Text("You haven't logged a \(name) show yet. Add one and your songs, gaps and shows appear here.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .brandCard(radius: Radius.xl2)
            } else {
                FigureGrid(figures: [
                    ("\(personal.shows.count)", "Your shows", nil),
                    ("\(personal.songs.count)", "Songs heard", nil),
                    (ShowDateText.display(personal.shows.last?.date ?? ""), "Your first", nil),
                    (ShowDateText.display(personal.shows.first?.date ?? ""), "Your last", nil),
                ])
                NavigationLink(value: AppRoute.myShows(ShowsFilter(kind: .band, title: personal.artistName))) {
                    Label(personal.shows.count == 1 ? "Your show" : "Your \(personal.shows.count) shows", systemImage: "music.note.list")
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                }
                .tint(.brand)
                let top = Array(personal.songs.prefix(10))
                if !top.isEmpty {
                    Text("YOUR MOST HEARD")
                        .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                        .tracking(0.6)
                        .foregroundStyle(Color.textMuted)
                        .padding(.top, Space.x1)
                    VStack(spacing: 0) {
                        ForEach(Array(top.enumerated()), id: \.element.key) { i, entry in
                            NavigationLink(value: route(for: entry)) {
                                HStack(spacing: Space.x3) {
                                    Text("\(i + 1)")
                                        .font(.jakarta(size: 12, relativeTo: .caption))
                                        .monospacedDigit()
                                        .foregroundStyle(Color.textMuted)
                                        .frame(minWidth: 20, alignment: .leading)
                                    Text(entry.title)
                                        .font(.jakarta(size: 15, relativeTo: .body))
                                        .foregroundStyle(Color.textPrimary)
                                        .lineLimit(1)
                                    Spacer(minLength: Space.x2)
                                    Text("\(entry.timesSeen)×")
                                        .font(.jakarta(size: 14, weight: .bold, relativeTo: .subheadline))
                                        .monospacedDigit()
                                        .foregroundStyle(Color.brand)
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.textMuted)
                                }
                                .frame(minHeight: TouchTarget.minimum)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if i < top.count - 1 { Divider().overlay(Color.borderSubtle) }
                        }
                    }
                    .padding(.horizontal, Space.x3)
                    .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
                }
            }
        }
    }

    /// The band's song page when there is one, else your own song page.
    private func route(for entry: SongIndex.Entry) -> AppRoute {
        if let bandSlug, let slug = slugs?.slug(for: entry.title) { return .bandSong(band: bandSlug, song: slug) }
        return .song(artist: SongIndex.artistSlug(personal.artistName), song: SongIndex.songSlug(entry.title))
    }
}

// MARK: - The band's song page

/// Where `/bands/?band=<slug>&song=<song>` leads: the band's stats for one
/// song (`/api/artist-song`) and yours beside them.
struct BandSongScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let band: String
    let song: String
    @State private var state: SnapshotState<BandSongSnapshot> = .loading
    @State private var attempt = 0

    private var publicBand: PublicBand? { BandDirectory.band(forSlug: band) }

    var body: some View {
        Group {
            switch state {
            case .loading:
                ProgressView("Loading the song")
            case .none:
                ContentUnavailableView {
                    Label("No song stats here", systemImage: "music.note")
                } description: {
                    Text("We don't have song stats for this band.")
                } actions: {
                    Button("Open on mysetlists.net") { router.show(AppRoute.bandSong(band: band, song: song).webURL) }
                }
            case .failed(let error):
                BandLoadErrorView(error: error, name: publicBand?.name ?? "Song") { attempt += 1 }
                    .padding(Space.x5)
            case .ready(let snapshot):
                if let publicBand {
                    BandSongPage(snapshot: snapshot, band: publicBand,
                                 personal: BandPersonal(shows: store.shows, name: publicBand.name, key: publicBand.key))
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(band)/\(song)|\(attempt)") { await load() }
    }

    private func load() async {
        guard let publicBand, publicBand.songPages else { state = .none; return }
        if let hit = BandService.shared.cachedSong(publicBand.slug, song: song) { state = .ready(hit); return }
        state = .loading
        do {
            state = .ready(try await BandService.shared.song(publicBand.slug, song: song, api: session.api))
        } catch {
            state = .failed(error)
        }
    }
}

private struct BandSongPage: View {
    let snapshot: BandSongSnapshot
    let band: PublicBand
    let personal: BandPersonal

    var body: some View {
        let song = snapshot.song
        let artist = snapshot.artist
        let mine = personal.song(titled: song.name)
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) {
                VStack(alignment: .leading, spacing: Space.x2) {
                    NavigationLink(value: AppRoute.band(slug: band.slug)) {
                        Text(artist.name)
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .subheadline))
                            .foregroundStyle(Color.amber)
                    }
                    .buttonStyle(.plain)
                    Text(song.name)
                        .font(.jakarta(size: 26, weight: .bold, relativeTo: .title))
                        .foregroundStyle(Color.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text("Played \(BandText.times(song.timesPlayed)) · you've heard it \(mine.map { BandText.times($0.timesSeen) } ?? "0 times")")
                        .font(.jakarta(size: 15, relativeTo: .body))
                        .foregroundStyle(Color.textSecondary)
                    FigureGrid(figures: Self.figures(song))
                    .padding(.top, Space.x2)
                    if let gap = song.longestGap, let from = song.gapStart, let to = song.gapEnd {
                        Text("Longest gap ever: \(gap.formatted()) shows, \(ShowDateText.display(from.date)) to \(ShowDateText.display(to.date)).")
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textMuted)
                    }
                }

                YourSongStats(songName: song.name, bandName: artist.name, mine: mine, hasShows: !personal.shows.isEmpty)

                if !song.recentPerformances.isEmpty {
                    BandSection(title: "Recent performances", note: nil) {
                        ForEach(Array(song.recentPerformances.enumerated()), id: \.offset) { i, night in
                            NightRow(night: night, mine: personal.show(on: night.date))
                            if i < song.recentPerformances.count - 1 { RowDivider() }
                        }
                    }
                }

                SourceCredit(artist: artist, extra: song.sourceUrl.map { ("\(song.name) on \(artist.source == "phishnet" ? "Phish.net" : (artist.sourceName ?? "the source")): every performance", $0) })
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(song.name)
        .toolbar { ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) } }
    }
}

extension BandSongPage {
    static func figures(_ song: BandSongSnapshot.Song) -> [(value: String, label: String, detail: String?)] {
        var out: [(value: String, label: String, detail: String?)] = [
            (song.timesPlayed.formatted(), "Times played", nil),
            (ShowDateText.display(song.firstPlayed?.date ?? ""), "First played", song.firstPlayed?.venue),
            (ShowDateText.display(song.lastPlayed?.date ?? ""), "Last played", song.lastPlayed?.venue),
            (song.currentGap.formatted(), "Shows since played", nil),
            (song.longestGap.map { $0.formatted() } ?? "–", "Longest gap (shows)", nil),
        ]
        if let kind = song.kind { out.append((kind, "Song", nil)) }
        return out
    }
}

/// "Your stats" on a band's song page.
private struct YourSongStats: View {
    let songName: String
    let bandName: String
    let mine: SongIndex.Entry?
    let hasShows: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            SectionTitle("Your stats")
            if let mine {
                let gap = mine.currentGap.shows
                FigureGrid(figures: [
                    ("\(mine.timesSeen)", "Times heard", nil),
                    (ShowDateText.display(mine.firstSeen.date), "First heard", mine.firstSeen.venue),
                    (ShowDateText.display(mine.lastSeen.date), "Last heard", mine.lastSeen.venue),
                    ("\(gap)", "Your gap (shows)", nil),
                ])
                Text(gap == 0 ? "You heard it at your most recent \(bandName) show."
                     : "\(gap) of your \(bandName) show\(gap == 1 ? "" : "s") since you last heard it.")
                    .font(.jakarta(size: 15, relativeTo: .body))
                    .foregroundStyle(Color.textSecondary)
                Text("YOUR SHOWS WITH \(songName.uppercased())")
                    .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                    .tracking(0.6)
                    .foregroundStyle(Color.textMuted)
                    .padding(.top, Space.x1)
                VStack(spacing: 0) {
                    ForEach(Array(mine.performances.enumerated()), id: \.offset) { i, perf in
                        NavigationLink(value: AppRoute.show(id: perf.showId)) { PerformanceRow(perf: perf) }
                            .buttonStyle(.plain)
                        if i < mine.performances.count - 1 { Divider().overlay(Color.borderSubtle) }
                    }
                }
                .padding(.horizontal, Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
            } else {
                Text(hasShows ? "You haven't heard \(songName) at any of your \(bandName) shows yet."
                     : "You haven't logged a \(bandName) show yet.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .brandCard(radius: Radius.xl2)
            }
        }
    }
}

// MARK: - About

/// "About <band>": Wikipedia, then members, genres and links from
/// MusicBrainz and Discogs. Loads when opened, as on the web.
private struct AboutBand: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    let name: String
    @State private var open = false
    @State private var info: ArtistInfo?
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            Button {
                withAnimation { open.toggle() }
                if open, info == nil, !loading { Task { await load() } }
            } label: {
                HStack {
                    Label("About \(name)", systemImage: "book")
                        .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                        .foregroundStyle(Color.brand)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.textMuted)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .frame(minHeight: TouchTarget.minimum)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(open ? "Expanded" : "Collapsed")

            if open { content.transition(.opacity) }
        }
        .padding(.horizontal, Space.x4)
        .padding(.vertical, Space.x2)
        .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, Space.x3)
        } else if failed {
            Text("Couldn't load information. Try again later.")
                .font(.jakarta(size: 14, relativeTo: .subheadline))
                .foregroundStyle(Color.textMuted)
                .padding(.bottom, Space.x2)
        } else if let info, info.found {
            VStack(alignment: .leading, spacing: Space.x3) {
                HStack(alignment: .top, spacing: Space.x3) {
                    if let image = info.image {
                        AsyncImage(url: image) { phase in
                            if let img = phase.image { img.resizable().scaledToFill() } else { Color.surfaceHover }
                        }
                        .frame(width: 80, height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                        .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: Space.x1) {
                        if let d = info.wiki?.description {
                            Text(d.prefix(1).uppercased() + d.dropFirst())
                                .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                                .foregroundStyle(Color.brand)
                        }
                        if let summary = info.summary {
                            Text(summary)
                                .font(.jakarta(size: 14, relativeTo: .subheadline))
                                .foregroundStyle(Color.textSecondary)
                                .lineLimit(6)
                        }
                        if let url = info.wiki?.url {
                            Button("Read more on Wikipedia") { router.show(url) }
                                .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                                .tint(.brand)
                        }
                    }
                }
                if let e = info.enrich {
                    if !e.genres.isEmpty {
                        Text(e.genres.prefix(8).joined(separator: " · "))
                            .font(.jakarta(size: 12, weight: .medium, relativeTo: .caption))
                            .foregroundStyle(Color.brandLight)
                    }
                    if let line = e.countryAndYears {
                        Label(line, systemImage: "globe")
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textMuted)
                    }
                    if !e.members.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("MEMBERS")
                                .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
                                .tracking(0.6)
                                .foregroundStyle(Color.textMuted)
                            // Former members struck through, as on the web.
                            e.members.enumerated().reduce(Text("")) { text, pair in
                                let m = pair.element
                                let name = Text(m.name).strikethrough(!m.active).foregroundStyle(m.active ? Color.textSecondary : Color.textMuted)
                                return pair.offset == 0 ? name : text + Text(", ").foregroundStyle(Color.textMuted) + name
                            }
                            .font(.jakarta(size: 13, relativeTo: .footnote))
                        }
                    }
                    let links = e.shownLinks
                    if !links.isEmpty {
                        HStack(spacing: Space.x3) {
                            ForEach(Array(links.enumerated()), id: \.offset) { _, link in
                                Button(link.label) { router.show(link.url) }
                                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                                    .tint(.brand)
                            }
                        }
                    }
                    if e.musicBrainzURL != nil || e.discogsURL != nil {
                        HStack(spacing: Space.x1) {
                            Text("Data from").foregroundStyle(Color.textMuted)
                            if let mb = e.musicBrainzURL { Button("MusicBrainz") { router.show(mb) }.tint(.brand) }
                            if e.musicBrainzURL != nil, e.discogsURL != nil { Text("&").foregroundStyle(Color.textMuted) }
                            if let d = e.discogsURL { Button("Discogs") { router.show(d) }.tint(.brand) }
                        }
                        .font(.jakarta(size: 11, relativeTo: .caption2))
                    }
                }
            }
            .padding(.bottom, Space.x2)
        } else if info != nil {
            Text("No information found for \(name).")
                .font(.jakarta(size: 14, relativeTo: .subheadline))
                .foregroundStyle(Color.textMuted)
                .padding(.bottom, Space.x2)
        }
    }

    private func load() async {
        loading = true
        failed = false
        info = await ArtistInfo.load(name: name, api: session.api)
        failed = info == nil
        loading = false
    }
}

// MARK: - Shared pieces

enum BandText {
    /// "853 shows · Sep 27, 2014 to Nov 16, 2026".
    static func showsLine(_ stats: BandSnapshot.Stats) -> String {
        var line = "\(stats.totalShows.formatted()) show\(stats.totalShows == 1 ? "" : "s")"
        if let first = stats.firstShow?.date, let last = stats.lastShow?.date {
            line += " · \(ShowDateText.display(first)) to \(ShowDateText.display(last))"
        }
        return line
    }

    /// "223 times", "1 time".
    static func times(_ n: Int) -> String { "\(n.formatted()) time\(n == 1 ? "" : "s")" }
}

/// Figures in cards, two to a row (value, label, an optional line under it).
struct FigureGrid: View {
    let figures: [(value: String, label: String, detail: String?)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: Space.x2), GridItem(.flexible(), spacing: Space.x2)], spacing: Space.x2) {
            ForEach(Array(figures.enumerated()), id: \.offset) { _, f in
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.value)
                        .font(.jakarta(size: 18, weight: .bold, relativeTo: .title3))
                        .monospacedDigit()
                        .foregroundStyle(Color.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(f.label)
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textMuted)
                    if let d = f.detail, !d.isEmpty {
                        Text(d)
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
                .padding(Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// A titled list in one card.
private struct BandSection<Content: View>: View {
    let title: String
    let note: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Text(title)
                .font(.jakarta(size: 18, weight: .bold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let note {
                Text(note)
                    .font(.jakarta(size: 12, relativeTo: .caption))
                    .foregroundStyle(Color.textMuted)
            }
            VStack(alignment: .leading, spacing: 0) { content }
                .padding(.horizontal, Space.x3)
                .padding(.vertical, Space.x1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        }
    }
}

/// A night of the band's, with "You were there" when you were.
private struct NightRow: View {
    let night: SnapshotShow
    let mine: Show?

    var body: some View {
        HStack(spacing: Space.x3) {
            Text(ShowDateText.display(night.date))
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .monospacedDigit()
                .foregroundStyle(Color.textSecondary)
                .frame(width: 104, alignment: .leading)
            Text(venueLine(night.venue, night.city))
                .font(.jakarta(size: 14, relativeTo: .subheadline))
                .foregroundStyle(Color.textPrimary)
                .lineLimit(2)
            Spacer(minLength: Space.x2)
            if let mine { ThereBadge(showId: mine.id) }
        }
        .frame(minHeight: TouchTarget.minimum)
    }
}

/// "heard 7×".
private struct HeardBadge: View {
    let count: Int
    var body: some View {
        Label("heard \(count)×", systemImage: "ear")
            .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
            .foregroundStyle(Color.brand)
            .padding(.horizontal, Space.x2)
            .padding(.vertical, 2)
            .background(Color.brandSubtle, in: Capsule())
            .accessibilityLabel("You've heard it \(count) time\(count == 1 ? "" : "s")")
    }
}

/// "You were there", opening your show that night.
private struct ThereBadge: View {
    let showId: String
    var body: some View {
        NavigationLink(value: AppRoute.show(id: showId)) {
            Label("You were there", systemImage: "ticket")
                .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Color.amber)
                .padding(.horizontal, Space.x2)
                .padding(.vertical, 2)
                .background(Color.amberSubtle, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct RowDivider: View {
    var body: some View { Divider().overlay(Color.borderSubtle) }
}

private struct CoverTag: View {
    var body: some View {
        Text("Cover")
            .font(.jakarta(size: 10, relativeTo: .caption2))
            .foregroundStyle(Color.textMuted)
            .padding(.horizontal, 6)
            .overlay(Capsule().stroke(Color.borderSubtle))
    }
}

/// Where the data comes from, as the public pages credit it, and when it was updated.
private struct SourceCredit: View {
    @Environment(AppRouter.self) private var router
    let artist: SnapshotArtist
    /// A line before the credit, linking somewhere (the song's every performance).
    let extra: (String, URL)?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            if let extra {
                Button(extra.0) { router.show(extra.1) }.tint(.brand)
            }
            if let a = artist.attribution {
                Button(a.text) { router.show(a.url) }.tint(.brand)
            }
            if let at = artist.fetchedAt, at.count >= 10 {
                Text("Updated \(ShowDateText.display(String(at.prefix(10)))).")
                    .foregroundStyle(Color.textMuted)
            }
        }
        .font(.jakarta(size: 12, relativeTo: .caption))
    }
}

/// Why the band's stats aren't here, with a retry.
private struct BandLoadErrorView: View {
    let error: BandLoadError
    let name: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Label(title, systemImage: error == .unavailable ? "clock" : "exclamationmark.circle")
                .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                .foregroundStyle(Color.textPrimary)
            Text(detail)
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
            if error != .notFound {
                Button("Try again", action: retry).buttonStyle(.bordered).tint(.brand)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }

    private var title: String {
        switch error {
        case .unavailable: "\(name) stats are temporarily unavailable"
        case .notFound: "No \(name) stats here"
        case .network: "Couldn't load \(name) stats"
        }
    }

    private var detail: String {
        switch error {
        case .unavailable: "Phish.net's terms let us show its data for 24 hours after we fetch it. It will be back after the next update."
        case .notFound: "We don't have stats for this yet."
        case .network: "Check your connection, then try again."
        }
    }
}
