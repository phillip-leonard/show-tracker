import Core
import DesignSystem
import SwiftUI

/// A show's stored date for people: "Nov 15, 2026". Read as a calendar day
/// (`ShowDate`), never shifted by a time zone; the text as stored when it
/// can't be read.
enum ShowDateText {
    static func display(_ value: String) -> String {
        let iso = ShowDate.isoDay(value)
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return value.isEmpty ? "No date" : value }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        guard let date = Calendar.current.date(from: components) else { return iso }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }
}

/// "Red Rocks Amphitheatre, Morrison, CO", or whichever half there is.
func venueLine(_ venue: String, _ city: String) -> String {
    [venue, city].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: ", ")
}

/// One past show: band, date, venue and city, rating, setlist status.
struct ShowRow: View {
    let show: Show
    let today: String

    var body: some View {
        HStack(alignment: .top, spacing: Space.x3) {
            VStack(alignment: .leading, spacing: Space.x1) {
                Text(show.artist.isEmpty ? "Unknown band" : show.artist)
                    .font(.jakarta(size: 17, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(Color.textPrimary)
                Text(ShowDateText.display(show.date))
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                let place = venueLine(show.venue, show.city)
                if !place.isEmpty {
                    Text(place)
                        .font(.jakarta(size: 14, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                        .lineLimit(2)
                }
                HStack(spacing: Space.x2) {
                    SetlistStatusLabel(status: ShowList.setlistStatus(show))
                    if ShowList.isFutureDated(show, today: today) {
                        Text("Upcoming")
                            .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                            .foregroundStyle(Color.brand)
                    }
                }
                .padding(.top, 2)
            }
            Spacer(minLength: Space.x2)
            if let rating = show.rating {
                RatingBadge(rating: rating)
            }
        }
        .padding(.vertical, Space.x1)
        .accessibilityElement(children: .combine)
    }
}

/// "8/10", the show's own rating.
struct RatingBadge: View {
    let rating: Int

    var body: some View {
        Text("\(rating)/10")
            .font(.jakarta(size: 14, weight: .bold, relativeTo: .subheadline))
            .monospacedDigit()
            .foregroundStyle(Color.amber)
            .padding(.horizontal, Space.x2)
            .padding(.vertical, 2)
            .background(Color.amberSubtle, in: Capsule())
            .accessibilityLabel("Rated \(rating) out of 10")
    }
}

/// Has a setlist (how many songs), has none yet, or has an update waiting.
struct SetlistStatusLabel: View {
    let status: ShowList.SetlistStatus

    var body: some View {
        switch status {
        case .songs(let n):
            line(n == 1 ? "1 song" : "\(n) songs", "music.note.list", Color.textMuted)
        case .missing:
            line("No setlist yet", "music.note", Color.textMuted)
        case .proposalWaiting:
            line("Setlist update waiting", "arrow.triangle.2.circlepath", Color.brand, weight: .semibold)
        }
    }

    private func line(_ text: String, _ symbol: String, _ color: Color, weight: Font.Weight = .regular) -> some View {
        HStack(spacing: Space.x1) {
            Image(systemName: symbol).imageScale(.small)
            Text(text)
        }
        .font(.jakarta(size: 12, weight: weight, relativeTo: .caption))
        .foregroundStyle(color)
    }
}

/// One upcoming show: band, date (and time), venue and city.
struct UpcomingRow: View {
    let show: UpcomingShow

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x1) {
            Text(show.artist.isEmpty ? "Unknown band" : show.artist)
                .font(.jakarta(size: 17, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
            Text([ShowDateText.display(show.date), show.time].compactMap { $0 }.joined(separator: " · "))
                .font(.jakarta(size: 14, relativeTo: .subheadline))
                .foregroundStyle(Color.textSecondary)
            let place = venueLine(show.venue, show.city)
            if !place.isEmpty {
                Text(place)
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, Space.x1)
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
