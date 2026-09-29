import * as THREE from 'three';
import { photonRingVertex, photonRingFragment } from './shaders.js';

/**
 * The black hole: a perfectly black sphere (the shadow) and a camera-facing
 * billboard that paints the photon ring and the warm aura around it.
 *
 * The sphere uses MeshBasicMaterial, so no light can ever reveal its surface.
 * It also writes depth, which hides every particle that ends up behind it.
 */
export function createBlackHole({ shadowRadius }) {
  const group = new THREE.Group();
  group.name = 'BlackHole';

  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(shadowRadius, 96, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  horizon.name = 'EventHorizon';
  group.add(horizon);

  const uniforms = {
    uShadowRadius: { value: shadowRadius },
    uSize: { value: shadowRadius * 3.2 },
    uIntensity: { value: 1 },
    uDoppler: { value: 0.5 },
    uSpin: { value: new THREE.Vector3(0, 1, 0) },
  };

  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: photonRingVertex,
      fragmentShader: photonRingFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  aura.name = 'PhotonRing';
  aura.frustumCulled = false; // re-oriented towards the camera in the vertex shader
  group.add(aura);

  return {
    group,
    uniforms,
    /** @param {THREE.Vector3} spinView disc angular momentum in view space */
    setSpin(spinView) {
      uniforms.uSpin.value.copy(spinView);
    },
  };
}
