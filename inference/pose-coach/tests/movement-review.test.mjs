import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restartRequested, recordMovingIntervals, freshTracker, beginAttempt, anchorAttempt, endAttempt, recoverIntervals, movementLoader, recordTrackingUpdate, trackerRunning } from '../web/js/movement-review.js';
import { MovementTracker } from '../web/js/moves.js';
import { readFileSync } from 'node:fs';

test('explicit restart requests are accepted; questions and negations are not', () => {
  for (const text of ['restart', 'please restart the dance', 'can you reset the timer', 'start again from zero', 'restart tracking', 'okay restart', 'okay please try again']) assert.equal(restartRequested(text), true, text);
  for (const text of ['do not restart', 'should I restart', 'why restart', 'what does restart mean', 'restart your explanation']) assert.equal(restartRequested(text), false, text);
});

const dance={key:'test_dance',display:'Test dance',kind:'dance',track:'moving'};
test('concurrent review/live module loads share bounded retries and cache only success',async()=>{
  const urls=[],module={MovementTracker};const load=movementLoader(async url=>{urls.push(url);if(urls.length===1)throw new Error('fetch failed');return module;},async()=>{});
  const [a,b]=await Promise.all([load(),load()]);assert.equal(a,module);assert.equal(b,module);assert.equal(urls.length,2);assert.notEqual(urls[0],urls[1]);
  await load();assert.equal(urls.length,2);
});
test('persistent load failure rejects, and a later explicit start can retry',async()=>{
  let calls=0,available=false;const load=movementLoader(async()=>{calls++;if(!available)throw new Error('unavailable');return {MovementTracker};},async()=>{});
  await assert.rejects(load(),/unavailable/);assert.equal(calls,3);available=true;assert.equal((await load()).MovementTracker,MovementTracker);assert.equal(calls,4);
});
test('boundaries anchor to the first frame and keep zero-activity attempts after restart',()=>{
  const rec={events:[]},first=beginAttempt(rec,dance,undefined);anchorAttempt(rec,first,8123);endAttempt(rec,first,9500,'restart');
  const second=beginAttempt(rec,dance,9500,'restart');endAttempt(rec,second,11000,'stop');
  assert.deepEqual(rec.attempts,[{id:1,movement:'test_dance',start:8123,end:9500,reason:'selected',endReason:'restart'},
    {id:2,movement:'test_dance',start:9500,end:11000,reason:'restart',endReason:'stop'}]);
  assert.equal(rec.events[0].t,8123);assert.equal(rec.events[2].type,'movement_restart');assert.equal(rec.events[2].attempt,2);
});
test('failed tracker construction cannot produce a fresh attempt',()=>{
  for(const Tracker of [null,class{constructor(){throw new Error('load failed');}},class{}])assert.throws(()=>freshTracker(Tracker,dance));
});
test('intervals retain real confidence gaps instead of adding unseen time',()=>{
  const rec={},tracker={moveLog:[{t:1000,dt:100,counted:true},{t:1200,dt:100,counted:true}]};
  recordMovingIntervals(rec,dance,tracker,1);assert.deepEqual(rec.movementIntervals.map(x=>[x.start,x.end]),[[900,1000],[1100,1200]]);
});
test('offline interval recovery never edits the source or invents attempts from speech',()=>{
  const rec={events:[{type:'coach_said',text:'Restarted'}],frames:[{t:100,image:null,world:null},{t:200,image:null,world:null}]};
  const before=JSON.stringify(rec),out=recoverIntervals(rec,dance,MovementTracker,()=>null);
  assert.equal(JSON.stringify(rec),before);assert.equal(out.seconds,0);assert.deepEqual(out.windows,[]);
});

