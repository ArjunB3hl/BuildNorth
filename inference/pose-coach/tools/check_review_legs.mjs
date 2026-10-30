// Local, read-only browser regression for the feet/legs review of the newest two-attempt session.
// Camera, microphone and voice services are simulated; remote requests and writes are blocked.
// RHYTHM_NEWEST_ID selects the recording served by the local server (default: the 2026-10-29 18:05 session).
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const {chromium}=await import(process.env.RHYTHM_PLAYWRIGHT||'playwright');
const base=process.env.RHYTHM_REVIEW_URL||'http://127.0.0.1:8765',id=process.env.RHYTHM_NEWEST_ID||'live-20261029180504-auto';
const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],
 ...(process.env.RHYTHM_CHROMIUM?{executablePath:process.env.RHYTHM_CHROMIUM}:{})});
const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],writes=[],services=[];
page.on('pageerror',e=>errors.push(e.message));
// Simulated devices: count any camera/microphone request; speech is a silent stub.
await page.addInitScript(()=>{
 window.__media=[];const md=navigator.mediaDevices;
 if(md)md.getUserMedia=async c=>{window.__media.push(JSON.stringify(c));const s=document.createElement('canvas').captureStream(1);return s;};
 window.speechSynthesis&&(window.speechSynthesis.speak=()=>window.__media.push('speech'));
});
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.origin!==base){services.push(req.url());return route.abort();}
 // Simulated voice/coach endpoints: answered locally, never forwarded to the server or a paid service.
 if(/^\/api\/(tts|stt|coach)/.test(url.pathname)){services.push(url.pathname);return url.pathname.startsWith('/api/tts')?route.fulfill({status:200,contentType:'audio/wav',body:Buffer.alloc(44)}):route.fulfill({json:{ok:true,text:''}});}
 if(!['GET','HEAD'].includes(req.method())){writes.push(req.url());return route.abort();}
 return route.continue();
});
const ready=()=>page.waitForFunction(()=>!document.getElementById('loadMovementReview').disabled&&!document.getElementById('reviewBody').hidden,null,{timeout:60000});
const seekTime=async seconds=>page.evaluate(s=>{const el=document.getElementById('reviewScrub'),from=Number(document.getElementById('reviewFrom').value),to=Number(document.getElementById('reviewTo').value);
 el.value=String((s-from)/(to-from));el.dispatchEvent(new Event('input',{bubbles:true}));},seconds);
