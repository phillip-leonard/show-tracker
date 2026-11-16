import Core
import DesignSystem
import SwiftUI
import UIKit

/// Me → Push notifications (Stage 3, Part 5): whether this iPhone gets
/// push, as the web's PushAlertsCard. Turning it on is offered only while
/// `config/app.iosPushOfferEnabled` is on (off today); with it off, the row
/// stays hidden until permission has been decided, as the web does.
struct PushSettingsSection: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    private let push = PushCenter.shared
    @State private var asking = false

    private var offerEnabled: Bool { session.appConfig?.iosPushOfferEnabled == true }

    var body: some View {
        Group {
            switch push.authorization {
            case .authorized, .provisional, .ephemeral:
                Section {
                    LabeledContent("Push notifications", value: "On")
                } footer: {
                    Text("Band alerts and anniversaries can come to this iPhone. Choose which in each alert's settings, or turn them all off in iOS Settings.")
                }
                .brandRow()
            case .denied:
                Section {
                    LabeledContent("Push notifications", value: "Off")
                    Button("Open iOS Settings") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                    }
                } footer: {
                    Text("Notifications for MySetlists are off in iOS Settings. Alerts still reach you by email if you've chosen email.")
                }
                .brandRow()
            default:
                if offerEnabled {
                    Section {
                        Button {
                            asking = true
                            Task { await push.requestPermission(offerEnabled: offerEnabled); asking = false }
                        } label: {
                            HStack {
                                Text("Turn on push notifications")
                                if asking { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(asking)
                    } footer: {
                        Text("Get band alerts and anniversaries on this iPhone.")
                    }
                    .brandRow()
                }
            }
        }
        .task { await push.refreshAuthorization() }
        // Changed in iOS Settings while the app was away.
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await push.refreshAuthorization() } } }
    }
}

/// Admins only, behind five taps on the version (C-7): this device's push
/// state and a test push to your own devices with a link, to check delivery
/// and where a tap lands (`send-test-push`, which checks the claim again).
struct PushDiagnosticsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShowsStore.self) private var shows
    private let push = PushCenter.shared
    @State private var sending = false
    @State private var result: String?

    private var targets: [(String, String)] {
        var list: [(String, String)] = [("Notifications", "/notifications/"), ("Friends", "/friends/")]
        if let show = shows.shows.first { list.append(("Your latest show", AppRoute.show(id: show.id).webURL.absoluteString)) }
        if let upcoming = shows.upcoming.first { list.append(("An upcoming show", AppRoute.upcomingShow(id: upcoming.id).webURL.absoluteString)) }
        list.append(("A band (Goose)", "/bands/?band=goose"))
        return list
    }

    var body: some View {
        Form {
            Section("This iPhone") {
                LabeledContent("Permission", value: Self.describe(push.authorization))
                LabeledContent("Registered token", value: push.registeredTokenSuffix.map { "…\($0)" } ?? "None yet")
                if let problem = push.lastProblem { Text(problem).foregroundStyle(Color.amber) }
                Button("Register again") { Task { await push.signedIn(uid: session.user?.uid) } }
            }
            .brandRow()

            Section {
                ForEach(targets, id: \.1) { target in
                    Button(target.0) { Task { await send(link: target.1) } }
                        .disabled(sending)
                }
            } header: {
                Text("Send a test push to your devices")
            } footer: {
                if let result { Text(result) } else { Text("Each opens its link when tapped. Lock the phone or leave the app to see it arrive as a banner.") }
            }
            .brandRow()
        }
        .brandScreen()
        .navigationTitle("Push")
        .navigationBarTitleDisplayMode(.inline)
        .task { await push.refreshAuthorization() }
    }

    private func send(link: String) async {
        sending = true
        defer { sending = false }
        do {
            let r = try await session.api.post(SendTestPushRequest.function, SendTestPushRequest(link: link), as: SendTestPushResponse.self)
            result = r.devices == 0 ? "No devices are registered for your account."
                : "Sent to \(r.devices) device\(r.devices == 1 ? "" : "s")\(r.dead > 0 ? "; \(r.dead) old one removed" : "")."
        } catch {
            result = error.message ?? "Couldn't send it."
        }
    }

    static func describe(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: "Allowed"
        case .denied: "Off in Settings"
        case .provisional: "Quiet (provisional)"
        case .ephemeral: "Ephemeral"
        case .notDetermined: "Not asked"
        @unknown default: "Unknown"
        }
    }
}
