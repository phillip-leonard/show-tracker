import FirebaseCrashlytics
import FirebaseFirestore
import Foundation
import Observation

/// The signed-in account's friends, requests, invites and block list, kept
/// live (Stage 3, Part 2b). Accounts only: a guest has none of these
/// (DECISIONS.md, "Guests"), so the shell never starts it for one.
///
/// Reads are the account's own documents, the queries the web runs
/// (`context/AppContext.jsx`): `users/{uid}/friends`, `friendRequests` to
/// and from them (status filtered here, so no index), their pending
/// `invites`, and `userBlocks/{uid}`. Firestore's offline cache answers
/// first, so the lists show at once, offline too.
///
/// Every change goes through `friends.js` (or `report-content`): the server
/// does every cross-user write (Stage 3, C-1). The listeners then show the
/// result. Offline, an action fails at once with a message that says so;
/// nothing is queued.
@MainActor
@Observable
public final class FriendsStore {
    public private(set) var uid: String?
    private var edges: [FriendEdge] = []
    private var requests: [String: FriendRequest] = [:]
    private var incomingIds: Set<String> = []
    private var sentIds: Set<String> = []
    private var allInvites: [Invite] = []
    public private(set) var blockedUids: [String] = []
    /// Tags to this account (any status), suggestions it's part of, and tags
    /// sent to its address before it had an account (Stage 3, Part 3b).
    private var allTags: [ShowTag] = []
    private var allEmailTags: [PendingEmailTag] = []
    private var allSuggestions: [ShowSuggestion] = []
    private var email: String?

    /// The friends list's first answer (cached, live or the one-time read)
    /// has arrived, or loading gave up. Never false for longer than ~25 s.
    public private(set) var loaded = false
    /// What's on screen came from this device's cache.
    public private(set) var fromCache = false
    /// Loading ended with nothing to show and an error.
    public private(set) var loadProblem: String?
    /// Shows you were both at, per friend (`showsTogetherCounts`).
    public private(set) var togetherCounts: [String: Int] = [:]
    /// The signed invite link (`referralLink`), once fetched.
    public private(set) var referralURL: URL?
    /// Requests, invites and people with an action in flight.
    public private(set) var busy: Set<String> = []

    private var friendsLoad: LiveLoad<[FriendEdge]>?
    private var listeners: [ListenerRegistration] = []
    private var countsFor: Set<String> = []
    private var countsTask: Task<Void, Never>?
    var api: APIClient?

    public init() {}

    // MARK: What the screens show

    private var blockedSet: Set<String> { Set(blockedUids) }
    public var friends: [FriendEdge] { FriendsLists.friends(edges, blocked: blockedSet) }
    public var incoming: [FriendRequest] {
        guard let uid else { return [] }
        return FriendsLists.incoming(incomingIds.compactMap { requests[$0] }, uid: uid, blocked: blockedSet)
    }
    public var sent: [FriendRequest] {
        guard let uid else { return [] }
        return FriendsLists.sent(sentIds.compactMap { requests[$0] }, uid: uid)
    }
    public var invites: [Invite] { FriendsLists.invites(allInvites) }

    public var pendingTags: [ShowTag] {
        guard let uid else { return [] }
        return ShowSocialLists.pendingTags(allTags, uid: uid, blocked: blockedSet)
    }
    public var pendingEmailTags: [PendingEmailTag] { ShowSocialLists.pendingEmailTags(allEmailTags, blocked: blockedSet) }
    public var pendingSuggestions: [ShowSuggestion] {
        guard let uid else { return [] }
        return ShowSocialLists.pendingSuggestions(allSuggestions, uid: uid, blocked: blockedSet)
    }
    /// Everything waiting on this person in the Friends tab: the tab's badge.
    public var waitingCount: Int { incoming.count + pendingTags.count + pendingEmailTags.count + pendingSuggestions.count }

    /// A friend's name, from this account's own list.
    public func name(of uid: String) -> String? { edges.first { $0.friendUid == uid }?.name }

    public func isFriend(_ uid: String) -> Bool { edges.contains { $0.friendUid == uid } }
    public func isBlocked(_ uid: String) -> Bool { blockedUids.contains(uid) }
    public func hasSentRequest(to uid: String) -> Bool { sent.contains { $0.to == uid } }

