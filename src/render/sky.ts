import * as THREE from 'three';
import type { InkUniforms } from './ink';

/** Paper-white sky with two drifting, quantized layers of ink-cloud bands. */
export function makeSky(shared: InkUniforms): THREE.Mesh {
  const geo = new THREE.SphereGeometry(2600, 24, 16);
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uPaper: shared.uPaper,
      uMid: shared.uMid,
      uInk: shared.uInk,
      uTime: shared.uTime,
      uCloudShade: shared.uCloudShade,
    },
    vertexShader: /* glsl */ `
      precision highp float;
      uniform mat4 projectionMatrix;
      uniform mat4 modelViewMatrix;
      in vec3 position;
      out vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w;      // always at the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uPaper;
      uniform vec3 uMid;
      uniform vec3 uInk;
      uniform float uTime;
      uniform float uCloudShade;
      in vec3 vDir;
      layout(location = 0) out vec4 outColour;
      layout(location = 1) out vec4 outNormalDepth;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        // Bands are stretched horizontally: ink drawn on wet paper runs sideways.
        vec2 p = vec2(atan(d.z, d.x) * 1.35, h * 3.4);
        float lowBand = fbm(p * vec2(1.0, 2.6) + vec2(uTime * 0.010, 0.0));
        float highBand = fbm(p * vec2(0.55, 1.7) + vec2(-uTime * 0.006, 4.7));
        float v = lowBand * 0.62 + highBand * 0.55;
        v += uCloudShade * 0.30;
        v -= h * 0.30;
        // Quantize into flat washes.
        float q = floor(clamp(v, 0.0, 1.0) * 4.0) / 4.0;
        vec3 col = mix(uPaper, uMid, smoothstep(0.24, 0.78, q));
        col = mix(col, mix(uMid, uInk, 0.35), smoothstep(0.72, 0.95, q) * (0.35 + uCloudShade * 0.5));
        outColour = vec4(col, 1.0);
        outNormalDepth = vec4(0.5, 0.5, 0.5, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}
