import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation

/// The signed-in person's inbox, kept live (Stage 3, Part 4): the latest
/// 50 notifications and how many are unread, as the web reads them
/// (lib/notifications.js `subscribeAllNotifications`, AppContext's unread
/// listener). Guests have one too: band alerts reach them (D-2).
///
/// Marking read is a write to the reader's own documents, which the rules
/// allow; it stays a client write (STAGE3-AUDIT §3.1). Offline, it applies
/// at once and syncs later, like any Firestore write.
@MainActor
@Observable
public final class NotificationsStore {
    public private(set) var uid: String?
    public private(set) var notifications: [AppNotification] = []
    /// Every unread notification, not just the latest 50: the badge.
    public private(set) var unreadIds: Set<String> = []
    public private(set) var loaded = false
    public private(set) var loadProblem: String?
    private var listeners: [ListenerRegistration] = []

    public static let pageSize = 50

    public init() {}

    public var unreadCount: Int { unreadIds.count }
    public var bandAlerts: [AppNotification] { NotificationLists.bandAlerts(notifications) }

    public func start(uid: String) {
        guard uid != self.uid else { return }
        stop()
        self.uid = uid
        Task { await attach(uid: uid) }
    }

    public func stop() {
        listeners.forEach { $0.remove() }
        listeners = []
        uid = nil
        notifications = []
        unreadIds = []
        loaded = false
        loadProblem = nil
    }

    private func attach(uid: String) async {
        let db = await Database.ready()
        guard self.uid == uid else { return }
        let base = db.collection("notifications").whereField("uid", isEqualTo: uid)
        // The web's query; its composite index (uid, createdAt desc) exists.
        listeners.append(base.order(by: "createdAt", descending: true).limit(to: Self.pageSize)
            .addSnapshotListener { [weak self] snapshot, error in
                MainActor.assumeIsolated {
                    guard let self, self.uid == uid else { return }
                    if let error {
                        Self.log(error, stage: "list")
                        if self.notifications.isEmpty { self.loadProblem = "Couldn't load your notifications." }
                    }
                    guard let snapshot else { self.loaded = true; return }
                    self.notifications = NotificationLists.sorted(snapshot.documents.compactMap { try? $0.decodeNotification() })
                    self.loadProblem = nil
                    self.loaded = true
                }
            })
        listeners.append(base.whereField("read", isEqualTo: false).addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "unread") }
                guard let snapshot else { return }
                self.unreadIds = Set(snapshot.documents.map(\.documentID))
            }
        })
    }

    /// Marks one read (opening it). Shown at once; the write syncs.
    public func markRead(_ id: String) {
        guard unreadIds.contains(id) || notifications.contains(where: { $0.id == id && !$0.read }) else { return }
        unreadIds.remove(id)
        if let i = notifications.firstIndex(where: { $0.id == id }) { notifications[i].read = true }
        Task {
            do { try await Database.ready().document("notifications/\(id)").updateData(["read": true]) } catch {
                Self.log(error, stage: "markRead")
            }
        }
    }

    /// "Mark all as read": every unread one, in batches of 400.
    public func markAllRead() {
        let ids = Array(unreadIds.union(notifications.filter { !$0.read }.map(\.id)))
        guard !ids.isEmpty else { return }
        unreadIds = []
        notifications = notifications.map { var n = $0; n.read = true; return n }
        Task {
            let db = await Database.ready()
            for start in stride(from: 0, to: ids.count, by: 400) {
                let batch = db.batch()
                for id in ids[start..<min(start + 400, ids.count)] {
                    batch.updateData(["read": true], forDocument: db.document("notifications/\(id)"))
                }
                do { try await batch.commit() } catch { Self.log(error, stage: "markAllRead") }
            }
        }
    }

    private static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "NotificationsStore \(stage)"])
    }
}
