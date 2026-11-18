# chord-study

Make Swiss-style chord studies in one click, with no music theory needed.

- **Create:** pick a mood, harmony level (Smooth / Rich / Spicy) and key, then press Generate. Every chord is chosen, voiced for smooth voice leading, and played with glides. Tap a chord to swap it.
- **Video:** drop in a clip and your chords play underneath it, with chord changes snapped to scene cuts. Mix the chords against the original audio, add an overlay, and export.
- **Library and sharing:** save studies on your device, share them as links, copy a caption, or export a 1080×1920 video.

## Run locally

It's a static site with no build step:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Code

- `js/engine.js`: chord parsing, voice leading, roman numerals, mood templates, reharmonisation
- `js/audio.js`: Web Audio synth (Strings, Pad, Keys) and mixer
- `js/render.js`: the chord study card
- `js/app.js`: Create tab, library, share links
- `js/video.js`: Video tab (cut detection, timing, overlay, export)
