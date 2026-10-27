import ClientGameMessage from '#/network/game/client/ClientGameMessage.js';
import ClientGameProtCategory from '#/network/game/client/ClientGameProtCategory.js';
import ClientGameMessageDecoder from '#/network/game/client/ClientGameMessageDecoder.js';
import ClientGameMessageHandler from '#/network/game/client/ClientGameMessageHandler.js';
import ClientGameProt from '#/network/game/client/ClientGameProt.js';
import Player from '#/engine/entity/Player.js';
import {subscribeEncounters} from '#/engine/entity/tracking/EncounterJournal.js';
class EncounterSubscribe extends ClientGameMessage{category=ClientGameProtCategory.USER_EVENT;}
export class EncounterSubscribeDecoder extends ClientGameMessageDecoder<EncounterSubscribe>{prot=ClientGameProt.ENCOUNTER_SUBSCRIBE;decode(){return new EncounterSubscribe();}}
export class EncounterSubscribeHandler extends ClientGameMessageHandler<EncounterSubscribe>{handle(_message:EncounterSubscribe,player:Player){subscribeEncounters(player);return true;}}
