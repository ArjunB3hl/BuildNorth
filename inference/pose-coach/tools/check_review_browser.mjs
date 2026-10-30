// Read-only local browser regression using the saved freestyle diagnostic recording.
// Requires Playwright and Chromium already installed. No camera, coach, recording writes or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.RHYTHM_PLAYWRIGHT||'playwright');
const base=process.env.RHYTHM_REVIEW_URL||'http://127.0.0.1:8765';
const output=process.env.RHYTHM_REVIEW_ARTIFACTS||'.data/review-artifacts';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.RHYTHM_CHROMIUM?{executablePath:process.env.RHYTHM_CHROMIUM}:{})});
const page=await browser.newPage({viewport:{width:1200,height:1000},deviceScaleFactor:1});
let mode='normal';const errors=[],writes=[];
page.on('pageerror',e=>errors.push(e.message));

// Remove only skin bindings from an HTTP response copy. The on-disk GLB stays byte-for-byte intact.
function unskinned(buffer) {
  const n=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+n).toString());
  delete json.skins;for(const node of json.nodes)delete node.skin;
  const text=Buffer.from(JSON.stringify(json)),padded=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(padded);
  const header=Buffer.from(buffer.subarray(0,12)),chunk=Buffer.alloc(8);chunk.writeUInt32LE(padded.length,0);chunk.writeUInt32LE(0x4e4f534a,4);
  const result=Buffer.concat([header,chunk,padded,buffer.subarray(20+n)]);result.writeUInt32LE(result.length,8);return result;
}
await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(!['GET','HEAD'].includes(request.method())){writes.push(url.pathname);return route.abort();}
  if(url.origin!==base)return route.abort();
  if(url.pathname==='/moves/glb/freestyle_dance.glb'&&mode==='missing-model')return route.fulfill({status:404,body:'Test-only missing model'});
  if(url.pathname==='/moves/glb/freestyle_dance.glb'&&mode==='unskinned-model') {
    const response=await route.fetch();return route.fulfill({response,body:unskinned(await response.body())});
  }
  if(url.pathname==='/api/recording'&&mode==='missing-ankle') {
    const response=await route.fetch(),rec=await response.json();
    for(const frame of rec.frames)if(frame.image?.[27])frame.image[27][3]=.1;
    return route.fulfill({response,json:rec});
  }
  return route.continue();
});
const text=id=>page.locator(`#${id}`).innerText();
const render=()=>page.evaluate(()=>window.__reviewRender);
// The earlier foot-spacing cues matched standing to the reference opening and are withheld. The default load now
// opens the newest session's bend-order phrase and its left-knee finding; while turned there, the user's far arm is
// uncertain, so character checks use a nearby fully visible moment (1:36.77).
const foot=()=>page.locator('.review-finding').filter({hasText:'left knee'}).getByRole('button',{name:'Show this difference'});
const visibleMoment=()=>page.evaluate(s=>{const el=document.getElementById('reviewScrub'),from=Number(document.getElementById('reviewFrom').value),to=Number(document.getElementById('reviewTo').value);
  el.value=String((s-from)/(to-from));el.dispatchEvent(new Event('input',{bubbles:true}));},Number(process.env.RHYTHM_VISIBLE_SECONDS||96.77));
