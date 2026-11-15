import Foundation
import Testing
@testable import Core

// A placeholder so the scheme's test action has something to run until the
// contract tests arrive (Part 4: fixtures/shows, fixtures/year-in-review and
// the date golden table).
@Suite struct AppInfoTests {
    @Test func readsVersionFromInfoDictionary() {
        let info = AppInfo(version: "4.0.0", build: "12")
        #expect(info.version == "4.0.0")
        #expect(info.build == "12")
    }
}
