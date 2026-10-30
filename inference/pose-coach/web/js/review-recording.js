// Local file review never writes back to the source or uploads it to the recording API.
export function parseRecording(text) {
  const recording=JSON.parse(text);
  if(!Array.isArray(recording?.frames)||recording.frames.length<2)throw new Error('A recording needs at least two saved landmark frames.');
  if(recording.timestampUnit&&recording.timestampUnit!=='milliseconds')throw new Error('Unsupported recording timestamp unit; expected milliseconds.');
  if(!recording.frames.every(f=>f&&Number.isFinite(f.t)))throw new Error('Recording frames need finite millisecond timestamps.');
  for(const field of ['attempts','events','movementIntervals'])if(recording[field]!=null&&!Array.isArray(recording[field]))throw new Error(`Recording ${field} must be a list.`);
  return recording;
}
