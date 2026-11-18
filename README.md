# WalkMode

A movement-aware mobile web interface. When the phone's accelerometer detects **walking**, touch targets get bigger and the spacing between them grows. When the user **stops**, the standard layout returns. The repo also contains everything needed to run and analyse a 2 × 2 within-subjects study (Interface: Standard / WalkMode × Mobility: Standing / Walking) for an HCI class project.

| Part | Where |
|---|---|
| Mobile web app (no build step, no server) | `index.html`, `css/`, `js/` |
| Unit tests (detector, Latin square, tap classification) | `tests/` |
| Analysis: stats, figures, LaTeX tables | `analysis/` |
| Study protocol and consent template | `study/` |
| Report draft (ACM `acmart`) | `report/` |

## 1. Run it locally (desktop)

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/?sim=1>. If you are working on the cluster through VS Code, the port is forwarded automatically; check the **Ports** tab.

A desktop has no motion sensor, so the app falls back to a **simulated sensor**: press **W** to toggle simulated walking. Things to try:
- The **Sensor monitor** shows the detector's signal.
- **Demo** runs the three tasks with *Auto*, *Standard* or *Walking* layouts.
- **New study session** runs the full study flow. In walking blocks the simulator walks automatically.

## 2. Deploy to GitHub Pages (needed for phones)

Phones expose motion sensors only to **HTTPS** pages, so the app must be served over HTTPS. GitHub Pages provides that for free.

```bash
git add -A
git commit -m "WalkMode app, study kit and report draft"
git remote add origin https://github.com/<your-user>/walkmode.git   # create the empty repo on GitHub first
git push -u origin main
```

On GitHub, go to **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**. After a minute the app is live at `https://<your-user>.github.io/walkmode/`.

On the study phone:
1. Open that URL.
2. Add it to the home screen (iOS: Share → *Add to Home Screen*; Android: ⋮ → *Install app*). This hides the browser bars.
3. On iPhone, tap **Enable** on the home screen to allow motion access.
4. Walk around with **Sensor monitor** open to check that walking is detected.

Participant data is **not** in the repo (`data/` is git-ignored), so the public Pages site never contains study data.

## 3. Run a session

Follow [`study/protocol.md`](study/protocol.md). In short:
1. **New study session.** Enter the participant ID (P01, P02, …). The condition order comes from a balanced Latin square.
2. **Sensors.** Enable motion access, then calibrate (~30 s: stand and tap dots, then walk).
3. **Practice** in both layouts.
4. **Four blocks.** Each block runs the app launcher (10 trials), contacts (6) and settings (5), followed by NASA-TLX.
5. **Final preference questionnaire, then export** (share sheet, download, or copy).

Data autosaves after every trial. If the page is closed, **Home → Resume** continues the session; an interrupted block restarts with fresh stimuli.

Copy each exported `walkmode_<ID>_<date>.json` into `data/`.

## 4. Analyse

```bash
module load scipy-stack/2026a        # on the cluster; elsewhere: pip install -r analysis/requirements.txt
python analysis/analyze.py           # reads data/*.json
```

**Outputs:**
- `analysis/output/summary.md` — means with within-subject 95% CIs, 2×2 RM-ANOVA, Holm-corrected planned comparisons, TOST equivalence for standing, detector behaviour, preferences.
- `analysis/output/*.csv` — tidy tables of trials, taps, TLX, blocks, preferences and per-participant aggregates.
- `report/generated/` — figures (`fig_*.pdf/png`), `tables.tex` and `numbers.tex`, which the report includes automatically.

To test the pipeline before you have data:

```bash
python analysis/make_synthetic.py                  # 12 SYNTHETIC participants → analysis/synthetic/
python analysis/analyze.py --data analysis/synthetic
```

Synthetic data is labelled as such everywhere, including a red banner in the report. **Never report it as results.** The analysis refuses to mix synthetic and real sessions.

