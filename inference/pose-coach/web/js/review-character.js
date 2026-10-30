// The review uses the original skinned GLB twice. Only the reference clone has an AnimationMixer.
// The user clone is reset to its skin's bind pose and driven by reliable, unsmoothed saved landmarks.
import { makeRetarget, faultBones } from './retarget.js';
import { visible } from './review-analysis.js';

// The torso (shoulders, hips) sets the body's frame and is required. Each limb segment follows only its own two
// landmarks; an unmeasured segment is not posed and is collapsed with everything below it, so nothing is guessed
// and no limb is left in its rest pose. Order matters: a parent's bone is listed before its children's.
const SEGMENTS = [
  ['head', 'Neck', [7,8]],
  ['left upper arm', 'LeftArm', [11,13]], ['left forearm', 'LeftForeArm', [13,15]], ['left hand', 'LeftHand', [15,17,19]],
  ['right upper arm', 'RightArm', [12,14]], ['right forearm', 'RightForeArm', [14,16]], ['right hand', 'RightHand', [16,18,20]],
  ['left thigh', 'LeftUpLeg', [23,25]], ['left lower leg', 'LeftLeg', [25,27]], ['left foot', 'LeftFoot', [27,31]],
  ['right thigh', 'RightUpLeg', [24,26]], ['right lower leg', 'RightLeg', [26,28]], ['right foot', 'RightFoot', [28,32]],
];
const CHILD = { Neck: [], LeftArm: ['LeftForeArm','LeftHand'], LeftForeArm: ['LeftHand'], RightArm: ['RightForeArm','RightHand'], RightForeArm: ['RightHand'],
  LeftUpLeg: ['LeftLeg','LeftFoot'], LeftLeg: ['LeftFoot'], RightUpLeg: ['RightLeg','RightFoot'], RightLeg: ['RightFoot'], LeftHand: [], RightHand: [], LeftFoot: [], RightFoot: [] };
const point = p => Array.isArray(p) ? p.slice(0,3) : p && [p.x,p.y,p.z];
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

export function characterEvidence(frame) {
  const valid = i => {const p=point(frame?.world?.[i]);return !!(frame?.valid?.[i] ?? visible(frame,i))&&p?.length===3&&p.every(Number.isFinite);};
  const torso=[11,12,23,24].filter(i=>!valid(i));
  if(torso.length)return {supported:false,reason:`Uncertain or missing ${[...new Set(torso.map(i=>i<20?'shoulders':'hips'))].join(', ')}.`,missing:torso.map(i=>i<20?'shoulders':'hips'),hidden:[],omitted:[]};
  const p = i => point(frame.world[i]),mid=(a,b)=>p(a).map((x,i)=>(x+p(b)[i])/2),up=sub(mid(11,12),mid(23,24));
  // A collapsed torso cannot define the body's orientation, even if its visibility is high.
  if(Math.hypot(...up)<.1 || [sub(p(11),p(12)),sub(p(23),p(24))].some(v=>Math.hypot(...cross(v,up))<.005))
    return {supported:false,reason:'The landmarks do not define a stable body orientation.',missing:[],hidden:[],omitted:[]};
  const measured=([name,,ids])=>ids.every(valid)&&(name==='head'?Math.hypot(...sub(mid(7,8),mid(11,12)))>=.05
    :name.endsWith('hand')?Math.hypot(...sub(mid(ids[1],ids[2]),p(ids[0])))>=.005:Math.hypot(...sub(p(ids[0]),p(ids[1])))>=.005);
  const hidden=[],omitted=[];
  for(const segment of SEGMENTS){
    const [name,bone]=segment;if(hidden.some(h=>CHILD[h].includes(bone)))continue;
    if(!measured(segment)){hidden.push(bone);omitted.push(name);}
  }
  return {supported:true,hidden,omitted,missing:[],reason:omitted.length
    ?`Character posed from this saved frame; not shown (low confidence): ${omitted.join(', ')}. Body shape, fingers and limb twist are illustrative.`
    :'Character posed from this saved frame; body shape, fingers and limb twist are illustrative.'};
}

