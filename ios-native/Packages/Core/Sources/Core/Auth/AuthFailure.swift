import FirebaseAuth
import Foundation

/// A sign-in, link or account error, in words a person can act on.
public enum AuthFailure: Error, Equatable, Sendable {
    case cancelled
    case wrongCredentials
    case emailInUse
    case weakPassword
    case invalidEmail
    /// Linking a guest to a credential that already belongs to an account
    /// (D-4): sign in to that account and bring the guest's shows along.
    case credentialInUse
    case recentLoginRequired
    case accountDisabled
    case tooManyAttempts
    case offline
    case other(String)

    public var message: String? {
        switch self {
        case .cancelled: return nil
        case .wrongCredentials: return "That email and password don't match an account."
        case .emailInUse: return "An account already uses that email. Sign in instead."
        case .weakPassword: return "Choose a password with at least 6 characters."
        case .invalidEmail: return "That doesn't look like an email address."
        case .credentialInUse: return "That sign-in already belongs to a MySetlists account."
        case .recentLoginRequired: return "Please sign in again, then try once more."
        case .accountDisabled: return "This account has been disabled."
        case .tooManyAttempts: return "Too many attempts. Wait a moment and try again."
        case .offline: return "You're offline. Try again when you're connected."
        case .other(let m): return m
        }
    }

    public static func from(_ error: Error) -> AuthFailure {
        if let apple = error as? AppleSignInError {
            if case .failed(let m) = apple { return .other(m) }
            return .cancelled
        }
        if let failure = error as? AuthFailure { return failure }
        let ns = error as NSError
        if ns.domain == "com.google.GIDSignIn", ns.code == -5 { return .cancelled } // kGIDSignInErrorCodeCanceled
        guard ns.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: ns.code) else {
            return .other(ns.localizedDescription)
        }
        switch code {
        case .wrongPassword, .userNotFound, .invalidCredential: return .wrongCredentials
        case .emailAlreadyInUse: return .emailInUse
        case .weakPassword: return .weakPassword
        case .invalidEmail: return .invalidEmail
        case .credentialAlreadyInUse, .providerAlreadyLinked, .accountExistsWithDifferentCredential: return .credentialInUse
        case .requiresRecentLogin: return .recentLoginRequired
        case .userDisabled: return .accountDisabled
        case .tooManyRequests: return .tooManyAttempts
        case .networkError: return .offline
        case .webContextCancelled: return .cancelled
        default: return .other(ns.localizedDescription)
        }
    }
}
