/**
 * Quality management: pick sensible defaults for the device, then lower them
 * at runtime if the frame rate stays too low.
 *
 * `?quality=high` or `?quality=low` in the URL forces a profile and disables
 * the automatic adjustment (useful for screenshots and benchmarks).
 */

const PROFILES = {
  high: { name: 'high', particles: 60000, stars: 1800, maxPixelRatio: 2, msaa: 4 },
  low: { name: 'low', particles: 24000, stars: 1000, maxPixelRatio: 1.5, msaa: 0 },
};

export function detectQualityProfile() {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced in PROFILES) {
    return { ...PROFILES[forced], adaptive: false };
  }

  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 820;
  const profile = coarsePointer && smallScreen ? PROFILES.low : PROFILES.high;
  return { ...profile, adaptive: true };
}

/**
 * Measures the frame rate over short windows and calls `onDowngrade` whenever
 * it stays below `targetFps`, at most `maxSteps` times.
 */
export function createFrameRateGovernor({
  targetFps = 45,
  warmup = 2,
  sampleWindow = 2.5,
  maxSteps = 4,
  onDowngrade,
}) {
  let running = 0;
  let elapsed = 0;
  let frames = 0;
  let steps = 0;

  function reset() {
    running = 0;
    elapsed = 0;
    frames = 0;
  }

  // Frames are not rendered while the tab is hidden: start over when it returns.
  document.addEventListener('visibilitychange', reset);

  return {
    reset,
    /** @param {number} delta unclamped seconds since the previous frame */
    tick(delta) {
      if (steps >= maxSteps) return;
      running += delta;
      if (running < warmup) return;

      elapsed += delta;
      frames += 1;
      if (elapsed < sampleWindow) return;

      const fps = frames / elapsed;
      elapsed = 0;
      frames = 0;
      if (fps < targetFps) {
        steps += 1;
        onDowngrade(fps, steps);
        running = 0; // give the new settings time to settle
      }
    },
  };
}
