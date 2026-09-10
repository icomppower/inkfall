import * as THREE from 'three';

/** Shared 水墨 palette. Paper-white ground, one mid grey, one ink dark. */
export const PAPER = new THREE.Color(0xf4f1ea);
export const MID = new THREE.Color(0x9d9c95);
export const INK = new THREE.Color(0x26262a);
export const RIM = new THREE.Color(0x8fa7bd);

export interface InkUniforms {
  uSunDir: { value: THREE.Vector3 };
  uPaper: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uInk: { value: THREE.Color };
  uRim: { value: THREE.Color };
  uHatch: { value: THREE.Texture | null };
  uHatchScale: { value: number };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uShadowMap: { value: THREE.Texture | null };
  uShadowMatrix: { value: THREE.Matrix4 };
  uWetness: { value: number };
  uCloudShade: { value: number };
  uTime: { value: number };
  [k: string]: { value: unknown };
}

export function makeInkUniforms(): InkUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(0.50, 0.56, 0.66).normalize() },
    uPaper: { value: PAPER.clone() },
    uMid: { value: MID.clone() },
    uInk: { value: INK.clone() },
    uRim: { value: RIM.clone() },
    uHatch: { value: null },
    uHatchScale: { value: 210 },
    uFogNear: { value: 70 },
    uFogFar: { value: 1150 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uWetness: { value: 0 },
    uCloudShade: { value: 0 },
    uTime: { value: 0 },
  };
}

const COMMON_VERT = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec3 normal;
in vec2 uv;
#ifdef USE_SURFACE_ID
in float aSurface;
out float vSurface;
#endif
#ifdef USE_SLOPE
in float aSlope;
out float vSlope;
#endif
#ifdef USE_INSTANCING
in mat4 instanceMatrix;
in vec3 aTint;
out vec3 vTint;
#endif
out vec3 vWorldNormal;
out vec3 vWorldPos;
out float vViewDepth;
out vec2 vUv;
void main() {
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
    vTint = aTint;
  #endif
  vec4 wp = model * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(model) * normal);
  vUv = uv;
  #ifdef USE_SURFACE_ID
    vSurface = aSurface;
  #endif
  #ifdef USE_SLOPE
    vSlope = aSlope;
  #endif
  vec4 mv = viewMatrix * wp;
  vViewDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const COMMON_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uPaper;
uniform vec3 uMid;
uniform vec3 uInk;
uniform vec3 uRim;
uniform sampler2D uHatch;
uniform float uHatchScale;
uniform float uFogNear;
uniform float uFogFar;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uWetness;
uniform float uCloudShade;
uniform float uTime;
uniform vec3 cameraPosition;
uniform float uRampOffset;
uniform float uTone;          // material darkening, 1 = untouched
uniform float uWetBand;       // how strongly this surface takes a wet reflection band
in vec3 vWorldNormal;
in vec3 vWorldPos;
in float vViewDepth;
in vec2 vUv;
#ifdef USE_SURFACE_ID
in float vSurface;
#endif
#ifdef USE_SLOPE
in float vSlope;
#endif
#ifdef USE_INSTANCING
in vec3 vTint;
#endif
layout(location = 0) out vec4 outColour;
layout(location = 1) out vec4 outNormalDepth;

