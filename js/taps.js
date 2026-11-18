// Tap recognition and classification — pure functions, unit-tested.

/** A pointer down→up is a tap if it barely moved and was short. */
export function isTap(down, up, cfg) {
  const moved = Math.hypot(up.x - down.x, up.y - down.y);
  const dur = up.t - down.t;
  return moved <= cfg.maxMovePx && dur <= cfg.maxDurationMs;
}

/**
 * hit             – landed on the element the current step expects
 * selection_error – landed on a different interactive target
 * miss            – landed on no interactive target (gap, label, background)
 * chrome          – landed on app chrome (header/menu); excluded from task measures
 */
export function classifyTap({ hitId, intendedId, chrome = false }) {
  if (chrome) return 'chrome';
  if (hitId === null || hitId === undefined || hitId === '') return 'miss';
  if (hitId === intendedId) return 'hit';
  return 'selection_error';
}

/** Offset of a point from a rect's centre, and its distance to the rect's edge (0 if inside). */
export function offsetFromRect(x, y, rect) {
  if (!rect) return { dx: null, dy: null, edgeDist: null };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const ex = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const ey = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return {
    dx: round1(x - cx),
    dy: round1(y - cy),
    edgeDist: round1(Math.hypot(ex, ey)),
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
