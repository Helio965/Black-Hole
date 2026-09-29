import * as THREE from 'three';
import { createBlackHole } from './blackHole.js';

// ---------------------------------------------------------------------------
// Scene units: 1 unit = 1 Schwarzschild radius (Rs).
// ---------------------------------------------------------------------------

const SHADOW_RADIUS = 2.6; // ~3√3/2 Rs: apparent size of the shadow
const MAX_PIXEL_RATIO = 2;
const CAMERA_FOV = 38;
const CAMERA_START = new THREE.Vector3(0, 4.2, 34);

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);

if (renderer) {
  start(renderer);
}

function createRenderer(target) {
  try {
    const instance = new THREE.WebGLRenderer({
      canvas: target,
      antialias: true,
      powerPreference: 'high-performance',
    });
    instance.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    instance.setSize(window.innerWidth, window.innerHeight, false);
    instance.setClearColor(0x000000, 1);
    instance.toneMapping = THREE.ACESFilmicToneMapping;
    instance.toneMappingExposure = 1.0;
    return instance;
  } catch (error) {
    console.error('WebGL initialisation failed:', error);
    document.getElementById('fallback').hidden = false;
    return null;
  }
}

function start(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    3000,
  );
  camera.position.copy(CAMERA_START);
  camera.lookAt(0, 0, 0);

  const blackHole = createBlackHole({ shadowRadius: SHADOW_RADIUS });
  scene.add(blackHole.group);

  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
  }
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  function frame() {
    requestAnimationFrame(frame);
    // Clamp the delta so a background tab does not produce a huge jump.
    const delta = Math.min(clock.getDelta(), 0.1);
    void delta;
    renderer.render(scene, camera);
  }

  frame();
  canvas.classList.add('is-ready');
}