float shadowFactor(vec3 wp, vec3 n) {
  vec4 sp = uShadowMatrix * vec4(wp, 1.0);
  vec3 sc = sp.xyz / sp.w;
  sc = sc * 0.5 + 0.5;
  if (sc.x < 0.01 || sc.x > 0.99 || sc.y < 0.01 || sc.y > 0.99 || sc.z > 1.0) return 1.0;
  // Slope-scaled bias: without it a raking sun writes acne stripes across every hillside.
  float slope = 1.0 - abs(dot(n, normalize(uSunDir)));
  float bias = 0.0016 + 0.010 * slope * slope;
  float d = texture(uShadowMap, sc.xy).x;
  float lit = (sc.z - bias > d) ? 0.0 : 1.0;   // single hard threshold, no PCF
  // Feather the map border so its edge is not itself a visible line.
  vec2 e = min(sc.xy, 1.0 - sc.xy);
  float fade = smoothstep(0.01, 0.07, min(e.x, e.y));
  return mix(1.0, lit, fade);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, normalize(uSunDir));
  float lit = ndl * 0.5 + 0.5 + uRampOffset - uCloudShade * 0.16;
  lit = mix(lit * 0.74, lit, shadowFactor(vWorldPos, N));
  #ifdef USE_SLOPE
    lit -= vSlope * 0.24;   // steep faces take more ink, like a brushed cliff
  #endif

  // Three-band toon ramp: ink-dark, mid grey, paper-white.
  float band = lit < 0.45 ? 0.0 : (lit < 0.70 ? 1.0 : 2.0);
  vec3 base = band < 0.5 ? uInk : (band < 1.5 ? uMid : uPaper);

  // Screen-space brush hatch, only in the two darker bands, so it reads like a print.
  vec2 hc = gl_FragCoord.xy / uHatchScale;
  vec3 hx = texture(uHatch, hc).rgb;
  float hatch = band < 0.5 ? hx.b : (band < 1.5 ? hx.g : 1.0);
  base *= hatch;

  // Cool rim on the shadow side.
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 6.0);
  base = mix(base, uRim, rim * 0.42 * smoothstep(0.30, -0.10, ndl));

  // Wet surfaces take a flat white reflection band on near-horizontal faces.
  float wetBand = uWetness * uWetBand * smoothstep(0.86, 0.99, N.y)
                * step(0.55, fract(vWorldPos.x * 0.09 + vWorldPos.z * 0.07 + 0.31));
  base = mix(base, mix(base, uPaper, 0.62), wetBand);

  base *= uTone;
  #ifdef USE_SURFACE_ID
    // 0 tarmac · 1 hardpack · 2 rock · 3 dirt · 4 wood · 5 stone
    float st = vSurface < 0.5 ? 0.80 : vSurface < 1.5 ? 0.95 : vSurface < 2.5 ? 0.86
             : vSurface < 3.5 ? 1.00 : vSurface < 4.5 ? 0.76 : 0.90;
    base *= st;
  #endif
  #ifdef USE_INSTANCING
    base *= vTint;
  #endif

  // Stepped fog: four quantized bands to 留白 paper-white.
  float f = clamp((vViewDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  f = floor(pow(f, 0.75) * 4.0 + 0.5) / 4.0;
  base = mix(base, uPaper, f);

  outColour = vec4(base, 1.0);
  outNormalDepth = vec4(N * 0.5 + 0.5, clamp(vViewDepth / uFogFar, 0.0, 1.0));
}
`;

export interface InkMaterialOptions {
  slope?: boolean;
  rampOffset?: number;
  tone?: number;
  wetBand?: number;
  instanced?: boolean;
  surfaceId?: boolean;
  side?: THREE.Side;
}

export function makeInkMaterial(shared: InkUniforms, opts: InkMaterialOptions = {}): THREE.RawShaderMaterial {
  const defines: Record<string, boolean> = {};
  if (opts.instanced) defines.USE_INSTANCING = true;
  if (opts.surfaceId) defines.USE_SURFACE_ID = true;
  if (opts.slope) defines.USE_SLOPE = true;
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines,
    uniforms: {
      ...shared,
      uRampOffset: { value: opts.rampOffset ?? 0 },
      uTone: { value: opts.tone ?? 1 },
      uWetBand: { value: opts.wetBand ?? 0 },
    },
    vertexShader: COMMON_VERT,
    fragmentShader: COMMON_FRAG,
    side: opts.side ?? THREE.FrontSide,
  });
  return m;
}

/** Inverted-hull outline: back faces pushed out along the normal, filled with ink. */
export function makeHullMaterial(shared: InkUniforms, thickness = 0.035): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uInk: shared.uInk, uFogFar: shared.uFogFar, uThickness: { value: thickness } },
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform mat4 projectionMatrix;
      uniform mat4 modelMatrix;
      uniform mat4 viewMatrix;
      uniform float uThickness;
      in vec3 position;
      in vec3 normal;
      out float vViewDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp;
        float d = -mv.z;
        // Constant screen-space weight: thick up close, hairline in the distance.
        wp.xyz += wn * uThickness * (0.55 + d * 0.02);
        mv = viewMatrix * wp;
        vViewDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uInk;
      uniform float uFogFar;
      in float vViewDepth;
      layout(location = 0) out vec4 outColour;
      layout(location = 1) out vec4 outNormalDepth;
      void main() {
        outColour = vec4(uInk * 0.55, 1.0);
        outNormalDepth = vec4(0.5, 0.5, 0.5, clamp(vViewDepth / uFogFar, 0.0, 1.0));
      }
    `,
  });
}
