import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing
import Core

/// Two devices rating different songs of the same show at the same moment:
/// both ratings stick (Stage 1, Part 3b). Each "device" is its own
/// FirebaseApp, so its own Firestore client and cache, signed in to the same
/// account on the Auth emulator. Both start from the same stored setlist and
/// run `SetlistTransaction` at once; the one that loses the race is retried
/// by Firestore against the newer setlist, so neither rating is lost. A
/// whole-setlist write from each device's copy would keep only one.
///
/// Runs only with both emulators' addresses passed in (the repo's
/// firebase.json rules are loaded, so writes need the signed-in owner):
///
///   npx firebase emulators:exec --only auth,firestore --project demo-native-setlist \
///     "TEST_RUNNER_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 TEST_RUNNER_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
///      xcodebuild test -workspace ios-native/MySetlists.xcworkspace -scheme MySetlists \
///      -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' \
///      -only-testing:MySetlistsTests/SetlistTransactionEmulatorTests"
///
/// (The Firestore emulator needs Java: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`.)
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["FIRESTORE_EMULATOR_HOST"] != nil
                              && ProcessInfo.processInfo.environment["FIREBASE_AUTH_EMULATOR_HOST"] != nil))
struct SetlistTransactionEmulatorTests {
    static let project = "demo-native-setlist"

    static func hostPort(_ variable: String, _ fallback: Int) -> (String, Int) {
        let value = ProcessInfo.processInfo.environment[variable] ?? "127.0.0.1:\(fallback)"
        let parts = value.split(separator: ":")
        return (String(parts[0]), Int(parts.last ?? "") ?? fallback)
    }

    /// A device: its own FirebaseApp, Auth and Firestore, on the emulators.
    static func device(_ name: String) -> FirebaseApp {
        if let app = FirebaseApp.app(name: name) { return app }
        let options = FirebaseOptions(googleAppID: "1:1234567890:ios:abcdef0123456789", gcmSenderID: "1234567890")
        options.apiKey = "AIzaSyFakeKeyForTheLocalEmulatorOnly000"
        options.projectID = project
        options.bundleID = "com.mysetlists.app"
        FirebaseApp.configure(name: name, options: options)
        let app = FirebaseApp.app(name: name)!
        let auth = hostPort("FIREBASE_AUTH_EMULATOR_HOST", 9099)
        Auth.auth(app: app).useEmulator(withHost: auth.0, port: auth.1)
        let firestore = hostPort("FIRESTORE_EMULATOR_HOST", 8080)
        let settings = FirestoreSettings()
        settings.host = "\(firestore.0):\(firestore.1)"
        settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings()
        Firestore.firestore(app: app).settings = settings
        return app
    }

    static func song(_ id: String, _ name: String, _ set: String, rating: Int? = nil, comment: String? = nil) -> [String: Any] {
        var s: [String: Any] = ["id": id, "name": name, "set": set, "cover": NSNull(), "tape": false]
        if let rating { s["rating"] = rating }
        if let comment { s["comment"] = comment }
        return s
    }

    @Test func twoDevicesRatingDifferentSongsAtOnceBothStick() async throws {
        let a = Self.device("deviceA"), b = Self.device("deviceB")
        let email = "two-devices-\(UUID().uuidString.prefix(8))@example.test"
        let created = try await Auth.auth(app: a).createUser(withEmail: email, password: "emulator-only-123")
        _ = try await Auth.auth(app: b).signIn(withEmail: email, password: "emulator-only-123")
        let uid = created.user.uid
        let path = "users/\(uid)/shows/1730000000001"
        let refA = Firestore.firestore(app: a).document(path)
        let refB = Firestore.firestore(app: b).document(path)

        try await refA.setData([
            "artist": "Goose", "venue": "Red Rocks Amphitheatre", "city": "Morrison", "date": "2026-06-12",
            "taggedFriendUids": [],
            "setlist": [
                Self.song("s1", "Arcadia", "Set I", rating: 8, comment: "Huge jam"),
                Self.song("s2", "Tumble", "Set I"),
                Self.song("s3", "Hungersite", "Set II"),
                Self.song("s4", "Madhuvan", "Set II"),
            ],
        ])
        // Both devices have the show as stored now.
        _ = try await refB.getDocument(source: .server)

        // Three rounds, each with both edits in flight together.
        for round in 1...3 {
            let onA = Task { try await SetlistTransaction.run(.rate(songId: "s2", rating: round), on: refA) }
            let onB = Task { try await SetlistTransaction.run(.rate(songId: "s3", rating: round + 5), on: refB) }
            _ = try await (onA.value, onB.value)
        }
        // And a comment against a rating on the same song at once.
        let comment = Task { try await SetlistTransaction.run(.comment(songId: "s4", comment: .string("Second set opener")), on: refA) }
        let rating = Task { try await SetlistTransaction.run(.rate(songId: "s4", rating: 9), on: refB) }
        _ = try await (comment.value, rating.value)

        let stored = try #require(SetlistTransaction.setlist(in: try await refA.getDocument(source: .server).data()))
        let byId = Dictionary(uniqueKeysWithValues: stored.compactMap { song in SetlistEdits.songId(song).map { ($0, song) } })
        #expect(stored.count == 4, "no song lost or added")
        #expect(byId["s2"]?["rating"] == .number(3), "device A's last rating stuck")
        #expect(byId["s3"]?["rating"] == .number(8), "device B's last rating stuck")
        #expect(byId["s4"]?["rating"] == .number(9) && byId["s4"]?["comment"] == .string("Second set opener"), "both edits to one song stuck")
        #expect(byId["s1"]?["rating"] == .number(8) && byId["s1"]?["comment"] == .string("Huge jam"), "an untouched rating and comment survive")
        #expect(byId["s1"]?["cover"] == .null && byId["s1"]?["tape"] == .bool(false), "fields the app doesn't edit come through as they were")
    }

