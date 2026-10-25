import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

function harness() {
    const sdk = new BotSDK({ botUsername: 'test', password: 'test', autoLaunchBrowser: false });
    const internal = sdk as any;
    internal.state = {
        tick: 1, player: { animId: 625 }, inventory: [],
        skills: [{ name: 'Mining', experience: 0 }],
        nearbyLocs: [{ id: 2090, name: 'Rocks copper ore', x: 3282, z: 3367, distance: 1, reachable: true, optionsWithIndex: [{ text: 'Mine', opIndex: 1 }] }],
        gameMessages: [], dialog: { isOpen: false }, interface: { isOpen: false },
    };
    const bot = new BotActions(sdk);
    sdk.sendInteractLoc = async () => ({ success: true, message: 'dispatched' });
    return { sdk, bot, internal };
}

describe('mineRock completion evidence', () => {
    test('reports depletion after allowing late ore and XP packets to settle',async()=>{
        const h=harness();let settled=false;
        const work=h.bot.mineRock(/copper ore/i,{timeout:1000}).then(r=>{settled=true;return r;});
        await new Promise(resolve=>setTimeout(resolve,0));
        h.internal.state.nearbyLocs[0].id=452;
        const publish=(tick:number)=>{h.internal.state.tick=tick;for(const l of h.internal.stateListeners)l(h.internal.state);};
        publish(2);await Promise.resolve();expect(settled).toBeFalse();
        publish(4);expect(await work).toMatchObject({success:false,reason:'depleted',oresMined:0});
    });

    test('late output takes precedence over the target depletion',async()=>{
        const h=harness();const work=h.bot.mineRock(/copper ore/i,{timeout:1000});
        await new Promise(resolve=>setTimeout(resolve,0));
        h.internal.state.nearbyLocs[0].id=452;h.internal.state.tick=2;
        for(const l of h.internal.stateListeners)l(h.internal.state);
        h.internal.state.tick=3;h.internal.state.skills[0].experience=17;
        h.internal.state.inventory=[{id:436,name:'Copper ore',count:1,slot:0}];
        for(const l of h.internal.stateListeners)l(h.internal.state);
        expect(await work).toMatchObject({success:true,oresMined:1,xpGained:17});
    });

    test('does not dispatch a stale object whose tile now contains depleted rock',async()=>{
        const h=harness(),target={...h.internal.state.nearbyLocs[0]};
        h.internal.state.nearbyLocs[0].id=452;
        h.sdk.sendInteractLoc=async()=>{throw Error('must not dispatch');};
        expect(await h.bot.mineRock(target)).toMatchObject({reason:'depleted'});
    });
    test('reports level and required level immediately from a new dialogue', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.dialog = { isOpen: true, pageId: 'coal-refusal', text: 'You need a Mining level of 30 to mine this rock.' };
            return { success: true, message: 'dispatched' };
        };
        expect(await h.bot.mineRock(/copper ore/i, { timeout: 1000 })).toMatchObject({ success: false, reason: 'level_too_low', requiredLevel: 30, oresMined: 0 });
    });

    test('detects a newly published refusal even after the dialogue closes', async () => {
        const h = harness();
        h.internal.state.recentDialogs = [{tick:1,observationId:10,text:['Old page']}];
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.recentDialogs.push({tick:1,observationId:11,text:['You need a Mining level of 55 to mine this rock.']});
            return { success: true, message: 'dispatched' };
        };
        expect(await h.bot.mineRock(/copper ore/i, { timeout: 1000 })).toMatchObject({ reason:'level_too_low', requiredLevel:55 });
    });

    test('does not mistake an old dialogue refusal for a new mining failure', async () => {
        const h = harness();
        h.internal.state.recentDialogs = [{tick:1,observationId:10,text:['You need a Mining level of 55 to mine this rock.']}];
        expect(await h.bot.mineRock(/copper ore/i, { timeout: 10 })).toMatchObject({ reason:'timeout' });
    });

    test('reports other fresh dialogue refusals without inventing a skill requirement', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.dialog = { isOpen:true, text:'You need a Pickaxe to mine this rock.' };
            return {success:true,message:'dispatched'};
        };
        const result = await h.bot.mineRock(/copper ore/i, {timeout:1000});
        expect(result.reason).toBe('rejected');
        expect(result.requiredLevel).toBeUndefined();
    });

    test('waits past a heuristic rejection until ore and XP arrive', async () => {
        const h = harness();
        h.internal.state.opFeedback = { opRejectedCount: 0 };
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.opFeedback.opRejectedCount++;
            return { success: true, message: 'dispatched' };
        };
        let settled = false;
        const work = h.bot.mineRock(/copper ore/i, { timeout: 1000 }).then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(settled).toBeFalse();
        h.internal.state.skills[0].experience = 17;
        h.internal.state.inventory = [{ id: 436, name: 'Copper ore', count: 1, slot: 0 }];
        for (const listener of h.internal.stateListeners) listener(h.internal.state);
        expect(await work).toMatchObject({ success: true, oresMined: 1, xpGained: 17 });
    });

    test('still stops on an explicit mining refusal', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.gameMessages = [{ tick: 2, text: 'You need a Pickaxe to mine this rock.' }];
            return { success: true, message: 'dispatched' };
        };
        expect(await h.bot.mineRock(/copper ore/i)).toMatchObject({ success: false, reason: 'rejected', oresMined: 0 });
    });

    test('a heuristic rejection alone remains bounded by the timeout', async () => {
        const h = harness();
        h.internal.state.opFeedback = { opRejectedCount: 0 };
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.opFeedback.opRejectedCount++;
            return { success: true, message: 'dispatched' };
        };
        expect(await h.bot.mineRock(/copper ore/i, { timeout: 10 })).toMatchObject({ success: false, reason: 'timeout' });
    });

    test('does not complete on animation, XP alone, or an unrelated ore', async () => {
        const h = harness();
        let settled = false;
        const work = h.bot.mineRock(/copper ore/i, { timeout: 1000 }).then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 0));
        const publish = () => { for (const listener of h.internal.stateListeners) listener(h.internal.state); };
        publish();
        await Promise.resolve();
        expect(settled).toBeFalse();
        h.internal.state.skills[0].experience = 437;
        h.internal.state.inventory = [{ id: 438, name: 'Tin ore', count: 1, slot: 0 }];
        publish();
        await Promise.resolve();
        expect(settled).toBeFalse();
        h.internal.state.inventory.push({ id: 436, name: 'Copper ore', count: 1, slot: 1 });
        publish();
        const result = await work;
        expect(result).toMatchObject({ success: true, oresMined: 1, xpGained: 437, ore: { name: 'Copper ore' } });
        expect(h.internal.stateListeners.size).toBe(0);
    });

    test('times out when a mining animation never produces ore', async () => {
        const result = await harness().bot.mineRock(/copper ore/i, { timeout: 10 });
        expect(result).toMatchObject({ success: false, reason: 'timeout', oresMined: 0 });
    });

    test('gives a clear failure for an inventory-only selector', async () => {
        expect(await harness().bot.mineRock(/^copper ore$/i)).toMatchObject({ success: false, reason: 'loc_not_found' });
    });

    test('refuses a full inventory before clicking the rock', async () => {
        const h = harness();
        h.internal.state.inventory = Array.from({ length: 28 }, (_, slot) => ({ id: 436, name: 'Copper ore', count: 1, slot }));
        h.sdk.sendInteractLoc = async () => { throw new Error('must not click'); };
        expect(await h.bot.mineRock(/copper ore/i)).toMatchObject({ success: false, reason: 'inventory_full' });
    });

    test('observes a fast ore completion even when no animation is published', async () => {
        const h = harness();
        h.sdk.sendInteractLoc = async () => {
            h.internal.state.player.animId = -1;
            h.internal.state.skills[0].experience = 437;
            h.internal.state.inventory = [{ id: 436, name: 'Copper ore', count: 1, slot: 0 }];
            return { success: true, message: 'dispatched' };
        };
        expect(await h.bot.mineRock(/copper ore/i)).toMatchObject({ success: true, oresMined: 1, xpGained: 437 });
    });
});
