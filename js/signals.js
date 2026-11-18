// Synthetic accelerometer signals (accelerationIncludingGravity, m/s²).
// Shared by the desktop simulation source (js/motion.js) and the Node tests.

const G = 9.81;
const TILT = (40 * Math.PI) / 180; // phone held ~40° from vertical, screen facing the user
const GY = G * Math.cos(TILT);
const GZ = G * Math.sin(TILT);

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generator of samples. State: 'still' | 'walking'.
 * opts: { walkFreqHz, walkAmp, noise, tapSpikeProb (per sample, still only), rateHz }
 */
export function createSignal(rng, opts) {
  let phase = 0;
  let spikeUntil = -1;
  let spikeStart = 0;
  const o = { walkFreqHz: 1.8, walkAmp: 1.8, noise: 0.08, tapSpikeProb: 0, tapAmp: 1.2, ...opts };

  return function next(t, state, dt) {
    let ax = o.noise * gauss(rng);
    let ay = GY + o.noise * gauss(rng);
    let az = GZ + o.noise * gauss(rng);

    if (state === 'walking') {
      // small cadence jitter keeps it realistic
      const f = o.walkFreqHz * (1 + 0.03 * gauss(rng));
      phase += 2 * Math.PI * f * dt;
      const v = o.walkAmp * Math.sin(phase) + 0.35 * o.walkAmp * Math.sin(2 * phase + 0.7);
      // vertical bounce acts along gravity; lateral sway at half the step rate
      ay += v * Math.cos(TILT);
      az += v * Math.sin(TILT);
      ax += 0.4 * o.walkAmp * Math.sin(phase / 2);
    } else if (o.tapSpikeProb > 0) {
      if (t > spikeUntil && rng() < o.tapSpikeProb) {
        spikeStart = t;
        spikeUntil = t + 0.06;
      }
    }
    if (t <= spikeUntil) {
      // a thumb tap jolts the phone along the screen normal for ~60 ms
      az += o.tapAmp * Math.sin((Math.PI * (t - spikeStart)) / 0.06);
    }
    return [ax, ay, az];
  };
}
