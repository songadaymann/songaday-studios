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
