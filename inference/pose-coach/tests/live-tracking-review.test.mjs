import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {anchorAttempt,recordMovingIntervals,recordTrackingUpdate,beginAttempt} from '../web/js/movement-review.js';
const app=fs.readFileSync(new URL('../web/js/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function processPose('),app.indexOf('function onFrame(',app.indexOf('function processPose(')));
function harness(fail){
 const movement={key:'dance',kind:'dance',track:'moving'},rec={frames:[],events:[]},attempt=beginAttempt(rec,movement,1000),calls=[];
 const tracker={moveLog:[],update(){calls.push('update');if(fail==='update'){this.moveLog.push({t:1100,dt:100,counted:true});throw new Error('failed update');}return [];},lost(){calls.push('lost');if(fail==='lost')throw new Error('failed lost');return [];}};
 const S={rec,move:{entry:movement,attempt,tracker},trail:[],frames:0,fpsT:100},elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);};
 const deps={S,$,overlay:{width:1280,height:720},octx:{clearRect(){}},drawPose(){},r4:x=>x,features:()=>({visTorso:1,visArms:1,visLegs:1,view:'front'}),
  performance:{now:()=>100},anchorAttempt,recordMovingIntervals,recordTrackingUpdate,moveEvents:()=>calls.push('events'),renderMove(){},showFraming(){},
  trackingUnavailable:message=>{S.trackingBlocked=true;calls.push(message);}};
 const process=new Function(...Object.keys(deps),`${source};return processPose;`)(...Object.values(deps));
 return {S,calls,process};
}
const pose={image:Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1})),world:Array.from({length:33},()=>({x:0,y:0,z:0}))};
test('successful live callback records tracking evidence only after the tracker processes a pose',()=>{
 const p=harness();p.process(pose,1033,1280,720);assert.equal(p.S.rec.attempts[0].tracking.updates,1);assert.equal(p.S.rec.events.at(-1).type,'tracking_started');assert.deepEqual(p.calls,['update','events']);
});
test('throwing live update or lost callback blocks subsequent processing without recording partial intervals or success',()=>{
 for(const mode of ['update','lost']){const p=harness(mode),frame=mode==='lost'?{image:null,world:null}:pose;
  p.process(frame,1100,1280,720);assert.equal(p.S.trackingBlocked,true);assert.equal(p.S.rec.attempts[0].tracking,undefined);assert.equal(p.S.rec.movementIntervals,undefined);
  p.process(pose,1133,1280,720);assert.equal(p.calls.filter(x=>x===mode).length,1);assert.ok(!p.calls.includes('events'));assert.equal(p.S.rec.frames.length,2);
 }
});