export function highlightedBones(ids=[]) {
  const has = (...xs) => xs.every(x=>ids.includes(x)), names=[];
  if(has(23,24,25,26,27,28))return faultBones('legs');
  for(const [side,shoulder,elbow,wrist,hip,knee,ankle] of [['left',11,13,15,23,25,27],['right',12,14,16,24,26,28]]) {
    if(has(hip,knee,ankle))names.push(...faultBones('knee',side));
    else if(has(shoulder,hip,knee))names.push(side==='left'?'LeftUpLeg':'RightUpLeg','Hips','Spine');
    if(has(shoulder,elbow,wrist)||has(hip,shoulder,elbow))names.push(...faultBones('arm',side));
  }
  return [...new Set(names)];
}

export class ReviewCharacters {
  constructor(THREE,gltf,cloneSkinned) {
    this.THREE=THREE;this.gltf=gltf;
    this.instances=[];
    const {Rig}=makeRetarget(THREE);
    try {
      for(const [index,color] of [0x52dbc9,0xc4adff].entries()) {
        const root=cloneSkinned(gltf.scene),display=new THREE.Group();display.matrixAutoUpdate=false;display.add(root);
        const bones={},meshes=[];root.traverse(o=>{if(o.isBone)bones[o.name.replace(/^mixamorig:?/,'')]=o;if(o.isSkinnedMesh)meshes.push(o);});
        if(!meshes.length)throw new Error('The GLB has no skinned character mesh.');
        // Animation files may store a posed first frame in node TRS. Rig requires the actual skin bind pose.
        if(index===0){for(const mesh of meshes)mesh.skeleton.pose();root.updateMatrixWorld(true);}
        const item={root,display,bones,meshes,hot:null};this.instances.push(item);
        for(const mesh of meshes) {
          mesh.geometry=mesh.geometry.clone();
          const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
          item.materials??=[];
          const copies=materials.map(m=>{const copy=m.clone();copy.color.set(0xffffff);copy.vertexColors=true;item.materials.push(copy);return copy;});
          mesh.material=Array.isArray(mesh.material)?copies:copies[0];
          mesh.frustumCulled=false;
          const count=mesh.geometry.attributes.position.count;
          mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(count*3),3));
          // Keep the original surface/joint contrast while differentiating the two people.
          mesh.userData.reviewBase=new THREE.Color(color).multiply(materials[0].color);
        }
        this.paint(item,[]);
        const pos=n=>bones[n]?.getWorldPosition(new THREE.Vector3());root.updateMatrixWorld(true);
        for(const name of ['LeftArm','RightArm','LeftUpLeg','RightUpLeg'])if(!bones[name])throw new Error(`Missing character bone: ${name}.`);
        // The two clones use identical proportions and a single common bind-pose torso scale.
        if(index===0){
          this.scale=pos('LeftArm').add(pos('RightArm')).multiplyScalar(.5).distanceTo(pos('LeftUpLeg').add(pos('RightUpLeg')).multiplyScalar(.5));
          if(!(this.scale>1e-5))throw new Error('Character body scale is invalid.');
          item.rig=new Rig(root);
        }
      }
      const ref=this.instances[1],clip=gltf.animations[0];
      if(!clip)throw new Error('The character has no reference animation.');
      this.duration=clip.duration;this.mixer=new THREE.AnimationMixer(ref.root);
      this.action=this.mixer.clipAction(clip);this.action.setLoop(THREE.LoopOnce,1);this.action.clampWhenFinished=true;this.action.play();
    } catch(e) {this.dispose();throw e;}
  }

  // Vertex colours follow skin weights, as in retarget.tint. Copies are allocated once, not at each seek.
  paint(item,names) {
    const key=names.join('|');if(item.hot===key)return;item.hot=key;
    const hot=new Set(names),gold=new this.THREE.Color(0xffcf70),c=new this.THREE.Color();
    for(const mesh of item.meshes) {
      const flags=mesh.skeleton.bones.map(b=>{
        const n=b.name.replace(/^mixamorig:?/,'');if(hot.has(n))return true;
        for(let p=b.parent;p?.isBone;p=p.parent)if(['LeftArm','RightArm','LeftFoot','RightFoot'].some(x=>hot.has(x)&&p.name.replace(/^mixamorig:?/,'')===x))return true;
        return false;
      });
      const {skinIndex,skinWeight,color}=mesh.geometry.attributes;
      for(let i=0;i<color.count;i++) {
        let weight=0;for(let j=0;j<4;j++)if(flags[skinIndex.getComponent(i,j)])weight+=skinWeight.getComponent(i,j);
        c.copy(mesh.userData.reviewBase).lerp(gold,Math.min(1,weight*1.4));color.setXYZ(i,c.r,c.g,c.b);
      }
      color.needsUpdate=true;
    }
  }

  position(item,index,{bodyAligned=true,mirror=false,yaw=0}={}) {
    const T=this.THREE,V=()=>new T.Vector3(),p=n=>item.bones[n].getWorldPosition(V());
    const hip=p('LeftUpLeg').add(p('RightUpLeg')).multiplyScalar(.5),across=p('LeftArm').sub(p('RightArm'));
    const face=bodyAligned?Math.atan2(across.z,across.x):0;
    // The same transform order as replayPose. Reflection affects display only; anatomy labels never swap.
    item.display.matrix.makeTranslation(index?2.4:-2.4,0,0)
      .multiply(new T.Matrix4().makeRotationY(yaw))
      .multiply(new T.Matrix4().makeScale(mirror?-1:1,1,1))
      .multiply(new T.Matrix4().makeRotationY(face))
      .multiply(new T.Matrix4().makeScale(1/this.scale,1/this.scale,1/this.scale))
      .multiply(new T.Matrix4().makeTranslation(-hip.x,-hip.y,-hip.z));
    item.display.updateMatrixWorld(true);
    for(const mesh of item.meshes)mesh.skeleton.update();
  }

  pose(user,seconds,{part=[],...options}={}) {
    const evidence=characterEvidence(user),hot=highlightedBones(part);
    for(const [i,item] of this.instances.entries()) {
      // Retargeting works in unreflected world space. Never feed back the last display transform.
      item.display.matrix.identity();item.display.updateMatrixWorld(true);
      item.display.visible=i===1||evidence.supported;
      if(i===0) {
        if(!evidence.supported)continue;
        for(const b of item.collapsed??[])b.scale.setScalar(1);
        item.rig.pose(user.world,{ground:false,measuredHands:true,skip:new Set(evidence.hidden.flatMap(b=>[b,...CHILD[b]]))});
        // An unmeasured segment and everything below it shrink to its joint: shown as absent, never as a guess.
        item.collapsed=evidence.hidden.map(b=>item.bones[b]).filter(Boolean);for(const b of item.collapsed)b.scale.setScalar(1e-4);
        item.root.updateMatrixWorld(true);
      }
      else {this.action.enabled=true;this.action.paused=true;this.action.time=Math.max(0,Math.min(this.duration,seconds));this.mixer.update(0);}
      this.paint(item,hot);this.position(item,i,options);
    }
    return evidence;
  }

  dispose() {
    this.mixer?.stopAllAction();if(this.mixer)this.mixer.uncacheRoot(this.instances[1].root);
    for(const item of this.instances) {
      item.display.removeFromParent();
      for(const mesh of item.meshes){mesh.geometry.dispose();mesh.skeleton.dispose();}
      for(const material of item.materials??[])material.dispose();
    }
    this.instances=[];
    // The parsed source owns its shared geometry/materials. It is never changed by either clone.
    this.gltf?.scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
  }
}

export async function loadReviewCharacters(THREE,buffer,resourcePath='') {
  const [{GLTFLoader},{clone}]=await Promise.all([
    import('../vendor/three-0.170.0/examples/jsm/loaders/GLTFLoader.js'),
    import('../vendor/three-0.170.0/examples/jsm/utils/SkeletonUtils.js'),
  ]);
  const gltf=await new GLTFLoader().parseAsync(buffer,resourcePath);
  return new ReviewCharacters(THREE,gltf,clone);
}
