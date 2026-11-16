import Core
import DesignSystem
import SwiftUI

/// Me → Blocked accounts (the web's `BlockedAccountsSection`): the undo for
/// a block, and the only place that lists who you've blocked. Names come
/// from each profile, read when this opens; a name that can't be read
/// never stops an unblock.
struct BlockedAccountsView: View {
    @Environment(FriendsStore.self) private var store
    @State private var names: [String: String] = [:]
    @State private var notice: String?
    @State private var confirmUnblock: PersonRef?

    var body: some View {
        List {
            Section {
                if store.blockedUids.isEmpty {
                    Text("You haven't blocked anyone. You can block someone from their row in Friends, or from their card.")
                        .foregroundStyle(.secondary)
                }
                ForEach(store.blockedUids, id: \.self) { uid in
                    let name = names[uid] ?? "Blocked account"
                    HStack(spacing: Space.x3) {
                        PersonAvatar(name: name)
                        Text(name).font(.brand(.base, weight: .medium))
                        Spacer(minLength: 0)
                        if store.busy.contains(uid) {
                            ProgressView()
                        } else {
                            Button("Unblock") { confirmUnblock = PersonRef(uid: uid, name: name) }
                                .buttonStyle(.bordered)
                                .accessibilityLabel("Unblock \(name)")
                        }
                    }
                    .frame(minHeight: TouchTarget.minimum)
                }
            } footer: {
                if !store.blockedUids.isEmpty {
                    Text("You don't see activity from anyone here, and you aren't in each other's friends lists. Unblocking doesn't make you friends again.")
                }
            }
            .brandRow()
        }
        .navigationTitle("Blocked accounts")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(confirmUnblock.map { "Unblock \($0.name)?" } ?? "",
                            isPresented: Binding(get: { confirmUnblock != nil }, set: { if !$0 { confirmUnblock = nil } }),
                            titleVisibility: .visible, presenting: confirmUnblock) { p in
            Button("Unblock") { Task { notice = await store.unblock(uid: p.uid, name: p.name) } }
        } message: { _ in
            Text("They'll be able to find you and send you a friend request again.")
        }
        .notice($notice)
        .task(id: store.blockedUids) {
            for uid in store.blockedUids where names[uid] == nil {
                let profile = await store.profile(uid: uid)
                names[uid] = profile?.displayName ?? (profile == nil ? "Deleted account" : "Blocked account")
            }
        }
    }
}
