/**
 * Minimal controls panel. The markup lives in index.html; this module only
 * wires every `[data-setting]` input to a callback and keeps its label in sync.
 */

const FORMATTERS = {
  speed: (v) => `${v.toFixed(2)}×`,
  intensity: (v) => v.toFixed(2),
  particles: (v) => `${Math.round(v * 100)}%`,
  tilt: (v) => `${v > 0 ? '+' : ''}${v}°`,
  lens: (v) => v.toFixed(2),
  doppler: (v) => v.toFixed(2),
};

export function createControlsPanel({ values, onChange, onResetCamera }) {
  const toggle = document.getElementById('controls-toggle');
  const panel = document.getElementById('controls');
  const inputs = panel.querySelectorAll('[data-setting]');

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  panel.addEventListener('submit', (event) => event.preventDefault());

  for (const input of inputs) {
    const key = input.dataset.setting;
    const output = panel.querySelector(`[data-output="${key}"]`);
    const isSwitch = input.type === 'checkbox';

    const read = () => (isSwitch ? input.checked : Number(input.value));
    const render = () => {
      if (output) output.textContent = FORMATTERS[key]?.(read()) ?? String(read());
      if (!isSwitch) {
        // Filled part of the track (WebKit/Blink have no ::range-progress).
        const fill = ((input.value - input.min) / (input.max - input.min)) * 100;
        input.style.setProperty('--fill', `${fill}%`);
      }
    };

    if (isSwitch) input.checked = Boolean(values[key]);
    else input.value = String(values[key]);
    render();

    input.addEventListener(isSwitch ? 'change' : 'input', () => {
      render();
      onChange(key, read());
    });
  }

  document.getElementById('reset-camera').addEventListener('click', onResetCamera);
}

/** Fades the "drag to rotate" hint after the first interaction (or a while). */
export function setupHint(target) {
  const hint = document.getElementById('hint');
  if (!hint) return;
  const hide = () => hint.classList.add('is-hidden');
  target.addEventListener('pointerdown', hide, { once: true });
  target.addEventListener('wheel', hide, { once: true, passive: true });
  setTimeout(hide, 9000);
}
