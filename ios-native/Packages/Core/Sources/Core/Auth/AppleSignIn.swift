import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Sign in with Apple, for sign-in, linking and account deletion.
///
/// Firebase needs the raw nonce whose SHA-256 went to Apple (lib/native-auth.js:
/// a missing nonce is "auth/missing-or-invalid-nonce"). Apple returns the
/// user's name only on the very first authorization, so it comes back here
/// for the caller to keep. The one-time authorization code is what
/// `delete-account` revokes Apple's tokens with (B-11).
public struct AppleSignInResult: Sendable {
    public let idToken: String
    public let rawNonce: String
    public let authorizationCode: String?
    /// "Given Family", only on the first authorization; the user can edit it
    /// in Apple's sheet, so it is user-supplied text like any other.
    public let fullName: PersonNameComponents?
    /// Apple's user id (`sub`), to check a deletion re-authorization is the same Apple ID.
    public let appleUserID: String
}

public enum AppleSignInError: Error, Equatable, Sendable {
    case cancelled
    case failed(String)
}

@MainActor
public final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<AppleSignInResult, Error>?
    private var rawNonce = ""

    public override init() {}

    /// Shows Apple's sheet. `wantsName` asks for name and email (sign-in);
    /// deletion asks for nothing.
    public func authorize(wantsName: Bool = true) async throws -> AppleSignInResult {
        rawNonce = AppleNonce.random()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = wantsName ? [.fullName, .email] : []
        request.nonce = AppleNonce.sha256(rawNonce)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        Presenter.keyWindow ?? ASPresentationAnchor()
    }

    nonisolated public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated {
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken, let idToken = String(data: tokenData, encoding: .utf8) else {
                finish(.failure(AppleSignInError.failed("Apple returned no identity token")))
                return
            }
            let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
            let name = credential.fullName.flatMap { ($0.givenName ?? $0.familyName) == nil ? nil : $0 }
            finish(.success(AppleSignInResult(idToken: idToken, rawNonce: rawNonce, authorizationCode: code, fullName: name, appleUserID: credential.user)))
        }
    }

    nonisolated public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated {
            let code = (error as? ASAuthorizationError)?.code
            finish(.failure(code == .canceled ? AppleSignInError.cancelled : AppleSignInError.failed(error.localizedDescription)))
        }
    }

    private func finish(_ result: Result<AppleSignInResult, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

public enum AppleNonce {
    /// A random nonce of URL-safe characters.
    public static func random(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var generator = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in charset.randomElement(using: &generator)! })
    }

    /// Lowercase hex SHA-256, as Apple's request expects.
    public static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// The `sub` of a JWT, read without verifying it (only to compare Apple IDs).
    public static func jwtSubject(_ jwt: String) -> String? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        guard let data = Data(base64Encoded: b64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["sub"] as? String
    }
}

/// Where sheets are presented from.
@MainActor
public enum Presenter {
    public static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
    }

    public static var topViewController: UIViewController? {
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
