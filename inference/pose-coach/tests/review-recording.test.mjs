import test from 'node:test';import assert from 'node:assert/strict';
import {parseRecording} from '../web/js/review-recording.js';
test('local imports preserve coordinates, timestamp origin and saved attempts without writing or inventing fields',()=>{
 const text=JSON.stringify({frames:[{t:10000,world:null},{t:10100,world:null}],attempts:[{id:1,start:10000,end:10100}],timestampUnit:'milliseconds'});
 assert.equal(JSON.stringify(parseRecording(text)),text);
 for(const value of [{frames:[]},{frames:[{t:0},{t:1}],timestampUnit:'seconds'},{frames:[{t:0},{t:'1'}]},{frames:[{t:0},{t:1}],attempts:{}}])assert.throws(()=>parseRecording(JSON.stringify(value)));
});
