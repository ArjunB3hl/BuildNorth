// Run the page's own MediaPipe Pose Landmarker (VIDEO mode) over decoded video frames and save a recording JSON in
// the live format: {t (video ms), image [x,y,z,visibility], world [x,y,z]}. Frames are read in order, one each;
// a frame without a detected person stays empty (no interpolation).
// node tools/extract_video_pose.mjs <frames-dir with 0000.jpg…> <fps> <width> <height> <out.json> [model]
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.RHYTHM_PLAYWRIGHT||'playwright');
const base=process.env.RHYTHM_REVIEW_URL||'http://127.0.0.1:8765';
const [dir,fps,width,height,out,model='heavy']=process.argv.slice(2);
const files=(await fs.readdir(dir)).filter(f=>/^\d+\.jpg$/.test(f)).sort();
const browser=await chromium.launch({headless:true,...(process.env.RHYTHM_CHROMIUM?{executablePath:process.env.RHYTHM_CHROMIUM}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(u.pathname==='/web/__extract.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'});
  if(u.pathname.startsWith('/__frames/'))return route.fulfill({contentType:'image/jpeg',body:await fs.readFile(`${dir}/${u.pathname.slice(10)}`)});
  if(u.origin!==base||!['GET','HEAD'].includes(r.method()))return route.abort();return route.continue();});
try{
  await page.goto(`${base}/web/__extract.html`);
  const result=await page.evaluate(async({files,fps,model})=>{
    const {createPose,detect}=await import('/web/js/pose.js'),pose=await createPose({model,delegate:'CPU'}),frames=[];
    for(const [i,f] of files.entries()){
      const bitmap=await createImageBitmap(await (await fetch(`/__frames/${f}`)).blob()),t=Math.round(i*1000/fps*1000)/1000;
      const {image,world}=detect(pose.landmarker,bitmap,t);bitmap.close();
      frames.push({t,image:image?.map(p=>[p.x,p.y,p.z,p.visibility]).map(a=>a.map(v=>Math.round(v*1e4)/1e4))??null,
        world:world?.map(p=>[p.x,p.y,p.z].map(v=>Math.round(v*1e4)/1e4))??null});
    }
    return {frames,delegate:pose.delegate,model:pose.model};
  },{files,fps:Number(fps),model});
  const recording={id:out.split('/').pop().replace(/\.json$/,''),source:'video',model:result.model,delegate:result.delegate,
    timestampUnit:'milliseconds',timestampOrigin:'video time',width:Number(width),height:Number(height),frames:result.frames,events:[]};
  await fs.writeFile(out,JSON.stringify(recording));
  console.log(JSON.stringify({frames:result.frames.length,withPose:result.frames.filter(f=>f.world).length,model:result.model,delegate:result.delegate,errors}));
}finally{await browser.close();}
