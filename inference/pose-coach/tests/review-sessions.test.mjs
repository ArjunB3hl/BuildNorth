// Optional private regression fixtures, never committed: run with RHYTHM_SESSION_DIR pointing at saved JSONs.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {prepareFrames,reviewWindows,reviewAttempts,sampleFrames,align,differences} from '../web/js/review-analysis.js';
import {referenceMotion} from '../web/js/reference-motion.js';
import {MovementTracker} from '../web/js/moves.js';import {features} from '../web/js/engine.js';
import {freshTracker,recordMovingIntervals,beginAttempt,endAttempt,recordTrackingUpdate} from '../web/js/movement-review.js';
const dir=process.env.RHYTHM_SESSION_DIR,glb=new URL('../.data/moves/glb/freestyle_dance.glb',import.meta.url);
const stamps=['20261029163035','20261029164403'];
const enabled=dir&&fs.existsSync(glb)&&stamps.every(s=>fs.existsSync(`${dir}/live-${s}-auto.json`));
test('eight saved attempts respect restarts, reject uncertain preliminary phase and withhold cues matched to standing still',{skip:!enabled},async()=>{
 const THREE=await import('../web/vendor/three-0.170.0/build/three.module.js'),b=fs.readFileSync(glb);
 const ref=prepareFrames(referenceMotion(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),THREE,4.6).frames);
 for(const [session,stamp] of stamps.entries()){
  const raw=fs.readFileSync(`${dir}/live-${stamp}-auto.json`,'utf8'),rec=JSON.parse(raw),frames=prepareFrames(rec.frames),origin=frames[0].t;
  const windows=reviewWindows(rec,'freestyle_dance'),audit=reviewAttempts(frames,ref,windows,{focus:'legs'});
  assert.equal(audit.length,session?5:3);
  for(const a of audit){
   assert.ok((rec.movementIntervals.filter(x=>x.attempt===a.attempt)).every(x=>x.start>=a.start&&x.end<=a.end));
   for(const c of a.candidates){assert.ok(c.start>=a.start&&c.end<=a.end);assert.ok(c.result.phaseMarginDeg>=3);
    const rows=differences(sampleFrames(frames,c.start,c.end),ref,c.result);assert.ok(rows.every(x=>/knee|foot spacing/.test(x.part)));
   }
  }
  if(session){
   const u=sampleFrames(frames,origin+115154,origin+122054),r=align(u,ref,{focus:'legs'});
   assert.equal(r.supported,false);assert.match(r.reason,/Phase uncertain|still/);assert.deepEqual(differences(u,ref,r),[]);
   // The earlier left-knee cue at 1:53.5 compared standing (knees ~166°, motion starts 1:55.0) with the reference's
   // left lift. Its window is now rejected: a ≥25° reference movement was spent on the user's settled lead-in.
   const pinned=sampleFrames(frames,origin+112654,origin+116104),p=align(pinned,ref,{focus:'legs'});
   assert.equal(p.supported,false);assert.match(p.reason,/still/);assert.ok(p.edges.lead>=20);assert.deepEqual(differences(pinned,ref,p),[]);
   for(const a of audit)for(const c of a.candidates)for(const x of differences(sampleFrames(frames,c.start,c.end),ref,c.result))
    assert.ok(!(x.t-origin>113000&&x.t-origin<114000));
   const hidden=u.map(f=>({...f,values:f.values.map((v,k)=>[2,3].includes(k)?null:v)}));assert.equal(align(hidden,ref,{focus:'legs'}).supported,false);
  }else{assert.equal(audit[1].candidates.length,0);assert.equal(audit[2].candidates.length,0);}
  assert.equal(JSON.stringify(rec),JSON.stringify(JSON.parse(raw)));
 }
});
test('real saved pose stream runs through fresh trackers and produces separate attempt intervals with processing evidence',{skip:!enabled},()=>{
 const movement={key:'freestyle_dance',display:'Dance',kind:'dance',track:'moving'},points=a=>a?.map(p=>({x:p[0],y:p[1],z:p[2],visibility:p[3]??0}));
 for(const stamp of stamps){
  const rec=JSON.parse(fs.readFileSync(`${dir}/live-${stamp}-auto.json`)),scratch={events:[]};
  for(const a of rec.attempts){
   const id=beginAttempt(scratch,movement,a.start,a.reason),tracker=freshTracker(MovementTracker,movement),move={entry:movement,attempt:id,tracker};tracker.lastT=a.start;
   assert.equal(tracker.current().seconds,0);
   for(const f of rec.frames.filter(f=>f.t>a.start&&f.t<=a.end)){
    const world=points(f.world),image=points(f.image);
    if(world&&image){tracker.update(features(world,image,1280/720),f.t,{world,image,aspect:1280/720});recordTrackingUpdate(scratch,move,f.t,f.t);}
    else tracker.lost(f.t);
    recordMovingIntervals(scratch,movement,tracker,id);
   }
   tracker.finish(a.end);endAttempt(scratch,id,a.end,a.endReason);recordMovingIntervals(scratch,movement,tracker,id);
   assert.ok(scratch.attempts.at(-1).tracking.updates>0);
   const ints=scratch.movementIntervals.filter(x=>x.attempt===id);assert.ok(ints.length>0);assert.ok(ints.every(x=>x.start>=a.start&&x.end<=a.end));
  }
  assert.equal(scratch.events.filter(e=>e.type==='tracking_started').length,rec.attempts.length);
 }
});