const app=readFileSync(new URL('../web/js/app.js',import.meta.url),'utf8');
function restartPage(Tracker=MovementTracker){
  const calls=[],rec={events:[]},tracker=new MovementTracker({movement:dance}),attempt=beginAttempt(rec,dance,1000);
  tracker.movingMs=5000;tracker.moveLog=[{t:6000,dt:100,counted:true}];
  const S={running:true,move:{entry:dance,tracker,attempt,lastUpdateAt:100},moves:[],rec,Tracker,lastFrameT:6000,lastPoseAt:100,attemptSerial:0,
    eleven:{setVolume:v=>calls.push(['volume',v]),context:s=>calls.push(['context',s])},voiceOut:{cancel:()=>{}}};
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);};
  const section=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to,app.indexOf(from)));
  const src=section('function trackingUnavailable(',"$('restartMove').addEventListener")+'\n'+section('function finishMovement(', '// A hold goes to the coach (hold_start)');
  const deps={S,$,performance:{now:()=>150},freshTracker,beginAttempt,endAttempt,recordMovingIntervals,trackerRunning,
    log:(s)=>calls.push(['log',s]),chat:(who,s)=>calls.push(['chat',s]),stopEleven:()=>calls.push(['stop']),renderMove:()=>{},renderWorkout:()=>{},showFraming:()=>{},hideForm:()=>{},mmss:String,doneText:()=>'',moveEvents:()=>{}};
  const restart=new Function(...Object.keys(deps),`${src}; return restartMovement;`)(...Object.values(deps));
  return {S,calls,restart};
}
test('real restart handler retains the previous result and closes one attempt before opening the next at zero',()=>{
  const p=restartPage();assert.equal(p.restart(),true);assert.equal(p.S.moves[0].seconds,5);assert.equal(p.S.moves[0].attempt,1);
  assert.equal(p.S.move.tracker.current().seconds,0);assert.equal(p.S.move.tracker.lastT,6000);
  assert.equal(p.S.rec.attempts[0].end,6000);assert.equal(p.S.rec.attempts[1].start,6000);assert.equal(p.S.rec.movementIntervals[0].attempt,1);
  assert.match(p.calls.find(x=>x[0]==='context')[1],/has not processed a pose yet/);
  assert.equal(trackerRunning(p.S,150),false);
  recordTrackingUpdate(p.S.rec,p.S.move,6033,160);assert.equal(trackerRunning(p.S,160),true);
});
test('real restart handler fails closed for missing/broken tracker and stale pose, with no success or lost attempt',()=>{
  for(const failure of ['module','constructor','stale','never-updated']){
    const p=restartPage();if(failure==='module')p.S.Tracker=null;if(failure==='constructor')p.S.Tracker=class{constructor(){throw new Error('unavailable');}};if(failure==='stale')p.S.lastPoseAt=-2000;if(failure==='never-updated')delete p.S.move.lastUpdateAt;
    const original=p.S.move;assert.equal(p.restart(),false);assert.equal(p.S.move,original);assert.equal(p.S.rec.attempts.length,1);
    assert.deepEqual(p.calls[0],['volume',0]);assert.ok(p.calls.some(x=>x[0]==='stop'));
    assert.ok(!p.calls.some(x=>/Tracking from zero|successfully restarted/.test(x[1])));
  }
});

test('live dance status has no timer and distinguishes fresh, missing and failed tracking',()=>{
  const src=app.slice(app.indexOf('function moveStatus('),app.indexOf('/** A movement\'s form on the Now card'));
  const S={lastFrameT:100,lastPoseAt:100,statusText:()=> 'Moving 1:30'};
  const status=new Function('S','performance','mmss','trackerRunning',`${src}; return moveStatus;`)(S,{now:()=>150},String,trackerRunning);
  const x={entry:dance,tracker:{current:()=>({track:'moving',seconds:90})},lastUpdateAt:100};S.move=x;
  assert.equal(status(x).big,'●');assert.equal(status(x).text,'Tracking movement');
  S.lastPoseAt=-2000;assert.equal(status(x).text,'Waiting for a tracked visible pose');
  S.trackingBlocked=true;assert.equal(status(x).text,'Movement tracking unavailable');
});

test('a fresh tracker starts at zero and counted samples are saved separately by attempt', () => {
  const movement = { key: 'freestyle_dance', display: 'Dance', kind: 'dance', track: 'moving' };
  const old = new MovementTracker({ movement }); old.movingMs = 10000;
  const next = new MovementTracker({ movement });
  assert.equal(next.current().seconds, 0);
  const rec = {};
  old.moveLog.push({ t: 1000, dt: 100, counted: true }, { t: 1100, dt: 100, counted: true }, { t: 1200, dt: 100, counted: false });
  recordMovingIntervals(rec, movement, old, 1);
  recordMovingIntervals(rec, movement, old, 1);
  next.moveLog.push({ t: 1200, dt: 100, counted: true });
  recordMovingIntervals(rec, movement, next, 2);
  assert.deepEqual(rec.movementIntervals, [{ movement: movement.key, attempt: 1, start: 900, end: 1100 }, { movement: movement.key, attempt: 2, start: 1100, end: 1200 }]);
});

test('successful tracker updates create per-attempt evidence once; construction does not',()=>{
  const rec={events:[]},attempt=beginAttempt(rec,dance,5000),move={entry:dance,attempt,tracker:freshTracker(MovementTracker,dance)};
  const state={move,lastPoseAt:100};assert.equal(trackerRunning(state,100),false);
  assert.equal(recordTrackingUpdate(rec,move,5000,100),true);assert.equal(recordTrackingUpdate(rec,move,5033,133),false);
  assert.equal(trackerRunning(state,150),true);assert.equal(trackerRunning(state,1500),false);
  assert.deepEqual(rec.attempts[0].tracking,{updates:2,firstT:5000,lastT:5033});
  assert.equal(rec.events.filter(e=>e.type==='tracking_started').length,1);
  state.trackingBlocked=true;assert.equal(trackerRunning(state,150),false);
});
test('backfilled movement intervals cannot cross a saved restart boundary',()=>{
  const rec={events:[]},attempt=beginAttempt(rec,dance,1000);endAttempt(rec,attempt,2000,'restart');
  const tracker={moveLog:[{t:1100,dt:500,counted:true},{t:2200,dt:300,counted:true},{t:3000,dt:-50,counted:true}]};
  recordMovingIntervals(rec,dance,tracker,attempt);assert.deepEqual(rec.movementIntervals.map(i=>[i.start,i.end]),[[1000,1100],[1900,2000]]);
});
test('a constructor retaining nonzero counters is not accepted as a fresh attempt',()=>{
  assert.throws(()=>freshTracker(class{update(){}current(){return {seconds:5};}},dance),/zero/);
});
