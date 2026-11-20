import Core
import DesignSystem
import SwiftUI

// Your friends' activity (Stage 6, 6-6; the web's ActivityFeedView): what
// mutual friends who share their activity have added, rated, commented on
// and shared, newest first. The newest few are at the top of the Friends
// tab; "See all" (and `/activity` links) open the whole feed with its
// filters. Read through friends.js, which leaves blocks either way out.

/// The top of the Friends list: the newest three, and the way to the rest.
struct FriendActivitySection: View {
    @Environment(ActivityStore.self) private var activity
    @Environment(FriendsStore.self) private var friends
    @Binding var person: PersonRef?
    static let preview = 3

    var body: some View {
        let shown = ActivityFeed.visible(activity.items, hiding: Set(friends.blockedUids))
        Section {
            switch activity.state {
            case .idle, .loading where shown.isEmpty:
                HStack(spacing: Space.x2) {
                    ProgressView()
                    Text("Loading activity…").font(.brand(.sm)).foregroundStyle(.secondary)
                }
            case .failed(let message) where shown.isEmpty:
                Text(message).font(.brand(.sm)).foregroundStyle(.secondary)
            default:
                if shown.isEmpty {
                    Text("When your friends add or rate a show, it shows up here.")
                        .font(.brand(.sm)).foregroundStyle(.secondary)
                } else {
                    ForEach(shown.prefix(Self.preview)) { item in
                        ActivityRow(item: item, person: $person)
                    }
                }
            }
            NavigationLink(value: AppRoute.activity) {
                Label("All activity", systemImage: "bolt.heart")
                    .foregroundStyle(Color.brand)
            }
        } header: {
            Text("Friend activity")
        }
        .brandRow()
        .task { await activity.refreshIfStale() }
    }
}

/// `/activity`: the whole feed, filtered by kind, 100 a page.
struct ActivityScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ActivityStore.self) private var activity
    @Environment(FriendsStore.self) private var friends
    @Environment(\.scenePhase) private var scenePhase
    @State private var filter: ActivityFilter = .all
    @State private var person: PersonRef?
    @State private var upgrading = false

    var body: some View {
        Group {
            if session.user?.isAnonymous != false {
                ContentUnavailableView {
                    Label("Activity needs an account", systemImage: "bolt.heart")
                } description: {
                    Text("Create an account to add friends and see the shows they add and rate. Your shows come with you.")
                } actions: {
                    Button("Create your account") { upgrading = true }
                        .buttonStyle(.borderedProminent)
                        .tint(.brand)
                }
            } else if friends.loaded && friends.friends.isEmpty {
                ContentUnavailableView {
                    Label("Add some friends first", systemImage: "person.2")
                } description: {
                    Text("Your activity feed shows what friends are up to. Add friends to see their shows and ratings here.")
                }
            } else {
                feed
            }
        }
        .navigationTitle("Activity")
        .sheet(item: $person) { PersonSheet(person: $0) }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }

    private var feed: some View {
        let shown = ActivityFeed.visible(activity.items, hiding: Set(friends.blockedUids), filter: filter)
        return List {
            Section {
                Picker("Show", selection: $filter) {
                    ForEach(ActivityFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            switch activity.state {
            case .idle, .loading where activity.items.isEmpty:
                Section { ProgressView("Loading activity…").frame(maxWidth: .infinity) }
                    .listRowBackground(Color.clear)
            case .failed(let message) where activity.items.isEmpty:
                Section {
                    ContentUnavailableView {
                        Label("Couldn't load activity", systemImage: "wifi.slash")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await activity.refresh() } }
                    }
                }
                .listRowBackground(Color.clear)
            default:
                Section {
                    if shown.isEmpty {
                        Text(filter == .all
                             ? "Nothing here yet. When your friends add or rate a show, it shows up here."
                             : "Nothing like that from your friends yet.")
                            .font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                    ForEach(shown) { item in ActivityRow(item: item, person: $person) }
                } footer: {
                    if let problem = activity.problem {
                        Text(problem).foregroundStyle(Color.amber)
                    }
                }
                .brandRow()

                if activity.next != nil {
                    Section {
                        Button {
                            Task { await activity.loadOlder() }
                        } label: {
                            HStack {
                                Text("Show older")
                                if activity.loadingMore { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(activity.loadingMore)
                    }
                    .brandRow()
                }
            }
        }
        .refreshable { await activity.refresh() }
        .task { await activity.refreshIfStale() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await activity.refreshIfStale() } }
        }
    }
}

/// One entry: who, what, when. Opens the friend's public page for that show
/// when they had a public profile then, otherwise their card.
struct ActivityRow: View {
    @Environment(AppRouter.self) private var router
    let item: ActivityItem
    @Binding var person: PersonRef?

    private var ref: PersonRef { PersonRef(uid: item.userId, name: item.userName) }

    var body: some View {
        Button {
            if let url = item.publicShowURL { router.show(url) } else { person = ref }
        } label: {
            HStack(alignment: .top, spacing: Space.x3) {
                PersonAvatar(name: item.userName, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    (Text(item.userName).fontWeight(.semibold) + Text(" ") + Text(item.summary))
                        .font(.brand(.sm))
                        .foregroundStyle(Color.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(item.timestamp, format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: icon)
                    .font(.footnote)
                    .foregroundStyle(item.action == .ratedShow ? Color.amber : Color.brand)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("\(item.userName)'s profile", systemImage: "person") { person = ref }
            if let url = item.publicShowURL {
                Button("Their page for this show", systemImage: "globe") { router.show(url) }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(item.publicShowURL == nil ? "Shows options for \(item.userName)" : "Opens \(item.userName)'s page for this show")
    }

    private var icon: String {
        switch item.action {
        case .addedShow: "plus.circle"
        case .ratedShow: "star.fill"
        case .commented: "bubble.left"
        case .sharedMedia: "camera"
        }
    }
}
