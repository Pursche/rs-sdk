import Packet from '#/io/Packet.js';
import ServerGameMessageEncoder from '#/network/game/server/ServerGameMessageEncoder.js';
import ServerGameProt from '#/network/game/server/ServerGameProt.js';
import EncounterMessage from '#/network/game/server/model/EncounterMessage.js';
export default class EncounterMessageEncoder extends ServerGameMessageEncoder<EncounterMessage>{
  prot=ServerGameProt.ENCOUNTER_EVENTS;
  encode(buf:Packet,message:EncounterMessage){buf.pjstr(JSON.stringify(message.payload).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));}
}
