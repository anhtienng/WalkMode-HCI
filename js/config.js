// WalkMode — every tunable parameter lives here.
// Sizes are CSS pixels (≈0.16 mm each on typical phones: 40 px ≈ 6.3 mm, 64 px ≈ 10 mm).
// This module is pure (no DOM) so it can be imported by Node tests.

export const CONFIG = {
  appVersion: '1.0.0',
  schema: 'walkmode-session/1',

  // UI size tokens per mode. Applied as CSS custom properties on <html data-mode="...">.
  sizes: {
    standard: {
      target: 40,      // icon tile / switch-target base size
      gap: 6,          // spacing between interactive elements
      font: 15,        // body font
      promptFont: 17,  // task prompt
      labelFont: 10,   // grid tile label
      gridCols: 5,
      rowH: 44,        // list / menu row height
      backBtn: 36,     // nav back button
      toggleW: 40,
      toggleH: 24,
      pad: 12,         // container padding
    },
    walking: {
      target: 64,
      gap: 16,
      font: 18,
      promptFont: 21,
      labelFont: 12,
      gridCols: 4,
      rowH: 64,
      backBtn: 56,
      toggleW: 60,
      toggleH: 36,
      pad: 16,
    },
  },

  // Walking detector (see js/detector.js). Units: seconds, m/s², Hz.
  detector: {
    gravityTauSec: 1.0,   // EMA time constant used to estimate (and remove) gravity
    smoothTauSec: 0.04,   // light low-pass on the dynamic signal (~4 Hz)
    windowSec: 2.5,       // sliding feature window
    evalEverySec: 0.1,    // how often features/state are recomputed
    enterSigma: 0.6,      // σ needed to count a window as walking-like
    exitSigma: 0.35,      // σ below which a window is still-like
    minCadenceHz: 1.2,    // plausible step frequency band
    maxCadenceHz: 3.0,
    maxIntervalCV: 0.45,  // step intervals must be regular (coefficient of variation)
    peakK: 0.6,           // peak threshold = mean + k·σ
    minPeakGapSec: 0.3,   // merge peaks closer than this (double-bump steps)
    enterHoldSec: 1.2,    // walking-like must persist this long before switching to walking
    exitHoldSec: 2.5,     // still-like must persist this long before switching back
  },

  adaptation: {
    // 'touch-idle'  : defer a layout change while a finger is down and for touchIdleMs after it lifts
    // 'immediate'   : apply as soon as the detector changes state
    // 'trial-boundary': apply only between trials
    switchPolicy: 'touch-idle',
    touchIdleMs: 700,
    transitionMs: 200,    // documented here; the CSS transition itself is --anim in css/app.css
  },

  // Trials per task per block, and per-task timeouts (s).
  trials: { grid: 10, list: 6, nav: 5 },
  practice: { grid: 2, list: 1, nav: 1 },
  timeoutSec: { grid: 15, list: 20, nav: 25 },
  interTrialMs: 350,
  countdownSec: 3,

  // Tap recognition (pointer down → up).
  tap: { maxMovePx: 15, maxDurationMs: 800 },

  // Calibration stage lengths (s); the first `warmupSec` of each stage is discarded.
  calibration: { stillSec: 10, walkSec: 12, warmupSec: 2.5 },

  // Desktop simulation source (press W to toggle walking).
  sim: { rateHz: 60, walkFreqHz: 1.8, walkAmp: 1.8, noise: 0.08, tapSpikeProb: 0.015 },
};

// The four study conditions. Index order is used by the Latin square.
export const CONDITIONS = [
  { code: 'STD-STAND', iface: 'standard', mobility: 'standing' },
  { code: 'STD-WALK',  iface: 'standard', mobility: 'walking'  },
  { code: 'WM-STAND',  iface: 'walkmode', mobility: 'standing' },
  { code: 'WM-WALK',   iface: 'walkmode', mobility: 'walking'  },
];

export const IFACE_LABEL = { standard: 'Standard', walkmode: 'WalkMode' };
export const MOBILITY_LABEL = { standing: 'Standing', walking: 'Walking' };
