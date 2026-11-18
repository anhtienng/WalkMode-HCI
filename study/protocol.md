# WalkMode study protocol

Experimenter guide for running one session (~30–35 min per participant).

## 1. Design at a glance

| | |
|---|---|
| Design | 2 × 2 within-subjects: **Interface** (Standard, WalkMode) × **Mobility** (Standing, Walking) |
| Order | Balanced 4 × 4 Latin square, assigned automatically from the participant ID (P01 → row 1, P02 → row 2, …) |
| Tasks per block | App launcher × 10, Contacts × 6, Settings × 5 = 21 trials |
| Measures | Completion time, selection errors, missed taps, NASA-TLX (raw), preference + Likert, detector logs |
| Sample | Multiple of 4 (12 or 16) so every order row is used equally |

Condition orders (rows of the square). The app shows the row for each participant:

| Row | Block 1 | Block 2 | Block 3 | Block 4 |
|---|---|---|---|---|
| 1 (P01, P05, P09…) | Standard · Standing | Standard · Walking | WalkMode · Walking | WalkMode · Standing |
| 2 (P02, P06, P10…) | Standard · Walking | WalkMode · Standing | Standard · Standing | WalkMode · Walking |
| 3 (P03, P07, P11…) | WalkMode · Standing | WalkMode · Walking | Standard · Walking | Standard · Standing |
| 4 (P04, P08, P12…) | WalkMode · Walking | Standard · Standing | WalkMode · Standing | Standard · Walking |

## 2. Before the study (once)

- [ ] Check with your instructor whether the class project needs IRB review or an exemption. Adapt `study/consent.md`.
- [ ] Deploy the app to GitHub Pages (see README) and open it on the study phone.
- [ ] Add the page to the home screen (iOS: Share → *Add to Home Screen*; Android: ⋮ → *Install app*). This hides the browser bars, so the layout is the same for everyone.
- [ ] Pick the walking route: an indoor corridor loop of about 20–40 m, level, no stairs or doors, low traffic. Mark a start point and a standing spot.
- [ ] Open **Sensor monitor**, walk the route, and confirm the state turns *Walking* within ~3 s and returns to *Stationary* a few seconds after stopping. If it doesn't, adjust the thresholds and tap *Save on this device*.
- [ ] Run 1–2 pilot participants. Export their data and run the analysis to check that the files parse. Treat pilot data as pilot data: don't include it in the results.

## 3. Before each session

- [ ] Phone charged (>50 %), brightness at about 75 % with auto-brightness off, Do Not Disturb on, auto-lock not an issue (the app holds a wake lock).
- [ ] Previous session exported (Home → Sessions & export).
- [ ] App open on the home screen. The green dot in the header means the phone's sensors are active. An orange dot means **simulated**, which is wrong for a real session.
- [ ] Route clear. Have a printed consent form and a pen.

## 4. Session script

Say the quoted text more or less as written so every participant hears the same instructions.

### 4.1 Welcome and consent (~3 min)

> "Thanks for coming. Today you'll do short tapping tasks on a phone, sometimes standing and sometimes walking down this corridor. We are testing two versions of an interface, not you. There are no right or wrong answers. Tell me at any time if you want to stop. I'll walk behind you while you walk, for safety."

Get signed consent.

### 4.2 Setup (experimenter, ~2 min)

1. Tap **New study session** and enter the participant ID (`P01`, `P02`, …). Check the condition order shown.
2. Set the hand (dominant) and grip (**one hand, thumb**) and add any notes (route, anything unusual).
3. Hand the phone over so the participant can fill in the *About you* questions, then tap **Continue**.

### 4.3 Sensors and calibration (~1 min)

1. On iPhone, tap **Enable motion sensors** → *Allow*.
2. Tap **Calibrate**.
   - Stage 1: the participant stands still and taps the dots.
   - Stage 2: the participant starts walking the route, then taps *I'm walking — start* and keeps walking until it finishes.
