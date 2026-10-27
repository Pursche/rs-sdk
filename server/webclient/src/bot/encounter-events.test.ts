import {expect,test} from 'bun:test';
import {EncounterBuffer} from './encounter-events.js';
import {ServerProt,ServerProtSizes} from '../io/ServerProt.js';
import type {ServerEncounterEvent} from '../../../../sdk/types.js';
const actor=(id:string,kind:'player'|'npc'='player')=>({kind,entityId:id,id:kind==='npc'?107:null,index:1,name:id,hp:10,maxHp:20,position:{x:3210,z:3211,plane:2}});
const event=(number:number,kind:ServerEncounterEvent['kind']='damage',at=number*600):ServerEncounterEvent=>({version:1,id:'stream:'+number,tick:number,at,kind,cause:'npc_attack',script:'[queue,combat_damage_player]',amount:3,beforeHp:10,afterHp:kind==='death'?0:7,source:actor('npc','npc'),target:actor('owner'),...(kind==='death'?{lethalEventId:'stream:'+(number-1)}:{})});
const packet=(events:ServerEncounterEvent[],stream='stream',ownerId='owner')=>JSON.stringify({version:1,stream,ownerId,events});
test('capability negotiation is explicit and once per login; legacy messages do not send unsupported packets',()=>{
 const buffer=new EncounterBuffer();let requested=0;
 expect(buffer.capability('Welcome to RuneScape',()=>requested++)).toBe(false);
 expect(requested).toBe(0);expect(buffer.snapshot().version).toBeNull();
 expect(buffer.capability('Encounter reports available (v1).',()=>requested++)).toBe(true);
 buffer.capability('Encounter reports available (v1).',()=>requested++);expect(requested).toBe(1);
 buffer.reset();buffer.capability('Encounter reports available (v1).',()=>requested++);expect(requested).toBe(2);
 expect(ServerProtSizes[ServerProt.ENCOUNTER_EVENTS]).toBe(-2);
});
test('authoritative events preserve health and positions; repeated live/replay packets are deduplicated',()=>{
 const buffer=new EncounterBuffer();expect(buffer.receive(packet([event(1)]))).toBe(true);
 buffer.receive(packet([event(1)]));buffer.receive(packet([event(2,'healing')]));buffer.receive(packet([event(3,'death')]));
 buffer.receive(packet([event(1)]));expect(buffer.snapshot().events).toHaveLength(3);
 expect(buffer.snapshot().events[0]).toMatchObject({source:{hp:10,maxHp:20,position:{x:3210,z:3211,plane:2}},target:{position:{x:3210,z:3211,plane:2}}});
 // Retain the completed own-death window after later-life traffic/quiet time.
 const later={...event(4,'life_reset',50000)};buffer.receive(packet([later]));expect(buffer.snapshot().events.some(e=>e.kind==='death')).toBe(true);
});
test('out-of-order death replay reconstructs the full factual window and malformed packets cannot replace it',()=>{
 const buffer=new EncounterBuffer();buffer.receive(packet([event(3,'death')]));buffer.receive(packet([event(1)]));buffer.receive(packet([event(2,'healing')]));
 expect(buffer.snapshot().events.map(e=>e.id)).toEqual(['stream:1','stream:2','stream:3']);
 for(const text of ['chat text',packet([{...event(4),target:{...actor('owner'),position:{x:1,z:2,plane:99}}}]),packet([{...event(4),amount:NaN}]),packet([event(4)],'stream','another-owner')])expect(buffer.receive(text)).toBe(false);
 expect(buffer.snapshot().ownerId).toBe('owner');expect(buffer.snapshot().events).toHaveLength(3);
});


test('rapid successive deaths pin the latest life and old replay cannot replace it',()=>{
 const buffer=new EncounterBuffer();buffer.receive(packet([event(1),event(2,'death')]));
 buffer.receive(packet([event(3,'life_reset'),event(4),event(5,'death')]));
 buffer.receive(packet([event(2,'death')]));buffer.receive(packet([event(6,'life_reset',50000)]));
 expect(buffer.snapshot().events.some(e=>e.id==='stream:5')).toBe(true);
});
