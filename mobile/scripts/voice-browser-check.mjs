import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Run from mobile with Node 24; uses the extension's existing Vite/Playwright dependencies.
const base=fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const require=createRequire(base+'/extension/package.json');
const {createServer}=await import(require.resolve('vite'));
const ts=require('typescript');
const {chromium,expect}=require('@playwright/test');
const root=await fs.mkdtemp(join(tmpdir(),'rhythm-voice-browser-'));
await fs.writeFile(root+'/index.html','<div id="root"></div><script type="module" src="/entry.tsx"></script>');
await fs.writeFile(root+'/entry.tsx',`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SpeechChat} from '${base}/mobile/src/components/coach/speech-chat.web.tsx';
window.calls=[]; window.delay=10;
const wav=new Uint8Array(44+32000);const v=new DataView(wav.buffer);for(const [o,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) [...s].forEach((x,i)=>v.setUint8(o+i,x.charCodeAt(0)));v.setUint32(4,wav.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,32000,true);
window.api={voice:{transcribe:async encoded=>{const bytes=Uint8Array.from(atob(encoded),x=>x.charCodeAt(0));const header=new DataView(bytes.buffer);if(header.getUint32(24,true)!==16000||header.getUint16(22,true)!==1)throw Error('Invalid recording');window.calls.push('transcribe');return {text:'I ate oatmeal.'}},speech:async id=>{window.calls.push('speech');return {audioBase64:btoa(String.fromCharCode(...wav)),mimeType:'audio/wav',clipped:false}}},coach:{send:async()=>{window.calls.push('coach');await new Promise(r=>setTimeout(r,window.delay));return {reply:{id:'demo',content:'Your meal is saved.'}}}}};
createRoot(document.getElementById('root')).render(<SpeechChat/>);`);
const ui=`import React from 'react';export const Button=({title,onPress,disabled})=>React.createElement('button',{onClick:onPress,disabled},title);export const Notice=({children})=>React.createElement('div',null,children);export const ThemedText=({children})=>React.createElement('p',null,children);export const Card=({children})=>React.createElement('main',null,children);export const View=({children})=>React.createElement('div',null,children);export const errorMessage=e=>e.message;`;
const stubs={
'react-native':ui,'@/components/form':ui,'@/components/themed-text':ui,'@/components/ui':ui,
'@/hooks/use-api':'export const useApi=()=>window.api;',
'@tanstack/react-query':'const q={invalidateQueries:async()=>{}};export const useQueryClient=()=>q;',
'@/lib/dates':"export const localDate=()=> '2026-10-25';",'@/lib/keys':"export const newKey=()=>crypto.randomUUID();"
};
const server=await createServer({configFile:false,root,optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime']},server:{host:'127.0.0.1',port:0,strictPort:false,fs:{allow:[root,base]}},resolve:{alias:[{find:'react-dom',replacement:base+'/extension/node_modules/react-dom'},{find:'react',replacement:base+'/extension/node_modules/react'}]},plugins:[{name:'voice-fixture',enforce:'pre',resolveId(id){if(stubs[id])return '\0fixture:'+id;if(id==='@/lib/voice-recording.web')return base+'/mobile/src/lib/voice-recording.web.ts';},load(id){if(id.startsWith('\0fixture:'))return stubs[id.slice(9)];},transform(code,id){if(/\.tsx?$/.test(id))return {code:ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,map:null};}}]});
await server.listen();
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port);
 await page.getByRole('button',{name:'Record message'}).click();
 await expect(page.getByRole('button',{name:'Send recording'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Record message'})).toBeDisabled();
 await page.waitForTimeout(1100);
 await page.getByRole('button',{name:'Send recording'}).click();
 await expect(page.getByText('Coach: Your meal is saved.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Play reply'})).toBeVisible();
 expect(await page.evaluate(()=>window.calls)).toEqual(['transcribe','coach','speech']);
 await page.evaluate(()=>{window.delay=900;});
 await page.getByRole('button',{name:'Record message'}).click();
 await expect(page.getByRole('button',{name:'Send recording'})).toBeVisible();await page.waitForTimeout(1100);
 await page.getByRole('button',{name:'Send recording'}).click();
 await expect(page.getByText(/Thinking/)).toBeVisible();
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(1100);
 expect(await page.evaluate(()=>window.calls.filter(x=>x==='speech').length)).toBe(1);
 await expect(page.getByRole('button',{name:'Record message'})).toBeEnabled();
 expect(errors).toEqual([]);
 console.log('Browser fixture passed: real MediaRecorder/resampling, single turn, stored reply playback, cancellation drops late speech. Inference and app shell were mocked.');
} finally {await browser?.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
