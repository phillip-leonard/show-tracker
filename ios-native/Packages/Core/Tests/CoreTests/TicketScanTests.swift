import Foundation
import Testing
import UIKit
@testable import Core

/// Ticket scan (Part 5): images prepared within lib/aiScan.js's limits, the
/// web's wording for each failure, and the review rules.
@Suite struct TicketScanTests {
    static func image(_ w: CGFloat, _ h: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format).image { ctx in
            // Noise, so the JPEG can't shrink to nothing.
            for i in 0..<400 {
                UIColor(hue: CGFloat(i % 37) / 37, saturation: 0.8, brightness: 0.9, alpha: 1).setFill()
                ctx.fill(CGRect(x: CGFloat((i * 97) % Int(w)), y: CGFloat((i * 53) % Int(h)), width: w / 9, height: h / 13))
            }
        }
    }

    @Test func imagesAreFittedInside1600AndUnder4MB() throws {
        let data = try #require(TicketScan.prepare(Self.image(4032, 3024)))
        let out = try #require(UIImage(data: data))
        #expect(max(out.size.width, out.size.height) <= TicketScan.maxDimension)
        #expect(data.count <= TicketScan.maxImageBytes)
        #expect(data.starts(with: [0xFF, 0xD8]), "JPEG, as the request says")
        let small = try #require(TicketScan.prepare(Self.image(600, 400)))
        #expect(UIImage(data: small)?.size == CGSize(width: 600, height: 400), "a small image isn't enlarged")
    }

    @Test func theWebsWordingForEachFailure() {
        #expect(TicketScan.message(for: .signInRequired(message: "Sign in")) == "Your session has expired. Sign out and back in, then try again.")
        #expect(TicketScan.message(for: .accountRequired(message: "Create a free account to scan tickets.")) == "Create a free account to scan tickets.")
        #expect(TicketScan.message(for: .rateLimited(message: "You've scanned 20 times today. Try again tomorrow.", retryAfter: nil))
                == "You've scanned 20 times today. Try again tomorrow.", "the server's daily-limit sentence")
        #expect(TicketScan.message(for: .rateLimited(message: nil, retryAfter: nil)) == "You\u{2019}ve reached today\u{2019}s limit. Try again tomorrow.")
        #expect(TicketScan.message(for: .offline).hasPrefix("You're offline."))
        #expect(TicketScan.message(for: .server(status: 422, message: nil, code: nil)).hasPrefix("No shows detected"))
        #expect(TicketScan.message(for: .server(status: 502, message: "Couldn't read your tickets right now. Please try again in a few minutes.", code: nil))
                == "Couldn't read your tickets right now. Please try again in a few minutes.")
    }

    @Test func aScannedShowIsPickedOnlyWhenItCanBeAdded() {
        let today = "2026-11-16"
        let full = ScannedShow(.init(artist: " Goose ", venue: "Red Rocks", date: "2026-06-12", city: "Morrison"), today: today)
        #expect(full.selected && full.artist == "Goose" && full.problem(today: today) == nil)
        #expect(ScannedShow(.init(artist: "Goose", venue: "", date: "2026-06-12", city: ""), today: today).problem(today: today) == "Add the venue.")
        let noDate = ScannedShow(.init(artist: "Goose", venue: "Red Rocks", date: "sometime in June", city: ""), today: today)
        #expect(!noDate.selected && noDate.date.isEmpty && noDate.problem(today: today) == "Add the date.")
        #expect(ScannedShow(.init(artist: "Goose", venue: "Red Rocks", date: "2026-12-31", city: ""), today: today).problem(today: today)?
                .hasPrefix("This show hasn't happened yet") == true)
    }

    @Test func aMatchSendsSetlistfmsSetlistOtherwiseTheReviewedFields() throws {
        var show = ScannedShow(artist: "Goose", venue: "Red Rocks Amphitheater", city: "", date: "2026-06-12")
        let raw = JSONValue.object(["id": .string("abc"), "eventDate": .string("12-06-2026")])
        let withMatch = show.input(match: .init(raw: raw))
        guard case .setlistfm(.setlist(let sent), _) = withMatch.kind else { Issue.record("not setlistfm"); return }
        #expect(sent == raw)
        show.venue = "Red Rocks Amphitheatre"
        guard case .manual(let manual, _) = show.input(match: nil).kind else { Issue.record("not manual"); return }
        #expect(manual.artist == "Goose" && manual.venue == "Red Rocks Amphitheatre" && manual.city == nil && manual.date == "2026-06-12")
        #expect(show.input(match: nil).showId != nil, "a minted id, as every outbox add")
    }
}

extension APIClientTests {
    @Test func scanningSendsTheImagesWithTheIDToken() async throws {
        let api = client(answers: [Self.ok(#"{"shows":[{"artist":"Goose","venue":"Red Rocks","date":"2026-06-12","city":"Morrison"},{"artist":"Phish","venue":"MSG","date":"","city":null}]}"#)])
        let found = try await TicketScan(api: api).scan([Data([0xFF, 0xD8, 0xFF]), Data([0xFF, 0xD8, 0x00])])
        #expect(found.map(\.artist) == ["Goose", "Phish"] && found[1].city == "")
        let request = try #require(Stub.requests.first)
        #expect(request.url?.path == "/.netlify/functions/analyze-tickets")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(request.httpBody))
        #expect(body == .object(["images": .array([
            .object(["base64": .string(Data([0xFF, 0xD8, 0xFF]).base64EncodedString()), "mediaType": .string("image/jpeg")]),
            .object(["base64": .string(Data([0xFF, 0xD8, 0x00]).base64EncodedString()), "mediaType": .string("image/jpeg")]),
        ])]))
    }

    @Test func aScanTheServerRefusesIsTyped() async {
        let api = client(answers: [
            Self.status(429, #"{"error":"You've scanned 20 times today. Try again tomorrow.","code":"daily_limit"}"#),
            Self.status(403, #"{"error":"Create a free account to scan tickets.","code":"account_required"}"#),
        ])
        do { _ = try await TicketScan(api: api).scan([Data([1])]); Issue.record("no error") } catch {
            #expect(TicketScan.message(for: error) == "You've scanned 20 times today. Try again tomorrow.")
        }
        do { _ = try await TicketScan(api: api).scan([Data([1])]); Issue.record("no error") } catch {
            #expect(TicketScan.message(for: error) == "Create a free account to scan tickets.")
        }
    }
}
