// The form check in 3D, built only when the person asks (app.js loads this module, three.js and the character on
// demand): their rep on the Y Bot (retarget.js), the faulty part in red, next to the same character doing the right
// form (the demo's clip from its GLB), both looped at 3/4 speed with their turning points together; for a held pose,
// the movement library's animation of it over its held part, turned to face as the person does and to their working
// side. Drag to turn it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { faultBones, makeRetarget, mirrorSide, mirrorWorld, smoothWorld } from './retarget.js';

const { Rig, tint } = makeRetarget(THREE);
const models = new Map();                 // url -> Promise<gltf> (each character file is fetched once)
const load = url => {
  if (!models.has(url)) models.set(url, new GLTFLoader().loadAsync(url).catch(e => { models.delete(url); throw e; }));
  return models.get(url);
};
const HOLD_MS = 500;                      // a short pause before the loop starts again

/** Extent of a posed character: its width (x), for laying the two out side by side, and its top (arms raised). From
 * the skinned mesh as posed (`precise`: without it three.js reuses the box of the first pose it measured). */
function extent(root, into = { w: 0, top: 0 }) {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root, true);
  into.w = Math.max(into.w, b.max.x - b.min.x); into.top = Math.max(into.top, b.max.y);
  return into;
}

/** The way a character faces now (the angle about y of its front, 0 facing +z: the camera), from its hips' line; null
 * without the hip bones. */
function facing(root) {
  const l = root.getObjectByName('mixamorigLeftUpLeg'), r = root.getObjectByName('mixamorigRightUpLeg');
  if (!l || !r) return null;
  root.updateMatrixWorld(true);
  const right = r.getWorldPosition(new THREE.Vector3()).sub(l.getWorldPosition(new THREE.Vector3()));
  const f = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right).setY(0);
  return f.lengthSq() > 1e-8 ? Math.atan2(f.x, f.z) : null;
}

export class View3D {
  constructor(el) { this.el = el; this.raf = 0; this.gen = 0; this.renderer = null; }

