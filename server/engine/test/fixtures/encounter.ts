import {expect,mock,test} from 'bun:test';
import {EventEmitter} from 'node:events';
class TestWorker extends EventEmitter{postMessage(){}}
mock.module('worker_threads',()=>({Worker:TestWorker}));
const {default:World}=await import('../../src/engine/World.js');
const cache=process.env.COMMUNITY_TEST_CACHE!;
for(const name of ['VarPlayerType','VarBitType','VarNpcType','ParamType','ObjType','LocType','NpcType','InvType','SeqType','Component','StructType','DbTableType','DbRowType','EnumType','MesanimType','CategoryType','FontType']){
 const type=(await import(`../../src/cache/config/${name}.js`)).default;type.load(cache);
}
const {default:ScriptProvider}=await import('../../src/engine/script/ScriptProvider.js');
const {default:ScriptRunner}=await import('../../src/engine/script/ScriptRunner.js');
const {default:ScriptState}=await import('../../src/engine/script/ScriptState.js');
const {default:ScriptPointer}=await import('../../src/engine/script/ScriptPointer.js');
const {ScriptOpcode}=await import('../../src/engine/script/ScriptOpcode.js');
const {default:PlayerOps}=await import('../../src/engine/script/handlers/PlayerOps.js');
const {default:NpcOps}=await import('../../src/engine/script/handlers/NpcOps.js');
const {default:CoreOps}=await import('../../src/engine/script/handlers/CoreOps.js');
const {default:VarPlayerType}=await import('../../src/cache/config/VarPlayerType.js');
const {NetworkPlayer}=await import('../../src/engine/entity/NetworkPlayer.js');
const {default:NullClientSocket}=await import('../../src/server/NullClientSocket.js');
const {default:Npc}=await import('../../src/engine/entity/Npc.js');
const {actorSnapshot,encounterJournal,subscribeEncounters,queueEncounterCause,scriptEncounterCause,recordHealth,resetEncounterActor}=await import('../../src/engine/entity/tracking/EncounterJournal.js');
const {default:Packet}=await import('../../src/io/Packet.js');
const {default:EncounterMessage}=await import('../../src/network/game/server/model/EncounterMessage.js');
const {default:EncounterMessageEncoder}=await import('../../src/network/game/server/codec/EncounterMessageEncoder.js');
const {default:ServerGameProt}=await import('../../src/network/game/server/ServerGameProt.js');
const {default:ClientGameProt}=await import('../../src/network/game/client/ClientGameProt.js');
expect(ScriptProvider.load(cache)).toBeGreaterThan(0);
let nextSlot=1,nextNpc=1;
function player(hp=20){const slot=nextSlot++,p=new NetworkPlayer('encounter'+slot,BigInt(slot),BigInt(slot),new NullClientSocket());p.slot=slot;p.isActive=true;p.uid=((Number(p.username37&0x1fffffn)<<11)|slot)>>>0;p.x=3210;p.z=3210;p.level=0;p.levels[3]=hp;p.baseLevels[3]=hp;World.players[slot]=p;const packets:any[]=[];p.write=(message:any)=>{packets.push(message);};return {p,packets};}
function npc(){const n=new Npc(0,3211,3210,1,1,0,nextNpc++,107,0);n.lifecycleTick=-1;n.isActive=true;World.npcs.set(n.nid,n);return n;}
function state(name:string,self:any,target:any=null,args:any[]=[]){const script=ScriptProvider.getByName(name);expect(script).toBeDefined();const s=ScriptRunner.init(script!,self,target,args);if(s._activePlayer)s.pointerAdd(ScriptPointer.ProtectedActivePlayer);return s;}
function op(s:any,handlers:any,code:number,values:number[],operand=0){for(const value of values)s.pushInt(value);Object.defineProperty(s,'intOperand',{value:operand,configurable:true});try{handlers[code](s);}finally{delete s.intOperand;}}
function execute(s:any){for(let i=0;i<30;i++){const result=ScriptRunner.execute(s);expect(result).not.toBe(ScriptState.ABORTED);if(result===ScriptState.FINISHED)return;expect(result).toBe(ScriptState.SUSPENDED);}throw Error('Script did not finish');}

