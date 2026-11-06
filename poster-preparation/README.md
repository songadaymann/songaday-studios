# MUSCLE store print preparation

Recovery copies of scripts from the separate `posters` workspace. Run them from
that workspace, which contains `output/batch-centered-v4-original-color/pdf`,
`research/store-variants.json`, and the approved source inventory. These are not
Worker modules. Python requires pypdf; the shared uploader uses local Gelato and
Wrangler credentials, excluded from Git. Never copy credentials into this folder.

1. `prepare_store_sizes.py` makes 472 US-sized PDFs, preserving image streams.
2. `upload_store_sizes.py` uploads and HEAD-verifies immutable R2 assets.
3. `setup_store_proofs.py` saves six unpaid Sunshine variant drafts and checks
   hashes of Gelato's stored PDFs. Reconciles by reference before creating drafts.

`sync_gelato_v4.py` provides API/upload helpers and the earlier large-batch tool.
The authoritative current product map is `store/variants.json`; copy its
`variants` array to the workspace `research/store-variants.json` to reconstruct.
No paid print order is submitted by these scripts.

## F/H and corrected Sunshine owner samples

`prepare_songaday_proofs.py` wraps the recovered 12000×9000 JPEGs from the Studio
`output/poster-concepts/designs/print-300/` archive into US 40×30-inch landscape
PDFs with 4mm mirrored bleed outside nominal trim. The JPEG streams are copied
without recompression or color conversion. Set `SONGADAY_POSTER_SOURCE` if that
archive is elsewhere. The recovered title/count and incomplete 2026 coverage are
intentionally retained for owner layout samples, not new retail editions.

Run scripts from the separate posters workspace, as above.
`sync_studio_sample_draft.py` uploads the F/H PDFs and saves/reconciles one UNPAID
Gelato draft, with one of each F/H plus one existing original-color v4 Sunshine
at 30×40 portrait. It verifies every stored Gelato file's SHA256. Does not submit
or pay for an order. Version print files rather than overwriting a prepared proof.
Safe proof metadata/draft link are in `songaday-fh-proof-v1/`; binaries are in R2.

## Current sample cart: Sunshine A replaces Sunshine D

The first sample cart was superseded at Jonathan's request. Current unpaid cart
is recorded in `songaday-fh-sunshine-a-proof-v2/draft-verified.json`, with F/H
unchanged and Sunshine A #039 instead of D #015. The old cart was deleted only
after verifying all three replacement source files. `replace_sample_sunshine.py`
reconciles the replacement by reference; the original setup script now refuses
to recreate the old cart when the replacement marker exists. No paid order was
submitted or changed. Use the NEW link in the v2 record.

## iPhone 4 Antenna Song poster concepts

Two local PDF mockups use the actual archived Song A Day #561 video (song date
July15,2010): 80frames (8×10) and180frames (12×15), each40×30in landscape with
Helvetica Neue embedded. `make_antenna_song_posters.py` is the reproducible renderer;
run it in the posters workspace after extracting candidate frames below. The
manifests preserve exact selected filenames/times and source/PDF SHA256 values.

Preferred source is the1280×720 archived MP4 in Dropbox's
`SongADay2026_working/08_August/MOTBA/assets/09_songaday_origin_and_ending/specific_requested_videos/`,
named `VKIcaejkpD4_Song_A_Day_561_-_The_iPhone_Antenna_Song.mp4`. Its Dropbox hash
was verified before use. Canonical numbered archive561.mp4 is lower resolution.
Both copies are already archived; no new YouTube download was needed.

From the posters workspace, extract1280×720 candidates without filters/enhancements:

```sh
mkdir -p tmp/iphone-antenna-song/poster-frames
ffmpeg -ss 7 -i tmp/iphone-antenna-song/VKIcaejkpD4_Song_A_Day_561_-_The_iPhone_Antenna_Song.mp4 -t 107 -vf fps=3 -q:v 2 tmp/iphone-antenna-song/poster-frames/frame-%04d.jpg
python3 make_antenna_song_posters.py
```

Use Python with Pillow, NumPy, ReportLab, pypdf and pypdfium2. Set
`POSTER_HELVETICA_NEUE` to the system Helvetica Neue TTC if its location differs.
The renderer selects the actual performance11.70–113.50s and omits the repeated
black lyriccard72.039–77.244s; retains the meaningful monochrome FANBOY sequence.
Images keep their16:9 ratio; no generative imagery, retouching or color filters.
PDF/PNG proof binaries and downloaded video stay in ignored output/tmp folders,
not Git. These concepts are NOT in Gelato or the public store; finalize layout
and add bleed before any future print order.

### Every-frame Antenna Song concept

`make_antenna_every_frame.py` produces a40×30-inch concept containing ALL3608
source frames once each, including opening/closing credits and lyric cards.
The prior verbal80×46 estimate was incorrect for16:9 images; actual layout is
54columns×67rows with10empty final cells. Each image is about0.708in wide.
Frames are downsampled to320×180 (about452ppi at print size), in source order,
without frame-rate conversion, color filters or deduplication:

```sh
mkdir -p tmp/iphone-antenna-song/all-frames
ffmpeg -i tmp/iphone-antenna-song/VKIcaejkpD4_Song_A_Day_561_-_The_iPhone_Antenna_Song.mp4 -map 0:v:0 -vf scale=320:180:flags=lanczos -fps_mode passthrough -q:v 2 tmp/iphone-antenna-song/all-frames/frame-%05d.jpg
python3 make_antenna_every_frame.py
```

Local output:`output/iphone-antenna-every-frame-v1/{preview.png,iphone-4-antenna-all-3608-frames.pdf,manifest.json}`.
The PDF verifies3608embedded images and Helvetica Neue fonts. Summary is preserved
here; full per-frame geometry manifest is local. Concept only, not added to Gelato.