    // MARK: Listening

    /// `email`: the account's address, for tags sent to it before it had an
    /// account (`pendingEmailTags`, readable by that address only).
    public func start(uid: String, api: APIClient, email: String? = nil) {
        self.api = api
        guard uid != self.uid else { return }
        stop()
        self.uid = uid
        self.email = email?.lowercased()
        Task { await attach(uid: uid) }
    }

    public func stop() {
        friendsLoad?.stop(); friendsLoad = nil
        listeners.forEach { $0.remove() }
        listeners = []
        countsTask?.cancel(); countsTask = nil
        uid = nil
        edges = []
        requests = [:]
        incomingIds = []
        sentIds = []
        allInvites = []
        blockedUids = []
        allTags = []
        allEmailTags = []
        allSuggestions = []
        email = nil
        loaded = false
        fromCache = false
        loadProblem = nil
        togetherCounts = [:]
        countsFor = []
        referralURL = nil
        busy = []
    }

    private func attach(uid: String) async {
        let db = await Database.ready()
        guard self.uid == uid else { return }
        let friendsRef = db.collection("users").document(uid).collection("friends")

        let load = LiveLoad<[FriendEdge]>()
        friendsLoad = load
        load.start(
            subscribe: { next, fail in
                let registration = friendsRef.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, error in
                    MainActor.assumeIsolated {
                        if let snapshot {
                            self?.fromCache = snapshot.metadata.isFromCache
                            next(snapshot.documents.compactMap { try? $0.decodeFriend() })
                        } else if let error { fail(error) }
                    }
                }
                return { registration.remove() }
            },
            readOnce: { try await friendsRef.getDocuments().documents.compactMap { try? $0.decodeFriend() } },
            onValue: { [weak self] edges in
                guard let self, self.uid == uid else { return }
                self.edges = edges
                self.refreshCountsIfNeeded()
            },
            onLoaded: { [weak self] outcome in
                guard let self, self.uid == uid else { return }
                self.loaded = true
                if case .failed(let message) = outcome, self.edges.isEmpty { self.loadProblem = message }
            },
            onError: { error, stage in Self.log(error, stage: "friends \(stage)") }
        )

