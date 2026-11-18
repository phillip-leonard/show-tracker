import Core
import DesignSystem
import SwiftUI

// Band alerts (Stage 3, Part 6): follow and unfollow, Bands you follow,
// and the alert settings. Follow sits on the band page (Bands/BandViews.swift,
// Stage 4, 4-5). Guests follow too; they get alerts in the app and by
// push, never by email (D-2).

/// Follows or unfollows a band and says what happens next, as the web's
/// toggleFavoriteArtist: the first follow on a phone never asked about push
/// offers it (only while `iosPushOfferEnabled` is on), else push or email,
/// plus the city nudge for on-sale alerts.
@MainActor
@Observable
final class FollowFlow {
    var busy = false
    var message: String?
    /// The band to offer push for, after a follow (once per install).
    var pushOfferBand: String?
    private static let offeredKey = "push.offeredOnFollow"

    func toggle(_ name: String, session: SessionStore) async {
        guard let uid = session.user?.uid, !busy else { return }
        busy = true
        defer { busy = false }
        let service = BandAlertsService(api: session.api)
        do {
            let nowFollowing = try await service.toggleFollow(name, uid: uid, current: session.profile?.favoriteArtists ?? [])
            guard nowFollowing else {
                message = "Unfollowed \(name.trimmingCharacters(in: .whitespaces))."
                return
            }
            let push = PushCenter.shared
            await push.refreshAuthorization()
            if session.appConfig?.iosPushOfferEnabled == true, push.authorization == .notDetermined,
               !UserDefaults.standard.bool(forKey: Self.offeredKey) {
                UserDefaults.standard.set(true, forKey: Self.offeredKey)
                pushOfferBand = name
                return
            }
            await say(name, session: session, service: service)
        } catch {
            message = "Couldn't update the bands you follow. Try again."
        }
    }

    /// After the push offer's answer (or with no offer).
    func say(_ name: String, session: SessionStore, service: BandAlertsService? = nil) async {
        guard let uid = session.user?.uid else { return }
        let settings = await (service ?? BandAlertsService(api: session.api)).loadSettings(uid: uid)
        message = BandFollows.followedMessage(name, pushAllowed: PushCenter.allowed(PushCenter.shared.authorization),
                                              isGuest: session.user?.isAnonymous == true, hasHomeCity: settings.homeLocation != nil)
    }
}

extension View {
    /// The follow flow's push offer and its message.
    func followFlow(_ flow: FollowFlow, session: SessionStore) -> some View {
        modifier(FollowFlowModifier(flow: flow, session: session))
    }
}

private struct FollowFlowModifier: ViewModifier {
    @Bindable var flow: FollowFlow
    let session: SessionStore

    func body(content: Content) -> some View {
        content
            .alert("Get tour alerts on this iPhone?",
                   isPresented: Binding(get: { flow.pushOfferBand != nil }, set: { if !$0 { flow.pushOfferBand = nil } }),
                   presenting: flow.pushOfferBand) { band in
                Button("Turn on") {
                    flow.pushOfferBand = nil
                    Task {
                        await PushCenter.shared.requestPermission(offerEnabled: session.appConfig?.iosPushOfferEnabled == true)
                        await flow.say(band, session: session)
                    }
                }
                Button("Not now", role: .cancel) {
                    flow.pushOfferBand = nil
                    Task { await flow.say(band, session: session) }
                }
            } message: { band in
                Text("We'll let you know here when \(band) announces a tour, a date on your bucket list or a show going on sale near you.")
            }
            .notice($flow.message)
    }
}

/// Follow / Following for one band.
struct FollowBandButton: View {
    @Environment(SessionStore.self) private var session
    let name: String
    let flow: FollowFlow

    private var following: Bool { BandFollows.isFollowing(name, in: session.profile?.favoriteArtists ?? []) }

    var body: some View {
        Button {
            Task { await flow.toggle(name, session: session) }
        } label: {
            Label(following ? "Following" : "Follow", systemImage: following ? "bell.fill" : "bell")
        }
        .buttonStyle(.bordered)
        .tint(following ? .brand : .secondary)
        .disabled(flow.busy || session.user == nil)
        .accessibilityLabel(following ? "Following \(name)" : "Follow \(name)")
        .accessibilityHint(following ? "Unfollows" : "Get tour and on-sale alerts")
    }
}

/// Me → Bands you follow: the list, unfollow, and follow by name.
struct FollowedBandsView: View {
    @Environment(SessionStore.self) private var session
    @State private var flow = FollowFlow()
    @State private var newBand = ""

    private var follows: [FollowedBand] { BandFollows.sorted(session.profile?.favoriteArtists ?? []) }

