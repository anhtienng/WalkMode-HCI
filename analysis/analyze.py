#!/usr/bin/env python3
"""WalkMode study analysis.

Reads session JSON files exported by the app, builds tidy tables, runs the
2 (Interface: Standard, WalkMode) x 2 (Mobility: Standing, Walking)
within-subjects analysis, and writes figures + LaTeX for the report.

    module load scipy-stack/2026a            # on the cluster (numpy, pandas, scipy, matplotlib)
    python analysis/analyze.py               # reads data/*.json
    python analysis/analyze.py --data analysis/synthetic   # pipeline test with synthetic data

Outputs
    analysis/output/   tidy CSVs (trials, taps, tlx, blocks, prefs, agg), stats.json, summary.md
    report/generated/  fig_*.pdf/.png, tables.tex, numbers.tex (macros used by report/walkmode.tex)

Statistics
    * Completion time: geometric mean of successful trials per participant x condition,
      analysed on the log scale.
    * Selection errors and missed taps: mean per trial. NASA-TLX: raw (unweighted) mean of 6 scales.
    * 2x2 repeated-measures ANOVA. With two levels per factor every effect has 1 df, so each
      F equals t^2 of the corresponding per-participant contrast (exact, no sphericity issue).
    * Planned comparisons (Standard vs WalkMode within Walking and within Standing):
      paired t-test on log time, Wilcoxon signed-rank for errors / misses / TLX, Holm-corrected
      within each measure. Effect size: dz for t-tests, r = Z / sqrt(N) for Wilcoxon.
    * Standing equivalence for time (H3): TOST on log time, bounds +-10 %.
    * Preferences: binomial test (WalkMode vs Standard, "no preference" excluded).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from scipy import stats
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker
    from matplotlib.patches import Rectangle
except ImportError as e:  # pragma: no cover
    sys.exit(f"Missing dependency ({e.name}). On the cluster run: module load scipy-stack/2026a\n"
             "Elsewhere: pip install -r analysis/requirements.txt")

ROOT = Path(__file__).resolve().parents[1]
CONDS = [("standard", "standing"), ("walkmode", "standing"), ("standard", "walking"), ("walkmode", "walking")]
CODE = {("standard", "standing"): "STD-STAND", ("walkmode", "standing"): "WM-STAND",
        ("standard", "walking"): "STD-WALK", ("walkmode", "walking"): "WM-WALK"}
IFACE_LABEL = {"standard": "Standard", "walkmode": "WalkMode"}
MOB_LABEL = {"standing": "Standing", "walking": "Walking"}
TASK_LABEL = {"grid": "App launcher", "list": "Contacts", "nav": "Settings"}
TLX_KEYS = ["mental", "physical", "temporal", "performance", "effort", "frustration"]

# Measures analysed (key, label, short label for macros, use log for inference)
MEASURES = [
    ("time_s", "Completion time (s)", "Time", True),
    ("errors", "Selection errors / trial", "Errors", False),
    ("misses", "Missed taps / trial", "Misses", False),
    ("tlx", "NASA-TLX (0-100)", "Tlx", False),
]

# ---- chart styling (reference palette slots 1-2, validated; see README) ----
COLOR = {"standard": "#2a78d6", "walkmode": "#eb6834"}
NEUTRAL = "#b9b8b3"
INK, INK2, GRIDC = "#0b0b0b", "#52514e", "#e4e3df"
plt.rcParams.update({
    "font.family": "sans-serif", "font.size": 8, "axes.titlesize": 8.5, "axes.labelsize": 8,
    "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "axes.grid.axis": "y",
    "grid.color": GRIDC, "grid.linewidth": 0.6, "axes.axisbelow": True, "legend.frameon": False,
    "figure.dpi": 150, "savefig.bbox": "tight", "savefig.pad_inches": 0.03, "pdf.fonttype": 42,
})


# =============================================================== loading
def load_sessions(data_dirs: list[Path], include_incomplete: bool) -> list[dict]:
    seen: dict[str, dict] = {}
    for d in data_dirs:
        files = [d] if d.is_file() else sorted(d.rglob("*.json"))
        for f in files:
            try:
                s = json.loads(f.read_text())
            except (json.JSONDecodeError, UnicodeDecodeError):
                print(f"  skip {f}: not JSON", file=sys.stderr)
                continue
            if not isinstance(s, dict) or not str(s.get("schema", "")).startswith("walkmode-session/"):
                continue
            prev = seen.get(s["sessionId"])
            if prev is None or s.get("updatedAt", 0) > prev.get("updatedAt", 0):
                s["_file"] = str(f)
                seen[s["sessionId"]] = s
    sessions = []
    for s in seen.values():
        n = len(s.get("blocks", []))
        if n < 4 and not include_incomplete:
            print(f"  exclude {s['participantId']} ({s['_file']}): {n}/4 blocks", file=sys.stderr)
            continue
        sessions.append(s)
    pids = [s["participantId"] for s in sessions]
    dup = {p for p in pids if pids.count(p) > 1}
    if dup:
        print(f"  WARNING: several sessions for {sorted(dup)}; keeping the most complete/latest of each", file=sys.stderr)
        best = {}
        for s in sessions:
            k = s["participantId"]
            if k not in best or (len(s["blocks"]), s.get("updatedAt", 0)) > (len(best[k]["blocks"]), best[k].get("updatedAt", 0)):
                best[k] = s
        sessions = list(best.values())
    return sorted(sessions, key=lambda s: s["participantId"])


# =============================================================== tidy tables
def tidy(sessions: list[dict]) -> dict[str, pd.DataFrame]:
    trials, taps, tlx, blocks, prefs, parts = [], [], [], [], [], []
    for s in sessions:
        pid = s["participantId"]
        parts.append({"participant": pid, "synthetic": bool(s.get("synthetic")), "orderRow": s.get("orderRow"),
                      "order": " > ".join(s.get("order", [])), "sensor": (s.get("sensor") or {}).get("source"),
                      "calibrated": bool(s.get("calibration")), "aborted_blocks": len(s.get("abortedBlocks", [])),
                      **{f"demo_{k}": v for k, v in (s.get("demographics") or {}).items()},
                      **{f"posture_{k}": v for k, v in (s.get("posture") or {}).items()},
                      "device": (s.get("device") or {}).get("userAgent", "")})
        for pos, b in enumerate(s.get("blocks", [])):
            c = b["condition"]
            key = dict(participant=pid, position=pos, condition=c["code"], iface=c["iface"], mobility=c["mobility"])
            for t in b["trials"]:
                trials.append({**key, "seq": t["seq"], "task": t["task"], "durationMs": t["durationMs"],
                               "success": bool(t["success"]), "timeout": bool(t["timeout"]), "outcome": t["outcome"],
                               "taps": t["taps"], "selectionErrors": t["selectionErrors"], "misses": t["misses"],
                               "firstTapMs": t.get("firstTapMs"), "modeAtStart": t.get("modeAtStart"),
                               "modeSwitches": t.get("modeSwitches", 0), "detectorAtStart": t.get("detectorAtStart")})
            for tp in b["taps"]:
                if tp.get("cls") not in ("hit", "selection_error", "miss"):
                    continue
                taps.append({**key, "seq": tp.get("seq"), "task": tp.get("task"), "cls": tp["cls"],
                             "dx": tp.get("dx"), "dy": tp.get("dy"), "edgeDist": tp.get("edgeDist"),
                             "w": tp.get("intendedW"), "h": tp.get("intendedH"), "mode": tp.get("mode"),
                             "durMs": tp.get("durMs")})
            if b.get("tlx"):
                tlx.append({**key, **{k: b["tlx"].get(k) for k in TLX_KEYS}, "raw": b["tlx"].get("raw")})
            m = b.get("motion") or []
            dtl = b.get("detectorTimeline") or []
            mtl = [e for e in (b.get("modeTimeline") or []) if not e.get("initial")]
            first_walk = next((e["t"] / 1000 for e in dtl if e.get("state") == "walking" and not e.get("initial")), None)
            walking_samples = [x for x in m if x.get("state") == "walking"]
            blocks.append({**key, "durationS": (b.get("durationMs") or 0) / 1000, "n_trials": len(b["trials"]),
                           "sensor": b.get("sensorSource"),
                           "detectWalkFrac": (len(walking_samples) / len(m)) if m else np.nan,
                           "walkModeFrac": (sum(1 for x in m if x.get("mode") == "walking") / len(m)) if m else np.nan,
                           "firstWalkS": first_walk,
                           "anyWalkDetected": first_walk is not None,
                           "layoutSwitches": len(mtl),
                           "cadenceHz": float(np.nanmedian([x["cadence"] for x in walking_samples if x.get("cadence")])) if walking_samples else np.nan,
                           "sigmaMedian": float(np.nanmedian([x["sigma"] for x in m if x.get("sigma") is not None])) if m else np.nan})
        p = s.get("preference")
        if p:
            prefs.append({"participant": pid, "standing": p.get("standing"), "walking": p.get("walking"),
                          "overall": p.get("overall"), **{f"likert_{k}": v for k, v in (p.get("likert") or {}).items()},
                          "liked": p.get("liked", ""), "disliked": p.get("disliked", ""), "comments": p.get("comments", "")})
    return {k: pd.DataFrame(v) for k, v in
            dict(trials=trials, taps=taps, tlx=tlx, blocks=blocks, prefs=prefs, participants=parts).items()}


def aggregate(T: dict[str, pd.DataFrame], by_task: bool = False) -> pd.DataFrame:
    tr = T["trials"]
    keys = ["participant", "iface", "mobility"] + (["task"] if by_task else [])
    ok = tr[tr.success]
    time = ok.groupby(keys)["durationMs"].apply(lambda x: float(np.exp(np.mean(np.log(x / 1000))))).rename("time_s")
    g = tr.groupby(keys)
    agg = pd.concat([time, g["selectionErrors"].mean().rename("errors"), g["misses"].mean().rename("misses"),
                     g["timeout"].mean().rename("timeout_rate"), g["success"].mean().rename("success_rate"),
                     g.size().rename("n_trials")], axis=1).reset_index()
    if not by_task and len(T["tlx"]):
        agg = agg.merge(T["tlx"][["participant", "iface", "mobility", "raw"]].rename(columns={"raw": "tlx"}),
                        on=["participant", "iface", "mobility"], how="left")
    return agg


# =============================================================== statistics
def cells(agg: pd.DataFrame, dv: str) -> pd.DataFrame:
    """participant x 4 conditions (complete cases only)."""
    w = agg.pivot_table(index="participant", columns=["iface", "mobility"], values=dv)
    w = w.reindex(columns=pd.MultiIndex.from_tuples(CONDS))
    return w.dropna()


def fmt_p(p: float) -> str:
    if p is None or not np.isfinite(p):
        return "--"
    return "<.001" if p < 0.001 else f"={p:.3f}".replace("0.", ".")


def rm_anova_2x2(agg: pd.DataFrame, dv: str, log: bool) -> dict:
    w = cells(agg, dv)
    y = np.log(w) if log else w
    n = len(y)
    s_s, w_s = y[("standard", "standing")], y[("walkmode", "standing")]
    s_w, w_w = y[("standard", "walking")], y[("walkmode", "walking")]
    contrasts = {
        "iface": ((w_s - s_s) + (w_w - s_w)) / 2,
        "mobility": ((s_w - s_s) + (w_w - w_s)) / 2,
        "interaction": (w_w - s_w) - (w_s - s_s),
    }
    out = {"n": n}
    for name, c in contrasts.items():
        c = np.asarray(c, float)
        sd = c.std(ddof=1) if n > 1 else np.nan
        if n < 2 or not np.isfinite(sd):
            out[name] = dict(F=np.nan, df1=1, df2=n - 1, p=np.nan, eta_p2=np.nan)
            continue
        if sd == 0:
            t = 0.0 if c.mean() == 0 else np.inf
        else:
            t = c.mean() / (sd / math.sqrt(n))
        F = t * t
        p = float(2 * stats.t.sf(abs(t), n - 1)) if np.isfinite(t) else 0.0
        out[name] = dict(F=float(F), df1=1, df2=n - 1, p=p, eta_p2=float(F / (F + n - 1)) if np.isfinite(F) else 1.0)
    return out


def holm(ps: list[float]) -> list[float]:
    idx = sorted(range(len(ps)), key=lambda i: (np.inf if not np.isfinite(ps[i]) else ps[i]))
    adj = [np.nan] * len(ps)
    running = 0.0
    m = len(ps)
    for rank, i in enumerate(idx):
        if not np.isfinite(ps[i]):
            continue
        running = max(running, min(1.0, (m - rank) * ps[i]))
        adj[i] = running
    return adj


def wilcoxon(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float]:
    d = np.asarray(y, float) - np.asarray(x, float)
    nz = d[d != 0]
    if len(nz) == 0:
        return 0.0, 1.0, 0.0
    res = stats.wilcoxon(x, y, zero_method="wilcox")
    p = float(res.pvalue)
    # r = Z / sqrt(N) with Z from the normal approximation of W (N = non-zero pairs)
    n = len(nz)
    mu, sd = n * (n + 1) / 4, math.sqrt(n * (n + 1) * (2 * n + 1) / 24)
    z = abs(float(res.statistic) - mu) / sd * np.sign(np.median(nz))
    return float(res.statistic), p, float(z / math.sqrt(n))


def planned(agg: pd.DataFrame, dv: str, log: bool) -> dict:
    w = cells(agg, dv)
    out = {}
    for mob in ("walking", "standing"):
        a = w[("standard", mob)].to_numpy(float)
        b = w[("walkmode", mob)].to_numpy(float)
        r = {"n": len(a), "mean_standard": float(np.mean(a)) if len(a) else np.nan,
             "mean_walkmode": float(np.mean(b)) if len(b) else np.nan}
        if log:
            la, lb = np.log(a), np.log(b)
            d = lb - la
            t = stats.ttest_rel(lb, la)
            r.update(test="paired t (log)", stat=float(t.statistic), df=len(a) - 1, p=float(t.pvalue),
                     effect=float(d.mean() / d.std(ddof=1)) if d.std(ddof=1) > 0 else np.nan, effect_name="dz",
                     ratio=float(np.exp(d.mean())))
        else:
            W, p, rr = wilcoxon(a, b)
            r.update(test="Wilcoxon", stat=W, df=None, p=p, effect=rr, effect_name="r",
                     diff=float(np.mean(b - a)))
        out[mob] = r
    adj = holm([out["walking"]["p"], out["standing"]["p"]])
    out["walking"]["p_holm"], out["standing"]["p_holm"] = adj
    return out


def tost_log(a: np.ndarray, b: np.ndarray, bound: float = 0.10) -> dict:
    """Two one-sided paired t-tests on log(b/a) with equivalence bounds +-log(1+bound)."""
    d = np.log(b) - np.log(a)
    n = len(d)
    if n < 3:
        return {"p": np.nan, "equivalent": None, "bound": bound}
    se = d.std(ddof=1) / math.sqrt(n)
    lo, hi = -math.log(1 + bound), math.log(1 + bound)
    p1 = stats.t.sf((d.mean() - lo) / se, n - 1)
    p2 = stats.t.cdf((d.mean() - hi) / se, n - 1)
    p = float(max(p1, p2))
    ci = stats.t.interval(0.90, n - 1, loc=d.mean(), scale=se)
    return {"p": p, "equivalent": bool(p < 0.05), "bound": bound,
            "ratio": float(math.exp(d.mean())), "ratio_ci90": [float(math.exp(ci[0])), float(math.exp(ci[1]))]}


def within_ci(agg: pd.DataFrame, dv: str, log: bool) -> pd.DataFrame:
    """Cousineau-Morey within-subject 95% CIs per condition. Log measures are summarised geometrically."""
    w = cells(agg, dv)
    y = np.log(w) if log else w
    n, J = y.shape
    norm = y.sub(y.mean(axis=1), axis=0) + float(y.to_numpy().mean())
    sd = norm.std(ddof=1) * math.sqrt(J / (J - 1))
    half = stats.t.ppf(0.975, n - 1) * sd / math.sqrt(n) if n > 1 else sd * np.nan
    m = y.mean()
    rows = []
    for c in CONDS:
        lo, mid, hi = m[c] - half[c], m[c], m[c] + half[c]
        if log:
            lo, mid, hi = np.exp(lo), np.exp(mid), np.exp(hi)
        rows.append({"iface": c[0], "mobility": c[1], "mean": float(mid), "lo": float(lo), "hi": float(hi),
                     "sd": float(w[c].std(ddof=1)), "n": n})
    return pd.DataFrame(rows)


def preference_stats(prefs: pd.DataFrame) -> dict:
    out = {}
    for q in ("standing", "walking", "overall"):
        if q not in prefs:
            continue
        v = prefs[q].value_counts()
        k_wm, k_std, k_none = int(v.get("walkmode", 0)), int(v.get("standard", 0)), int(v.get("none", 0))
        n = k_wm + k_std
        p = float(stats.binomtest(k_wm, n, 0.5).pvalue) if n else np.nan
        out[q] = {"walkmode": k_wm, "standard": k_std, "none": k_none, "binom_p": p}
    lik = {c[len("likert_"):]: {"median": float(prefs[c].median()), "iqr": [float(prefs[c].quantile(.25)), float(prefs[c].quantile(.75))]}
           for c in prefs.columns if c.startswith("likert_")}
    out["likert"] = lik
    return out


def detector_stats(blocks: pd.DataFrame) -> dict:
    out = {}
    for (iface, mob), g in blocks.groupby(["iface", "mobility"]):
        out[CODE[(iface, mob)]] = {
            "detectWalkPct": float(100 * g.detectWalkFrac.mean()),
            "walkModePct": float(100 * g.walkModeFrac.mean()),
            "blocksWithWalkDetected": int(g.anyWalkDetected.sum()), "blocks": int(len(g)),
            "firstWalkS_median": float(g.firstWalkS.median()) if g.firstWalkS.notna().any() else None,
            "layoutSwitches_mean": float(g.layoutSwitches.mean()),
            "cadence_spm": float(60 * g.cadenceHz.median()) if g.cadenceHz.notna().any() else None,
        }
    return out


# =============================================================== figures
def _dodge(i):
    return (-0.06, 0.06)[i]


def interaction_panel(ax, ci: pd.DataFrame, label: str, direct_labels: bool):
    xs = {"standing": 0, "walking": 1}
    ends = {}
    for i, iface in enumerate(("standard", "walkmode")):
        d = ci[ci.iface == iface].set_index("mobility").loc[["standing", "walking"]]
        x = np.array([xs[m] for m in d.index]) + _dodge(i)
        ax.plot(x, d["mean"], color=COLOR[iface], lw=2, marker="o", ms=5.5, mec="white", mew=1.2, zorder=3,
                label=IFACE_LABEL[iface])
        ax.vlines(x, d["lo"].clip(lower=0), d["hi"], color=COLOR[iface], lw=1.4, zorder=2)  # measures are >= 0
        ends[iface] = (x[-1], float(d["mean"].iloc[-1]))
    if direct_labels:
        # label line ends; push the two labels apart vertically so they never collide
        hi_iface = max(ends, key=lambda k: ends[k][1])
        for iface, (x, y) in ends.items():
            ax.annotate(IFACE_LABEL[iface], (x, y), xytext=(7, 5 if iface == hi_iface else -5), textcoords="offset points",
                        va="center", fontsize=7.5, color=INK)
    ax.set_xticks([0, 1], ["Standing", "Walking"])
    ax.set_xlim(-0.35, 1.75 if direct_labels else 1.35)
    ax.set_title(label, loc="left", color=INK)
    lo = min(0, ax.get_ylim()[0])
    ax.set_ylim(bottom=lo)


def fig_main(agg, outdir):
    fig, axes = plt.subplots(1, 4, figsize=(7.0, 2.1))
    for k, (ax, (dv, label, _, log)) in enumerate(zip(axes, MEASURES)):
        if dv not in agg or agg[dv].isna().all():
            ax.set_visible(False)
            continue
        interaction_panel(ax, within_ci(agg, dv, log), label, direct_labels=(k == 0))
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=2, bbox_to_anchor=(0.5, 1.08), fontsize=8)
    fig.tight_layout(w_pad=1.2)
    save(fig, outdir, "fig_main")


def fig_tasks(agg_task, outdir):
    fig, axes = plt.subplots(2, 3, figsize=(7.0, 3.6))
    for col, task in enumerate(("grid", "list", "nav")):
        a = agg_task[agg_task.task == task]
        for row, (dv, label, log) in enumerate([("time_s", "Completion time (s)", True), ("errors", "Selection errors / trial", False)]):
            ax = axes[row, col]
            interaction_panel(ax, within_ci(a, dv, log), TASK_LABEL[task] if row == 0 else "", direct_labels=(row == 0 and col == 0))
            if col == 0:
                ax.set_ylabel(label)
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=2, bbox_to_anchor=(0.5, 1.04), fontsize=8)
    fig.tight_layout(h_pad=1.2, w_pad=1.0)
    save(fig, outdir, "fig_tasks")


def fig_taps(taps, outdir):
    t = taps[(taps.task == "grid") & taps.dx.notna() & taps.w.notna()].copy()
    if t.empty:
        return
    t["nx"] = t.dx / t.w
    t["ny"] = t.dy / t.h
    fig, axes = plt.subplots(2, 2, figsize=(3.4, 3.5), sharex=True, sharey=True)
    for r, mob in enumerate(("standing", "walking")):
        for c, iface in enumerate(("standard", "walkmode")):
            ax = axes[r, c]
            d = t[(t.mobility == mob) & (t.iface == iface)]
            ax.add_patch(Rectangle((-0.5, -0.5), 1, 1, fill=False, ec=INK2, lw=0.8, ls="--", zorder=1))
            ax.scatter(d.nx, d.ny, s=6, color=COLOR[iface], alpha=0.45, lw=0, zorder=2)
            inside = ((d.nx.abs() <= 0.5) & (d.ny.abs() <= 0.5)).mean() if len(d) else np.nan
            ax.set_title(f"{IFACE_LABEL[iface]} · {MOB_LABEL[mob]}", loc="left", fontsize=7.5)
            ax.text(0.97, 0.04, f"{100 * inside:.0f}% inside", transform=ax.transAxes, ha="right", va="bottom", fontsize=7, color=INK)
            ax.set_xlim(-1.3, 1.3)
            ax.set_ylim(-1.3, 1.3)
            ax.set_aspect("equal")
            ax.grid(True, axis="both")
    for ax in axes[1]:
        ax.set_xlabel("x offset (target widths)")
    for ax in axes[:, 0]:
        ax.set_ylabel("y offset (heights)")
    fig.tight_layout()
    save(fig, outdir, "fig_taps")


def fig_tlx(tlx, outdir):
    if tlx.empty:
        return
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.0), sharey=True)
    keys = TLX_KEYS
    x = np.arange(len(keys))
    bw = 0.38
    for ax, mob in zip(axes, ("standing", "walking")):
        for i, iface in enumerate(("standard", "walkmode")):
            d = tlx[(tlx.mobility == mob) & (tlx.iface == iface)]
            m = d[keys].mean()
            se = d[keys].std(ddof=1) / math.sqrt(max(len(d), 1))
            pos = x + (i - 0.5) * (bw + 0.02)
            ax.bar(pos, m, width=bw, color=COLOR[iface], label=IFACE_LABEL[iface], zorder=2)
            ax.errorbar(pos, m, yerr=1.96 * se, fmt="none", ecolor=INK2, elinewidth=0.8, capsize=0, zorder=3)
        ax.set_xticks(x, ["Mental", "Physical", "Temporal", "Perform.", "Effort", "Frustr."], fontsize=7)
        ax.set_title(MOB_LABEL[mob], loc="left")
        ax.set_ylim(0, 100)
    axes[0].set_ylabel("Rating (0–100)")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=2, bbox_to_anchor=(0.5, 1.1), fontsize=8)
    fig.tight_layout()
    save(fig, outdir, "fig_tlx")


def fig_pref(pstats, outdir):
    qs = [q for q in ("standing", "walking", "overall") if q in pstats]
    if not qs:
        return
    fig, ax = plt.subplots(figsize=(3.4, 1.5))
    segs = [("walkmode", "WalkMode", COLOR["walkmode"]), ("standard", "Standard", COLOR["standard"]), ("none", "No preference", NEUTRAL)]
    for yi, q in enumerate(qs):
        left = 0
        for key, lab, col in segs:
            v = pstats[q][key]
            if v:
                ax.barh(yi, v, left=left, color=col, height=0.62, edgecolor="white", linewidth=2, label=lab if yi == 0 else None)
                ax.text(left + v / 2, yi, str(v), ha="center", va="center", fontsize=7.5,
                        color="white" if key != "none" else INK)
            left += v
    ax.set_yticks(range(len(qs)), [f"While {q}" if q != "overall" else "Overall" for q in qs])
    ax.invert_yaxis()
    ax.set_xlabel("Participants")
    ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(integer=True))
    ax.grid(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0)
    ax.legend(loc="lower center", bbox_to_anchor=(0.4, 1.0), ncol=3, fontsize=7, handlelength=1)
    fig.tight_layout()
    save(fig, outdir, "fig_pref")


def save(fig, outdir: Path, name: str):
    fig.savefig(outdir / f"{name}.pdf")
    fig.savefig(outdir / f"{name}.png", dpi=200)
    plt.close(fig)


# =============================================================== writing
def tex_escape(s: str) -> str:
    return s.replace("&", r"\&").replace("%", r"\%").replace("_", r"\_").replace("#", r"\#")


def stat_str(e: dict) -> str:
    if not np.isfinite(e.get("F", np.nan)):
        return "--"
    return f"$F({e['df1']},{e['df2']})={e['F']:.2f}$, $p{fmt_p(e['p'])}$, $\\eta_p^2={e['eta_p2']:.2f}$"


def cmp_str(r: dict) -> str:
    if not np.isfinite(r.get("p", np.nan)):
        return "--"
    if r["test"].startswith("paired t"):
        return f"$t({r['df']})={r['stat']:.2f}$, $p_{{Holm}}{fmt_p(r['p_holm'])}$, $d_z={r['effect']:.2f}$"
    return f"$W={r['stat']:g}$, $p_{{Holm}}{fmt_p(r['p_holm'])}$, $r={r['effect']:.2f}$"


def write_outputs(res: dict, synthetic: bool, n: int, adir: Path, rdir: Path):
    adir.mkdir(parents=True, exist_ok=True)
    rdir.mkdir(parents=True, exist_ok=True)
    (adir / "stats.json").write_text(json.dumps(res, indent=2, default=float))

    # ---------- numbers.tex (macros used in the report) ----------
    L = ["% Generated by analysis/analyze.py — do not edit by hand.",
         f"\\newcommand{{\\DataSource}}{{{'SYNTHETIC' if synthetic else 'study data'}}}",
         f"\\newcommand{{\\IsSynthetic}}{{{1 if synthetic else 0}}}",
         f"\\newcommand{{\\NP}}{{{n}}}"]
    for dv, label, short, log in MEASURES:
        if dv not in res["anova"]:
            continue
        a = res["anova"][dv]
        L += [f"\\newcommand{{\\Stat{short}Iface}}{{{stat_str(a['iface'])}}}",
              f"\\newcommand{{\\Stat{short}Mob}}{{{stat_str(a['mobility'])}}}",
              f"\\newcommand{{\\Stat{short}Inter}}{{{stat_str(a['interaction'])}}}",
              f"\\newcommand{{\\Cmp{short}Walk}}{{{cmp_str(res['planned'][dv]['walking'])}}}",
              f"\\newcommand{{\\Cmp{short}Stand}}{{{cmp_str(res['planned'][dv]['standing'])}}}"]
        for row in res["ci"][dv]:
            nm = ("Std" if row["iface"] == "standard" else "Wm") + ("Walk" if row["mobility"] == "walking" else "Stand")
            L.append(f"\\newcommand{{\\Mean{short}{nm}}}{{{row['mean']:.2f}}}")
    pw = res["planned"].get("time_s", {}).get("walking", {})
    if "ratio" in pw:
        L.append(f"\\newcommand{{\\TimeRatioWalk}}{{{100 * (1 - pw['ratio']):.0f}}}")
    t = res.get("tost_standing_time", {})
    if t.get("ratio") is not None:
        L.append(f"\\newcommand{{\\TostStand}}{{ratio $={t['ratio']:.2f}$, 90\\% CI [{t['ratio_ci90'][0]:.2f}, {t['ratio_ci90'][1]:.2f}], $p{fmt_p(t['p'])}$}}")
    for q, v in res["preference"].items():
        if q == "likert":
            continue
        qn = q.capitalize()
        L.append(f"\\newcommand{{\\Pref{qn}}}{{{v['walkmode']} WalkMode, {v['standard']} Standard, {v['none']} no preference (binomial $p{fmt_p(v['binom_p'])}$)}}")
    d = res["detector"]
    if "WM-WALK" in d:
        L.append(f"\\newcommand{{\\DetWalkPct}}{{{(d['WM-WALK']['detectWalkPct'] + d.get('STD-WALK', d['WM-WALK'])['detectWalkPct']) / 2:.0f}}}")
        lat = [d[c]["firstWalkS_median"] for c in ("STD-WALK", "WM-WALK") if d.get(c, {}).get("firstWalkS_median") is not None]
        if lat:
            L.append(f"\\newcommand{{\\DetLatency}}{{{np.mean(lat):.1f}}}")
    if "WM-STAND" in d:
        fp = d["WM-STAND"]["blocksWithWalkDetected"] + d.get("STD-STAND", {}).get("blocksWithWalkDetected", 0)
        nb = d["WM-STAND"]["blocks"] + d.get("STD-STAND", {}).get("blocks", 0)
        L.append(f"\\newcommand{{\\DetFalsePos}}{{{fp} of {nb}}}")
    (rdir / "numbers.tex").write_text("\n".join(L) + "\n")

    # ---------- tables.tex ----------
    head = " & ".join(f"{IFACE_LABEL[i]}\\,/\\,{MOB_LABEL[m]}" for i, m in CONDS)
    T = ["% Generated by analysis/analyze.py — do not edit by hand.",
         "\\newcommand{\\DescriptivesTable}{%",
         "\\begin{tabular}{@{}lrrrr@{}}", "\\toprule",
         f"Measure & {head} \\\\", "\\midrule"]
    for dv, label, short, log in MEASURES:
        if dv not in res["ci"]:
            continue
        cells_ = []
        for row in res["ci"][dv]:
            cells_.append(f"{row['mean']:.2f} ({row['sd']:.2f})")
        T.append(f"{tex_escape(label)} & " + " & ".join(cells_) + " \\\\")
    T += ["\\bottomrule", "\\end{tabular}}", "",
          "\\newcommand{\\AnovaTable}{%", "\\begin{tabular}{@{}lccc@{}}", "\\toprule",
          "Measure & Interface & Mobility & Interface $\\times$ Mobility \\\\", "\\midrule"]
    for dv, label, short, log in MEASURES:
        if dv not in res["anova"]:
            continue
        a = res["anova"][dv]
        cell = lambda e: (f"{e['F']:.2f}, $p{fmt_p(e['p'])}$, {e['eta_p2']:.2f}" if np.isfinite(e['F']) else "--")
        T.append(f"{tex_escape(label)} & {cell(a['iface'])} & {cell(a['mobility'])} & {cell(a['interaction'])} \\\\")
    T += ["\\bottomrule", "\\end{tabular}}", "",
          "\\newcommand{\\PlannedTable}{%", "\\begin{tabular}{@{}lll@{}}", "\\toprule",
          "Measure & Walking: WalkMode vs Standard & Standing: WalkMode vs Standard \\\\", "\\midrule"]
    for dv, label, short, log in MEASURES:
        if dv not in res["planned"]:
            continue
        p = res["planned"][dv]
        T.append(f"{tex_escape(label)} & {cmp_str(p['walking'])} & {cmp_str(p['standing'])} \\\\")
    T += ["\\bottomrule", "\\end{tabular}}"]
    (rdir / "tables.tex").write_text("\n".join(T) + "\n")

    # ---------- summary.md ----------
    M = []
    if synthetic:
        M += ["> **SYNTHETIC DATA — pipeline test only. These numbers are not results.**", ""]
    M += [f"# WalkMode analysis summary", "", f"Participants: **{n}**", ""]
    M += ["## Means per condition (within-subject 95% CI)", "",
          "| Measure | " + " | ".join(f"{IFACE_LABEL[i]} / {MOB_LABEL[m]}" for i, m in CONDS) + " |",
          "|---|" + "---|" * 4]
    for dv, label, short, log in MEASURES:
        if dv in res["ci"]:
            M.append(f"| {label} | " + " | ".join(f"{r['mean']:.2f} [{r['lo']:.2f}, {r['hi']:.2f}]" for r in res["ci"][dv]) + " |")
    M += ["", "Completion time is the geometric mean of successful trials.", "",
          "## 2×2 repeated-measures ANOVA", "", "| Measure | Interface | Mobility | Interaction |", "|---|---|---|---|"]
    for dv, label, short, log in MEASURES:
        if dv in res["anova"]:
            a = res["anova"][dv]
            c = lambda e: f"F(1,{e['df2']})={e['F']:.2f}, p{fmt_p(e['p'])}, ηp²={e['eta_p2']:.2f}" if np.isfinite(e['F']) else "–"
            M.append(f"| {label} | {c(a['iface'])} | {c(a['mobility'])} | {c(a['interaction'])} |")
    M += ["", "## Planned comparisons: WalkMode vs Standard (Holm-corrected per measure)", "",
          "| Measure | Walking | Standing |", "|---|---|---|"]
    for dv, label, short, log in MEASURES:
        if dv in res["planned"]:
            p = res["planned"][dv]
            c = lambda r: f"{r['test']}: stat={r['stat']:.2f}, p_holm{fmt_p(r['p_holm'])}, {r['effect_name']}={r['effect']:.2f}" if np.isfinite(r.get('p', np.nan)) else "–"
            M.append(f"| {label} | {c(p['walking'])} | {c(p['standing'])} |")
    t = res.get("tost_standing_time", {})
    if t.get("ratio") is not None:
        M += ["", f"Standing time equivalence (TOST, ±{int(100 * t['bound'])}%): WalkMode/Standard ratio {t['ratio']:.3f}, "
                  f"90% CI [{t['ratio_ci90'][0]:.3f}, {t['ratio_ci90'][1]:.3f}], p{fmt_p(t['p'])} → "
                  f"{'equivalent' if t['equivalent'] else 'not shown equivalent'}"]
    M += ["", "## Walking detector", "", "| Condition | % time walking detected | % time in walking layout | blocks with any detection | median onset (s) | layout switches / block | cadence (steps/min) |",
          "|---|---|---|---|---|---|---|"]
    for code, v in res["detector"].items():
        M.append(f"| {code} | {v['detectWalkPct']:.0f} | {v['walkModePct']:.0f} | {v['blocksWithWalkDetected']}/{v['blocks']} | "
                 f"{format(v['firstWalkS_median'], '.1f') if v['firstWalkS_median'] is not None else '–'} | {v['layoutSwitches_mean']:.2f} | "
                 f"{round(v['cadence_spm']) if v['cadence_spm'] else '–'} |")
    M += ["", "## Preferences", "", "| Question | WalkMode | Standard | No preference | binomial p |", "|---|---|---|---|---|"]
    for q, v in res["preference"].items():
        if q != "likert":
            M.append(f"| {q} | {v['walkmode']} | {v['standard']} | {v['none']} | {fmt_p(v['binom_p']).lstrip('=')} |")
    if res["preference"].get("likert"):
        M += ["", "| Likert item (1–7) | median | IQR |", "|---|---|---|"]
        for k, v in res["preference"]["likert"].items():
            M.append(f"| {k} | {v['median']:.1f} | {v['iqr'][0]:.1f}–{v['iqr'][1]:.1f} |")
    (adir / "summary.md").write_text("\n".join(M) + "\n")


# =============================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, nargs="+", default=[ROOT / "data"], help="folders or files of exported session JSON")
    ap.add_argument("--out", type=Path, default=ROOT / "analysis" / "output")
    ap.add_argument("--report-dir", type=Path, default=ROOT / "report" / "generated")
    ap.add_argument("--include-incomplete", action="store_true", help="keep sessions with fewer than 4 blocks (descriptives only)")
    ap.add_argument("--allow-mixed", action="store_true", help="allow synthetic and real sessions together")
    args = ap.parse_args()

    sessions = load_sessions(args.data, args.include_incomplete)
    if not sessions:
        sys.exit(f"No complete WalkMode sessions found in {', '.join(map(str, args.data))}.\n"
                 "Export sessions from the app into data/, or test with: python analysis/make_synthetic.py && "
                 "python analysis/analyze.py --data analysis/synthetic")
    syn = {bool(s.get("synthetic")) for s in sessions}
    if len(syn) > 1 and not args.allow_mixed:
        sys.exit("Refusing to mix SYNTHETIC and real sessions (use --allow-mixed if you really mean it).")
    synthetic = True in syn
    print(f"{len(sessions)} sessions{' (SYNTHETIC)' if synthetic else ''}: {', '.join(s['participantId'] for s in sessions)}")

    T = tidy(sessions)
    agg = aggregate(T)
    agg_task = aggregate(T, by_task=True)
    args.out.mkdir(parents=True, exist_ok=True)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    for k, df in T.items():
        df.to_csv(args.out / f"{k}.csv", index=False)
    agg.to_csv(args.out / "agg.csv", index=False)
    agg_task.to_csv(args.out / "agg_by_task.csv", index=False)

    res = {"synthetic": synthetic, "n": int(agg.participant.nunique()), "anova": {}, "planned": {}, "ci": {}}
    for dv, label, short, log in MEASURES:
        if dv not in agg or agg[dv].isna().all():
            continue
        res["anova"][dv] = rm_anova_2x2(agg, dv, log)
        res["planned"][dv] = planned(agg, dv, log)
        res["ci"][dv] = within_ci(agg, dv, log).to_dict("records")
    w = cells(agg, "time_s")
    if len(w) >= 3:
        res["tost_standing_time"] = tost_log(w[("standard", "standing")].to_numpy(), w[("walkmode", "standing")].to_numpy())
    res["by_task"] = {task: {dv: within_ci(agg_task[agg_task.task == task], dv, dv == "time_s").to_dict("records")
                             for dv in ("time_s", "errors", "misses")} for task in TASK_LABEL if (agg_task.task == task).any()}
    res["detector"] = detector_stats(T["blocks"])
    res["preference"] = preference_stats(T["prefs"]) if len(T["prefs"]) else {}

    fig_main(agg, args.report_dir)
    fig_tasks(agg_task, args.report_dir)
    fig_taps(T["taps"], args.report_dir)
    fig_tlx(T["tlx"], args.report_dir)
    fig_pref(res["preference"], args.report_dir)
    write_outputs(res, synthetic, res["n"], args.out, args.report_dir)

    print(f"wrote tables to {args.out}/ and figures + LaTeX to {args.report_dir}/")
    print((args.out / "summary.md").read_text())


if __name__ == "__main__":
    main()