test('real delayed NPC queue records the original attacker and both impact-time positions after movement/retargeting',()=>{
 const {p,packets}=player(12),attacker=npc(),bystander=player();
 const s=state('[proc,npc_default_attack]',attacker,p);
 const script=ScriptProvider.getByName('[queue,combat_damage_player]')!;
 op(s,PlayerOps,ScriptOpcode.QUEUE,[script.id,3,7]);
 const request=[...p.queue.all()].find(q=>q.script.id===script.id)!;
 expect(request.encounterCause?.identity?.entityId).toBe(actorSnapshot(attacker).entityId);
 attacker.x=3215;attacker.z=3216;p.x=3217;p.z=3218;p.level=1;
 const queued=state('[queue,combat_damage_player]',p,null,[7]);queued.encounterCause=request.encounterCause;
 execute(queued);
 const events=encounterJournal(p).events,hit=events.find(e=>e.kind==='damage')!;
 expect(p.levels[3]).toBe(5);
 expect(hit).toMatchObject({amount:7,beforeHp:12,afterHp:5,cause:'npc_attack',source:{id:107,position:{x:3215,z:3216,plane:0}},target:{position:{x:3217,z:3218,plane:1}}});
 expect(packets.filter(m=>m instanceof EncounterMessage)).toHaveLength(0);expect(encounterJournal(bystander.p).events).toHaveLength(0);
 subscribeEncounters(p);expect(packets.some(m=>m instanceof EncounterMessage)).toBe(true);
 expect(encounterJournal(bystander.p).events).toHaveLength(0);
});
test('lethal report follows actual damage, clips overkill and distinguishes highest contributor from lethal source',()=>{
 const {p}=player(3),a=npc(),b=npc();
 p.applyDamage(9,1,{source:a,identity:actorSnapshot(a),cause:'npc_attack',script:'test:actual_hit'});
 const events=encounterJournal(p).events,death=events.find(e=>e.kind==='death')!,hit=events.find(e=>e.id===death.lethalEventId)!;
 expect(hit).toMatchObject({amount:3,beforeHp:3,afterHp:0});
 expect(death.source?.entityId).toBe(actorSnapshot(a).entityId);expect(death.source?.entityId).not.toBe(actorSnapshot(b).entityId);
 const before=events.filter(e=>e.kind==='death').length;p.applyDamage(1,1);expect(encounterJournal(p).events.filter(e=>e.kind==='death')).toHaveLength(before);
});
test('poison provenance survives timer execution, while despawn/reused life never borrows a new source position',()=>{
 const {p}=player(10),a=npc(),infection=state('[queue,poison_player]',p,null,[20]);
 infection.encounterCause=queueEncounterCause(state('[proc,npc_default_attack]',a,p),'[queue,poison_player]',p);
 op(infection,CoreOps,ScriptOpcode.POP_VARP,[20],VarPlayerType.getId('poison'));
 const original=actorSnapshot(a).entityId;
 resetEncounterActor(a);a.x=3300;a.z=3300;
 const tick=state('[queue,poison_damage]',p,null,[3]);execute(tick);
 const hit=encounterJournal(p).events.find(e=>e.kind==='damage')!;
 expect(hit).toMatchObject({cause:'poison',source:{entityId:original,position:null,hp:null}});
 expect(hit.source?.entityId).not.toBe(actorSnapshot(a).entityId);
});
test('recoil uses its real queue sender, not the incoming hit source or current target',()=>{
 const {p}=player(),a=npc(),s=state('[queue,combat_damage_player]',p,null,[3]);
 s._activeNpc=a;s.pointerAdd(ScriptPointer.ActiveNpc);op(s,NpcOps,ScriptOpcode.NPC_QUEUE,[2,2,0]);
 const request=[...a.queue.all()][0]!;expect(request.encounterCause?.cause).toBe('recoil');
 const hit=state('[proc,npc_default_damage]',a,null,[2]);hit.encounterCause=request.encounterCause;execute(hit);
 const event=encounterJournal(p).events.find(e=>e.kind==='damage')!;
 expect(event).toMatchObject({cause:'recoil',source:{entityId:actorSnapshot(p).entityId},target:{entityId:actorSnapshot(a).entityId}});
});
test('healing and stat loss use actual clamped HP; recovery after zero is not reported as healing',()=>{
 const {p}=player(20);p.levels[3]=18;
 const heal=state('[queue,damage_player]',p);op(heal,PlayerOps,ScriptOpcode.STAT_HEAL,[3,10,0]);
 expect(encounterJournal(p).events.at(-1)).toMatchObject({kind:'healing',amount:2,beforeHp:18,afterHp:20});
 p.levels[3]=0;const recovery=state('[queue,damage_player]',p);op(recovery,PlayerOps,ScriptOpcode.STAT_HEAL,[3,20,0]);
 expect(encounterJournal(p).events.at(-1)?.kind).toBe('life_reset');
});
test('NPC healing reaches only recent encounter participants; unrelated damage is private',()=>{
 const a=npc(),one=player(),two=player();
 a.applyDamage(2,1,{source:one.p,identity:actorSnapshot(one.p),cause:'player_attack',script:'test:player_attack'});
 const before=encounterJournal(one.p).events.length;
 a.applyDamage(1,1,{source:two.p,identity:actorSnapshot(two.p),cause:'player_attack',script:'test:other_attack'});
 expect(encounterJournal(one.p).events).toHaveLength(before);
 const hp=a.levels[3];a.levels[3]++;recordHealth(a,hp,{source:null,identity:null,cause:'regeneration',script:'engine:regen'},'healing');
 expect(encounterJournal(one.p).events.at(-1)?.kind).toBe('healing');
 expect(encounterJournal(two.p).events.at(-1)?.kind).toBe('healing');
});
test('private protocol round-trip preserves event data and uses separate opt-in opcodes',()=>{
 const {p}=player(),a=npc();p.applyDamage(1,1,{source:a,identity:actorSnapshot(a),cause:'npc_attack',script:'test'});
 const journal=encounterJournal(p),message=new EncounterMessage({version:1,stream:journal.stream,ownerId:actorSnapshot(p).entityId,events:journal.events});
 const packet=Packet.alloc(1),encoder=new EncounterMessageEncoder();encoder.encode(packet,message);const size=packet.pos;packet.pos=0;
 expect(JSON.parse(packet.gjstr())).toEqual(message.payload);expect(size).toBeLessThan(5000);
 expect(ServerGameProt.ENCOUNTER_EVENTS.id).toBe(254);expect(ServerGameProt.ENCOUNTER_EVENTS.length).toBe(-2);expect(ClientGameProt.ENCOUNTER_SUBSCRIBE.length).toBe(0);
});