> The files currently in `report/generated/` were produced from synthetic data. Re-run `analyze.py` on your real data before writing up.

## 5. Report

`report/walkmode.tex` is an ACM `sigconf` draft covering introduction, related work, system design, method, results, discussion and limitations. Upload the `report/` folder to Overleaf, which includes `acmart`, or compile locally with `latexmk -pdf walkmode.tex` if `acmart` is installed. Search for `TODO` to find the parts only you can fill in: participants, apparatus, route, interpretation. Verify every entry in `references.bib` before submitting.

## 6. Tests

```bash
module load nodejs/24.22.3     # on the cluster
npm test                        # node --test tests/*.test.mjs
```

## How it works

```
devicemotion ──► WalkDetector ──state──► Adapter ──data-mode──► CSS size tokens
 (js/motion.js)   (js/detector.js)        (js/adapt.js)          (css/app.css, from js/config.js)
                                              │
 taps (js/logger.js) ─► TrialRunner (js/tasks/runner.js) ─► session log ─► export (js/export.js)
```

### Walking detector (`js/detector.js`)

The detector works on the magnitude of acceleration including gravity, which doesn't depend on how the phone is held. It removes gravity with a 1 s moving average and smooths the result lightly. Every 100 ms it computes three features over a 2.5 s window:
- **σ**: motion variability.
- **Cadence**: steps per second, from peaks in the signal.
- **Rhythm regularity**: the coefficient of variation of the intervals between steps.

A window counts as walking when σ ≥ 0.6 m/s², cadence is 1.2–3 Hz and the rhythm is regular. Hysteresis then decides the state: walking-like windows must persist 1.2 s to switch on, and still-like windows 2.5 s to switch off. The rhythm check is what keeps tap jolts from counting as walking.

Calibration sets per-participant thresholds. In simulation the detector switches on about 2.6 s after walking starts, switches off about 4 s after stopping, and ignores both tap jolts and 1.5 s pauses (see the tests).

### Adaptation (`js/adapt.js`)

A single attribute, `<html data-mode>`, switches between the **standard** and **walking** size sets in `js/config.js`:

| | Standard | Walking |
|---|---|---|
| Icons | 40 px | 64 px |
| Gaps | 6 px | 16 px |
| Rows | 44 px | 64 px |
| Switches | 40 × 24 | 60 × 36 |
| Grid columns | 5 | 4 |

The default **touch-idle** policy defers a layout change while a finger is down and for 700 ms afterwards, so targets never move under a tap. The contacts list also keeps its scroll position across the change.

### Logging (`js/logger.js`, `js/tasks/runner.js`)

- Each **tap** is classified where the finger *lands*:
  - `hit`: the target the current step needs.
  - `selection_error`: another target.
  - `miss`: empty space.

  Each tap record also stores its offset from the target centre, the target's size, the current mode and the detector state.
- Each **trial** records its time, errors, misses, timeout and any mode switches during it.
- Each **block** records a 1 Hz motion summary and the timelines of detector and layout changes.

### Configuration

Everything tunable is in `js/config.js`: sizes, detector thresholds, trial counts, timeouts and the switch policy. Detector thresholds can also be adjusted live in **Sensor monitor** and saved per device.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Motion sensors not active" on a phone | The page must be HTTPS (GitHub Pages). On iPhone, tap **Enable** → Allow. If you tapped Deny, close the tab or app and reopen it. On Android Chrome, check Site settings → Motion sensors. |
| Walking is not detected | Open **Sensor monitor** while walking. If σ stays below the dashed *enter* line, lower the threshold (or calibrate in the study flow). |
| The layout switches while standing | Raise *Enter σ*, or calibrate. |
| Exported file not found on iPhone | Use **Share files → Save to Files** or AirDrop, or **Copy JSON** and paste it into a note. |

## Privacy

Everything stays on the phone (localStorage) until you export it. The app makes no network requests besides loading its own files.
