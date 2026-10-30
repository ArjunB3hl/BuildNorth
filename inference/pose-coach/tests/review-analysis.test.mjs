import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareFrames, sampleFrames, align, differences, replayPose, frameAt, mappedTime, reviewWindows, suggestWindow, relativeSeconds, torsoScale, footSpacing } from '../web/js/review-analysis.js';
import { referenceMotion } from '../web/js/reference-motion.js';

const series=(duration=4000,phase=x=>x)=>Array.from({length:duration/100+1},(_,i)=>({t:i*100,values:Array.from({length:8},(_,k)=>90+40*Math.sin(phase(i*100/duration)*Math.PI*2+k*.3))}));
function pose(t=0){
  const world=Array(33).fill(null);Object.assign(world,{11:[.2,-.5,0],12:[-.2,-.5,0],13:[.5,-.5,0],14:[-.5,-.5,0],15:[.5,-.8,0],16:[-.5,-.8,0],23:[.15,0,0],24:[-.15,0,0],25:[.15,.4,0],26:[-.15,.4,0],27:[.15,.8,.1],28:[-.15,.8,.1]});
  return {t,world,image:world.map(p=>p&&[.5,.5,0,.95])};
}
test('pace alignment follows a monotone nonlinear timing map and absolute timestamp offset',()=>{
  const ref=series(),user=series(6000,x=>x*x).map(f=>({...f,t:f.t+71000}));
  const r=align(user,ref);assert.equal(r.supported,true);assert.ok(r.errorDeg<3);assert.ok(r.ratio===1.5);
  for(let k=1;k<r.path.length;k++)assert.ok(r.path[k][0]>=r.path[k-1][0]&&r.path[k][1]>=r.path[k-1][1]);
  assert.ok(Math.abs(mappedTime(74000,user,ref,r.path)-1000)<300);assert.equal(relativeSeconds(74000,user),3);
});
test('resampling preserves a phrase endpoint between sample ticks without inventing extra source evidence',()=>{
  const frames=prepareFrames([pose(0),pose(100),pose(200),pose(250)]),sample=sampleFrames(frames,0,250);
  assert.deepEqual(sample.map(f=>f.t),[0,100,200,250]);assert.equal(sample.at(-1).sourceT,250);
});
test('joint angles survive translation, body size and camera yaw without mirroring anatomy',()=>{
  const a=pose(),b=pose();b.world=b.world.map(p=>p&&[4+2*p[2],3+2*p[1],2-2*p[0]]);
  const x=prepareFrames([a])[0],y=prepareFrames([b])[0];x.values.forEach((v,i)=>assert.ok(Math.abs(v-y.values[i])<1e-6));
  const pa=replayPose(x),pb=replayPose(y);for(const i of [11,12,13,14,25,26])pa[i].forEach((v,k)=>assert.ok(Math.abs(v-pb[i][k])<1e-6));
});
test('missing confidence is not assumed visible; low-confidence, offscreen and invalid points give no angles',()=>{
  const f=pose();f.image[15][3]=.2;f.image[16][0]=1.2;f.world[27][0]=NaN;f.image[28].pop();
  const p=prepareFrames([f])[0];assert.deepEqual(p.values.slice(0,4),[null,null,null,null]);
  const drawn=replayPose(p);for(const i of [15,16,27,28])assert.equal(drawn[i],null);
});
test('isolated tracking spike and limb-length distortion are excluded rather than corrected',()=>{
  const fs=Array.from({length:20},(_,i)=>pose(i*33));fs[10].world[15]=[4,4,4];const p=prepareFrames(fs);
  assert.equal(p[10].values[0],null);assert.equal(replayPose(p[10])[15],null);assert.equal(differences(p,p,align(p,p)).length,0);
});
test('no interpolation across dropped frames and no cue across a long confidence gap',()=>{
  const frames=[pose(1000),pose(2000)];assert.equal(frameAt(frames,1500),null);assert.equal(sampleFrames(prepareFrames(frames),1000,2000)[5].world,undefined);
  const user=series();for(let i=12;i<22;i++)user[i].values.fill(null);const r=align(user,series());assert.equal(r.supported,false);assert.deepEqual(differences(user,series(),r),[]);
});
test('static pose, tiny jitter and unrelated motion cannot be called a detected phrase',()=>{
  for(const values of [Array(8).fill(90),Array(8).fill(null)]){
    const u=series().map((f,i)=>({...f,values:values.map(v=>v==null?null:v+Math.sin(i)*.2)}));
    assert.equal(align(u,series()).supported,false);assert.equal(suggestWindow(u,series(),[{start:0,end:4000}]),null);
  }
  const r=align(series().map(f=>({...f,values:f.values.map(v=>v+75)})),series());assert.equal(r.supported,false);
});
test('sustained differences yield a specific body part and cue; a single spike does not',()=>{
  const ref=series(),user=series();user.forEach(f=>f.values[0]+=35);const r=align(user,ref);assert.equal(r.supported,true);
  const rows=differences(user,ref,r);assert.equal(rows[0].part,'left elbow');assert.match(rows[0].cue,/bend your left elbow/);assert.ok(rows[0].end-rows[0].start>=300);
  const spike=series();spike[20].values[0]+=60;assert.deepEqual(differences(spike,ref,align(spike,ref)),[]);
});
test('leg focus aligns visible leg motion despite different or occluded arms and gives only lower-body cues',()=>{
  const ref=series(),user=series();
  user.forEach(f=>{for(const k of [0,1,4,5])f.values[k]+=90;f.values[2]+=30;});
  const result=align(user,ref,{focus:'legs'});assert.equal(result.supported,true);
  assert.equal(align(user,ref).supported,false);
  const rows=differences(user,ref,result);assert.ok(rows.some(x=>x.part==='left knee'));assert.ok(rows.every(x=>!/arm|elbow/.test(x.part)));
  user.forEach(f=>{for(const k of [0,1,4,5])f.values[k]=null;});
  assert.equal(align(user,ref,{focus:'legs'}).supported,true);
  assert.ok(suggestWindow(user,ref,[{start:0,end:4000}],{focus:'legs'}));
});
test('visible moving arms cannot substitute for static legs, missing ankles or one hidden knee',()=>{
  for(const mode of ['static','missing','one-knee']){
    const u=series();u.forEach(f=>{for(const k of [2,3,6,7])if(mode!=='one-knee')f.values[k]=mode==='static'?90:null;if(mode==='one-knee')f.values[2]=null;});
    const r=align(u,series(),{focus:'legs'});assert.equal(r.supported,false);assert.deepEqual(differences(u,series(),r),[]);
    assert.match(r.reason,mode==='static'?/Too little sustained movement/:/Visibility gaps/);
  }
});
test('foot spacing is ankle distance normalized by leg length, independent of scale, view and torso size',()=>{
  const f=pose(),p=footSpacing(f),b=pose();
  b.world=b.world.map(v=>v&&[3+2*v[2],4+2*v[1],5-2*v[0]]);assert.ok(Math.abs(footSpacing(b)-p)<1e-9);
  b.world[11]=[10,10,10];b.world[12]=[11,11,11];assert.ok(Math.abs(footSpacing(b)-p)<1e-9);
  b.image[27][3]=.3;assert.equal(footSpacing(b),null);
  f.world[31]=null;f.world[32]=null;assert.equal(footSpacing(f),p); // no toe-angle inference from unavailable endpoints
});
test('sustained foot-spacing cue needs five actual visible samples; missing feet and isolated jumps give no correction',()=>{
  const ref=series().map(f=>({...f,footSpacing:.3})),u=series().map(f=>({...f,footSpacing:.65}));
  const r=align(u,ref,{focus:'legs'}),rows=differences(u,ref,r);
  assert.equal(rows[0].part,'foot spacing');assert.match(rows[0].cue,/closer together/);assert.equal(rows[0].kind,'spacing');
  for(const mode of ['missing','spike','repeated-source']){
    const frames=u.map((f,i)=>({...f,footSpacing:mode==='missing'?null:mode==='spike'?(i===20?.9:.3):f.footSpacing,sourceT:mode==='repeated-source'?100:f.t}));
    assert.deepEqual(differences(frames,ref,r),[]);
  }
});
test('replay preserves actual limb geometry, missing hips hide the pose, and display mirror changes only x',()=>{
  const f=prepareFrames([pose()])[0],a=replayPose(f),b=replayPose(f,{mirror:true});
  assert.equal(a[13][0]-a[11][0],.6);assert.ok(torsoScale([f])>.49);
  a.forEach((p,i)=>{if(p){assert.equal(b[i][0],-p[0]);assert.deepEqual(b[i].slice(1),p.slice(1));}});
  f.valid[23]=false;assert.ok(replayPose(f).every(x=>x===null));
});
test('saved attempt windows take priority; speech and legacy counters cannot manufacture restart boundaries',()=>{
  const rec={frames:[{t:5000},{t:20000}],movementAttempt:3,events:[{type:'coach_said',text:'restarted'}]};
  assert.deepEqual(reviewWindows(rec,'dance'),[]);
  rec.attempts=[{id:1,movement:'dance',start:5000,end:10000},{id:2,movement:'dance',start:10000,end:20000}];
  const windows=reviewWindows(rec,'dance',[{movement:'dance',start:5000,end:20000}]);assert.equal(windows.length,2);assert.equal(windows[0].end,windows[1].start);
});
test('timestamp cleanup keeps original times and never sorts a clock reset into a fake sequence',()=>{
  const f=prepareFrames([pose(1000),pose(1100),pose(1100),pose(900),pose(1200)]);assert.deepEqual(f.map(x=>x.t),[1000,1100,1200]);
});
const threeURL=new URL('../web/vendor/three-0.170.0/build/three.module.js',import.meta.url);
test('3D renderer geometry follows recorded joints, highlights the requested limb and removes missing bones',{skip:!fs.existsSync(threeURL)},async()=>{
  const {makeSkeleton,poseSkeleton,THREE}=await import('../web/js/review-3d.js');
  const figure=makeSkeleton(0x52dbc9),p=replayPose(prepareFrames([pose()])[0]);
  poseSkeleton(figure,p,{part:[11,13,15]});const count=figure.bones.count;
  assert.ok(count>=10);const color=new THREE.Color();figure.bones.getColorAt(1,color);assert.equal(color.getHex(),0xffcf70);
  const matrix=new THREE.Matrix4();figure.bones.getMatrixAt(1,matrix);const position=new THREE.Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.abs(position.x-(p[11][0]+p[13][0])/2)<1e-6);
  p[13]=null;poseSkeleton(figure,p);assert.equal(figure.bones.count,count-2);
  poseSkeleton(figure,Array(33).fill(null));assert.equal(figure.bones.count,0);assert.equal(figure.points.count,0);
});
test('real trimmed GLB uses its 4.6 second endpoint and animated skeleton, not a canned replay',{skip:!fs.existsSync(threeURL)||!fs.existsSync(new URL('../.data/moves/glb/freestyle_dance.glb',import.meta.url))},async()=>{
  const THREE=await import(threeURL),b=fs.readFileSync(new URL('../.data/moves/glb/freestyle_dance.glb',import.meta.url));
  const motion=referenceMotion(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),THREE,4.6);
  assert.ok(Math.abs(motion.duration-4.6)<.001);assert.equal(motion.frames.length,47);assert.ok(Math.abs(motion.frames.at(-1).t-4600)<.001);
  assert.notDeepEqual(motion.sample(1).world[15],motion.sample(2).world[15]);
  const f=prepareFrames(motion.frames);assert.ok(f[0].values.every(Number.isFinite));assert.ok(replayPose(f[10]).filter(Boolean).length>=12);
  assert.deepEqual(motion.sample(100).world,motion.sample(motion.duration).world);
});