test('PvP queued hits preserve the scheduling player despite later targeting changes',()=>{
 const one=player(20),two=player(20),s=state('[proc,.pvp_damage]',one.p,two.p);
 const queue=ScriptProvider.getByName('[queue,pvp_damage]')!;
 op(s,PlayerOps,ScriptOpcode.QUEUE,[queue.id,2,4],1);
 const request=[...two.p.queue.all()].find(q=>q.script.id===queue.id)!;
 one.p.x=3250;two.p.x=3251;
 const queued=state('[queue,pvp_damage]',two.p,null,[4]);queued.encounterCause=request.encounterCause;execute(queued);
 expect(encounterJournal(two.p).events.find(e=>e.kind==='damage')).toMatchObject({cause:'player_attack',source:{entityId:actorSnapshot(one.p).entityId,position:{x:3250,z:3210,plane:0}},target:{position:{x:3251,z:3210,plane:0}}});
});


test('NPC heal caps that reduce a boosted HP value are stat loss, not fabricated healing',()=>{
 const n=npc(),one=player();n.applyDamage(1,1,{source:one.p,identity:actorSnapshot(one.p),cause:'player_attack',script:'test'});
 n.levels[3]=n.baseLevels[3]+5;
 const heal=state('[proc,npc_default_damage]',n,null,[0]);op(heal,NpcOps,ScriptOpcode.NPC_STATHEAL,[3,0,0]);
 expect(encounterJournal(one.p).events.at(-1)).toMatchObject({kind:'stat_loss',amount:5,beforeHp:22,afterHp:17});
});


test('a projectile from a preceding player life retains identity but does not borrow respawn coordinates',()=>{
 const a=player(20),b=player(20),s=state('[proc,.pvp_damage]',a.p,b.p),queue=ScriptProvider.getByName('[queue,pvp_damage]')!;
 op(s,PlayerOps,ScriptOpcode.QUEUE,[queue.id,2,4],1);
 const request=[...b.p.queue.all()].find(q=>q.script.id===queue.id)!;
 a.p.applyDamage(20,1);a.p.levels[3]=20;a.p.x=3222;a.p.z=3222;recordHealth(a.p,0,{source:null,identity:null,cause:'respawn',script:'test:respawn'},'healing');
 const queued=state('[queue,pvp_damage]',b.p,null,[4]);queued.encounterCause=request.encounterCause;execute(queued);
 expect(encounterJournal(b.p).events.find(e=>e.kind==='damage')?.source).toMatchObject({entityId:actorSnapshot(a.p).entityId,hp:null,maxHp:null,position:null});
});
