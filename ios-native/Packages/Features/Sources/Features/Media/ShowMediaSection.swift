@preconcurrency import AVFoundation
import Core
import DesignSystem
import SwiftUI

// Photos, videos, posters and setlist photos on the show page (Stage 6,
// 6-4; the web's ShowMediaSection): one listener for the concert, three
// galleries. Everyone who logged the night shares them. Upload with a
// caption, open full screen with zoom, like, report anyone else's, delete
// your own; uploads from people you blocked never show. Guests see one
// prompt instead (D-1).

struct ShowMediaSection: View {
    @Environment(SessionStore.self) private var session
    let show: Show
    @State private var upgrading = false

    var body: some View {
        if let user = session.user, !user.isAnonymous {
            ShowMediaGalleries(show: show, uid: user.uid, api: session.api)
                .id(ConcertKeys.concertKey(show))
        } else {
            VStack(alignment: .leading, spacing: Space.x3) {
                MediaTitle(category: .photo, count: nil)
                Text("Photos, videos, posters and setlist photos from everyone at this show are for accounts.")
                    .font(.brand(.sm))
                    .foregroundStyle(.secondary)
                Button("Create an account to see photos") { upgrading = true }
                    .buttonStyle(.bordered)
                    .tint(.brand)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .brandCard(radius: Radius.xl2)
            .sheet(isPresented: $upgrading) { GuestUpgradeView() }
        }
    }
}

extension ShowMedia.Category {
    var title: String {
        switch self {
        case .photo: "Photos & Videos"
        case .poster: "Posters"
        case .setlist: "Setlist Photos"
        }
    }

    var systemImage: String {
        switch self {
        case .photo: "camera"
        case .poster: "photo.artframe"
        case .setlist: "list.bullet.rectangle.portrait"
        }
    }

    var addLabel: String { self == .photo ? "Add Photos" : "Add \(title)" }

