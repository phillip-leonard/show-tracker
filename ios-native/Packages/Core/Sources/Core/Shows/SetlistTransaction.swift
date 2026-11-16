import FirebaseFirestore
import Foundation
import Network
import Observation

/// A setlist edit applied to the setlist *as stored*, in a Firestore
/// transaction (`lib/setlistEdits.js`, as the web's `editSetlist` does):
/// another device's rating made meanwhile is read inside the transaction
/// and kept. Two devices rating different songs at once both stick,
/// because Firestore retries the transaction that loses the race against
/// the newer setlist (`SetlistTransactionEmulatorTests`).
public enum SetlistTransaction {
    public enum Failure: Error, Equatable {
        /// A song holds a value JSON can't carry (a timestamp, bytes):
        /// writing the setlist back would lose it, so nothing is written.
        case unreadableSetlist
    }

    /// Runs `edit` against the stored show. Returns the setlist as stored
    /// afterwards, or nil when the show no longer exists.
    public static func run(_ edit: SetlistEdit, on ref: DocumentReference) async throws -> [JSONValue]? {
        let answer = try await ref.firestore.runTransaction { transaction, errorPointer -> Any? in
            do {
                let snap = try transaction.getDocument(ref)
                guard snap.exists else { return nil }
                guard let stored = setlist(in: snap.data()) else { throw Failure.unreadableSetlist }
                let result = SetlistEdits.apply(stored, edit)
                if result.changed { transaction.updateData(["setlist": result.setlist.map(\.firestoreValue)], forDocument: ref) }
                return Box(result.setlist)
            } catch {
                errorPointer?.pointee = error as NSError
                return nil
            }
        }
        return (answer as? Box)?.setlist
    }

    /// The stored `setlist` as raw JSON; empty when absent; nil when a song
    /// holds a value JSON can't carry.
    public static func setlist(in data: [String: Any]?) -> [JSONValue]? {
        guard let raw = data?["setlist"] else { return [] }
        if raw is NSNull { return [] }
        guard let list = raw as? [Any] else { return nil }
        var out: [JSONValue] = []
        for item in list {
            guard let value = JSONValue(firestore: item) else { return nil }
            out.append(value)
        }
        return out
    }

    /// The transaction's answer, across its untyped boundary.
    final class Box: @unchecked Sendable {
        let setlist: [JSONValue]
        init(_ setlist: [JSONValue]) { self.setlist = setlist }
    }
}

extension JSONValue {
    /// A Firestore value as JSON: nil for one JSON can't carry (Timestamp,
    /// GeoPoint, Data, a reference). Booleans are told from numbers by
    /// their CoreFoundation type, since both arrive as NSNumber.
    init?(firestore value: Any) {
        switch value {
        case is NSNull: self = .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) } else { self = .number(n.doubleValue) }
        case let s as String: self = .string(s)
        case let list as [Any]:
            var out: [JSONValue] = []
            for item in list {
                guard let v = JSONValue(firestore: item) else { return nil }
                out.append(v)
            }
            self = .array(out)
        case let map as [String: Any]:
            var out: [String: JSONValue] = [:]
            for (k, item) in map {
                guard let v = JSONValue(firestore: item) else { return nil }
                out[k] = v
            }
            self = .object(out)
        default:
            return nil
        }
    }
}

/// What to do after a queued song edit's transaction fails
/// (`SetlistEditReplay`).
///
/// Online, a slow or failed transaction is retried, with backoff, for as
/// long as the phone stays online. Offline, the edit waits in the queue for
/// the connection (`SetlistEditQueue`); this device's copy is never written
/// over the stored setlist. An error that retrying can't fix (no permission,
/// the show is gone, a setlist the app can't read) gives that edit up and
/// says so.
public enum SetlistSavePolicy {
    public enum Next: Equatable, Sendable {
        case retry(after: Duration)
        case waitForConnection
        case giveUp
    }

    /// Firestore error codes that retrying won't fix: invalid argument (3),
    /// not found (5), already exists (6), permission denied (7), failed
    /// precondition (9), out of range (11), unimplemented (12), data loss
    /// (15), unauthenticated (16).
    static let permanentCodes: Set<Int> = [3, 5, 6, 7, 9, 11, 12, 15, 16]

    /// After attempt number `attempt` (from 1) failed with `error`.
    public static func next(after error: Error, attempt: Int, online: Bool) -> Next {
        if case SetlistTransaction.Failure.unreadableSetlist? = error as? SetlistTransaction.Failure { return .giveUp }
        guard online else { return .waitForConnection }
        let ns = error as NSError
        if ns.domain == FirestoreErrorDomain, permanentCodes.contains(ns.code) { return .giveUp }
        return .retry(after: backoff(attempt: attempt))
    }

    /// 1, 2, 4, 8, 16, then every 30 seconds.
    public static func backoff(attempt: Int) -> Duration {
        .seconds(min(30, 1 << min(max(attempt, 1) - 1, 5)))
    }
}

/// Whether the phone has a network path: a transaction can't run offline,
/// so queued song edits wait, and are replayed when the path comes back.
@MainActor
@Observable
public final class Connectivity {
    public static let shared = Connectivity()
    public private(set) var isOnline = true
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private var reconnectHandlers: [@MainActor () -> Void] = []

    /// Called each time the phone gets a network path back.
    public func onReconnect(_ handler: @escaping @MainActor () -> Void) {
        reconnectHandlers.append(handler)
    }

    private func set(_ online: Bool) {
        let cameBack = online && !isOnline
        isOnline = online
        if cameBack { reconnectHandlers.forEach { $0() } }
    }

    /// Returns once the phone has no network path (checked twice a second).
    public func waitUntilOffline() async {
        while isOnline, !Task.isCancelled { try? await Task.sleep(for: .milliseconds(500)) }
    }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.set(online) }
        }
        monitor.start(queue: DispatchQueue(label: "Connectivity"))
    }
}
