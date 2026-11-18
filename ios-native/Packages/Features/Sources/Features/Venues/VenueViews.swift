import Core
import DesignSystem
import SwiftUI

// Venues (Stage 4, 4-7): the venue page, as the web's VenueDetailClient
// draws it. Your shows here come from your own shows; the venue document,
// community ratings, official photos and announcements from Firestore
// (`VenueService`). Ratings, photos, announcements and reports are for
// accounts: the rules refuse guests reading them (D-1), so a guest gets a
// prompt instead. The owner tools stay on the web (F-6): "Verify this
// venue" and "Manage venue" open mysetlists.net.

/// Where `/venues/?venue=<key>` leads: any venue, whether or not it has a
/// venue document or you've been there.
struct VenueScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var store
    @Environment(AppRouter.self) private var router
    let key: String

    @State private var venue: VenueInfo?
    @State private var ratings: [VenueRating] = []
    @State private var announcements: [VenueAnnouncement] = []
    @State private var photos: [VenuePhoto] = []
    @State private var loaded = false
    @State private var loadFailed = false
    @State private var onBucketList: Bool?
    @State private var bucketBusy = false
    @State private var attempt = 0
    @State private var rating = false
    @State private var reporting = false
    @State private var photo: VenuePhoto?
    @State private var notice: String?

    private var uid: String? { session.user?.uid }
    private var isAccount: Bool { session.user.map { !$0.isAnonymous } ?? false }
    private var mine: [Show] { VenueShows.mine(key, in: store.shows) }

    private var name: String { venue?.name ?? mine.first?.venue ?? VenueKeys.fallbackName(key) }
    private var city: String {
        if let venue, let c = venue.city { return c }
        return mine.first?.city ?? ""
    }
    private var place: String {
        let state = venue?.state ?? mine.first?.state ?? ""
        return [city, state].filter { !$0.isEmpty }.joined(separator: ", ")
    }
    private var myRating: VenueRating? { ratings.first { $0.userId == uid } }

    var body: some View {
        let mine = self.mine
        ScrollView {
            VStack(alignment: .leading, spacing: Space.x6) {
                header
                figures(mine)
                if loadFailed { loadProblem }
                if isAccount { yourRating }
                about
                if isAccount {
                    VenueAnnouncementsSection(announcements: announcements)
                    VenuePhotosSection(photos: photos, name: name) { photo = $0 }
                } else if session.user != nil {
                    guestPrompt
                }
                VenueShowsSection(shows: mine, filterTitle: venueLine(mine.first?.venue ?? name, mine.first?.city ?? city))
            }
            .padding(.horizontal, Space.x5)
            .padding(.top, Space.x2)
            .padding(.bottom, Space.x8)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Text("").accessibilityHidden(true) } }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { moreMenu } }
        .refreshable { attempt += 1 }
        .task(id: "\(key)|\(uid ?? "")|\(attempt)") { await load() }
        .sheet(isPresented: $rating) {
            if let uid {
                VenueRatingSheet(venueKey: key, venueName: name, venueCity: city, uid: uid,
                                 userName: userName, existing: myRating) {
                    notice = "Rating saved for \(name)."
                    attempt += 1
                }
            }
        }
        .sheet(isPresented: $reporting) {
            if let uid {
                ReportVenueSheet(venueKey: key, venueName: name, uid: uid, userName: userName) { notice = $0 }
            }
        }
        .sheet(item: $photo) { VenuePhotoViewer(photo: $0, name: name) }
        .notice($notice)
    }

    /// The name others see on your rating or report: your profile's, as moderated.
    private var userName: String { session.profile?.displayName ?? session.user?.displayName ?? "" }

    private func load() async {
        loadFailed = false
        var failed = false
        do { venue = try await VenueService.venue(key) } catch { failed = true }
        if let uid {
            do { onBucketList = try await VenueService.isOnBucketList(uid: uid, venueKey: key) } catch { failed = true }
        }
        if isAccount {
            let key = self.key // a Sendable copy for the child tasks
            async let r = VenueService.ratings(key)
            async let a = VenueService.announcements(key)
            async let p = VenueService.photos(key)
            let rs = try? await r
            let ans = try? await a
            let ps = try? await p
            if let rs { ratings = rs } else { failed = true }
            if let ans { announcements = ans } else { failed = true }
            if let ps { photos = ps } else { failed = true }
        }
        loaded = true
        loadFailed = failed
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            HStack(alignment: .firstTextBaseline, spacing: Space.x2) {
                Text(name)
                    .font(.jakarta(size: 28, weight: .heavy, relativeTo: .largeTitle))
                    .foregroundStyle(Color.amber)
                    .accessibilityAddTraits(.isHeader)
                if venue?.isVerified == true { VerifiedBadge(size: 22) }
            }
            if !place.isEmpty {
                Text(place)
                    .font(.jakarta(size: 15, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
            }
            if venue?.isVerified == true {
                Label { Text("Verified venue") } icon: { VerifiedBadge(size: 14) }
                    .font(.jakarta(size: 13, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(Color.verified)
            }
            actions
        }
    }

    /// The bucket list toggle, and for an account the owner's tools on the web.
    private var actions: some View {
        HStack(spacing: Space.x2) {
            if uid != nil, VenueKeys.isDocumentId(key), let onList = onBucketList {
                Button { Task { await toggleBucketList(!onList) } } label: {
                    Label(onList ? "On Bucket List" : "Add to Bucket List", systemImage: onList ? "bookmark.fill" : "bookmark")
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                }
                .buttonStyle(.bordered)
                .tint(onList ? Color.brand : Color.secondary)
                .disabled(bucketBusy)
                .accessibilityHint(onList ? "Takes \(name) off your venue bucket list" : "You'll hear when a band you follow plays here")
            }
            if isAccount, let venue, venue.isOwned(by: uid) {
                Button { router.show(VenueLinks.dashboard(key)) } label: {
                    Label("Manage Venue", systemImage: "arrow.up.forward.square")
                        .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                }
                .buttonStyle(.bordered)
                .tint(.brand)
                .accessibilityHint("Opens on mysetlists.net")
            }
        }
    }

    /// Report, and "Verify this venue" for an unverified venue (on the web).
    @ViewBuilder
    private var moreMenu: some View {
        if isAccount {
            Menu {
                if venue?.isVerified != true {
                    Button { router.show(AppRoute.venue(key: key).webURL) } label: {
                        Label("Verify this Venue on mysetlists.net", systemImage: "checkmark.seal")
                    }
                }
                Button { reporting = true } label: { Label("Report this Venue", systemImage: "flag") }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .accessibilityLabel("More for \(name)")
            }
        }
    }

    private func toggleBucketList(_ on: Bool) async {
        guard let uid else { return }
        bucketBusy = true
        defer { bucketBusy = false }
        do {
            try await VenueService.setOnBucketList(on, uid: uid, venueKey: key, name: name, city: city, state: venue?.state)
            onBucketList = on
            notice = on ? "\(name) is on your venue bucket list. You'll hear when a band you follow plays here." : "\(name) is off your venue bucket list."
        } catch {
            notice = "Couldn't update your bucket list. Try again."
        }
    }

    // MARK: Figures

    private func figures(_ mine: [Show]) -> some View {
        var items: [(value: String, label: String, detail: String?)] = [("\(mine.count)", "Your shows here", nil)]
        if isAccount {
            let average = VenueRatings.average(ratings)
            items.append((loaded ? ratings.count.formatted() : "…", "Community ratings", nil))
            items.append((average.map { "\($0)/5" } ?? "—", "Avg. rating", nil))
        }
        items.append((VenueText.capacity(venue?.capacity) ?? "—", "Capacity", nil))
        return FigureGrid(figures: items)
    }

    private var loadProblem: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Label("Couldn't load everything for this venue", systemImage: "exclamationmark.circle")
                .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                .foregroundStyle(Color.textPrimary)
            Text("Check your connection, then try again. Your shows here are below.")
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
            Button("Try again") { attempt += 1 }.buttonStyle(.bordered).tint(.brand)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }

    // MARK: Your rating

    private var yourRating: some View {
        Button { rating = true } label: {
            HStack(spacing: Space.x3) {
                Image(systemName: "star.bubble").foregroundStyle(Color.brand).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    if let myRating {
                        Text("Your rating")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                        StarsText(value: myRating.overallRating)
                    } else {
                        Text("Rate This Venue")
                            .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                            .foregroundStyle(Color.textPrimary)
                        Text("Sound, sightlines, atmosphere and more")
                            .font(.jakarta(size: 12, relativeTo: .caption))
                            .foregroundStyle(Color.textSecondary)
                    }
                }
                Spacer(minLength: Space.x2)
                Text(myRating == nil ? "Rate" : "Edit")
                    .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(Color.brand)
            }
            .frame(minHeight: TouchTarget.minimum + 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!loaded)
        .padding(.horizontal, Space.x3)
        .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
        .accessibilityLabel(myRating.map { "Your rating, \($0.overallRating) of 5 stars. Edit" } ?? "Rate this venue")
    }

    // MARK: About

    @ViewBuilder
    private var about: some View {
        if let bio = venue?.bio {
            Text(bio)
                .font(.jakarta(size: 14, relativeTo: .subheadline))
                .foregroundStyle(Color.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(radius: Radius.xl2)
        }
        if let venue, venue.officialWebsite != nil || venue.yearOpened != nil || venue.address != nil {
            VStack(alignment: .leading, spacing: Space.x2) {
                SectionTitle("Venue info")
                VStack(alignment: .leading, spacing: Space.x2) {
                    if let address = venue.address {
                        Label(address, systemImage: "mappin.and.ellipse")
                    }
                    if let year = venue.yearOpened {
                        Label("Opened \(year)", systemImage: "calendar")
                    }
                    if let site = venue.officialWebsite {
                        Button { router.show(site) } label: {
                            Label("Official Website", systemImage: "arrow.up.forward.square")
                        }
                        .tint(.brand)
                        .accessibilityHint("Opens \(site.host ?? "the venue's website")")
                    }
                }
                .font(.jakarta(size: 14, relativeTo: .subheadline))
                .foregroundStyle(Color.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(radius: Radius.xl2)
            }
        }
    }

    private var guestPrompt: some View {
        VStack(alignment: .leading, spacing: Space.x2) {
            Label("Ratings, photos and announcements", systemImage: "person.crop.circle.badge.plus")
                .font(.jakarta(size: 15, weight: .semibold, relativeTo: .body))
                .foregroundStyle(Color.textPrimary)
            Text("Create an account in Me to see what others think of \(name), rate it yourself, and see the venue's official photos and announcements.")
                .font(.jakarta(size: 13, relativeTo: .footnote))
                .foregroundStyle(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }
}

// MARK: - Sections

/// "Your shows here": the ten newest, and all of them in your show list.
private struct VenueShowsSection: View {
    let shows: [Show]
    /// "Venue, City", as Stats' venue list names it, for the filtered list.
    let filterTitle: String

    var body: some View {
        let today = ShowDate.today()
        VStack(alignment: .leading, spacing: Space.x3) {
            SectionTitle("Your shows here")
            if shows.isEmpty {
                Text("No shows here yet. Add a show at this venue and it appears here.")
                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                    .foregroundStyle(Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .brandCard(radius: Radius.xl2)
            } else {
                VStack(spacing: 0) {
                    let top = Array(shows.prefix(10))
                    ForEach(Array(top.enumerated()), id: \.element.id) { i, show in
                        NavigationLink(value: AppRoute.show(id: show.id)) { ShowRow(show: show, today: today) }
                            .buttonStyle(.plain)
                            .padding(.vertical, Space.x1)
                        if i < top.count - 1 { Divider().overlay(Color.borderSubtle) }
                    }
                }
                .padding(.horizontal, Space.x3)
                .background(Color.surface, in: RoundedRectangle.brand(Radius.xl2))
                if shows.count > 10 {
                    NavigationLink(value: AppRoute.myShows(ShowsFilter(kind: .venue, title: filterTitle))) {
                        Label("All \(shows.count) shows here", systemImage: "music.note.list")
                            .font(.jakarta(size: 14, weight: .semibold, relativeTo: .subheadline))
                    }
                    .tint(.brand)
                }
            }
        }
    }
}

/// Official announcements, newest first. Hidden when there are none, as on the web.
private struct VenueAnnouncementsSection: View {
    let announcements: [VenueAnnouncement]

    var body: some View {
        if !announcements.isEmpty {
            VStack(alignment: .leading, spacing: Space.x3) {
                SectionTitle("Announcements")
                VStack(alignment: .leading, spacing: Space.x3) {
                    ForEach(announcements) { a in
                        HStack(alignment: .top, spacing: Space.x3) {
                            RoundedRectangle(cornerRadius: 1).fill(Color.brand).frame(width: 2)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(a.text)
                                    .font(.jakarta(size: 14, relativeTo: .subheadline))
                                    .foregroundStyle(Color.textPrimary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if let at = a.createdAt {
                                    Text(at.formatted(date: .abbreviated, time: .omitted))
                                        .font(.jakarta(size: 12, relativeTo: .caption))
                                        .foregroundStyle(Color.textMuted)
                                }
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(radius: Radius.xl2)
            }
        }
    }
}

/// Official photos in a grid; a tap opens one. Hidden when there are none.
private struct VenuePhotosSection: View {
    let photos: [VenuePhoto]
    let name: String
    let open: (VenuePhoto) -> Void

    var body: some View {
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: Space.x3) {
                HStack(spacing: Space.x2) {
                    SectionTitle("Official photos")
                    VerifiedBadge(size: 13)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: Space.x2)], spacing: Space.x2) {
                    ForEach(photos) { p in
                        Button { open(p) } label: {
                            Color.surfaceHover
                                .aspectRatio(1, contentMode: .fit)
                                .overlay {
                                    AsyncImage(url: p.url) { phase in
                                        if let image = phase.image {
                                            image.resizable().scaledToFill()
                                        } else if phase.error != nil {
                                            Image(systemName: "photo").foregroundStyle(Color.textMuted)
                                        } else {
                                            ProgressView()
                                        }
                                    }
                                }
                                .clipShape(RoundedRectangle.brand(Radius.xl))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(p.caption ?? "Photo of \(name)")
                    }
                }
            }
        }
    }
}

/// One official photo, full size, with its caption.
private struct VenuePhotoViewer: View {
    @Environment(\.dismiss) private var dismiss
    let photo: VenuePhoto
    let name: String

    var body: some View {
        NavigationStack {
            VStack(spacing: Space.x4) {
                AsyncImage(url: photo.url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                    } else if phase.error != nil {
                        ContentUnavailableView("Couldn't load the photo", systemImage: "photo")
                    } else {
                        ProgressView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if let caption = photo.caption {
                    Text(caption)
                        .font(.jakarta(size: 14, relativeTo: .subheadline))
                        .foregroundStyle(Color.textSecondary)
                        .padding(.horizontal, Space.x5)
                }
            }
            .padding(.bottom, Space.x5)
            .brandScreen()
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

// MARK: - Rate a venue

/// Your rating of a venue: overall (required), five optional sub-ratings
/// and a review, as the web's `VenueRatingModal`. Accounts only.
struct VenueRatingSheet: View {
    @Environment(\.dismiss) private var dismiss
    let venueKey: String
    let venueName: String
    let venueCity: String
    let uid: String
    let userName: String
    let existing: VenueRating?
    let onSaved: () -> Void
    @State private var draft = VenueRatingDraft()
    @State private var saving = false
    @State private var problem: String?

    init(venueKey: String, venueName: String, venueCity: String, uid: String, userName: String,
         existing: VenueRating?, onSaved: @escaping () -> Void) {
        self.venueKey = venueKey
        self.venueName = venueName
        self.venueCity = venueCity
        self.uid = uid
        self.userName = userName
        self.existing = existing
        self.onSaved = onSaved
        _draft = State(initialValue: VenueRatingDraft(existing))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    StarPicker(label: "Overall rating", value: $draft.overallRating, size: 30)
                } header: {
                    Text("Overall rating")
                } footer: {
                    Text(venueLine(venueName, venueCity))
                }
                .brandRow()

                Section("Optional sub-ratings") {
                    ForEach(VenueRatings.subRatings) { sub in
                        HStack {
                            Text(sub.label)
                                .font(.brand(.sm))
                            Spacer(minLength: Space.x2)
                            StarPicker(label: sub.label, value: subBinding(sub.key), size: 22)
                        }
                    }
                }
                .brandRow()

                Section {
                    TextField("What did you think of the venue?", text: $draft.review, axis: .vertical)
                        .lineLimit(3...6)
                        .onChange(of: draft.review) {
                            if draft.review.count > VenueRatings.maxReview { draft.review = String(draft.review.prefix(VenueRatings.maxReview)) }
                        }
                } header: {
                    Text("Review (optional)")
                } footer: {
                    HStack {
                        if let problem { Text(problem).foregroundStyle(Color.amber) }
                        Spacer()
                        Text("\(draft.review.count)/\(VenueRatings.maxReview)").monospacedDigit()
                    }
                }
                .brandRow()
            }
            .brandScreen()
            .disabled(saving)
            .navigationTitle(existing == nil ? "Rate This Venue" : "Edit Your Rating")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(existing == nil ? "Save" : "Update") }
                    }
                    .disabled(!draft.canSave || saving)
                }
            }
            .interactiveDismissDisabled(saving)
        }
    }

    private func subBinding(_ key: String) -> Binding<Int> {
        Binding(get: { draft.subRatings[key] ?? 0 }, set: { draft.subRatings[key] = $0 })
    }

    private func save() async {
        saving = true
        problem = nil
        defer { saving = false }
        do {
            try await VenueService.saveRating(uid: uid, userName: userName, venueKey: venueKey, venueName: venueName,
                                              venueCity: venueCity, draft: draft, existingId: existing?.id)
            onSaved()
            dismiss()
        } catch {
            problem = "Couldn't save your rating. Try again."
        }
    }
}

/// Five stars; tapping the current value clears it, as on the web. Each
/// star is its own control (`.borderless`), so a Form row doesn't tap them
/// all at once. VoiceOver reads it as one adjustable value.
private struct StarPicker: View {
    let label: String
    @Binding var value: Int
    let size: CGFloat

    var body: some View {
        HStack(spacing: 4) {
            ForEach(1...5, id: \.self) { n in
                Button { value = value == n ? 0 : n } label: {
                    Image(systemName: n <= value ? "star.fill" : "star")
                        .font(.system(size: size))
                        .foregroundStyle(n <= value ? Color.brand : Color.textMuted)
                        .frame(minWidth: max(size, 28), minHeight: TouchTarget.minimum)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(value == 0 ? "Not rated" : "\(value) of 5 stars")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: value = min(5, value + 1)
            case .decrement: value = max(0, value - 1)
            @unknown default: break
            }
        }
    }
}

/// "★★★★☆", read as "4 of 5 stars".
private struct StarsText: View {
    let value: Int
    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { n in
                Image(systemName: n <= value ? "star.fill" : "star")
                    .font(.system(size: 12))
                    .foregroundStyle(n <= value ? Color.brand : Color.textMuted)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(value) of 5 stars")
    }
}

// MARK: - Report a venue

/// A venue report (`venueReports`, read by the admin): a reason and
/// optional details, as the web's `ReportVenueModal`. Accounts only.
struct ReportVenueSheet: View {
    @Environment(\.dismiss) private var dismiss
    let venueKey: String
    let venueName: String
    let uid: String
    let userName: String
    let onReported: (String) -> Void
    @State private var reason: VenueReportReason = .unverifiedClaimingOfficial
    @State private var comment = ""
    @State private var sending = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Reason") {
                    Picker("Reason", selection: $reason) {
                        ForEach(VenueReportReason.allCases) { r in Text(r.label).tag(r) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                .brandRow()

                Section {
                    TextField("Anything else we should know?", text: $comment, axis: .vertical)
                        .lineLimit(3...6)
                        .onChange(of: comment) {
                            if comment.count > VenueReportReason.maxComment { comment = String(comment.prefix(VenueReportReason.maxComment)) }
                        }
                } header: {
                    Text("Additional details (optional)")
                } footer: {
                    if let problem { Text(problem).foregroundStyle(Color.amber) }
                }
                .brandRow()
            }
            .brandScreen()
            .disabled(sending)
            .navigationTitle("Report this Venue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: { if sending { ProgressView() } else { Text("Submit") } }
                        .disabled(sending)
                }
            }
            .interactiveDismissDisabled(sending)
        }
    }

    private func send() async {
        sending = true
        problem = nil
        defer { sending = false }
        do {
            try await VenueService.report(reason, venueKey: venueKey, venueName: venueName, uid: uid, userName: userName, comment: comment)
            onReported("Report submitted. Thanks for helping keep venue data accurate. Our team will review it.")
            dismiss()
        } catch {
            problem = "Couldn't send that report. Try again."
        }
    }
}

// MARK: - Badge

/// The blue check by a verified venue's name (the web's `VerificationBadge`).
struct VerifiedBadge: View {
    let size: CGFloat
    var body: some View {
        Image(systemName: "checkmark.seal.fill")
            .font(.system(size: size))
            .foregroundStyle(Color.verified)
            .accessibilityLabel("Verified venue")
    }
}

extension Color {
    /// The web's verified blue (Tailwind blue-500).
    static let verified = Color(red: 59 / 255, green: 130 / 255, blue: 246 / 255)
}
