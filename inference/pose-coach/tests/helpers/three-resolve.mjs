// Match index.html's local import map when testing the actual GLTFLoader in Node.
export async function resolve(specifier,context,nextResolve) {
  if(specifier==='three')return {url:new URL('../../web/vendor/three-0.170.0/build/three.module.js',import.meta.url).href,shortCircuit:true};
  return nextResolve(specifier,context);
}
