import Core
import DesignSystem
import SwiftUI

// The show extras on the Shows tab (Stage 6, 6-8): "Relive this night" and
// the Internet Archive backfill card, at the top of the past shows.

/// "Relive this night's magic" (ReliveThisNightCard.jsx): offered once a
/// day, until dismissed.
struct ReliveThisNightSection: View {
    let show: Show
    let today: String
    let dismiss: () -> Void

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: Space.x3) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Relive this night's magic", systemImage: "sparkles")
                            .font(.jakarta(size: 18, weight: .heavy, relativeTo: .headline))
                            .foregroundStyle(Color.textPrimary)
                            .labelStyle(TintedIconLabel())
                        let years = ReliveThisNight.yearsAgo(show, today: today)
                        Text(years == 1 ? "1 year ago tonight" : "\(years) years ago tonight")
                            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                            .foregroundStyle(Color.amber)
                    }
                    Spacer()
                    Button(action: dismiss) {
                        Image(systemName: "xmark").font(.footnote.weight(.semibold))
                            .frame(width: TouchTarget.minimum, height: TouchTarget.minimum)
                    }
                    .buttonStyle(.borderless)
                    .tint(.secondary)
                    .accessibilityLabel("Dismiss")
                }
                NavigationLink(value: AppRoute.show(id: show.id)) {
                    ShowRow(show: show, today: today)
                }
            }
            .padding(.vertical, Space.x1)
        }
        .listRowBackground(
            LinearGradient(colors: [Color.brand.opacity(0.16), Color.amber.opacity(0.10)], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
    }
}

/// "3 Grateful Dead shows with no setlist. The Internet Archive may have
/// them." Shows by the Archive's bands with an empty setlist: a shortlist
/// from the bundled config, each band confirmed once by `setlist-source`.
struct ArchiveBackfillSection: View {
    @Environment(ShowsStore.self) private var store
    /// From `ArchiveBackfillSection.find`, run by the list (a section with
    /// nothing in it isn't drawn, so it can't start its own work).
    let candidates: [Show]
    /// Looked up and not saved, this session and before.
    let checked: Set<String>
    /// Opens the review; the list presents it, so it outlives this card
    /// (which goes once every show is settled).
    let lookUp: ([Show]) -> Void

    var body: some View {
        let shown = candidates.filter { !checked.contains($0.id) && (store.show(id: $0.id)?.setlist.isEmpty ?? false) }
        if !shown.isEmpty {
            Section {
                HStack(alignment: .center, spacing: Space.x3) {
                    Image(systemName: "music.note.list").foregroundStyle(Color.brand)
                    Text(ArchiveBackfill.summary(shown))
                        .font(.brand(.sm))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button("Look them up") { lookUp(shown) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(.brand)
                }
            }
            .brandRow()
        }
    }

    struct ReviewList: Identifiable {
        let shows: [Show]
        var id: String { shows.map(\.id).joined(separator: ",") }
    }

    private static let bands = ArchiveBackfill.Bands.load()

    /// The shortlist, then one `setlist-source` answer per band (cached for the session).
    @MainActor
    static func find(in store: ShowsStore, uid: String) async -> [Show] {
        let shortlist = ArchiveBackfill.shortlist(store.shows, bands: bands, checked: ArchiveBackfill.checked(uid: uid))
        var confirmed: [String: Bool] = [:]
        var found: [Show] = []
        for show in shortlist {
            if confirmed[show.artist] == nil {
                confirmed[show.artist] = await store.setlistSource(for: show)?.source.requiresReview == true
            }
            if confirmed[show.artist] == true { found.append(show) }
        }
        return found
    }
}

/// The review (ArchiveSetlistReview.jsx): each show looked up in turn,
/// 600 ms apart; a setlist found is saved only when you say so, and only
/// while the show still has none. Your ratings and notes are kept.
struct ArchiveBackfillSheet: View {
    @Environment(ShowsStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let shows: [Show]
    /// A show looked up and not saved: remembered so it isn't offered again.
    let settled: (String) -> Void
    @State private var statuses: [String: ArchiveBackfill.Status] = [:]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("These setlists are read from the descriptions of fan recordings on the Internet Archive, so check each one before saving. Nothing changes until you save. Your ratings, notes and any songs you added are kept.")
                        .font(.brand(.sm)).foregroundStyle(.secondary)
                }
                .brandRow()
                ForEach(shows) { show in
                    Section {
                        ArchiveBackfillRow(show: show, status: statuses[show.id] ?? .queued,
                                           save: { Task { await save(show) } },
                                           skip: { finish(show.id, .skipped) })
                    }
                    .brandRow()
                }
            }
            .brandScreen()
            .navigationTitle("Setlists from the Internet Archive")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await lookUp() }
        }
    }

    private func lookUp() async {
        guard let ops = store.setlistOps else {
            for show in shows { statuses[show.id] = .error("you're offline") }
            return
        }
        for (i, show) in shows.enumerated() {
            if Task.isCancelled { return }
            statuses[show.id] = .loading
            let status: ArchiveBackfill.Status
            do throws(APIError) {
                status = .from(proposal: try await ops.propose(showId: show.id))
            } catch {
                status = .error(error.message ?? "")
            }
            statuses[show.id] = status
            if status.isSettledWithoutSaving { settled(show.id) }
            if i < shows.count - 1 { try? await Task.sleep(for: .milliseconds(600)) }
        }
    }

    private func save(_ show: Show) async {
        guard case .found(let answer) = statuses[show.id], let result = answer.result, let ops = store.setlistOps else { return }
        statuses[show.id] = .saving(answer)
        let status: ArchiveBackfill.Status
        do throws(APIError) {
            status = .from(save: try await ops.accept(showId: show.id, result: result, onlyIfEmpty: true))
        } catch {
            status = .error(error.message ?? "")
        }
        if case .saved = status { store.noteSetlistChangedOnServer() }
        finish(show.id, status)
    }

    private func finish(_ showId: String, _ status: ArchiveBackfill.Status) {
        statuses[showId] = status
        if status.isSettledWithoutSaving { settled(showId) }
    }
}

