import Core
import DesignSystem
import SwiftUI

// Posters (Stage 6, 6-9; the web's MyPosterView, MakePosterButton,
// HeardToolCard and HeardSaveModal). The record and both images are made by
// `my-poster` from your stored shows; the archive bands' posters are the
// web's Songs I've heard tool (F-11), opened with your shows in the link.

/// "Make my poster" for a band, where a band appears: the tool for an
/// archive band; else your own poster once it has two shows with a setlist.
/// Accounts only.
struct MakePosterButton: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let artist: String

    var body: some View {
        if session.user?.isAnonymous == false {
            if let band = HeardTool.band(forArtist: artist) {
                Button { router.show(HeardTool.url(for: band, shows: store.shows)) } label: { label }
                    .accessibilityHint("Opens the Songs I've heard tool on mysetlists.net")
            } else if MyPoster.canMake(store.shows, artist: artist) {
                NavigationLink(value: AppRoute.myPoster(artist: artist)) { label }
            }
        }
    }

    private var label: some View {
        Label("Make my poster", systemImage: "sparkles")
            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
            .padding(.horizontal, Space.x3).padding(.vertical, Space.x2)
            .overlay(Capsule().strokeBorder(Color.borderSubtle))
            .foregroundStyle(Color.amber)
            .frame(minHeight: TouchTarget.minimum)
    }
}

/// "How many Goose songs have you heard?" on Stats (HeardToolCard.jsx):
/// the tool for each archive band you've seen, your shows already ticked.
/// A list row: the caller puts it in a section.
struct HeardToolCard: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router

    var body: some View {
        let bands = Array(HeardTool.bandsFor(store.shows).prefix(4))
        if let first = bands.first {
            VStack(alignment: .leading, spacing: Space.x3) {
                Label("How many \(first.band.name) songs have you heard?", systemImage: "sparkles")
                    .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.textPrimary)
                    .labelStyle(TintedIconLabel())
                Text("Every song you've heard live, your rarest catches and bust-outs, and a poster to share.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Space.x2) {
                        ForEach(bands) { entry in
                            Button {
                                router.show(HeardTool.url(slug: entry.band.slug, shows: entry.shows))
                            } label: {
                                HStack(spacing: 4) {
                                    Text(entry.band.name).fontWeight(.semibold)
                                    Text("· \(entry.shows.count)").foregroundStyle(.secondary)
                                    Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.secondary)
                                }
                                .font(.brand(.sm))
                                .padding(.horizontal, Space.x3).padding(.vertical, Space.x2)
                                .background(Color.surfaceHover, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(entry.band.name), \(entry.shows.count) shows, opens on mysetlists.net")
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, Space.x1)
        }
    }
}

/// `/my-poster/?artist=`: your record and poster for a band.
struct MyPosterScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let artist: String
    @State private var answer: PosterAnswer?
    @State private var problem: String?
    @State private var upgrading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) { content }
                .padding(.horizontal, Space.x5)
                .padding(.vertical, Space.x3)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .brandScreen()
        .navigationTitle("My poster")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(artist)|\(store.shows.count)") { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }

    @ViewBuilder private var content: some View {
        if session.user?.isAnonymous != false {
            card(title: "Your \(artist) poster",
                 text: "Create an account to make a poster of every \(artist) song you've heard live, from the shows you've logged.") {
                Button("Create your account") { upgrading = true }.buttonStyle(.borderedProminent).tint(.brand)
            }
        } else if let band = HeardTool.band(forArtist: artist) {
            card(title: "Your \(band.name) poster",
                 text: "\(band.name) has a full setlist archive, so its poster has your rarest catches, the bust-outs you were there for and the songs you're still chasing.") {
                Button("Open my \(band.name) poster", systemImage: "sparkles") { router.show(HeardTool.url(for: band, shows: store.shows)) }
                    .buttonStyle(.borderedProminent).tint(.brand)
            }
        } else if let problem, answer == nil {
            card(title: "Your \(artist) poster", text: problem) {
                Button("Try again") { Task { await load() } }.buttonStyle(.bordered)
            }
        } else if let answer {
            if let record = answer.record {
                PosterRecordView(artist: artist, answer: answer, record: record)
            } else {
                card(title: "Your \(answer.name) poster",
                     text: "You haven't logged a \(answer.name) show yet. Add one and your songs appear here.") { EmptyView() }
            }
        } else {
            ProgressView("Making your record…").frame(maxWidth: .infinity).padding(.top, Space.x8)
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
        guard session.user?.isAnonymous == false, HeardTool.band(forArtist: artist) == nil, let posters = store.posters else { return }
        do throws(APIError) {
            answer = try await posters.record(artist: artist)
            problem = nil
        } catch {
            problem = PosterClient.message(for: error)
        }
    }
}

