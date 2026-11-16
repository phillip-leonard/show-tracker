import Core
import DesignSystem
import SwiftUI

/// The Friends tab (Stage 3, Part 2b): requests to you, your friends, the
/// requests and invites you've sent, and your invite link. Guests get the
/// "Friends need an account" screen (DECISIONS.md, "Guests").
struct FriendsHome: View {
    @Environment(SessionStore.self) private var session
    @State private var showUpgrade = false

    var body: some View {
        Group {
            if session.user?.isAnonymous == true {
                ContentUnavailableView {
                    Label("Friends need an account", systemImage: "person.2")
                } description: {
                    Text("Create an account to add friends and see the shows you've been to together. Your shows come with you.")
                } actions: {
                    Button("Create your account") { showUpgrade = true }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                FriendsList()
            }
        }
        .navigationTitle("Friends")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { NotificationsButton() }
        }
        .sheet(isPresented: $showUpgrade) { GuestUpgradeView() }
    }
}

struct FriendsList: View {
    @Environment(FriendsStore.self) private var store
    @State private var adding = false
    @State private var person: PersonRef?
    @State private var notice: String?
    @State private var confirmRemove: PersonRef?
    @State private var confirmBlock: PersonRef?
    @State private var offlineNote = false
    @State private var flow = AddFlow()
    @Environment(AppRouter.self) private var router
    @Environment(ShowsStore.self) private var shows

    private var isEmpty: Bool {
        store.friends.isEmpty && store.sent.isEmpty && store.invites.isEmpty && store.waitingCount == 0
    }

    var body: some View {
        Group {
            if !store.loaded {
                ProgressView("Loading your friends…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if isEmpty {
                emptyState
            } else {
                list
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add a friend", systemImage: "person.badge.plus") }
            }
        }
        .sheet(isPresented: $adding) { AddFriendSheet() }
        .sheet(item: $person) { PersonSheet(person: $0) }
        .confirmationDialog(confirmRemove.map { "Remove \($0.name) from your friends?" } ?? "",
                            isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }),
                            titleVisibility: .visible, presenting: confirmRemove) { p in
            Button("Remove", role: .destructive) { run { await store.remove(friendUid: p.uid, name: p.name) } }
        } message: { _ in
            Text("You'll stop seeing each other's shows. You can send a new request later.")
        }
        .confirmationDialog(confirmBlock.map { BlockCopy.title($0.name) } ?? "",
                            isPresented: Binding(get: { confirmBlock != nil }, set: { if !$0 { confirmBlock = nil } }),
                            titleVisibility: .visible, presenting: confirmBlock) { p in
            Button("Block", role: .destructive) { run { await store.block(uid: p.uid, name: p.name) } }
        } message: { _ in
            Text(BlockCopy.message)
        }
        .notice($notice)
        // A past show's tag is added like any other show (normalize-show).
        .addOutcomeHandling(flow) { route in
            guard let route else { return }
            router.tab = .shows
            router.paths[.shows] = [route]
        }
        // Shows together change with your shows; asked again (debounced in
        // the store) when the count changes, not on every snapshot.
        .onChange(of: shows.shows.count) { store.refreshTogetherCounts() }
        .task(id: store.fromCache) {
            // A first snapshot is often the cache for a moment; only one that
            // lasts means the phone is offline.
            offlineNote = false
            guard store.fromCache else { return }
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { offlineNote = store.fromCache }
        }
    }

    private func run(_ action: @escaping () async -> String) {
        Task { notice = await action() }
    }

    // MARK: The list

    private var list: some View {
        List {
            ShowsToConfirmSection(notice: $notice, flow: flow)

            if !store.incoming.isEmpty {
                Section("Requests") {
                    ForEach(store.incoming) { request in
                        IncomingRequestRow(request: request, busy: store.busy.contains(request.id),
                                           open: { person = PersonRef(uid: request.from, name: request.fromName ?? "Someone") },
                                           accept: { run { await store.accept(request) } },
                                           decline: { run { await store.decline(request) } })
                    }
                }
                .brandRow()
            }

            Section {
                if store.friends.isEmpty {
                    Text("No friends yet. Add someone by their email or handle, or share your invite link.")
                        .foregroundStyle(.secondary)
                }
                ForEach(store.friends) { friend in
                    let ref = PersonRef(uid: friend.friendUid, name: friend.name)
                    Button { person = ref } label: {
                        FriendRow(friend: friend, together: store.togetherCounts[friend.friendUid])
                    }
                    .foregroundStyle(.primary)
                    .disabled(store.busy.contains(friend.friendUid))
                    .swipeActions(edge: .trailing) {
                        // The app's tint would make a destructive action green.
                        Button("Remove", role: .destructive) { confirmRemove = ref }
                            .tint(Color.danger)
                        Button("Block") { confirmBlock = ref }
                            .tint(.gray)
                    }
                    .contextMenu {
                        Button("Remove friend", systemImage: "person.badge.minus", role: .destructive) { confirmRemove = ref }
                        Button("Block", systemImage: "hand.raised") { confirmBlock = ref }
                    }
                }
            } header: {
                Text(store.friends.isEmpty ? "Friends" : "Friends · \(store.friends.count)")
            } footer: {
                if offlineNote {
                    Text("You're offline. Showing the friends saved on this device. Requests and invites need a connection.")
                }
            }
            .brandRow()

            if !store.sent.isEmpty {
                Section("Sent requests") {
                    ForEach(store.sent) { request in
                        SentRequestRow(request: request, busy: store.busy.contains(request.id)) {
                            run { await store.cancel(request) }
                        }
                    }
                }
                .brandRow()
            }

            if !store.invites.isEmpty {
                Section {
                    ForEach(store.invites) { invite in
                        InviteRow(invite: invite, busy: store.busy.contains(invite.id),
                                  resend: { run { await store.resend(invite) } },
                                  withdraw: { run { await store.withdraw(invite) } })
                    }
                } header: {
                    Text("Invites")
                } footer: {
                    Text("They become your friend when they join with this address.")
                }
                .brandRow()
            }

            Section {
                InviteLinkRow(notice: $notice)
            } footer: {
                Text("Anyone who joins with your link becomes your friend.")
            }
            .brandRow()
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No friends yet", systemImage: "person.2")
        } description: {
            Text("Add friends by email or handle to see the shows you've been to together.")
        } actions: {
            Button("Add a friend") { adding = true }
                .buttonStyle(.borderedProminent)
            InviteLinkRow(notice: $notice)
                .buttonStyle(.bordered)
        }
    }
}

