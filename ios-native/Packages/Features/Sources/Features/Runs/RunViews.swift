import Core
import DesignSystem
import SwiftUI

// Runs (Stage 4, 4-6): two or more nights of one band at one venue, from
// the shows on this phone (`ShowsStore.runs`, the Swift copy of
// lib/runIndex.js). Guests too: it's their own data.

/// Library → Runs, and `/stats/runs`.
struct RunListView: View {
    @Environment(ShowsStore.self) private var store

    var body: some View {
        let runs = store.runs
        List {
            Section {
                ForEach(runs) { run in
                    NavigationLink(value: AppRoute.run(key: run.key)) { RunRow(run: run) }
                }
            } footer: {
                if !runs.isEmpty { Text("Two or more nights in a row at one venue.") }
            }
            .brandRow()
        }
        .overlay {
            if !store.showsLoaded {
                ProgressView("Loading your runs")
            } else if runs.isEmpty {
                ContentUnavailableView("No runs yet", systemImage: "calendar.day.timeline.left",
                                       description: Text("Log two or more nights in a row at the same venue by the same band and they show up here as a run."))
            }
        }
        .navigationTitle("Runs")
    }
}

private struct RunRow: View {
    let run: RunIndex.Run

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: Space.x2) {
                Text("\(run.artistName) · \(run.nightCount) nights")
                    .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                    .foregroundStyle(Color.textPrimary)
                if run.noRepeat == true { NoRepeatsBadge() }
            }
            Text("\(run.venueName) · \(RunText.range(run.start, run.end))")
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
                .lineLimit(1)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Where `/runs/?run=` leads.
