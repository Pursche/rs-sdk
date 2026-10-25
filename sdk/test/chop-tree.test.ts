import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

function harness() {
    const sdk = new BotSDK({ botUsername:'test', password:'test', autoLaunchBrowser:false });
    const internal = sdk as any;
    internal.state = {
        tick:1, player:{animId:-1}, inventory:[], skills:[], gameMessages:[], recentDialogs:[],
        nearbyLocs:[{id:1751,name:'Oak',x:3200,z:3200,distance:1,optionsWithIndex:[{text:'Chop down',opIndex:1}]}],
        dialog:{isOpen:false}, interface:{isOpen:false},
    };
    sdk.sendInteractLoc = async () => ({success:true,message:'dispatched'});
    return {sdk,internal,bot:new BotActions(sdk)};
}

describe('chopTree refusal evidence', () => {
    test('returns required Woodcutting level immediately from a fresh game message', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.gameMessages.push({tick:2,text:'You need a Woodcutting level of 15 to chop down this tree.'});
            return {success:true,message:'dispatched'};
        };
        expect(await h.bot.chopTree(/oak/i)).toMatchObject({success:false,reason:'level_too_low',requiredLevel:15});
    });

    test('also recognizes a fresh dialogue without calling it another player felling the tree', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.dialog = {isOpen:true,pageId:'new',text:'You need a Woodcutting level of 60 to chop down this tree.'};
            h.internal.state.nearbyLocs = [];
            return {success:true,message:'dispatched'};
        };
        expect(await h.bot.chopTree(/oak/i)).toMatchObject({reason:'level_too_low',requiredLevel:60});
    });

    test('ignores old level refusals when the current chop produces logs', async () => {
        const h = harness();
        const text = 'You need a Woodcutting level of 60 to chop down this tree.';
        h.internal.state.gameMessages = [{tick:1,observationId:20,text}];
        h.internal.state.recentDialogs = [{tick:1,observationId:21,text:[text]}];
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.inventory = [{id:1521,name:'Oak logs',count:1,slot:0}];
            return {success:true,message:'dispatched'};
        };
        expect(await h.bot.chopTree(/oak/i)).toMatchObject({success:true,logs:{name:'Oak logs'}});
    });

    test('preserves tree contention handling when no logs or refusal arrive', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.nearbyLocs = [];
            return {success:true,message:'dispatched'};
        };
        const result = await h.bot.chopTree(/oak/i);
        expect(result.success).toBe(false);
        expect(result.message).toContain('felled by someone else');
        expect(result.reason).toBeUndefined();
    });

    test('reports other explicit refusals without inventing a level requirement', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.gameMessages.push({tick:2,text:'Your inventory is too full to hold any more logs.'});
            return {success:true,message:'dispatched'};
        };
        const result = await h.bot.chopTree(/oak/i);
        expect(result.reason).toBe('rejected');
        expect(result.requiredLevel).toBeUndefined();
    });
});
