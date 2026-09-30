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

const HELP_DISMISSED_KEY = 'black-hole:gpu-help-dismissed';

/**
 * Shows which GPU the browser renders with, plus the live frame rate. When it
 * is an integrated GPU or the CPU, a small card explains how to switch the
 * browser to the dedicated graphics card (it opens once, then on demand).
 */
export function createPerformanceStatus(gpu) {
  const line = document.getElementById('gpu-status');
  const fps = document.getElementById('fps-value');
  const help = document.getElementById('gpu-help');
  const openButton = document.getElementById('gpu-help-open');

  // "NVIDIA GeForce RTX 3050 Laptop GPU" -> "GeForce RTX 3050 Laptop GPU"
  const shortName = gpu.name
    .replace(/^NVIDIA (?=GeForce|Quadro|RTX)/, '')
    .replace(/\((R|TM)\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  line.dataset.kind = gpu.kind;
  line.title = gpu.raw || gpu.name;
  document.getElementById('gpu-name').textContent = shortName;

  const needsHelp = gpu.kind === 'integrated' || gpu.kind === 'software';
  if (needsHelp) {
    help.dataset.kind = gpu.kind;
    for (const el of help.querySelectorAll('.js-gpu-name')) el.textContent = gpu.name;
    if (gpu.kind === 'software') {
      document.getElementById('gpu-help-title').textContent = 'Ative a aceleração de hardware';
    }

    const setOpen = (open) => {
      help.hidden = !open;
      openButton.hidden = open;
    };
    openButton.addEventListener('click', () => setOpen(true));
    document.getElementById('gpu-help-close').addEventListener('click', () => {
      setOpen(false);
      remember(HELP_DISMISSED_KEY, gpu.raw);
    });
    for (const button of help.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          button.textContent = 'copiado';
        } catch {
          button.textContent = 'copie o texto';
        }
        setTimeout(() => (button.textContent = 'copiar'), 1800);
      });
    }
    // Open it by itself the first time this GPU is seen.
    setOpen(recall(HELP_DISMISSED_KEY) !== gpu.raw);
  }

  return {
    setFps(value) {
      fps.textContent = `${Math.round(value)} FPS`;
    },
  };
}

// localStorage can be unavailable (private mode, blocked storage): never fail.
function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
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
