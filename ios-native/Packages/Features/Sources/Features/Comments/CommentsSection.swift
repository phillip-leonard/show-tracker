import Core
import DesignSystem
import SwiftUI

// Comments on the show page (Stage 6, 6-3; the web's CommentsSection):
// everyone who logged the night shares one thread. Post, reply, like,
// delete your own, report anyone else's; comments from people you blocked
// never show. Guests see a prompt instead (D-1).

struct CommentsSection: View {
    @Environment(SessionStore.self) private var session
    let show: Show
    @State private var upgrading = false

    var body: some View {
        if let user = session.user, !user.isAnonymous {
            CommentsThreadView(show: show, uid: user.uid, api: session.api)
                .id(ConcertKeys.concertKey(show))
        } else {
            VStack(alignment: .leading, spacing: Space.x3) {
                CommentsTitle(count: nil)
                Text("Comments from everyone at this show are for accounts.")
                    .font(.brand(.sm))
                    .foregroundStyle(.secondary)
                Button("Create an account to see comments") { upgrading = true }
                    .buttonStyle(.bordered)
                    .tint(.brand)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .brandCard(radius: Radius.xl2)
            .sheet(isPresented: $upgrading) { GuestUpgradeView() }
        }
    }
}

private struct CommentsTitle: View {
    let count: Int?
    var body: some View {
        HStack(spacing: Space.x2) {
            Label("Comments", systemImage: "bubble.left.and.bubble.right")
                .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
                .labelStyle(TintedIconLabel())
            Spacer()
            if let count, count > 0 {
                Text("\(count)")
                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(Color.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct CommentsThreadView: View {
    @Environment(FriendsStore.self) private var friends
    let show: Show
    @State private var store: CommentsStore
    @State private var replyingTo: String?
    @State private var reporting: ShowComment?
    @State private var person: PersonRef?
    @State private var deleting: ShowComment?
    /// What the last action said; `error` shows it in the warning colour.
    @State private var notice: (text: String, error: Bool)?

    init(show: Show, uid: String, api: APIClient?) {
        self.show = show
        _store = State(initialValue: CommentsStore(concertKey: ConcertKeys.concertKey(show), uid: uid, api: api))
    }

    var body: some View {
        let thread = store.thread(hiding: Set(friends.blockedUids))
        VStack(alignment: .leading, spacing: Space.x3) {
            CommentsTitle(count: thread.count)
            CommentComposer(placeholder: "Share a memory from this show", friendNames: friendNames) { (text: String) throws(APIError) in
                try await store.post(text, show: show)
            }

            switch store.state {
            case .loading where thread.entries.isEmpty:
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, Space.x3)
            case .offline:
                Text("Comments will show when you're back online.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
            case .failed(let message) where thread.entries.isEmpty:
                Text(message).font(.brand(.sm)).foregroundStyle(.secondary)
            default:
                if thread.entries.isEmpty {
                    Text("No comments yet. Be the first to share a memory from this show.")
                        .font(.brand(.sm)).foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: Space.x4) {
                        ForEach(thread.entries) { entry in entryView(entry) }
                    }
                }
            }

            if let notice {
                Text(notice.text).font(.brand(.sm)).foregroundStyle(notice.error ? Color.amber : Color.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .sheet(item: $reporting) { comment in
            ReportContentSheet(title: "Report comment") { reason, details throws(APIError) in
                try await store.report(comment, reason: reason, details: details)
            } onSent: { notice = ($0, false) }
        }
        .sheet(item: $person) { PersonSheet(person: $0) }
        .confirmationDialog("Delete this comment?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { comment in
            Button("Delete", role: .destructive) { Task { notice = await store.delete(comment).map { ($0, true) } } }
        } message: { _ in
            Text("Replies to it will no longer show.")
        }
    }

    private var friendNames: [String] { friends.friends.compactMap(\.friendName) }

    @ViewBuilder private func entryView(_ entry: CommentThread.Entry) -> some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            row(entry.comment, isReply: false)
            if !entry.replies.isEmpty || replyingTo == entry.id {
                VStack(alignment: .leading, spacing: Space.x3) {
                    ForEach(entry.replies) { reply in row(reply, isReply: true) }
                    if replyingTo == entry.id {
                        CommentComposer(placeholder: "Reply to \(entry.comment.authorName)", friendNames: friendNames,
                                        focusOnAppear: true) { (text: String) throws(APIError) in
                            try await store.post(text, parentId: entry.id, show: show)
                            replyingTo = nil
                        }
                    }
                }
                .padding(.leading, Space.x5)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Color.borderSubtle).frame(width: 2).padding(.leading, Space.x1)
                }
            }
        }
    }

    private func row(_ comment: ShowComment, isReply: Bool) -> some View {
        CommentRow(
            comment: comment,
            mine: comment.authorUid == store.uid,
            // The thread's copy already shows a like in flight.
            liked: comment.isLiked(by: store.uid),
            isNew: store.isNew(comment),
            busy: store.busy.contains(comment.id),
            canReply: !isReply,
            onLike: { Task { notice = await store.toggleLike(comment, show: show).map { ($0, true) } } },
            onReply: { replyingTo = replyingTo == comment.id ? nil : comment.id },
            onDelete: { deleting = comment },
            onReport: { reporting = comment },
            onPerson: { person = PersonRef(uid: comment.authorUid, name: comment.authorName) }
        )
    }
}

private struct CommentRow: View {
    let comment: ShowComment
    let mine: Bool
    let liked: Bool
    let isNew: Bool
    let busy: Bool
    let canReply: Bool
    let onLike: () -> Void
    let onReply: () -> Void
    let onDelete: () -> Void
    let onReport: () -> Void
    let onPerson: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Space.x3) {
            PersonAvatar(name: comment.authorName, size: 32)
            VStack(alignment: .leading, spacing: Space.x1) {
                HStack(spacing: Space.x2) {
                    if mine {
                        Text(comment.authorName).font(.brand(.sm, weight: .semibold))
                    } else {
                        Button(comment.authorName, action: onPerson)
                            .font(.brand(.sm, weight: .semibold))
                            .tint(Color.textPrimary)
                    }
                    if let at = comment.createdAt {
                        Text(at, format: .relative(presentation: .named))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if isNew {
                        Text("New").font(.caption2.weight(.bold)).foregroundStyle(Color.brand)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.brand.opacity(0.12), in: Capsule())
                    }
                    Spacer(minLength: 0)
                    Menu {
                        if mine {
                            Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
                        } else {
                            Button("Report comment", systemImage: "flag", action: onReport)
                            Button("\(comment.authorName)'s profile", systemImage: "person", action: onPerson)
                        }
                    } label: {
                        Image(systemName: "ellipsis").frame(width: 32, height: 24).contentShape(Rectangle())
                    }
                    .tint(.secondary)
                    .accessibilityLabel("More for \(comment.authorName)'s comment")
                }
                Text(comment.text)
                    .font(.brand(.base))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: Space.x4) {
                    Button(action: onLike) {
                        Label(likeCount > 0 ? "\(likeCount)" : "Like", systemImage: liked ? "heart.fill" : "heart")
                    }
                    .tint(liked ? Color.danger : .secondary)
                    .disabled(busy || mine)
                    .accessibilityLabel(liked ? "Unlike" : "Like")
                    .accessibilityValue(likeCount == 1 ? "1 like" : "\(likeCount) likes")
                    if canReply {
                        Button("Reply", systemImage: "arrowshape.turn.up.left", action: onReply).tint(.secondary)
                    }
                }
                .font(.caption.weight(.semibold))
                .labelStyle(.titleAndIcon)
                .buttonStyle(.borderless)
            }
        }
    }

