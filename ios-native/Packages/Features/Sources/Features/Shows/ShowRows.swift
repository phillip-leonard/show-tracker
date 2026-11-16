import Core
import DesignSystem
import SwiftUI

/// A show's stored date for people: "Nov 15, 2026". Read as a calendar day
/// (`ShowDate`), never shifted by a time zone; the text as stored when it
/// can't be read.
enum ShowDateText {
    static func date(_ value: String) -> Date? {
        let parts = ShowDate.isoDay(value).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        return Calendar.current.date(from: components)
    }

    static func display(_ value: String) -> String {
        guard let date = date(value) else { return value.isEmpty ? "No date" : value }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// "NOV" and "08" for the row's date block; "?" when unreadable.
    static func block(_ value: String) -> (month: String, day: String) {
        guard let date = date(value) else { return ("", "?") }
        return (date.formatted(.dateTime.month(.abbreviated)).uppercased(), date.formatted(.dateTime.day(.twoDigits)))
    }
}

/// "Red Rocks Amphitheatre, Morrison, CO", or whichever half there is.
func venueLine(_ venue: String, _ city: String) -> String {
    [venue, city].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: ", ")
}

/// The month and day block at the start of a row (the Stage 1 mockup).
struct DateBlock: View {
    let date: String

    var body: some View {
        let block = ShowDateText.block(date)
        VStack(spacing: 0) {
            Text(block.month)
                .font(.jakarta(size: 11, weight: .bold, relativeTo: .caption2))
                .tracking(0.5)
                .foregroundStyle(Color.amber)
            Text(block.day)
                .font(.jakarta(size: 20, weight: .heavy, relativeTo: .title3))
                .monospacedDigit()
                .foregroundStyle(Color.textPrimary)
        }
        .frame(width: 48, height: 52)
        .background(Color.surfaceHover, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        .accessibilityHidden(true) // the row's label reads the full date
    }
}

/// One past show: date block, band, venue and city, rating and setlist status.
struct ShowRow: View {
    let show: Show
    let today: String

    var body: some View {
        HStack(spacing: Space.x3) {
            DateBlock(date: show.date)
            VStack(alignment: .leading, spacing: 3) {
                Text(show.artist.isEmpty ? "Unknown band" : show.artist)
                    .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.textPrimary)
                let place = venueLine(show.venue, show.city)
                if !place.isEmpty {
                    Text(place)
                        .font(.jakarta(size: 13, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                HStack(spacing: Space.x2) {
                    RatingText(rating: show.rating)
                    SetlistStatusLabel(status: ShowList.setlistStatus(show))
                    if ShowList.isFutureDated(show, today: today) {
                        Text("Upcoming")
                            .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                            .foregroundStyle(Color.brand)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var parts = [show.artist, ShowDateText.display(show.date), venueLine(show.venue, show.city)]
        parts.append(show.rating.map { "rated \($0) out of 10" } ?? "not rated")
        switch ShowList.setlistStatus(show) {
        case .songs(let n): parts.append("setlist, \(n) songs")
        case .missing: parts.append("no setlist yet")
        case .proposalWaiting: parts.append("setlist proposal waiting")
        }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// "★ 8/10" in amber, or "Not rated".
struct RatingText: View {
    let rating: Int?

    var body: some View {
        if let rating {
            Text("★ \(rating)/10")
                .font(.jakarta(size: 12, weight: .bold, relativeTo: .caption))
                .monospacedDigit()
                .foregroundStyle(Color.amber)
        } else {
            Text("Not rated")
                .font(.jakarta(size: 12, relativeTo: .caption))
                .foregroundStyle(Color.textMuted)
        }
    }
}

/// Setlist (green), Proposal waiting (amber) or No setlist yet (muted).
struct SetlistStatusLabel: View {
    let status: ShowList.SetlistStatus

    var body: some View {
        switch status {
        case .songs(let n):
            label(n == 1 ? "Setlist · 1 song" : "Setlist · \(n) songs", Color.brandLight)
        case .missing:
            label("No setlist yet", Color.textMuted)
        case .proposalWaiting:
            label("Proposal waiting", Color.amber)
        }
    }

    private func label(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
            .foregroundStyle(color)
    }
}

/// A year and how many shows it holds: "2026 … 38 shows".
struct YearHeader: View {
    let year: String
    let count: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(year.isEmpty ? "No date" : year)
                .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
                .foregroundStyle(Color.textPrimary)
            Spacer()
            Text(count == 1 ? "1 show" : "\(count) shows")
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
        }
        .textCase(nil)
        .padding(.bottom, 2)
    }
}

/// One upcoming show: date block, band, venue and city, time.
struct UpcomingRow: View {
    let show: UpcomingShow

    var body: some View {
        HStack(spacing: Space.x3) {
            DateBlock(date: show.date)
            VStack(alignment: .leading, spacing: 3) {
                Text(show.artist.isEmpty ? "Unknown band" : show.artist)
                    .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Color.textPrimary)
                let place = venueLine(show.venue, show.city)
                if !place.isEmpty {
                    Text(place)
                        .font(.jakarta(size: 13, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(1)
                }
                Text([ShowDateText.display(show.date), show.time].compactMap { $0 }.joined(separator: " · "))
                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(Color.brandLight)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// The four numbers above the list: shows (counted from the list, so it
/// always matches what's on screen), and bands, venues and average rating
/// from the server's `userStats` (CLAUDE.md: the numbers people see are
/// computed on the server).
struct ShowsSummary: View {
    let showCount: Int
    let stats: UserStats?

    var body: some View {
        HStack(spacing: Space.x2) {
            figure("\(showCount)", showCount == 1 ? "Show" : "Shows")
            figure(stats.map { "\($0.bandCount)" } ?? "–", "Bands")
            figure(stats.map { "\($0.venueCount)" } ?? "–", "Venues")
            figure(stats?.avgShowRating.map { String(format: "%.1f", $0) } ?? "–", "Avg rating")
        }
        .frame(maxWidth: .infinity)
    }

    private func figure(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.jakarta(size: 20, weight: .bold, relativeTo: .title3))
                .monospacedDigit()
                .foregroundStyle(Color.textPrimary)
            Text(label)
                .font(.jakarta(size: 12, relativeTo: .caption))
                .foregroundStyle(Color.textMuted)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
