// Local, read-only browser regression for attempt-aware review. All remote requests and writes are blocked.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const {chromium}=await import(process.env.RHYTHM_PLAYWRIGHT||'playwright');
const base=process.env.RHYTHM_REVIEW_URL||'http://127.0.0.1:8765',dir=process.env.RHYTHM_SESSION_DIR;
if(!dir)throw new Error('Set RHYTHM_SESSION_DIR to the private recordings folder.');
const first='live-20261029163035-auto',latest='live-20261029164403-auto',future='live-20990101000000-auto';
const newRecording=JSON.parse(await fs.readFile(`${dir}/${latest}.json`));newRecording.id=future;
// Simulate a newly saved recording with a different timestamp origin, using response copies only.
for(const f of newRecording.frames)f.t+=900000;
for(const a of newRecording.attempts){a.start+=900000;a.end+=900000;}
for(const i of newRecording.movementIntervals){i.start+=900000;i.end+=900000;}
for(const e of newRecording.events)if(Number.isFinite(e.t))e.t+=900000;
const browser=await chromium.launch({headless:true,...(process.env.RHYTHM_CHROMIUM?{executablePath:process.env.RHYTHM_CHROMIUM}:{})});
const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],writes=[];
let mode='normal',addFuture=false;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(!['GET','HEAD'].includes(req.method())){writes.push(req.url());return route.abort();}
 if(url.origin!==base)return route.abort();
 if(url.pathname==='/api/recordings'&&addFuture){const response=await route.fetch(),list=await response.json();return route.fulfill({response,json:[...list,{id:future,bytes:1000000}]});}
 if(url.pathname==='/api/recording'&&(url.searchParams.get('id')===future||mode==='missing-ankle')){
  const rec=structuredClone(newRecording);if(mode==='missing-ankle')for(const f of rec.frames)if(f.image)f.image[27][3]=.1;
  return route.fulfill({json:rec});
 }
 if(url.pathname==='/moves/glb/freestyle_dance.glb'&&mode==='missing-model')return route.fulfill({status:404,body:'Test-only missing model'});
 return route.continue();
});
const ready=()=>page.waitForFunction(()=>!document.getElementById('loadMovementReview').disabled&&!document.getElementById('reviewBody').hidden);
const reload=async()=>{await page.locator('#loadMovementReview').click();await ready();};
const seek=v=>page.locator('#reviewScrub').evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},v);
// The former attempt-4 knee cue compared standing with the reference's lift and is withheld. The supported leg
// difference is attempt 1's second left lift, timed by the order of measured knee bends.
const attempt4=async()=>{
 const card=page.locator('.review-attempt').filter({hasText:'Attempt 1 ·'});await card.getByRole('button',{name:/bend-order phrase/}).first().click();
 const knee=page.locator('.review-finding').filter({hasText:'left knee'});await knee.getByRole('button',{name:'Show this difference'}).click();
};
try{
 await page.goto(`${base}/web/index.html?review=1`);await ready();
 await page.locator('#movementRecording').selectOption(latest);await reload();assert.equal(await page.locator('.review-attempt').count(),5);
 await page.evaluate(async()=>{
  const {Review3D}=await import('/web/js/review-3d.js'),draw=Review3D.prototype.draw;
  Review3D.prototype.draw=function(){draw.call(this);const meshes=[];this.scene.traverseVisible(o=>{if(o.isSkinnedMesh)meshes.push(o.name);});window.__render={meshes,triangles:this.renderer.info.render.triangles,part:this.last?.options.part,hot:this.characters?.instances.map(x=>x.hot)};};
 });
 // Both skinned characters, highlighted left leg; any uncertain limb of the user is collapsed, not guessed.
 await attempt4();let rendered=await page.evaluate(()=>window.__render);assert.equal(rendered.meshes.length,4);assert.ok(rendered.triangles>10000);assert.match(rendered.hot[0],/LeftLeg/);
 assert.match(await page.locator('#reviewReadout').innerText(),/0:50\.1/);assert.equal(await page.locator('#reviewActiveCue').isVisible(),true);
 await fs.mkdir('.data/review-artifacts',{recursive:true});await page.locator('#reviewScene').scrollIntoViewIfNeeded();await page.screenshot({path:'.data/review-artifacts/new-session-attempt-4.png'});
 await seek(1);assert.match(await page.locator('#reviewReadout').innerText(),/0:04\.6/);assert.equal(await page.locator('#reviewActiveCue').isVisible(),false);assert.ok((await page.evaluate(()=>window.__render.hot)).every(x=>!x));
 await seek(.3);await page.locator('#reviewSpeed').selectOption('0.5');await page.locator('#reviewPlay').click();await page.waitForFunction(()=>Number(document.getElementById('reviewScrub').value)>.35);await page.locator('#reviewPlay').click();
 await attempt4();await page.locator('#reviewMirror').check();assert.equal((await page.evaluate(()=>window.__render.meshes)).length,4);await page.locator('#reviewMirror').uncheck();
 // Preliminary claim must now be visibly withheld.
 await page.locator('#reviewFrom').fill('115.154');await page.locator('#reviewTo').fill('122.054');await page.locator('#reviewCompare').click();
 assert.match(await page.locator('#reviewAlignment').innerText(),/Phase uncertain|still/);assert.equal(await page.locator('.review-finding').count(),0);assert.match(await page.locator('#reviewReadout').innerText(),/timing unverified/);
 // A user-entered range across a restart is rejected.
 await page.locator('#reviewFrom').fill('127');await page.locator('#reviewTo').fill('130');await page.locator('#reviewCompare').click();assert.match(await page.locator('#reviewStatus').innerText(),/cannot cross a restart/);
 // Read local files without moving, overwriting or uploading them.
 await page.locator('#reviewRecordingFiles').setInputFiles(`${dir}/${first}.json`);await page.waitForFunction(()=>document.querySelectorAll('.review-attempt').length===3);await ready();
 assert.match(await page.locator('.review-attempt').nth(1).innerText(),/No distinguishable reference phase/);
 await page.locator('#reviewRecordingFiles').setInputFiles(`${dir}/${latest}.json`);await page.waitForFunction(()=>document.querySelectorAll('.review-attempt').length===5);await ready();
 // Stop-and-save event automatically refreshes and opens an unseen recording.
 addFuture=true;await page.evaluate(id=>window.dispatchEvent(new CustomEvent('rhythm-recording-saved',{detail:{id}})),future);
 await page.waitForFunction(id=>document.getElementById('movementRecording').value===id,future);await ready();await attempt4();assert.match(await page.locator('#reviewReadout').innerText(),/0:50\.1/);
 // A hidden left ankle removes left-leg evidence and collapses only that lower leg on the user character.
 mode='missing-ankle';await reload();assert.equal(await page.locator('.review-finding').count(),0);assert.match(await page.locator('#reviewYouLabel').innerText(),/unmeasured parts hidden|fallback/);assert.match(await page.locator('#reviewModelStatus').innerText(),/left lower leg|shoulders|hips/);
 await page.screenshot({path:'.data/review-artifacts/new-session-hidden-ankle.png'});
 mode='missing-model';await reload();assert.match(await page.locator('#reviewReferenceLabel').innerText(),/unavailable/);assert.equal((await page.evaluate(()=>window.__render.meshes)).length,0);assert.equal(await page.locator('.review-finding').count(),0);await seek(.6);
 mode='normal';await reload();await attempt4();assert.equal((await page.evaluate(()=>window.__render.meshes)).length,4);
 await page.setViewportSize({width:600,height:1000});await page.locator('#reviewScene').scrollIntoViewIfNeeded();await page.screenshot({path:'.data/review-artifacts/new-session-mobile.png'});
 // Exercise the real live page using its saved-landmark source; never open camera, mic or coach.
 await page.locator('#source').selectOption(`rec:${latest}`);await page.locator('#record').uncheck();
 await page.evaluate(()=>window.POSE_COACH.chooseMovement('freestyle_dance','tap'));
 await page.locator('#start').click();
 await page.waitForFunction(()=>{const s=window.POSE_COACH;return s.running&&s.move?.lastUpdateAt!=null&&performance.now()-s.lastPoseAt<1000;});
 assert.equal(await page.locator('#reps').innerText(),'●');assert.match(await page.locator('#repsLabel').innerText(),/Tracking/);
 await page.evaluate(()=>window.__previousTracker=window.POSE_COACH.move.tracker);await page.locator('#restartMove').click();
 assert.equal(await page.evaluate(()=>window.POSE_COACH.move.tracker!==window.__previousTracker),true);
 assert.ok(await page.evaluate(()=>window.POSE_COACH.move.tracker.current().seconds<1));
 await page.waitForFunction(()=>window.POSE_COACH.move.lastUpdateAt!=null);
 assert.equal(await page.evaluate(()=>!window.POSE_COACH.stream&&!window.POSE_COACH.eleven&&!window.POSE_COACH.rec),true);
 await page.evaluate(()=>{window.__retainedAttempt=window.POSE_COACH.move;window.POSE_COACH.Tracker=null;});await page.locator('#restartMove').click();
 assert.equal(await page.evaluate(()=>window.POSE_COACH.trackingBlocked&&window.POSE_COACH.move===window.__retainedAttempt),true);
 assert.match(await page.locator('#repsLabel').innerText(),/Restart was not applied/);await page.locator('#stop').click();
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log(JSON.stringify({passed:true,attempts:8,skinnedPrimitives:rendered.meshes.length,triangles:rendered.triangles,playback:true,scrubbing:true,highlightCleared:true,rejectedPreliminaryPhase:true,restartBoundary:true,localImports:true,newSaveRefresh:true,shiftedTimestampOrigin:true,hiddenAnkle:true,failedModel:true,retry:true,liveReplayTracking:true,liveRestart:true,rejectedUnavailableRestart:true,pageErrors:errors.length,writeRequests:writes.length},null,2));
}finally{await browser.close();}
