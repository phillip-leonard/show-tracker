import Core
import CoreTransferable
import DesignSystem
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Adding to one gallery (the web's UploadMediaModal): pick up to ten
/// photos or videos from the library, a caption for each, then upload. A
/// YouTube link too, for Photos & Videos. Posters and setlist photos are
/// pictures only.
///
/// Files are made web-ready before anything is sent (`MediaPreparation`):
/// HEIC to JPEG, `.mov` to MP4 under 10 MB. The server filters captions;
/// a batch stops at the first file it refuses and keeps that one and the
/// rest here to fix.
struct MediaUploadSheet: View {
    enum Mode: String, CaseIterable, Identifiable {
        case files, youtube
        var id: String { rawValue }
        var label: String { self == .files ? "Upload" : "YouTube link" }
    }

    @Environment(\.dismiss) private var dismiss
    let category: ShowMedia.Category
    let store: ShowMediaStore
    let show: Show
    let onDone: (String) -> Void

    @State private var mode: Mode = .files
    @State private var picks: [PhotosPickerItem] = []
    @State private var entries: [Entry] = []
    @State private var preparing = 0
    @State private var link = ""
    @State private var linkCaption = ""
    @State private var progress: ShowMediaStore.Progress?
    @State private var sending = false
    @State private var problem: String?

    struct Entry: Identifiable {
        var upload: ShowMediaStore.Upload
        let preview: UIImage?
        var id: UUID { upload.id }
    }

    static let maxPicks = 10

    var body: some View {
        NavigationStack {
            Form {
                if category.allowsVideo {
                    Section {
                        Picker("Add", selection: $mode) {
                            ForEach(Mode.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                }
                if mode == .files { filesForm } else { youtubeForm }
                if let problem {
                    Section { Text(problem).font(.brand(.sm)).foregroundStyle(Color.amber) }
                        .brandRow()
                }
            }
            .brandScreen()
            .disabled(sending)
            .navigationTitle(category.addLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: {
                        if sending { ProgressView() } else { Text(mode == .files ? "Upload" : "Add") }
                    }
                    .disabled(!canSend)
                }
            }
            .interactiveDismissDisabled(sending)
            .onChange(of: picks) { Task { await prepare() } }
            .onChange(of: mode) { problem = nil }
        }
    }

    private var canSend: Bool {
        guard !sending, preparing == 0 else { return false }
        return mode == .files ? !entries.isEmpty : !link.trimmingCharacters(in: .whitespaces).isEmpty
    }

    @ViewBuilder private var filesForm: some View {
        Section {
            PhotosPicker(selection: $picks, maxSelectionCount: Self.maxPicks, selectionBehavior: .ordered,
                         matching: category.allowsVideo ? .any(of: [.images, .videos]) : .images,
                         preferredItemEncoding: .compatible) {
                Label(entries.isEmpty ? (category.allowsVideo ? "Choose photos or videos" : "Choose pictures") : "Choose again",
                      systemImage: "photo.on.rectangle.angled")
            }
            if preparing > 0 {
                HStack(spacing: Space.x2) {
                    ProgressView()
                    Text(preparing == 1 ? "Getting 1 file ready…" : "Getting \(preparing) files ready…")
                        .font(.brand(.sm)).foregroundStyle(.secondary)
                }
            }
        } footer: {
            Text("10MB per file, 50MB per show. Photos are saved as JPEG without their location.")
        }
        .brandRow()

        if !entries.isEmpty {
            Section(entries.count == 1 ? "1 file" : "\(entries.count) files") {
                ForEach($entries) { $entry in
                    HStack(alignment: .top, spacing: Space.x3) {
                        preview(entry)
                        VStack(alignment: .leading, spacing: Space.x1) {
                            Text(sizeText(entry.upload.media)).font(.caption).foregroundStyle(.secondary)
                            TextField("Caption (optional)", text: $entry.upload.caption, axis: .vertical)
                                .lineLimit(1...4)
                                .onChange(of: entry.upload.caption) {
                                    if entry.upload.caption.count > MediaLimits.maxCaption {
                                        entry.upload.caption = String(entry.upload.caption.prefix(MediaLimits.maxCaption))
                                    }
                                    problem = nil
                                }
                        }
                    }
                }
                .onDelete { entries.remove(atOffsets: $0) }
            }
            .brandRow()
        }

        if let progress {
            Section {
                VStack(alignment: .leading, spacing: Space.x2) {
                    Text("Uploading \(progress.index) of \(progress.total)…").font(.brand(.sm))
                    ProgressView(value: progress.fraction)
                        .tint(.brand)
                }
            }
            .brandRow()
        }
    }

    @ViewBuilder private var youtubeForm: some View {
        Section {
            TextField("https://youtube.com/watch?v=…", text: $link)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: link) { problem = nil }
            TextField("Caption (optional)", text: $linkCaption, axis: .vertical)
                .lineLimit(1...4)
                .onChange(of: linkCaption) {
                    if linkCaption.count > MediaLimits.maxCaption { linkCaption = String(linkCaption.prefix(MediaLimits.maxCaption)) }
                }
        } header: {
            Text("YouTube video")
        } footer: {
            Text("A link to a video of this show on YouTube.")
        }
        .brandRow()
    }

    private func preview(_ entry: Entry) -> some View {
        Group {
            if let image = entry.preview {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: entry.upload.media.isVideo ? "video" : "photo").foregroundStyle(.secondary)
            }
        }
        .frame(width: 56, height: 56)
        .background(Color.surfaceHover)
        .clipShape(RoundedRectangle.brand(Radius.lg))
        .accessibilityHidden(true)
    }

    private func sizeText(_ media: PreparedMedia) -> String {
        let size = ByteCountFormatter.string(fromByteCount: Int64(media.size), countStyle: .file)
        return media.isVideo ? "Video · \(size)" : "Photo · \(size)"
    }

    // MARK: Preparing

    /// Converts the picks, in the order they were chosen.
    private func prepare() async {
        problem = nil
        let chosen = picks
        preparing = chosen.count
        var ready: [Entry] = []
        var failures: [String] = []
        for pick in chosen {
            defer { preparing -= 1 }
            do {
                ready.append(try await Self.entry(for: pick, category: category))
            } catch {
                failures.append(error.message)
            }
        }
        entries = ready
        if let first = failures.first {
            problem = failures.count == 1 ? first : "\(failures.count) files couldn't be added. \(first)"
        } else if let limit = MediaLimits.problem(sizes: ready.map(\.upload.media.size), existing: store.media) {
            problem = limit
        }
    }

    private static func entry(for pick: PhotosPickerItem, category: ShowMedia.Category) async throws(MediaPreparation.Failure) -> Entry {
        let isVideo = pick.supportedContentTypes.contains { $0.conforms(to: .movie) }
        if isVideo {
            guard category.allowsVideo else { throw .unreadable }
            guard let movie = try? await pick.loadTransferable(type: PickedMovie.self) else { throw .unreadable }
            defer { try? FileManager.default.removeItem(at: movie.url) }
            let media = try await MediaPreparation.video(at: movie.url, name: movie.name)
            let frame: UIImage? = if case .file(let url) = media.payload { await MediaThumbnail.firstFrame(url) } else { nil }
            return Entry(upload: .init(media), preview: frame)
        }
        guard let data = try? await pick.loadTransferable(type: Data.self) else { throw .unreadable }
        let media = try MediaPreparation.image(data, name: "photo")
        let preview: UIImage? = if case .data(let bytes) = media.payload {
            await UIImage(data: bytes)?.byPreparingThumbnail(ofSize: CGSize(width: 168, height: 168))
        } else { nil }
        return Entry(upload: .init(media), preview: preview)
    }

    // MARK: Sending

    private func send() async {
        problem = nil
        sending = true
        defer { sending = false; progress = nil }
        switch mode {
        case .files:
            let batch = entries.map(\.upload)
            let count = batch.count
            do throws(ShowMediaStore.BatchFailure) {
                try await store.upload(batch, category: category, show: show) { progress = $0 }
                onDone(count == 1 ? "Uploaded." : "Uploaded \(count) files.")
                dismiss()
            } catch {
                // What's posted leaves the list; the refused one and the
                // rest stay to fix and send again.
                entries.removeFirst(min(error.index, entries.count))
                problem = error.index > 0
                    ? "\(error.index) uploaded. The next one wasn't: \(error.message)"
                    : error.message
            }
        case .youtube:
            if let failure = await store.addYouTube(link, caption: linkCaption, show: show) {
                problem = failure
            } else {
                onDone("Video added.")
                dismiss()
            }
        }
    }
}

/// A picked video, copied out of the picker's temporary file.
struct PickedMovie: Transferable {
    let url: URL
    /// The library's file name, for the uploaded file's.
    let name: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(UUID().uuidString)-\(received.file.lastPathComponent)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy, name: received.file.lastPathComponent)
        }
    }
}
