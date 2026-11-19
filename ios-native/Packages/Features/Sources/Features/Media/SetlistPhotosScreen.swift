import Core
import DesignSystem
import SwiftUI

/// `/setlist-photos` (Stage 6, 6-4; the web's SetlistPhotoDirectory), in
/// Me's Library: setlist photos from every concert, newest first, searched
/// by band, venue or date. Browse only; they're added from a show's page.
/// Uploads from people you blocked never show, even in a search.
struct SetlistPhotosScreen: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            if let user = session.user, !user.isAnonymous {
                SetlistPhotosDirectory(uid: user.uid, api: session.api)
            } else {
                SetlistPhotosNeedAnAccount()
            }
        }
        .navigationTitle("Setlist Photos")
    }
}

private struct SetlistPhotosNeedAnAccount: View {
    @State private var upgrading = false

    var body: some View {
        ContentUnavailableView {
            Label("Create an account to see setlist photos", systemImage: "photo.on.rectangle")
        } description: {
            Text("Photos of the paper and board setlists people shared from their shows. Your shows come with you.")
        } actions: {
            Button("Create your account") { upgrading = true }
                .buttonStyle(.borderedProminent)
                .tint(.brand)
        }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }
}

private struct SetlistPhotosDirectory: View {
    @Environment(FriendsStore.self) private var friends
    @State private var store: SetlistPhotosStore
    @State private var query = ""
    @State private var viewing: MediaViewerState?
    @State private var reporting: ShowMedia?
    @State private var person: PersonRef?
    @State private var deleting: ShowMedia?
    @State private var notice: (text: String, error: Bool)?

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 240), spacing: Space.x3)]

    init(uid: String, api: APIClient?) {
        _store = State(initialValue: SetlistPhotosStore(uid: uid, api: api))
    }

    var body: some View {
        let items = store.visible(hiding: Set(friends.blockedUids), query: query)
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x3) {
                if let notice {
                    Text(notice.text).font(.brand(.sm)).foregroundStyle(notice.error ? Color.amber : Color.textMuted)
                }
                content(items)
            }
            .padding(.horizontal, Space.x5)
            .padding(.vertical, Space.x3)
        }
        .brandScreen()
        .searchable(text: $query, prompt: "Band, venue or date")
        .refreshable { await store.load() }
        .task { if store.state == .loading { await store.load() } }
        .fullScreenCover(item: $viewing) { state in
            MediaViewer(state: state, uid: store.uid, showsConcert: true,
                        live: { id in store.items.first { $0.id == id } },
                        busy: store.busy,
                        onLike: { await store.toggleLike($0) },
                        onDelete: { deleting = $0 },
                        onReport: { reporting = $0 },
                        onPerson: { person = PersonRef(uid: $0.uploadedBy, name: $0.uploaderName) })
                .sheet(item: $reporting) { item in
                    ReportContentSheet(title: "Report setlist photo") { reason, details throws(APIError) in
                        try await store.report(item, reason: reason, details: details)
                    } onSent: { text in
                        notice = (text, false)
                        viewing = nil
                    }
                }
                .sheet(item: $person) { PersonSheet(person: $0) }
                .confirmationDialog("Delete this?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                    titleVisibility: .visible, presenting: deleting) { item in
                    Button("Delete", role: .destructive) {
                        Task {
                            if let problem = await store.delete(item) { notice = (problem, true) } else { viewing = nil }
                        }
                    }
                } message: { _ in
                    Text("It's removed for everyone at this show.")
                }
        }
    }

    @ViewBuilder private func content(_ items: [ShowMedia]) -> some View {
        switch store.state {
        case .loading where store.items.isEmpty:
            ProgressView("Loading setlist photos…").frame(maxWidth: .infinity).padding(.top, Space.x8)
        case .failed(let message) where store.items.isEmpty:
            ContentUnavailableView {
                Label("Couldn't load setlist photos", systemImage: "wifi.slash")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await store.load() } }
            }
        default:
            if items.isEmpty {
                if store.items.isEmpty {
                    ContentUnavailableView("No setlist photos yet", systemImage: "photo.on.rectangle",
                                           description: Text("Setlist photos shared from any show will be here, searchable by band or venue."))
                } else {
                    ContentUnavailableView.search(text: query)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: Space.x4) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        Button { viewing = MediaViewerState(items: items, index: index) } label: { tile(item) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func tile(_ item: ShowMedia) -> some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            MediaThumbnail(item: item)
            Text(item.artist ?? "Unknown band")
                .font(.brand(.sm, weight: .semibold))
                .foregroundStyle(Color.textPrimary)
                .lineLimit(1)
            let line = [item.venue, item.date.map { ShowDateText.display($0) }].compactMap { $0 }.joined(separator: " · ")
            if !line.isEmpty {
                Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the setlist photo")
    }
}