const text=sel=>page.locator(sel).innerText();
const rendered=()=>page.evaluate(()=>window.__render);
const result={};
try{
 await page.goto(`${base}/web/index.html?review=1`);await ready();
 await page.locator('#movementRecording').selectOption(id);await page.locator('#loadMovementReview').click();await ready();
 await page.evaluate(async()=>{
  const {Review3D}=await import('/web/js/review-3d.js'),draw=Review3D.prototype.draw;
  Review3D.prototype.draw=function(){draw.call(this);const meshes=[];this.scene.traverseVisible(o=>{if(o.isSkinnedMesh)meshes.push(o.name);});
   window.__render={meshes:meshes.length,triangles:this.renderer.info.render.triangles,hot:this.characters?.instances.map(x=>x.hot)};};
 });
 // Two saved attempts, split at the saved restart; no pose-similarity candidate passes its checks.
 assert.equal(await page.locator('.review-attempt').count(),2);
 const [a1,a2]=[await page.locator('.review-attempt').nth(0).innerText(),await page.locator('.review-attempt').nth(1).innerText()];
 assert.match(a1,/Attempt 1 · 0:20\.8–1:55\.9/);assert.match(a2,/Attempt 2 · 1:55\.9–2:51\.4/);
 assert.match(a1,/No distinguishable reference phase/);assert.match(a1,/follows the reference’s knee-bend order/);
 result.attempts=2;
 // The anchored phrase and its single supported finding.
 await page.locator('.review-attempt').nth(0).getByRole('button',{name:/bend-order phrase 1:35\.6/}).click();
 assert.match(await text('#reviewAlignment'),/Timing anchored by the order of your measured knee bends/);
 assert.equal(await page.locator('.review-finding').count(),1);
 const finding=page.locator('.review-finding').first();assert.match(await finding.innerText(),/left knee · you 1:38\.4/);
 assert.match(await finding.innerText(),/Foot height uses the camera image/);
 await finding.getByRole('button',{name:'Show this difference'}).click();
 assert.match(await text('#reviewReadout'),/You 1:38\.4 · reference 0:01\.7/);assert.equal(await page.locator('#reviewActiveCue').isVisible(),true);
 assert.match(await text('#reviewActiveCue'),/Timing anchored by your knee bends/);
 // While turned, the far (right) arm is uncertain: it is collapsed, not guessed, and both skinned characters
 // show the highlighted left leg.
 let r=await rendered();assert.equal(r.meshes,4);assert.ok(r.triangles>10000);assert.match(r.hot[0],/LeftLeg/);assert.match(r.hot[1],/LeftLeg/);
 assert.match(await text('#reviewYouLabel'),/unmeasured parts hidden/);assert.match(await text('#reviewModelStatus'),/Not shown.*right (upper arm|forearm|hand)/);
 await fs.mkdir('.data/review-artifacts',{recursive:true});await page.locator('#reviewScene').scrollIntoViewIfNeeded();
 await page.screenshot({path:'.data/review-artifacts/legs-anchored-finding.png'});
 result.finding='left knee 1:38.4';result.skinnedMeshes=r.meshes;
 // Highlight is limited to the measured bend: 0.3 s earlier it is cleared on both figures.
 await seekTime(98.1);assert.equal(await page.locator('#reviewActiveCue').isVisible(),false);assert.ok((await rendered()).hot.every(x=>!x));
 // Scrubbing backward to the phrase start and forward to its end, reference clamped to the 4.6 s clip.
 await page.locator('#reviewScrub').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.match(await text('#reviewReadout'),/You 1:35\.6 · reference 0:00\.0/);
 await page.locator('#reviewScrub').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.match(await text('#reviewReadout'),/reference 0:04\.6/);
 // Playback advances in real time at 1× and stops at the phrase end.
 await page.locator('#reviewScrub').evaluate(el=>{el.value='.2';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('#reviewSpeed').selectOption('1');const before=Number(await page.locator('#reviewScrub').inputValue());
 await page.locator('#reviewPlay').click();await page.waitForTimeout(1000);await page.locator('#reviewPlay').click();
 const after=Number(await page.locator('#reviewScrub').inputValue()),span=(Number(await page.locator('#reviewTo').inputValue())-Number(await page.locator('#reviewFrom').inputValue()));
 assert.ok((after-before)*span>.6&&(after-before)*span<1.6,`1 s of playback moved ${((after-before)*span).toFixed(2)} s`);result.playback=true;
 // Mirror display changes only the display.
 await page.locator('#reviewMirror').check();await finding.getByRole('button',{name:'Show this difference'}).click();
 assert.equal((await rendered()).meshes,4);assert.match(await text('#reviewActiveCue'),/left knee/);await page.locator('#reviewMirror').uncheck();
 // Confidence gap: attempt 2's right bend at 2:03.2 loses the right ankle; only that lower leg is hidden.
 await page.locator('.review-attempt').nth(1).getByRole('button',{name:/bend-order phrase 1:59\.9/}).click();
 assert.equal(await page.locator('.review-finding').count(),0);assert.match(await text('#reviewFindings'),/No sustained, clearly visible difference/);
 await seekTime(123.2);assert.match(await text('#reviewYouLabel'),/unmeasured parts hidden/);assert.match(await text('#reviewModelStatus'),/right lower leg/);
 r=await rendered();assert.equal(r.meshes,4);
 await page.locator('#reviewScene').scrollIntoViewIfNeeded();await page.screenshot({path:'.data/review-artifacts/legs-hidden-right-ankle.png'});result.confidenceGap=true;
 // Ambiguous and pinned alignments give replay only.
 for(const [from,to,reason] of [['64.319','67.819',/Side uncertain|Timing conflict|Phase uncertain/],['63.319','67.919',/still/]]){
  await page.locator('#reviewFrom').fill(from);await page.locator('#reviewTo').fill(to);await page.locator('#reviewCompare').click();
  assert.match(await text('#reviewAlignment'),reason);assert.equal(await page.locator('.review-finding').count(),0);assert.match(await text('#reviewReadout'),/timing unverified/);
 }
 result.ambiguousAlignment=true;
 // A range across the saved restart at 1:55.939 is rejected.
 await page.locator('#reviewFrom').fill('114');await page.locator('#reviewTo').fill('118');await page.locator('#reviewCompare').click();
 assert.match(await text('#reviewStatus'),/cannot cross a restart/);result.restartBoundary=true;
 // Whole-body focus has no bend-order phrases and no leg-only cues.
 await page.locator('#reviewFocus').selectOption('whole');assert.equal(await page.locator('.review-attempt button',{hasText:'bend-order'}).count(),0);
 await page.setViewportSize({width:390,height:900});await page.locator('#reviewScene').scrollIntoViewIfNeeded();await page.screenshot({path:'.data/review-artifacts/legs-mobile.png'});
 const media=await page.evaluate(()=>window.__media);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(services,[]);assert.deepEqual(media,[]);
 console.log(JSON.stringify({passed:true,...result,pageErrors:0,writeRequests:0,cameraOrVoiceCalls:0,externalRequests:0},null,2));
}finally{await browser.close();}
