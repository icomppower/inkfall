import * as THREE from 'three';
import { makeInkUniforms, makePostMaterial, type InkUniforms } from './inkExports';

export interface PipelineTargets { colour: THREE.Texture; normalDepth: THREE.Texture; }

const SHADOW_SIZE = 2048;
const SHADOW_EXTENT = 62;

/**
 * Two-target geometry pass (colour + normal/depth), a single hard-threshold shadow map
 * that follows the player, then the full-screen ink pass.
 */
export class InkPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly shared: InkUniforms;
  readonly post: ReturnType<typeof makePostMaterial>;

  private mrt: THREE.WebGLRenderTarget;
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowCam = new THREE.OrthographicCamera(-SHADOW_EXTENT, SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, 1, 620);
  private depthMat = new THREE.MeshDepthMaterial();
  private quad: THREE.Mesh;
  private quadCam = new THREE.Camera();
  private width = 1;
  private height = 1;
  dpr = 1;
  shadowsEnabled = true;
  /** Geometry-pass stats, snapshotted before the full-screen ink pass overwrites them. */
  geoCalls = 0;
  geoTriangles = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.shared = makeInkUniforms();
    this.mrt = new THREE.WebGLRenderTarget(1, 1, {
      count: 2,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.mrt.textures[0].name = 'colour';
    this.mrt.textures[1].name = 'normalDepth';

    const depthTex = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    depthTex.type = THREE.UnsignedIntType;
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    this.shadowRT = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      depthTexture: depthTex, depthBuffer: true, stencilBuffer: false,
    });
    this.shared.uShadowMap.value = depthTex;

    this.post = makePostMaterial(
      this.shared.uInk.value as THREE.Color,
      this.shared.uPaper.value as THREE.Color,
    );
    this.post.uniforms.tColour.value = this.mrt.textures[0];
    this.post.uniforms.tNormalDepth.value = this.mrt.textures[1];
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.post.material);
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number, dpr = this.dpr): void {
    this.dpr = dpr;
    this.width = Math.max(1, Math.round(w * dpr));
    this.height = Math.max(1, Math.round(h * dpr));
    this.mrt.setSize(this.width, this.height);
    (this.post.uniforms.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
  }

  get size(): { w: number; h: number } { return { w: this.width, h: this.height }; }

  private renderShadow(scene: THREE.Scene, focus: THREE.Vector3, hide: THREE.Object3D[]): void {
    const sun = this.shared.uSunDir.value as THREE.Vector3;
    this.shadowCam.position.copy(focus).addScaledVector(sun, 260);
    this.shadowCam.lookAt(focus);
    this.shadowCam.updateMatrixWorld(true);
    this.shadowCam.updateProjectionMatrix();

    const wasVisible = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    scene.overrideMaterial = this.depthMat;
    this.renderer.setRenderTarget(this.shadowRT);
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, this.shadowCam);
    scene.overrideMaterial = null;
    hide.forEach((o, i) => { o.visible = wasVisible[i]; });

    (this.shared.uShadowMatrix.value as THREE.Matrix4)
      .multiplyMatrices(this.shadowCam.projectionMatrix, this.shadowCam.matrixWorldInverse);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, focus: THREE.Vector3, shadowHide: THREE.Object3D[] = []): void {
    if (this.shadowsEnabled) this.renderShadow(scene, focus, shadowHide);
    this.renderer.setRenderTarget(this.mrt);
    this.renderer.setClearColor(0xf4f1ea, 1);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);
    this.geoCalls = this.renderer.info.render.calls;
    this.geoTriangles = this.renderer.info.render.triangles;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quad, this.quadCam);
  }

  dispose(): void {
    this.mrt.dispose();
    this.shadowRT.dispose();
  }
}
