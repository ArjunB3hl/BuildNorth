// Private stitched-workout annotations are optional. Never put clip identities or recordings in source.
import fs from 'node:fs';
import path from 'node:path';

export function readWorkoutCases(file, data, around = clip => ({ clip })) {
  let source;
  try { source = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const cases = JSON.parse(source);
  if (!Array.isArray(cases)) throw new Error('workout cases must be an array');
  return cases.map((item, i) => {
    if (!item || typeof item.name !== 'string' || !Array.isArray(item.segs) || !item.segs.length ||
        !Array.isArray(item.expect) || !item.expect.every(x => typeof x === 'string'))
      throw new Error(`invalid workout case ${i}`);
    return { ...item, segs: item.segs.map(segment => {
      if (!segment || ![segment.clip, segment.rest, segment.gone].some(Boolean))
        throw new Error(`invalid segment in workout case ${i}`);
      const result = { ...segment };
      for (const key of ['clip', 'rest']) if (result[key]) {
        if (typeof result[key] !== 'string') throw new Error(`invalid ${key} in workout case ${i}`);
        if (result[key].endsWith('.json')) result[key] = path.resolve(data, result[key]);
      }
      if (result.around && result.clip) {
        delete result.around;
        return { ...around(result.clip), ...result };
      }
      return result;
    }) };
  });
}
