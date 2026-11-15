import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import FirebaseMessaging
import Foundation
import GoogleSignIn
import Observation
import UIKit

/// Who is signed in, what gate applies, and every way in and out:
/// Apple, Google, email, a guest (Firebase anonymous auth), linking a guest
/// to a credential, password reset, sign-out and account deletion.
///
/// The decisions behind it are docs/ios-native/DECISIONS.md ("Guests") and
/// SCOPING §3.4 / Part 5: terms agreed before any provider, the suspended
/// screen ahead of the terms gate, sign-out that can never hang, deletion
/// that revokes Apple's tokens and is always reachable.
@MainActor
@Observable
public final class SessionStore {
    public struct User: Equatable, Sendable {
        public let uid: String
        public let isAnonymous: Bool
        public let email: String?
        public let displayName: String?
        public let providerIDs: [String]
        public let creationDate: Date?

        public var isApple: Bool { providerIDs.contains("apple.com") }
    }

    /// `nil` until Firebase has said whether anyone is signed in.
    public private(set) var signedIn: Bool?
    public private(set) var user: User?
    public private(set) var profile: UserProfile?
    public private(set) var profileState: AccountGate.ProfileState = .unknown
    public private(set) var appConfig: AppConfig?
    /// A guest linking a credential that already has an account (D-4).
    public private(set) var adoption: GuestAdoption?

    /// The "I agree" box on the sign-in screen. Every provider, the guest
    /// button included, is disabled until it's ticked (Guideline 1.2).
    public var termsTicked = false

    /// Ticked and signed in on this device; recorded on the profile.
    private var acceptedOnThisDevice = false
    private var pendingName: String?
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var profileListener: ListenerRegistration?
    private var foregroundObserver: NSObjectProtocol?

    public let api: APIClient
    public let appVersion: String

    public init(api: APIClient = APIClient(tokens: FirebaseIDTokens()), appVersion: String = AppInfo.current.version) {
        self.api = api
        self.appVersion = appVersion
    }

    public var versionStatus: AppVersion.Status { AppVersion.status(current: appVersion, config: appConfig) }

    public var gate: AccountGate {
        AccountGate.compute(signedIn: signedIn, profile: profileState, acceptedOnThisDevice: acceptedOnThisDevice, version: versionStatus)
    }

    // MARK: - Start