private struct PosterRecordView: View {
    let artist: String
    let answer: PosterAnswer
    let record: PosterRecord
    @State private var sort: PosterSort = .mostHeard

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            Text(record.name)
                .font(.jakarta(size: 26, weight: .heavy, relativeTo: .largeTitle))
                .foregroundStyle(Color.amber)
            Text("Songs you've heard live, from your \(record.shows == 1 ? "show" : "\(record.shows) shows") in MySetlists\(record.yearSpan.isEmpty ? "" : " · \(record.yearSpan)")")
                .font(.brand(.sm)).foregroundStyle(.secondary)
            FigureGrid(figures: [
                (record.shows.formatted(), record.shows == 1 ? "Show" : "Shows", nil),
                (record.years.formatted(), record.years == 1 ? "Year" : "Years", nil),
                (record.venues.formatted(), record.venues == 1 ? "Venue" : "Venues", nil),
                (record.uniqueSongs.formatted(), "Songs", nil),
                (record.totalSongs.formatted(), "Performances", nil),
            ])
            if let first = record.firstShow, let last = record.lastShow {
                Text(first.date == last.date
                     ? "\(ShowDateText.display(first.date)) at \(first.venue)"
                     : "First show \(ShowDateText.display(first.date)) at \(first.venue) · latest \(ShowDateText.display(last.date)) at \(last.venue)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }

        VStack(alignment: .leading, spacing: Space.x3) {
            PosterSectionTitle("Your poster")
            if answer.eligible {
                PosterImagesView(artist: artist, name: record.name, shows: record.shows, songs: record.uniqueSongs)
            } else {
                Text("Add setlists to at least \(MyPoster.minShowsWithSetlist) of your \(record.name) shows to make a poster.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
            }
            Text(MyPoster.archiveNote).font(.caption).foregroundStyle(Color.textMuted)
        }

        if !record.top.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                PosterSectionTitle("Your most heard")
                VStack(spacing: 0) {
                    ForEach(Array(record.top.enumerated()), id: \.element.id) { i, song in
                        HStack {
                            Text("\(i + 1)").font(.caption).foregroundStyle(.secondary).frame(width: 22, alignment: .leading)
                            Text(song.name).lineLimit(1)
                            Spacer()
                            Text("\(song.count)×").font(.brand(.sm, weight: .bold)).foregroundStyle(Color.brand)
                        }
                        .font(.brand(.base))
                        .padding(.vertical, Space.x2)
                        if i < record.top.count - 1 { Divider() }
                    }
                }
                .brandCard(radius: Radius.xl2)
            }
        }

        if !record.songs.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                PosterSectionTitle("Every song you've heard (\(record.songs.count))")
                Picker("Sort", selection: $sort) {
                    ForEach(PosterSort.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                LazyVStack(spacing: 0) {
                    let sorted = sort.sorted(record.songs)
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { i, song in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(song.name).font(.brand(.base)).lineLimit(1)
                                Text(song.firstHeard == song.lastHeard
                                     ? ShowDateText.display(song.firstHeard)
                                     : "First \(ShowDateText.display(song.firstHeard)) · last \(ShowDateText.display(song.lastHeard))")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(song.count)×").font(.brand(.sm, weight: .bold)).foregroundStyle(Color.brand)
                        }
                        .padding(.vertical, Space.x2)
                        if i < sorted.count - 1 { Divider() }
                    }
                }
                .brandCard(radius: Radius.xl2)
            }
        }

        if !answer.noSetlist.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                PosterSectionTitle("Shows with no setlist (\(answer.noSetlist.count))")
                Text("Counted in your shows and venues, but no songs yet. Add a setlist and its songs join your record.")
                    .font(.caption).foregroundStyle(.secondary)
                VStack(spacing: 0) {
                    ForEach(answer.noSetlist) { show in
                        NavigationLink(value: AppRoute.show(id: show.id)) {
                            HStack {
                                Text(ShowDateText.display(show.date)).foregroundStyle(.secondary).frame(width: 110, alignment: .leading)
                                Text([show.venue, show.city].filter { !$0.isEmpty }.joined(separator: ", ")).lineLimit(1)
                                Spacer()
                                Text("Add setlist").font(.brand(.sm, weight: .semibold)).foregroundStyle(Color.brand)
                            }
                            .font(.brand(.sm))
                            .padding(.vertical, Space.x2)
                            .frame(minHeight: TouchTarget.minimum)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .brandCard(radius: Radius.xl2)
            }
        }
    }
}

