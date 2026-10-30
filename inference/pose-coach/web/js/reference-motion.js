// Sample the animation actually served by the movement library. No replacement animation or source-file writes.
// THREE is injected so the same sampler is exercised in Node tests and the browser.
const MAP={0:'Head',11:'LeftArm',12:'RightArm',13:'LeftForeArm',14:'RightForeArm',15:'LeftHand',16:'RightHand',
  23:'LeftUpLeg',24:'RightUpLeg',25:'LeftLeg',26:'RightLeg',27:'LeftFoot',28:'RightFoot',31:'LeftToeBase',32:'RightToeBase'};
export function referenceMotion(buffer,THREE,limitSeconds=Infinity) {
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw new Error('Reference is not a GLB 2 animation.');
  let json,bin;
  for(let at=12;at+8<=buffer.byteLength;){const n=view.getUint32(at,true),type=view.getUint32(at+4,true);at+=8;
    if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,at,n)));
    if(type===0x004e4942)bin=new DataView(buffer,at,n);at+=n;
  }
  if(!json?.animations?.length||!bin)throw new Error('Reference has no skeletal animation.');
  const cache=new Map();
  function accessor(id){
    if(cache.has(id))return cache.get(id);
    const a=json.accessors[id],b=json.bufferViews[a.bufferView],width={SCALAR:1,VEC3:3,VEC4:4}[a.type];
    if(a.componentType!==5126||!width||a.sparse||b.buffer!==0)throw new Error('Unsupported reference animation accessor.');
    const values=Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>bin.getFloat32((b.byteOffset??0)+(a.byteOffset??0)+i*(b.byteStride??width*4)+j*4,true)));
    cache.set(id,values);return values;
  }
  const roots=json.scenes?.[json.scene??0]?.nodes??[];
  const nodes=json.nodes.map(n=>{
    const o=new THREE.Object3D();o.name=n.name??'';
    if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);
    else {o.position.fromArray(n.translation??[0,0,0]);o.quaternion.fromArray(n.rotation??[0,0,0,1]);o.scale.fromArray(n.scale??[1,1,1]);}
    return o;
  });
  json.nodes.forEach((n,i)=>(n.children??[]).forEach(k=>nodes[i].add(nodes[k])));
  const scene=new THREE.Group();roots.forEach(i=>scene.add(nodes[i]));
  const bones=new Map(nodes.map(n=>[n.name.replace(/^mixamorig:?/,''),n]));
  if(Object.values(MAP).filter(n=>bones.has(n)).length<12)throw new Error('Reference skeleton is missing the body joints.');
  const animation=json.animations[0],channels=animation.channels.filter(c=>['translation','rotation','scale'].includes(c.target.path)).map(c=>{
    const s=animation.samplers[c.sampler];if(!['LINEAR','STEP'].includes(s.interpolation??'LINEAR'))throw new Error('Unsupported reference interpolation.');
    return {...c,times:accessor(s.input).flat(),values:accessor(s.output),interpolation:s.interpolation??'LINEAR'};
  });
  const duration=Math.min(limitSeconds,Math.max(...channels.map(c=>c.times.at(-1))));
  if(!(duration>0))throw new Error('Reference animation has no duration.');
  function sample(seconds){
    const t=Math.max(0,Math.min(duration,seconds));
    for(const c of channels){let a=0,b=c.times.length-1;while(a+1<b){const m=(a+b)>>1;if(c.times[m]<=t)a=m;else b=m;}
      const p=c.interpolation==='STEP'?0:Math.max(0,Math.min(1,(t-c.times[a])/(c.times[b]-c.times[a]||1))),o=nodes[c.target.node];
      if(c.target.path==='rotation')o.quaternion.fromArray(c.values[a]).slerp(new THREE.Quaternion().fromArray(c.values[b]),p);
      else o[c.target.path==='translation'?'position':'scale'].fromArray(c.values[a]).lerp(new THREE.Vector3().fromArray(c.values[b]),p);
    }
    scene.updateMatrixWorld(true);const world=Array(33).fill(null);
    for(const [id,name] of Object.entries(MAP)){const b=bones.get(name);if(!b)continue;const p=b.getWorldPosition(new THREE.Vector3());world[id]=[p.x,-p.y,-p.z];}
    return {t:t*1000,world,reference:true};
  }
  const frames=Array.from({length:Math.ceil(duration*10)+1},(_,i)=>sample(Math.min(duration,i/10)));
  return {duration,sample,frames};
}
