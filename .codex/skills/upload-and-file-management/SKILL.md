---
name: upload-and-file-management
description: Use for Beatstor upload flows, drag-and-drop, file validation, progress, retry/cancel, duplicate detection, metadata extraction, artwork previews, R2 signed uploads, secure storage paths, upload sessions, and private/public media separation.
---

# Upload And File Management

## Activation

Use for `src/app/api/upload`, `src/components/upload`, `src/lib/upload`, `src/lib/storage`, R2 media paths, audio preview generation, stems upload, artwork upload, and upload recovery.

## Workflow

1. Inspect multipart upload routes and storage helpers.
2. Validate file type, MIME, size, and ownership server-side.
3. Separate public previews/artwork from private masters, WAVs, and stems.
4. Track upload status persistently enough to recover from failures or navigation.
5. Extract duration and audio metadata using existing audio helpers where practical.

## Checklist

- Drag/drop and file picker paths behave consistently.
- Progress, retry, cancel, failure recovery, and duplicate handling are intentional.
- Secure upload URLs are scoped and time-limited.
- Private files never use predictable public URLs.
- Upload status and resulting track fields are coherent.

## Expected Output

Upload/storage change, validation rules, media boundary notes, and tested success/failure paths.
