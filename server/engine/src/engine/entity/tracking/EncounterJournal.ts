import {randomUUID} from 'node:crypto';
import Player from '#/engine/entity/Player.js';
import Npc from '#/engine/entity/Npc.js';
import NpcType from '#/cache/config/NpcType.js';
import {displayNames} from '#/util/DisplayNames.js';
import World from '#/engine/World.js';
import type ScriptState from '#/engine/script/ScriptState.js';
import EncounterMessage from '#/network/game/server/model/EncounterMessage.js';

type Actor=Player|Npc;
export type EncounterActor={kind:'player'|'npc';entityId:string;id:number|null;index:number;name:string;hp:number|null;maxHp:number|null;position:{x:number;z:number;plane:number}|null};
export type EncounterCause={source:Actor|null;identity:EncounterActor|null;sourceEpoch?:number;cause:string;script:string};
export type EncounterEvent={version:1;id:string;tick:number;at:number;kind:'damage'|'healing'|'stat_loss'|'life_reset'|'death';cause:string;script:string;amount:number;beforeHp:number;afterHp:number;source:EncounterActor|null;target:EncounterActor;lethalEventId?:string;omittedBefore?:number};
type Journal={stream:string;sequence:number;events:EncounterEvent[];lastDeath:EncounterEvent[];supported:boolean;deathAt:number|null;droppedAt:number[]};
const journals=new WeakMap<Player,Journal>(),identities=new WeakMap<Actor,string>();
const epochs=new WeakMap<Actor,number>();
const watchers=new WeakMap<Actor,Map<Player,number>>();
const poison=new WeakMap<Actor,EncounterCause>();
export function encounterJournal(player:Player){let journal=journals.get(player);if(!journal){journal={stream:randomUUID(),sequence:0,events:[],lastDeath:[],supported:false,deathAt:null,droppedAt:[]};journals.set(player,journal);}return journal;}
export function actorSnapshot(actor:Actor,live=true):EncounterActor{
  let entityId=identities.get(actor);if(!entityId){entityId=randomUUID();identities.set(actor,entityId);}
  const player=actor instanceof Player;
  return {kind:player?'player':'npc',entityId,id:player?null:(actor as Npc).type,index:player?(actor as Player).slot:(actor as Npc).nid,
    name:String(player?displayNames.get((actor as Player).username):NpcType.get((actor as Npc).type).name??NpcType.get((actor as Npc).type).debugname??'NPC').slice(0,80),
    hp:live?actor.levels[3]:null,maxHp:actor.baseLevels[3],position:live?{x:actor.x,z:actor.z,plane:actor.level}:null};
}
export function resetEncounterActor(actor:Actor){epochs.set(actor,(epochs.get(actor)??0)+1);identities.delete(actor);watchers.delete(actor);poison.delete(actor);}
function liveSource(context:EncounterCause|null){
  if(!context?.source)return context?.identity?{...context.identity,hp:null,maxHp:null,position:null}:null;
  const actor=context.source,live=actor instanceof Player?World.getPlayerByUid(actor.uid)===actor:World.npcs.get(actor.nid)===actor&&actor.isActive;
  return live&&(context.sourceEpoch===undefined||context.sourceEpoch===(epochs.get(actor)??0))&&actorSnapshot(actor).entityId===context.identity?.entityId?actorSnapshot(actor):context.identity?{...context.identity,hp:null,maxHp:null,position:null}:null;
}
function scriptName(state:ScriptState){return String(state.frames[0]?.script.name??state.script.name).slice(0,180);}
function selfActor(state:ScriptState):Actor|null{return state.self instanceof Player||state.self instanceof Npc?state.self:null;}
export function queueEncounterCause(state:ScriptState,name:string,target:Actor,queueId?:number):EncounterCause{
  const self=selfActor(state),known=/combat_damage_player|pvp_damage|recoil_damage|poison_player/.test(name)||queueId===2;
  const source=self!==target?self:null;
  return {source,identity:source?actorSnapshot(source):null,...(source?{sourceEpoch:epochs.get(source)??0}:{}),cause:/recoil_damage/.test(name)||queueId===2&&/combat_damage_player|pvp_damage/.test(state.script.name)?'recoil':/poison/.test(name)?'poison':source instanceof Npc?(known?'npc_attack':'npc_script'):source instanceof Player?(known?'player_attack':'player_script'):'scripted_damage',script:scriptName(state)};
}
export function scriptEncounterCause(state:ScriptState,target:Actor):EncounterCause{
  const root=scriptName(state),isPoison=/poison_damage|npc_poison_timer/.test(root+' '+state.script.name);
  if(isPoison)return {...(poison.get(target)??{source:null,identity:null,script:root}),cause:'poison'};
  if(state.encounterCause)return state.encounterCause;
  const self=selfActor(state);
  if(self&&self!==target)return {source:self,identity:actorSnapshot(self),sourceEpoch:epochs.get(self)??0,cause:self instanceof Npc?'npc_script':'player_script',script:root};
  return {source:null,identity:null,cause:'scripted_damage',script:root};
}
export function updatePoisonOrigin(target:Actor,before:number,after:number,state:ScriptState){
  if(after<=0){poison.delete(target);return;}
  if(after>before){const context=state.encounterCause??queueEncounterCause(state,'poison_player',target);poison.set(target,{...context,cause:'poison'});}
}
function emit(player:Player,event:Omit<EncounterEvent,'id'>){
  const journal=encounterJournal(player);
  journal.droppedAt=journal.droppedAt.filter(at=>event.at-at<=10000);
  const record:EncounterEvent={...event,id:journal.stream+':'+(++journal.sequence),...(event.kind==='death'?{omittedBefore:journal.droppedAt.length}:{})};
  const pending=[...journal.events.filter(e=>record.at-e.at<=10000),record];
  journal.droppedAt.push(...pending.slice(0,Math.max(0,pending.length-160)).map(e=>e.at));
  if(record.kind==='death')record.omittedBefore=journal.droppedAt.length;
  journal.events=pending.slice(-160);
  if(record.kind==='death'&&record.target.entityId===actorSnapshot(player).entityId)journal.lastDeath=[...journal.events];
  if(journal.supported){player.write(new EncounterMessage({version:1,stream:journal.stream,ownerId:actorSnapshot(player).entityId,events:[record]}));
    if(record.kind==='death'&&record.target.entityId===actorSnapshot(player).entityId)for(const entry of journal.lastDeath)player.write(new EncounterMessage({version:1,stream:journal.stream,ownerId:actorSnapshot(player).entityId,events:[entry]}));}
}
export function subscribeEncounters(player:Player){
  const journal=encounterJournal(player);if(journal.supported)return;journal.supported=true;
  const events=[...new Map([...journal.lastDeath,...journal.events].map(e=>[e.id,e])).values()].slice(-320);
  for(const event of events)player.write(new EncounterMessage({version:1,stream:journal.stream,ownerId:actorSnapshot(player).entityId,events:[event]}));
  if(!events.length)player.write(new EncounterMessage({version:1,stream:journal.stream,ownerId:actorSnapshot(player).entityId,events:[]}));
}
export function recordHealth(target:Actor,beforeHp:number,context:EncounterCause|null,kind:'damage'|'healing'|'stat_loss',at=Date.now()){
  const afterHp=target.levels[3];
  const existing=watchers.get(target);
  if(existing)for(const [player,time] of existing)if(at-time>10000||World.getPlayerByUid(player.uid)!==player)existing.delete(player);
  if(kind!=='damage'&&afterHp===beforeHp)return;
  if(target instanceof Player&&beforeHp===0&&afterHp>0)epochs.set(target,(epochs.get(target)??0)+1);
  const source=liveSource(context),targetSnapshot=actorSnapshot(target),recipients=new Set<Player>();
  if(target instanceof Player)recipients.add(target);
  if(context?.source instanceof Player&&World.getPlayerByUid(context.source.uid)===context.source)recipients.add(context.source);
  if(kind==='damage'){
    for(const actor of [target,context?.source].filter((e):e is Npc=>e instanceof Npc)){
      const watching=watchers.get(actor)??new Map<Player,number>();for(const [player,time] of watching)if(at-time>10000||World.getPlayerByUid(player.uid)!==player)watching.delete(player);for(const player of recipients)watching.set(player,at);watchers.set(actor,watching);
    }
  }
  const watching=watchers.get(target);
  if(watching&&kind==='healing'&&target instanceof Npc)for(const [player,time] of watching){if(at-time<=10000&&World.getPlayerByUid(player.uid)===player)recipients.add(player);else watching.delete(player);}
  // A snapshot's opponent belongs only to this encounter; unrelated bystanders
  // never receive events. Per-recipient IDs also prevent cross-stream replay.
  const event:Omit<EncounterEvent,'id'>={version:1,tick:World.currentTick,at,kind:beforeHp===0&&afterHp>0?'life_reset':afterHp>beforeHp?'healing':afterHp<beforeHp&&kind==='healing'?'stat_loss':kind,cause:context?.cause??'unknown',script:context?.script??'unknown',amount:Math.abs(afterHp-beforeHp),beforeHp,afterHp,source,target:targetSnapshot};
  for(const player of recipients){
    const journal=encounterJournal(player);
    if(event.kind==='life_reset'&&target===player)journal.deathAt=null;
    if(kind==='damage'||beforeHp!==afterHp)emit(player,event);
    if(beforeHp>0&&afterHp===0){
      const lethalEventId=journal.events.at(-1)?.id;
      emit(player,{...event,kind:'death',amount:0,lethalEventId});
      if(target===player)journal.deathAt=at;
    }
  }
}
