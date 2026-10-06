# Tabify

Tabify is a dark, minimalist browser app for turning audio into editable instrument tabs.

## Current MVP

- WAV, MP3, M4A, OGG and FLAC upload when supported by the browser
- Audio playback, seeking and waveform display
- Browser-side monophonic pitch detection
- Note consolidation and rough BPM/range analysis
- Guitar, bass and ukulele fret/string mapping
- Standard, Drop D and half-step-down tunings
- Piano and basic drum analysis layouts
- Editable tab output and TXT export
- MP4 workflow UI prepared for a server/worker-based FFmpeg pipeline

## Local development

This is currently a static site with no build step.

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create a GitHub repository named `tabify`.
2. Upload the contents of this folder to the repository root.
3. In **Settings → Pages**, choose **Deploy from a branch**.
4. Select `main` and `/ (root)`.
5. Save. GitHub will provide the public Pages URL.

## Deploy to Cloudflare Pages

1. Push this folder to a GitHub repository.
2. In Cloudflare, create a Pages project and connect that repository.
3. Use the repository root as the project directory.
4. There is no build command and no output directory required for this static MVP.
5. Deploy. Cloudflare will provide a `*.pages.dev` URL.

## Production music-intelligence architecture

The browser pitch detector is intentionally lightweight. A production version should keep the current editor/API contract while adding a backend worker:

1. Upload audio to object storage.
2. Normalize audio with FFmpeg.
3. Separate stems/instruments.
4. Run a polyphonic music-transcription model on the relevant stem.
5. Convert note events into instrument-specific strings/frets, rhythm and chords.
6. Return note events + confidence to the editor.
7. Let the user correct notes and export TXT/MIDI/Guitar Pro-compatible data.

This separation lets the frontend remain fast while heavier AI processing runs on a server.
