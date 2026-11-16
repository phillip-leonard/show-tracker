import Foundation
import Testing
@testable import Core

/// Me's settings (Stage 2, Part 3): what's checked before sending, the
/// email switches as the web shows them, the data request email, and the
/// server calls' bodies and refusals.
@Suite struct ProfileSettingsTests {
    @Test func namesAreCheckedLikeTheServer() {
        #expect(ProfileSettings.nameProblem("") == "Please enter your name.")
        #expect(ProfileSettings.nameProblem(String(repeating: "a", count: 121)) == "Names are limited to 120 characters.")
        #expect(ProfileSettings.nameProblem("Phillip") == nil)
    }

    @Test func aPhotoIsAWebAddressOrNothing() {
        #expect(ProfileSettings.photoProblem("") == nil, "empty clears it")
        #expect(ProfileSettings.photoProblem("https://example.com/me.jpg") == nil)
        #expect(ProfileSettings.photoProblem("http://example.com/me.jpg") == nil)
        #expect(ProfileSettings.photoProblem("me.jpg") != nil)
        #expect(ProfileSettings.photoProblem("javascript:alert(1)") != nil)
        #expect(ProfileSettings.photoProblem("ftp://example.com/me.jpg") != nil)
    }

    @Test func emailSwitchesReadAsTheWebShowsThem() throws {
        let all = try JSONDecoder().decode(ProfileSettings.EmailPreferences.self, from: Data(#"{"emailOptOut":false,"announcementsOptOut":false}"#.utf8))
        #expect(all.allEmails && all.announcements)
        let noNews = ProfileSettings.EmailPreferences(emailOptOut: false, announcementsOptOut: true)
        #expect(noNews.allEmails && !noNews.announcements)
        let none = ProfileSettings.EmailPreferences(emailOptOut: true, announcementsOptOut: false)
        #expect(!none.allEmails && !none.announcements, "all off shows announcements off too")
        let missing = try JSONDecoder().decode(ProfileSettings.EmailPreferences.self, from: Data("{}".utf8))
        #expect(missing.allEmails)
    }

    @Test func aDataRequestIsADraftToSupport() throws {
        let url = ProfileSettings.dataRequestEmail(email: "me@example.com", uid: "u1")
        #expect(url.scheme == "mailto")
        let parts = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(parts.path == "support@mysetlists.net")
        let items = Dictionary(uniqueKeysWithValues: (parts.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(items["subject"] == "Request a copy of my MySetlists data")
        #expect(items["body"]?.contains("Account: me@example.com") == true)
        #expect(items["body"]?.contains("User ID: u1") == true)
    }

    @Test func eachSettingWritesOneField() {
        #expect(ProfileSettings.Field.photoURL("https://x/y.jpg").data as? [String: String] == ["photoURL": "https://x/y.jpg"])
        #expect(ProfileSettings.Field.publicProfile(true).data as? [String: Bool] == ["publicProfile": true])
        #expect(ProfileSettings.Field.showOnLeaderboard(false).data as? [String: Bool] == ["showOnLeaderboard": false])
    }

    @Test func thePublicPageIsTheWebsAddress() {
        #expect(ProfileSettings.publicProfileURL(handle: "Phil_L")?.absoluteString == "https://mysetlists.net/u/phil_l/")
    }

    @Test func refusalsBecomeWords() {
        #expect(ProfileSettingError(.offline).message == "You're offline. Connect and try again.")
        #expect(ProfileSettingError(.accountRequired(message: "Create an account to post.")) == .accountRequired)
        #expect(ProfileSettingError(.server(status: 409, message: "That handle is already taken.", code: nil)).message == "That handle is already taken.")
    }
}

extension APIClientTests {
    @Test func aHandleIsClaimedThroughModerateContent() async throws {
        let api = client(answers: [Self.ok(#"{"handle":"Phil_L","handleLower":"phil_l"}"#)])
        let handle = try await ProfileSettings(api: api).claimHandle("  Phil_L ")
        #expect(handle == "Phil_L")
        let request = try #require(Stub.requests.first)
        #expect(request.url?.path == "/.netlify/functions/moderate-content")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(request.httpBody))
        #expect(body == .object(["target": .string("handle"), "handle": .string("Phil_L")]))
    }

    @Test func aTakenHandleSaysSo() async {
        let api = client(answers: [Self.status(409, #"{"error":"That handle is already taken."}"#)])
        do { _ = try await ProfileSettings(api: api).claimHandle("taken"); Issue.record("no error") } catch {
            #expect(error.message == "That handle is already taken.")
        }
    }

    @Test func aNameGoesThroughTheFilter() async throws {
        let api = client(answers: [Self.ok(#"{"displayName":"Phillip L"}"#), Self.status(422, #"{"error":"That name isn't allowed.","code":"profanity"}"#)])
        #expect(try await ProfileSettings(api: api).setDisplayName(" Phillip L ") == "Phillip L")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(Stub.requests.first?.httpBody))
        #expect(body == .object(["target": .string("profileName"), "displayName": .string("Phillip L")]))
        do { _ = try await ProfileSettings(api: api).setDisplayName("bad"); Issue.record("no error") } catch {
            #expect(error.message == "That name isn't allowed.")
        }
    }

    @Test func emailSwitchesUseTheFunction() async throws {
        let api = client(answers: [
            Self.ok(#"{"emailOptOut":false,"announcementsOptOut":true}"#),
            Self.ok(#"{"success":true,"emailOptOut":true,"announcementsOptOut":true}"#),
        ])
        let settings = ProfileSettings(api: api)
        let prefs = try await settings.emailPreferences()
        #expect(prefs.allEmails && !prefs.announcements)
        let after = try await settings.setAllEmails(false)
        #expect(!after.allEmails)
        #expect(Stub.requests.first?.httpMethod == "GET")
        #expect(Stub.requests.first?.url?.path == "/.netlify/functions/update-email-preferences")
        let post = try #require(Stub.requests.last)
        #expect(post.httpMethod == "POST")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(post.httpBody))
        #expect(body == .object(["emailOptOut": .bool(true)]))
    }
}