    var body: some View {
        List {
            Section {
                HStack {
                    TextField("Band name", text: $newBand)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit(add)
                    Button("Follow", action: add)
                        .disabled(newBand.trimmingCharacters(in: .whitespaces).isEmpty || flow.busy
                                  || BandFollows.isFollowing(newBand, in: follows))
                }
            } footer: {
                Text("You'll hear when a band you follow announces a tour, plays a venue on your bucket list, or has a show going on sale near you.")
            }
            .brandRow()

            Section {
                if follows.isEmpty {
                    Text("You're not following any bands yet.").foregroundStyle(.secondary)
                }
                ForEach(follows, id: \.name) { band in
                    NavigationLink(value: AppRoute.band(slug: BandDirectory.slug(forArtist: band.name))) { Text(band.name) }
                        .swipeActions {
                            Button("Unfollow", role: .destructive) { Task { await flow.toggle(band.name, session: session) } }
                                .tint(Color.danger)
                        }
                        .contextMenu {
                            Button("Unfollow \(band.name)", systemImage: "bell.slash", role: .destructive) {
                                Task { await flow.toggle(band.name, session: session) }
                            }
                        }
                }
            } header: {
                Text(follows.isEmpty ? "Following" : "Following · \(follows.count)")
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Bands you follow")
        .navigationBarTitleDisplayMode(.inline)
        .followFlow(flow, session: session)
    }

    private func add() {
        let name = newBand.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !BandFollows.isFollowing(name, in: follows) else { return }
        newBand = ""
        Task { await flow.toggle(name, session: session) }
    }
}

/// Me → Alert settings: the four alerts with their channels (email hidden
/// for guests; push shown once this iPhone allows it), replies and likes
/// for accounts, and the home city and radius for on-sale alerts.
struct AlertSettingsView: View {
    @Environment(SessionStore.self) private var session
    @State private var settings = AlertSettings()
    @State private var settingsLoaded = false
    @State private var cityQuery = ""
    @State private var cityResults: [AlertSettings.Place] = []
    @State private var problem: String?
    private let push = PushCenter.shared

    private var uid: String? { session.user?.uid }
    private var isGuest: Bool { session.user?.isAnonymous == true }
    private var service: BandAlertsService { BandAlertsService(api: session.api) }

    var body: some View {
        Form {
            ForEach(AlertKind.allCases) { kind in
                alertSection(kind)
            }
            if !isGuest { engagementSection }
            if let problem {
                Section { Text(problem).foregroundStyle(Color.amber) }.brandRow()
            }
        }
        .brandScreen()
        .navigationTitle("Alert settings")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await push.refreshAuthorization()
            if let uid, !settingsLoaded { settings = await service.loadSettings(uid: uid); settingsLoaded = true }
        }
        .task(id: cityQuery) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            cityResults = cityQuery.count >= 2 ? await service.searchCities(cityQuery) : []
        }
    }

    private func pref(_ kind: AlertKind) -> AlertPref { session.profile?.alertPref(kind) ?? AlertPref(nil) }

    private func binding(_ kind: AlertKind, _ keyPath: WritableKeyPath<AlertPref, Bool>) -> Binding<Bool> {
        Binding(get: { pref(kind)[keyPath: keyPath] }, set: { on in
            var next = pref(kind)
            next[keyPath: keyPath] = on
            save(next, kind)
        })
    }

    @ViewBuilder
    private func alertSection(_ kind: AlertKind) -> some View {
        let p = pref(kind)
        Section {
            Toggle(kind.title, isOn: binding(kind, \.enabled)).tint(.brand)
            if p.enabled {
                if PushCenter.allowed(push.authorization) {
                    Toggle("Push", isOn: binding(kind, \.push)).tint(.brand)
                }
                if !isGuest {
                    Toggle("Email", isOn: binding(kind, \.email)).tint(.brand)
                }
                if kind.hasInApp {
                    Toggle("In the app", isOn: binding(kind, \.inApp)).tint(.brand)
                }
                if kind == .onsaleAlerts { onsaleSettings }
            }
        } footer: {
            Text(kind.detail)
        }
        .brandRow()
    }

    @ViewBuilder
    private var onsaleSettings: some View {
        if let home = settings.homeLocation {
            LabeledContent("Near", value: home.label)
            Button("Change city") { settings.homeLocation = nil; persist() }
        } else {
            TextField("Your city", text: $cityQuery)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
            ForEach(cityResults, id: \.self) { place in
                Button(place.label) {
                    settings.homeLocation = place
                    cityQuery = ""
                    cityResults = []
                    persist()
                }
            }
        }
        Picker("Within", selection: Binding(get: { settings.radiusMiles }, set: { settings.radiusMiles = $0; persist() })) {
            ForEach(AlertSettings.radiusOptions, id: \.self) { Text("\($0) miles").tag($0) }
        }
        LabeledContent("Time zone", value: settings.timezone)
    }

    private var engagementSection: some View {
        Section {
            Toggle("Replies and likes", isOn: Binding(get: { session.profile?.engagementOn ?? true }, set: { on in
                saveEngagement(enabled: on)
            })).tint(.brand)
            if session.profile?.engagementOn ?? true {
                Toggle("Also email me", isOn: Binding(get: { session.profile?.engagementEmailImmediately ?? false }, set: { on in
                    saveEngagement(email: on)
                })).tint(.brand)
            }
        } footer: {
            Text("When someone replies to or likes your comment, or likes your photo.")
        }
        .brandRow()
    }

    private func save(_ next: AlertPref, _ kind: AlertKind) {
        guard let uid else { return }
        Task {
            do { try await service.save(next, for: kind, uid: uid); problem = nil } catch { problem = "That setting wasn't saved. \(error.localizedDescription)" }
        }
    }

    private func saveEngagement(enabled: Bool? = nil, email: Bool? = nil) {
        guard let uid else { return }
        Task {
            do { try await service.saveEngagement(enabled: enabled, emailImmediately: email, uid: uid); problem = nil } catch {
                problem = "That setting wasn't saved. \(error.localizedDescription)"
            }
        }
    }

    private func persist() {
        guard let uid else { return }
        settings.timezone = TimeZone.current.identifier
        let snapshot = settings
        Task {
            do { try await service.saveSettings(snapshot, uid: uid); problem = nil } catch { problem = "Your city wasn't saved. \(error.localizedDescription)" }
        }
    }
}
