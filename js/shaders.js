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
// Accretion disc
// Each instance is a short luminous streak. Its whole orbit is computed here,
// on the GPU, from a handful of per-instance numbers: nothing is updated on the
// CPU per frame except a few uniforms.
// ---------------------------------------------------------------------------

export const diskVertex = /* glsl */ `
  ${noiseChunk}

  uniform float uTime;            // orbital clock, already scaled by the speed control
  uniform float uFlowTime;        // clock for the turbulence field
  uniform float uIntensity;
  uniform float uBrightnessScale; // compensates for the number of visible streaks
  uniform float uDoppler;
  uniform float uKepler;
  uniform float uInnerRadius;
  uniform float uOuterRadius;

  attribute vec4 aOrbit; // x: radius, y: start angle, z: vertical offset, w: random seed
  attribute vec4 aLook;  // x: trail length (rad), y: width, z: brightness, w: speed jitter

  varying vec3 vColor;
  varying vec2 vStrip;

  // Temperature ramp: dark red -> red -> orange -> yellow -> white.
  vec3 heatColor(float t) {
    vec3 c = mix(vec3(0.16, 0.012, 0.012), vec3(0.72, 0.075, 0.02), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3(1.0, 0.34, 0.05), smoothstep(0.2, 0.5, t));
    c = mix(c, vec3(1.0, 0.70, 0.24), smoothstep(0.45, 0.78, t));
    c = mix(c, vec3(1.0, 0.94, 0.78), smoothstep(0.78, 1.0, t));
    // A faint cold tint on the very outskirts of the disc.
    c = mix(c, vec3(0.22, 0.2, 0.42), (1.0 - smoothstep(0.0, 0.1, t)) * 0.35);
    return c;
  }

  void main() {
    float along = position.x; // 0 = head of the streak, 1 = end of its tail
    float side = position.y;  // -1 .. 1 across the streak

    // --- Orbit ------------------------------------------------------------
    // Kepler: angular speed ω ∝ r^-3/2, i.e. linear speed v ∝ 1/√r.
    float radius = aOrbit.x;
    float omega = uKepler * pow(radius, -1.5) * aLook.w;
    float phi = aOrbit.y + omega * uTime - along * aLook.x;
    float c = cos(phi);
    float s = sin(phi);

    vec3 local = vec3(radius * c, 0.0, -radius * s);

    // --- Turbulence ---------------------------------------------------------
    // A slowly drifting noise field lifts the streaks out of the plane and
    // makes them slightly wavy.
    float thickness = 0.035 + 0.02 * radius;
    float turbulence = snoise(vec3(local.xz * 0.23, uFlowTime * 0.15));
    local.y = (aOrbit.z * 0.6 + turbulence) * thickness;
    local.xz *= 1.0 + 0.012 * turbulence;

    vec3 world = (modelMatrix * vec4(local, 1.0)).xyz;
    vec3 tangent = normalize(mat3(modelMatrix) * vec3(-s, 0.0, -c));
    vec3 toCamera = normalize(cameraPosition - world);

    // Billboard the streak around its own direction of motion.
    vec3 across = cross(tangent, toCamera);
    float acrossLength = length(across);
    across = acrossLength > 1e-4 ? across / acrossLength : vec3(0.0, 1.0, 0.0);
    world += across * side * aLook.y * (1.0 - 0.6 * along);

    vec4 view = viewMatrix * vec4(world, 1.0);
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
    heat = clamp(heat * mix(1.0, delta, 0.7), 0.0, 1.0);

    vColor = heatColor(heat) * aLook.z * beaming * uIntensity * uBrightnessScale;
    vStrip = vec2(along, side);
  }
`;

export const diskFragment = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vStrip;

  void main() {
    float head = smoothstep(0.0, 0.1, vStrip.x);  // soft leading edge
    float tail = pow(1.0 - vStrip.x, 1.4);        // fading comet-like tail
    float core = 1.0 - vStrip.y * vStrip.y;       // bright centre line
    gl_FragColor = vec4(vColor, head * tail * core * core);
  }
`;