  /**
   * frames: [{t, world}] over the rep (t in ms); turn: its turning point (ms); part/side: the faulty body part;
   * model: the character's GLB url; demo: {model, segment: {start, end, turn} (s), face, mirror} of the right form, or
   * null (segment null: the whole clip; face: turned to face the way the person does; mirror: done on the other
   * side); mirror: show it mirrored like the camera view. Resolves to null if closed or opened again while loading.
   */
  async open({ frames, turn, part, side, model, demo, mirror = false, speed = 0.75 }) {
    this.close();
    const gen = this.gen;                 // (close() and a later open() move it on: this build is then dropped)
    // mirrored like the camera view: the person's pose mirrored (their right then shows on the figure's left side)
    const fr = smoothWorld(frames.filter(f => f.world)).filter(f => f.world)
      .map(f => (mirror ? { ...f, world: mirrorWorld(f.world) } : f));
    if (fr.length < 2) throw new Error('not enough of the rep was tracked in 3D');
    const [mine, theirs] = await Promise.all([load(model), demo ? load(demo.model) : null]);
    if (gen !== this.gen) return null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e2124);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f47, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1.5, 3, 2.5); scene.add(sun);
    const grid = new THREE.GridHelper(8, 16, 0x4a515c, 0x2c3138); scene.add(grid);
    const world = new THREE.Group(); scene.add(world);

    // the person: a fresh copy of the character, posed frame by frame, the faulty part in red
    const you = cloneSkinned(mine.scene);
    tint(you, faultBones(part, mirror ? mirrorSide(side) : side));
    const rig = new Rig(you);
    const youSlot = new THREE.Group(); youSlot.add(you); world.add(youSlot);
    const eYou = { w: 0, top: 0 };
    for (let k = 0; k < fr.length; k += Math.max(1, Math.floor(fr.length / 8))) { rig.pose(fr[k].world); extent(you, eYou); }

    // the right form: the same character playing the demo's clip over the same rep
    let mixer = null, action = null, demoSlot = null, hips0 = null, them = null;
    const eDemo = { w: 0, top: 0 };
    const clip = demo && theirs?.animations?.[0];
    const seg = clip ? demo.segment ?? { start: 0, end: clip.duration } : null;   // (none given: the whole clip)
    if (clip) {                                                  // (a character file without its clip: no demo)
      them = cloneSkinned(theirs.scene);
      demoSlot = new THREE.Group(); demoSlot.add(them); world.add(demoSlot);
      mixer = new THREE.AnimationMixer(them);
      action = mixer.clipAction(clip); action.play();
      const hips = them.getObjectByName('mixamorigHips');
      action.time = seg.turn ?? seg.start; mixer.update(0);
      // turned to face the way the person faces (the library's clips face wherever their footage's camera was), then
      // mirrored for a person working on the other side (the slot: mirrored first, then nothing else turns it)
      if (demo.face) {
        rig.pose(fr[fr.length >> 1].world);
        const a = facing(you), b = facing(them);
        if (a != null && b != null) them.rotation.y = (demo.mirror ? -a : a) - b;
      }
      if (demo.mirror) { demoSlot.scale.x = -1; demoSlot.updateMatrixWorld(true); }
      for (let k = 0; k <= 8; k += 1) {
        action.time = seg.start + (k / 8) * (seg.end - seg.start); mixer.update(0); extent(them, eDemo);
      }
      action.time = seg.turn ?? seg.start; mixer.update(0);
      hips0 = demoSlot.worldToLocal(hips.getWorldPosition(new THREE.Vector3()));
      them.position.x -= hips0.x; them.position.z -= hips0.z;     // its hips over its spot on the floor
    }

    // side by side ("You" on the left), framed to fit
    const gap = demoSlot ? Math.max(1.0, (eYou.w + eDemo.w) / 2 + 0.35) : 0;
    youSlot.position.x = -gap / 2;
    if (demoSlot) demoSlot.position.x = gap / 2;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    const span = gap + Math.max(eYou.w, eDemo.w, 0.9) + 0.3;      // the width to show, and the height (arms raised)
    const tall = Math.max(eYou.top, eDemo.top, 0.8) + 0.45;      // (room above for the labels; lying down: lower)
    const controls = new OrbitControls(camera, this.el);
    controls.target.set(0, tall / 2 - 0.1, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.55;
    let moved = false;
    controls.addEventListener('start', () => { moved = true; });
    /** Frame both characters (the field of view is vertical: the width needs the aspect), until the person turns it. */
    const frameView = () => {
      if (moved) return;
      // (15% to spare: the parts nearer the camera, a hand or a foot, look bigger)
      const d = 1.15 * Math.max(tall, span / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      camera.position.set(0, tall / 2 + 0.1, d); controls.update();
    };

    // one renderer for the page's life: a WebGL context per view would run out (the browser keeps ~16), and three.js
    // keeps the renderer's listeners on the cached character the demo copy shares
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.el.appendChild(this.renderer.domElement);
    }
    const renderer = this.renderer;
    const fit = () => {
      const w = this.el.clientWidth || 640, h = this.el.clientHeight || 360;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      frameView();
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(this.el);

    // one loop: the person's rep at `speed`, the demo's segment stretched so both turn together; a demo clip with no
    // whole rep (the press's footage never lowers the bar) plays on its own at the same speed
    const t0 = fr[0].t, t1 = fr.at(-1).t, tTurn = Math.min(Math.max(turn, t0 + 1), t1 - 1);
    const synced = seg?.turn != null;
    const dTurn = synced ? Math.min(Math.max(seg.turn, seg.start), seg.end) : 0;
    const demoTime = (t, now) => {
      if (!synced) {
        const len = Math.max(0.1, seg.end - seg.start);
        return seg.start + (this.seek != null ? this.seek * len : (((now - start) * speed) / 1000) % len);
      }
      return t <= tTurn ? seg.start + ((t - t0) / (tTurn - t0)) * (dTurn - seg.start)
        : dTurn + ((t - tTurn) / (t1 - tTurn)) * (seg.end - dTurn);
    };
    const start = performance.now();
    let i = 0;
    const frame = now => {
      // (`seek`, 0-1 through the rep, holds it there: for checking a pose from the console)
      const el = this.seek != null ? this.seek * (t1 - t0) : ((now - start) * speed) % (t1 - t0 + HOLD_MS);
      const t = t0 + Math.min(el, t1 - t0);
      while (i > 0 && fr[i].t > t) i -= 1;
      while (i < fr.length - 1 && fr[i + 1].t <= t) i += 1;
      rig.pose(fr[i].world);
      if (action) {
        action.time = demoTime(t, now); mixer.update(0);
      }
      controls.update();
      renderer.render(scene, camera);
      this.progress?.(Math.min(el, t1 - t0) / (t1 - t0));
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    this.parts = { controls, ro, you, them, mixer, scene };
    return { demo: !!demoSlot, synced, turnAt: (tTurn - t0) / (t1 - t0) };
  }

  close() {
    this.gen += 1;
    cancelAnimationFrame(this.raf); this.raf = 0;
    const p = this.parts;
    if (!p) return;
    p.ro.disconnect(); p.controls.dispose();
    if (p.mixer) { p.mixer.stopAllAction(); p.mixer.uncacheRoot(p.them); }
    p.you.traverse(o => { if (o.isSkinnedMesh) { o.geometry.dispose(); o.material.dispose(); } });   // its own copies
    p.scene.clear();
    this.renderer.renderLists?.dispose();
    this.parts = null;
  }
}
