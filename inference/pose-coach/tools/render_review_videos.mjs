// Export replay videos from saved landmarks with the review's own renderer (two skinned Y Bot instances, labelled
// landmark fallback). Nearest saved frame only: no interpolation, no filled gaps, never the reference as the user.
// node tools/render_review_videos.mjs <out-dir> <job.json>   (needs the local server, Playwright and ffmpeg)
// job: [{file, recording, attempt, mode:'attempt'|'clip', title, from?, to?, at?, speeds?, hold?}]
// A source video's real/3D/MediaPipe view is tools/render_source_video.mjs.
import fs from 'node:fs/promises';import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.RHYTHM_PLAYWRIGHT||'playwright');
const base=process.env.RHYTHM_REVIEW_URL||'http://127.0.0.1:8765',[out,jobFile]=process.argv.slice(2),fps=30;
const jobs=JSON.parse(await fs.readFile(jobFile,'utf8'));await fs.mkdir(out,{recursive:true});
const PAGE=`<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:720px;overflow:hidden;background:#0f1722;color:#eef5ff;font:15px system-ui,-apple-system,sans-serif}
h1{position:absolute;left:26px;top:14px;margin:0;font-size:26px}#sub{position:absolute;left:26px;top:52px;color:#b9c8da}
#scene{position:absolute;left:20px;top:84px;width:780px;height:520px;border-radius:8px;overflow:hidden}
#you,#ref{position:absolute;top:92px;font-weight:600;font-size:14px}#you{left:34px;color:#52dbc9;max-width:420px}#ref{left:470px;color:#c4adff}
#lm{position:absolute;left:820px;top:84px;width:440px;height:330px;background:#162230;border:1px solid #2c3e52;border-radius:8px}
#lmTitle{position:absolute;left:820px;top:420px;color:#9fd6ff;font-weight:600}#lmNote{position:absolute;left:820px;top:444px;width:440px;color:#c7d6e9;font-size:14px;line-height:1.4}
#cue{position:absolute;left:820px;top:520px;width:430px;padding:10px;border-radius:8px;background:#3a2f12;color:#ffe2a3;font-size:14px;line-height:1.4;display:none}
#status{position:absolute;left:26px;top:612px;width:780px;color:#c7d6e9;font-size:13px}
#bar{position:absolute;left:26px;top:648px;width:1228px;height:10px;background:#263445;border-radius:5px}#fill{height:10px;background:#52dbc9;border-radius:5px;width:0}
.mark{position:absolute;top:-4px;height:18px;border-radius:3px;background:rgba(196,173,255,.5)}.mark.f{background:#ffcf70}
#clock{position:absolute;left:26px;top:668px;font-size:17px}#session{position:absolute;right:26px;top:668px;font-size:17px}
#foot{position:absolute;left:26px;top:696px;color:#91a5bc;font-size:12px}
</style><h1 id="title"></h1><div id="sub"></div><div id="scene"></div><div id="you"></div><div id="ref"></div>
<canvas id="lm" width="880" height="660"></canvas><div id="lmTitle">You · saved 2D landmarks, unmirrored</div><div id="lmNote"></div>
<div id="cue"></div><div id="status"></div><div id="bar"><div id="fill"></div></div><div id="clock"></div><div id="session"></div>
<div id="foot">Pose landmarks only: no camera video or audio. 3D centred at hips (travel not shown); character proportions, fingers and limb twist are illustrative.</div>
<script type="importmap">{"imports":{"three":"/web/vendor/three-0.170.0/build/three.module.js","three/addons/":"/web/vendor/three-0.170.0/examples/jsm/"}}</script>`;
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader'],...(process.env.RHYTHM_CHROMIUM?{executablePath:process.env.RHYTHM_CHROMIUM}:{})});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(u.pathname==='/web/__render.html')return route.fulfill({contentType:'text/html',body:PAGE});
  if(u.origin!==base||!['GET','HEAD'].includes(r.method()))return route.abort();return route.continue();});
