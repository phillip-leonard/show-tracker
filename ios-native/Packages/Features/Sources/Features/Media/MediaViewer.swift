import AVKit
import Core
import DesignSystem
import SwiftUI

/// One gallery full screen (the web's lightbox): swipe between items,
/// pinch or double-tap to zoom a picture, play a video, open a YouTube
/// link in YouTube. Under it: who shared it, when, the caption, like, and
/// a menu to report it or delete your own.
struct MediaViewer: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let state: MediaViewerState
    let uid: String
    /// The setlist photo directory names the concert too.
    let showsConcert: Bool
    /// The item as the store has it now (a like in flight, a new count).
    let live: (String) -> ShowMedia?
    let busy: Set<String>
    let onLike: (ShowMedia) async -> String?
    let onDelete: (ShowMedia) -> Void
    let onReport: (ShowMedia) -> Void
    let onPerson: (ShowMedia) -> Void

    @State private var index = 0
    @State private var problem: String?
    @State private var chromeHidden = false

    init(state: MediaViewerState, uid: String, showsConcert: Bool, live: @escaping (String) -> ShowMedia?,
         busy: Set<String>, onLike: @escaping (ShowMedia) async -> String?, onDelete: @escaping (ShowMedia) -> Void,
         onReport: @escaping (ShowMedia) -> Void, onPerson: @escaping (ShowMedia) -> Void) {
        self.state = state
        self.uid = uid
        self.showsConcert = showsConcert
        self.live = live
        self.busy = busy
        self.onLike = onLike
        self.onDelete = onDelete
        self.onReport = onReport
        self.onPerson = onPerson
        _index = State(initialValue: state.index)
    }

    private var current: ShowMedia? {
        guard state.items.indices.contains(index) else { return nil }
        let item = state.items[index]
        return live(item.id) ?? item
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(state.items.enumerated()), id: \.element.id) { i, item in
                    MediaPage(item: item, active: i == index, onTap: { withAnimation { chromeHidden.toggle() } })
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
        }
        .overlay(alignment: .top) { if !chromeHidden { topBar } }
        .overlay(alignment: .bottom) { if !chromeHidden, let item = current { infoPanel(item) } }
        .onChange(of: index) { problem = nil }
        .statusBarHidden(chromeHidden)
        .preferredColorScheme(.dark)
    }

    private var topBar: some View {
        HStack {
            Button("Close", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .font(.title3.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
            Spacer()
            if state.items.count > 1 {
                Text("\(index + 1) of \(state.items.count)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, Space.x3).padding(.vertical, Space.x1)
                    .background(.ultraThinMaterial, in: Capsule())
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Space.x4)
        .padding(.top, Space.x2)
    }

    private func infoPanel(_ item: ShowMedia) -> some View {
        let mine = item.uploadedBy == uid
        let liked = item.isLiked(by: uid)
        return VStack(alignment: .leading, spacing: Space.x2) {
            if showsConcert {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.artist ?? "Unknown band").font(.brand(.base, weight: .semibold))
                    let line = [item.venue, item.date.map { ShowDateText.display($0) }].compactMap { $0 }.joined(separator: " · ")
                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.white.opacity(0.7)) }
                }
            }
            HStack(spacing: Space.x2) {
                Button { onPerson(item) } label: {
                    HStack(spacing: Space.x2) {
                        PersonAvatar(name: item.uploaderName, size: 28)
                        Text(item.uploaderName).font(.brand(.sm, weight: .semibold))
                    }
                }
                .disabled(mine)
                .accessibilityLabel(mine ? "Shared by you" : "\(item.uploaderName)'s profile")
                if let at = item.createdAt {
                    Text(at, format: .relative(presentation: .named))
                        .font(.caption).foregroundStyle(.white.opacity(0.7))
                }
                Spacer(minLength: 0)
                Button {
                    Task { problem = await onLike(item) }
                } label: {
                    Label(item.likeCount > 0 ? "\(item.likeCount)" : "Like", systemImage: liked ? "heart.fill" : "heart")
                        .font(.brand(.sm, weight: .semibold))
                        .foregroundStyle(liked ? Color.danger : .white)
                }
                .disabled(mine || busy.contains(item.id))
                .accessibilityLabel(liked ? "Unlike" : "Like")
                .accessibilityValue(item.likeCount == 1 ? "1 like" : "\(item.likeCount) likes")
                Menu {
                    if mine {
                        Button("Delete", systemImage: "trash", role: .destructive) { onDelete(item) }
                    } else {
                        Button("Report", systemImage: "flag") { onReport(item) }
                        Button("\(item.uploaderName)'s profile", systemImage: "person") { onPerson(item) }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44)
                }
                .accessibilityLabel("More")
            }
            if !item.caption.isEmpty {
                Text(item.caption).font(.brand(.sm)).fixedSize(horizontal: false, vertical: true)
            }
            if let problem {
                Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber)
            }
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.white)
        .padding(Space.x4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }
}

/// One item, filling the screen.
private struct MediaPage: View {
    @Environment(\.openURL) private var openURL
    let item: ShowMedia
    let active: Bool
    let onTap: () -> Void

    var body: some View {
        switch item.kind {
        case .image:
            ZoomableImage(url: item.url, onTap: onTap)
        case .video:
            VideoPage(url: item.url, active: active)
        case .youtube:
            VStack(spacing: Space.x4) {
                if let thumb = item.thumbnailURL {
                    AsyncImage(url: thumb) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .frame(maxHeight: 280)
                }
                Button("Watch on YouTube", systemImage: "play.rectangle.fill") { openURL(item.url) }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
        }
    }
}

/// Plays while it's the page on screen.
private struct VideoPage: View {
    let url: URL
    let active: Bool
    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .onAppear { if player == nil { player = AVPlayer(url: url) } }
            .onChange(of: active, initial: true) { if active { player?.play() } else { player?.pause() } }
            .onDisappear { player?.pause() }
    }
}

/// Pinch, or double-tap, to zoom; drag to look around a zoomed picture.
private struct ZoomableImage: View {
    let url: URL
    let onTap: () -> Void
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image.resizable().scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(magnify)
                    .simultaneousGesture(scale > 1 ? pan : nil)
                    .onTapGesture(count: 2) { withAnimation(.snappy) { toggleZoom() } }
                    .onTapGesture(count: 1, perform: onTap)
                    .accessibilityAddTraits(.isImage)
                    .accessibilityAction(named: scale > 1 ? "Zoom out" : "Zoom in") { toggleZoom() }
            } else if phase.error != nil {
                ContentUnavailableView("Couldn't load this picture", systemImage: "photo")
                    .foregroundStyle(.white)
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func toggleZoom() {
        if scale > 1 { reset() } else { scale = 2.5; lastScale = 2.5 }
    }

    private func reset() {
        scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { scale = min(max(lastScale * $0.magnification, 1), 5) }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.01 { withAnimation(.snappy) { reset() } }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { offset = CGSize(width: lastOffset.width + $0.translation.width, height: lastOffset.height + $0.translation.height) }
            .onEnded { _ in lastOffset = offset }
    }
}