3. If the result says the walking and standing signals were clearly different, tap **Use these thresholds**; otherwise **Redo** or **Keep current thresholds**.

### 4.4 Practice (~4 min)

> "Hold the phone in your right hand (or left, if that's your dominant hand) and use only your thumb. Work at a natural pace: try to be accurate, but don't slow down artificially."

The app runs one practice pass in the standard layout and one in the enlarged WalkMode layout. Repeat the practice if the participant seems unsure.

### 4.5 Blocks (4 × ~4 min)

For each block the app shows the condition, for example **WalkMode · Walking**.

- **Standing blocks:** the participant stands at the marked spot.
  > "Please stand here for this whole block."
- **Walking blocks:** the participant starts walking first, then taps **Start block**.
  > "Start walking the loop at your normal pace and keep walking until the questionnaire appears. If you reach the end, turn around and keep going."
- **WalkMode blocks:**
  > "In this block the layout may get bigger automatically while you walk."
- **Standard blocks:**
  > "In this block the layout stays the same."

During walking blocks, walk 1–2 m behind the participant on their non-dominant side. Watch for obstacles and people.

If something interrupts a block (someone blocks the route, a phone call, a stumble), tap **Restart block** twice in the footer. The partial data is kept separately and the block starts over. Use **Skip trial** only if a trial is stuck.

After each block the participant **stops walking** and fills in the NASA-TLX on the spot. Offer a short break between blocks.

### 4.6 Final questions (~3 min)

The participant answers the preference and Likert questions and any free-text comments. Then ask:

> "Was there anything about the automatic switching that surprised you?"

Write the answer in your notes.

### 4.7 Export and wrap-up (~1 min)

- On the **Thank you** screen, tap **Share files** (AirDrop or email to yourself) or **Download JSON**.
- Copy the `.json` file into the repository's `data/` folder on your computer. The folder is git-ignored, so participant data is never pushed to the public repository.
- Thank the participant.

## 5. Data handling

- Use participant IDs only; never write names into the app. Store consent forms separately from the data.
- Keep `data/` out of git (already in `.gitignore`). GitHub Pages repositories are public.
- After exporting, keep sessions on the phone until the analysis is done, then delete them (Sessions → Delete, tap twice).

## 6. Analysis

```bash
module load scipy-stack/2026a      # on the cluster; elsewhere: pip install -r analysis/requirements.txt
python analysis/analyze.py         # reads data/*.json
```

Results go to `analysis/output/summary.md`. Figures and LaTeX for the report go to `report/generated/`.

## Appendix A — NASA-TLX items (as shown in the app)

Each item is rated 0–100 in steps of 5.

| Scale | Question | Anchors |
|---|---|---|
| Mental demand | How mentally demanding was the task? | Very low – Very high |
| Physical demand | How physically demanding was the task? | Very low – Very high |
| Temporal demand | How hurried or rushed was the pace of the task? | Very low – Very high |
| Performance | How successful were you in accomplishing what you were asked to do? | Perfect – Failure |
| Effort | How hard did you have to work to accomplish your level of performance? | Very low – Very high |
| Frustration | How insecure, discouraged, irritated, stressed, and annoyed were you? | Very low – Very high |

## Appendix B — Final questionnaire (as shown in the app)

1. While **standing**, which interface did you prefer? Standard / WalkMode / No preference
2. While **walking**, which interface did you prefer? Standard / WalkMode / No preference
3. **Overall**, which interface did you prefer? Standard / WalkMode / No preference
4. Rate each statement from 1 (strongly disagree) to 7 (strongly agree):
   - I noticed when the WalkMode layout changed.
   - The layout change was disruptive.
   - The enlarged layout made it easier to tap while walking.
   - WalkMode correctly recognized when I was walking.
   - I would turn WalkMode on for my own phone.
5. What did you like about WalkMode? What did you dislike or find confusing? Any other comments?