    /// Device A is offline and its song edits wait in its queue; device B
    /// rates another song meanwhile. When A is back, its queue replays as
    /// transactions: both ratings stick. Writing A's whole device copy (what
    /// the app did before the queue) would have erased B's rating.
    @Test func anOfflineDevicesQueuedEditsReplayWithoutErasingAnotherDevicesRating() async throws {
        let a = Self.device("deviceA"), b = Self.device("deviceB")
        let email = "offline-queue-\(UUID().uuidString.prefix(8))@example.test"
        let created = try await Auth.auth(app: a).createUser(withEmail: email, password: "emulator-only-123")
        _ = try await Auth.auth(app: b).signIn(withEmail: email, password: "emulator-only-123")
        let path = "users/\(created.user.uid)/shows/1730000000002"
        let refA = Firestore.firestore(app: a).document(path)
        let refB = Firestore.firestore(app: b).document(path)
        try await refA.setData([
            "artist": "Goose", "venue": "Red Rocks Amphitheatre", "city": "Morrison", "date": "2026-06-13", "taggedFriendUids": [],
            "setlist": [Self.song("s1", "Hot Tea", "Set I"), Self.song("s2", "Rockdale", "Set I"), Self.song("s3", "Dripfield", "Set II")],
        ])
        let before = try #require(SetlistTransaction.setlist(in: try await refA.getDocument(source: .server).data()))

        // A, offline: two edits queued, in order, and its own copy updated.
        var queue = [
            QueuedSetlistEdit(showId: "1730000000002", edit: .rate(songId: "s1", rating: 6)),
            QueuedSetlistEdit(showId: "1730000000002", edit: .rate(songId: "s1", rating: 9)),
        ]
        let deviceCopy = SetlistEditQueue.overlay(before, queue)

        // B, online, rates another song.
        _ = try await SetlistTransaction.run(.rate(songId: "s3", rating: 8), on: refB)

        // A is back: the queue replays.
        var gaveUp: [String] = []
        await SetlistEditReplay.run(
            next: { queue.first },
            canRun: { true },
            attempt: { entry in
                do { _ = try await SetlistTransaction.run(entry.setlistEdit!, on: refA); return .landed } catch { return .failed(error) }
            },
            sleep: { _ in },
            landed: { e in queue.removeAll { $0.id == e.id } },
            gaveUp: { e, _ in gaveUp.append(e.id); queue.removeAll { $0.id == e.id } }
        )
        #expect(queue.isEmpty && gaveUp.isEmpty)

        let stored = try #require(SetlistTransaction.setlist(in: try await refB.getDocument(source: .server).data()))
        let byId = Dictionary(uniqueKeysWithValues: stored.compactMap { song in SetlistEdits.songId(song).map { ($0, song) } })
        #expect(byId["s1"]?["rating"] == .number(9), "A's edits landed, the later one last")
        #expect(byId["s3"]?["rating"] == .number(8), "B's rating made while A was offline stuck")
        #expect(deviceCopy.first { SetlistEdits.songId($0) == "s3" }?["rating"] == nil,
                "A's whole device copy doesn't have B's rating: writing it would have erased it")
    }
}
