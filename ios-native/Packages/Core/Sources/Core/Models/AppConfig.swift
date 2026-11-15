import Foundation

/// `config/app`: readable by anyone, written by the admin (Admin → App versions).
///
/// The version fields were written for the Capacitor app (3.x). A native
/// 4.x build compares above any 3.x value, so a minimum meant for Capacitor
/// never locks native builds out; native-only minimums need their own keys
/// when they're wanted (and a rules change: the document is `hasOnly`).
public struct AppConfig: Decodable, Hashable, Sendable {
    public var minSupportedIosVersion: String?
    public var latestIosVersion: String?
    public var reason: String?
    public var iosPushOfferEnabled: Bool?
    public var updatedAt: Date?

    enum CodingKeys: String, CodingKey { case minSupportedIosVersion, latestIosVersion, reason, iosPushOfferEnabled, updatedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        minSupportedIosVersion = try c.optionalText(.minSupportedIosVersion)
        latestIosVersion = try c.optionalText(.latestIosVersion)
        reason = try c.optionalText(.reason)
        iosPushOfferEnabled = try c.flag(.iosPushOfferEnabled)
        updatedAt = try c.moment(.updatedAt)
    }
}