    var emptyText: String {
        switch self {
        case .photo: "No photos or videos yet. Be the first to share one from this show."
        case .poster: "No posters yet. Add the show announcement or gig poster if you have one."
        case .setlist: "No setlist photos yet. Add a photo of the paper or board setlist if you have one."
        }
    }
}

private struct MediaTitle: View {
    let category: ShowMedia.Category
    let count: Int?
    var body: some View {
        HStack(spacing: Space.x2) {
            Label(category.title, systemImage: category.systemImage)
                .font(.jakarta(size: 16, weight: .bold, relativeTo: .headline))
                .foregroundStyle(Color.textPrimary)
                .labelStyle(TintedIconLabel())
            if let count, count > 0 {
                Text("\(count)")
                    .font(.jakarta(size: 12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(Color.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// What the viewer is showing: one gallery, in the order it was opened.
struct MediaViewerState: Identifiable {
    let id = UUID()
    let items: [ShowMedia]
    var index: Int
}

private struct ShowMediaGalleries: View {
    @Environment(FriendsStore.self) private var friends
    let show: Show
    @State private var store: ShowMediaStore
    @State private var sorts: [ShowMedia.Category: MediaGallery.Sort] = [:]
    @State private var viewing: MediaViewerState?
    @State private var adding: ShowMedia.Category?
    @State private var reporting: ShowMedia?
    @State private var person: PersonRef?
    @State private var deleting: ShowMedia?
    @State private var notice: (text: String, error: Bool)?

    init(show: Show, uid: String, api: APIClient?) {
        self.show = show
        _store = State(initialValue: ShowMediaStore(concertKey: ConcertKeys.concertKey(show), uid: uid, api: api))
    }

    var body: some View {
        let gallery = store.gallery(hiding: Set(friends.blockedUids))
        VStack(spacing: Space.x4) {
            ForEach(ShowMedia.Category.allCases, id: \.self) { category in
                let sort = sorts[category] ?? .newest
                let items = gallery.items(category, sort: sort)
                MediaGalleryCard(
                    category: category, items: items, state: store.state,
                    sort: Binding(get: { sort }, set: { sorts[category] = $0 }),
                    onAdd: { adding = category },
                    onOpen: { index in viewing = MediaViewerState(items: items, index: index) })
            }
            if let notice {
                Text(notice.text).font(.brand(.sm)).foregroundStyle(notice.error ? Color.amber : Color.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .fullScreenCover(item: $viewing) { state in
            MediaViewer(state: state, uid: store.uid, showsConcert: false,
                        live: { id in store.gallery(hiding: Set(friends.blockedUids)).items.first { $0.id == id } },
                        busy: store.busy,
                        onLike: { item in await store.toggleLike(item) },
                        onDelete: { deleting = $0 },
                        onReport: { reporting = $0 },
                        onPerson: { person = PersonRef(uid: $0.uploadedBy, name: $0.uploaderName) })
                .sheet(item: $reporting) { item in
                    ReportContentSheet(title: "Report \(MediaThumbnail.noun(item))") { reason, details throws(APIError) in
                        try await store.report(item, reason: reason, details: details)
                    } onSent: { text in
                        notice = (text, false)
                        viewing = nil
                    }
                }
                .sheet(item: $person) { PersonSheet(person: $0) }
                .confirmationDialog("Delete this?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                    titleVisibility: .visible, presenting: deleting) { item in
                    Button("Delete", role: .destructive) {
                        Task {
                            if let problem = await store.delete(item) { notice = (problem, true) } else { viewing = nil }
                        }
                    }
                } message: { _ in
                    Text("It's removed for everyone at this show.")
                }
        }
        .sheet(item: $adding) { category in
            MediaUploadSheet(category: category, store: store, show: show) { notice = ($0, false) }
        }
    }
}

extension ShowMedia.Category: @retroactive Identifiable {
    public var id: String { rawValue }
}

private struct MediaGalleryCard: View {
    let category: ShowMedia.Category
    let items: [ShowMedia]
    let state: ShowMediaStore.State
    @Binding var sort: MediaGallery.Sort
    let onAdd: () -> Void
    let onOpen: (Int) -> Void

    private let columns = [GridItem(.adaptive(minimum: 96, maximum: 180), spacing: Space.x2)]

    var body: some View {
        VStack(alignment: .leading, spacing: Space.x3) {
            HStack(spacing: Space.x2) {
                MediaTitle(category: category, count: items.count)
                Spacer(minLength: 0)
                if items.count > 1 {
                    Menu {
                        Picker("Sort", selection: $sort) {
                            ForEach(MediaGallery.Sort.allCases) { Text($0.label).tag($0) }
                        }
                    } label: {
                        Label(sort.label, systemImage: "arrow.up.arrow.down")
                            .font(.caption.weight(.semibold))
                    }
                    .tint(.secondary)
                    .accessibilityLabel("Sort \(category.title)")
                    .accessibilityValue(sort.label)
                }
                Button(action: onAdd) {
                    Label("Add", systemImage: "plus")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(.brand)
                .accessibilityLabel(category.addLabel)
            }

            switch state {
            case .loading where items.isEmpty:
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, Space.x3)
            case .offline where items.isEmpty:
                Text("Photos will show when you're back online.")
                    .font(.brand(.sm)).foregroundStyle(.secondary)
            case .failed(let message) where items.isEmpty:
                Text(message).font(.brand(.sm)).foregroundStyle(.secondary)
            default:
                if items.isEmpty {
                    Text(category.emptyText).font(.brand(.sm)).foregroundStyle(.secondary)
                } else {
                    LazyVGrid(columns: columns, spacing: Space.x2) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            Button { onOpen(index) } label: { MediaThumbnail(item: item) }
                                .buttonStyle(.plain)
                                .accessibilityLabel(MediaThumbnail.label(item))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(radius: Radius.xl2)
    }
}

/// A square tile: the picture, a YouTube thumbnail, or a video's first frame,
/// with a play badge on videos.
struct MediaThumbnail: View {
    let item: ShowMedia
    @State private var frame: UIImage?

    var body: some View {
        Color.surfaceHover
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let url = item.thumbnailURL {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else if phase.error != nil {
                            Image(systemName: "photo").foregroundStyle(.secondary)
                        } else {
                            ProgressView()
                        }
                    }
                } else if let frame {
                    Image(uiImage: frame).resizable().scaledToFill()
                }
            }
            .overlay {
                if item.kind != .image {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 30))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.35))
                }
            }
            .clipShape(RoundedRectangle.brand(Radius.lg))
            .contentShape(RoundedRectangle.brand(Radius.lg))
            .task(id: item.id) {
                guard item.kind == .video, frame == nil else { return }
                frame = await Self.firstFrame(item.url)
            }
    }

    static func firstFrame(_ url: URL) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 400, height: 400)
        guard let (image, _) = try? await generator.image(at: .zero) else { return nil }
        return UIImage(cgImage: image)
    }

    /// "photo", "poster", "setlist photo", "video" or "YouTube video".
    static func noun(_ item: ShowMedia) -> String {
        switch item.kind {
        case .image: item.category == .photo ? "photo" : item.category == .poster ? "poster" : "setlist photo"
        case .video: "video"
        case .youtube: "YouTube video"
        }
    }

    static func label(_ item: ShowMedia) -> String {
        let name = Self.noun(item)
        let what = name.prefix(1).uppercased() + name.dropFirst()
        let caption = item.caption.isEmpty ? "" : ": \(item.caption)"
        return "\(what) from \(item.uploaderName)\(caption)"
    }
}
