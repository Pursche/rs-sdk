import ServerGameMessage from '#/network/game/server/ServerGameMessage.js';
import type {EncounterEvent} from '#/engine/entity/tracking/EncounterJournal.js';
export default class EncounterMessage extends ServerGameMessage{
  constructor(readonly payload:{version:1;stream:string;ownerId:string;events:EncounterEvent[]}){super();}
}