private struct PosterSectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
            .foregroundStyle(Color.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The two posters (feed and story), drawn by `my-poster`, to save or
/// share, and the share link.
private struct PosterImagesView: View {
    @Environment(ShowsStore.self) private var store
    let artist: String
    let name: String
    let shows: Int
    let songs: Int

    var body: some View {
        let posters = store.posters
        ServerPosterImages(
            requestKey: artist,
            fileBase: "\(ServerPosterImages.slug(name, fallback: "band"))-songs-heard",
            alt: "\(name) poster",
            imageSubject: "\(name): songs I've heard live",
            linkSubject: "\(name): \(shows) shows, \(songs) songs heard",
            linkNote: "The link is to your record and poster, with no name or notes on it.",
            draw: { kind throws(APIError) in
                guard let posters else { throw .offline }
                return try await posters.image(artist: artist, kind: kind)
            },
            makeLink: { () throws(APIError) in
                guard let posters else { throw .offline }
                return try await posters.shareLink(artist: artist)
            }
        )
    }
}

/// A `my-poster` image in its two sizes (feed and story), the share sheet
/// with the PNG, and "Get share link": the band poster (6-9) and the Year in
/// Review recap card (6-10). A new `requestKey` draws afresh.
struct ServerPosterImages: View {
    let requestKey: String
    /// The saved file's name, without the size and extension.
    let fileBase: String
    let alt: String
    let imageSubject: String
    let linkSubject: String
    let linkNote: String
    let draw: @MainActor (PosterClient.Kind) async throws(APIError) -> Data
    let makeLink: @MainActor () async throws(APIError) -> URL
    var drawingLabel = "Drawing your poster…"

    @State private var kind: PosterClient.Kind = .feed
    @State private var drawnFor = ""
    @State private var images: [PosterClient.Kind: UIImage] = [:]
    @State private var files: [PosterClient.Kind: URL] = [:]
    @State private var problem: String?
    @State private var link: URL?
    @State private var linking = false
    @State private var linkProblem: String?

    static func slug(_ text: String, fallback: String) -> String {
        let slug = text.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return slug.isEmpty ? fallback : slug
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            Picker("Size", selection: $kind) {
                Text("Feed").tag(PosterClient.Kind.feed)
                Text("Story").tag(PosterClient.Kind.story)
            }
            .pickerStyle(.segmented)
            Group {
                if let image = images[kind] {
                    Image(uiImage: image).resizable().scaledToFit()
                        .clipShape(RoundedRectangle.brand(Radius.lg))
                        .accessibilityLabel("\(alt), \(kind == .feed ? "feed" : "story") size")
                } else if let problem {
                    Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber)
                } else {
                    ProgressView(drawingLabel).frame(maxWidth: .infinity, minHeight: 220)
                }
            }
            .frame(maxWidth: 420)
            HStack(spacing: Space.x3) {
                if let file = files[kind] {
                    ShareLink(item: file, subject: Text(imageSubject)) {
                        Label("Share image", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.borderedProminent).tint(.brand)
                }
                if let link {
                    ShareLink(item: link, subject: Text(linkSubject)) {
                        Label("Share link", systemImage: "link")
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button {
                        Task { await getLink() }
                    } label: {
                        if linking { ProgressView() } else { Label("Get share link", systemImage: "link") }
                    }
                    .buttonStyle(.bordered)
                    .disabled(linking)
                }
            }
            if let linkProblem {
                Text(linkProblem).font(.brand(.sm)).foregroundStyle(Color.amber)
            }
            Text(linkNote).font(.caption).foregroundStyle(.secondary)
        }
        .task(id: "\(requestKey)|\(kind.rawValue)") { await drawIfNeeded() }
    }

    private func drawIfNeeded() async {
        if drawnFor != requestKey {
            drawnFor = requestKey
            images = [:]; files = [:]; link = nil; linkProblem = nil
        }
        guard images[kind] == nil else { return }
        let kind = kind
        problem = nil
        do throws(APIError) {
            let png = try await draw(kind)
            guard let image = UIImage(data: png) else { problem = "Couldn't make the image. Try again."; return }
            images[kind] = image
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(fileBase)-\(kind.rawValue).png")
            if (try? png.write(to: url)) != nil { files[kind] = url }
        } catch {
            if error.isCancellation { return }
            problem = PosterClient.message(for: error)
        }
    }

    private func getLink() async {
        linking = true
        linkProblem = nil
        defer { linking = false }
        do throws(APIError) {
            link = try await makeLink()
        } catch {
            linkProblem = error == .offline
                ? "You're offline. Connect to get a share link."
                : "Couldn't make a share link. Try again."
        }
    }
}

/// `/shows/?heard=<slug>.<code>`: "Save these shows to MySetlists" from the
/// Songs I've heard tool (HeardSaveModal.jsx). Accounts only; kept through
/// sign-up by the router.
struct HeardSaveScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let value: String
    @State private var selection: HeardSelection?
    @State private var problem: String?
    @State private var saving = false
    @State private var result: HeardSaveResult?
    @State private var follow = FollowFlow()
    @State private var upgrading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x4) { content }
                .padding(Space.x5)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .brandScreen()
        .navigationTitle("Save shows")
        .navigationBarTitleDisplayMode(.inline)
        .followFlow(follow, session: session)
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
        .task(id: session.user?.uid) { await load() }
    }

    @ViewBuilder private var content: some View {
        if session.user?.isAnonymous != false {
            Label("Save these shows to MySetlists", systemImage: "music.note.list")
                .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
            Text("Create a free account and the shows you picked are added with their setlists.")
                .font(.brand(.sm)).foregroundStyle(.secondary)
            Button("Create your account") { upgrading = true }.buttonStyle(.borderedProminent).tint(.brand)
        } else if let result, let selection {
            Label("Saved", systemImage: "checkmark.circle.fill")
                .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3)).foregroundStyle(Color.brand)
            Text(summary(result)).font(.brand(.base))
            if !result.failed.isEmpty {
                Text("\(result.failed.count == 1 ? "1 show" : "\(result.failed.count) shows") couldn't be added. Check your connection and try again.")
                    .font(.brand(.sm)).foregroundStyle(Color.amber)
                Button("Try again") { Task { await save(selection) } }.buttonStyle(.bordered).disabled(saving)
            }
            HStack {
                Text("Follow \(selection.artist.name) for tour news").font(.brand(.sm))
                Spacer()
                FollowBandButton(name: selection.artist.name, flow: follow)
            }
            .brandCard(radius: Radius.xl)
            Button("See your shows") { router.paths[.shows] = [] }.buttonStyle(.borderedProminent).tint(.brand)
        } else if let selection {
            let n = selection.shows.count
            Label("Save these shows to MySetlists", systemImage: "music.note.list")
                .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
            Text("Add \(n == 1 ? "1 \(selection.artist.name) show" : "\(n) \(selection.artist.name) shows") to your account, with their setlists? Any already in your shows won't be added again.")
                .font(.brand(.base))
            Button {
                Task { await save(selection) }
            } label: {
                if saving { ProgressView() } else { Text("Add \(n == 1 ? "1 show" : "\(n) shows")") }
            }
            .buttonStyle(.borderedProminent).tint(.brand)
            .disabled(saving || n == 0)
            Button("Not now") { router.paths[.shows] = [] }.buttonStyle(.bordered).disabled(saving)
        } else if let problem {
            Text(problem).font(.brand(.base)).foregroundStyle(.secondary)
            Button("Try again") { Task { await load() } }.buttonStyle(.bordered)
        } else {
            ProgressView("Getting the shows you picked…").frame(maxWidth: .infinity).padding(.top, Space.x8)
        }
    }

    private func summary(_ r: HeardSaveResult) -> String {
        let plural = { (n: Int, one: String) in "\(n) \(n == 1 ? one : one + "s")" }
        var parts = ["Added \(plural(r.added, "show"))"]
        if r.already > 0 { parts.append("\(r.already == 1 ? "1 was" : "\(r.already) were") already in your account") }
        if r.queued > 0 { parts.append("\(plural(r.queued, "show")) saved on this iPhone until you're online") }
        return parts.joined(separator: "; ") + "."
    }

    private func load() async {
        guard session.user?.isAnonymous == false, selection == nil else { return }
        guard HeardSelection.parts(value) != nil else { problem = "That link doesn't name any shows."; return }
        do throws(APIError) {
            selection = try await store.heardSelection(value)
            problem = nil
        } catch {
            problem = error == .offline ? "You're offline. Connect to get the shows you picked."
                : "Those shows couldn't be found. The link may be old; pick them again in the Songs I've heard tool."
        }
    }

    private func save(_ selection: HeardSelection) async {
        saving = true
        defer { saving = false }
        let outcome = await store.saveHeard(selection)
        if var previous = result {
            previous.added += outcome.added
            previous.already += outcome.already
            previous.queued += outcome.queued
            previous.failed = outcome.failed
            result = previous
        } else {
            result = outcome
        }
    }
}
