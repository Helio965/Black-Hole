import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { createBlackHole } from './blackHole.js';
import { createAccretionDisk } from './accretionDisk.js';
import { createStarfield } from './stars.js';
import { describeGpu } from './gpu.js';
import { detectQualityProfile, createFrameRateGovernor } from './quality.js';
import { createControlsPanel, createPerformanceStatus, setupHint } from './ui.js';
import { bloomBlendFragment } from './shaders.js';

// ---------------------------------------------------------------------------
// Scene units: 1 unit = 1 Schwarzschild radius (Rs).
// ---------------------------------------------------------------------------

const SHADOW_RADIUS = 2.6; // ~3√3/2 Rs: apparent size of the shadow
const DISK_INNER_RADIUS = 3; // innermost stable circular orbit (ISCO)
const DISK_OUTER_RADIUS = 16;

const CAMERA_FOV = 38;
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(2.2); // almost edge-on, like the reference
const BLOOM = { strength: 0.32, radius: 0.1, threshold: 0.85 };
const MIN_DISTANCE = 9;
const MAX_DISTANCE = 110;

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);

if (renderer) {
  start(renderer);
}

function createRenderer(target) {
  try {
    const instance = new THREE.WebGLRenderer({
      canvas: target,
      antialias: false, // everything goes through the composer's own render target
      // Ask for the dedicated GPU. It is only a hint: on laptops with two GPUs
      // the operating system decides (see the README and the in-page help).
      powerPreference: 'high-performance',
    });
    instance.setSize(window.innerWidth, window.innerHeight, false);
    instance.setClearColor(0x000000, 1);
    instance.toneMapping = THREE.NeutralToneMapping; // keeps the oranges saturated
    instance.toneMappingExposure = 1.0;
    return instance;
  } catch (error) {
    console.error('WebGL initialisation failed:', error);
    document.getElementById('fallback').hidden = false;
    return null;
  }
}

/** Distance that keeps the disc nicely framed for a given aspect ratio. */
function idealDistance(aspect) {
  const halfVertical = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  // Wide screens show the whole disc; tall screens at least the lensed core.
  const halfWidthToFit = aspect >= 1 ? 14.5 : 9;
  return THREE.MathUtils.clamp(halfWidthToFit / Math.tan(halfHorizontal), 24, 64);
}

function homePosition(aspect, target = new THREE.Vector3()) {
  const distance = idealDistance(aspect);
  return target.set(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION)).multiplyScalar(distance);
}

