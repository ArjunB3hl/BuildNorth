// Three views of one source video, frame for frame: the real footage, the library's 3D Y Bot animation of the
// movement, and the MediaPipe landmarks measured from the footage (tools/extract_video_pose.mjs).
// node tools/render_source_video.mjs <out.mp4> <frames-dir with 0000.jpg…> <recording.json> [movement key] [speeds, e.g. 1,0.4]
// Needs the local server, Playwright and ffmpeg. Plays once per speed (default 1× then 0.4×); nothing is interpolated.
import fs from 'node:fs/promises';import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.RHYTHM_PLAYWRIGHT||'playwright');
const base=process.env.RHYTHM_REVIEW_URL||'http://127.0.0.1:8765',[out,framesDir,recordingPath,movement='freestyle_dance',speedList='1,0.4']=process.argv.slice(2);
const speeds=speedList.split(',').map(Number);if(!speeds.length||!speeds.every(v=>v>0))throw new Error('Speeds must be positive numbers, e.g. 1,0.4.');
const PAGE=`<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:720px;overflow:hidden;background:#0f1722;color:#eef5ff;font:15px system-ui,-apple-system,sans-serif}
h1{position:absolute;left:24px;top:12px;margin:0;font-size:25px}#sub{position:absolute;left:24px;top:48px;color:#b9c8da;font-size:14px}
.panel{position:absolute;top:104px;width:400px;height:540px;border-radius:8px;overflow:hidden;background:#162230}
.label{position:absolute;top:80px;font-weight:600;font-size:15px}#scene{position:absolute;left:-400px;top:0;width:800px;height:540px}
#bar{position:absolute;left:24px;top:658px;width:1232px;height:8px;background:#263445;border-radius:4px}#fill{height:8px;background:#9fd6ff;border-radius:4px;width:0}
#clock{position:absolute;left:24px;top:674px;font-size:16px}#ref{position:absolute;right:24px;top:674px;font-size:16px}
#foot{position:absolute;left:24px;top:700px;color:#91a5bc;font-size:12px}
</style><h1>Dance video · real, 3D and MediaPipe</h1><div id="sub"></div>
<div class="label" style="left:24px;color:#ffffff">Real video (cropped to the dancer)</div>
<div class="label" style="left:444px;color:#c4adff">3D version · library Y Bot animation</div>
<div class="label" style="left:864px;color:#9fd6ff">MediaPipe version · landmarks ≥0.7</div>
<canvas class="panel" id="video" width="400" height="540" style="left:20px"></canvas>
<div class="panel" style="left:440px"><div id="scene"></div></div>
<canvas class="panel" id="lm" width="400" height="540" style="left:860px"></canvas>
<div id="bar"><div id="fill"></div></div><div id="clock"></div><div id="ref"></div>
<div id="foot">The 3D figure is the movement library's animation, shown at the same clock time; it is centred at the hips, so travel is not shown. MediaPipe landmarks below 0.7 confidence are not drawn.</div>
<script type="importmap">{"imports":{"three":"/web/vendor/three-0.170.0/build/three.module.js","three/addons/":"/web/vendor/three-0.170.0/examples/jsm/"}}</script>`;
const recording=JSON.parse(await fs.readFile(recordingPath,'utf8')),fps=Math.round(1000/(recording.frames[1].t-recording.frames[0].t));
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader'],...(process.env.RHYTHM_CHROMIUM?{executablePath:process.env.RHYTHM_CHROMIUM}:{})});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(u.pathname==='/web/__source.html')return route.fulfill({contentType:'text/html',body:PAGE});
  if(u.pathname==='/__local/recording.json')return route.fulfill({contentType:'application/json',body:JSON.stringify(recording)});
  if(/^\/__local\/frames\/\d+\.jpg$/.test(u.pathname))return route.fulfill({contentType:'image/jpeg',body:await fs.readFile(`${framesDir}/${u.pathname.split('/').pop()}`)});
  if(u.origin!==base||!['GET','HEAD'].includes(r.method()))return route.abort();return route.continue();});
