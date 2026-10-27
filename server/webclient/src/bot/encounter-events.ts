import type {EncounterActor,ServerEncounterEvent,ServerEncounterState} from '../../../../sdk/types.js';
const kinds=new Set(['damage','healing','stat_loss','life_reset','death']);
const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
function actor(value:any):EncounterActor|null{
  if(!value||!['player','npc'].includes(value.kind)||typeof value.entityId!=='string'||value.entityId.length>80||typeof value.name!=='string'||value.name.length>80||!Number.isInteger(value.index)||value.id!==null&&!Number.isInteger(value.id))return null;
  if([value.hp,value.maxHp].some(n=>n!==null&&(!finite(n)||n<0)))return null;
  const p=value.position;if(p!==null&&(!p||![p.x,p.z,p.plane].every(Number.isInteger)||p.plane<0||p.plane>3))return null;
  return {kind:value.kind,entityId:value.entityId,id:value.id,index:value.index,name:value.name,hp:value.hp,maxHp:value.maxHp,position:p===null?null:{x:p.x,z:p.z,plane:p.plane}};
}
export class EncounterBuffer{
  private state:ServerEncounterState={version:null,stream:null,ownerId:null,events:[],dropped:0};
  private lastDeath:ServerEncounterEvent[]=[];
  private requested=false;
  reset(){this.state={version:null,stream:null,ownerId:null,events:[],dropped:0};this.lastDeath=[];this.requested=false;}
  capability(message:string,subscribe:()=>void){
    if(message!=='Encounter reports available (v1).')return false;
    if(!this.requested){this.requested=true;subscribe();}return true;
  }
  receive(text:string){
    if(text.length>8000)return false;
    let packet:any;try{packet=JSON.parse(text);}catch{return false;}
    if(packet?.version!==1||typeof packet.stream!=='string'||packet.stream.length>80||typeof packet.ownerId!=='string'||packet.ownerId.length>80||!Array.isArray(packet.events)||packet.events.length>8)return false;
    const parsed:ServerEncounterEvent[]=[];
    for(const value of packet.events){
      const target=actor(value?.target),source=value?.source===null?null:actor(value?.source);
      if(!target||value.source!==null&&!source||value.version!==1||typeof value.id!=='string'||!value.id.startsWith(packet.stream+':')||value.id.length>100||!kinds.has(value.kind)||![value.tick,value.at,value.amount,value.beforeHp,value.afterHp].every(finite)||typeof value.cause!=='string'||value.cause.length>100||typeof value.script!=='string'||value.script.length>180||value.lethalEventId!==undefined&&(typeof value.lethalEventId!=='string'||value.lethalEventId.length>100))return false;
      parsed.push({version:1,id:value.id,tick:value.tick,at:value.at,kind:value.kind,cause:value.cause,script:value.script,amount:value.amount,beforeHp:value.beforeHp,afterHp:value.afterHp,source,target,...(value.lethalEventId?{lethalEventId:value.lethalEventId}:{}),...(Number.isSafeInteger(value.omittedBefore)&&value.omittedBefore>=0?{omittedBefore:value.omittedBefore}:{})});
    }
    if(this.state.stream!==packet.stream){this.state={version:1,stream:packet.stream,ownerId:packet.ownerId,events:[],dropped:0};this.lastDeath=[];}
    if(this.state.ownerId!==packet.ownerId)return false;
    const events=[...new Map([...this.state.events,...parsed].map(e=>[e.id,e])).values()].sort((a,b)=>a.at-b.at||Number(a.id.split(':').at(-1))-Number(b.id.split(':').at(-1)));
    const death=events.filter(e=>e.kind==='death'&&e.target.entityId===packet.ownerId).at(-1);
    this.lastDeath=death?events.filter(e=>e.at<=death.at&&death.at-e.at<=10000):[];
    const newest=events.at(-1)?.at??0,retained=events.filter(e=>newest-e.at<=30000);
    const pinned=new Set(this.lastDeath.map(e=>e.id));
    this.state.dropped+=retained.slice(0,Math.max(0,retained.length-320)).filter(e=>!pinned.has(e.id)).length;
    this.state.events=[...new Map([...this.lastDeath,...retained.slice(-320)].map(e=>[e.id,e])).values()].slice(-480);
    this.state.version=1;return true;
  }
  snapshot():ServerEncounterState{return {...this.state,events:[...this.state.events]};}
}
