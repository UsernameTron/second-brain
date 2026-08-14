# Brand assets

Drop the approved CTG mascot here as `mascot.png` (source of truth:
the design system's `assets/mascot-full.png` — CUE, the Queue Whisperer;
copy it, don't redraw it). Vite serves everything in this folder at the
site root, so the file appears at `/mascot.png`.

The UI shows CUE on the sign-in card and in the needs-you tray when the
queue is clear, and silently falls back to the glyph when the file is
absent — so a missing mascot never breaks a build or a deploy.
