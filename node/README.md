# songaday.studio/node

The page for Jonathan's NODE WHATIF Residency application (https://nodefoundation.com/program/whatif):
the application video in a Game Boy screen bezel, a level select that jumps to each part, the
"what if" questions from the end of the video, and a few links. Nothing on the site links here,
and the page asks search engines not to index it.

- `index.html`: the whole page (styles and script inline). The greens are the four DMG greens the
  video's overlay uses.
- `press-start-2p.woff2`: Press Start 2P by CodeMan38, subset to Latin and the few symbols the
  page uses (▶ ▼ ♪ ♥ →). Copyright 2012 The Press Start 2P Project Authors, with Reserved Font Name
  "Press Start 2P". Licensed under the SIL Open Font License 1.1 (https://openfontlicense.org);
  the copyright and license notice are also kept in the font file's own name table.
- The video is `assets/video/node-whatif.mp4` in R2 (`node upload-media.mjs`), a 1080p H.264
  encode of `JonathanMannNodeResidency.mp4` (CRF 20, at most 6 Mbps, AAC 160k, faststart).
  The poster is `assets/images/node/whatif-poster.webp` (2 s in) and the link preview
  `assets/images/node/whatif-share.jpg`.
- The level select's times come from the video's own section banners (ANGLE 1/2/3, QUEST LOG,
  WHATIF?). If the video is re-cut, update the `data-t` seconds and the times shown.
