// GLSL sources used by the scene, kept in one place so every visual effect
// can be read (and tweaked) without digging through the scene setup code.

// ---------------------------------------------------------------------------
// Photon ring + aura
// A camera-facing quad centred on the hole. Every fragment is converted into an
// angle measured from the centre of the hole so that the ring always hugs the
// silhouette of the shadow, whatever the zoom level.
// ---------------------------------------------------------------------------

export const photonRingVertex = /* glsl */ `
  uniform float uSize;

  varying vec2 vOffset;
  varying float vDistance;

  void main() {
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vOffset = position.xy * uSize;
    vDistance = length(center.xyz);
    gl_Position = projectionMatrix * vec4(center.xyz + vec3(vOffset, 0.0), 1.0);
  }
`;

export const photonRingFragment = /* glsl */ `
  uniform float uShadowRadius;
  uniform float uSize;
  uniform float uIntensity;
  uniform float uDoppler;
  uniform vec3 uSpin; // angular momentum of the disc, in view space

  varying vec2 vOffset;
  varying float vDistance;

  void main() {
    float rho = length(vOffset);
    float angle = atan(rho, vDistance);
    float edge = asin(min(uShadowRadius / vDistance, 0.999));
    float x = angle / edge; // 1.0 exactly on the silhouette of the shadow

    if (x < 1.0) discard; // the shadow itself stays absolutely black

    float d = x - 1.0;
    float ring = exp(-pow(d / 0.022, 2.0)); // razor-thin photon ring
    float inner = exp(-d * 9.0);            // hot glow hugging the edge
    float halo = exp(-d * 2.2);             // wide and soft aura

    // Side of the ring that moves towards the camera looks brighter.
    vec2 dir = vOffset / max(rho, 1e-5);
    float approach = uSpin.x * dir.y - uSpin.y * dir.x; // (L x e).z
    float beaming = max(1.0 + uDoppler * 0.8 * approach, 0.0);

    vec3 color = vec3(1.0, 0.96, 0.86) * ring * 2.4
               + vec3(1.0, 0.70, 0.28) * inner * 0.9
               + vec3(0.95, 0.30, 0.06) * halo * 0.22;

    float fade = 1.0 - smoothstep(0.7, 1.0, rho / uSize);
    gl_FragColor = vec4(color * beaming * uIntensity * fade, 1.0);
  }
`;
