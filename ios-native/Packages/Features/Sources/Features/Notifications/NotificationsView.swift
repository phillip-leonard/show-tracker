import Core
import DesignSystem
import SwiftUI

/// The inbox (Stage 3, Part 4), the web's Notification Center: replies,
/// likes and mentions, meetup joins, anniversaries and band alerts, newest
/// first, with All and Band alerts. Above them, what waits for an answer
/// (tags, suggestions, friend requests), so it's all in one place. Opening
/// a notification marks it read and goes where it's about.
struct NotificationsView: View {
    @Environment(NotificationsStore.self) private var inbox
    @Environment(FriendsStore.self) private var friends
    @Environment(ShowsStore.self) private var shows
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var filter: Filter = .all
    @State private var notice: String?
    @State private var flow = AddFlow()

    enum Filter: Hashable { case all, bands }

    private var isGuest: Bool { session.user?.isAnonymous == true }
    private var visible: [AppNotification] { filter == .bands ? inbox.bandAlerts : inbox.notifications }

    var body: some View {
        List {
            if !isGuest {
                ShowsToConfirmSection(notice: $notice, flow: flow)
                if !friends.incoming.isEmpty {
                    Section {
                        Button {
                            // Back to the Friends tab's root, where requests are answered.
                            router.paths[.friends] = []
                        } label: {
                            HStack {
                                Label(friends.incoming.count == 1 ? "1 friend request" : "\(friends.incoming.count) friend requests",
                                      systemImage: "person.badge.plus")
                                Spacer()
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .brandRow()
                }
            }

            Section {
                if !inbox.loaded {
                    HStack { Spacer(); ProgressView("Loading notifications…"); Spacer() }
                } else if let problem = inbox.loadProblem, inbox.notifications.isEmpty {
                    Text(problem).foregroundStyle(.secondary)
                } else if visible.isEmpty {
                    emptyState
                }
                ForEach(visible) { n in
                    NotificationRow(notification: n, destination: NotificationDestination.of(n, myShows: shows.shows)) {
                        open(n)
                    }
                }
            } header: {
                Picker("Show", selection: $filter) {
                    Text("All").tag(Filter.all)
                    Text(inbox.bandAlerts.isEmpty ? "Band alerts" : "Band alerts · \(inbox.bandAlerts.count)").tag(Filter.bands)
                }
                .pickerStyle(.segmented)
                .textCase(nil)
                .padding(.bottom, Space.x2)
            }
            .brandRow()
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if inbox.unreadCount > 0 {
                ToolbarItem(placement: .primaryAction) {
                    Button("Mark all read") { inbox.markAllRead() }
                }
            }
        }
        .notice($notice)
        .addOutcomeHandling(flow) { route in
            guard let route else { return }
            router.tab = .shows
            router.paths[.shows] = [route]
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Text(filter == .bands ? "No band alerts yet" : "No notifications yet")
                .font(.brand(.base, weight: .semibold))
            Text(filter == .bands
                 ? "Follow a band and you'll see it here when they announce a tour, a date at a venue on your bucket list, or a show going on sale near you."
                 : "Replies and likes on your comments and photos, and news from the bands you follow, show up here.")
                .font(.brand(.sm))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, Space.x2)
    }

    private func open(_ n: AppNotification) {
        inbox.markRead(n.id)
        switch NotificationDestination.of(n, myShows: shows.shows) {
        case .route(let tab, let route):
            router.tab = tab
            router.paths[tab] = [route]
        case .web(let url):
            router.show(url)
        case .none:
            break
        }
    }
}

/// One notification: its icon, message and time; a tour's dates and an
/// on-sale alert's windows, code and links inline (they have no single
/// destination); a dot while unread.
private struct NotificationRow: View {
    let notification: AppNotification
    let destination: NotificationDestination
    let open: () -> Void

    private var n: AppNotification { notification }

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: Space.x3) {
                Image(systemName: n.kind.symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.brand)
                    .frame(width: 36, height: 36)
                    .background(Color.brand.opacity(0.15), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Space.x1) {
                    Text(n.message)
                        .font(.brand(.sm, weight: n.read ? .regular : .semibold))
                        .foregroundStyle(n.read ? Color.textSecondary : Color.textPrimary)
                        .multilineTextAlignment(.leading)
                    if n.kind == .followedBandTour { tourDates }
                    if n.kind == .onsaleAlert { onsaleDetails }
                    if let at = n.createdAt {
                        Text(at.formatted(.relative(presentation: .named)))
                            .font(.brand(.xs))
                            .foregroundStyle(Color.textMuted)
                    }
                }
                Spacer(minLength: 0)
                if !n.read {
                    Circle().fill(Color.brand).frame(width: 8, height: 8).padding(.top, Space.x2)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, Space.x1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityValue(n.read ? "" : "Unread")
        .accessibilityHint(destination == .none ? "" : "Opens it")
    }

    @ViewBuilder
    private var tourDates: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(n.dates.enumerated()), id: \.offset) { _, d in
                let line = [d.date.map { ShowDateText.display($0) }, d.venue, d.city].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                if let s = d.url, let url = URL(string: s) {
                    Link(line, destination: url).font(.brand(.xs))
                } else {
                    Text(line).font(.brand(.xs)).foregroundStyle(.secondary)
                }
            }
            let more = (n.dateCount ?? n.dates.count) - n.dates.count
            if more > 0 { Text("…and \(more) more").font(.brand(.xs)).foregroundStyle(Color.textMuted) }
        }
    }

    @ViewBuilder
    private var onsaleDetails: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(n.windows.enumerated()), id: \.offset) { _, w in
                (Text("\(w.label): ").foregroundStyle(Color.textMuted) + Text(w.when).foregroundStyle(.secondary))
                    .font(.brand(.xs))
            }
            if let code = n.presaleCode {
                // One run of text, so the source wraps instead of being cut off.
                (Text("Presale code: ").foregroundStyle(.secondary)
                 + Text(code).font(.system(.caption, design: .monospaced).weight(.semibold))
                 + Text(n.codeSource.map { " (\($0))" } ?? "").foregroundStyle(Color.textMuted))
                    .font(.brand(.xs))
                    .textSelection(.enabled)
            }
            let artist = n.artist ?? "the band"
            if let s = n.portalUrl, let url = URL(string: s) {
                Link("\(artist)'s ticket portal", destination: url).font(.brand(.xs, weight: .semibold))
            } else if n.presaleCode == nil, let s = n.signupUrl, let url = URL(string: s) {
                Link("Sign up for \(artist)'s presale to get the code", destination: url).font(.brand(.xs, weight: .semibold))
            }
            if n.portalUrl == nil, let s = n.url, let url = URL(string: s) {
                Link("See the event", destination: url).font(.brand(.xs, weight: .semibold))
            }
        }
    }
}

/// The bell in the Friends tab's toolbar, with the unread count.
struct NotificationsButton: View {
    @Environment(NotificationsStore.self) private var inbox

    var body: some View {
        NavigationLink(value: AppRoute.notifications) {
            Image(systemName: inbox.unreadCount > 0 ? "bell.badge" : "bell")
                .symbolRenderingMode(.hierarchical)
        }
        .accessibilityLabel(inbox.unreadCount > 0 ? "Notifications, \(inbox.unreadCount) unread" : "Notifications")
    }
}
