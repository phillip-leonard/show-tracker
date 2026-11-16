import Core
import DesignSystem
import SwiftUI

// MARK: - Shows to confirm (Friends tab)

/// Tags, tags sent to your address, and "were you there together?",
/// waiting for an answer: the top of the Friends tab (Stage 3, Part 3b).
/// Every answer goes through the server; a past show's tag is added
/// through `normalize-show`, like any other add.
struct ShowsToConfirmSection: View {
    @Environment(FriendsStore.self) private var friends
    @Environment(ShowsStore.self) private var shows
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @Binding var notice: String?
    /// The list's add flow: its alerts are attached to the list, not here.
    let flow: AddFlow

    private var uid: String { session.user?.uid ?? "" }
    private var isEmpty: Bool { friends.pendingTags.isEmpty && friends.pendingEmailTags.isEmpty && friends.pendingSuggestions.isEmpty }

    var body: some View {
        if !isEmpty {
            Section {
                ForEach(friends.pendingTags) { tag in
                    ConfirmRow(title: ShowSocialMessages.tagTitle(tag), detail: detail(tag.showData.venue, tag.showData.date),
                               yes: ShowSocialMessages.isUpcoming(tag) ? "Add" : "I was there", no: "Decline",
                               busy: friends.busy.contains(tag.id) || flow.busy,
                               onYes: { answer(tag, accept: true) }, onNo: { answer(tag, accept: false) })
                }
                ForEach(friends.pendingEmailTags) { tag in
                    ConfirmRow(title: "\(tag.fromName.isEmpty ? "A friend" : tag.fromName) says you were at \(tag.showData.artist)",
                               detail: detail(tag.showData.venue, tag.showData.date),
                               yes: "I was there", no: "Decline", busy: friends.busy.contains(tag.id) || flow.busy,
                               onYes: { addEmailTag(tag) },
                               onNo: { Task { notice = await friends.declineEmailTag(tag) } })
                }
                ForEach(friends.pendingSuggestions) { s in
                    ConfirmRow(title: ShowSocialMessages.suggestionTitle(s, uid: uid),
                               detail: [detail(s.showData.venue, s.showData.date), ShowSocialMessages.suggestionNote(s, uid: uid)]
                                .compactMap { $0 }.joined(separator: " · "),
                               yes: "Yes", no: "No", busy: friends.busy.contains(s.id),
                               onYes: { Task { notice = await friends.answer(s, confirmed: true) } },
                               onNo: { Task { notice = await friends.answer(s, confirmed: false) } })
                }
            } header: {
                Text("Shows to confirm")
            }
            .brandRow()
        }
    }

    private func detail(_ venue: String, _ date: String) -> String {
        [venue.isEmpty ? nil : venue, date.isEmpty ? nil : ShowDateText.display(date)].compactMap { $0 }.joined(separator: " · ")
    }

    private func display(_ data: TagShowData) -> QueuedShow.Display {
        .init(artist: data.artist, venue: data.venue, city: data.city, date: data.isoDate)
    }

    private func answer(_ tag: ShowTag, accept: Bool) {
        Task {
            do {
                switch try await friends.answer(tag, accept: accept) {
                case .done(let message): notice = message
                case .addedUpcoming(let id, let message):
                    notice = message
                    router.tab = .shows
                    router.paths[.shows] = [.upcomingShow(id: id)]
                case .addAsShow(let asPastShow):
                    flow.run { await shows.addShow(ShowInput(.tag(tagId: tag.id, asPastShow: asPastShow)), display: display(tag.showData)) }
                }
            } catch {
                let apiError = (error as? APIError) ?? .server(status: 0, message: nil, code: nil)
                notice = FriendsMessages.failure(apiError, fallback: "Couldn't answer that tag. Try again.")
            }
        }
    }

    private func addEmailTag(_ tag: PendingEmailTag) {
        flow.run { await shows.addShow(ShowInput(.emailTag(pendingEmailTagId: tag.id)), display: display(tag.showData)) }
    }
}

private struct ConfirmRow: View {
    let title: String
    let detail: String
    let yes: String
    let no: String
    let busy: Bool
    let onYes: () -> Void
    let onNo: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.brand(.base, weight: .medium))
                if !detail.isEmpty { Text(detail).font(.brand(.sm)).foregroundStyle(.secondary) }
            }
            .accessibilityElement(children: .combine)
            HStack(spacing: Space.x2) {
                if busy {
                    ProgressView()
                } else {
                    Button(no, action: onNo).buttonStyle(.bordered)
                    Button(yes, action: onYes).buttonStyle(.borderedProminent).tint(.brand)
                }
            }
        }
        .padding(.vertical, Space.x1)
    }
}

