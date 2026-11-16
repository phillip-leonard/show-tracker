import Core
import DesignSystem
import SwiftUI

/// Someone's card (the web's `UserProfileSheet`): name, handle, whether
/// you're friends, and the controls that live on a person: request,
/// remove, block, report. Block is here even with nothing to report
/// (Guideline 1.2).
struct PersonSheet: View {
    @Environment(FriendsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let person: PersonRef
    @State private var profile: UserProfile?
    @State private var confirmRemove = false
    @State private var confirmBlock = false
    @State private var reporting = false
    @State private var notice: String?

    private var name: String { profile?.displayName ?? person.name }
    private var handle: String? { profile?.handle ?? person.handle }
    private var isFriend: Bool { store.isFriend(person.uid) }
    private var isBlocked: Bool { store.isBlocked(person.uid) }
    private var busy: Bool { store.busy.contains(person.uid) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: Space.x2) {
                        PersonAvatar(name: name, photoURL: profile?.photoURL, size: 72)
                        Text(name).font(.brand(.lg, weight: .semibold))
                        if let handle { Text("@\(handle)").font(.brand(.sm)).foregroundStyle(.secondary) }
                        if isBlocked {
                            Text("Blocked").font(.caption.weight(.semibold)).foregroundStyle(Color.danger)
                        } else if isFriend {
                            Text("Friend").font(.caption.weight(.semibold)).foregroundStyle(Color.brand)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Space.x2)
                    .accessibilityElement(children: .combine)

                    if isFriend {
                        NavigationLink {
                            ShowsTogetherList(friendUid: person.uid, name: name)
                        } label: {
                            LabeledContent("Shows together", value: store.togetherCounts[person.uid].map(String.init) ?? "")
                        }
                    }
                    if !isBlocked, profile?.publicProfile == true, let handle,
                       let url = ProfileSettings.publicProfileURL(handle: handle) {
                        Link(destination: url) { Label("View public profile", systemImage: "globe") }
                    }
                }
                .brandRow()

                if !isBlocked {
                    Section {
                        if isFriend {
                            Button("Remove friend", role: .destructive) { confirmRemove = true }
                                .disabled(busy)
                        } else if store.hasSentRequest(to: person.uid) {
                            Label("Request sent", systemImage: "paperplane").foregroundStyle(.secondary)
                        } else if let request = store.incoming.first(where: { $0.from == person.uid }) {
                            Button("Accept friend request") { run { await store.accept(request) } }
                                .disabled(store.busy.contains(request.id))
                        } else {
                            Button("Send friend request") { run { await store.sendRequest(to: person.uid, name: name) } }
                                .disabled(busy)
                        }
                    }
                    .brandRow()
                }

                Section {
                    if isBlocked {
                        Button("Unblock \(name)") { run { await store.unblock(uid: person.uid, name: name) } }
                            .disabled(busy)
                    } else {
                        Button("Block \(name)", role: .destructive) { confirmBlock = true }
                            .disabled(busy)
                    }
                    Button("Report \(name)") { reporting = true }
                } footer: {
                    Text(isBlocked
                         ? "You don't see each other's activity, and you can't be friends while they're blocked."
                         : "Reports are reviewed within 24 hours.")
                }
                .brandRow()
            }
            .brandScreen()
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                if busy { ToolbarItem(placement: .topBarLeading) { ProgressView() } }
            }
            .confirmationDialog("Remove \(name) from your friends?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { run { await store.remove(friendUid: person.uid, name: name) } }
            } message: {
                Text("You'll stop seeing each other's shows. You can send a new request later.")
            }
            .confirmationDialog(BlockCopy.title(name), isPresented: $confirmBlock, titleVisibility: .visible) {
                Button("Block", role: .destructive) { run { await store.block(uid: person.uid, name: name) } }
            } message: {
                Text(BlockCopy.message)
            }
            .sheet(isPresented: $reporting) {
                ReportProfileSheet(person: PersonRef(uid: person.uid, name: name, handle: handle), alreadyBlocked: isBlocked) { message in
                    notice = message
                }
            }
            .notice($notice)
            .task { profile = await store.profile(uid: person.uid) }
        }
    }

    private func run(_ action: @escaping () async -> String) {
        Task { notice = await action() }
    }
}

/// A profile report (`report-content`, type `profile`): a reason, details
/// when it's "Something else", and the option to block too, as the web's
/// `ReportModal`.
struct ReportProfileSheet: View {
    @Environment(FriendsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let person: PersonRef
    let alreadyBlocked: Bool
    let onReported: (String) -> Void
    @State private var reason: ReportReason?
    @State private var details = ""
    @State private var alsoBlock = false
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
                        .font(.brand(.sm))
                        .foregroundStyle(.secondary)
                }
                .brandRow()

                Section("What's wrong with it?") {
                    Picker("Reason", selection: $reason) {
                        ForEach(ReportReason.allCases) { r in
                            Text(r.label).tag(Optional(r))
                        }
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

                if !alreadyBlocked {
                    Section {
                        Toggle("Also block \(person.name)", isOn: $alsoBlock)
                            .tint(.brand)
                    } footer: {
                        Text("You won't see their activity, and you'll be removed from each other's friends. You can undo this in Me → Blocked accounts.")
                    }
                    .brandRow()
                }
            }
            .brandScreen()
            .disabled(sending)
            .navigationTitle("Report \(person.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: { if sending { ProgressView() } else { Text("Send") } }
                        .disabled(!canSend)
                }
            }
            .interactiveDismissDisabled(sending)
        }
    }

    private func send() async {
        guard let reason, canSend else { return }
        sending = true
        problem = nil
        defer { sending = false }
        do {
            let blocked = try await store.report(uid: person.uid, reason: reason, details: details, alsoBlock: alsoBlock)
            let thanks = "Thanks. We'll review your report within 24 hours."
            if blocked {
                onReported("\(thanks) \(person.name) is blocked.")
            } else if alsoBlock {
                onReported("\(thanks) \(person.name) couldn't be blocked just now. Try Block again.")
            } else {
                onReported(thanks)
            }
            dismiss()
        } catch {
            problem = FriendsMessages.failure(error, fallback: "Couldn't send that report. Try again.")
        }
    }
}
