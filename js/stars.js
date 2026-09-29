import * as THREE from 'three';
import { starVertex, starFragment } from './shaders.js';
import { mulberry32 } from './random.js';

const STAR_TINTS = [
  [1.0, 1.0, 1.0],
  [0.78, 0.86, 1.0], // hot, bluish
  [1.0, 0.86, 0.7],  // cool, warm
];

/**
 * A deliberately discreet starfield: a few thousand faint points on a large
 * shell around the scene. Being at a finite distance they drift slightly when
 * the camera orbits, and they are lensed by the hole like the disc.
 */
export function createStarfield({ count, lensUniforms, innerRadius = 420, outerRadius = 900, seed = 7 }) {
  const random = mulberry32(seed);

  // Every star is stored twice: once for each image produced by the lens.
  const positions = new Float32Array(count * 2 * 3);
  const colors = new Float32Array(count * 2 * 3);
  const sizes = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  const images = new Float32Array(count * 2);

  const direction = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere.
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    direction.set(ring * Math.cos(angle), z, ring * Math.sin(angle));
    const distance = innerRadius + (outerRadius - innerRadius) * random();

    // Most stars are tiny and dim, a handful are a little brighter.
    const bright = random() < 0.04;
    const brightness = bright ? 0.45 + 0.25 * random() : 0.08 + 0.22 * random();
    const tint = STAR_TINTS[Math.floor(random() * STAR_TINTS.length)];
    const size = bright ? 1.8 + random() * 0.8 : 0.9 + random() * 0.8;
    const starSeed = random();

    for (let image = 0; image < 2; image++) {
      const k = i * 2 + image;
      positions[k * 3 + 0] = direction.x * distance;
      positions[k * 3 + 1] = direction.y * distance;
      positions[k * 3 + 2] = direction.z * distance;
      colors[k * 3 + 0] = tint[0] * brightness;
      colors[k * 3 + 1] = tint[1] * brightness;
      colors[k * 3 + 2] = tint[2] * brightness;
      sizes[k] = size;
      seeds[k] = starSeed;
      images[k] = image === 0 ? 1 : -1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aImage', new THREE.BufferAttribute(images, 1));

  const uniforms = {
    ...lensUniforms,
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 1 },
  };

  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: starVertex,
      fragmentShader: starFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.name = 'Starfield';
  points.frustumCulled = false; // lensing moves points outside their bounding sphere

  return {
    points,
    uniforms,
    setPixelRatio(ratio) {
      uniforms.uPixelRatio.value = ratio;
    },
    update(time) {
      uniforms.uTime.value = time;
    },
  };
}
