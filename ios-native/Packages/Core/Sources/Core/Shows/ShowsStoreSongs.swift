import FirebaseFirestore
import Foundation

// Songs and listening (Stage 4, 4-4): the song index read from the shows
// already loaded, and the recording picked for "Listen to this night".
public extension ShowsStore {
    /// Your history with every song (`SongIndex`), from the shows on this
    /// device. Built when first read after the shows change, or on a new day
    /// (the current gap in days counts to today).
    var songIndex: [String: SongIndex.Entry] {
        let today = ShowDate.today()
        // Read `shows` first, so a view reading this redraws when they change.
        let list = shows
        if let cache = songIndexCache, cache.today == today { return cache.index }
        let index = SongIndex.build(list, today: today)
        songIndexCache = (today, index)
        return index
    }

    /// The song a `/songs/?artist=&song=` link or a setlist row names.
    func song(key: String?) -> SongIndex.Entry? {
        guard let key else { return nil }
        return songIndex[key]
    }

    /// Picks the recording "Listen to this night" opens (`archivalAudioPick`,
    /// as the web writes it): one `updateData` of that field only (R-06).
    func pickRecording(_ recordingId: String, showId: String) {
        guard let uid else { return }
        writeProblem = nil
        Task { [weak self] in
            let db = await Database.ready()
            guard self?.uid == uid else { return }
            do {
                try await db.collection("users").document(uid).collection("shows").document(showId)
                    .updateData(["archivalAudioPick": recordingId])
            } catch {
                guard let self, self.uid == uid else { return }
                self.writeProblem = "That change wasn't saved. \(error.localizedDescription)"
                Self.log(error, stage: "archivalAudioPick")
            }
        }
    }
}
