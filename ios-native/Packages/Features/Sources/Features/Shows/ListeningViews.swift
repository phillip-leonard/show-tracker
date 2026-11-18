import Core
import DesignSystem
import SwiftUI

// "Listen to this night" and "Where to stream this show" on the show page
// (Stage 4, 4-4), from one `archival-audio-lookup` answer (`Listening`).
// Both link out; nothing plays in the app.

/// The recordings Relisten has of this show. Nothing at all when there are
/// none, which is most shows: it mustn't read as a missing feature.
struct ListenSection: View {
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let show: Show
    let listening: Listening
    @State private var showAll = false

    var body: some View {
        let recordings = listening.shownRecordings
        if let selected = listening.selected(pick: show.archivalAudioPick) {
            VStack(alignment: .leading, spacing: Space.x3) {
                HStack(spacing: Space.x2) {
                    Label("Listen to this night", systemImage: "headphones")
                        .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                        .foregroundStyle(Color.textPrimary)
                        .labelStyle(TintedIconLabel())
                    Spacer()
                    Text(recordings.count == 1 ? "1 recording" : "\(recordings.count) recordings")
                        .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                        .foregroundStyle(Color.textMuted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)

                if recordings.count > 1 {
                    let listed = listening.listed(pick: show.archivalAudioPick, showAll: showAll)
                    VStack(spacing: 0) {
                        ForEach(Array(listed.enumerated()), id: \.element.id) { index, recording in
                            RecordingRow(recording: recording, selected: recording.id == selected.id) {
                                store.pickRecording(recording.id, showId: show.id)
                            }
                            if index < listed.count - 1 { Divider().overlay(Color.borderSubtle) }
                        }
                    }
                    .padding(.horizontal, Space.x3)
                    .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
                    if recordings.count > Listening.shortList {
                        Button(showAll ? "Show fewer" : "Show all \(recordings.count) recordings") {
                            withAnimation { showAll.toggle() }
                        }
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                        .tint(.brand)
                        .frame(maxWidth: .infinity)
                    }
                } else {
                    RecordingRow(recording: selected, selected: false, onSelect: nil)
                        .padding(.horizontal, Space.x3)
                        .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))
                }

                Button {
                    if let url = selected.url { router.show(url) }
                } label: {
                    Label(selected.linkLabel, systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(.brand)
                .disabled(selected.url == nil)

                Text("Recordings are hosted by Relisten and its sources, not by MySetlists.")
                    .font(.jakarta(size: 11, relativeTo: .caption2))
                    .foregroundStyle(Color.textMuted)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }
            .brandCard(radius: Radius.xl2)
        }
    }
}

/// One recording: soundboard or its label, Relisten's rating, the taper and
/// lineage. With more than one, tapping picks the one to listen to.
private struct RecordingRow: View {
    let recording: Listening.Recording
    let selected: Bool
    let onSelect: (() -> Void)?

    var body: some View {
        let content = HStack(alignment: .top, spacing: Space.x3) {
            if onSelect != nil {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? Color.brand : Color.textMuted)
                    .font(.system(size: 18))
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Space.x2) {
                    // Some sources' labels are paragraphs (or HTML); two lines is enough.
                    Text(recording.title)
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                        .foregroundStyle(Color.textPrimary)
                        .lineLimit(2)
                    if let rating = recording.avgRating {
                        Text("★ \(rating.formatted(.number.precision(.fractionLength(0...1))))\(recording.numReviews > 0 ? " (\(recording.numReviews))" : "")")
                            .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                            .monospacedDigit()
                            .foregroundStyle(Color.amber)
                    }
                }
                if let credit = recording.credit {
                    Text(credit)
                        .font(.jakarta(size: 12, relativeTo: .caption))
                        .foregroundStyle(Color.textSecondary)
                }
                if let lineage = recording.lineage {
                    Text(lineage)
                        .font(.jakarta(size: 11, relativeTo: .caption2))
                        .foregroundStyle(Color.textMuted)
                        .lineLimit(1)
                }
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.x3)
        .frame(minHeight: TouchTarget.minimum)
        .contentShape(Rectangle())

        if let onSelect {
            Button(action: onSelect) { content }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityHint("Picks this recording to listen to")
        } else {
            content.accessibilityElement(children: .combine)
        }
    }
}

/// Where the show may stream: nugs.net, PlayDead, Relisten, archive.org,
/// as the server lists them for the band (`lib/streamingPlatforms.js`).
struct StreamingSection: View {
    @Environment(AppRouter.self) private var router
    let platforms: [Listening.Platform]
    @State private var expanded = true

    var body: some View {
        if !platforms.isEmpty {
            VStack(alignment: .leading, spacing: Space.x2) {
                Button {
                    withAnimation { expanded.toggle() }
                } label: {
                    HStack(spacing: Space.x2) {
                        Label("Where to stream this show", systemImage: "dot.radiowaves.left.and.right")
                            .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                            .foregroundStyle(Color.textPrimary)
                            .labelStyle(TintedIconLabel())
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.textMuted)
                            .rotationEffect(.degrees(expanded ? 0 : -90))
                    }
                    .frame(minHeight: TouchTarget.minimum)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isHeader)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")

                if expanded {
                    VStack(spacing: 0) {
                        ForEach(Array(platforms.enumerated()), id: \.element.id) { index, platform in
                            Button { router.show(platform.url) } label: {
                                HStack(spacing: Space.x3) {
                                    Text(platform.icon ?? "🎧")
                                        .font(.system(size: 20))
                                        .frame(width: 28)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(platform.label)
                                            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                                            .foregroundStyle(Color.textPrimary)
                                        if let description = platform.description {
                                            Text(description)
                                                .font(.jakarta(size: 12, relativeTo: .caption))
                                                .foregroundStyle(Color.textMuted)
                                        }
                                    }
                                    Spacer(minLength: Space.x2)
                                    Image(systemName: "arrow.up.forward.square")
                                        .font(.footnote)
                                        .foregroundStyle(Color.textMuted)
                                        .accessibilityHidden(true)
                                }
                                .padding(.vertical, Space.x3)
                                .frame(minHeight: TouchTarget.minimum)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            .accessibilityHint("Opens \(platform.name)")
                            if index < platforms.count - 1 { Divider().overlay(Color.borderSubtle) }
                        }
                    }
                    .padding(.horizontal, Space.x3)
                    .background(Color.surfaceHover, in: RoundedRectangle.brand(Radius.lg))

                    Text("Availability varies by show.")
                        .font(.jakarta(size: 11, relativeTo: .caption2))
                        .foregroundStyle(Color.textMuted)
                }
            }
            .brandCard(radius: Radius.xl2)
        }
    }
}

/// A label whose icon is the brand color.
private struct TintedIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Space.x2) {
            configuration.icon.foregroundStyle(Color.brand)
            configuration.title
        }
    }
}
