# Media Library

The **Media Library** lives at `/files`. It is the central asset store for every image, video,
audio clip, and document your organisation uploads or generates. The tools under `/media` (the
[Media Studios](./media/index.md)) produce new files; `/files` is where those finished assets land,
where you browse them, and where you pick assets to use in posts or as source material for another
generation.

## Files vs Media Studios

| Surface | URL | Purpose |
|---|---|---|
| **Media Library** | `/files` | Asset library — uploads, generated outputs, folders, tags, trash, and storage backends. |
| **Media Studios** | `/media/*` | Tools — generative models, stock browsers, transcription, and the Designer canvas. |

A typical workflow moves from `/media` to `/files` and back:

1. Open a studio under `/media` (for example, [Runway](./media/runway.md) or
   [Stock Photos](./media/stock-photos.md)).
2. Generate or pick an asset.
3. The asset is saved into `/files`.
4. From `/files`, you can **Open in Designer**, or use the asset as a source image/video/audio in
   another studio.

System artifacts are kept out of the library listing: the preview thumbnails saved with designs and
templates, and the intermediate asset/reference files the AI Designer imports while working on a
session, are hidden from `/files` (they stay reachable by the designs that use them).

## Folder tree navigation

The left sidebar in `/files` displays a hierarchical folder tree backed by the `FileFolder` model.
Each folder has a `parentId`, enabling unlimited nesting.

- Click any folder to filter the file grid to that folder's contents.
- Click **All Files** at the top to view files across the entire library (unfiltered by folder).
- Folders with children show expand/collapse arrows. The collapsed state persists per session.
- Each folder shows a count of its direct media files.
- Right-click any folder for a context menu with **Rename**, **New Subfolder**, and **Delete**.
- Deleting a non-empty folder asks you to confirm **Delete folder and move contents to All Files?** —
  only the folder is removed: its files become unfiled (they appear under **All Files**) and its
  subfolders move to the root level.
- Click the **+** button in the folder header to create a new folder at the root level.

## Uploading files

Files upload into the currently selected folder. Two upload methods are supported:

- **Drag and drop**: drag files from your file system onto the media area. The uploader accepts
  images, videos, audio, and documents.
- **File picker**: click the upload button in the toolbar to browse and select files.

Uploads show progress indicators and complete with a success notification. A video's poster
thumbnail is generated in the background after the upload (and after a generation job completes),
so it appears a moment later; the upload itself never waits for it. A file's type (image, video,
audio, document) comes from its actual content, not from how it was produced — a generation job
that finishes with a JPG files as an image.

## Grid / list toggle

Two view modes are available in the top-right toolbar:

| Mode | Description |
|------|-------------|
| **Grid** | Thumbnail tiles showing a preview of each file. Best for visual browsing of images and videos. |
| **List** | Tabular rows with sortable columns: name, type, size, and created date. Click column headers to sort ascending or descending. |

The selected view mode persists for your session.

## Preview and file details

Click any file to open a **preview** with **Details**, **Download**, and **Open in Designer**
buttons. Right-click a file (or long-press on touch) for a context menu with **Preview**, **Open in
Designer**, **Details**, **Rename**, **Download**, and **Delete**.

Video files and video designs carry a **duration badge** on their tile.

### Design files (`.pdesign`)

A `.pdesign` file is a self-contained Designer export (document, media, and custom fonts bundled)
produced from a saved design or template. In the library it shows the design's thumbnail and a
label such as **Image design**, **Video design**, **Image template**, or **Video template**.
**Open in Designer** on a `.pdesign` imports it as a **new design** in your organisation
(`POST /media/designs/import-library`) and opens it; the library file is left as is. To bring in a
`.pdesign` from outside the library, use the Designer's own import (`POST /media/designs/import`).

**Details** opens the details panel on the right side. This panel provides:

| Section | Content |
|---------|---------|
| **Preview** | Image thumbnail (square, aspect-ratio constrained) or video player with controls for `.mp4` files. |
| **Name** | Editable in-place — click to rename, press Enter or click away to save. |
| **Description** | Multi-line text field. Edits save on blur. |
| **Tags** | Add tags by typing and pressing Enter, comma, or Tab. Remove tags by clicking the × icon. Tags persist to the file metadata. |
| **Campaigns** | Tag the file to one or more campaigns. |
| **Metadata** | Read-only display of file size (formatted as B/KB/MB), MIME type, and creation date. |
| **Actions** | **Copy URL**, **Download**, **Open file**, and **Delete** (soft-delete to trash). |

## Drag to move between folders

Drag any file thumbnail and drop it onto a folder in the left sidebar (or a folder tile in the grid)
to move it. The target
folder highlights in blue. A success notification confirms the move, and both the file grid and
folder counts refresh.

When the target folder lives on a different storage provider (for example, moving a file from
local storage into a mounted S3 bucket), the file's bytes are copied to the destination provider
— subject to its quota — and removed from the source. Moves within the same provider only change
the folder. If a move fails, the notification shows the reason.

## Bulk actions

When one or more files are selected (checked), a bulk toolbar appears above the grid:

- **Move to Folder** — opens a modal listing all folders; select a target and click Move. Choose
  **Root (no folder)** to move files out of any folder.
- **Delete** — soft-deletes all selected files (they go to the trash).
- **Open all in Designer** — stashes the selection in `sessionStorage` and opens the
  [Designer](./media/designer.md) static canvas with every asset loaded.
- **Clear** — deselects all files.

Selection works by clicking the checkbox on file cards (grid view) or rows (list view).

## Search, sort, and pagination

The toolbar provides:

- **Search bar** — searches by file name or tags. Results update with a 300ms debounce as you
  type.
- **Type filter** — dropdown to filter by file type: Images, Videos, Audio, or Documents.
- **Sort** — in list view, click any column header to sort. Click again to reverse sort order.
- **Pagination** — page navigation appears below the grid when results span multiple pages.
  Shows up to 7 page buttons with ellipsis for large result sets. 24 files per page.

## Trash

The **Trash** button in the toolbar opens a modal showing all soft-deleted files:

- Each trashed item shows a thumbnail, file name, and deletion timestamp.
- **Restore** returns the file to the library (it reappears in its previous folder).
- **Delete** permanently removes the file. A confirmation dialog warns that permanent deletion
  cannot be undone.

Soft-delete is the default behaviour when deleting from the file details panel or bulk toolbar.
Permanent deletion is only available from the trash view.

## Storage provider mounting

Root folders in `/files` map to configured storage providers. Each `StorageProviderConfig` record
represents a storage backend (S3, R2, B2, IDrive e2, MediaLocker, or local disk). When a provider is mounted, it
appears as a root-level folder; a newly added provider is mounted automatically once its connection
test passes. Different folders can route to different storage backends — for
example, you might keep active campaign assets on fast local storage and archive older campaigns to
cloud object storage.

Configure storage providers in **Settings → File Storage**. See
[Storage Setup](../operations-guide/storage.md) for provider configuration and quota management.

> Verified against v1.4.0