// MARK: - On a show

/// Who's tagged at one of your shows, and who tagged you. Opens the tag
/// sheet (accounts only).
struct TaggedWithCard: View {
    @Environment(FriendsStore.self) private var friends
    let taggedUids: [String]
    let taggedBy: String?
    var statuses: [String: String] = [:]
    let upcoming: Bool
    let onTag: () -> Void
    var onRemove: ((String, String) -> Void)?

    private var visible: [String] { taggedUids.filter { !friends.isBlocked($0) } }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            HStack {
                Text(upcoming ? "Going with" : "Who was there")
                    .font(.brand(.sm, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: onTag) { Label("Tag friends", systemImage: "person.badge.plus") }
                    .font(.brand(.sm, weight: .semibold))
                    .frame(minHeight: TouchTarget.minimum)
            }
            if let taggedBy, !taggedBy.isEmpty {
                Label("\(taggedBy) tagged you", systemImage: "tag").font(.brand(.sm)).foregroundStyle(.secondary)
            }
            if visible.isEmpty && (taggedBy ?? "").isEmpty {
                Text(upcoming ? "Going with friends? Tag them and they'll be asked to add it." : "Were friends there? Tag them and they'll be asked to add it.")
                    .font(.brand(.sm))
                    .foregroundStyle(.secondary)
            }
            ForEach(visible, id: \.self) { uid in
                let name = friends.name(of: uid) ?? "A friend"
                HStack(spacing: Space.x3) {
                    PersonAvatar(name: name, size: 32)
                    Text(name).font(.brand(.base))
                    Spacer(minLength: 0)
                    if let status = statuses[uid] {
                        Text(Self.label(status)).font(.brand(.sm)).foregroundStyle(status == "accepted" ? Color.brand : .secondary)
                    }
                    if let onRemove {
                        Menu {
                            Button("Remove \(name)", systemImage: "person.badge.minus", role: .destructive) { onRemove(uid, name) }
                        } label: {
                            Image(systemName: "ellipsis").frame(minWidth: TouchTarget.minimum, minHeight: TouchTarget.minimum)
                        }
                        .accessibilityLabel("Options for \(name)")
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }

    static func label(_ status: String) -> String {
        switch status {
        case "accepted": "Going"
        case "declined": "Can't make it"
        case "revoked": "Removed"
        default: "Asked"
        }
    }
}

// MARK: - Shows together (person sheet)

/// Your shows a friend was at too (`friends.js showsTogether`, mutual
/// friends only). Each opens your own show.
struct ShowsTogetherList: View {
    @Environment(FriendsStore.self) private var friends
    let friendUid: String
    let name: String
    @State private var shows: [ShowsTogetherResponse.TogetherShow]?
    @State private var problem: String?

    var body: some View {
        Group {
            if let shows {
                if shows.isEmpty {
                    ContentUnavailableView("No shows together yet", systemImage: "music.mic",
                                           description: Text("Shows you and \(name) have both logged appear here."))
                } else {
                    List(shows) { show in
                        NavigationLink {
                            ShowDetailScreen(id: show.id).brandScreen()
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(show.artist).font(.brand(.base, weight: .medium))
                                Text([show.venue, ShowDateText.display(show.date)].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.brand(.sm)).foregroundStyle(.secondary)
                            }
                        }
                        .listRowBackground(Color.surface)
                    }
                }
            } else if let problem {
                ContentUnavailableView {
                    Label("Couldn't load shows together", systemImage: "wifi.exclamationmark")
                } description: { Text(problem) } actions: {
                    Button("Try again") { Task { await load() } }
                }
            } else {
                ProgressView("Finding your shows together…")
            }
        }
        .brandScreen()
        .navigationTitle("With \(name)")
        .navigationBarTitleDisplayMode(.inline)
        .task { if shows == nil { await load() } }
    }

    private func load() async {
        problem = nil
        do { shows = try await friends.showsTogether(friendUid: friendUid) } catch {
            problem = FriendsMessages.failure(error, fallback: "Try again in a moment.")
        }
    }
}