// MARK: Rows

private struct FriendRow: View {
    let friend: FriendEdge
    let together: Int?

    var body: some View {
        HStack(spacing: Space.x3) {
            PersonAvatar(name: friend.name, photoURL: friend.friendPhotoURL)
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.name)
                    .font(.brand(.base, weight: .medium))
                if let together, together > 0 {
                    Text(together == 1 ? "1 show together" : "\(together) shows together")
                        .font(.brand(.sm))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .frame(minHeight: TouchTarget.minimum)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows options for this friend")
    }
}

private struct IncomingRequestRow: View {
    let request: FriendRequest
    let busy: Bool
    let open: () -> Void
    let accept: () -> Void
    let decline: () -> Void

    private var name: String { request.fromName ?? "Someone" }

    var body: some View {
        // Side by side when there's room; the buttons under the name on a
        // narrow phone or at large text sizes.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Space.x3) {
                person
                Spacer(minLength: Space.x2)
                actions
            }
            VStack(alignment: .leading, spacing: Space.x2) {
                person
                actions
            }
        }
        .frame(minHeight: TouchTarget.minimum)
    }

    private var person: some View {
        Button(action: open) {
            HStack(spacing: Space.x3) {
                PersonAvatar(name: name)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.brand(.base, weight: .medium))
                    Text("Wants to be friends").font(.brand(.sm)).foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: true, vertical: false)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var actions: some View {
        if busy {
            ProgressView()
        } else {
            HStack(spacing: Space.x2) {
                Button("Decline", action: decline)
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Decline \(name)")
                Button("Accept", action: accept)
                    .buttonStyle(.borderedProminent)
                    .tint(.brand)
                    .accessibilityLabel("Accept \(name)")
            }
        }
    }
}

private struct SentRequestRow: View {
    let request: FriendRequest
    let busy: Bool
    let cancel: () -> Void

    private var name: String { request.toName ?? "Someone" }

    var body: some View {
        HStack(spacing: Space.x3) {
            PersonAvatar(name: name)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.brand(.base, weight: .medium))
                Text("Request sent").font(.brand(.sm)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if busy { ProgressView() } else {
                Button("Cancel", action: cancel)
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Cancel request to \(name)")
            }
        }
        .frame(minHeight: TouchTarget.minimum)
    }
}

private struct InviteRow: View {
    let invite: Invite
    let busy: Bool
    let resend: () -> Void
    let withdraw: () -> Void

    var body: some View {
        HStack(spacing: Space.x3) {
            Image(systemName: "envelope")
                .frame(width: 40, height: 40)
                .foregroundStyle(Color.brand)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(invite.inviteeEmail)
                    .font(.brand(.base, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let sent = invite.lastSentAt ?? invite.createdAt {
                    Text("Sent \(sent.formatted(.relative(presentation: .named)))")
                        .font(.brand(.sm))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if busy { ProgressView() } else {
                Menu {
                    Button("Resend", systemImage: "arrow.clockwise", action: resend)
                    Button("Withdraw invite", systemImage: "xmark", role: .destructive, action: withdraw)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .frame(minWidth: TouchTarget.minimum, minHeight: TouchTarget.minimum)
                }
                .accessibilityLabel("Options for the invite to \(invite.inviteeEmail)")
            }
        }
        .frame(minHeight: TouchTarget.minimum)
    }
}

/// Shares the signed invite link (`referralLink`). Fetched when the row
/// appears; offline, tapping says so.
struct InviteLinkRow: View {
    @Environment(FriendsStore.self) private var store
    @Binding var notice: String?
    @State private var loading = false

    var body: some View {
        if let url = store.referralURL {
            ShareLink(item: url, subject: Text("Join me on MySetlists"),
                      message: Text("I'm keeping track of the shows I've been to on MySetlists. Join with my link and we'll be friends:")) {
                Label("Share your invite link", systemImage: "square.and.arrow.up")
            }
        } else {
            Button {
                Task { await load(report: true) }
            } label: {
                HStack {
                    Label("Share your invite link", systemImage: "square.and.arrow.up")
                    if loading { Spacer(); ProgressView() }
                }
            }
            .disabled(loading)
            .task { await load(report: false) }
        }
    }

    private func load(report: Bool) async {
        guard store.referralURL == nil, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            _ = try await store.loadReferralLink()
        } catch {
            if report { notice = FriendsMessages.failure(error, fallback: "Couldn't get your invite link. Try again.") }
        }
    }
}