const manifest=[];
try{
for(const job of jobs){
  // A fresh page per video: no canvas, timeline mark or renderer state may carry over between attempts.
  await page.goto(`${base}/web/__render.html`);
  const info=await page.evaluate(async job=>{
    const A=await import('/web/js/review-analysis.js'),L=await import('/web/js/review-legs.js'),{referenceMotion}=await import('/web/js/reference-motion.js');
    const {Review3D,THREE}=await import('/web/js/review-3d.js'),{characterEvidence}=await import('/web/js/review-character.js');
    const rec=await (await fetch(`/api/recording?id=${encodeURIComponent(job.recording)}`)).json();
    const lib=(await (await fetch('/moves/library.json')).json()).movements.find(m=>m.key==='freestyle_dance');
    const buffer=await (await fetch(`/moves/${lib.glb}`)).arrayBuffer(),motion=referenceMotion(buffer,THREE,lib.durationSec);
    const frames=A.prepareFrames(rec.frames),origin=frames[0].t,reference=A.prepareFrames(motion.frames);
    const windows=A.reviewWindows(rec,'freestyle_dance'),w=windows.find(x=>x.attempt===job.attempt);
    const review=L.anchoredReview(frames,reference,w,motion.duration*1000),phrases=review.phrases.filter(p=>!p.mirrored);
    const findings=phrases.flatMap(p=>p.findings.map(f=>({...f,phrase:p})));
    const viewer=new Review3D(document.getElementById('scene'),{onStatus:s=>{window.__status=s;}});
    await viewer.loadCharacters(buffer,{resourcePath:new URL(`/moves/${lib.glb}`,location.href).href.replace(/[^/]*$/,'')});
    const scales=[A.torsoScale(frames),A.torsoScale(motion.frames)];
    const stamp=s=>`${Math.floor(Math.max(0,s)/60)}:${(Math.max(0,s)%60).toFixed(1).padStart(4,'0')}`,rel=t=>(t-origin)/1000;
    const clip=job.mode==='clip',finding=clip?findings.find(f=>Math.abs(rel(f.t)-job.at)<.5):null;
    const start=clip?origin+job.from*1000:w.start,end=clip?origin+job.to*1000:w.end,$=id=>document.getElementById(id);
    $('title').textContent=job.title;
    $('sub').textContent=clip?`Comparison clip · session ${stamp(rel(start))}–${stamp(rel(end))} · speed shown on screen · reference time anchored by matched knee bends`
      :`Complete attempt ${job.attempt} of ${windows.length} · 1× speed, original timing, all pauses kept · session ${stamp(rel(w.start))}–${stamp(rel(w.end))} · saved restart boundaries`;
    const bar=$('bar');for(const p of phrases){const m=document.createElement('div');m.className='mark';m.style.left=`${(p.start-start)/(end-start)*100}%`;m.style.width=`${(p.end-p.start)/(end-start)*100}%`;if(!clip)bar.append(m);}
    for(const f of findings){const m=document.createElement('div');m.className='mark f';m.style.left=`${(f.start-start)/(end-start)*100}%`;m.style.width=`max(4px,${(f.end-f.start)/(end-start)*100}%)`;if(f.start>=start&&f.end<=end)bar.append(m);}
    const ctx=$('lm').getContext('2d'),BONES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32],[27,29],[28,30],[29,31],[30,32]];
    window.__draw=async(t,speedLabel)=>{
      const f=A.frameAt(frames,t,80),phrase=phrases.find(p=>t>=p.start&&t<=p.end),active=findings.find(x=>t>=x.start&&t<=x.end);
      const rt=clip&&finding?L.anchoredTime(finding.phrase,t,motion.duration*1000):null,ref=rt!=null?motion.sample(rt/1000):null;
      viewer.show(f,ref,{bodyAligned:true,scales,part:active?.ids??[]});
      const s=window.__status??{};$('you').textContent=f?s.user:'You · no saved pose at this time';$('ref').textContent=ref?`${s.reference} · ${stamp(rt/1000)}`:'';
      $('status').textContent=!f?'No pose was saved for this moment; nothing is drawn in its place.':characterEvidence(f).supported?`3D: your Y Bot follows this saved frame.${characterEvidence(f).omitted.length?` Not shown (low confidence, not guessed): ${characterEvidence(f).omitted.join(', ')}.`:''}`:`3D: labelled landmarks only. ${characterEvidence(f).reason} No limb is guessed.`;
      ctx.fillStyle='#162230';ctx.fillRect(0,0,880,660);
      // Image coordinates are normalised to the 16:9 camera frame; this panel has a 4:3 aspect, so x is kept and y is
      // scaled by the same pixels-per-unit, cropping nothing for a standing person (y stays within the panel).
      let n=0;if(f?.image){const ok=i=>A.visible(f,i);n=f.image.filter((_,i)=>ok(i)).length;
        const pt=i=>[f.image[i][0]*880,f.image[i][1]*880*rec.height/rec.width+(660-880*rec.height/rec.width)/2];
        ctx.lineWidth=5;for(const [a,b] of BONES)if(ok(a)&&ok(b)){const hot=active?.ids.includes(a)&&active?.ids.includes(b);ctx.strokeStyle=hot?'#ffcf70':'#8fd2ff';ctx.beginPath();ctx.moveTo(...pt(a));ctx.lineTo(...pt(b));ctx.stroke();}
        for(let i=0;i<33;i++)if(ok(i)){ctx.fillStyle=active?.ids.includes(i)?'#ffcf70':'#ffffff';ctx.beginPath();ctx.arc(...pt(i),5,0,7);ctx.fill();}
        ctx.fillStyle='#ffb3b3';ctx.font='22px system-ui';for(const [i,l] of [[27,'L ankle'],[28,'R ankle']])if(!ok(i)&&f.image[i])ctx.fillText(`${l}: low confidence`,20,i===27?40:70);}
      $('lmNote').textContent=f?`${n}/33 landmarks at confidence ≥0.7 and in frame (others not drawn). Both ankles: ${[27,28].every(i=>A.visible(f,i))?'visible':'not both visible'}.${phrase?` Inside the bend-order phrase ${stamp(rel(phrase.start))}–${stamp(rel(phrase.end))}.`:''}`:'No saved pose.';
      $('cue').style.display=active?'block':'none';
      if(active)$('cue').textContent=`${active.part} · matched ${active.ordinal===2?'second ':''}${active.part.split(' ')[0]} lift: knee ≈${active.userAngle}° vs ${active.referenceAngle}° in the reference; foot ${(active.userRise*100).toFixed(0)}% vs ${(active.referenceRise*100).toFixed(0)}% of leg length above the other ankle. Optional cue: ${active.cue.replace('To try the reference, ','')}`;
      $('fill').style.width=`${(t-start)/(end-start)*100}%`;
      $('clock').textContent=`${clip?'Clip':'Attempt'} ${stamp((t-start)/1000)} / ${stamp((end-start)/1000)}${speedLabel?` · ${speedLabel}`:''}`;$('session').textContent=`Session time ${stamp(rel(t))}`;
      return {pose:!!f,character:!!f&&characterEvidence(f).supported,active:!!active};
    };
    return {start,end,origin,phrases:phrases.map(p=>({start:rel(p.start),end:rel(p.end),pace:p.pace,order:p.pairs.map(q=>q.user.side)})),
      findings:findings.map(f=>({part:f.part,t:rel(f.t),start:rel(f.start),end:rel(f.end),referenceT:f.referenceT/1000,user:f.userValue,reference:f.referenceValue,userRise:f.userRise,referenceRise:f.referenceRise})),
      attemptStart:rel(w.start),attemptEnd:rel(w.end)};
  },job);
  const path=`${out}/${job.file}`,ff=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','-','-c:v','libx264','-preset','medium','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',path],{stdio:['pipe','inherit','inherit']});
  const counts={frames:0,pose:0,character:0,active:0},passes=job.mode==='attempt'?[1]:(job.speeds??[1,.4]);
  // A finding clip stops on the first frame where the difference is flagged (its highlight appears) and holds it,
  // so a ~70 ms bend is not a blink; nothing after it is shown. Complete attempts run to their saved boundary.
  const finding=job.mode==='clip'?info.findings.find(f=>Math.abs(f.t-job.at)<.5):null,stop=finding?info.origin+finding.end*1000:info.end;
  const frame=async(t,label)=>{
    const r=await page.evaluate(([t,l])=>window.__draw(t,l),[t,label]);
    const jpg=await page.screenshot({type:'jpeg',quality:88});if(!ff.stdin.write(jpg))await new Promise(r=>ff.stdin.once('drain',r));
    counts.frames++;for(const key of ['pose','character','active'])if(r[key])counts[key]++;
    return r;
  };
  for(const speed of passes){
    let flagged=null;
    for(let k=0;;k++){const t=info.start+k*1000/fps*speed;if(t>stop+1e-6)break;
      if((await frame(t,job.mode==='attempt'?'':`${speed}× speed`)).active&&finding){flagged=t;break;}}
    if(finding&&flagged==null)throw new Error(`${job.file}: the finding was never flagged in the clip range.`);
    if(finding)for(let k=0;k<fps*(job.hold??2);k++)await frame(flagged,`${speed}× speed · stopped: difference detected`);
  }
  ff.stdin.end();await new Promise((res,rej)=>ff.on('close',c=>c?rej(new Error(`ffmpeg ${c}`)):res()));
  manifest.push({...job,...info,counts,fps});console.error(`${job.file}: ${counts.frames} frames`);
}
// Update entries by file, keeping videos rendered earlier into the same folder.
const previous=await fs.readFile(`${out}/manifest.json`,'utf8').then(JSON.parse).catch(()=>({videos:[]}));
const videos=[...previous.videos.filter(v=>!manifest.some(m=>m.file===v.file)),...manifest];
await fs.writeFile(`${out}/manifest.json`,JSON.stringify({renderedAt:new Date().toISOString(),pageErrors:errors,videos},null,2));
if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
