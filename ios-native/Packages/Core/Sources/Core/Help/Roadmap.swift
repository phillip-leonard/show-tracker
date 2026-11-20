import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation

// The roadmap (Stage 6, 6-11; the web's RoadmapView and RoadmapCard): the
// published items in three columns, most votes first, the three most voted
// marked "Most requested", and a vote each for accounts. A vote is the
// rules' transaction: `voters/{uid}` created or deleted with `voteCount`
// ±1 and `updatedAt`, nothing else.

public struct RoadmapItem: Hashable, Sendable, Identifiable {
    public let id: String
    public var title: String
    public var description: String
    public var status: RoadmapColumn
    public var category: RoadmapCategory?
    public var voteCount: Int
    /// `publishedAt`, else `createdAt`.
    public var date: Date?

    public init(id: String, title: String, description: String = "", status: RoadmapColumn,
                category: RoadmapCategory? = nil, voteCount: Int = 0, date: Date? = nil) {
        self.id = id
        self.title = title
        self.description = description
        self.status = status
        self.category = category
        self.voteCount = voteCount
        self.date = date
    }

    /// A stored item; `nil` for a draft or anything not on the public board.
    public init?(id: String, data: [String: Any]) {
        guard let status = (data["status"] as? String).flatMap(RoadmapColumn.init(rawValue:)) else { return nil }
        let title = (data["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !title.isEmpty else { return nil }
        self.init(
            id: id,
            title: title,
            description: (data["description"] as? String) ?? "",
            status: status,
            category: (data["category"] as? String).flatMap(RoadmapCategory.init(rawValue:)),
            voteCount: (data["voteCount"] as? NSNumber)?.intValue ?? 0,
            date: ((data["publishedAt"] as? Timestamp) ?? (data["createdAt"] as? Timestamp))?.dateValue()
        )
    }

    /// The description, unless it only repeats the title.
    public var detail: String? {
        let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
        return d.isEmpty || d == title ? nil : d
    }
}

/// `ROADMAP_COLUMNS` (lib/constants.js), in its order.
public enum RoadmapColumn: String, CaseIterable, Sendable, Identifiable {
    case upnext, inprogress, shipped
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .upnext: "Up Next"
        case .inprogress: "In Progress"
        case .shipped: "Shipped"
        }
    }
}

public enum RoadmapBoard {
    /// A column's items, most votes first (ties by title, so the order holds still).
    public static func column(_ column: RoadmapColumn, in items: [RoadmapItem]) -> [RoadmapItem] {
        items.filter { $0.status == column }.sorted {
            $0.voteCount == $1.voteCount ? $0.title < $1.title : $0.voteCount > $1.voteCount
        }
    }

    /// The three most voted across every column ("Most requested").
    public static func mostRequested(_ items: [RoadmapItem]) -> Set<String> {
        Set(items.sorted {
            $0.voteCount == $1.voteCount ? $0.id < $1.id : $0.voteCount > $1.voteCount
        }.prefix(3).map(\.id))
    }
}

@MainActor
@Observable
public final class RoadmapStore {
    public private(set) var items: [RoadmapItem] = []
    public private(set) var loaded = false
    public private(set) var problem: String?
    /// The items this account has voted for.
    public private(set) var voted: Set<String> = []
    public private(set) var voting: String?
    private var listener: ListenerRegistration?
    private var uid: String?
    private var checkedVotes: Set<String> = []

    public init() {}

    /// Listens while the roadmap is open; `uid` is nil for a guest (no votes).
    public func start(uid: String?) {
        stop()
        self.uid = uid
        Task {
            let db = await Database.ready()
            listener = db.collection("roadmapItems")
                .whereField("status", in: RoadmapColumn.allCases.map(\.rawValue))
                .addSnapshotListener { [weak self] snapshot, error in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        if let error {
                            Self.log(error, stage: "list")
                            if self.items.isEmpty { self.problem = "Couldn't load the roadmap." }
                        }
                        guard let snapshot else { self.loaded = true; return }
                        self.items = snapshot.documents.compactMap { RoadmapItem(id: $0.documentID, data: $0.data()) }
                        self.problem = nil
                        self.loaded = true
                        Task { await self.loadVotes() }
                    }
                }
        }
    }

    public func stop() {
        listener?.remove()
        listener = nil
        checkedVotes = []
    }

    /// Which items you've voted for: your own `voters/{uid}` documents.
    private func loadVotes() async {
        guard let uid else { return }
        let db = await Database.ready()
        let unchecked = items.map(\.id).filter { !checkedVotes.contains($0) }
        for id in unchecked {
            checkedVotes.insert(id)
            if let snap = try? await db.document("roadmapItems/\(id)/voters/\(uid)").getDocument(), snap.exists {
                voted.insert(id)
            }
        }
    }

    /// Votes or takes the vote back, in the rules' transaction.
    public func toggleVote(_ item: RoadmapItem) async {
        guard let uid, voting == nil else { return }
        voting = item.id
        defer { voting = nil }
        let had = voted.contains(item.id)
        let db = await Database.ready()
        do {
            try await Self.vote(add: !had, item: db.document("roadmapItems/\(item.id)"),
                                voter: db.document("roadmapItems/\(item.id)/voters/\(uid)"))
            if had { voted.remove(item.id) } else { voted.insert(item.id) }
        } catch {
            Self.log(error, stage: "vote")
            problem = "Couldn't save your vote. Try again."
        }
    }

    private static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "RoadmapStore \(stage)"])
    }

    /// The rules' vote: the voter document and `voteCount` ±1 together.
    /// Nothing changes when the stored vote already matches.
    nonisolated static func vote(add: Bool, item: DocumentReference, voter: DocumentReference) async throws {
        _ = try await item.firestore.runTransaction { transaction, errorPointer -> Any? in
            do {
                let exists = try transaction.getDocument(voter).exists
                if add, !exists {
                    transaction.setData(["votedAt": FieldValue.serverTimestamp()], forDocument: voter)
                    transaction.updateData(["voteCount": FieldValue.increment(Int64(1)), "updatedAt": FieldValue.serverTimestamp()], forDocument: item)
                } else if !add, exists {
                    transaction.deleteDocument(voter)
                    transaction.updateData(["voteCount": FieldValue.increment(Int64(-1)), "updatedAt": FieldValue.serverTimestamp()], forDocument: item)
                }
            } catch {
                errorPointer?.pointee = error as NSError
            }
            return nil
        }
    }
}