    /// Call once, after `AppBootstrap.configureFirebase()`.
    public func start() {
        guard authHandle == nil else { return }
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, firebaseUser in
            MainActor.assumeIsolated { self?.apply(firebaseUser) }
        }
        Task { await refreshConfig() }
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { Task { await self?.refreshConfig() } }
        }
    }

    /// `config/app`, read at launch and on every return to the foreground,
    /// as the Capacitor app does. Unreadable means "no gate".
    public func refreshConfig() async {
        do {
            appConfig = try await Database.ready().document("config/app").getDocument().data(as: AppConfig.self)
        } catch {
            // Offline or missing: keep what we had.
        }
    }

    private func apply(_ firebaseUser: FirebaseAuth.User?) {
        guard let firebaseUser else {
            stopListening()
            user = nil
            profile = nil
            profileState = .unknown
            signedIn = false
            return
        }
        let next = User(
            uid: firebaseUser.uid,
            isAnonymous: firebaseUser.isAnonymous,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            providerIDs: firebaseUser.providerData.map(\.providerID),
            creationDate: firebaseUser.metadata.creationDate
        )
        let switched = next.uid != user?.uid
        user = next
        signedIn = true
        if switched {
            profileState = .unknown
            listenToProfile(uid: next.uid)
            if !next.isAnonymous { Task { await afterAccountSignIn() } }
        }
    }

    private func listenToProfile(uid: String) {
        stopListening()
        // After a reset in flight (a sign-in straight after a sign-out).
        Task {
            let db = await Database.ready()
            guard user?.uid == uid, profileListener == nil else { return }
            attachProfileListener(db, uid: uid)
        }
    }

    private func attachProfileListener(_ db: Firestore, uid: String) {
        var first = true
        profileListener = db.document("userProfiles/\(uid)").addSnapshotListener { [weak self] snapshot, error in
            MainActor.assumeIsolated {
                guard let self, self.user?.uid == uid else { return }
                if error != nil {
                    self.profileState = .unreadable
                    return
                }
                guard let snapshot, snapshot.exists, let profile = try? snapshot.decodeProfile() else {
                    self.profile = nil
                    self.profileState = .missing
                    if first { first = false; Task { await self.prepareProfile(existing: nil) } }
                    return
                }
                self.profile = profile
                self.profileState = .loaded(banned: profile.banned, termsAcceptedVersion: profile.termsAcceptedVersion)
                if first { first = false; Task { await self.prepareProfile(existing: profile) } }
            }
        }
    }

    /// The first time a session sees its profile: stamp `createdAt` from the
    /// Auth account (as the web's ensureProfileCreatedAt), record a terms
    /// tick from the sign-in screen, and set a display name the provider gave.
    private func prepareProfile(existing: UserProfile?) async {
        guard let user else { return }
        var fields: [String: Any] = [:]
        if existing?.createdAt == nil, let created = user.creationDate { fields["createdAt"] = Timestamp(date: created) }
        if acceptedOnThisDevice, (existing?.termsAcceptedVersion ?? 0) < Terms.version {
            fields["termsAcceptedVersion"] = Terms.version
            fields["termsAcceptedAt"] = FieldValue.serverTimestamp()
        }
        if !fields.isEmpty {
            try? await Database.ready().document("userProfiles/\(user.uid)").setData(fields, merge: true)
        }
        if existing?.displayName == nil, !user.isAnonymous {
            await adoptDisplayName(pendingName ?? user.displayName)
        }
    }

    /// A name from Apple (first authorization only) or Google, set through
    /// `moderate-content` so it passes the content filter. A name that fails
    /// is dropped, not an error: the person is signed in and can set one in
    /// Me (lib/native-auth.js adoptAppleDisplayName).
    private func adoptDisplayName(_ name: String?) async {
        guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return }
        pendingName = nil
        if let current = Auth.auth().currentUser, current.displayName == nil {
            let change = current.createProfileChangeRequest()
            change.displayName = name
            try? await change.commitChanges()
        }
        try? await api.post(ProfileNameRequest.function, ProfileNameRequest(displayName: name))
    }

    /// What the web runs on every account sign-in: claim an invite sent to
    /// this address, and follow a referral link this device opened.
    /// Best-effort; the session doesn't wait on it.
    private func afterAccountSignIn() async {
        _ = try? await api.post(FriendsRequest.function, FriendsRequest.claimInvites, as: JSONValue.self)
        if let ref = Referral.take() {
            _ = try? await api.post(FriendsRequest.function, FriendsRequest.referral(ref: ref), as: JSONValue.self)
        }
    }

    /// A referral link (D-6) opened while signed in to an account is used at
    /// once, as the web does whenever an account session is present
    /// (AppContext). Signed out or a guest, it waits for the next account
    /// sign-in or the guest's upgrade (`afterAccountSignIn`, `upgrade`).
    public func useReferralIfSignedIn() async {
        guard let user, !user.isAnonymous, let ref = Referral.take() else { return }
        _ = try? await api.post(FriendsRequest.function, FriendsRequest.referral(ref: ref), as: JSONValue.self)
    }

    // MARK: - Terms

    /// The gate's "I agree", for an account that hasn't accepted this version.
    public func acceptTerms() async throws {
        guard let uid = user?.uid else { return }
        acceptedOnThisDevice = true
        try await Database.ready().document("userProfiles/\(uid)").setData([
            "termsAcceptedVersion": Terms.version,
            "termsAcceptedAt": FieldValue.serverTimestamp(),
        ], merge: true)
    }

    private func requireTerms() throws(AuthFailure) {
        // A guest agreed when they started; upgrading doesn't ask again.
        if Auth.auth().currentUser?.isAnonymous == true { return }
        guard termsTicked else { throw .other("Please agree to the Terms of Service first.") }
        acceptedOnThisDevice = true
    }

    // MARK: - Sign in

    public func signInWithApple() async throws(AuthFailure) {
        try requireTerms()
        let apple: AppleSignInResult
        do { apple = try await AppleSignIn().authorize() } catch { throw AuthFailure.from(error) }
        pendingName = apple.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
        let credential = OAuthProvider.appleCredential(withIDToken: apple.idToken, rawNonce: apple.rawNonce, fullName: apple.fullName)
        try await signInOrUpgrade(with: credential)
    }

    public func signInWithGoogle() async throws(AuthFailure) {
        try requireTerms()
        let credential = try await googleCredential()
        try await signInOrUpgrade(with: credential)
    }

    public func signIn(email: String, password: String) async throws(AuthFailure) {
        try requireTerms()
        do { _ = try await Auth.auth().signIn(withEmail: email.trimmingCharacters(in: .whitespaces), password: password) } catch { throw AuthFailure.from(error) }
    }

    /// A new email account, or, for a guest, their guest account with an
    /// email and password added (same uid, so their shows stay).
    public func createAccount(email: String, password: String) async throws(AuthFailure) {
        try requireTerms()
        let address = email.trimmingCharacters(in: .whitespaces)
        if Auth.auth().currentUser?.isAnonymous == true {
            try await upgrade(with: EmailAuthProvider.credential(withEmail: address, password: password))
            return
        }
        do { _ = try await Auth.auth().createUser(withEmail: address, password: password) } catch { throw AuthFailure.from(error) }
    }

    /// "Continue as guest": Firebase anonymous auth. The guest's shows live in
    /// Firestore from the first one; ticket scanning, friends and anything
    /// other people see need an account.
    public func continueAsGuest() async throws(AuthFailure) {
        try requireTerms()
        do { _ = try await Auth.auth().signInAnonymously() } catch { throw AuthFailure.from(error) }
    }

    /// "Forgot password": `send-password-reset` sends the link (or, for an
    /// Apple or Google account, how to sign in). Always succeeds unless the
    /// request itself fails, so it can't reveal which addresses have accounts.
    public func sendPasswordReset(email: String) async throws(APIError) {
        try await api.post(PasswordResetRequest.function, PasswordResetRequest(email: email.trimmingCharacters(in: .whitespaces)), auth: .none)
    }

    private func signInOrUpgrade(with credential: AuthCredential) async throws(AuthFailure) {
        if Auth.auth().currentUser?.isAnonymous == true {
            try await upgrade(with: credential)
        } else {
            do { _ = try await Auth.auth().signIn(with: credential) } catch { throw AuthFailure.from(error) }
        }
    }

    private func googleCredential() async throws(AuthFailure) -> AuthCredential {
        guard let clientID = FirebaseApp.app()?.options.clientID, let presenter = Presenter.topViewController else {
            throw .other("Google sign-in isn't available right now.")
        }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let idToken = result.user.idToken?.tokenString else { throw AuthFailure.other("Google returned no identity token.") }
            if pendingName == nil { pendingName = result.user.profile?.name }
            return GoogleAuthProvider.credential(withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
        } catch {
            throw AuthFailure.from(error)
        }
    }

    // MARK: - Guests: upgrade

    /// A guest links Apple, Google or email to their anonymous account. Same
    /// uid, so shows, profile and stats stay. Firebase's state listener
    /// doesn't fire on a link, so this refreshes the session itself and asks
    /// `account-linked` for what a new sign-up gets (invites, referral,
    /// welcome email, ranked stats).
    ///
    /// When the credential already belongs to an account, this sets
    /// `adoption` and throws `.credentialInUse`: the UI offers to sign in to
    /// that account and bring the guest's shows (`adoptGuestShows`).
    public func upgrade(with credential: AuthCredential) async throws(AuthFailure) {
        guard let guest = Auth.auth().currentUser, guest.isAnonymous else { throw .other("Not a guest session.") }
        let guestToken = try? await guest.getIDToken()
        do {
            let result = try await guest.link(with: credential)
            _ = try? await result.user.getIDTokenResult(forcingRefresh: true)
            try? await result.user.reload()
            apply(Auth.auth().currentUser) // same uid: now an account, with its new provider
            _ = try? await api.post(AccountLinkedRequest.function, AccountLinkedRequest(ref: Referral.take()), as: AccountLinkedResponse.self)
            await adoptDisplayName(pendingName ?? Auth.auth().currentUser?.displayName)
        } catch {
            let failure = AuthFailure.from(error)
            guard failure == .credentialInUse || failure == .emailInUse else { throw failure }
            let ns = error as NSError
            let signInCredential = (ns.userInfo[AuthErrorUserInfoUpdatedCredentialKey] as? AuthCredential) ?? credential
            adoption = GuestAdoption(guestIdToken: guestToken, credential: signInCredential)
            throw .credentialInUse
        }
    }

    /// Step 2 of the credential-in-use case: sign in to the existing account,
    /// then ask the server what moving the guest's shows would do. Nothing
    /// moves yet.
    public func startAdoption() async throws(AuthFailure) {
        guard var adoption else { return }
        guard let guestIdToken = adoption.guestIdToken else {
            self.adoption = nil
            throw .other("The guest session ended before its shows could be moved.")
        }
        do { _ = try await Auth.auth().signIn(with: adoption.credential) } catch { throw AuthFailure.from(error) }
        do {
            adoption.preview = try await api.post(AdoptGuestShowsRequest.function,
                                                  AdoptGuestShowsRequest(mode: .preview, guestIdToken: guestIdToken),
                                                  as: AdoptGuestShowsPreview.self)
            self.adoption = adoption
        } catch {
            self.adoption = nil
            throw .other(error.message ?? "Your guest shows couldn't be found.")
        }
    }

    /// Step 3: move them, with the `possible` matches the user picked. The
    /// server then deletes the guest account. `adoption` stays set so the
    /// sheet can show the result; `cancelAdoption()` closes it. A retry is
    /// safe: moved shows come back as duplicates.
    public func commitAdoption(includePossible: [String]) async throws(AuthFailure) -> AdoptGuestShowsResult? {
        guard let guestIdToken = adoption?.guestIdToken else { return nil }
        do {
            return try await api.post(AdoptGuestShowsRequest.function,
                                      AdoptGuestShowsRequest(mode: .commit, guestIdToken: guestIdToken, includePossible: includePossible),
                                      as: AdoptGuestShowsResult.self)
        } catch {
            throw .other(error.message ?? "Your guest shows couldn't be moved.")
        }
    }

    public func cancelAdoption() { adoption = nil }

    // MARK: - Sign out and delete

    /// Never hangs (`SignOutRunner`): what needs the session first (the push
    /// token's document, writes still on their way), then Firebase, the
    /// offline cache, Google, and local state.
    ///
    /// The cache step runs after Firebase's sign-out and before anyone can
    /// sign in again (`Database.ready()` waits for it): the next person on
    /// this device starts from an empty cache.
    @discardableResult
    public func signOut() async -> [(String, SignOutRunner.Outcome)] {
        let steps: [SignOutRunner.Step] = [
            .init("push token") { @MainActor in
                let token = try await Messaging.messaging().token()
                try await Database.ready().document("pushTokens/\(token)").delete()
            },
            // Offline, this times out and those writes go with the cache:
            // they would fail under the next account anyway.
            .init("pending writes") { @MainActor in try await Database.ready().waitForPendingWrites() },
            .init("firebase") { @MainActor in try Auth.auth().signOut() },
            .init("offline cache") { @MainActor [weak self] in
                self?.stopListening()
                let reset = await Database.clearCache()
                if let failure = reset.failure { throw CacheResetFailed(message: failure) }
            },
            .init("google") { @MainActor in GIDSignIn.sharedInstance.signOut() },
            .init("local") { @MainActor [weak self] in self?.resetLocalState() },
        ]
        return await SignOutRunner().run(steps)
    }

    struct CacheResetFailed: Error, CustomStringConvertible { let message: String; var description: String { message } }

    /// Deletes the account and all its data (`delete-account`, Guideline
    /// 5.1.1(v)), then signs out. An Apple account confirms with Apple first,
    /// so the server can revoke Apple's tokens (B-11); backing out of Apple's
    /// sheet cancels the deletion, and anything else Apple does wrong doesn't
    /// stop it.
    public func deleteAccount() async throws(AuthFailure) {
        guard let user else { return }
        var code: String?
        if user.isApple {
            do {
                let apple = try await AppleSignIn().authorize(wantsName: false)
                let accountAppleID = Auth.auth().currentUser?.providerData.first { $0.providerID == "apple.com" }?.uid
                // The sheet signs in whichever Apple ID the device has; its
                // code is only ours to revoke if it's this account's.
                if accountAppleID == nil || accountAppleID == apple.appleUserID { code = apple.authorizationCode }
            } catch AppleSignInError.cancelled {
                throw .cancelled
            } catch {
                code = nil
            }
        }
        do {
            try await api.post(DeleteAccountRequest.function, DeleteAccountRequest(appleAuthorizationCode: code))
        } catch {
            throw .other(error.message ?? "Your account couldn't be deleted. Please try again.")
        }
        await signOut()
    }

    private func resetLocalState() {
        stopListening()
        termsTicked = false
        acceptedOnThisDevice = false
        pendingName = nil
        adoption = nil
        profile = nil
        profileState = .unknown
    }

    private func stopListening() {
        profileListener?.remove()
        profileListener = nil
    }
}

/// The credential-in-use path (D-4), between "that sign-in already has an
/// account" and the shows having moved.
public struct GuestAdoption {
    /// Kept before switching accounts: proof the person holds the guest
    /// account. Valid for about an hour.
    public let guestIdToken: String?
    let credential: AuthCredential
    public var preview: AdoptGuestShowsPreview?
}

/// A referral from a `/?ref=` link (D-6), kept until the next account
/// sign-in or link uses it.
public enum Referral {
    private static let key = "pendingReferral"

    public static func remember(_ ref: String) {
        UserDefaults.standard.set(String(ref.prefix(2000)), forKey: key)
    }

    static func take() -> String? {
        let ref = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        return ref
    }
}

/// The signed-in user's ID token, for `APIClient`.
public struct FirebaseIDTokens: IDTokenProvider {
    public init() {}
    public func idToken(forceRefresh: Bool) async throws -> String? {
        try await Self.token(forceRefresh: forceRefresh)
    }

    @MainActor
    private static func token(forceRefresh: Bool) async throws -> String? {
        guard let user = Auth.auth().currentUser else { return nil }
        return try await user.getIDTokenResult(forcingRefresh: forceRefresh).token
    }
}
