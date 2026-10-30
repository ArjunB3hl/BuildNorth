// Read-only diagnostic: node tools/review_recordings.mjs /path/to/recording.json [...]
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from '../web/vendor/three-0.170.0/build/three.module.js';
import {referenceMotion} from '../web/js/reference-motion.js';
import {prepareFrames,sampleFrames,align,differences,reviewWindows,reviewAttempts} from '../web/js/review-analysis.js';
import {characterEvidence} from '../web/js/review-character.js';
import {anchoredReview} from '../web/js/review-legs.js';
const glb=new URL('../.data/moves/glb/freestyle_dance.glb',import.meta.url),buffer=fs.readFileSync(glb);
const motion=referenceMotion(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),THREE,4.6),reference=prepareFrames(motion.frames);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const reports=[];
for(const path of process.argv.slice(2)){
 const bytes=fs.readFileSync(path),recording=JSON.parse(bytes),frames=prepareFrames(recording.frames),origin=frames[0].t;
 const windows=reviewWindows(recording,'freestyle_dance'),audits=reviewAttempts(frames,reference,windows,{focus:'legs'});
 const cue=x=>({...x,t:(x.t-origin)/1000,start:(x.start-origin)/1000,end:(x.end-origin)/1000,referenceT:x.referenceT/1000});
 const attempts=audits.map(a=>{
  const intervals=(recording.movementIntervals??[]).filter(i=>i.attempt===a.attempt);
  return {attempt:a.attempt,start:(a.start-origin)/1000,end:(a.end-origin)/1000,legCoverage:a.coverage,
   movingSeconds:intervals.reduce((s,i)=>s+(i.end-i.start)/1000,0),intervals:intervals.length,
   intervalBoundariesValid:intervals.every(i=>i.start>=a.start&&i.end<=a.end),
   candidates:a.candidates.map(c=>{const sample=sampleFrames(frames,c.start,c.end);return {
    start:(c.start-origin)/1000,end:(c.end-origin)/1000,coverage:c.result.coverage,errorDeg:c.result.errorDeg,
    phaseMarginDeg:c.result.phaseMarginDeg,ambiguous:c.ambiguous,
    characterCoverage:sample.filter(f=>characterEvidence(f).supported).length/sample.length,
    findings:differences(sample,reference,c.result).map(cue)};}),
   // Timing from the order of measured knee bends and turn direction; see review-legs.js.
   anchored:anchoredReview(frames,reference,a,motion.duration*1000).phrases.map(p=>({start:(p.start-origin)/1000,end:(p.end-origin)/1000,
    mirrored:p.mirrored,pace:p.pace,pairs:p.pairs.map(q=>({side:q.user.side,t:(q.user.t-origin)/1000,referenceT:q.reference.t/1000,
     kneeMin:q.user.kneeMin,referenceKneeMin:q.reference.kneeMin,rise:q.user.rise,referenceRise:q.reference.rise,hidden:q.user.hidden})),
    findings:p.findings.map(cue)}))};
 });
 reports.push({path,sha256:sha(bytes),frames:frames.length,duration:(frames.at(-1).t-origin)/1000,attempts});
}
console.log(JSON.stringify({reference:{duration:motion.duration,sha256:sha(buffer)},recordings:reports},null,2));
