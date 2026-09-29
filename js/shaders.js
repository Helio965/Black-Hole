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

    // Soft inner edge instead of a hard cut: it covers the (aliased) outline of
    // the sphere even without MSAA, while the shadow itself stays pure black.
    float inside = smoothstep(0.955, 0.995, x);
    if (inside <= 0.0) discard;

    float d = x - 1.0;
    float outside = max(d, 0.0);
    float ring = exp(-pow(d / 0.022, 2.0)); // razor-thin photon ring
    float inner = exp(-outside * 9.0);      // hot glow hugging the edge
    float halo = exp(-outside * 4.5);       // soft aura, kept short so the sky stays black

    // Side of the ring that moves towards the camera looks brighter.
    vec2 dir = vOffset / max(rho, 1e-5);
    float approach = uSpin.x * dir.y - uSpin.y * dir.x; // (L x e).z
    float beaming = max(1.0 + uDoppler * 0.8 * approach, 0.0);

    vec3 color = vec3(1.0, 0.94, 0.82) * ring * 1.6
               + vec3(1.0, 0.66, 0.26) * inner * 0.5
               + vec3(0.95, 0.30, 0.06) * halo * 0.06;

    float fade = 1.0 - smoothstep(0.7, 1.0, rho / uSize);
    gl_FragColor = vec4(color * beaming * uIntensity * fade * inside, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// 3D simplex noise
// Ashima Arts / Stefan Gustavson, MIT License
// https://github.com/ashima/webgl-noise
// ---------------------------------------------------------------------------

export const noiseChunk = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

// ---------------------------------------------------------------------------
// Gravitational lensing (thin point-mass lens, weak-field approximation)
//
// Works in view space. For a source point behind the hole, its angular offset
// from the hole (β) is mapped to the two images predicted by the lens equation:
//
//     θ± = ( β ± sqrt(β² + 4·θE²) ) / 2        θE² = 2·Rs·Dls / (Dl·Ds)
//
//   θ+ : primary image, pushed outwards, beyond the Einstein ring
//        -> the far side of the disc is lifted over the top of the shadow.
//   θ- : secondary image, on the opposite side of the hole
//        -> the arc that wraps under the shadow.
//
// The weak-field θ- would hide most of the secondary image inside the shadow.
// Close to a real black hole (strong field) it hugs the shadow instead, so the
// secondary image is drawn as a compressed mirror of the primary one, weighted
// by the point-lens magnification μ- (see lensMagnification). Artistic, but it
// reproduces the look of the classic renders.
//
// Every vertex is lensed on its own, so streaks bend and stretch naturally.
// Surface brightness is conserved by lensing, so colours are left untouched.
// ---------------------------------------------------------------------------

export const lensChunk = /* glsl */ `
  uniform float uLensStrength; // 0 = no lensing, 1 = weak-field point lens (Rs = 1)
  uniform float uShadowRadius; // radius of the black sphere, in world units

  const float SECONDARY_SQUASH = 0.6;

  vec3 gravitationalLens(vec3 p, vec3 hole, float imageSign) {
    float Dl = -hole.z; // camera -> hole
    float Ds = -p.z;    // camera -> source
    float Dls = Ds - Dl;

    if (Dls <= 0.0) {
      // In front of the hole nothing is bent. There is no secondary image
      // either: tuck it right behind the centre, where the shadow hides it.
      return imageSign > 0.0 ? p : hole * 1.02;
    }

    vec2 holeDir = hole.xy / Dl;
    vec2 beta = p.xy / Ds - holeDir;
    float b = length(beta);
    float thetaE2 = uLensStrength * 2.0 * Dls / (Dl * Ds);
    float theta = 0.5 * (b + sqrt(b * b + 4.0 * thetaE2)); // primary image

    if (imageSign < 0.0) {
      // Compressed mirror of the primary image, starting at the shadow's edge.
      float thetaShadow = uShadowRadius / sqrt(max(Dl * Dl - uShadowRadius * uShadowRadius, 1e-4));
      theta = -(thetaShadow + SECONDARY_SQUASH * (theta - thetaShadow));
    }

    vec2 dir = b > 1e-6 ? beta / b : vec2(0.0, 1.0);

    return vec3((holeDir + dir * theta) * Ds, p.z);
  }

  // Brightness gain of a point source for the same image:
  // μ± = (u² + 2) / (2u·sqrt(u² + 4)) ± 1/2, with u = β / θE.
  float lensMagnification(vec3 p, vec3 hole, float imageSign) {
    float Dl = -hole.z;
    float Ds = -p.z;
    float Dls = Ds - Dl;
    if (Dls <= 0.0 || uLensStrength <= 0.0) return imageSign > 0.0 ? 1.0 : 0.0;

    float thetaE = sqrt(uLensStrength * 2.0 * Dls / (Dl * Ds));
    float u = max(length(p.xy / Ds - hole.xy / Dl) / thetaE, 1e-3);
    float mu = (u * u + 2.0) / (2.0 * u * sqrt(u * u + 4.0));
    return min(mu + 0.5 * imageSign, 12.0);
  }
`;

// ---------------------------------------------------------------------------
// Accretion disc
// Each instance is a short luminous streak. Its whole orbit is computed here,
// on the GPU, from a handful of per-instance numbers: nothing is updated on the
// CPU per frame except a few uniforms.
// ---------------------------------------------------------------------------

export const diskVertex = /* glsl */ `
  ${noiseChunk}
  ${lensChunk}

  uniform float uTime;            // orbital clock, already scaled by the speed control
  uniform float uFlowTime;        // clock for the turbulence field
  uniform float uIntensity;
  uniform float uBrightnessScale; // compensates for the number of visible streaks
  uniform float uDoppler;
  uniform float uKepler;
  uniform float uInnerRadius;
  uniform float uOuterRadius;
  uniform float uImageSign;       // +1 primary image, -1 secondary image

  attribute vec4 aOrbit; // x: radius, y: start angle, z: vertical offset, w: relative glow
  attribute vec4 aLook;  // x: trail length (rad), y: width, z: brightness, w: speed jitter

  varying vec3 vColor;
  varying vec2 vStrip;

  // The geometry of a streak stops where its glow becomes negligible: the end
  // of the tail and the outer part of its width (< ~20% opacity) are never
  // rasterised. Same look, ~40% fewer blended fragments.
  const float TAIL_KEPT = 0.8;
  const float WIDTH_KEPT = 0.75;

  // Temperature ramp: dark red -> red -> orange -> yellow -> white.
  vec3 heatColor(float t) {
    vec3 c = mix(vec3(0.22, 0.025, 0.01), vec3(0.78, 0.11, 0.02), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3(1.0, 0.36, 0.05), smoothstep(0.22, 0.55, t));
    c = mix(c, vec3(1.0, 0.6, 0.16), smoothstep(0.5, 0.85, t));
    c = mix(c, vec3(1.0, 0.86, 0.55), smoothstep(0.85, 1.0, t));
    // A faint cold tint on the very outskirts of the disc.
    c = mix(c, vec3(0.25, 0.2, 0.4), (1.0 - smoothstep(0.0, 0.08, t)) * 0.18);
    return c;
  }

  void main() {
    float along = position.x * TAIL_KEPT; // 0 = head of the streak, 1 = end of its (full) tail
    float side = position.y * WIDTH_KEPT; // -1 .. 1 across the (full) streak

    // --- Orbit ------------------------------------------------------------
    // Kepler: angular speed ω ∝ r^-3/2, i.e. linear speed v ∝ 1/√r.
    float radius = aOrbit.x;
    float omega = uKepler * pow(radius, -1.5) * aLook.w;
    float phiHead = aOrbit.y + omega * uTime;

    // --- Early out ------------------------------------------------------------
    // Most streaks have no visible secondary image: the ones in front of the
    // hole have none at all, and the ones beside it get a faint (μ- ~ 0) but
    // long mirrored image that would still cost a lot of blending. Drop them
    // before the expensive part of the shader. All the vertices of a streak
    // take the same decision, based on its head.
    if (uImageSign < 0.0) {
      vec3 headView = (viewMatrix * modelMatrix * vec4(radius * cos(phiHead), 0.0, -radius * sin(phiHead), 1.0)).xyz;
      vec3 holeView = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float reach = radius * aLook.x + 1.0; // tail length + turbulence, conservative
      bool inFront = -headView.z < -holeView.z - reach;
      if (inFront || lensMagnification(headView, holeView, -1.0) < 0.02) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside the clip volume: nothing is drawn
        vColor = vec3(0.0);
        vStrip = vec2(0.0);
        return;
      }
    }

    float phi = phiHead - along * aLook.x;
    float c = cos(phi);
    float s = sin(phi);

    vec3 local = vec3(radius * c, 0.0, -radius * s);

    // --- Turbulence ---------------------------------------------------------
    // A slowly drifting noise field lifts the streaks out of the plane and
    // makes them slightly wavy.
    float thickness = 0.025 + 0.014 * radius;
    float turbulence = snoise(vec3(local.xz * 0.23, uFlowTime * 0.15));
    local.y = (aOrbit.z * 0.55 + 0.8 * turbulence) * thickness;
    local.xz *= 1.0 + 0.012 * turbulence;

    vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
    vec3 tangent = normalize(mat3(modelMatrix) * vec3(-s, 0.0, -c));
    vec3 toCamera = normalize(cameraPosition - world);

    // Billboard the streak around its own direction of motion.
    vec3 across = cross(tangent, toCamera);
    float acrossLength = length(across);
    across = acrossLength > 1e-4 ? across / acrossLength : vec3(0.0, 1.0, 0.0);
    world += across * side * aLook.y * (1.0 - 0.6 * along);

    // --- Lensing ------------------------------------------------------------
    // The hole sits at the world origin.
    vec4 view = viewMatrix * vec4(world, 1.0);
    vec3 hole = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    // The secondary image only shows up where the lens really produces one.
    float imageWeight = uImageSign > 0.0 ? 1.0 : clamp(lensMagnification(view.xyz, hole, -1.0), 0.0, 1.0);
    view.xyz = gravitationalLens(view.xyz, hole, uImageSign);
    gl_Position = projectionMatrix * view;

    // --- Colour -------------------------------------------------------------
    // Artistic relativistic Doppler: matter moving towards the camera is
    // brighter (δ³) and hotter, matter moving away is dimmer and redder.
    float speed = sqrt(0.5 / max(radius - 1.0, 0.5)); // orbital speed / c for Rs = 1
    float beta = min(speed * uDoppler, 0.85);
    float gamma = inversesqrt(1.0 - beta * beta);
    float delta = 1.0 / (gamma * (1.0 - beta * dot(tangent, toCamera)));
    float beaming = delta * delta * delta;

    float heat = pow(clamp((uOuterRadius - radius) / (uOuterRadius - uInnerRadius), 0.0, 1.0), 1.35);
    heat *= mix(0.55, 1.0, aOrbit.w);                 // dimmer streaks are cooler (redder)
    heat = clamp(heat * mix(1.0, delta, 0.7), 0.0, 1.0); // Doppler: approaching side is hotter

    vColor = heatColor(heat) * aLook.z * beaming * imageWeight * uIntensity * uBrightnessScale;
    vStrip = vec2(along, side);
  }
`;

export const diskFragment = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vStrip;

  void main() {
    // Interpolated varyings can overshoot [0, 1] by a hair: clamp before pow()
    // so no NaN reaches the (floating point) bloom buffers.
    vec2 strip = clamp(vStrip, vec2(0.0, -1.0), vec2(1.0, 1.0));
    float head = smoothstep(0.0, 0.1, strip.x); // soft leading edge
    float tail = pow(1.0 - strip.x, 1.4);       // fading comet-like tail
    float core = 1.0 - strip.y * strip.y;       // bright centre line

    // The tail cools down as it fades: dimmer means redder, like a black body.
    vec3 color = vColor * mix(vec3(1.0, 0.42, 0.22), vec3(1.0), tail);
    gl_FragColor = vec4(color, head * tail * core * core);
  }
`;

// ---------------------------------------------------------------------------
// Starfield
// Very faint points far away. They are lensed too: stars behind the hole are
// pushed around the shadow and brighten near the Einstein ring.
// ---------------------------------------------------------------------------

export const starVertex = /* glsl */ `
  ${lensChunk}

  uniform float uTime;
  uniform float uPixelRatio;

  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aImage; // +1 primary image, -1 secondary image

  varying vec3 vColor;

  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vec3 hole = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

    float magnification = lensMagnification(view.xyz, hole, aImage);
    view.xyz = gravitationalLens(view.xyz, hole, aImage);
    gl_Position = projectionMatrix * view;

    float twinkle = 0.75 + 0.25 * sin(uTime * (0.4 + 1.6 * aSeed) + aSeed * 60.0);
    float gain = min(magnification, 5.0);
    gl_PointSize = max(aSize * uPixelRatio * sqrt(max(gain, 0.3)), 1.0);
    vColor = aColor * twinkle * gain;
  }
`;

export const starFragment = /* glsl */ `
  uniform float uOpacity;

  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * uOpacity, alpha * alpha);
  }
`;

// ---------------------------------------------------------------------------
// Bloom blend with a "shadow mask"
// Replaces the final additive blend of UnrealBloomPass: the glow fades out
// inside the silhouette of the hole, so bloom never fills the shadow with light.
// ---------------------------------------------------------------------------

export const bloomBlendFragment = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float opacity;
  uniform vec2 uHoleCenter; // screen uv
  uniform float uHoleRadius; // fraction of the screen height
  uniform float uAspect;

  varying vec2 vUv;

  void main() {
    vec4 glow = texture2D(tDiffuse, vUv);
    vec2 d = (vUv - uHoleCenter) * vec2(uAspect, 1.0);
    float mask = smoothstep(uHoleRadius * 0.72, uHoleRadius * 1.02, length(d));
    gl_FragColor = opacity * glow * mask;
  }
`;
