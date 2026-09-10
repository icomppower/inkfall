import * as THREE from 'three';
import { World } from './sim/world';
import { DEFAULT_SEED, COURSE_LENGTH } from './sim/constants';
import { makeSample } from './sim/course';
import { buildTerrainGeometry } from './render/terrainMesh';
import { buildTrailGeometry } from './render/trailMesh';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? DEFAULT_SEED;
const capture = params.get('capture') === '1';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const world = new World(seed);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f1ea);
scene.add(new THREE.Mesh(buildTerrainGeometry(world), new THREE.MeshBasicMaterial({ color: 0x8a8f8a, wireframe: true })));
scene.add(new THREE.Mesh(buildTrailGeometry(world), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, wireframe: true })));

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 6000);
let debugS = 40;
function placeCamera(): void {
  const c = world.course;
  const y = c.surfaceHeight(debugS, 0);
  const i = c.idx(debugS);
  camera.position.set(c.centreX(debugS) - c.tx[i] * 22, y + 12, c.centreZ(debugS) - c.tz[i] * 22);
  camera.lookAt(c.centreX(debugS + 30), c.surfaceHeight(debugS + 30, 0) + 1, c.centreZ(debugS + 30));
}
placeCamera();

addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

let frames = 0;
function frame(): void {
  frames++;
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (capture) {
  const smp = makeSample();
  (window as unknown as Record<string, unknown>).__INKFALL = {
    ready: true,
    seed,
    frames: () => frames,
    courseLength: COURSE_LENGTH,
    controlPointCount: world.course.controlPoints.length,
    erodedDroplets: world.terrain.erodedDroplets,
    seek(progress: number) { debugS = progress * COURSE_LENGTH; },
    sample(s: number, lateral: number) { return { ...world.course.sample(s, lateral, smp) }; },
    centre(s: number) { return { x: world.course.centreX(s), y: world.course.centreY(s), z: world.course.centreZ(s) }; },
    terrainHeight(x: number, z: number) { return world.terrain.heightAt(x, z); },
    nearest(x: number, z: number) { return world.course.nearest(x, z); },
    cps: world.course.controlPoints,
  };
}
