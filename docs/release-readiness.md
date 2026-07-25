# Release Readiness Notes

## Turbopack NFT Warning: Audio Conversion

`npm run build` can complete successfully while Turbopack reports `Encountered unexpected file in NFT list` warnings with this trace:

```text
next.config.ts -> src/lib/audio/convert.ts -> src/app/api/tracks/[id]/analyze/route.ts
```

Current status:

- The warning is build noise, not a compile failure.
- `src/lib/audio/convert.ts` no longer imports `ffmpeg-static` at runtime.
- Audio conversion streams through `ffmpeg` pipes instead of writing temp input/output files.
- `next.config.ts` still includes `node_modules/ffmpeg-static/ffmpeg` in `outputFileTracingIncludes` for the analyze and preview-backfill routes, so Vercel has the native binary available.

Deployment workaround:

1. Keep `ffmpeg-static` installed unless the hosting environment provides a known-good `ffmpeg` binary.
2. Keep `outputFileTracingIncludes` in `next.config.ts` for:
   - `/api/tracks/[id]/analyze`
   - `/api/cron/backfill-previews`
3. If the host provides a binary, set `FFMPEG_BIN` to its absolute path. The converter tries `FFMPEG_BIN`, then the bundled static binary, then `ffmpeg` on `PATH`.
4. Treat a successful production build with this warning as deployable, but verify one deployed preview-generation path after release:
   - Upload or re-analyze an MP3/WAV track.
   - Confirm `preview_url` reaches `ready`.
   - Confirm public playback uses `/api/store/preview/[id]` or the public preview derivative, never a private `r2://` master.

Do not remove the explicit tracing include just to silence the warning unless deployment preview generation has been re-proven without it.
