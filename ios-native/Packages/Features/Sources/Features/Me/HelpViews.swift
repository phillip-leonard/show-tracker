import Core
import DesignSystem
import SwiftUI

// Help (Stage 6, 6-11): How to Use (F-7) and What's New (F-5) from the
// native JSON, Send feedback (the web's FeedbackView, email-free) and the
// roadmap with its votes (RoadmapView).

// MARK: - How to Use

struct HowToUseScreen: View {
    @State private var content: HowToUse?
    @State private var failed = false

    var body: some View {
        Group {
            if let content {
                List {
                    ForEach(content.sections) { section in
                        Section {
                            ForEach(section.topics) { topic in
                                DisclosureGroup {
                                    Text(topic.body)
                                        .font(.brand(.sm))
                                        .foregroundStyle(Color.textSecondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.vertical, Space.x1)
                                } label: {
                                    Text(topic.title).font(.brand(.base, weight: .medium))
                                }
                            }
                        } header: {
                            Label(section.title, systemImage: section.symbol ?? "questionmark.circle")
                        }
                        .brandRow()
                    }
                }
            } else if failed {
                ContentUnavailableView("Couldn't load the guide", systemImage: "book",
                                       description: Text("Check your connection and try again."))
            } else {
                ProgressView("Loading the guide")
            }
        }
        .navigationTitle("How to use MySetlists")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard content == nil else { return }
            content = await NativeContent.load("how-to-use", as: HowToUse.self)
            failed = content == nil
        }
    }
}

// MARK: - What's New

/// Every release in the file, newest first (Me → What's new).
struct WhatsNewScreen: View {
    @State private var content: WhatsNew?

    var body: some View {
        List {
            if let content {
                ForEach(content.releases) { release in
                    Section {
                        ReleaseItems(release: release)
                    } header: {
                        Text("\(release.title) · \(release.version)")
                    }
                    .brandRow()
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("What's new")
        .navigationBarTitleDisplayMode(.inline)
        .task { if content == nil { content = await NativeContent.load("whats-new", as: WhatsNew.self) } }
    }
}

private struct ReleaseItems: View {
    let release: WhatsNew.Release
    var body: some View {
        ForEach(release.items, id: \.self) { item in
            Label {
                Text(item).font(.brand(.sm)).foregroundStyle(Color.textPrimary)
            } icon: {
                Image(systemName: "sparkle").foregroundStyle(Color.brand)
            }
        }
    }
}

/// Opens What's New once after an update (`WhatsNewGate`), and an
/// announcement once, on the app's root.
struct WhatsNewPresenter: ViewModifier {
    @Environment(SessionStore.self) private var session
    @State private var release: WhatsNew.Release?
    @State private var announcement: WhatsNew.Announcement?
    @AppStorage(WhatsNewGate.seenKey) private var seenVersion: String = ""
    @AppStorage(WhatsNewGate.announcementKey) private var seenAnnouncement: String = ""

    func body(content: Content) -> some View {
        content
            .task(id: session.user?.uid) {
                guard session.user != nil else { return }
                let current = AppInfo.current.version
                let lastSeen = seenVersion.isEmpty ? nil : seenVersion
                guard let file = await NativeContent.load("whats-new", as: WhatsNew.self) else {
                    if lastSeen == nil { seenVersion = current }
                    return
                }
                if let r = WhatsNewGate.release(for: current, lastSeen: lastSeen, in: file) {
                    release = r
                } else if let a = WhatsNewGate.announcement(in: file, seen: seenAnnouncement.isEmpty ? nil : seenAnnouncement) {
                    announcement = a
                }
                // Recorded at once: never shown twice, and a first install
                // starts from here.
                if lastSeen == nil || WhatsNewGate.compare(current, lastSeen ?? "0") == .orderedDescending { seenVersion = current }
            }
            .sheet(item: $release) { release in
                NavigationStack {
                    List {
                        Section { ReleaseItems(release: release) }.brandRow()
                    }
                    .navigationTitle(release.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { self.release = nil } } }
                    .brandScreen()
                }
                .presentationDetents([.medium, .large])
            }
            .alert(announcement?.title ?? "", isPresented: Binding(get: { announcement != nil }, set: { if !$0 { dismissAnnouncement() } })) {
                if let link = announcement?.link {
                    Link("Open", destination: link)
                }
                Button("OK", role: .cancel) { dismissAnnouncement() }
            } message: {
                Text(announcement?.body ?? "")
            }
    }

    private func dismissAnnouncement() {
        if let id = announcement?.id { seenAnnouncement = id }
        announcement = nil
    }
}

// MARK: - Send feedback

struct FeedbackScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var draft = FeedbackDraft()
    @State private var sending = false
    @State private var sent = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    private var isAccount: Bool { session.user?.isAnonymous == false }

    var body: some View {
        Form {
            if sent {
                Section {
                    Label("Thanks! We read every message.", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Color.brand)
                    if isAccount {
                        Text("If it's an idea, it may appear on the roadmap once it's reviewed. You'll get a notification when it does.")
                            .font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                    Button("Send more feedback") { draft = FeedbackDraft(); sent = false }
                    NavigationLink("See the roadmap", value: AppRoute.roadmap)
                }
                .brandRow()
            } else {
                Section("What kind?") {
                    Picker("Kind", selection: $draft.kind) {
                        ForEach(FeedbackKind.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    if draft.kind == .feature {
                        Picker("Area", selection: $draft.category) {
                            ForEach(RoadmapCategory.allCases) { Text($0.label).tag($0) }
                        }
                    }
                }
                .brandRow()

                Section {
                    TextField(placeholder, text: $draft.message, axis: .vertical)
                        .lineLimit(5...12)
                        .focused($focused)
                } header: {
                    Text("Your message")
                } footer: {
                    Text(isAccount
                         ? "Your message and first name go to the MySetlists team. No email address is attached."
                         : "Your message goes to the MySetlists team. Ideas go on the roadmap only from accounts.")
                }
                .brandRow()

                Section {
                    Button {
                        Task { await send() }
                    } label: {
                        if sending { ProgressView() } else { Text("Send feedback").frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent).tint(.brand)
                    .disabled(!draft.canSend || sending)
                    if let problem { Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber) }
                }
                .listRowBackground(Color.clear)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .sensoryFeedback(.success, trigger: sent) { _, now in now }
        .navigationTitle("Send feedback")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The keyboard covers the button below on a phone, and Return
            // adds a line, so Send is also up here.
            if !sent {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { Task { await send() } }
                        .disabled(!draft.canSend || sending)
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = false }
            }
        }
    }

    private var placeholder: String {
        switch draft.kind {
        case .feature: "What would you like MySetlists to do?"
        case .bug: "What happened, and what did you expect?"
        case .general: "Tell us anything"
        }
    }

    private func send() async {
        guard let user = session.user, draft.canSend else { return }
        sending = true
        problem = nil
        defer { sending = false }
        do {
            try await FeedbackSender.send(draft, uid: user.uid, displayName: session.profile?.displayName ?? user.displayName,
                                          isAccount: isAccount)
            focused = false
            sent = true
        } catch {
            problem = "Couldn't send it. Check your connection and try again."
        }
    }
}

// MARK: - Roadmap

struct RoadmapScreen: View {
    @Environment(SessionStore.self) private var session
    @State private var store = RoadmapStore()
    @State private var upgrading = false

    private var isAccount: Bool { session.user?.isAnonymous == false }

    var body: some View {
        List {
            if !isAccount {
                Section {
                    Button("Create an account to vote") { upgrading = true }
                } footer: {
                    Text("Anyone can read the roadmap. Voting needs an account.")
                }
                .brandRow()
            }
            if let problem = store.problem {
                Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber).brandRow()
            }
            let top = RoadmapBoard.mostRequested(store.items)
            ForEach(RoadmapColumn.allCases) { column in
                let items = RoadmapBoard.column(column, in: store.items)
                Section {
                    if items.isEmpty {
                        Text("Nothing here yet").font(.brand(.sm)).foregroundStyle(.secondary)
                    }
                    ForEach(items) { item in
                        RoadmapRow(item: item, mostRequested: top.contains(item.id), voted: store.voted.contains(item.id),
                                   voting: store.voting == item.id, canVote: isAccount) {
                            Task { await store.toggleVote(item) }
                        }
                    }
                } header: {
                    HStack {
                        Text(column.label)
                        Spacer()
                        Text("\(items.count)")
                    }
                }
                .brandRow()
            }
        }
        .overlay { if !store.loaded { ProgressView("Loading the roadmap") } }
        .navigationTitle("Roadmap")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: AppRoute.feedback) { Label("Send feedback", systemImage: "square.and.pencil") }
            }
        }
        .task(id: session.user?.uid) { store.start(uid: isAccount ? session.user?.uid : nil) }
        .onDisappear { store.stop() }
        .sheet(isPresented: $upgrading) { GuestUpgradeView() }
    }
}

