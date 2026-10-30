import * as THREE from '../vendor/three-0.170.0/build/three.module.js';
import { BONES, replayPose } from './review-analysis.js';
import { loadReviewCharacters, characterEvidence } from './review-character.js';
export { THREE };

const BODY_POINTS = [...new Set([0, ...BONES.flat()])];
const GOLD = new THREE.Color(0xffcf70);

export function makeSkeleton(color) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .65 });
  const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(.025, .025, 1, 8), material, BONES.length);
  const points = new THREE.InstancedMesh(new THREE.SphereGeometry(.05, 10, 8), material, BODY_POINTS.length);
  for (const mesh of [bones, points]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
  }
  return { bones, points, material, color: new THREE.Color(color) };
}

// Geometry is directly testable without a GPU. No inferred rig rotation, length or hidden joint is supplied.
export function poseSkeleton(figure, pose, { offset = 0, yaw = 0, part = [] } = {}) {
  const position = p => new THREE.Vector3(
    p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw) + offset,
    p[1], -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw));
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (const [a, b] of BONES) {
    if (!pose[a] || !pose[b]) continue;
    const from = position(pose[a]), to = position(pose[b]), direction = to.clone().sub(from), length = direction.length();
    if (length < 1e-6) continue;
    rotation.setFromUnitVectors(up, direction.normalize());
    matrix.compose(from.add(to).multiplyScalar(.5), rotation, new THREE.Vector3(1, length, 1));
    figure.bones.setMatrixAt(n, matrix);
    figure.bones.setColorAt(n, part.includes(a) && part.includes(b) ? GOLD : figure.color);
    n++;
  }
  figure.bones.count = n;
  n = 0;
  for (const id of BODY_POINTS) {
    if (!pose[id]) continue;
    matrix.makeTranslation(position(pose[id]));
    figure.points.setMatrixAt(n, matrix);
    figure.points.setColorAt(n, part.includes(id) ? GOLD : figure.color);
    n++;
  }
  figure.points.count = n;
  for (const mesh of [figure.bones, figure.points]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export class Review3D {
  constructor(el, { onStatus = () => {}, loadCharacters = loadReviewCharacters } = {}) {
    this.el = el;
    this.onStatus = onStatus;
    this.characterLoader = loadCharacters;
    this.modelGeneration = 0;
    this.characters = null;
    this.modelError = null;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#141e29');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x41536b, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 4, 5);
    this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.domElement.setAttribute('aria-label', '3D character comparison with labelled landmark fallback');
    el.append(this.renderer.domElement);
    this.figures = [0x52dbc9, 0xc4adff].map(makeSkeleton);
    for (const figure of this.figures) this.scene.add(figure.bones, figure.points);
    this.yaw = 0;
    this.last = null;
    this.pointer = null;
    this.down = e => { this.pointer = e.clientX; el.setPointerCapture(e.pointerId); };
    this.move = e => {
      if (this.pointer == null) return;
      this.yaw += (e.clientX - this.pointer) * .007;
      this.pointer = e.clientX;
      this.draw();
    };
    this.up = () => { this.pointer = null; };
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    this.ro = new ResizeObserver(() => {
      const w = el.clientWidth || 600, h = el.clientHeight || 400;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.position.set(0, 0, Math.max(5.6, 9 / this.camera.aspect) / (2 * Math.tan(19 * Math.PI / 180)));
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();
      this.draw();
    });
    this.ro.observe(el);
  }

  show(user, reference, options = {}) {
    this.last = { user, reference, options };
    this.draw();
  }

  async loadCharacters(buffer, { resourcePath = '', error = null } = {}) {
    const generation=++this.modelGeneration;
    this.characters?.dispose();this.characters=null;
    this.modelError=error;this.modelLoading=!!buffer;this.draw();
    if(!buffer)return false;
    try {
      const characters=await this.characterLoader(THREE,buffer,resourcePath);
      if(generation!==this.modelGeneration){characters.dispose();return false;}
      this.characters=characters;
      for(const item of characters.instances)this.scene.add(item.display);
    } catch(e) {if(generation===this.modelGeneration)this.modelError=e.message;}
    if(generation===this.modelGeneration){this.modelLoading=false;this.draw();}
    return !!this.characters;
  }

  draw() {
    if (this.last) {
      const { user, reference, options } = this.last;
      // Never highlight a guessed limb. The page additionally gates the selected finding's time interval.
      const part=options.part?.length && options.part.every(i=>user?.valid?.[i]) ? options.part : [];
      const evidence=characterEvidence(user),landmarks=options.landmarks||!this.characters;
      if(this.characters) {
        this.characters.pose(user,(reference?.t??0)/1000,{...options,part,yaw:this.yaw});
        this.characters.instances[0].display.visible=!landmarks&&evidence.supported;
        this.characters.instances[1].display.visible=!landmarks&&!!reference;
      }
      [user, reference].forEach((frame, i) => {
        const pose = replayPose(frame, { ...options, scale: options.scales?.[i] });
        const fallback=landmarks||(i===0&&!evidence.supported);
        this.figures[i].bones.visible=this.figures[i].points.visible=fallback;
        poseSkeleton(this.figures[i], pose, { offset: i ? 2.4 : -2.4, yaw: this.yaw, part });
      });
      this.onStatus({
        user:!landmarks&&evidence.supported?`You · Y Bot from saved pose${evidence.omitted.length?' · unmeasured parts hidden':''}`:`You · saved landmarks${options.landmarks?'':' (fallback)'}`,
        reference:!reference?'Reference · unavailable':!landmarks?'Reference · original animated Y Bot':`Reference · animation landmarks${options.landmarks?'':' (fallback)'}`,
        message:[this.modelLoading?'Loading the skinned Y Bot characters…':this.modelError?`Character unavailable: ${this.modelError} Landmark fallback shown; Load review retries the model.`:'',
          !options.landmarks&&!evidence.supported?`User character hidden. ${evidence.reason} Only reliable landmarks are shown.`:'',
          !landmarks&&evidence.supported?'Your character follows the saved frame. Y Bot proportions, fingers and axial twist are illustrative; no floor contact is inferred.':'',
          !landmarks&&evidence.omitted?.length?`Not shown (low confidence, not guessed): ${evidence.omitted.join(', ')}.`:''].filter(Boolean).join(' '),
      });
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.modelGeneration++;
    this.characters?.dispose();this.characters=null;
    this.ro.disconnect();
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.up);
    for (const figure of this.figures) {
      figure.bones.geometry.dispose();
      figure.points.geometry.dispose();
      figure.material.dispose();
      figure.bones.dispose();
      figure.points.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