function start(renderer) {
  // Pick the quality from the GPU the browser is really using.
  const gpu = describeGpu(renderer);
  const quality = detectQualityProfile(gpu);
  let maxPixelRatio = quality.maxPixelRatio; // lowered at runtime if the device struggles

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    3000,
  );
  homePosition(camera.aspect, camera.position);
  camera.lookAt(0, 0, 0);

  // --- Camera controls ------------------------------------------------------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false; // the hole always stays at the centre
  controls.minDistance = MIN_DISTANCE; // never fall into the hole
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.target.set(0, 0, 0);
  controls.update();

  const cameraReset = createCameraReset(camera, controls);

  // --- Settings (driven by the controls panel) ---------------------------------
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const settings = {
    speed: prefersReducedMotion ? 0.35 : 1,
    intensity: 1,
    particles: 1, // fraction of the particle budget
    tilt: 0, // degrees
    lens: 1.45, // 1 = weak-field point lens; a bit more looks closer to strong-field renders
    doppler: 0.6,
    stars: true,
  };

  // --- Objects ----------------------------------------------------------------
  const blackHole = createBlackHole({ shadowRadius: SHADOW_RADIUS });
  scene.add(blackHole.group);

  // Shared by every material that bends light around the hole.
  const lensUniforms = {
    uLensStrength: { value: settings.lens },
    uShadowRadius: { value: SHADOW_RADIUS },
  };

  const disk = createAccretionDisk({
    count: quality.particles,
    innerRadius: DISK_INNER_RADIUS,
    outerRadius: DISK_OUTER_RADIUS,
    lensUniforms,
    segments: quality.segments,
    streakWidth: quality.streakWidth,
  });
  scene.add(disk.group);

  const stars = createStarfield({ count: quality.stars, lensUniforms });
  scene.add(stars.points);

  // The adaptive governor may shrink the budget; the UI picks a fraction of it.
  let particleBudget = quality.particles;
  function applyParticleCount() {
    disk.setVisibleCount(particleBudget * settings.particles);
  }

  const applySetting = {
    speed: () => {}, // read every frame
    intensity: (v) => {
      disk.uniforms.uIntensity.value = v;
      blackHole.uniforms.uIntensity.value = 0.5 + 0.5 * v;
    },
    particles: () => applyParticleCount(),
    tilt: (v) => disk.setTilt(THREE.MathUtils.degToRad(v)),
    lens: (v) => {
      lensUniforms.uLensStrength.value = v;
    },
    doppler: (v) => {
      disk.uniforms.uDoppler.value = v;
      blackHole.uniforms.uDoppler.value = v;
    },
    stars: (v) => {
      stars.points.visible = v;
    },
  };
  for (const [key, apply] of Object.entries(applySetting)) apply(settings[key]);

  // --- Post-processing ----------------------------------------------------------
  // No MSAA: the streaks are soft and the shadow's edge is smoothed in its own
  // shader, while multisampling would multiply the memory traffic of the
  // thousands of additive streaks (the main cost on integrated GPUs).
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));
  // Only the hottest (HDR > threshold) parts of the scene glow.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  // Favour the small blur levels: a tight glow instead of a wide haze.
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.7, 0.35, 0.12, 0.04];
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const bloomMask = keepShadowBlack(bloom);

  // Angular momentum of the disc seen from the camera: the photon ring uses it
  // to know which side is moving towards us.
  const spinWorld = new THREE.Vector3();
  const spinView = new THREE.Vector3();
  function updateSpin() {
    spinWorld.set(0, 1, 0).applyQuaternion(disk.group.quaternion);
    spinView.copy(spinWorld).transformDirection(camera.matrixWorldInverse);
    blackHole.setSpin(spinView);
  }

  // Where the shadow is on screen, for the bloom mask.
  const holeScreen = new THREE.Vector3();
  function updateBloomMask() {
    holeScreen.set(0, 0, 0).project(camera);
    bloomMask.uHoleCenter.value.set(holeScreen.x * 0.5 + 0.5, holeScreen.y * 0.5 + 0.5);
    const distance = camera.position.length();
    const angularRadius = Math.asin(Math.min(SHADOW_RADIUS / distance, 0.999));
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    bloomMask.uHoleRadius.value = (0.5 * Math.tan(angularRadius)) / Math.tan(halfFov);
    bloomMask.uAspect.value = camera.aspect;
  }

  // --- Responsiveness -----------------------------------------------------------
  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    stars.setPixelRatio(pixelRatio);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // --- Adaptive quality ------------------------------------------------------------
  // Keep the animation fluid on slower devices: first render fewer pixels,
  // then draw fewer streaks.
  const governor = createFrameRateGovernor({
    onDowngrade(fps) {
      const currentRatio = Math.min(window.devicePixelRatio, maxPixelRatio);
      if (currentRatio > 1) {
        maxPixelRatio = Math.max(1, currentRatio - 0.5);
        onResize();
      } else {
        particleBudget = Math.max(10000, Math.round(particleBudget * 0.65));
        applyParticleCount();
      }
      console.info(
        `[black-hole] ${fps.toFixed(1)} fps -> pixel ratio ${Math.min(window.devicePixelRatio, maxPixelRatio)}, ` +
          `${disk.visibleCount} particles`,
      );
    },
  });

  // --- Animation loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  let orbitTime = 0;
  let flowTime = 0;
  const fpsMeter = { frames: 0, elapsed: 0 };

  function frame() {
    requestAnimationFrame(frame);
    const rawDelta = clock.getDelta();
    if (quality.adaptive) governor.tick(rawDelta);

    fpsMeter.frames += 1;
    fpsMeter.elapsed += rawDelta;
    if (fpsMeter.elapsed >= 0.5) {
      status.setFps(fpsMeter.frames / fpsMeter.elapsed);
      fpsMeter.frames = 0;
      fpsMeter.elapsed = 0;
    }
    // Clamp the delta so a background tab does not produce a huge jump.
    const delta = Math.min(rawDelta, 0.1);

    // Integrating the speed (instead of time * speed) keeps the motion smooth
    // when the speed control changes.
    // Speed 0 pauses the whole disc (orbits and turbulence).
    orbitTime += delta * settings.speed;
    flowTime += delta * settings.speed;
    disk.update(orbitTime, flowTime);
    stars.update(clock.elapsedTime);

    cameraReset.update(delta);
    controls.update();
    camera.updateMatrixWorld();
    updateSpin();
    updateBloomMask();

    composer.render(delta);
  }

  // --- Interface ------------------------------------------------------------------
  const status = createPerformanceStatus(gpu);
  createControlsPanel({
    values: settings,
    onChange(key, value) {
      settings[key] = value;
      applySetting[key]?.(value);
    },
    onResetCamera: () => cameraReset.start(),
  });
  setupHint(canvas);

  frame();
  canvas.classList.add('is-ready');
}

/**
 * UnrealBloomPass adds its glow over the whole frame, which slowly fills the
 * shadow with light. Swap its final blend shader for one that fades the glow
 * out inside the silhouette of the hole, so the centre stays absolutely black.
 * (blendMaterial shares the copyUniforms object, so new uniforms go there.)
 */
function keepShadowBlack(bloom) {
  const uniforms = bloom.copyUniforms;
  uniforms.uHoleCenter = { value: new THREE.Vector2(0.5, 0.5) };
  uniforms.uHoleRadius = { value: 0 };
  uniforms.uAspect = { value: 1 };
  bloom.blendMaterial.fragmentShader = bloomBlendFragment;
  bloom.blendMaterial.needsUpdate = true;
  return uniforms;
}

/**
 * Smoothly flies the camera back to its home position. Interpolating in
 * spherical coordinates keeps it on a nice arc around the hole instead of
 * cutting straight through it.
 */
function createCameraReset(camera, controls) {
  const from = new THREE.Spherical();
  const to = new THREE.Spherical();
  const home = new THREE.Vector3();
  const DURATION = 1.4;
  let elapsed = -1;

  return {
    start() {
      from.setFromVector3(camera.position);
      to.setFromVector3(homePosition(camera.aspect, home));
      // Take the short way around.
      const turn = to.theta - from.theta;
      to.theta = from.theta + Math.atan2(Math.sin(turn), Math.cos(turn));
      elapsed = 0;
    },
    update(delta) {
      if (elapsed < 0) return;
      elapsed = Math.min(elapsed + delta, DURATION);
      const t = elapsed / DURATION;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.setFromSphericalCoords(
        THREE.MathUtils.lerp(from.radius, to.radius, ease),
        THREE.MathUtils.lerp(from.phi, to.phi, ease),
        THREE.MathUtils.lerp(from.theta, to.theta, ease),
      );
      camera.lookAt(controls.target);
      if (elapsed >= DURATION) elapsed = -1;
    },
  };
}