private struct RoadmapRow: View {
    let item: RoadmapItem
    let mostRequested: Bool
    let voted: Bool
    let voting: Bool
    let canVote: Bool
    let vote: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Space.x3) {
            VStack(alignment: .leading, spacing: Space.x1) {
                if mostRequested {
                    Text("MOST REQUESTED")
                        .font(.jakarta(size: 10, weight: .bold, relativeTo: .caption2))
                        .foregroundStyle(Color.brand)
                }
                Text(item.title).font(.brand(.base, weight: .semibold)).foregroundStyle(Color.textPrimary)
                if let detail = item.detail {
                    Text(detail).font(.brand(.sm)).foregroundStyle(Color.textSecondary).lineLimit(3)
                }
                HStack(spacing: Space.x2) {
                    if let category = item.category { Text(category.label) }
                    if let date = item.date {
                        Text("\(item.status == .shipped ? "Shipped" : "Added") \(date.formatted(.relative(presentation: .named)))")
                    }
                }
                .font(.caption).foregroundStyle(Color.textMuted)
            }
            Spacer(minLength: Space.x2)
            Button(action: vote) {
                VStack(spacing: 2) {
                    if voting { ProgressView() } else { Image(systemName: voted ? "chevron.up.circle.fill" : "chevron.up") }
                    Text("\(item.voteCount)").font(.brand(.sm, weight: .semibold)).monospacedDigit()
                }
                .frame(minWidth: TouchTarget.minimum, minHeight: TouchTarget.minimum)
                .foregroundStyle(voted ? Color.brand : Color.textSecondary)
                .background(voted ? Color.brand.opacity(0.15) : Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
            }
            .buttonStyle(.plain)
            .disabled(!canVote || voting)
            .accessibilityLabel(voted ? "Remove your vote, \(item.voteCount) votes" : "Vote for this, \(item.voteCount) votes")
            .sensoryFeedback(.selection, trigger: voted)
        }
        .padding(.vertical, Space.x1)
    }
}
