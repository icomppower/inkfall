import * as THREE from 'three';

export interface PostUniforms {
  tColour: { value: THREE.Texture | null };
  tNormalDepth: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uInk: { value: THREE.Color };
  uPaper: { value: THREE.Color };
  uTime: { value: number };
  uDepthThreshold: { value: number };
  uNormalThreshold: { value: number };
  uLineStrength: { value: number };
  uWobble: { value: number };
  uFlash: { value: number };
  uSpeedStroke: { value: number };
  uRain: { value: number };
  uDroplets: { value: number };
  uShake: { value: number };
  [k: string]: { value: unknown };
}

/**
 * Full-screen ink pass: Sobel over the normal+depth target becomes brush outlines,
 * with depth-varying weight and a noise wobble so lines read as bristle, not vector.
 */
export function makePostMaterial(ink: THREE.Color, paper: THREE.Color): {
  material: THREE.RawShaderMaterial; uniforms: PostUniforms;
} {
  const uniforms: PostUniforms = {
    tColour: { value: null },
    tNormalDepth: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uInk: { value: ink.clone() },
    uPaper: { value: paper.clone() },
    uTime: { value: 0 },
    uDepthThreshold: { value: 0.030 },
    uNormalThreshold: { value: 0.20 },
    uLineStrength: { value: 0.92 },
    uWobble: { value: 1.1 },
    uFlash: { value: 0 },
    uSpeedStroke: { value: 0 },
    uRain: { value: 0 },
    uDroplets: { value: 0 },
    uShake: { value: 0 },
  };
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      precision highp float;
      in vec3 position;
      in vec2 uv;
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tColour;
      uniform sampler2D tNormalDepth;
      uniform vec2 uTexel;
      uniform vec3 uInk;
      uniform vec3 uPaper;
      uniform float uTime;
      uniform float uDepthThreshold;
      uniform float uNormalThreshold;
      uniform float uLineStrength;
      uniform float uWobble;
      uniform float uFlash;
      uniform float uSpeedStroke;
      uniform float uRain;
      uniform float uDroplets;
      uniform float uShake;
      in vec2 vUv;
      out vec4 fragColour;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      void main() {
        vec2 uv = vUv;
        // Visor droplets refract the whole frame locally; rain shears it sideways.
        if (uDroplets > 0.0) {
          vec2 dg = uv * vec2(11.0, 7.0);
          vec2 cell = floor(dg);
          vec2 f = fract(dg) - 0.5;
          float seed = hash(cell);
          float alive = step(1.0 - uDroplets, seed);
          float slide = fract(seed * 7.3 + uTime * (0.05 + seed * 0.12));
          vec2 centre = vec2((seed - 0.5) * 0.55, (slide - 0.5) * 0.9);
          float r = length((f - centre) * vec2(1.0, 1.45));
          float d = alive * smoothstep(0.30, 0.06, r) * (0.35 + seed * 0.65);
          uv += normalize(f - centre + 1e-5) * d * 0.016;
        }
        if (uShake > 0.0) {
          uv += vec2(vnoise(vec2(uTime * 43.0, 3.1)) - 0.5,
                     vnoise(vec2(7.7, uTime * 39.0)) - 0.5) * uShake * 0.008;
        }

        vec4 c = texture(tColour, uv);
        vec4 nd = texture(tNormalDepth, uv);
        float depth = nd.a;
        vec3 nrm = nd.rgb * 2.0 - 1.0;

        // Depth-varying line weight, wobbled so the stroke has bristle.
        float weight = mix(2.4, 0.85, smoothstep(0.0, 0.22, depth));
        vec2 wob = vec2(vnoise(uv * 260.0 + uTime * 0.35),
                        vnoise(uv * 260.0 + 19.7 - uTime * 0.29)) - 0.5;
        vec2 step2 = uTexel * weight;
        vec2 base = uv + wob * uTexel * uWobble;

        vec4 sL = texture(tNormalDepth, base - vec2(step2.x, 0.0));
        vec4 sR = texture(tNormalDepth, base + vec2(step2.x, 0.0));
        vec4 sU = texture(tNormalDepth, base - vec2(0.0, step2.y));
        vec4 sD = texture(tNormalDepth, base + vec2(0.0, step2.y));
        // Second difference, not first: a ground plane seen edge-on has a huge depth
        // gradient but no curvature, so only real silhouettes get a line.
        float curv = max(abs(sL.a + sR.a - 2.0 * depth), abs(sU.a + sD.a - 2.0 * depth));
        float maxDepthDiff = curv / (depth * 0.65 + 0.0035);
        vec3 nC = normalize(nrm + 1e-6);
        float maxNormalDiff = 0.0;
        maxNormalDiff = max(maxNormalDiff, 1.0 - dot(normalize(sL.rgb * 2.0 - 1.0), nC));
        maxNormalDiff = max(maxNormalDiff, 1.0 - dot(normalize(sR.rgb * 2.0 - 1.0), nC));
        maxNormalDiff = max(maxNormalDiff, 1.0 - dot(normalize(sU.rgb * 2.0 - 1.0), nC));
        maxNormalDiff = max(maxNormalDiff, 1.0 - dot(normalize(sD.rgb * 2.0 - 1.0), nC));
        float edge = max(
          smoothstep(uDepthThreshold, uDepthThreshold * 2.2, maxDepthDiff),
          smoothstep(uNormalThreshold, uNormalThreshold * 2.0, maxNormalDiff));
        // Far ridges dissolve into 留白 rather than growing a hard outline.
        edge *= 1.0 - smoothstep(0.55, 0.95, depth);
        vec3 col = mix(c.rgb, uInk, edge * uLineStrength);

        // Peripheral ink speed-strokes.
        if (uSpeedStroke > 0.0) {
          vec2 p = uv - 0.5;
          float radial = length(p * vec2(1.0, 1.25));
          float ang = atan(p.y, p.x);
          float streak = vnoise(vec2(ang * 26.0, radial * 5.0 - uTime * 7.0));
          float mask = smoothstep(0.26, 0.62, radial) * uSpeedStroke;
          col = mix(col, uInk, smoothstep(0.62, 0.96, streak) * mask * 0.85);
        }

        // Rain: sheared screen-space streaks.
        if (uRain > 0.0) {
          vec2 rp = vec2(uv.x * 150.0 + uv.y * 26.0, uv.y * 26.0 - uTime * 16.0);
          float streak = vnoise(rp);
          float s = smoothstep(0.78, 0.99, streak) * uRain;
          col = mix(col, mix(uPaper, uInk, 0.25), s * 0.55);
        }

        col = mix(col, vec3(1.0), uFlash);
        fragColour = vec4(col, 1.0);
      }
    `,
  });
  return { material, uniforms };
}
