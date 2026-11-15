import Core
import DesignSystem
import SwiftUI

// Each tab's root, until its feature is built (DECISIONS.md, "Build order").

// ShowsHome is Features/Shows/ShowsHome.swift (Stage 1, Part 2).

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
