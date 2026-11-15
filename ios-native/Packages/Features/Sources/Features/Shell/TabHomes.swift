import Core
import DesignSystem
import SwiftUI

// Each tab's root, until its feature is built (DECISIONS.md, "Build order").

struct ShowsHome: View {
    enum Segment: String, CaseIterable { case past = "Shows", upcoming = "Upcoming" }
    @State private var segment = Segment.past

    var body: some View {
        ContentUnavailableView {
            Label(segment == .past ? "Your shows" : "Upcoming shows", systemImage: segment == .past ? "music.note.list" : "calendar")
        } description: {
            Text(segment == .past ? "Every show you've been to, with its setlist." : "Shows you have tickets for.")
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: Space.x2) {
                UpdateBanner()
                Picker("Shows", selection: $segment) {
                    ForEach(Segment.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Space.x4)
            }
            .padding(.vertical, Space.x2)
        }
        .navigationTitle("Shows")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    // "Add a show" arrives with the Shows feature.
                } label: {
                    Label("Add a show", systemImage: "plus")
                }
            }
        }
    }
}

struct FriendsHome: View {
    @Environment(SessionStore.self) private var session
    @State private var showUpgrade = false

    var body: some View {
        Group {
            if session.user?.isAnonymous == true {
                // Guests have no friends list (DECISIONS.md, "Guests").
                ContentUnavailableView {
                    Label("Friends need an account", systemImage: "person.2")
                } description: {
                    Text("Create an account to add friends and see the shows you've been to together. Your shows come with you.")
                } actions: {
                    Button("Create your account") { showUpgrade = true }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                ContentUnavailableView("Friends", systemImage: "person.2", description: Text("Your friends, requests and shows together."))
            }
        }
        .navigationTitle("Friends")
        .sheet(isPresented: $showUpgrade) { GuestUpgradeView() }
    }
}

struct StatsHome: View {
    var body: some View {
        ContentUnavailableView("Stats", systemImage: "chart.bar", description: Text("Songs, bands, venues and your year in review."))
            .navigationTitle("Stats")
    }
}

struct SearchHome: View {
    @State private var query = ""

    var body: some View {
        Group {
            if query.isEmpty {
                ContentUnavailableView("Search", systemImage: "magnifyingglass", description: Text("Bands, venues and songs."))
            } else {
                ContentUnavailableView.search(text: query)
            }
        }
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Bands, venues, songs")
    }
}

/// A screen a link or a tap can reach before it's built: what it will be,
/// and the same page on the web meanwhile.
struct RoutePlaceholder: View {
    @Environment(AppRouter.self) private var router
    let route: AppRoute

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(detail)
        } actions: {
            Button("Open on mysetlists.net") { router.show(route.webURL) }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    var title: String {
        switch route {
        case .show, .upcomingShow: "Show"
        case .band: "Band"
        case .song: "Song"
        case .venue: "Venue"
        case .yearInReview(_, let year): "\(year) in Review"
        }
    }

    var symbol: String {
        switch route {
        case .show: "music.mic"
        case .upcomingShow: "calendar"
        case .band: "guitars"
        case .song: "music.note"
        case .venue: "building.columns"
        case .yearInReview: "sparkles"
        }
    }

    var detail: String {
        switch route {
        case .show(let id), .upcomingShow(let id): "Show \(id)"
        case .band(let slug): slug
        case .song(let band, let song): [band, song].compactMap { $0 }.joined(separator: " · ")
        case .venue(let key): key
        case .yearInReview: "A year of shows"
        }
    }
}