private struct ArchiveBackfillRow: View {
    let show: Show
    let status: ArchiveBackfill.Status
    let save: () -> Void
    let skip: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Text(show.artist).font(.brand(.base, weight: .semibold))
            Text([ShowDateText.display(show.date), show.venue].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            switch status {
            case .found(let answer), .saving(let answer):
                let saving = if case .saving = status { true } else { false }
                ForEach(SetGroups.group(answer.proposedSongs)) { group in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.label.uppercased())
                            .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
                            .tracking(0.8)
                            .foregroundStyle(Color.brandLight)
                        Text(group.songs.map(\.name).joined(separator: ", "))
                            .font(.brand(.sm))
                    }
                }
                ForEach(answer.reviewWarnings, id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(Color.amber)
                }
                if let link = answer.result?["sourcePermalink"]?.stringValue, let url = URL(string: link) {
                    Link("From \(answer.result?["sourceShowId"]?.stringValue ?? "the Internet Archive")", destination: url)
                        .font(.caption)
                }
                HStack(spacing: Space.x3) {
                    Button(action: save) {
                        if saving { ProgressView() } else { Text("Save setlist") }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.brand)
                    Button("Skip", action: skip)
                        .buttonStyle(.bordered)
                }
                .disabled(saving)
            case .loading:
                HStack(spacing: Space.x2) {
                    ProgressView()
                    Text(status.message).font(.caption).foregroundStyle(.secondary)
                }
            case .saved:
                Label(status.message, systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(Color.brand)
            default:
                Text(status.message).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, Space.x1)
    }
}

/// Upcoming anniversaries (AnniversaryCalendar.jsx), in the inbox: shows
/// whose anniversary is coming up, soonest first.
struct AnniversaryCalendarSection: View {
    @Environment(ShowsStore.self) private var shows
    var limit = 8

    var body: some View {
        let upcoming = Array(Anniversaries.upcoming(shows.shows).prefix(limit))
        Section {
            if upcoming.isEmpty {
                Text("Once your shows are more than a year old, they'll show up here as their anniversary approaches.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
            }
            ForEach(upcoming) { entry in
                NavigationLink(value: AppRoute.show(id: entry.show.id)) {
                    HStack(spacing: Space.x3) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.show.artist).font(.brand(.sm, weight: .semibold)).lineLimit(1)
                            Text([entry.show.venue, entry.show.city].filter { !$0.isEmpty }.joined(separator: ", "))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: Space.x2)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(ShowDateText.display(entry.occurrence)).font(.brand(.sm, weight: .semibold)).foregroundStyle(Color.brand)
                            Text(entry.yearsAgo == 1 ? "1 year" : "\(entry.yearsAgo) years").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } header: {
            Label("Upcoming anniversaries", systemImage: "party.popper")
        }
        .brandRow()
    }
}
