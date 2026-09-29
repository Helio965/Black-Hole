import * as THREE from 'three';
import { diskVertex, diskFragment } from './shaders.js';

const TRAIL_SEGMENTS = 6;      // vertices along each streak (enough to bend it smoothly)
const KEPLER = 7.5;            // ω = KEPLER / r^1.5 (rad per second at speed 1)
const REFERENCE_COUNT = 60000; // brightness is tuned for this many streaks
const DISK_EXPOSURE = 0.5;     // overall brightness of a single streak (HDR units)

/**
 * Accretion disc made of thousands of luminous streaks.
 *
 * One InstancedBufferGeometry holds a tiny ribbon (the streak) plus a few
 * numbers per instance (radius, start angle, height, size, brightness...).
 * The vertex shader turns those numbers into an orbit, so the CPU only updates
 * a handful of uniforms per frame, no matter how many streaks are drawn.
 */
export function createAccretionDisk({ count, innerRadius, outerRadius, lensUniforms, seed = 1337 }) {
  const geometry = createStreakGeometry({ count, innerRadius, outerRadius, seed });

  // Shared by both lens images (uniform objects are shared by reference).
  const uniforms = {
    ...lensUniforms,
    uTime: { value: 0 },
    uFlowTime: { value: 0 },
    uIntensity: { value: 1 },
    uBrightnessScale: { value: 1 },
    uDoppler: { value: 0.5 },
    uKepler: { value: KEPLER },
    uInnerRadius: { value: innerRadius },
    uOuterRadius: { value: outerRadius },
  };

  const group = new THREE.Group();
  group.name = 'AccretionDisk';

  // The same streaks are drawn twice: once where they appear directly
  // (primary image) and once as the faint mirrored arc produced by light that
  // goes around the other side of the hole (secondary image).
  for (const [name, imageSign] of [['PrimaryImage', 1], ['SecondaryImage', -1]]) {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uImageSign: { value: imageSign } },
      vertexShader: diskVertex,
      fragmentShader: diskFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // streaks are billboards; the lens also mirrors them
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false; // real positions only exist on the GPU
    group.add(mesh);
  }

  function setVisibleCount(visible) {
    const n = THREE.MathUtils.clamp(Math.round(visible), 1, count);
    geometry.instanceCount = n;
    // Fewer streaks -> each one a bit brighter, so the disc keeps its glow.
    uniforms.uBrightnessScale.value = Math.pow(REFERENCE_COUNT / n, 0.6);
  }
  setVisibleCount(count);

  return {
    group,
    uniforms,
    maxCount: count,
    setVisibleCount,
    get visibleCount() {
      return geometry.instanceCount;
    },
    /** Disc inclination around the X axis, in radians. */
    setTilt(radians) {
      group.rotation.x = radians;
    },
    update(orbitTime, flowTime) {
      uniforms.uTime.value = orbitTime;
      uniforms.uFlowTime.value = flowTime;
    },
  };
}

function createStreakGeometry({ count, innerRadius, outerRadius, seed }) {
  const geometry = new THREE.InstancedBufferGeometry();

  // Base ribbon: pairs of vertices along the streak.
  // position.x = 0 at the head .. 1 at the tail, position.y = -1 / +1 across.
  const positions = [];
  const indices = [];
  for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
    const t = i / TRAIL_SEGMENTS;
    positions.push(t, -1, 0, t, 1, 0);
    if (i < TRAIL_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  const random = mulberry32(seed);
  const orbit = new Float32Array(count * 4);
  const look = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    // More matter close to the hole: squash a uniform sample towards 0.
    const radius = innerRadius + (outerRadius - innerRadius) * Math.pow(random(), 1.5);

    orbit[i * 4 + 0] = radius;
    orbit[i * 4 + 1] = random() * Math.PI * 2;
    orbit[i * 4 + 2] = gaussian(random);
    orbit[i * 4 + 3] = random();

    // Brightness: steep radial fall-off, concentric bands and a few hot spots.
    const radial = Math.pow(innerRadius / radius, 1.4);
    const bands = 0.6 + 0.4 * Math.sin(radius * 4.1 + 1.3 * Math.sin(radius * 1.7));
    const spark = 0.35 + 0.65 * Math.pow(random(), 2);
    const innerEdge = THREE.MathUtils.smoothstep(radius, innerRadius, innerRadius + 0.35);

    look[i * 4 + 0] = (0.1 + 0.3 * random()) * (0.75 + 0.25 * Math.sqrt(innerRadius / radius));
    look[i * 4 + 1] = (0.025 + 0.055 * random()) * (0.6 + 0.05 * radius);
    look[i * 4 + 2] = DISK_EXPOSURE * radial * bands * spark * (0.25 + 0.75 * innerEdge);
    look[i * 4 + 3] = 0.94 + 0.12 * random();
  }

  geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
  geometry.instanceCount = count;
  return geometry;
}

/** Small seeded PRNG, so the disc looks the same on every load. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller), clamped to keep the disc thin. */
function gaussian(random) {
  const u = Math.max(random(), 1e-6);
  const v = random();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return THREE.MathUtils.clamp(n, -2.5, 2.5);
}
