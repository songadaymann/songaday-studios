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