const reload=async()=>{
  await page.getByRole('button',{name:'Load review',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('loadMovementReview').disabled&& !document.getElementById('reviewBody').hidden);
};
const seek=async value=>{
  await page.locator('#reviewScrub').evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
};
try {
  await page.goto(`${base}/web/index.html?review=1`);
  await foot().waitFor({timeout:30000});
  if(process.env.RHYTHM_RECORDING_ID){await page.locator('#movementRecording').selectOption(process.env.RHYTHM_RECORDING_ID);await reload();}
  // Observe actual renderer submissions without exposing debugging hooks in the shipped page.
  await page.evaluate(async()=>{
    const {Review3D}=await import('/web/js/review-3d.js'),draw=Review3D.prototype.draw;
    Review3D.prototype.draw=function(){
      draw.call(this);const meshes=[];
      this.scene.traverseVisible(o=>{if(o.isSkinnedMesh)meshes.push({name:o.name,vertices:o.geometry.attributes.position.count});});
      window.__reviewRender={meshes,triangles:this.renderer.info.render.triangles,calls:this.renderer.info.render.calls};
    };
  });
  await foot().click();assert.equal(await page.locator('#reviewActiveCue').isVisible(),true);
  await visibleMoment();
  const initial=await render();assert.equal(initial.meshes.length,4);assert.ok(initial.triangles>1000);
  assert.match(await text('reviewYouLabel'),/Y Bot/);assert.match(await text('reviewReferenceLabel'),/original animated Y Bot/);
  await page.locator('#reviewScene').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/character-review-view.png`});
  await page.locator('#movementReview').screenshot({path:`${output}/character-review-full.png`});

  // Both display transforms must preserve actual character visibility. Anatomical labels do not change.
  await page.locator('#reviewMirror').check();assert.equal((await render()).meshes.length,4);
  await page.locator('#reviewAligned').uncheck();assert.equal((await render()).meshes.length,4);
  await page.locator('#reviewMirror').uncheck();await page.locator('#reviewAligned').check();
  await seek(1);assert.match(await text('reviewReadout'),/reference 0:04\.6/);assert.equal(await page.locator('#reviewActiveCue').isVisible(),false);
  await seek(.3);assert.doesNotMatch(await text('reviewReadout'),/reference 0:04\.6/);
  await page.locator('#reviewSpeed').selectOption('0.5');
  const before=Number(await page.locator('#reviewScrub').inputValue());
  await page.getByRole('button',{name:'Play phrase',exact:true}).click();
  await page.waitForFunction(v=>Number(document.getElementById('reviewScrub').value)>v+.03,before);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  assert.ok(Number(await page.locator('#reviewScrub').inputValue())>before);
  await foot().click();
  await page.locator('#reviewView').selectOption('landmarks');assert.equal((await render()).meshes.length,0);assert.match(await text('reviewYouLabel'),/saved landmarks/);
  await page.locator('#reviewView').selectOption('character');await visibleMoment();assert.equal((await render()).meshes.length,4);

  // A response-only occlusion forces the real UI down its no-invention path.
  // Only the unmeasured left lower leg is collapsed; no finding can use the missing ankle.
  mode='missing-ankle';await reload();
  // Without left-ankle evidence the default phrase changes; inspect the same moment by range.
  await page.locator('#reviewFrom').fill('95.6');await page.locator('#reviewTo').fill('102.3');await page.locator('#reviewCompare').click();await visibleMoment();assert.match(await text('reviewYouLabel'),/unmeasured parts hidden/);assert.match(await text('reviewModelStatus'),/left lower leg/);
  assert.equal((await render()).meshes.length,4);assert.equal(await page.locator('.review-finding').count(),0);
  await page.screenshot({path:`${output}/character-review-missing-landmark.png`});

  mode='unskinned-model';await reload();await foot().click();
  assert.equal((await render()).meshes.length,0);assert.match(await text('reviewModelStatus'),/no skinned character mesh/);
  assert.match(await text('reviewReferenceLabel'),/fallback/);assert.match(await text('reviewYouLabel'),/fallback/);
  await page.screenshot({path:`${output}/character-review-failed-skin.png`});

  mode='missing-model';await reload();assert.match(await text('reviewReferenceLabel'),/unavailable/);
  assert.match(await text('reviewAlignment'),/no alignment or correction/);assert.equal((await render()).meshes.length,0);
  assert.equal(await page.getByRole('button',{name:'Play phrase',exact:true}).isEnabled(),true);
  await seek(.7);assert.match(await text('reviewReadout'),/reference unavailable/);
  await page.screenshot({path:`${output}/character-review-failed-load.png`});

  mode='normal';await reload();await foot().click();await visibleMoment();assert.equal((await render()).meshes.length,4);
  await page.setViewportSize({width:600,height:1000});await page.locator('#reviewScene').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/character-review-mobile.png`});
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({passed:true,skinnedPrimitives:initial.meshes.length,renderedTriangles:initial.triangles,
    playback:true,scrubbing:true,endpointSeconds:4.6,mirror:true,missingLandmarks:true,failedSkin:true,failedLoad:true,retry:true,
    pageErrors:errors.length,writeRequests:writes.length},null,2));
}finally{await browser.close();}
