# Fit Check — Resume ↔ JD Matcher

Paste a resume and a job description, get a 0–100 match score, keyword gaps,
and concrete edit suggestions — powered by Claude. Apply the suggested edits
to rewrite the resume, export it as .docx or .pdf, and every match you run
is saved to a local Archive tab.

## Run it locally

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
npm start
```

Open http://localhost:3000

## How it's built

- `server.js` — Express backend. Accepts pasted text or uploaded `.pdf`/`.docx`
  files, extracts text (pdf-parse / mammoth), and calls the Anthropic API
  server-side so your key never reaches the browser.
- `public/` — plain HTML/CSS/JS frontend, two tabs (Match / Archive). No build step.
- `data/archive.json` — every match you run is appended here automatically
  (resume text, JD text, the full result, and any revised resume). It's a
  flat JSON file, not a database — fine for personal use, but not something
  to scale to many concurrent users without swapping in real storage.

## Features

- **Match**: paste or upload a resume + JD, get a score, strengths/gaps,
  keyword matches/misses, suggested edits, and an ATS-risk note.
- **Apply suggested edits**: rewrites your resume incorporating the
  suggestions (only works with pasted resume text, not an uploaded file —
  paste the text in if you want to use this).
- **Cover letter**: generates a tailored cover letter from the resume + JD
  you last matched on the Match tab (plus optional notes — a referral, a
  project to highlight). Editable, exports as plain-formatted .docx/.pdf
  (not run through the resume templates — it's a letter, not a resume).
- **Templates**: pick a visual style (Classic, Modern, Compact) on the
  Templates tab. Exports parse your revised resume into structured
  sections (name, contact, experience, skills, education) and lay it out
  in that style — so the ATS-optimized text you approved doesn't have to
  look like an ATS-optimized text file. All three templates are pure
  black-and-white and ATS-safe by construction: single column, no tables,
  no shaded/filled color blocks, no text boxes or images, no header/footer
  content, standard section names, and no tab-stop columns for dates —
  style variety between templates comes only from font choice, weight,
  and thin black/gray rule lines, never from color.
- **Export**: download the revised resume as `.docx` or `.pdf`, styled
  with your chosen template.
- **Archive**: every match is saved automatically; browse past runs, reopen
  any of them, re-download a past revision in your current template, or
  delete entries you don't want kept.

## Deploying the web app (do this first)

Any Node host works — Render, Railway, Fly.io, or a small VPS:

1. Push this folder to GitHub.
2. Connect it to your host, set the `ANTHROPIC_API_KEY` env var there.
3. Build command: `npm install`. Start command: `npm start`.

Get it live and usable on the web before spending time on app stores —
it validates the product and the scoring rubric with real users much faster.

## Turning it into an iOS / Android app

Once the web app is live at a real URL, the fastest path to App Store /
Google Play is wrapping it rather than rewriting it natively:

**Option A — Capacitor (recommended)**
Wraps your existing web app in a real native shell, gives you app icons,
splash screens, and access to native APIs (file picker, share sheet) if
you need them later.

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Fit Check" "com.yourname.fitcheck"
npx cap add ios
npx cap add android
```

Point Capacitor's `webDir` at your deployed URL (or bundle `public/` locally
and have it call your hosted API). Then open in Xcode / Android Studio to
build, sign, and submit.

**Option B — PWA + TWA (Android only, fastest, free)**
Add a manifest + service worker to `public/`, then use [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
to package it as a Trusted Web Activity for Google Play. No Xcode needed,
but this path doesn't reach the App Store.

## Before submitting to the stores

- **Privacy policy required** — you're processing resumes (PII). Both
  stores will reject submissions without one linked in the listing.
- **Apple ($99/yr)**: reviewers reject apps that are "just a wrapper around
  a website/API" with no distinct native value — make sure the UI feels
  like an app (native nav, offline-friendly states, no visible browser
  chrome), not an embedded webview with nothing else going on.
- **Google Play ($25 one-time)**: faster, looser review, but still requires
  the privacy policy and a data-safety form describing what you collect.
- Decide whether you're storing resumes/JDs server-side at all — the
  current implementation doesn't persist anything, which simplifies both
  the privacy policy and the data-safety form. If you add accounts or
  history later, you'll need to document retention and deletion.

## Next steps worth prioritizing

- Rate limiting on `/api/match` (an LLM call per request is not free)
- Auth if you want saved history or a paid tier
- A results-history view (would need a database — currently nothing persists)
