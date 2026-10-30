// Read-only analysis of saved landmarks. Times remain in the recording's original millisecond clock.
// Thresholds are conservative review heuristics, not a dance classifier or a calibrated accuracy score.
export const JOINTS = [
  { name: 'left elbow', ids: [11, 13, 15], cue: ['bend your left elbow a little more', 'open your left elbow a little more'] },
  { name: 'right elbow', ids: [12, 14, 16], cue: ['bend your right elbow a little more', 'open your right elbow a little more'] },
  { name: 'left knee', ids: [23, 25, 27], cue: ['soften your left knee a little more', 'straighten your left knee a little more'] },
  { name: 'right knee', ids: [24, 26, 28], cue: ['soften your right knee a little more', 'straighten your right knee a little more'] },
  { name: 'left upper arm', ids: [23, 11, 13], cue: ['bring your left upper arm closer to your side', 'lift your left upper arm farther from your side'] },
  { name: 'right upper arm', ids: [24, 12, 14], cue: ['bring your right upper arm closer to your side', 'lift your right upper arm farther from your side'] },
  { name: 'left hip', ids: [11, 23, 25], cue: ['bring your left thigh a little closer to your torso', 'open the angle between your left thigh and torso'] },
  { name: 'right hip', ids: [12, 24, 26], cue: ['bring your right thigh a little closer to your torso', 'open the angle between your right thigh and torso'] },
];
export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32]];
const xyz = p => Array.isArray(p) ? p.slice(0,3) : p && [p.x,p.y,p.z];
const finite = p => p?.length === 3 && p.every(Number.isFinite);
const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((v,x,i) => v+x*b[i],0);
const length = a => Math.hypot(...a);
const mid = (a,b) => a.map((v,i) => (v+b[i])/2);
export const median = a => { const s = a.filter(Number.isFinite).sort((a,b)=>a-b); return s.length ? s[s.length>>1] : null; };
export const relativeSeconds = (t, frames) => (t - (frames[0]?.t ?? 0)) / 1000;
export function visible(frame, i) {
  if (!finite(xyz(frame?.world?.[i]))) return false;
  if (frame.reference) return true;
  const p = frame.image?.[i], v = Array.isArray(p) ? p[3] : p?.visibility;
  const x = Array.isArray(p) ? p[0] : p?.x, y = Array.isArray(p) ? p[1] : p?.y;
  return Number.isFinite(v) && v >= .7 && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}
