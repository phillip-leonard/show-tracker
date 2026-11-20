import Core
import DesignSystem
import SwiftUI

// Year in Review (Stage 6, 6-10; the web's YearRecapView). One layout, from
// the recap, for every year (call F): headline numbers, top bands, top
// songs, the rare ones, the show buddy, highlights, the recap card and its
// share link, and "Missing a show? Add it". Everything comes from
// `year-recap` (call D), asked again when the year's shows change and when
// the server's stats move (a recompute rewrites the stored recap); the card
// is `my-poster`'s (call E). Accounts only.

/// `/year-in-review/?year=` (and `&user=`): your own review natively, for a
/// year the native screen shows (`YearReview.isNative`); anyone else's, and
/// 2026 before Jan 16, open the web.
struct YearInReviewRoute: View {
    @Environment(SessionStore.self) private var session
    let user: String
    let year: String

    var body: some View {
        let own = user.isEmpty || user == session.user?.uid
        if own, let y = Int(year), YearReview.isNative(year: y) {
            YearInReviewScreen(initialYear: y)
        } else {
            RoutePlaceholder(route: .yearInReview(user: user, year: year))
        }
    }
}

struct YearInReviewScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @State private var year: Int
    @State private var answer: YearRecapAnswer?
    @State private var problem: String?
    @State private var adding = false
    @State private var upgrading = false

    init(initialYear: Int) { _year = State(initialValue: initialYear) }

    private var isAccount: Bool { session.user?.isAnonymous == false }

    /// Asked again on a new year, a change to one of the year's shows, or
    /// a recompute (the stored recap is rewritten then).
    private var loadKey: String {
        let computed = store.stats?.computedAt?.timeIntervalSince1970 ?? 0
        return "\(year)|\(computed)|\(YearReview.signature(store.shows, year: year))"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) { content }
                .padding(.horizontal, Space.x5)
                .padding(.vertical, Space.x3)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .brandScreen()
        .navigationTitle("\(String(year)) in Review")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { yearPicker }
        .task(id: loadKey) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $adding) { AddShowSheet() }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }

    @ToolbarContentBuilder private var yearPicker: some ToolbarContent {
        let years = YearReview.years(store.shows, including: year).filter { YearReview.isNative(year: $0) }
        if isAccount, years.count > 1 {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Year", selection: $year) {
                        ForEach(years, id: \.self) { Text(String($0)).tag($0) }
                    }
                } label: {
                    Label(String(year), systemImage: "calendar")
                        .labelStyle(.titleAndIcon)
                }
                .accessibilityLabel("Year, \(String(year))")
            }
        }
    }

    @ViewBuilder private var content: some View {
        if !isAccount {
            card(title: "Your year in live music",
                 text: "Create an account to get your Year in Review: your top bands and songs, rare ones, your show buddy and a card to share.") {
                Button("Create your account") { upgrading = true }.buttonStyle(.borderedProminent).tint(.brand)
            }
        } else if let answer, answer.year == year {
            if let recap = answer.recap {
                YearRecapBody(recap: recap, rarity: answer.rarity, buddy: answer.buddy) { adding = true }
            } else {
                card(title: "Your \(String(year)) in live music",
                     text: "No shows logged for \(String(year)) yet. Add the ones you went to and your recap builds itself.") {
                    Button("Add a show", systemImage: "plus") { adding = true }.buttonStyle(.borderedProminent).tint(.brand)
                }
            }
        } else if let problem {
            card(title: "Your \(String(year)) in live music", text: problem) {
                Button("Try again") { Task { await load() } }.buttonStyle(.bordered)
            }
        } else {
            ProgressView("Putting your year together…").frame(maxWidth: .infinity).padding(.top, Space.x8)
        }
    }

    private func card<Actions: View>(title: String, text: String, @ViewBuilder actions: () -> Actions) -> some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            Text(title).font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
            Text(text).font(.brand(.sm)).foregroundStyle(.secondary)
            actions()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }

    private func load() async {
        guard isAccount, let client = store.yearRecaps else { return }
        let asked = year
        do throws(APIError) {
            let got = try await client.answer(year: asked)
            guard asked == year else { return }
            answer = got
            problem = nil
        } catch {
            if error.isCancellation { return }
            guard asked == year else { return }
            if answer?.year != asked { answer = nil }
            problem = switch error {
            case .offline: "You're offline. Your Year in Review is put together on the server, so it needs a connection."
            case .rateLimited: "That's a lot of looks at your year for one day. Try again tomorrow."
            default: "Couldn't load your Year in Review. Try again."
            }
        }
    }
}

