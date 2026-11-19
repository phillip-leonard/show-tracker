@preconcurrency import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A file ready for Storage: a type the web can show (storage.rules and
/// the server accept JPEG, PNG, GIF, WebP and MP4), at most 10 MB.
public struct PreparedMedia: Sendable, Identifiable {
    public enum Payload: Sendable {
        case data(Data)
        /// A converted video in the temporary directory.
        case file(URL)
    }

    public let id = UUID()
    public var payload: Payload
    public var contentType: String
    public var fileName: String
    public var size: Int
    public var isVideo: Bool { contentType == "video/mp4" }

    public init(payload: Payload, contentType: String, fileName: String, size: Int) {
        self.payload = payload
        self.contentType = contentType
        self.fileName = fileName
        self.size = size
    }
}

/// Turns what the photo picker hands over into what the web can show
/// (STAGE6-AUDIT §2.3): an iPhone shoots HEIC and HEVC `.mov`, which a
/// browser can't show and the rules refuse.
///
/// - Images become JPEG, at most 3000 px on the long side, turned upright.
///   Re-encoding also drops the photo's metadata, location included: the
///   gallery is seen by everyone at the show. A GIF is kept as it is, so it
///   still moves.
/// - Videos become MP4 (H.264) at 720p, then 540p, then 480p until one is
///   under 10 MB, without location metadata. Too long for 480p is refused
///   with words that say what to do.
public enum MediaPreparation {
    public enum Failure: Error, Equatable, Sendable {
        case unreadable
        case videoTooLong
        case exportFailed

        public var message: String {
            switch self {
            case .unreadable: "That file couldn't be read. Try a different one."
            case .videoTooLong: "That video is over the 10MB limit even made smaller. Trim it in Photos and try again."
            case .exportFailed: "That video couldn't be converted. Try a different one."
            }
        }
    }

    static let maxPixels = 3000

    public static func image(_ data: Data, name: String = "photo") throws(Failure) -> PreparedMedia {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else {
            throw .unreadable
        }
        let type = CGImageSourceGetType(source).map { $0 as String } ?? ""
        let base = baseName(name)
        if type == UTType.gif.identifier, data.count <= MediaLimits.maxFileBytes {
            return PreparedMedia(payload: .data(data), contentType: "image/gif", fileName: "\(base).gif", size: data.count)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw .unreadable }
        for quality in [0.85, 0.7, 0.5] {
            if let jpeg = jpeg(image, quality: quality), jpeg.count <= MediaLimits.maxFileBytes {
                return PreparedMedia(payload: .data(jpeg), contentType: "image/jpeg", fileName: "\(base).jpg", size: jpeg.count)
            }
        }
        throw .unreadable
    }

    static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    static let videoPresets = [AVAssetExportPreset1280x720, AVAssetExportPreset960x540, AVAssetExportPreset640x480]

    /// A picked video file (any container the device plays) as an MP4
    /// under 10 MB.
    public static func video(at url: URL, name: String = "video") async throws(Failure) -> PreparedMedia {
        let asset = AVURLAsset(url: url)
        let base = baseName(name)
        for preset in videoPresets {
            guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { continue }
            session.shouldOptimizeForNetworkUse = true
            session.metadataItemFilter = .forSharing()
            let out = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).mp4")
            do {
                try await session.export(to: out, as: .mp4)
            } catch {
                try? FileManager.default.removeItem(at: out)
                continue
            }
            let size = (try? out.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size > 0, size <= MediaLimits.maxFileBytes {
                return PreparedMedia(payload: .file(out), contentType: "video/mp4", fileName: "\(base).mp4", size: size)
            }
            try? FileManager.default.removeItem(at: out)
            if size == 0 { throw .exportFailed }
        }
        throw .videoTooLong
    }

    /// A file name without its extension or anything Storage would read as
    /// a folder.
    static func baseName(_ name: String) -> String {
        let stem = (name as NSString).deletingPathExtension
            .replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return stem.isEmpty ? "media" : String(stem.prefix(80))
    }
}