struct RunScreen: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let key: String

    var body: some View {
        Group {
            if let run = store.runs.first(where: { $0.key == key }) {
                RunPage(run: run)
            } else if !store.showsLoaded {
                ProgressView("Loading the run")
            } else {
                ContentUnavailableView {
                    Label("Run not found", systemImage: "calendar.day.timeline.left")
                } description: {
                    Text("None of your shows make up this run.")
                } actions: {
                    Button("Open on mysetlists.net") { router.show(AppRoute.run(key: key).webURL) }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One run (`RunDetailView`): nights, songs and rating, whether it repeated,
/// night by night, the best night, and the combined setlist.
struct RunPage: View {
    let run: RunIndex.Run

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) {
                VStack(alignment: .leading, spacing: Space.x1) {
                    Text(RunText.range(run.start, run.end))
                        .font(.jakarta(size: 24, weight: .bold, relativeTo: .title2))
                        .foregroundStyle(Color.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    NavigationLink(value: AppRoute.band(slug: run.artistSlug)) {
                        Text(run.artistName)
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.brandLight)
                    }
                    .buttonStyle(.plain)
                    Text("\(run.nightCount) night\(run.nightCount == 1 ? "" : "s") at \(run.venueName)")
                        .font(.jakarta(size: 14, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                }
                StatCards(cards: [
                    ("\(run.nightCount)", "Nights", nil),
                    ("\(run.uniqueSongs)", "Unique songs", nil),
                    ("\(run.totalSongs)", "Total songs", nil),
                    (run.avgRating.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "–", "Avg rating", nil),
                ])
                RepeatsCard(run: run)
                nights
                combined
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("\(run.artistName) run")
        .toolbar { ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) } }
    }

    private var nights: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            SectionTitle("Night by night")
            ForEach(Array(run.nights.enumerated()), id: \.element.id) { i, night in
                VStack(alignment: .leading, spacing: Space.x2) {
                    NavigationLink(value: AppRoute.show(id: night.showId)) {
                        HStack(spacing: Space.x2) {
                            Text("Night \(i + 1) · \(ShowDateText.display(night.date))")
                                .font(.jakarta(size: 15, weight: .bold, relativeTo: .body))
                                .foregroundStyle(Color.textPrimary)
                            if i == run.bestNightIndex { Pill(text: "Best night", tint: .amber) }
                            Spacer(minLength: Space.x2)
                            if let rating = night.rating, rating > 0 {
                                Text("★ \(rating)/10")
                                    .font(.jakarta(size: 13, weight: .bold, relativeTo: .footnote))
                                    .monospacedDigit()
                                    .foregroundStyle(Color.amber)
                            }
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.textMuted)
                        }
                        .frame(minHeight: TouchTarget.minimum)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if night.hasSetlist {
                        NightSetlist(setlist: night.setlist, artistSlug: run.artistSlug)
                    } else {
                        Text("Setlist not logged for this night.")
                            .font(.jakarta(size: 13, relativeTo: .footnote))
                            .foregroundStyle(Color.textMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
            }
        }
    }

    private var combined: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            SectionTitle("Combined setlist")
            VStack(spacing: 0) {
                ForEach(Array(run.combinedSetlist.enumerated()), id: \.element.id) { i, song in
                    NavigationLink(value: AppRoute.song(artist: run.artistSlug, song: SongIndex.songSlug(song.title))) {
                        HStack(spacing: Space.x3) {
                            Text(song.title)
                                .font(.jakarta(size: 15, weight: .medium, relativeTo: .body))
                                .foregroundStyle(Color.textPrimary)
                            Spacer(minLength: Space.x2)
                            Text(RunText.nights(song.nightNumbers))
                                .font(.jakarta(size: 12, relativeTo: .caption))
                                .foregroundStyle(Color.textMuted)
                        }
                        .frame(minHeight: TouchTarget.minimum)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if i < run.combinedSetlist.count - 1 { Divider().overlay(Color.borderSubtle) }
                }
            }
            .padding(.horizontal, Space.x3)
            .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        }
    }
}

/// Whether the run repeated anything: the heart of the page.
private struct RepeatsCard: View {
    let run: RunIndex.Run

    var body: some View {
        Group {
            if run.hasIncompleteData {
                Label("At least one night's setlist hasn't been logged yet, so whether this run repeated any songs can't be known.",
                      systemImage: "exclamationmark.triangle")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            } else if run.noRepeat == true {
                VStack(alignment: .leading, spacing: 2) {
                    Label("No repeats across \(run.nightCount) nights!", systemImage: "party.popper")
                        .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                        .foregroundStyle(Color.amber)
                    Text("Every one of the \(run.uniqueSongs) songs played was played once.")
                        .font(.jakarta(size: 14, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                }
            } else {
                VStack(alignment: .leading, spacing: Space.x1) {
                    Text("\(run.repeats.count) song\(run.repeats.count == 1 ? "" : "s") repeated (\(run.uniqueSongs) unique of \(run.totalSongs) total)")
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                        .foregroundStyle(Color.textPrimary)
                    ForEach(run.repeats) { song in
                        (Text(song.title).foregroundStyle(Color.textPrimary).fontWeight(.medium)
                         + Text(": \(RunText.nights(song.nightNumbers))").foregroundStyle(Color.textSecondary))
                            .font(.jakarta(size: 14, relativeTo: .subheadline))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.x4)
        .background(run.noRepeat == true ? Color.amber.opacity(0.08) : Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        .overlay(RoundedRectangle.brand(Radius.xl2).stroke(run.noRepeat == true ? Color.amber.opacity(0.4) : .clear))
    }
}

/// One night's setlist by set; each song opens your history with it.
private struct NightSetlist: View {
    let setlist: [Song]
    let artistSlug: String

    var body: some View {
        let groups = SetGroups.group(setlist)
        VStack(alignment: .leading, spacing: Space.x2) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 2) {
                    if groups.count > 1 || group.label != "Set I" {
                        Text(group.label.uppercased())
                            .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
                            .tracking(0.6)
                            .foregroundStyle(Color.brandLight)
                    }
                    ForEach(group.songs) { song in
                        NavigationLink(value: AppRoute.song(artist: artistSlug, song: SongIndex.songSlug(song.name))) {
                            (Text(song.name.isEmpty ? "Untitled" : song.name).foregroundStyle(Color.textPrimary)
                             + Text(song.tape == true ? " \(song.transitionMark.flatMap { $0.isEmpty ? nil : $0 } ?? ">")" : "")
                                .foregroundStyle(Color.brandLight).fontWeight(.bold))
                                .font(.jakarta(size: 14, relativeTo: .subheadline))
                                .frame(maxWidth: .infinity, minHeight: 26, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - Shared pieces

enum RunText {
    /// "Aug 29 – Aug 31, 2025".
    static func range(_ start: String, _ end: String) -> String {
        start == end ? ShowDateText.display(start) : "\(ShowDateText.display(start)) – \(ShowDateText.display(end))"
    }

    /// "Night 2", "Nights 1, 3".
    static func nights(_ numbers: [Int]) -> String {
        "Night\(numbers.count == 1 ? "" : "s") \(numbers.map(String.init).joined(separator: ", "))"
    }
}

struct NoRepeatsBadge: View {
    var body: some View {
        Label("no repeats", systemImage: "party.popper")
            .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
            .foregroundStyle(Color.amber)
            .padding(.horizontal, Space.x2)
            .padding(.vertical, 2)
            .background(Color.amberSubtle, in: Capsule())
    }
}

struct Pill: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
            .foregroundStyle(tint)
            .padding(.horizontal, Space.x2)
            .padding(.vertical, 2)
            .background(tint.opacity(0.15), in: Capsule())
    }
}

/// Figures in cards, two to a row (value, label, an optional line under it).
struct StatCards: View {
    let cards: [(value: String, label: String, detail: String?)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: Space.x2), GridItem(.flexible(), spacing: Space.x2)], spacing: Space.x2) {
            ForEach(Array(cards.enumerated()), id: \.offset) { _, card in
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.value)
                        .font(.jakarta(size: 18, weight: .bold, relativeTo: .title3))
                        .monospacedDigit()
                        .foregroundStyle(Color.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(card.label)
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textMuted)
                    if let detail = card.detail, !detail.isEmpty {
                        Text(detail)
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
                .accessibilityElement(children: .combine)
            }
        }
    }
}