test('pose similarity alone cannot establish phase when the time-reversed reference fits as well',()=>{
  const ref=series();
  const reversed=ref.map((f,i)=>({...ref[ref.length-1-i],t:f.t}));
  const r=align(reversed,ref,{focus:'legs'});
  assert.equal(r.supported,false);assert.deepEqual(differences(reversed,ref,r),[]);
  // A symmetric bend/straighten pattern is explicitly ambiguous in time, even with perfect visibility.
  const symmetric=series(4000,x=>x).map((f,i)=>({...f,values:f.values.map((v,k)=>100+30*Math.cos(i/40*Math.PI*2))}));
  const s=align(symmetric,symmetric,{focus:'legs'});assert.equal(s.supported,false);assert.match(s.reason,/Phase uncertain/);
});
test('cues survive plausible timing alternatives, not just the cheapest path',()=>{
  const ref=series(),u=series();u.forEach(f=>f.values[2]+=35);
  const r=align(u,ref,{focus:'legs'});assert.equal(r.supported,true);assert.ok(r.phaseRanges.every(x=>x.length));
  const envelope={...r,phaseRanges:u.map(()=>ref.map((_,i)=>i))};
  assert.ok(differences(u,ref,r).some(x=>x.part==='left knee'));
  const original=differences(u,ref,r).find(x=>x.part==='left knee'),conservative=differences(u,ref,envelope).find(x=>x.part==='left knee');
  assert.ok(!conservative||conservative.end-conservative.start<original.end-original.start);
});
test('overlapping or invalid attempt metadata cannot fall back to invented activity boundaries',()=>{
  const rec={frames:[{t:0},{t:10000}],attempts:[{id:1,movement:'dance',start:0,end:6000},{id:2,movement:'dance',start:5000,end:10000}]};
  assert.deepEqual(reviewWindows(rec,'dance',[{movement:'dance',start:0,end:10000}]),[]);
  rec.attempts=[{id:1,movement:'dance',start:NaN,end:10000}];assert.deepEqual(reviewWindows(rec,'dance'),[]);
});
