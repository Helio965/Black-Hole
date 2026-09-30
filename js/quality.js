/**
 * Quality management: pick sensible defaults for the GPU the browser is
 * really using, then lower them at runtime if the frame rate stays too low.
 *
 * `?quality=ultra|high|medium|low` in the URL forces a profile and disables the
 * automatic adjustment (useful for screenshots and benchmarks).
 */

const PROFILES = {
  // Dedicated GPUs have plenty of headroom: more, finer streaks and smoother arcs.
  ultra: { name: 'ultra', particles: 110000, stars: 2200, maxPixelRatio: 2, segments: 8, streakWidth: 0.72 },
  high: { name: 'high', particles: 60000, stars: 1800, maxPixelRatio: 2, segments: 6, streakWidth: 1 },
  medium: { name: 'medium', particles: 36000, stars: 1400, maxPixelRatio: 1.25, segments: 6, streakWidth: 1 },
  low: { name: 'low', particles: 20000, stars: 1000, maxPixelRatio: 1.5, segments: 6, streakWidth: 1 },
};

/** @param {{ kind: string }} gpu result of describeGpu() */
export function detectQualityProfile(gpu) {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced in PROFILES) {
    return { ...PROFILES[forced], adaptive: false };
  }

  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 820;

  // Rendering on the CPU: keep it as light as possible.
  if (gpu.kind === 'software') return { ...PROFILES.low, maxPixelRatio: 1, adaptive: true };
  if (coarsePointer && smallScreen) return { ...PROFILES.low, adaptive: true };
  // Integrated laptop GPUs share memory bandwidth with the CPU.
  if (gpu.kind === 'integrated') return { ...PROFILES.medium, adaptive: true };
  if (gpu.kind === 'discrete') return { ...PROFILES.ultra, adaptive: true };
  return { ...PROFILES.high, adaptive: true };
}

/**
 * Measures the frame rate over short windows and calls `onDowngrade` whenever
 * it stays below `targetFps`, at most `maxSteps` times.
 */
export function createFrameRateGovernor({
  targetFps = 45,
  warmup = 1.5,
  sampleWindow = 1.5,
  maxSteps = 5,
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