/// Every section below the year picker.
private struct YearRecapBody: View {
    @Environment(ShowsStore.self) private var store
    let recap: YearRecap
    let rarity: YearRarity
    let buddy: ShowBuddy?
    let addShow: () -> Void

    private var year: Int { recap.year }

    var body: some View {
        header
        headline
        NoSetlistLine(shows: recap.noSetlist)
        topBands
        topSongs
        if !rarity.isEmpty { rareOnes }
        if let buddy { buddySection(buddy) }
        highlights
        recapCard
        missingShow
    }

    // MARK: Header and numbers

    private var header: some View {
        VStack(spacing: Space.x2) {
            Text("YEAR IN REVIEW")
                .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                .tracking(2)
                .foregroundStyle(Color.brand)
            (Text("Your ") + Text(String(year)).foregroundColor(Color.amber))
                .font(.jakarta(size: 36, weight: .heavy, relativeTo: .largeTitle))
            Text("in live music").font(.jakarta(size: 22, weight: .bold, relativeTo: .title2))
            Text("Updated through \(ShowDateText.display(recap.updatedThrough))")
                .font(.brand(.sm)).foregroundStyle(.secondary)
                .padding(.top, Space.x1)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.x6)
        .background(
            LinearGradient(colors: [Color(red: 0.11, green: 0.11, blue: 0.21), Color(red: 0.16, green: 0.16, blue: 0.31)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle.brand(Radius.xl2)
        )
        .overlay(RoundedRectangle.brand(Radius.xl2).strokeBorder(Color.borderSubtle))
        .accessibilityElement(children: .combine)
    }

    private var headline: some View {
        VStack(spacing: Space.x2) {
            FigureGrid(figures: [
                (count(recap.totalShows), recap.totalShows == 1 ? "Show" : "Shows", nil),
                (count(recap.totalBands), recap.totalBands == 1 ? "Band" : "Bands", nil),
                (count(recap.totalVenues), recap.totalVenues == 1 ? "Venue" : "Venues", nil),
                (count(recap.songsHeard), recap.songsHeard == 1 ? "Song heard" : "Songs heard", nil),
                (count(recap.newBands), recap.newBands == 1 ? "New band" : "New bands", nil),
                (count(recap.newVenues), recap.newVenues == 1 ? "New venue" : "New venues", nil),
            ])
            if recap.totalCities > 1 {
                Text("Across \(plural(recap.totalCities, "city", "cities"))")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: Lists

    private var topBands: some View {
        RecapSection("Top bands") {
            RecapRows(recap.topBands.enumerated().map { $0 }, id: \.element.name) { i, band in
                NavigationLink(value: AppRoute.myShows(ShowsFilter(kind: .band, title: band.name, year: year))) {
                    RankRow(rank: i + 1, title: band.name, subtitle: nil, trailing: plural(band.shows, "show"), accent: false)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var topSongs: some View {
        if !recap.topSongs.isEmpty {
            RecapSection("Top songs", note: "Heard at the most shows. A song played twice in one show counts once.") {
                RecapRows(recap.topSongs.enumerated().map { $0 }, id: \.offset) { i, song in
                    NavigationLink(value: AppRoute.song(artist: song.artist.isEmpty ? nil : SongIndex.artistSlug(song.artist),
                                                         song: SongIndex.songSlug(song.name))) {
                        RankRow(rank: i + 1, title: song.name, subtitle: song.artist.isEmpty ? nil : song.artist,
                                trailing: "\(song.count)×", accent: true)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var rareOnes: some View {
        RecapSection("Rare ones", note: "From the full setlist archives for Goose, Phish, Umphrey's McGee and King Gizzard.") {
            VStack(alignment: .leading, spacing: Space.x3) {
                if let rarest = rarity.rarest {
                    VStack(alignment: .leading, spacing: Space.x1) {
                        Label("RAREST CATCH", systemImage: "diamond")
                            .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                            .foregroundStyle(Color.brand)
                        Text(rarest.name).font(.jakarta(size: 20, weight: .heavy, relativeTo: .title3))
                        Text(rarestLine(rarest)).font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .brandCard(radius: Radius.xl2)
                    .accessibilityElement(children: .combine)
                }
                if !rarity.bustOuts.isEmpty {
                    Label("BUST-OUTS WITNESSED", systemImage: "flame")
                        .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                        .foregroundStyle(Color.brand)
                    RecapRows(rarity.bustOuts, id: \.id) { bust in
                        HStack(alignment: .firstTextBaseline, spacing: Space.x3) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(bust.name).font(.brand(.base)).foregroundStyle(Color.textPrimary)
                                Text([bust.band, ShowDateText.display(bust.date), bust.venue ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(Color.textMuted)
                            }
                            Spacer(minLength: Space.x2)
                            Text("after \(plural(bust.gap, "show"))").font(.brand(.sm)).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private func rarestLine(_ r: YearRarity.Rarest) -> String {
        var parts = [r.band, "played \(plural(r.timesPlayed, "time")) ever"]
        if let date = r.date, !date.isEmpty { parts.append("you heard it \(ShowDateText.display(date))") }
        return parts.joined(separator: " · ")
    }

    private func buddySection(_ buddy: ShowBuddy) -> some View {
        RecapSection("Show buddy") {
            NavigationLink {
                ShowsTogetherList(friendUid: buddy.uid, name: buddy.firstName.isEmpty ? buddy.name : buddy.firstName)
                    .brandScreen()
                    .navigationTitle("Shows together")
                    .navigationBarTitleDisplayMode(.inline)
            } label: {
                HStack(spacing: Space.x4) {
                    Image(systemName: "person.2.fill").font(.title2).foregroundStyle(Color.brand)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(buddy.name).font(.jakarta(size: 20, weight: .heavy, relativeTo: .title3))
                            .foregroundStyle(Color.textPrimary).lineLimit(1)
                        Text("\(plural(buddy.shows, "show")) together in \(String(year))")
                            .font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: Space.x2)
                    Text("Shows together").font(.brand(.sm, weight: .semibold)).foregroundStyle(Color.brand)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(radius: Radius.xl2)
                .contentShape(RoundedRectangle.brand(Radius.xl2))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Highlights

    private var highlights: some View {
        RecapSection("Highlights") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: Space.x3)], spacing: Space.x3) {
                highlight("First show of the year", symbol: "music.note") { showLine(recap.highlights.firstShow) }
                highlight("Most recent show", symbol: "music.note") { showLine(recap.highlights.latestShow) }
                highlight("Busiest month", symbol: "calendar") {
                    Text(recap.highlights.busiestMonth.name).font(.brand(.base, weight: .semibold)).foregroundStyle(Color.textPrimary)
                    Text(plural(recap.highlights.busiestMonth.shows, "show")).font(.caption).foregroundStyle(Color.textMuted)
                }
                if let run = recap.highlights.longestRun {
                    highlight("Longest run", symbol: "mappin.and.ellipse") {
                        let title = "\(run.nights) nights of \(run.artist)"
                        if store.runs.contains(where: { $0.key == run.key }) {
                            NavigationLink(value: AppRoute.run(key: run.key)) {
                                Text(title).font(.brand(.base, weight: .semibold)).foregroundStyle(Color.textPrimary)
                            }
                            .buttonStyle(.plain)
                        } else {
                            Text(title).font(.brand(.base, weight: .semibold)).foregroundStyle(Color.textPrimary)
                        }
                        Text("\(run.venue) · \(ShowDateText.display(run.start)) – \(ShowDateText.display(run.end))")
                            .font(.caption).foregroundStyle(Color.textMuted)
                    }
                }
            }
        }
    }

    private func highlight<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Label(title.uppercased(), systemImage: symbol)
                .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                .foregroundStyle(Color.textMuted)
            VStack(alignment: .leading, spacing: 2) { content() }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .brandCard(radius: Radius.xl2)
    }

    private func showLine(_ show: YearRecap.ShowRef) -> some View {
        NavigationLink(value: AppRoute.show(id: show.id)) {
            VStack(alignment: .leading, spacing: 2) {
                Text(show.artist).font(.brand(.base, weight: .semibold)).foregroundStyle(Color.textPrimary)
                Text("\([show.venue, show.city].filter { !$0.isEmpty }.joined(separator: ", ")) · \(ShowDateText.display(show.date))")
                    .font(.caption).foregroundStyle(Color.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Card and the add flow

    private var recapCard: some View {
        let card = RecapCardRequest(recap: recap, rarity: rarity, buddy: buddy)
        let posters = store.posters
        // Sorted keys: the same card must give the same key on every render,
        // or each one draws again (each draw counts against the daily limit).
        let key = Self.cardKey(card) ?? "\(year)"
        return RecapSection("Your recap card",
                            note: "Sized for stories and the feed. Your show buddy's first name is on it only if their profile is public.") {
            ServerPosterImages(
                requestKey: key,
                fileBase: "my-\(year)-in-live-music",
                alt: YearReview.title(year: year),
                imageSubject: YearReview.title(year: year),
                linkSubject: "\(YearReview.title(year: year)): \(plural(recap.totalShows, "show")), \(plural(recap.totalBands, "band"))",
                linkNote: "A page with your recap and card. No email, notes or show list, and it isn't listed in search engines.",
                draw: { kind throws(APIError) in
                    guard let posters else { throw .offline }
                    return try await posters.recapImage(card, kind: kind)
                },
                makeLink: { () throws(APIError) in
                    guard let posters else { throw .offline }
                    return try await posters.recapShareLink(card)
                },
                drawingLabel: "Drawing your card…"
            )
        }
    }

    private var missingShow: some View {
        HStack(alignment: .center, spacing: Space.x3) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Missing a show?").font(.brand(.base, weight: .semibold)).foregroundStyle(Color.textPrimary)
                Text("Updated through \(ShowDateText.display(recap.updatedThrough)). Add it and every number here updates.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
            }
            Spacer(minLength: Space.x2)
            Button("Add it", systemImage: "plus", action: addShow).buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }

    private func count(_ n: Int) -> String { n.formatted() }

    private static func cardKey(_ card: RecapCardRequest) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return (try? encoder.encode(card)).flatMap { String(data: $0, encoding: .utf8) }
    }
}

/// "N shows have no setlist — add them for full stats", opening to the list.
private struct NoSetlistLine: View {
    let shows: [YearRecap.ShowRef]
    @State private var open = false

    var body: some View {
        if !shows.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                Button {
                    withAnimation { open.toggle() }
                } label: {
                    HStack(spacing: Space.x1) {
                        (Text("\(plural(shows.count, "show has", "shows have")) no setlist — ")
                            + Text("add \(shows.count == 1 ? "it" : "them") for full stats").foregroundColor(Color.brand).bold())
                            .font(.brand(.sm))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                        Image(systemName: "chevron.down").font(.caption)
                            .rotationEffect(.degrees(open ? 180 : 0))
                            .foregroundStyle(.secondary)
                    }
                    .frame(minHeight: TouchTarget.minimum)
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? "Expanded" : "Collapsed")
                if open {
                    RecapRows(shows, id: \.id) { show in
                        NavigationLink(value: AppRoute.show(id: show.id)) {
                            HStack(spacing: Space.x3) {
                                Text(ShowDateText.display(show.date)).font(.brand(.sm)).foregroundStyle(.secondary)
                                Text(show.venue.isEmpty ? show.artist : "\(show.artist) · \(show.venue)")
                                    .font(.brand(.sm)).foregroundStyle(Color.textPrimary).lineLimit(1)
                                Spacer(minLength: Space.x2)
                                Text("Add setlist").font(.brand(.sm, weight: .semibold)).foregroundStyle(Color.brand)
                            }
                            .frame(maxWidth: .infinity, minHeight: TouchTarget.minimum, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - Building blocks

private struct RecapSection<Content: View>: View {
    let title: String
    let note: String?
    @ViewBuilder let content: Content

    init(_ title: String, note: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.note = note
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Text(title)
                .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let note { Text(note).font(.caption).foregroundStyle(Color.textMuted) }
            content
        }
    }
}

/// Rows in one rounded card, divided.
private struct RecapRows<Item, ID: Hashable, Row: View>: View {
    let items: [Item]
    let id: KeyPath<Item, ID>
    @ViewBuilder let row: (Item) -> Row

    init(_ items: [Item], id: KeyPath<Item, ID>, @ViewBuilder row: @escaping (Item) -> Row) {
        self.items = items
        self.id = id
        self.row = row
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                if i > 0 { Divider().padding(.leading, Space.x4) }
                row(item)
                    .frame(maxWidth: .infinity, minHeight: TouchTarget.minimum, alignment: .leading)
                    .padding(.horizontal, Space.x4)
                    .padding(.vertical, Space.x2)
                    .contentShape(Rectangle())
            }
        }
        .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
    }
}

private struct RankRow: View {
    let rank: Int
    let title: String
    let subtitle: String?
    let trailing: String
    let accent: Bool

    var body: some View {
        HStack(spacing: Space.x3) {
            Text("\(rank)").font(.caption).foregroundStyle(Color.textMuted).frame(width: 20, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.brand(.base, weight: .medium)).foregroundStyle(Color.textPrimary).lineLimit(1)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(Color.textMuted).lineLimit(1) }
            }
            Spacer(minLength: Space.x2)
            Text(trailing)
                .font(.brand(.sm, weight: accent ? .bold : .regular))
                .foregroundStyle(accent ? Color.brand : Color.textSecondary)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.textMuted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: TouchTarget.minimum, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
    "\(n.formatted()) \(n == 1 ? one : (many ?? one + "s"))"
}
