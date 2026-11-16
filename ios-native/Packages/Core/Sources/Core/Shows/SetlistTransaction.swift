import FirebaseFirestore
import Foundation
import Network

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

    /// Writes this device's copy of the setlist (offline, or when the
    /// transaction can't run): last write wins, as on the web. With
    /// persistence on, Firestore queues it across a force-quit.
    public static func writeDeviceCopy(_ setlist: [JSONValue], to ref: DocumentReference) async throws {
        try await ref.updateData(["setlist": setlist.map(\.firestoreValue)])
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

/// Whether the phone has a network path: a transaction can't run offline,
/// so a setlist edit goes straight to the device-copy write.
@MainActor
public final class Connectivity {
    public static let shared = Connectivity()
    public private(set) var isOnline = true
    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.isOnline = online }
        }
        monitor.start(queue: DispatchQueue(label: "Connectivity"))
    }
}
