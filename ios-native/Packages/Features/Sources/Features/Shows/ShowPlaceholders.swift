import Core
import DesignSystem
import SwiftUI

/// `/shows/?upcoming=<id>` and an upcoming row, until its screen is built.
struct UpcomingDetailPlaceholder: View {
    @Environment(ShowsStore.self) private var store
    let id: String

    var body: some View {
        Group {
            if let show = store.upcomingShow(id: id) {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: Space.x2) {
                            Text(show.artist.isEmpty ? "Unknown band" : show.artist)
                                .font(.jakarta(size: 24, weight: .bold, relativeTo: .title2))
                                .foregroundStyle(Color.amber)
                            Text([ShowDateText.display(show.date), show.time].compactMap { $0 }.joined(separator: " · "))
                                .font(.jakarta(size: 16, relativeTo: .body))
                                .foregroundStyle(Color.textSecondary)
                            let place = venueLine(show.venue, show.city)
                            if !place.isEmpty { Text(place).font(.jakarta(size: 16, relativeTo: .body)).foregroundStyle(Color.textSecondary) }
                            if let notes = show.notes { Text(notes).font(.jakarta(size: 16, relativeTo: .body)).foregroundStyle(Color.textPrimary) }
                        }
                        .padding(.vertical, Space.x2)
                    }
                    .brandRow()
                }
                .navigationTitle(show.artist)
            } else if !store.upcomingLoaded {
                ProgressView("Loading the show")
            } else {
                ContentUnavailableView {
                    Label("That upcoming show isn't here any more", systemImage: "calendar")
                } description: {
                    Text("It may have been moved to your shows, or deleted.")
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The + until adding a show is built (Part 4).
struct AddShowPlaceholder: View {
    @Environment(\.dismiss) private var dismiss
    let isGuest: Bool

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Adding shows is coming", systemImage: "plus.circle")
            } description: {
                Text(isGuest
                     ? "The next TestFlight build adds searching setlist.fm and adding a show by hand."
                     : "The next TestFlight build adds searching setlist.fm and adding a show by hand. Until then, add shows on mysetlists.net; they appear here.")
            } actions: {
                if !isGuest {
                    Link("Open mysetlists.net", destination: URL(string: "https://mysetlists.net/search/")!)
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium])
    }
}
