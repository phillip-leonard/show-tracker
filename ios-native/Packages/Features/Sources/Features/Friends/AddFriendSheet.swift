import Core
import DesignSystem
import SwiftUI

/// "Add a friend": an exact email address or handle (Stage 3, C-6). Finds
/// the account through `friends.js` (never an address back), then sends a
/// request; an address with no account can be invited.
struct AddFriendSheet: View {
    @Environment(FriendsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var searching = false
    @State private var outcome: FriendLookupOutcome?
    @State private var problem: String?
    @State private var notice: String?
    @FocusState private var focused: Bool

    private var query: FriendSearchQuery? { FriendSearchQuery.parse(text) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email or @handle", text: $text)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .focused($focused)
                        .onSubmit { Task { await find() } }
                        .onChange(of: text) { outcome = nil; problem = nil }
                    Button {
                        Task { await find() }
                    } label: {
                        HStack {
                            Text("Find")
                            if searching { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(query == nil || searching)
                } footer: {
                    if let problem {
                        Text(problem).foregroundStyle(Color.amber)
                    } else if !text.isEmpty, query == nil {
                        Text("Enter an email address, or a handle of 3 to 20 letters, numbers or underscores.")
                    } else {
                        Text("Find a friend by their email address or their exact handle.")
                    }
                }
                .brandRow()

                if let outcome { result(outcome) }
            }
            .brandScreen()
            .navigationTitle("Add a friend")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            .onAppear { focused = true }
            .notice($notice)
        }
    }

    @ViewBuilder
    private func result(_ outcome: FriendLookupOutcome) -> some View {
        switch outcome {
        case .person(let uid, let name, let handle):
            Section {
                HStack(spacing: Space.x3) {
                    PersonAvatar(name: name)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).font(.brand(.base, weight: .medium))
                        if let handle { Text("@\(handle)").font(.brand(.sm)).foregroundStyle(.secondary) }
                    }
                }
                .accessibilityElement(children: .combine)
                if store.isFriend(uid) {
                    Label("You're friends", systemImage: "checkmark")
                        .foregroundStyle(.secondary)
                } else if store.hasSentRequest(to: uid) {
                    Label("Request sent", systemImage: "paperplane")
                        .foregroundStyle(.secondary)
                } else {
                    Button {
                        Task { notice = await store.sendRequest(to: uid, name: name) }
                    } label: {
                        HStack {
                            Label("Send friend request", systemImage: "person.badge.plus")
                            if store.busy.contains(uid) { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(store.busy.contains(uid))
                }
            }
            .brandRow()
        case .yourself:
            Section { Text("That's you.").foregroundStyle(.secondary) }
                .brandRow()
        case .noAccountForEmail(let email):
            Section {
                Button {
                    Task { notice = await store.invite(email: email) }
                } label: {
                    HStack {
                        Label("Invite \(email)", systemImage: "envelope")
                        if store.busy.contains(email) { Spacer(); ProgressView() }
                    }
                }
                .disabled(store.busy.contains(email) || store.invites.contains { $0.inviteeEmail == email })
            } header: {
                Text("No account uses that address yet")
            } footer: {
                Text(store.invites.contains { $0.inviteeEmail == email }
                     ? "You've invited this address. You'll be friends when they join."
                     : "We'll email them an invite from you. You'll be friends when they join.")
            }
            .brandRow()
        case .noAccountForHandle(let handle):
            Section {
                Text("No one has the handle @\(handle).")
                    .foregroundStyle(.secondary)
            } footer: {
                Text("Handles have to match exactly. You can also search by email.")
            }
            .brandRow()
        }
    }

    private func find() async {
        guard let query, !searching else { return }
        searching = true
        problem = nil
        defer { searching = false }
        do {
            outcome = try await store.lookup(query)
        } catch {
            outcome = nil
            problem = FriendsMessages.failure(error, fallback: "Couldn't search. Try again.")
        }
    }
}
