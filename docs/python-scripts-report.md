# Python in U2C Beatstore: where it helps

_Report, 21 Nov 2026._

## The prompt, improved

> Uploads work again after the R2 CORS fix. Write a report for me (not a developer) on:
> 1. where Python scripts would genuinely help the beatstore: what each would do, why Python rather than the existing TypeScript, and the effort involved;
> 2. how I can use Python myself day to day, with ready-to-run examples.
> Ground it in what the app already has. Rank by value. Flag anything that touches live data or money.

## What already exists

You already run Python: **`stem-service/`** is a small Python web service (FastAPI + Demucs) that splits a beat into vocals / drums / bass / other. The app calls it through `DEMUCS_SERVICE_URL`. Everything else is TypeScript (Next.js) plus a few Node and shell scripts in `scripts/ops/`.

**Rule of thumb.** Keep the website itself in TypeScript. Use Python where it is the stronger tool:
- audio and music analysis;
- batch jobs over your whole catalogue;
- data and money reports;
- one-off automation.

Python scripts should talk to the app through its database and storage. They should not replace pages or API routes.

## Where Python would help the app, ranked

| # | Idea | What it does | Why Python | Effort |
|---|---|---|---|---|
| 1 | **Waveform files for your whole catalogue** | Builds the small waveform file for each beat once, so the store stops downloading 13 MB per preview. This is the "faster waveforms" task that was paused. | numpy/scipy band filters over hundreds of files in one run; easy to re-run | Medium |
| 2 | **Catalogue health check** | Lists beats with no cover, no price, no BPM/key, a missing preview, a missing MP3 for leases, or stems not split. Exports a CSV. | pandas makes the report one script | Small |
| 3 | **Better BPM / key / mood tagging** | Re-analyses old beats with librosa or Essentia's Python build. Suggests genre/mood tags. Writes nothing until you approve the CSV. | The best music-analysis libraries are Python-first | Medium |
| 4 | **Sales and plays report** | A weekly PDF or CSV: sales by beat, licence type and promo code; plays vs sales (conversion); top artists from your share links. | pandas + matplotlib; nicer than the Analytics page for deep dives | Small |
| 5 | **Bulk loudness / format prep** | Normalises loudness (-14 LUFS) and makes tagged MP3s, previews and clean WAVs in one batch before upload. | pyloudnorm + ffmpeg | Small |
| 6 | **Stem service upgrades** | Better models (htdemucs_ft), a queue so long jobs don't time out, an "instrumental only" mode for toplines. | Already Python | Medium |
| 7 | **Similar-beats engine** | "Sounds like this" on the store, and grouping in your library, from audio fingerprints/embeddings. | Embedding models (e.g. CLAP) are Python | Large |
| 8 | **Contact and CRM clean-up** | Merges duplicate contacts (same person, different email casing), and fixes emails and roles from a CSV export. | pandas; dry-run first | Small |
| 9 | **Label OS finance imports** | Turns messy distributor statements (DistroKid, TuneCore, …) into the clean CSV the Finance import expects. | pandas handles odd spreadsheets well | Medium |

**Safety rules for any script that touches live data:**
- read-only by default;
- a `--dry-run` that shows what would change;
- never prices, purchases or licences without your explicit go;
- the Supabase service key comes from an environment variable, never pasted into the script;
- back up first (Supabase → Database → Backups).

## How you can use Python yourself

Set-up, once: install Python 3.12 and run `pip install pandas mutagen pyloudnorm soundfile librosa`.

- **Rename and tag a folder of beats before upload.** The app reads BPM and key from the filename (`Night Shift 140 Fm.wav`), so a script that renames your exports to that pattern makes every upload land pre-filled.
- **Check loudness of a folder** (sketch):
  ```python
  import sys, soundfile as sf, pyloudnorm as pyln, pathlib
  for f in pathlib.Path(sys.argv[1]).glob("*.wav"):
      data, rate = sf.read(f)
      print(f.name, round(pyln.Meter(rate).integrated_loudness(data), 1), "LUFS")
  ```
- **Quick BPM/key guess offline** with `librosa` before you name a file.
- **Analyse a CSV export** (Stripe payments, Analytics) with pandas: totals per month, best-selling beat, average order.
- **Batch-convert** WAV to MP3 320 or make 75 s previews with `pydub`/ffmpeg.

## How I (Claude) already use Python in this project

- **Test audio:** generated the synthetic WAV used to reproduce the upload bug.
- **Waveform research:** the band-filter maths was prototyped and checked in Python-style numeric code before going into TypeScript.
- **Quick data checks:** reading JSON, CSV and log output during investigations.
- **Stem service:** the Demucs service itself.

## Recommended next steps

1. Resume the **waveform files** task (#1), with its backfill script in Python.
2. Write the **catalogue health check** (#2). It is small, read-only and immediately useful.
3. The **sales report** (#4) once live sales start coming in.

Tell me which to start and I'll brief one session with a dry-run-first script.
