import Core
import DesignSystem
import SwiftUI

/// "Tag friends" from a show (Stage 3, Part 3b): pick friends who were
/// there (or are going), and for a past show, someone without an account
/// by address. The server builds the tag from the show as stored and sends
/// the emails (`friends.js tag`, 5.60.29).
struct TagFriendsSheet: View {
    @Environment(FriendsStore.self) private var friends
    @Environment(\.dismiss) private var dismiss
    let target: FriendsRequest.TagTarget
    let band: String
    let alreadyTagged: [String]
    let onDone: (String) -> Void

    @State private var picked: Set<String> = []
    @State private var email = ""
    @State private var emailName = ""
    @State private var sending = false
    @State private var problem: String?

    private var isUpcoming: Bool { if case .upcoming = target { return true } else { return false } }
    private var candidates: [FriendEdge] {
        ShowSocialLists.taggable(friends.friends, alreadyTagged: alreadyTagged, blocked: Set(friends.blockedUids))
    }
    private var emailTag: FriendsRequest.EmailTag? {
        guard !isUpcoming, case .email(let e)? = FriendSearchQuery.parse(email) else { return nil }
        let name = emailName.trimmingCharacters(in: .whitespaces)
        return .init(email: e, name: name.isEmpty ? nil : name)
    }
    private var emailIsInvalid: Bool { !email.trimmingCharacters(in: .whitespaces).isEmpty && emailTag == nil }
    private var canSend: Bool { !sending && !emailIsInvalid && (!picked.isEmpty || emailTag != nil) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if candidates.isEmpty {
                        Text(friends.friends.isEmpty
                             ? "Add friends in the Friends tab to tag them at shows."
                             : "Everyone on your friends list is tagged here already.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(candidates) { friend in
                        Button {
                            if picked.contains(friend.friendUid) { picked.remove(friend.friendUid) } else { picked.insert(friend.friendUid) }
                        } label: {
                            HStack(spacing: Space.x3) {
                                PersonAvatar(name: friend.name, photoURL: friend.friendPhotoURL, size: 32)
                                Text(friend.name).foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: picked.contains(friend.friendUid) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(picked.contains(friend.friendUid) ? Color.brand : .secondary)
                                    .font(.title3)
                            }
                            .frame(minHeight: TouchTarget.minimum)
                            .contentShape(Rectangle())
                        }
                        // Plain, so the name isn't drawn in the tint like a link.
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(picked.contains(friend.friendUid) ? .isSelected : [])
                    }
                } header: {
                    Text(isUpcoming ? "Who's going with you?" : "Who was there?")
                } footer: {
                    Text(isUpcoming
                         ? "They'll be asked to add it to their upcoming shows."
                         : "They'll be asked to add it to their shows. Your ratings and note aren't shared.")
                }
                .brandRow()

                if !isUpcoming {
                    Section {
                        TextField("Email address", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if !email.isEmpty {
                            TextField("Their name (optional)", text: $emailName)
                                .textContentType(.name)
                        }
                    } header: {
                        Text("Someone without an account")
                    } footer: {
                        if emailIsInvalid { Text("That email address doesn't look right.").foregroundStyle(Color.amber) }
                        else { Text("We'll email them an invite to join and add this show.") }
                    }
                    .brandRow()
                }

                if let problem {
                    Section { Text(problem).foregroundStyle(Color.amber) }
                        .brandRow()
                }
            }
            .brandScreen()
            .disabled(sending)
            .navigationTitle("Tag friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: {
                        if sending { ProgressView() } else { Text(picked.count > 1 ? "Tag \(picked.count)" : "Tag") }
                    }
                    .disabled(!canSend)
                }
            }
            .interactiveDismissDisabled(sending)
        }
    }

    private func send() async {
        guard canSend else { return }
        sending = true
        problem = nil
        defer { sending = false }
        do {
            let message = try await friends.tag(target, friendUids: Array(picked), emails: emailTag.map { [$0] } ?? [], band: band)
            onDone(message)
            dismiss()
        } catch {
            problem = FriendsMessages.failure(error, fallback: "Couldn't tag your friends. Try again.")
        }
    }
}