export function angle(a,b,c) {
  const u=sub(a,b), v=sub(c,b), d=length(u)*length(v);
  return d > 1e-8 ? Math.acos(Math.max(-1,Math.min(1,dot(u,v)/d)))*180/Math.PI : null;
}
const LEG_JOINTS = [2,3,6,7];
// Ankle separation is a coarse foot-placement proxy, not toe direction or contact with the floor.
// Normalize by each body's own leg lengths so a taller dancer is not asked to take a smaller step.
export function footSpacing(frame) {
  const ids=[23,24,25,26,27,28],valid=i=>frame.valid?.[i]??visible(frame,i);
  if(!ids.every(valid))return null;
  const p=i=>xyz(frame.world[i]),dist=(a,b)=>length(sub(p(a),p(b)));
  const size=(dist(23,25)+dist(25,27)+dist(24,26)+dist(26,28))/2;
  return size>1e-8 ? dist(27,28)/size : null;
}
export function prepareFrames(frames) {
  let last=-Infinity;
  const clean=frames.filter(f => { if (!Number.isFinite(f.t) || f.t<=last) return false; last=f.t; return true; });
  const lengths=BONES.map(([a,b])=>median(clean.filter(f=>visible(f,a)&&visible(f,b)).map(f=>length(sub(xyz(f.world[a]),xyz(f.world[b]))))));
  return clean.map((f,k)=>{
    const valid=Array.from({length:33},(_,i)=>visible(f,i));
    // Reject implausible limb-length jumps and single-frame position discontinuities; never turn them into cues.
    BONES.forEach(([a,b],j)=>{
      if (!valid[a]||!valid[b]||!lengths[j]) return;
      const ratio=length(sub(xyz(f.world[a]),xyz(f.world[b])))/lengths[j];
      if (ratio<.55||ratio>1.65) valid[a]=valid[b]=false;
    });
    const prev=clean[k-1], dt=prev && (f.t-prev.t)/1000;
    if (!f.reference && dt>0 && dt<.2) valid.forEach((v,i)=>{
      if (v && visible(prev,i) && length(sub(xyz(f.world[i]),xyz(prev.world[i])))/dt>6) valid[i]=false;
    });
    const values=JOINTS.map(({ids})=>ids.every(i=>valid[i]) ? angle(...ids.map(i=>xyz(f.world[i]))) : null);
    const prepared={...f,valid,values};
    return {...prepared,footSpacing:footSpacing(prepared)};
  });
}
// Nearest actual sample only: do not invent motion across occlusion or a dropped-frame gap.
export function frameAt(frames,t,tolerance=100) {
  let lo=0,hi=frames.length;
  while(lo<hi){const m=(lo+hi)>>1;if(frames[m].t<t)lo=m+1;else hi=m;}
  const f=[frames[lo-1],frames[lo]].filter(Boolean).sort((a,b)=>Math.abs(a.t-t)-Math.abs(b.t-t))[0];
  return f && Math.abs(f.t-t)<=tolerance ? f : null;
}
export function sampleFrames(frames,start,end,step=100) {
  const times=[];
  for(let t=start;t<end;t+=step)times.push(t);
  times.push(end); // Preserve the phrase duration, including a final partial sample interval.
  return times.map(t=>{const f=frameAt(frames,t);return f ? {...f,t,sourceT:f.t} : {t,values:JOINTS.map(()=>null),valid:[]};});
}
const distance=(a,b,focus)=>{
  const shared=i=>Number.isFinite(a.values[i])&&Number.isFinite(b.values[i]);
  // Both knees (including ankles) and at least one hip must be measured. Visible arms cannot stand in for legs.
  if(focus==='legs'&&(![2,3].every(shared)||LEG_JOINTS.filter(shared).length<3))return null;
  const ds=a.values.map((v,i)=>shared(i)?[Math.abs(v-b.values[i]),focus==='legs'&&!LEG_JOINTS.includes(i)?.1:1]:null).filter(Boolean);
  return ds.length>=(focus==='legs'?3:4) ? ds.reduce((s,[d,w])=>s+d*w,0)/ds.reduce((s,[,w])=>s+w,0)/90 : null;
};
// Knee bends from measured samples only (knee angle below 135° for at least 200 ms by default). A coarse,
// alignment-free marker of which leg moves when; it does not establish lift height, foot contact or weight transfer.
export function legEvents(samples,threshold=135,{minSamples=3,minMs=200}={}) {
  const events=[];
  for(const [side,k] of [['left',2],['right',3]]){
    let run=[];const flush=()=>{
      if(run.length>=minSamples&&run.at(-1).t-run[0].t>=minMs){const peak=run.reduce((a,b)=>b.v<a.v?b:a);
        events.push({side,start:run[0].t,end:run.at(-1).t,t:peak.t,peak:peak.i,kneeMin:peak.v});}
      run=[];
    };
    samples.forEach((f,i)=>{const v=f.values?.[k];if(Number.isFinite(v)&&v<threshold)run.push({t:f.t,i,v});else flush();});flush();
  }
  return events.sort((a,b)=>a.t-b.t);
}
// Stillness at a phrase edge pins the reference's opening or closing motion to a pose the user holds before
// starting (or after finishing); DTW endpoints are assumed, not measured. Count samples at each edge that stay
// near the edge pose (3-sample median, so one noisy frame does not end the count).
const LATERAL=[1,0,3,2,5,4,7,6];
export function settledEdges(user,focus='whole',tolerance=12) {
  const channels=focus==='legs'?LEG_JOINTS:JOINTS.map((_,k)=>k),n=user.length;
  const smooth=user.map((_,i)=>channels.map(k=>median(user.slice(Math.max(0,i-1),i+2).map(f=>f.values?.[k]))));
  const count=order=>{
    const base=channels.map((_,c)=>median(order.slice(0,5).map(i=>smooth[i][c])));let k=0;
    for(const i of order){const shared=channels.map((_,c)=>[smooth[i][c],base[c]]).filter(([v,b])=>Number.isFinite(v)&&Number.isFinite(b));
      if(shared.length<(focus==='legs'?3:4)||shared.some(([v,b])=>Math.abs(v-b)>tolerance))break;k++;}
    return k;
  };
  const forward=[...Array(n).keys()],lead=count(forward);
  return {lead,trail:lead===n?0:count(forward.reverse())};
}
// Reference motion matched onto the user's settled edge: the largest change of any compared channel.
function pinnedMotion(edge,path,reference,focus) {
  const js=path.filter(([i])=>edge(i)).map(([,j])=>j);if(js.length<2)return 0;
  const channels=focus==='legs'?LEG_JOINTS:JOINTS.map((_,k)=>k);
  return Math.max(0,...channels.map(k=>{const vs=js.map(j=>reference[j].values[k]).filter(Number.isFinite);return vs.length?Math.max(...vs)-Math.min(...vs):0;}));
}
// Banded dynamic time warping: joint angles remove body size and global camera rotation; a monotone path
// allows local tempo differences. A 25% band and non-diagonal penalty limit arbitrary pose matching.
export function align(user,reference,{focus='whole',control=false}={}) {
  const n=user.length,m=reference.length, empty={supported:false,path:[],coverage:0,errorDeg:null,focus,reason:focus==='legs'?'Not enough visible hips, knees and ankles for leg alignment.':'Not enough visible landmarks for alignment.'};
  if(n<8||m<8) return empty;
  const ratio=(user.at(-1).t-user[0].t)/(reference.at(-1).t-reference[0].t);
  if(ratio<.5||ratio>2) return {...empty,reason:'Choose one reference-length phrase (half to twice the reference duration).'};
  const dp=Array.from({length:n},()=>new Float64Array(m).fill(Infinity));
  const back=Array.from({length:n},()=>new Int8Array(m).fill(-1));
  for(let i=0;i<n;i++)for(let j=0;j<m;j++){
    if(Math.abs(i/(n-1)-j/(m-1))>.25)continue;
    const d=distance(user[i],reference[j],focus), cost=d??.8;
    if(!i&&!j){dp[i][j]=cost;continue;}
    const choices=[i&&j?dp[i-1][j-1]:Infinity,i?dp[i-1][j]+.08:Infinity,j?dp[i][j-1]+.08:Infinity];
    const best=Math.min(...choices);dp[i][j]=cost+best;back[i][j]=choices.indexOf(best);
  }
  if(!Number.isFinite(dp[n-1][m-1]))return empty;
  const path=[];let i=n-1,j=m-1;
  while(i>=0&&j>=0){path.push([i,j]);if(!i&&!j)break;const d=back[i][j];if(d===0){i--;j--;}else if(d===1)i--;else if(d===2)j--;else break;}
  path.reverse();
  const seen=new Set(path.filter(([i,j])=>distance(user[i],reference[j],focus)!=null).map(([i])=>i));
  const coverage=seen.size/n, errors=path.map(([i,j])=>distance(user[i],reference[j],focus)).filter(x=>x!=null);
  const errorDeg=errors.length ? errors.reduce((a,b)=>a+b,0)/errors.length*90 : null;
  // Still poses must not be reported as detected dances, even when near the reference's average pose.
  const dynamic=JOINTS.filter((_,k)=>{
    if(focus==='legs'&&!LEG_JOINTS.includes(k))return false;
    const vs=user.map(f=>f.values[k]).filter(v=>v!=null).sort((a,b)=>a-b);
    return vs.length>=8 && vs[Math.floor(vs.length*.9)]-vs[Math.floor(vs.length*.1)]>15;
  }).length>=2;
  let gap=0,maxGap=0;user.forEach((_,i)=>{gap=seen.has(i)?0:gap+1;maxGap=Math.max(gap,maxGap);});
    // Reject a match that spends a cue-sized reference movement (≥25°) on the user standing still at an edge.
  const edges=settledEdges(user,focus);
  edges.pinnedDeg=Math.max(pinnedMotion(i=>i<edges.lead,path,reference,focus),pinnedMotion(i=>i>=n-edges.trail,path,reference,focus));
  const still=edges.pinnedDeg>=25;
  let supported=coverage>=.7&&errorDeg<32&&dynamic&&maxGap<=3&&!still;
  let reason=supported ? 'Approximate pose alignment; this does not identify a dance or prove the intended timing.'
    : maxGap>3||coverage<.7 ? 'Visibility gaps make this alignment uncertain; no cue is inferred.' : !dynamic ? 'Too little sustained movement to compare a dance phrase.'
    : still ? 'This range starts or ends while you are still, so the reference’s opening or closing would be matched to standing. Start the range where your movement starts; no cue is inferred.'
    : 'The sequences differ too much to infer a reliable phase match; no cue is inferred.';
  let phaseMarginDeg=null,phaseRanges=null,lateral=null,mirrorMarginDeg=null;
  if(supported&&!control){
    // Similar average poses can fit even an out-of-order dance. This rejection margin is not a probability.
    const reversed=reference.map((f,k)=>({...reference[m-1-k],t:f.t}));
    const alternative=align(user,reversed,{focus,control:true});
    phaseMarginDeg=alternative.errorDeg==null?0:alternative.errorDeg-errorDeg;
    if(phaseMarginDeg<3){supported=false;reason='Phase uncertain: reversing the reference fits almost as well. Replay is available, but no timing-specific cue is inferred.';}
    else {
      // A cue must survive all reference times on near-optimal complete paths, not just the cheapest path.
      const suffix=Array.from({length:n},()=>new Float64Array(m).fill(Infinity));
      for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--){
        if(!Number.isFinite(dp[i][j]))continue;
        const cost=distance(user[i],reference[j],focus)??.8;
        suffix[i][j]=cost+(i===n-1&&j===m-1?0:Math.min(
          i+1<n&&j+1<m?suffix[i+1][j+1]:Infinity,i+1<n?suffix[i+1][j]+.08:Infinity,j+1<m?suffix[i][j+1]+.08:Infinity));
      }
      const slack=Math.max(.18,dp[n-1][m-1]*.025);
      phaseRanges=user.map((f,i)=>reference.map((r,j)=>j).filter(j=>
        dp[i][j]+suffix[i][j]-(distance(f,reference[j],focus)??.8)<=dp[n-1][m-1]+slack));
    }
  }
  if(supported&&!control){
    // A dancer facing the screen may copy the demo as a mirror. Left/right cues need the direct sides to fit
    // clearly better than swapped sides; foot spacing is symmetric and unaffected.
    const swapped=reference.map(f=>({...f,values:LATERAL.map(k=>f.values[k])}));
    const mirrored=align(user,swapped,{focus,control:true});
    mirrorMarginDeg=mirrored.errorDeg==null?Infinity:mirrored.errorDeg-errorDeg;
    lateral=mirrorMarginDeg>=3?'direct':mirrorMarginDeg<=-3&&mirrored.supported?'mirrored':'ambiguous';
    if(lateral!=='direct'){supported=false;reason=lateral==='mirrored'
      ?'Your movement fits the reference’s mirror image better than its own left and right. Try Mirror display; no timing-specific cue is inferred.'
      :'Side uncertain: swapping left and right fits almost as well. Replay is available, but no timing-specific cue is inferred.';}
  }
  let conflicts=[];
  if(supported&&!control){
    // Independent of the angle cost: every clearly measured knee bend must land on a same-side bend of the reference.
    const refEvents=legEvents(reference);
    conflicts=legEvents(user).filter(e=>{
      const js=path.filter(([i])=>i===e.peak).map(([,j])=>j),rt=reference[js[js.length>>1]]?.t;
      return !refEvents.some(r=>r.side===e.side&&rt>=r.start-300&&rt<=r.end+300);
    }).map(e=>({...e,referenceT:mappedTime(e.t,user,reference,path)}));
    if(conflicts.length){supported=false;const c=conflicts[0];
      reason=`Timing conflict: this match places your measured ${c.side} knee bend where the reference’s ${c.side} leg is straight. Replay is available, but no timing-specific cue is inferred.`;}
  }
  return {supported,path,coverage,errorDeg,ratio,focus,reason,phaseMarginDeg,phaseRanges,lateral,mirrorMarginDeg,edges,conflicts};
}
export function differences(user,reference,result) {
  if(!result.supported)return [];
  const rows=[];
  const metrics=JOINTS.map((joint,k)=>({...joint,threshold:25,value:f=>f.values[k],kind:'angle'}))
    .filter((_,k)=>result.focus!=='legs'||[2,3].includes(k))
    // Left/right wording is withheld unless the direct sides fit clearly better than a mirrored copy.
    .filter(joint=>!result.lateral||result.lateral==='direct'||!/^(left|right) /.test(joint.name));
  if(result.focus==='legs')metrics.push({name:'foot spacing',ids:[23,24,25,26,27,28],threshold:.2,kind:'spacing',
    value:f=>f.footSpacing,cue:['bring your feet a little closer together','take a slightly wider step']});
  metrics.forEach(joint=>{
    let run=[];const flush=()=>{
      if(new Set(run.map(x=>x.sourceT)).size>=(joint.kind==='spacing'?5:4)&&run.at(-1).t-run[0].t>=(joint.kind==='spacing'?400:300)){
        const d=median(run.map(x=>x.delta)), at=run[run.length>>1];
        rows.push({part:joint.name,ids:joint.ids,start:run[0].t,end:run.at(-1).t,t:at.t,referenceT:at.rt,
          kind:joint.kind,userValue:at.u,referenceValue:at.r,userAngle:Math.round(at.u/5)*5,referenceAngle:Math.round(at.r/5)*5,
          delta:d,strength:Math.abs(d)/joint.threshold,cue:`To try the reference, ${joint.cue[d>0?0:1]}.`});
      }run=[];
    };
    // One observation per user sample: a horizontal DTW run is not extra evidence.
    const by=new Map();for(const [i,j] of result.path){const a=by.get(i)??[];a.push(j);by.set(i,a);}
    // Only samples inside the user's own movement, and not at the assumed endpoints, can carry a cue.
    const n=user.length,lo=Math.max(3,result.edges?.lead??0),hi=n-1-Math.max(3,result.edges?.trail??0);
    for(const [i,js] of by){if(i<lo||i>hi){flush();continue;}const j=js[js.length>>1],u=joint.value(user[i]),r=joint.value(reference[j]),delta=Number.isFinite(u)&&Number.isFinite(r)?u-r:null;
      const plausible=result.phaseRanges?.[i]??js;
      const stable=plausible.length&&plausible.every(k=>{const v=joint.value(reference[k]);return Number.isFinite(v)&&Math.sign(u-v)===Math.sign(delta)&&Math.abs(u-v)>=joint.threshold;});
      if(delta==null||Math.abs(delta)<joint.threshold||!stable){flush();continue;}
      if(run.length&&(Math.sign(delta)!==Math.sign(run[0].delta)||user[i].t-run.at(-1).t>160))flush();
      run.push({t:user[i].t,sourceT:user[i].sourceT??user[i].t,rt:reference[j].t,u,r,delta});
    }flush();
  });
  return rows.sort((a,b)=>b.strength-a.strength).filter((x,i,all)=>all.findIndex(y=>y.part===x.part)===i).slice(0,result.focus==='legs'?2:3);
}
export function mappedTime(t,user,reference,path) {
  if(!path.length)return null;
  const mapping=new Map();for(const [i,j] of path){const xs=mapping.get(i)??[];xs.push(j);mapping.set(i,xs);}
  const knots=[...mapping].map(([i,js])=>[user[i].t,reference[js[js.length>>1]].t]);
  let i=knots.findIndex(x=>x[0]>=t);if(i<0)return knots.at(-1)[1];if(i===0)return knots[0][1];
  const a=knots[i-1],b=knots[i],p=(t-a[0])/(b[0]-a[0]);return a[1]+p*(b[1]-a[1]);
}
export function activeDifference(finding,t,alignment) {
  return alignment?.supported&&finding&&t>=finding.start&&t<=finding.end ? finding : null;
}
// Replay the measured points, not a generated body animation. Hip centering removes unmeasured travel;
// a single torso scale preserves the recorded limb proportions. Mirroring changes display x, not anatomy labels.
export function replayPose(frame,{bodyAligned=true,mirror=false,scale=null}={}) {
  if(!frame)return Array(33).fill(null);
  const valid=i=>frame.valid?.[i]??visible(frame,i), p=frame.world?.map(xyz);
  if(!p||![11,12,23,24].every(i=>valid(i)))return Array(33).fill(null);
  const hip=mid(p[23],p[24]),shoulder=mid(p[11],p[12]);
  const size=scale??length(sub(shoulder,hip));if(size<.1)return Array(33).fill(null);
  const across=sub(p[11],p[12]),yaw=bodyAligned?Math.atan2(-across[2],across[0]):0;
  return p.map((q,i)=>{
    if(!valid(i))return null;const [x,y,z]=sub(q,hip).map(v=>v/size),c=Math.cos(yaw),s=Math.sin(yaw);
    return [(mirror?-1:1)*(x*c-z*s),-y,-(x*s+z*c)];
  });
}
export function torsoScale(frames) {
  return median(frames.filter(f=>[11,12,23,24].every(i=>f.valid?.[i]??visible(f,i)))
    .map(f=>length(sub(mid(xyz(f.world[11]),xyz(f.world[12])),mid(xyz(f.world[23]),xyz(f.world[24]))))));
}
export function reviewWindows(recording,movement,recovered=[]) {
  const frames=recording.frames??[],lo=frames[0]?.t??0,hi=frames.at(-1)?.t??0;
  const attempts=(recording.attempts??[]).filter(a=>a.movement===movement&&Number.isFinite(a.start)&&Number.isFinite(a.end??hi))
    .map(a=>({start:Math.max(lo,a.start),end:Math.min(hi,a.end??hi),attempt:a.id,provenance:'saved attempt'}));
  if(recording.attempts?.length)return attempts.filter(x=>x.end>x.start&&!attempts.some(y=>y!==x&&Math.max(x.start,y.start)<Math.min(x.end,y.end)));
  if(recording.movementIntervals?.some(x=>x.movement===movement))return recording.movementIntervals
    .filter(x=>x.movement===movement&&x.end>x.start).map(x=>({...x,attempt:null,provenance:'saved activity; restart boundaries unknown'}));
  return recovered.filter(x=>x.movement===movement&&x.end>x.start).map(x=>({...x,provenance:'estimated activity; restart unknown'}));
}
export function candidateWindows(frames,reference,windows,options={}) {
  if(reference.length<8)return [];
  const duration=reference.at(-1).t-reference[0].t,candidates=[];
  for(const w of windows){
    const own=frames.filter(f=>f.t>=w.start&&f.t<=w.end);
    for(const rate of [.75,1,1.25,1.5])for(let start=w.start;start+duration*rate<=w.end;start+=250){
      const end=start+duration*rate,user=sampleFrames(own,start,end),result=align(user,reference,options);
      if(result.supported)candidates.push({start,end,result,score:result.errorDeg+(1-result.coverage)*30,provenance:w.provenance,attempt:w.attempt});
    }
  }
  candidates.sort((a,b)=>a.score-b.score);const distinct=[];
  for(const c of candidates){
    if(distinct.some(x=>Math.max(0,Math.min(x.end,c.end)-Math.max(x.start,c.start))>=.6*Math.min(x.end-x.start,c.end-c.start)))continue;
    distinct.push(c);if(distinct.length===3)break;
  }
  for(const c of distinct)c.ambiguous=distinct.some(x=>x!==c&&x.score<c.score+3);
  return distinct;
}
export function suggestWindow(frames,reference,windows,options={}) {return candidateWindows(frames,reference,windows,options)[0]??null;}

export function reviewAttempts(frames,reference,windows,options={}) {
  return windows.map(window=>{
    const own=frames.filter(f=>f.t>=window.start&&f.t<=window.end);
    const visibleFrames=own.filter(f=>[23,24,25,26,27,28].every(i=>f.valid?.[i]??visible(f,i))).length;
    return {...window,frameCount:own.length,visibleFrames,coverage:own.length?visibleFrames/own.length:0,
      candidates:candidateWindows(own,reference,[window],options)};
  });
}