    private var likeCount: Int { comment.likeCount }
}

/// The text box and Post button, with friend suggestions for "@".
private struct CommentComposer: View {
    let placeholder: String
    let friendNames: [String]
    var focusOnAppear = false
    let send: (String) async throws(APIError) -> Void
    @State private var text = ""
    @State private var sending = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    private var suggestions: [String] {
        guard let q = CommentMentions.query(in: text) else { return [] }
        return CommentMentions.matches(q, names: friendNames)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            HStack(alignment: .bottom, spacing: Space.x2) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, Space.x3)
                    .padding(.vertical, Space.x2)
                    .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
                    .onChange(of: text) {
                        if text.count > CommentMessages.maxLength { text = String(text.prefix(CommentMessages.maxLength)) }
                        problem = nil
                    }
                Button {
                    Task { await post() }
                } label: {
                    if sending { ProgressView() } else { Text("Post") }
                }
                .buttonStyle(.borderedProminent)
                .tint(.brand)
                .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if !suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Space.x2) {
                        ForEach(suggestions, id: \.self) { name in
                            Button("@\(name)") { text = CommentMentions.complete(text, with: name) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .tint(.brand)
                        }
                    }
                }
            }
            if let problem {
                Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber)
            }
        }
        .onAppear { if focusOnAppear { focused = true } }
    }

    private func post() async {
        sending = true
        defer { sending = false }
        do {
            try await send(text)
            text = ""
            focused = false
        } catch {
            problem = CommentMessages.failure(error, fallback: "Couldn't post that. Try again.")
        }
    }
}

/// A report of a comment, photo or message (Guideline 1.2): a reason, and
/// details when it's "something else". Reviewed within 24 hours.
struct ReportContentSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let send: (ReportReason, String) async throws(APIError) -> Void
    let onSent: (String) -> Void
    @State private var reason: ReportReason?
    @State private var details = ""
    @State private var sending = false
    @State private var problem: String?

    private var canSend: Bool {
        guard let reason, !sending else { return false }
        return !reason.requiresDetails || !details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Reports are reviewed within 24 hours. Anything that breaks the Community Guidelines is removed, and repeat offenders lose their account.")
                        .font(.brand(.sm)).foregroundStyle(.secondary)
                }
                .brandRow()
                Section("What's wrong with it?") {
                    Picker("Reason", selection: $reason) {
                        ForEach(ReportReason.allCases) { Text($0.label).tag(Optional($0)) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                .brandRow()
                Section {
                    TextField(reason?.requiresDetails == true ? "Tell us what's wrong." : "Optional", text: $details, axis: .vertical)
                        .lineLimit(3...6)
                        .onChange(of: details) { if details.count > ReportReason.maxDetails { details = String(details.prefix(ReportReason.maxDetails)) } }
                } header: {
                    Text(reason?.requiresDetails == true ? "What happened?" : "Anything else we should know?")
                } footer: {
                    if let problem { Text(problem).foregroundStyle(Color.amber) }
                }
                .brandRow()
            }
            .brandScreen()
            .disabled(sending)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await submit() } } label: { if sending { ProgressView() } else { Text("Send") } }
                        .disabled(!canSend)
                }
            }
            .interactiveDismissDisabled(sending)
        }
    }

    private func submit() async {
        guard let reason, canSend else { return }
        sending = true
        problem = nil
        defer { sending = false }
        do {
            try await send(reason, details)
            onSent("Thanks. We'll review your report within 24 hours, and it's hidden for you now.")
            dismiss()
        } catch {
            problem = CommentMessages.failure(error, fallback: "Couldn't send that report. Try again.")
        }
    }
}