try{
  await page.goto(`${base}/web/__source.html`);
  const info=await page.evaluate(async({movement,fps})=>{
    const A=await import('/web/js/review-analysis.js'),{referenceMotion}=await import('/web/js/reference-motion.js'),{Review3D,THREE}=await import('/web/js/review-3d.js');
    const rec=await (await fetch('/__local/recording.json')).json(),lib=(await (await fetch('/moves/library.json')).json()).movements.find(m=>m.key===movement);
    const buffer=await (await fetch(`/moves/${lib.glb}`)).arrayBuffer(),motion=referenceMotion(buffer,THREE,lib.durationSec);
    const frames=A.prepareFrames(rec.frames),W=rec.width,H=rec.height,$=id=>document.getElementById(id);
    // One fixed crop for the whole clip, wide enough for every confident landmark and in the panels' 400:540 shape.
    const xs=frames.flatMap(f=>f.image?f.image.filter((_,i)=>A.visible(f,i)).map(p=>p[0]*W):[]);
    const cw=Math.min(W,Math.max(H*400/540,Math.max(...xs)-Math.min(...xs)+80)),ch=cw*540/400;
    const cx=Math.max(0,Math.min(W-cw,(Math.max(...xs)+Math.min(...xs))/2-cw/2)),cy=Math.max(0,(H-ch)/2);
    const toPanel=p=>[(p[0]*W-cx)/cw*400,(p[1]*H-cy)/ch*540];
    const viewer=new Review3D($('scene'),{onStatus:()=>{}});
    await viewer.loadCharacters(buffer,{resourcePath:new URL(`/moves/${lib.glb}`,location.href).href.replace(/[^/]*$/,'')});
    const video=$('video').getContext('2d'),lm=$('lm').getContext('2d'),end=frames.at(-1).t;
    const BONES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[28,30],[29,31],[30,32],[27,31],[28,32],[15,17],[15,19],[17,19],[16,18],[16,20],[18,20]];
    const stamp=s=>`${Math.floor(Math.max(0,s)/60)}:${(Math.max(0,s)%60).toFixed(1).padStart(4,'0')}`;
    $('sub').textContent=`${stamp(end/1000+1/fps)} at ${fps} fps · MediaPipe Pose (${rec.model}) on every frame · each panel shows the same moment`;
    window.__draw=async(t,label)=>{
      const i=Math.min(frames.length-1,Math.round(t*fps/1000)),f=frames[i];
      const bitmap=await createImageBitmap(await (await fetch(`/__local/frames/${String(i).padStart(4,'0')}.jpg`)).blob());
      video.fillStyle='#162230';video.fillRect(0,0,400,540);video.drawImage(bitmap,cx,cy,cw,ch,0,0,400,540);bitmap.close();
      const rt=Math.min(motion.duration*1000,t);viewer.show(null,motion.sample(rt/1000),{bodyAligned:false});
      lm.fillStyle='#162230';lm.fillRect(0,0,400,540);
      const ok=k=>A.visible(f,k);let n=0;
      if(f.image){n=f.image.filter((_,k)=>ok(k)).length;lm.lineWidth=4;lm.strokeStyle='#8fd2ff';
        for(const [a,b] of BONES)if(ok(a)&&ok(b)){lm.beginPath();lm.moveTo(...toPanel(f.image[a]));lm.lineTo(...toPanel(f.image[b]));lm.stroke();}
        lm.fillStyle='#ffffff';for(let k=0;k<33;k++)if(ok(k)){lm.beginPath();lm.arc(...toPanel(f.image[k]),4,0,7);lm.fill();}}
      lm.fillStyle='#c7d6e9';lm.font='14px system-ui';lm.fillText(`${n}/33 landmarks drawn`,12,526);
      $('fill').style.width=`${t/end*100}%`;$('clock').textContent=`Video ${stamp(t/1000)} / ${stamp(end/1000)} · ${label}`;$('ref').textContent=`3D animation ${stamp(rt/1000)}`;
      return {frame:i,landmarks:n};
    };
    return {end,frames:frames.length,crop:[cx,cy,cw,ch].map(Math.round)};
  },{movement,fps});
  const ff=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','-','-c:v','libx264','-preset','medium','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',out],{stdio:['pipe','inherit','inherit']});
  let count=0;
  for(const speed of speeds)for(let k=0;;k++){
    const t=k*1000/fps*speed;if(t>info.end+1e-6)break;
    await page.evaluate(([t,l])=>window.__draw(t,l),[t,`${speed}× speed`]);
    const jpg=await page.screenshot({type:'jpeg',quality:90});if(!ff.stdin.write(jpg))await new Promise(r=>ff.stdin.once('drain',r));count++;
  }
  ff.stdin.end();await new Promise((res,rej)=>ff.on('close',c=>c?rej(new Error(`ffmpeg ${c}`)):res()));
  console.log(JSON.stringify({out,outputFrames:count,...info,pageErrors:errors}));
  if(errors.length)process.exitCode=1;
}finally{await browser.close();}
