import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { characterEvidence, loadReviewCharacters, highlightedBones } from '../web/js/review-character.js';
import { prepareFrames, replayPose, activeDifference } from '../web/js/review-analysis.js';
import { referenceMotion } from '../web/js/reference-motion.js';
register(new URL('./helpers/three-resolve.mjs',import.meta.url));
const modelURL=new URL('../.data/moves/glb/freestyle_dance.glb',import.meta.url);
const threeURL=new URL('../web/vendor/three-0.170.0/build/three.module.js',import.meta.url);
const opt={skip:!fs.existsSync(modelURL)||!fs.existsSync(threeURL)};
const THREE=fs.existsSync(threeURL)?await import(threeURL):null;
const bytes=()=>{const b=fs.readFileSync(modelURL);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const load=()=>loadReviewCharacters(THREE,bytes());
function fullPose(pair) {
  const rig=pair.instances[0].rig, world=Array(33).fill(null);
  const map={11:'LeftArm',12:'RightArm',13:'LeftForeArm',14:'RightForeArm',15:'LeftHand',16:'RightHand',
    17:'LeftHandPinky1',18:'RightHandPinky1',19:'LeftHandIndex1',20:'RightHandIndex1',
    23:'LeftUpLeg',24:'RightUpLeg',25:'LeftLeg',26:'RightLeg',27:'LeftFoot',28:'RightFoot',31:'LeftToeBase',32:'RightToeBase'};
  for(const [id,bone] of Object.entries(map)){const p=rig.at(bone);world[id]=[p.x,-p.y,-p.z];}
  const head=rig.at('Head');world[7]=[head.x+.06,-head.y,-head.z];world[8]=[head.x-.06,-head.y,-head.z];
  return prepareFrames([{t:1000,world,image:world.map(p=>p&&[.5,.5,0,.99])}])[0];
}
const rawPoint=(item,name)=>item.bones[name].getWorldPosition(new THREE.Vector3());

test('actual GLB loads two separate skinned character meshes, skeletons and materials',opt,async()=>{
  const pair=await load();
  try {
    const [you,ref]=pair.instances;assert.ok(you.meshes.length>0);assert.equal(you.meshes.length,ref.meshes.length);
    assert.notEqual(you.root,ref.root);assert.notEqual(you.bones.LeftLeg,ref.bones.LeftLeg);
    assert.notEqual(you.meshes[0].skeleton,ref.meshes[0].skeleton);assert.notEqual(you.meshes[0].geometry,ref.meshes[0].geometry);
    assert.notEqual(you.meshes[0].material,ref.meshes[0].material);
    assert.ok(you.meshes[0].geometry.attributes.position.count>1000);assert.ok(pair.duration>4.59&&pair.duration<=4.6);
    const f=fullPose(pair);assert.equal(characterEvidence(f).supported,true);
    pair.pose(f,1);assert.ok(you.display.visible&&ref.display.visible);
    for(const item of pair.instances)for(const mesh of item.meshes)assert.ok(mesh.isSkinnedMesh&&mesh.visible&&mesh.material.isMeshStandardMaterial);
  }finally{pair.dispose();}
});
test('reference character joints follow GLB sampler and exact endpoint when seeking forward and backward',opt,async()=>{
  const pair=await load(),motion=referenceMotion(bytes(),THREE,4.6),f=fullPose(pair),ref=pair.instances[1];
  try {
    for(const t of [0,1.3,4.6,2.2,4.6,0]) {
      pair.pose(f,t,{bodyAligned:false});
      const pose=replayPose(motion.sample(t),{bodyAligned:false,scale:pair.scale});
      for(const [id,name] of [[11,'LeftArm'],[25,'LeftLeg'],[28,'RightFoot']]) {
        const actual=rawPoint(ref,name).sub(new THREE.Vector3(2.4,0,0));
        assert.ok(actual.distanceTo(new THREE.Vector3(...pose[id]))<1e-4,`${t}s ${name}: mesh and sampler clocks/axes differ`);
      }
      assert.ok(Math.abs(pair.action.time-Math.min(t,pair.duration))<1e-6);
    }
  }finally{pair.dispose();}
});
test('retargeted character has measured limb directions; mirror is display-only and has no cumulative transform drift',opt,async()=>{
  const pair=await load(),f=fullPose(pair),you=pair.instances[0];
  // Asymmetric knee bend, on the anatomical left. Rendering never borrows the reference animation.
  f.world[25]=[f.world[23][0]+.05,f.world[23][1]+.2,f.world[23][2]-.3];
  f.world[27]=[f.world[25][0],f.world[25][1]+.35,f.world[25][2]+.1];
  try {
    pair.pose(f,.5,{bodyAligned:false});
    const direction=rawPoint(you,'LeftFoot').sub(rawPoint(you,'LeftLeg')).normalize();
    const a=f.world[25],b=f.world[27],measured=new THREE.Vector3(b[0]-a[0],a[1]-b[1],a[2]-b[2]).normalize();
    assert.ok(direction.dot(measured)>.999);
    const before=rawPoint(you,'LeftFoot');
    pair.pose(f,3.5,{bodyAligned:false,mirror:true});const mirrored=rawPoint(you,'LeftFoot');
    assert.ok(Math.abs((before.x+2.4)+(mirrored.x+2.4))<1e-6);assert.ok(Math.abs(before.y-mirrored.y)<1e-6);
    pair.pose(f,4.6,{bodyAligned:false});assert.ok(rawPoint(you,'LeftFoot').distanceTo(before)<1e-6);
    pair.pose(f,0,{bodyAligned:false});assert.ok(rawPoint(you,'LeftFoot').distanceTo(before)<1e-6);
  }finally{pair.dispose();}
});
test('an unmeasured limb is collapsed with its children, never guessed; an uncertain torso hides the user mesh',opt,async()=>{
  // World scale relative to the hips (the GLB armature has its own unit scale).
  const pair=await load(),f=fullPose(pair),you=pair.instances[0],scale=n=>you.bones[n].getWorldScale(new THREE.Vector3()).x/you.bones.Hips.getWorldScale(new THREE.Vector3()).x;
  try {
    for(const [id,bone] of [[7,'Neck'],[13,'LeftArm'],[15,'LeftForeArm'],[17,'LeftHand'],[25,'LeftUpLeg'],[27,'LeftLeg'],[31,'LeftFoot']]) {
      pair.pose(f,1);assert.ok(Object.keys(you.bones).every(n=>Math.abs(scale(n)-1)<1e-6),'no collapse remains from a previous frame');
      const bad=structuredClone(f);bad.valid[id]=false;
      const posed=world=>{bad.world[id]=world;const e=pair.pose(bad,1.2);return [e,Object.fromEntries(Object.keys(you.bones).map(n=>[n,rawPoint(you,n)]))];};
      const [evidence,a]=posed([9,9,9]),[,b]=posed([-9,-9,-9]);
      assert.equal(evidence.supported,true);assert.ok(evidence.hidden.includes(bone));assert.ok(evidence.omitted.length>=1);
      assert.equal(you.display.visible,true);assert.equal(pair.instances[1].display.visible,true);assert.ok(scale(bone)<1e-3);
      // The untrusted coordinate moves nothing that is drawn.
      for(const n of Object.keys(you.bones))if(scale(n)>1e-3)assert.ok(a[n].distanceTo(b[n])<1e-6,`${n} followed an unmeasured landmark`);
    }
    for(const id of [11,23]){const bad=structuredClone(f);bad.valid[id]=false;
      assert.equal(pair.pose(bad,1).supported,false);assert.equal(you.display.visible,false);assert.equal(pair.instances[1].display.visible,true);}
    assert.equal(pair.pose(null,2).supported,false);
    const bad=structuredClone(f);delete bad.valid;bad.image[27][3]=.1;
    const e=characterEvidence(bad);assert.equal(e.supported,true);assert.deepEqual(e.omitted,['left lower leg']);
  }finally{pair.dispose();}
});
test('highlight colours deform with relevant skin weights and clear when no supported difference is selected',opt,async()=>{
  const pair=await load(),f=fullPose(pair);
  try {
    const mesh=pair.instances[0].meshes[0],before=mesh.geometry.attributes.color.array.slice();
    pair.pose(f,1,{part:[24,26,28]});
    const hot=mesh.geometry.attributes.color.array.slice();assert.notDeepEqual(hot,before);
    assert.deepEqual(highlightedBones([24,26,28]),['RightUpLeg','RightLeg']);
    pair.pose(f,2);assert.deepEqual(mesh.geometry.attributes.color.array,before);
  }finally{pair.dispose();}
});
test('malformed model load rejects so the review can use labelled landmarks',opt,async()=>{
  await assert.rejects(loadReviewCharacters(THREE,new ArrayBuffer(20)));
});
test('skinned surface vertices deform in the user and reference, with finite bounds around their own slots',opt,async()=>{
  const pair=await load(),f=fullPose(pair);
  const surface=item=>item.meshes.flatMap(mesh=>{
    const out=[];for(let i=0;i<mesh.geometry.attributes.position.count;i+=77){const v=new THREE.Vector3();mesh.getVertexPosition(i,v);out.push(v.applyMatrix4(mesh.matrixWorld));}return out;
  });
  try {
    pair.pose(f,0);const before=pair.instances.map(surface);
    f.world[25][2]-=.3;f.world[27][2]-=.2;
    pair.pose(f,2.7);const after=pair.instances.map(surface);
    for(const [i,points] of after.entries()) {
      assert.ok(points.some((p,j)=>p.distanceTo(before[i][j])>.1),'skin follows bones, not a frozen bind-pose mesh');
      assert.ok(points.every(p=>p.toArray().every(Number.isFinite)));
      const box=new THREE.Box3().setFromPoints(points);assert.ok(box.min.x<(i?2.4:-2.4)&&box.max.x>(i?2.4:-2.4));
      assert.ok(box.max.y-box.min.y>2&&box.max.y-box.min.y<6);
    }
  }finally{pair.dispose();}
});
test('canonical facing removes camera yaw consistently and retains anatomical sides',opt,async()=>{
  const pair=await load(),f=fullPose(pair),you=pair.instances[0];
  try {
    pair.pose(f,1,{bodyAligned:true});const before=['LeftArm','RightArm','LeftFoot','RightFoot'].map(n=>rawPoint(you,n));
    const rotated={...f,world:f.world.map(p=>p&&[p[2],p[1],-p[0]])};
    pair.pose(rotated,1,{bodyAligned:true});
    ['LeftArm','RightArm','LeftFoot','RightFoot'].forEach((n,i)=>assert.ok(rawPoint(you,n).distanceTo(before[i])<1e-5,n));
  }finally{pair.dispose();}
});

// Exercise the real scene/update/load paths without a GPU: only the final renderer submission is observed.
async function viewerHarness() {
  const {Review3D,makeSkeleton}=await import('../web/js/review-3d.js'),viewer=Object.create(Review3D.prototype);
  Object.assign(viewer,{modelGeneration:0,characters:null,modelError:null,characterLoader:loadReviewCharacters,
    scene:new THREE.Scene(),figures:[0x52dbc9,0xc4adff].map(makeSkeleton),yaw:0,last:null,
    onStatus:s=>{viewer.report=s;},renderer:{render:scene=>{viewer.visibleMeshes=[];scene.traverseVisible(o=>{if(o.isSkinnedMesh)viewer.visibleMeshes.push(o);});}}});
  for(const f of viewer.figures)viewer.scene.add(f.bones,f.points);
  return viewer;
}
test('review scene submits both actual character meshes; a missing limb is hidden, a missing torso switches the user to labelled landmarks',opt,async()=>{
  const v=await viewerHarness();await v.loadCharacters(bytes());const f=fullPose(v.characters),motion=referenceMotion(bytes(),THREE,4.6);
  try {
    v.show(f,motion.sample(1),{part:[24,26,28]});assert.equal(v.visibleMeshes.length,4);
    assert.match(v.report.user,/Y Bot/);assert.match(v.report.reference,/original animated Y Bot/);assert.equal(v.figures[0].bones.visible,false);
    // A hidden ankle collapses only that lower leg; the part highlight needing it is cleared on both figures.
    const bad=structuredClone(f);bad.valid[28]=false;
    v.show(bad,motion.sample(2),{part:[24,26,28]});assert.equal(v.visibleMeshes.length,4);assert.match(v.report.user,/unmeasured parts hidden/);
    assert.match(v.report.message,/right lower leg/);assert.equal(v.figures[0].bones.visible,false);assert.equal(v.characters.instances[1].hot,'');
    // An uncertain torso switches only the user to labelled landmarks.
    const torso=structuredClone(f);torso.valid[12]=false;
    v.show(torso,motion.sample(2));assert.equal(v.visibleMeshes.length,2);assert.match(v.report.user,/fallback/);assert.match(v.report.message,/shoulders/);
    assert.equal(v.figures[0].bones.visible,true);
    v.show(f,motion.sample(4.6));assert.equal(v.visibleMeshes.length,4);assert.ok(Math.abs(v.characters.action.time-4.6)<1e-5);
    v.show(f,motion.sample(.2));assert.ok(Math.abs(v.characters.action.time-.2)<1e-6);
    v.show(f,motion.sample(.2),{landmarks:true});assert.equal(v.visibleMeshes.length,0);assert.match(v.report.user,/saved landmarks/);
  }finally{v.characters?.dispose();}
});
test('failed character load removes stale meshes, keeps landmark replay, and a subsequent load recovers',opt,async()=>{
  const v=await viewerHarness();await v.loadCharacters(bytes());const f=fullPose(v.characters),motion=referenceMotion(bytes(),THREE,4.6);
  try {
    v.show(f,motion.sample(1));assert.equal(v.visibleMeshes.length,4);
    assert.equal(await v.loadCharacters(new ArrayBuffer(20)),false);assert.equal(v.visibleMeshes.length,0);
    assert.match(v.report.message,/Character unavailable/);assert.match(v.report.reference,/fallback/);
    assert.ok(v.figures[0].bones.count>0&&v.figures[1].bones.count>0);
    await v.loadCharacters(null,{error:'Reference GLB could not load (404).'});v.show(f,null);
    assert.match(v.report.reference,/unavailable/);assert.equal(v.figures[1].bones.count,0);assert.ok(v.figures[0].bones.count>0);
    assert.equal(await v.loadCharacters(bytes()),true);v.show(f,motion.sample(1));assert.equal(v.visibleMeshes.length,4);
  }finally{v.characters?.dispose();}
});
test('scrubbing beyond a finding or an unsupported alignment removes its highlight',()=>{
  const finding={start:1000,end:1400,ids:[24,26,28]};
  assert.equal(activeDifference(finding,1200,{supported:true}),finding);
  assert.equal(activeDifference(finding,1500,{supported:true}),null);
  assert.equal(activeDifference(finding,1200,{supported:false}),null);
});
