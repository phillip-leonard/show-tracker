import Foundation

/// The repo's `fixtures/` folder, bundled into CoreTests (Package.swift
/// copies the `Fixtures` symlink).
enum FixtureLoader {
    static var root: URL {
        get throws {
            guard let url = Bundle.module.url(forResource: "Fixtures", withExtension: nil) else {
                throw CocoaError(.fileNoSuchFile, userInfo: [NSLocalizedDescriptionKey: "Fixtures folder missing from the CoreTests bundle"])
            }
            return url
        }
    }

    /// Every `.json` file in `fixtures/<folder>`, sorted by name.
    static func files(in folder: String) throws -> [URL] {
        let dir = try root.appendingPathComponent(folder, isDirectory: true)
        return try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    static func data(_ path: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(path))
    }

    /// The file as plain JSON (dictionaries, arrays, NSNumber, NSNull), for
    /// comparing against what a model decoded.
    static func json(_ url: URL) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] ?? [:]
    }
}