        let requestsRef = db.collection("friendRequests")
        listeners.append(requestsRef.whereField("to", isEqualTo: uid).addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "incoming requests") }
                guard let snapshot else { return }
                self.replaceRequests(snapshot, ids: \.incomingIds)
            }
        })
        listeners.append(requestsRef.whereField("from", isEqualTo: uid).addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "sent requests") }
                guard let snapshot else { return }
                self.replaceRequests(snapshot, ids: \.sentIds)
            }
        })
        listeners.append(db.collection("invites").whereField("inviterUid", isEqualTo: uid)
            .whereField("status", isEqualTo: "pending").addSnapshotListener { [weak self] snapshot, error in
                MainActor.assumeIsolated {
                    guard let self, self.uid == uid else { return }
                    if let error { Self.log(error, stage: "invites") }
                    guard let snapshot else { return }
                    self.allInvites = snapshot.documents.compactMap { try? $0.decodeInvite() }
                }
            })
        listeners.append(db.document("userBlocks/\(uid)").addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "userBlocks") }
                guard let snapshot else { return }
                self.blockedUids = (snapshot.exists ? try? snapshot.data(as: UserBlocks.self) : nil)?.blockedUserIds ?? []
            }
        })
        // The web's queries (AppContext): single equality or array-contains,
        // status filtered here, so no index.
        listeners.append(db.collection("showTags").whereField("toUid", isEqualTo: uid).addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "showTags") }
                guard let snapshot else { return }
                self.allTags = snapshot.documents.compactMap { try? $0.decodeShowTag() }
            }
        })
        listeners.append(db.collection("showSuggestions").whereField("participants", arrayContains: uid).addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.uid == uid else { return }
                if let error { Self.log(error, stage: "showSuggestions") }
                guard let snapshot else { return }
                self.allSuggestions = snapshot.documents.compactMap { try? $0.decodeSuggestion() }
            }
        })
        if let email, !email.isEmpty {
            listeners.append(db.collection("pendingEmailTags").whereField("toEmail", isEqualTo: email).addSnapshotListener { [weak self] snapshot, error in
                MainActor.assumeIsolated {
                    guard let self, self.uid == uid else { return }
                    if let error { Self.log(error, stage: "pendingEmailTags") }
                    guard let snapshot else { return }
                    self.allEmailTags = snapshot.documents.compactMap { try? $0.decodePendingEmailTag() }
                }
            })
        }
    }

    private func replaceRequests(_ snapshot: QuerySnapshot, ids keyPath: ReferenceWritableKeyPath<FriendsStore, Set<String>>) {
        for id in self[keyPath: keyPath] { requests[id] = nil }
        var next: Set<String> = []
        for doc in snapshot.documents {
            guard let request = try? doc.decodeFriendRequest() else { continue }
            requests[request.id] = request
            next.insert(request.id)
        }
        self[keyPath: keyPath] = next
    }

    /// Asks for the counts again (your shows changed: a tag accepted, a
    /// show added or deleted).
    public func refreshTogetherCounts() {
        countsFor = []
        refreshCountsIfNeeded()
    }

    /// `showsTogetherCounts` spends a daily quota, so it's asked once per
    /// set of friends, not on every snapshot.
    private func refreshCountsIfNeeded() {
        let uids = Set(edges.map(\.friendUid))
        guard !uids.isEmpty, uids != countsFor, let api else { return }
        countsFor = uids
        countsTask?.cancel()
        let owner = uid
        countsTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            let counts = try? await api.post(FriendsRequest.function, FriendsRequest.showsTogetherCounts(friendUids: Array(uids)),
                                            as: ShowsTogetherCountsResponse.self)
            guard let self, self.uid == owner else { return }
            if let counts { self.togetherCounts = counts.counts } else { self.countsFor = [] }
        }
    }

    private static func log(_ error: Error, stage: String) {
        Crashlytics.crashlytics().record(error: error, userInfo: ["stage": "FriendsStore \(stage)"])
    }

    // MARK: Actions (each through the server)

    /// Runs `body` with `key` marked busy. Returns the message to show.
    private func act(_ key: String, fallback: String, _ body: (APIClient) async throws(APIError) -> String) async -> String {
        guard let api else { return fallback }
        busy.insert(key)
        defer { busy.remove(key) }
        do {
            return try await body(api)
        } catch {
            return FriendsMessages.failure(error, fallback: fallback)
        }
    }

    /// Finds an account by exact email or handle.
    public func lookup(_ query: FriendSearchQuery) async throws(APIError) -> FriendLookupOutcome {
        guard let api else { throw .offline }
        let response = try await api.post(FriendsRequest.function, query.request, as: FriendLookupResponse.self)
        return FriendLookupOutcome(response, query: query)
    }

    public func sendRequest(to uid: String, name: String) async -> String {
        await act(uid, fallback: "Couldn't send the request. Try again.") { (api: APIClient) throws(APIError) -> String in
            let r = try await api.post(FriendsRequest.function, FriendsRequest.request(toUid: uid), as: FriendRequestResponse.self)
            return FriendsMessages.request(r.result, name: name)
        }
    }

    public func accept(_ request: FriendRequest) async -> String {
        await act(request.id, fallback: "Couldn't accept the request. Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.accept(requestId: request.id), as: JSONValue.self)
            return "You and \(request.fromName ?? "your friend") are now friends."
        }
    }

    public func decline(_ request: FriendRequest) async -> String {
        await act(request.id, fallback: "Couldn't decline the request. Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.decline(requestId: request.id), as: JSONValue.self)
            return "Request declined."
        }
    }

    public func cancel(_ request: FriendRequest) async -> String {
        await act(request.id, fallback: "Couldn't cancel the request. Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.cancel(requestId: request.id), as: JSONValue.self)
            return "Request cancelled."
        }
    }

    public func invite(email: String) async -> String {
        await act(email, fallback: "Couldn't send the invite. Try again.") { (api: APIClient) throws(APIError) -> String in
            let r = try await api.post(FriendsRequest.function, FriendsRequest.invite(email: email), as: InviteResponse.self)
            return FriendsMessages.invite(r.emailed, email: email)
        }
    }

    public func resend(_ invite: Invite) async -> String {
        await act(invite.id, fallback: "Couldn't resend the invite. Try again.") { (api: APIClient) throws(APIError) -> String in
            let r = try await api.post(FriendsRequest.function, FriendsRequest.resendInvite(inviteId: invite.id), as: ResendInviteResponse.self)
            return FriendsMessages.resend(r)
        }
    }

    public func withdraw(_ invite: Invite) async -> String {
        await act(invite.id, fallback: "Couldn't withdraw the invite. Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.cancelInvite(inviteId: invite.id), as: JSONValue.self)
            return "Invite withdrawn."
        }
    }

    public func remove(friendUid: String, name: String) async -> String {
        await act(friendUid, fallback: "Couldn't remove \(name). Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.remove(friendUid: friendUid), as: JSONValue.self)
            return "\(name) was removed from your friends."
        }
    }

    public func block(uid: String, name: String) async -> String {
        await act(uid, fallback: "Couldn't block \(name). Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.block(targetUid: uid), as: JSONValue.self)
            return "\(name) is blocked. You can undo this in Me → Blocked accounts."
        }
    }

    public func unblock(uid: String, name: String) async -> String {
        await act(uid, fallback: "Couldn't unblock \(name). Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.unblock(targetUid: uid), as: JSONValue.self)
            return "\(name) is unblocked."
        }
    }

    /// A profile report, and the block with it if asked. Throws (the sheet
    /// stays open with the reason chosen) if the report didn't go; returns
    /// whether the block did. The report stands if the block fails.
    @discardableResult
    public func report(uid: String, reason: ReportReason, details: String, alsoBlock: Bool) async throws(APIError) -> Bool {
        guard let api else { throw .offline }
        busy.insert(uid)
        defer { busy.remove(uid) }
        let request = ReportContentRequest(contentType: .profile, contentId: uid, reason: reason, details: details)
        _ = try await api.post(ReportContentRequest.function, request, as: JSONValue.self)
        guard alsoBlock else { return false }
        do {
            _ = try await api.post(FriendsRequest.function, FriendsRequest.block(targetUid: uid), as: JSONValue.self)
            return true
        } catch {
            return false
        }
    }

    /// The signed invite link, fetched once per sign-in.
    public func loadReferralLink() async throws(APIError) -> URL {
        if let referralURL { return referralURL }
        guard let api else { throw .offline }
        let r = try await api.post(FriendsRequest.function, FriendsRequest.referralLink, as: ReferralLinkResponse.self)
        guard let url = URL(string: r.url) else { throw .invalidResponse("referralLink: \(r.url)") }
        referralURL = url
        return url
    }

    // MARK: Show social (5.60.29: every write on the server)

    /// Tags friends (and, for a past show, addresses) at one of this
    /// account's shows. The server builds the tag from the stored show.
    public func tag(_ target: FriendsRequest.TagTarget, friendUids: [String], emails: [FriendsRequest.EmailTag] = [],
                    band: String) async throws(APIError) -> String {
        guard let api else { throw .offline }
        let key: String
        switch target { case .show(let id), .upcoming(let id): key = "tag-\(id)" }
        busy.insert(key)
        defer { busy.remove(key) }
        let r = try await api.post(FriendsRequest.function, FriendsRequest.tag(target, friendUids: friendUids, emails: emails),
                                   as: TagFriendsResponse.self)
        if case .upcoming = target { return ShowSocialMessages.tagged(r, band: band, upcoming: true) }
        return ShowSocialMessages.tagged(r, band: band, upcoming: false)
    }

    /// What accepting or declining a tag came to. A past show's tag is
    /// accepted through `normalize-show` (the caller adds it as a show).
    public enum TagAnswer: Equatable, Sendable {
        case done(String)
        /// The upcoming show was added (or credited): open it.
        case addedUpcoming(upcomingId: String, message: String)
        /// Add it through `ShowsStore.addShow` with `.tag(tagId:asPastShow:)`.
        case addAsShow(asPastShow: Bool)
    }

    public func answer(_ tag: ShowTag, accept: Bool) async throws(APIError) -> TagAnswer {
        if accept && !ShowSocialMessages.isUpcoming(tag) { return .addAsShow(asPastShow: false) }
        guard let api else { throw .offline }
        busy.insert(tag.id)
        defer { busy.remove(tag.id) }
        do {
            let r = try await api.post(FriendsRequest.function, FriendsRequest.respondTag(tagId: tag.id, response: accept ? .accepted : .declined),
                                       as: RespondTagResponse.self)
            if accept, let id = r.upcomingId {
                let band = tag.showData.artist.isEmpty ? "The show" : tag.showData.artist
                return .addedUpcoming(upcomingId: id, message: r.duplicate == true
                                      ? "\(band) was already in your upcoming shows. It now says \(tag.fromName) tagged you."
                                      : "\(band) is in your upcoming shows.")
            }
            return .done(accept ? "Added." : "Tag declined.")
        } catch {
            // After the date, an upcoming tag becomes a past show.
            if Self.isDatePassed(error) { return .addAsShow(asPastShow: true) }
            throw error
        }
    }

    /// `respondTag`'s refusal for an upcoming tag whose date has passed.
    nonisolated static func isDatePassed(_ error: APIError) -> Bool {
        if case .server(409, _, "date_passed") = error { return true }
        return false
    }

    public func declineEmailTag(_ tag: PendingEmailTag) async -> String {
        await act(tag.id, fallback: "Couldn't decline that. Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.declineEmailTag(pendingEmailTagId: tag.id), as: JSONValue.self)
            return "Tag declined."
        }
    }

    public func answer(_ suggestion: ShowSuggestion, confirmed: Bool) async -> String {
        await act(suggestion.id, fallback: "Couldn't save your answer. Try again.") { (api: APIClient) throws(APIError) -> String in
            let r = try await api.post(FriendsRequest.function,
                                       FriendsRequest.respondSuggestion(suggestionId: suggestion.id, response: confirmed ? .confirmed : .declined),
                                       as: SuggestionAnswerResponse.self)
            return ShowSocialMessages.suggestionAnswer(r, confirmed: confirmed)
        }
    }

    /// Takes a friend off an upcoming show and back their pending tag.
    public func untag(upcomingId: String, friendUid: String, name: String) async -> String {
        await act("untag-\(upcomingId)-\(friendUid)", fallback: "Couldn't remove \(name). Try again.") { (api: APIClient) throws(APIError) -> String in
            _ = try await api.post(FriendsRequest.function, FriendsRequest.revokeUpcomingTags(upcomingId: upcomingId, toUid: friendUid), as: JSONValue.self)
            return "\(name) was removed."
        }
    }

    /// What each friend said to this account's tags on one upcoming show.
    public func sentTagStatuses(upcomingId: String) async -> [String: String] {
        guard let uid else { return [:] }
        let db = await Database.ready()
        let query = db.collection("showTags").whereField("fromUid", isEqualTo: uid).whereField("upcomingShowId", isEqualTo: upcomingId)
        guard let snap = try? await withDeadline(.seconds(10), { try await query.getDocuments() }) else { return [:] }
        return ShowSocialLists.sentStatuses(snap.documents.map { (toUid: ($0.data()["toUid"] as? String) ?? "", status: ($0.data()["status"] as? String) ?? "") })
    }

    /// Your shows a friend was at too (mutual friends only, on the server).
    public func showsTogether(friendUid: String) async throws(APIError) -> [ShowsTogetherResponse.TogetherShow] {
        guard let api else { throw .offline }
        let r = try await api.post(FriendsRequest.function, FriendsRequest.showsTogether(friendUid: friendUid), as: ShowsTogetherResponse.self)
        return r.shows.sorted { $0.isoDate > $1.isoDate }
    }

    // MARK: Other people's profiles

    /// Someone's public profile fields (name, handle, photo, public page),
    /// readable by any account. nil if there's none (a deleted account).
    public func profile(uid: String) async -> UserProfile? {
        let db = await Database.ready()
        guard let snap = try? await withDeadline(.seconds(10), { try await db.document("userProfiles/\(uid)").getDocument() }),
              snap.exists else { return nil }
        return try? snap.decodeProfile()
    }
}
