# WalkMode — notes for Claude sessions

HCI class project (Stony Brook). The README covers usage; this file records state and conventions that the code doesn't show.

## What this is
- A static mobile web app (vanilla ES modules, **no build step, no dependencies, no server**) that detects walking from `devicemotion` and switches `<html data-mode>` to enlarge touch targets.
- A built-in 2×2 within-subjects study: Interface (Standard / WalkMode) × Mobility (Standing / Walking).
- A Python analysis pipeline.
- An ACM `acmart` report draft.

Hosted on GitHub Pages: https://anhtienng.github.io/WalkMode-HCI/. Phones only expose motion sensors over HTTPS.

## Commands
- App: `python3 -m http.server 8000`, then open `localhost:8000/?sim=1`. On a desktop the sensor is simulated; press **W** to toggle walking.
- Tests: `npm test` (Node ≥ 18; `node --test tests/*.test.mjs`).
- Analysis: `pip install -r analysis/requirements.txt`, then `python analysis/analyze.py` (reads `data/*.json`).
- Pipeline test: `python analysis/make_synthetic.py && python analysis/analyze.py --data analysis/synthetic`.
- Report: Overleaf, or `cd report && latexmk -pdf walkmode.tex` (needs `acmart`).

## Current state (as of 2026-11-18)
- **The UI has never run in a real browser.** It was built on a cluster with no browser. What was checked:
  - unit tests;
  - a Node import smoke test of every module;
  - a careful code review, whose bugs were fixed.

  The first priority is to click through the whole study flow in a browser (Playwright, or manually in Chrome/Safari), then on an iPhone and an Android phone via Pages.
- **`report/generated/` contains SYNTHETIC placeholder outputs** (figures, `tables.tex`, `numbers.tex`). The report shows a red banner while `\IsSynthetic=1`. Never present these numbers as results. Re-run `analyze.py` on real data.
- `report/walkmode.tex` has `\todo{}` markers for participants, apparatus, route and interpretation. `references.bib` was written from memory and every entry must be verified.
- No participant data has been collected yet.

## Conventions and invariants
- **All tunables live in `js/config.js`.** `js/adapt.js` generates the per-mode CSS variables from it. Don't hard-code sizes in CSS.
- **Pure modules must stay DOM-free** so the Node tests can import them: `detector.js`, `taps.js`, `latin.js`, `rng.js`, `signals.js`, `config.js`.
- **Taps are classified at touch-down.** Classes are `hit`, `selection_error`, `miss`, `chrome` and `ignored`.
- **`[data-chrome]` marks app UI** (header, footer, demo bar); taps there are excluded from task measures.
- **Option-button groups must use `<div class="field">`, never `<label>`.** A label forwards taps on its text to the first button inside it, which silently recorded wrong answers once.
- **The session schema is `walkmode-session/1`.** `analysis/analyze.py` and `analysis/make_synthetic.py` both depend on it; change all three together.
- **Participant data goes in `data/`, which is git-ignored** because the repo is public. Never commit exported sessions.
- **The Latin square in `js/latin.js` must stay identical in three places:** the code, the table in `study/protocol.md`, and `SQUARE` in `analysis/make_synthetic.py`.
- **Charts use one interface encoding:** Standard = `#2a78d6` (blue), WalkMode = `#eb6834` (orange).
