import { prepareFrames, sampleFrames, align, differences, frameAt, mappedTime, reviewWindows, reviewAttempts, suggestWindow, torsoScale, relativeSeconds, visible, activeDifference } from './review-analysis.js';
import { parseRecording } from './review-recording.js';
import { recoverIntervals, loadMovementModule } from './movement-review.js';
import { anchoredReview, anchoredResult } from './review-legs.js';

// Independent of camera/model/coach initialization: a failed live tracker must not prevent saved-pose review.
if (new URLSearchParams(location.search).get('review') === '1' && document.documentElement.dataset.hosted !== 'true') {
  const $=id=>document.getElementById(id),state={generation:0,playing:false,time:0,finding:null,files:new Map(),fileSerial:0};
  const stamp=s=>`${Math.floor(Math.max(0,s)/60)}:${(Math.max(0,s)%60).toFixed(1).padStart(4,'0')}`;
  const status=text=>{$('reviewStatus').textContent=text;};
  const json=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`Could not load ${url} (${r.status}).`);return r.json();};
  const option=(text,value)=>new Option(text,value);
  const rel=t=>relativeSeconds(t,state.frames);
  const focus=()=>({focus:$('reviewFocus').value});
  const pause=()=>{state.playing=false;$('reviewPlay').textContent='Play phrase';};
  $('movementReview').hidden=false;
  function show(){
    if(!state.viewer||!state.result)return;
    const rt=state.result.supported?mappedTime(state.time,state.sample,state.reference,state.result.path)
      :(state.time-state.start)/(state.end-state.start)*state.motion.duration*1000;
    const f=frameAt(state.phraseFrames??state.frames,state.time,80),ref=state.motion.sample(rt/1000);
    const finding=activeDifference(state.finding,state.time,state.result),part=finding?.ids??[];
    state.viewer.show(f,ref,{bodyAligned:$('reviewAligned').checked,mirror:$('reviewMirror').checked,scales:state.scales,part,landmarks:$('reviewView').value==='landmarks'});
    $('reviewActiveCue').hidden=!finding;
    $('reviewActiveCue').textContent=finding?`${finding.part} · ${finding.cue} ${state.result.anchored?'Timing anchored by your knee bends.':'Approximate phase match.'}`:'';
    $('reviewScrub').value=String((state.time-state.start)/(state.end-state.start));
    $('reviewReadout').textContent=`You ${stamp(rel(state.time))} · reference ${ref?stamp(rt/1000):'unavailable'}${ref&&!state.result.supported?' · timing unverified':''}${f?.world?'':' · pose unavailable'}`;
  }
  function fields(start,end){$('reviewFrom').value=rel(start).toFixed(3);$('reviewTo').value=rel(end).toFixed(3);}
  function showAttempts(){
    state.audits=reviewAttempts(state.frames,state.reference,state.windows,focus());
    $('reviewAttempts').replaceChildren();
    state.audits.forEach((a,i)=>{
      const card=document.createElement('article');card.className='review-attempt';
      const title=document.createElement('b');title.textContent=`${a.attempt!=null?'Attempt '+a.attempt:'Activity '+(i+1)} · ${stamp(rel(a.start))}–${stamp(rel(a.end))}`;
      const detail=document.createElement('p');detail.textContent=`Hips, knees and ankles usable in ${a.visibleFrames}/${a.frameCount} saved frames. ${!a.candidates.length?'No distinguishable reference phase found; inspect the landmarks without a correction.':a.candidates[0].ambiguous?'Several plausible phrases. Select one to inspect; the intended phase is uncertain.':'Candidate phrase found; verify that this is the movement you intended.'}`;
      card.append(title,detail);
      for(const [k,c] of a.candidates.entries()){
        const button=document.createElement('button');button.textContent=`Inspect ${stamp(rel(c.start))}–${stamp(rel(c.end))}`;
        button.onclick=()=>{$('reviewWindow').value=String(i);fields(c.start,c.end);compare();status(`Attempt ${a.attempt??i+1}, candidate ${k+1}. ${c.ambiguous?'Other phrases fit similarly; intended phase is uncertain.':'Approximate phase only; cues are optional ways to try the reference.'}`);};card.append(button);
      }
      const anchored=state.anchored?.[i];
      if(anchored&&$('reviewFocus').value==='legs'){
        const bends=document.createElement('p');const sides=s=>anchored.userBends.filter(b=>b.side===s).length;
        bends.textContent=`Measured knee bends: ${sides('left')} left, ${sides('right')} right. ${anchored.phrases.length?`${anchored.phrases.length} phrase${anchored.phrases.length>1?'s follow':' follows'} the reference’s knee-bend order and turn.`:'None follows the reference’s knee-bend order and turn.'}`;
        card.append(bends);
        for(const p of anchored.phrases){
          const button=document.createElement('button');button.textContent=`Inspect ${p.mirrored?'mirrored ':''}bend-order phrase ${stamp(rel(p.start))}–${stamp(rel(p.end))}`;
          button.onclick=()=>{$('reviewWindow').value=String(i);fields(p.start,p.end);compare(p);status(`Attempt ${a.attempt??i+1}: timing anchored by your measured knee bends. ${p.mirrored?'Mirrored order: no left/right cue.':'Check the replay; cues are optional ways to try the reference.'}`);};card.append(button);
        }
      }
      if(!a.candidates.length){const button=document.createElement('button');button.textContent='Replay attempt';button.onclick=()=>{$('reviewWindow').value=String(i);fields(a.start,a.end);compare();};card.append(button);}
      $('reviewAttempts').append(card);
    });
  }
  function compare(anchor=null){
    if(!state.frames)return;
    pause();const origin=state.frames[0].t,start=origin+Number($('reviewFrom').value)*1000,end=origin+Number($('reviewTo').value)*1000;
    function invalid(message){status(message);state.result=null;state.viewer?.show(null,null);$('reviewActiveCue').hidden=true;$('reviewFindings').replaceChildren();$('reviewAlignment').textContent='No comparison for this range.';$('reviewReadout').textContent='';$('reviewPlay').disabled=true;$('reviewScrub').disabled=true;}
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<origin||end>state.frames.at(-1).t+100){invalid('Choose a valid time range inside this recording.');return;}
    if(state.attempts.length && !state.attempts.some(a=>start>=a.start&&end<=a.end)){invalid('Choose a phrase within one saved attempt; comparisons cannot cross a restart.');return;}
    $('reviewPlay').disabled=false;$('reviewScrub').disabled=false;
    state.start=start;state.end=Math.min(end,state.frames.at(-1).t);state.time=start;state.finding=null;
    const own=state.frames.filter(f=>f.t>=start&&f.t<=state.end);
    state.phraseFrames=own;
    state.sample=sampleFrames(own,start,state.end);
    // A bend-order phrase keeps its own timing map; a DTW phrase is checked separately. Neither is a recognizer.
    if(anchor&&focus().focus!=='legs')anchor=null;
    state.result=anchor?anchoredResult(state.sample,state.reference,anchor,state.motion.duration*1000):align(state.sample,state.reference,focus());
    const r=state.result,rows=anchor?anchor.findings:differences(state.sample,state.reference,r);
    $('reviewAlignment').textContent=`${r.focus==='legs'?'Feet and legs focus: knees and hips drive the timing match; arms provide light context. ':''}${r.reason} ${Math.round(r.coverage*100)}% of this phrase has enough shared visible ${r.focus==='legs'?'hips, knees and ankles':'joints'}.${r.supported?` The reference is time-warped to your pace (phrase duration ${r.ratio.toFixed(2)}× reference).`:' Reference plays proportionally for visual inspection only; it is not a verified match.'}${r.focus==='legs'?' Foot spacing uses ankle separation relative to leg length. Foot contact, weight transfer and toe direction are not assessed.':''}`;
    if(state.referenceError)$('reviewAlignment').textContent='Reference unavailable. Your saved landmarks can still be replayed; no alignment or correction is inferred.';
    $('reviewFindings').replaceChildren();
    for(const x of rows){const card=document.createElement('article');card.className='review-finding';const title=document.createElement('b');title.textContent=`${x.part} · you ${stamp(rel(x.t))}`;
      const detail=document.createElement('p');detail.textContent=x.kind==='anchored'
        ? `On the matched ${x.ordinal===2?'second ':''}${x.part.split(' ')[0]} knee bend, your knee closes to about ${x.userAngle}° vs ${x.referenceAngle}° in the reference at ${stamp(x.referenceT/1000)}, and your foot rises about ${(x.userRise*100).toFixed(0)}% of your leg length above the other ankle vs ${(x.referenceRise*100).toFixed(0)}%. Foot height uses the camera image, not depth. Bend measured ${stamp(rel(x.start))}–${stamp(rel(x.end))}.`
        : x.kind==='spacing'
        ? `Your ankles are ${x.delta>0?'farther apart':'closer together'}: approximately ${(x.userValue*100).toFixed(0)}% of your leg length vs ${(x.referenceValue*100).toFixed(0)}% in the reference at ${stamp(x.referenceT/1000)}. Sustained over ${stamp(rel(x.start))}–${stamp(rel(x.end))}. This does not establish where either foot contacts the floor.`
        : `Approximately ${x.userAngle}° in your recording vs ${x.referenceAngle}° at reference ${stamp(x.referenceT/1000)}. Sustained over ${stamp(rel(x.start))}–${stamp(rel(x.end))}.`;
      const cue=document.createElement('p');cue.textContent=`If this is the phrase you intended: ${x.cue}`;
      const button=document.createElement('button');button.textContent='Show this difference';button.onclick=()=>{pause();state.time=x.t;state.finding=x;show();$('reviewScene').scrollIntoView({behavior:'smooth',block:'center'});};card.append(title,detail,cue,button);$('reviewFindings').append(card);
    }
    if(!rows.length){const p=document.createElement('p');p.textContent=r.supported?'No sustained, clearly visible difference passed the review thresholds. This does not establish an exact match.':'Insufficient evidence for a specific cue in this phrase. Try another visible passage or inspect the two replays.';$('reviewFindings').append(p);}
    show();
  }
  function suggest(){
    if(state.referenceError){status('Reference unavailable. Load review to retry; no automatic phrase match is inferred.');return;}
    const w=state.windows[Number($('reviewWindow').value)],best=suggestWindow(state.frames,state.reference,w?[w]:state.windows,focus());
    if(best){fields(best.start,best.end);compare();status(`Suggested pose match in ${best.provenance}. ${best.ambiguous?'Other passages match similarly; the intended phase is uncertain.':'Check the replay before using the optional cues.'}`);}
    else {status('No reliable automatic match in this activity. Choose a phrase manually; no dance or restart was inferred.');}
  }
  async function load(){
    const gen=++state.generation;pause();$('loadMovementReview').disabled=true;$('reviewBody').hidden=true;status('Loading saved landmarks and the original reference animation…');
    try{
      const movement=state.library.find(m=>m.key===$('movementReference').value);
      if(!movement?.glb)throw new Error('Choose an available movement reference.');
      const [recording,{Review3D,THREE},{referenceMotion},{MovementTracker},{features}]=await Promise.all([
        state.files.get($('movementRecording').value)?.recording??json(`/api/recording?id=${encodeURIComponent($('movementRecording').value)}`),import('./review-3d.js'),import('./reference-motion.js'),loadMovementModule().catch(()=>({})),import('./engine.js')]);
      let buffer=null,motion,referenceError=null;
      try {
        const response=await fetch(`/moves/${movement.glb}`);if(!response.ok)throw new Error(`Reference GLB could not load (${response.status}).`);
        buffer=await response.arrayBuffer();motion=referenceMotion(buffer,THREE,movement.durationSec);
      } catch(e) {
        referenceError=e.message;buffer=null;
        // This duration sets only an initial user replay range. No substitute reference is generated.
        motion={duration:movement.durationSec||4,frames:[],sample:()=>null};
      }
      if(gen!==state.generation)return;
      const frames=prepareFrames(recording.frames??[]);if(frames.length<2)throw new Error('This recording has too few timestamped frames.');
      const recovered=!recording.attempts?.length&&MovementTracker?recoverIntervals(recording,movement,MovementTracker,features):{seconds:0,windows:[]};
      const windows=reviewWindows(recording,movement.key,recovered.windows),attempts=windows.filter(x=>x.provenance==='saved attempt');
      if(recording.attempts?.length&&!attempts.length)throw new Error('No valid, non-overlapping saved attempts for this movement. Restart boundaries will not be guessed.');
      if(!windows.length)windows.push({start:frames[0].t,end:frames.at(-1).t,provenance:'full recording; activity and restarts unknown'});
      Object.assign(state,{recording,frames,reference:prepareFrames(motion.frames),motion,referenceError,windows,attempts,scales:[torsoScale(frames),torsoScale(motion.frames)]});
      state.anchored=referenceError?windows.map(()=>null):windows.map(w=>anchoredReview(frames,state.reference,w,motion.duration*1000));
      showAttempts();
      $('reviewWindow').replaceChildren(...windows.map((w,i)=>option(`${stamp(rel(w.start))}–${stamp(rel(w.end))} · ${w.attempt!=null?'attempt '+w.attempt:w.provenance}`,i)));
      const best=referenceError||windows[0].provenance.startsWith('full recording')?null:state.audits.flatMap(a=>a.candidates).sort((a,b)=>a.score-b.score)[0];
      const phrases=focus().focus==='legs'?state.anchored.flatMap(x=>x?.phrases??[]).filter(p=>!p.mirrored):[],anchor=best?null:phrases.find(p=>p.findings.length)??phrases[0]??null;
      if(best){$('reviewWindow').value=String(windows.findIndex(w=>best.start>=w.start&&best.end<=w.end));fields(best.start,best.end);}
      else if(anchor){$('reviewWindow').value=String(windows.findIndex(w=>anchor.start>=w.start&&anchor.end<=w.end));fields(anchor.start,anchor.end);}
      else fields(windows[0].start,Math.min(windows[0].end,windows[0].start+motion.duration*1000));
      $('reviewBody').hidden=false;
      state.viewer??=new Review3D($('reviewScene'),{onStatus:s=>{
        $('reviewYouLabel').textContent=s.user;$('reviewReferenceLabel').textContent=s.reference;$('reviewModelStatus').textContent=s.message;
      }});
      state.viewer.show(null,null);$('reviewActiveCue').hidden=true;
      // Reuse the fetched bytes: GLTFLoader renders the mesh; referenceMotion remains the analysis sampler.
      await state.viewer.loadCharacters(buffer,{resourcePath:new URL(`/moves/${movement.glb}`,location.href).href.replace(/[^/]*$/,''),error:referenceError});
      if(gen!==state.generation)return;
      const poseCount=frames.filter(f=>f.world&&f.image).length;
      const confident=ids=>Math.round(frames.filter(f=>ids.every(i=>visible(f,i))).length/frames.length*100);
      $('reviewEvidence').replaceChildren();
      const notes=[
        `${recording.frames.length.toLocaleString()} saved frames; ${stamp(rel(frames.at(-1).t))} duration; ${poseCount.toLocaleString()} frames contain an estimated pose. ${recording.frames.length-frames.length} duplicate or invalid timestamps excluded. Times shown are seconds from the first saved frame; source timestamps are preserved.`,
        `Both knees visible with confidence ≥0.7: ${confident([25,26])}% of frames. Both ankles: ${confident([27,28])}%; both foot tips: ${confident([31,32])}%. Low-confidence, out-of-frame, missing and abrupt-jump landmarks do not produce cues. Confidence is the tracker's visibility estimate, not a measured error bound.`,
        attempts.length?`${attempts.length} saved attempt boundaries are available. Comparisons stay inside one attempt.`:`No reliable saved restart boundaries. ${MovementTracker?`Offline replay estimates ${recovered.seconds.toFixed(1)} seconds of generic activity; these intervals are not identified dances or confirmed attempts.`:'Offline activity recovery is unavailable; choose a range manually.'} Coach statements are not used as evidence.`,
        referenceError?`Reference unavailable: ${referenceError}`:`Reference: ${movement.display}, 0:00–${stamp(motion.duration)}. Its skinned character plays the original GLB animation at the aligned time. Angles reduce body-proportion and camera-rotation differences. Monotone, bounded dynamic time warping adjusts pace; repeated freestyle phrases can have several plausible alignments.`,
        'Your character is a separate Y Bot instance posed from the saved frame, with no gap filling or inferred floor. All inputs used by the body, head, hands and feet must pass the confidence checks; otherwise the user side switches to labelled landmarks. Character proportions are fixed to Y Bot. Fingers and axial limb twist are illustrative, not reconstructed. Use Saved landmarks to inspect your actual proportions.',
        'World landmarks are monocular 3D estimates. Image visibility gates each joint. Foot spacing compares ankle centers, normalized by each body’s leg lengths. The reference has toe-base bones rather than measured foot tips, so toe direction is not scored. Depth, body orientation during occlusion, foot contact, weight transfer and travel cannot be established reliably. There is no camera video or audio: musical timing, intent and historical restarts cannot be recovered.',
        'Comparison cues describe optional ways to try the reference, not incorrect dancing or medical findings. A source camera recording was displayed mirrored live; saved coordinates are not mirrored. Both replay figures use the same display transform. Original recording and library files are unchanged.',
      ];for(const text of notes){const p=document.createElement('p');p.textContent=text;$('reviewEvidence').append(p);}
      compare(anchor);status(referenceError?`${referenceError} Saved-pose replay remains available. Load review retries the model.`:best?`Suggested phrase ${stamp(rel(best.start))}–${stamp(rel(best.end))}. ${best.ambiguous?'Several passages match similarly; phase is uncertain.':'Approximate alignment; verify it visually.'} Original recording preserved.`:anchor?`Phrase ${stamp(rel(anchor.start))}–${stamp(rel(anchor.end))} follows the reference’s knee-bend order and turn. No pose-similarity match passed its checks. Original recording preserved.`:'No reliable automatic match. Inspect the selected phrase or choose another range. Original recording preserved.');
    }catch(e){status(`Review unavailable: ${e.message}`);}finally{if(gen===state.generation)$('loadMovementReview').disabled=false;}
  }
  $('loadMovementReview').onclick=load;$('reviewCompare').onclick=()=>compare();$('reviewSuggest').onclick=suggest;
  $('reviewFocus').onchange=()=>{showAttempts();compare();status('Review focus changed; all attempt candidates have been checked again.');};
  $('reviewWindow').onchange=()=>{const i=Number($('reviewWindow').value),w=state.windows[i],c=state.audits[i]?.candidates[0];fields(c?.start??w.start,c?.end??w.end);compare();status(c?`Candidate in ${w.provenance}; check the intended phase.`:'No reliable phase found. Replaying this attempt without a correction.');};
  $('reviewPlay').onclick=()=>{state.playing=!state.playing;if(state.time>=state.end)state.time=state.start;state.wall=performance.now();$('reviewPlay').textContent=state.playing?'Pause':'Play phrase';};
  $('reviewScrub').oninput=()=>{pause();state.time=state.start+Number($('reviewScrub').value)*(state.end-state.start);show();};
  for(const id of ['reviewAligned','reviewMirror','reviewView'])$(id).onchange=show;
  $('reviewFront').onclick=()=>{state.viewer.yaw=0;show();};
  function tick(now){if(state.playing){state.time=Math.min(state.end,state.time+(now-state.wall)*Number($('reviewSpeed').value));state.wall=now;show();if(state.time>=state.end)pause();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  window.addEventListener('pagehide',()=>{pause();state.viewer?.dispose();state.viewer=null;});
  async function refreshRecordings(selectNewest=false,id=null){
    const previous=$('movementRecording').value,recordings=await json('/api/recordings');
    const choices=[...recordings.map(r=>({id:r.id,key:r.id})),...[...state.files].map(([key,f])=>({id:f.name,key,local:true}))].sort((a,b)=>b.id.localeCompare(a.id));
    $('movementRecording').replaceChildren(...choices.map(r=>option(r.id+(r.local?' · local file':''),r.key)));
    if(id&&choices.some(r=>r.key===id))$('movementRecording').value=id;
    else if(!selectNewest&&choices.some(r=>r.key===previous))$('movementRecording').value=previous;
    return choices.length;
  }
  $('refreshMovementRecordings').onclick=async()=>{try{if(await refreshRecordings(true))await load();}catch(e){status(`Could not refresh recordings: ${e.message}`);}};
  $('reviewRecordingFiles').onchange=async e=>{
    try{
      const imported=[];for(const file of e.target.files){if(file.size>100*1024*1024)throw new Error('Recording JSON is larger than 100 MB.');imported.push({name:file.name,recording:parseRecording(await file.text())});}
      let key;for(const file of imported){key=`file:${++state.fileSerial}`;state.files.set(key,file);}
      await refreshRecordings(false,key);if(key)await load();
    }catch(e){status(`Could not open recording: ${e.message}`);}finally{e.target.value='';}
  };
  window.addEventListener('rhythm-recording-saved',async e=>{try{await refreshRecordings(false,e.detail.id);await load();}catch(err){status(`Saved recording is ready; refresh to review it. ${err.message}`);}});
  try{const [recordings,library]=await Promise.all([refreshRecordings(true),json('/moves/library.json')]);state.library=library.movements.filter(m=>m.glb&&m.track!=='reps');
    $('movementReference').replaceChildren(...state.library.map(m=>option(m.display,m.key)));if(state.library.some(m=>m.key==='freestyle_dance'))$('movementReference').value='freestyle_dance';
    if(recordings)await load();else status('No saved recordings yet. Open a local recording JSON or record a new attempt below.');
  }catch(e){status(e.message);}
}
