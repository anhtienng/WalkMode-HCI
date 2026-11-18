#!/usr/bin/env python3
"""Generate SYNTHETIC WalkMode sessions in the app's export schema.

These files exist only to test the analysis pipeline end to end. They are NOT
results and must never be reported as data. Every session is tagged
`"synthetic": true` and participant IDs start with "S".

The generator is a small generative model of tapping, not hard-coded effects:
each tap lands at the intended target's centre plus Gaussian scatter whose
spread grows while walking; whether it hits, misses (lands in a gap) or selects
a neighbour depends on the target size and spacing of the current layout.
WalkMode's benefit therefore *emerges* from its bigger targets and gaps, and
only in blocks where the detector reports walking.

Usage:
    python analysis/make_synthetic.py                 # 12 participants -> analysis/synthetic/
    python analysis/make_synthetic.py -n 16 --seed 3 --out some/dir
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

CONDITIONS = [
    {"code": "STD-STAND", "iface": "standard", "mobility": "standing"},
    {"code": "STD-WALK", "iface": "standard", "mobility": "walking"},
    {"code": "WM-STAND", "iface": "walkmode", "mobility": "standing"},
    {"code": "WM-WALK", "iface": "walkmode", "mobility": "walking"},
]
SQUARE = [[0, 1, 3, 2], [1, 2, 0, 3], [2, 3, 1, 0], [3, 0, 2, 1]]  # same Williams square as js/latin.js
TRIALS = {"grid": 10, "list": 6, "nav": 5}
APPS = ["Camera", "Photos", "Mail", "Maps", "Music", "Clock", "Notes", "Wallet", "Weather", "Phone",
        "Files", "Books", "Health", "News", "Radio", "Stocks", "Timer", "Tasks", "Chat", "Video"]

# Effective target geometry (w, h, gap) per task step and layout mode, in CSS px (mirrors css/app.css).
GEOM = {
    "standard": {"grid": (40, 54, 6), "list": (340, 44, 6), "cat": (340, 44, 6), "switch": (40, 24, 10), "back": (36, 36, 8)},
    "walking": {"grid": (64, 80, 16), "list": (330, 64, 16), "cat": (330, 64, 16), "switch": (60, 36, 14), "back": (56, 56, 12)},
}
BASE_TIME = {"grid": 1.25, "list": 2.6, "nav": 1.6}  # visual search / planning (s)


def tap_outcome(rng, w, h, gap, sigma):
    dx, dy = rng.normal(0, sigma, 2)
    ex = abs(dx) - w / 2
    ey = abs(dy) - h / 2
    if ex <= 0 and ey <= 0:
        return "hit", dx, dy
    over = max(ex, ey)
    return ("miss" if over <= gap else "selection_error"), dx, dy


def simulate_session(pid: str, row: int, rng: np.random.Generator, t0_ms: int) -> dict:
    skill = math.exp(rng.normal(0, 0.18))        # participant speed factor
    steadiness = math.exp(rng.normal(0, 0.20))   # participant tap-scatter factor
    tlx_offset = rng.normal(0, 8)
    order = [CONDITIONS[i]["code"] for i in SQUARE[row]]
    blocks = []
    clock = t0_ms + 5 * 60_000

    for bi, code in enumerate(order):
        cond = next(c for c in CONDITIONS if c["code"] == code)
        walking = cond["mobility"] == "walking"
        wm = cond["iface"] == "walkmode"
        latency = float(rng.normal(2.7, 0.4)) if walking else None   # detector onset (s) after block start
        false_pos = (not walking) and rng.random() < 0.08              # rare false alarm while standing
        sigma = (13.0 if walking else 6.5) * steadiness   # px per axis (~2 mm standing, ~3.3 mm walking)
        slow = 1.18 if walking else 1.0

        trials, taps, t = [], [], 4.0  # countdown first
        seq = 0
        for task, n in TRIALS.items():
            t += 2.0  # segment intro screen
            for k in range(n):
                det_walk = walking and t >= latency
                if false_pos and 30 < t < 36:
                    det_walk = True
                mode = "walking" if (wm and det_walk) else "standard"
                steps = ["grid"] if task == "grid" else ["list"] if task == "list" else ["cat", "switch"]
                start = t
                t += BASE_TIME[task] * skill * slow * math.exp(rng.normal(0, 0.25))
                n_err = n_miss = n_taps = 0
                first_tap = None
                ok = True
                trial_taps = []
                for step in steps:
                    w, h, gap = GEOM[mode][step]
                    for attempt in range(12):
                        mt = (0.22 + 0.11 * math.log2(1 + 80 / min(w, h))) * skill * slow
                        t += mt
                        cls, dx, dy = tap_outcome(rng, w, h, gap, sigma)
                        n_taps += 1
                        if first_tap is None:
                            first_tap = t - start
                        trial_taps.append({
                            "t": round(t * 1000), "block": bi, "seq": seq, "task": task, "practice": False, "cls": cls,
                            "x": None, "y": None, "upX": None, "upY": None, "durMs": int(rng.normal(110, 25)), "moved": int(abs(rng.normal(0, 2))),
                            "hitId": None, "intendedId": f"{task}:{step}", "dx": round(dx, 1), "dy": round(dy, 1),
                            "edgeDist": round(max(0.0, max(abs(dx) - w / 2, abs(dy) - h / 2)), 1),
                            "intendedW": w, "intendedH": h, "mode": mode,
                            "detector": "walking" if det_walk else "stationary", "pointerType": "touch",
                        })
                        if cls == "hit":
                            break
                        if cls == "selection_error":
                            n_err += 1
                            t += 0.9 if step == "cat" else 0.45   # wrong page → back button costs time
                        else:
                            n_miss += 1
                            t += 0.25
                    else:
                        ok = False
                dur = t - start
                timeout = dur > {"grid": 15, "list": 20, "nav": 25}[task]
                if timeout:
                    ok = False
                    dur = {"grid": 15, "list": 20, "nav": 25}[task]
                trials.append({
                    "block": bi, "seq": seq, "trial": k, "task": task, "practice": False,
                    "target": APPS[int(rng.integers(len(APPS)))] if task == "grid" else f"target-{k}",
                    "meta": {}, "tStart": round(start * 1000), "tEnd": round((start + dur) * 1000),
                    "durationMs": round(dur * 1000), "outcome": "success" if ok else "timeout",
                    "success": ok, "timeout": timeout, "taps": n_taps, "selectionErrors": n_err, "misses": n_miss,
                    "firstTapMs": round(first_tap * 1000) if first_tap else None,
                    "modeAtStart": mode, "modeAtEnd": mode, "modeSwitches": 0, "modeEvents": [],
                    "detectorAtStart": "walking" if det_walk else "stationary",
                    "detectorAtEnd": "walking" if det_walk else "stationary",
                    "adaptationEnabled": wm,
                    "layout": {"target": 64 if mode == "walking" else 40, "gap": 16 if mode == "walking" else 6},
                    "extra": {},
                })
                taps.extend(trial_taps)
                seq += 1
                t += 0.35
        dur_s = t
        motion = []
        for s in range(int(dur_s)):
            w_on = walking and s >= latency
            if false_pos and 30 < s < 36:
                w_on = True
            motion.append({
                "t": s * 1000,
                "sigma": round(float(rng.normal(1.15, 0.15) if walking and s > 1 else abs(rng.normal(0.14, 0.04))), 3),
                "cadence": round(float(rng.normal(1.75, 0.08)) if walking and s > 1 else 0.0, 2),
                "cv": 0.12 if walking else None,
                "state": "walking" if w_on else "stationary",
                "mode": "walking" if (wm and w_on) else "standard",
                "source": "device",
            })
        timeline = [{"t": 0, "mode": "standard", "enabled": wm, "initial": True}]
        det_tl = [{"t": 0, "state": "stationary", "initial": True}]
        if walking:
            det_tl.append({"t": round(latency * 1000), "state": "walking"})
            if wm:
                timeline.append({"t": round(latency * 1000) + 300, "from": "standard", "to": "walking", "reason": "detector", "deferredMs": 300, "detector": "walking"})
        if false_pos:
            det_tl += [{"t": 30_000, "state": "walking"}, {"t": 36_000, "state": "stationary"}]
            if wm:
                timeline += [{"t": 30_200, "from": "standard", "to": "walking", "reason": "detector", "deferredMs": 200, "detector": "walking"},
                             {"t": 36_400, "from": "walking", "to": "standard", "reason": "detector", "deferredMs": 400, "detector": "stationary"}]

        base = 22 + (20 if walking else 0) - (9 if (walking and wm) else 0) + tlx_offset
        tlx = {}
        for key, shift in [("mental", -2), ("physical", 6 if walking else -6), ("temporal", 0), ("performance", -4), ("effort", 3), ("frustration", -3)]:
            tlx[key] = int(np.clip(round((base + shift + rng.normal(0, 9)) / 5) * 5, 0, 100))
        tlx["raw"] = round(sum(tlx.values()) / 6, 1)

        blocks.append({
            "index": bi, "practice": False, "condition": cond,
            "startedAt": clock, "endedAt": clock + round(dur_s * 1000), "durationMs": round(dur_s * 1000),
            "thresholds": {"enterSigma": 0.6, "exitSigma": 0.35}, "sensorSource": "device",
            "trials": trials, "taps": taps, "modeTimeline": timeline, "detectorTimeline": det_tl,
            "motion": motion, "tlx": tlx,
        })
        clock += round(dur_s * 1000) + 120_000

    def choose(p):
        return ["standard", "walkmode", "none"][int(rng.choice(3, p=p))]

    pref = {
        "standing": choose([0.35, 0.25, 0.40]),
        "walking": choose([0.12, 0.78, 0.10]),
        "overall": choose([0.20, 0.65, 0.15]),
        "likert": {
            "noticed": int(np.clip(round(rng.normal(5.8, 0.9)), 1, 7)),
            "disruptive": int(np.clip(round(rng.normal(2.6, 1.1)), 1, 7)),
            "easierWalking": int(np.clip(round(rng.normal(5.9, 0.9)), 1, 7)),
            "detectionAccurate": int(np.clip(round(rng.normal(5.4, 1.0)), 1, 7)),
            "wouldUse": int(np.clip(round(rng.normal(5.1, 1.2)), 1, 7)),
        },
        "liked": "", "disliked": "", "comments": "",
    }
    return {
        "schema": "walkmode-session/1", "appVersion": "1.0.0", "synthetic": True,
        "sessionId": f"syn_{pid}", "participantId": pid,
        "createdAt": t0_ms, "updatedAt": clock, "completedAt": clock,
        "status": "complete", "stage": "done", "order": order, "orderRow": row,
        "posture": {"hand": "right", "grip": "one-thumb"},
        "demographics": {"ageRange": str(rng.choice(["18-24", "25-34"])), "gender": "", "handedness": "right",
                          "phoneOS": str(rng.choice(["ios", "android"])), "phoneHours": "3-5", "walkUseFreq": "often"},
        "device": {"userAgent": "synthetic", "screenW": 390, "screenH": 844, "viewportW": 390, "viewportH": 700, "dpr": 3},
        "sensor": {"source": "device"}, "thresholds": {"enterSigma": 0.6, "exitSigma": 0.35},
        "calibration": None, "config": {}, "practice": None, "blocks": blocks, "abortedBlocks": [],
        "currentBlock": None, "preference": pref, "notes": "SYNTHETIC — pipeline test only",
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", type=int, default=12, help="participants (use a multiple of 4)")
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "synthetic")
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("walkmode_S*.json"):
        old.unlink()
    t0 = int(time.time() * 1000)
    for i in range(1, args.n + 1):
        pid = f"S{i:02d}"
        s = simulate_session(pid, (i - 1) % 4, rng, t0 + i * 3_600_000)
        (args.out / f"walkmode_{pid}_synthetic.json").write_text(json.dumps(s))
    print(f"wrote {args.n} SYNTHETIC sessions to {args.out}")


if __name__ == "__main__":
    main()
