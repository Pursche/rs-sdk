import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

function harness() {
    const sdk = new BotSDK({ botUsername: 'test', password: 'test', autoLaunchBrowser: false });
    const internal = sdk as any;
    internal.state = {
        inventory: [], gameMessages: [{ tick: 1, text: 'Logs: shop will buy for 1gp.' }],
        shop: { isOpen: true, shopItems: [], playerItems: [
            { slot: 0, id: 1511, name: 'Logs', count: 1, baseCost: 4, sellPrice: 1, buyPrice: 5 },
            { slot: 1, id: 1511, name: 'Logs', count: 1, baseCost: 4, sellPrice: 1, buyPrice: 5 },
            { slot: 2, id: 995, name: 'Coins', count: 10 },
        ] },
    };
    return { sdk, bot: new BotActions(sdk), state: internal.state };
}

describe('shop sale evidence', () => {
    for (const amount of [1, 'all'] as const) {
        for (const payout of [0, 3]) {
            test(`${amount} sale reports actual ${payout} GP per item, not estimated prices`, async () => {
                const { sdk, bot, state } = harness();
                // The reported failure had no existing coin stack at all.
                if (payout === 0) state.shop.playerItems = state.shop.playerItems.filter((item: any) => item.id !== 995);
                sdk.sendShopSell = async (slot) => {
                    state.shop.playerItems = state.shop.playerItems.filter((item: any) => item.slot !== slot);
                    if (payout > 0) state.shop.playerItems.find((item: any) => item.id === 995).count += payout;
                    return { success: true, message: 'sent' };
                };
                const sold = amount === 'all' ? 2 : 1;
                expect(await bot.sellToShop(/^logs$/i, amount)).toMatchObject({
                    success: true, amountSold: sold, coinsReceived: sold * payout,
                    message: `Sold Logs x${sold}; received ${sold * payout} GP`,
                });
            });
        }
    }

    test('reads a fresh zero offer without selling and ignores the old estimate', async () => {
        const { sdk, bot, state } = harness();
        sdk.sendClickComponentWithOption = async (component, option, slot) => {
            expect([component, option, slot]).toEqual([3823, 1, 0]);
            state.gameMessages.push({ tick: 2, text: 'Logs: shop will buy for 0gp.' });
            return { success: true, message: 'sent' };
        };
        sdk.sendShopSell = async () => { throw new Error('Value must not sell'); };
        expect(await bot.getShopSellPrice(/^logs$/i)).toMatchObject({ success: true, price: 0 });
        expect(state.shop.playerItems).toHaveLength(3);
    });

    test('returns refusal instead of a stale quote', async () => {
        const { sdk, bot, state } = harness();
        sdk.sendClickComponentWithOption = async () => {
            state.gameMessages.push({ tick: 2, text: "You can't sell this item to this shop." });
            return { success: true, message: 'sent' };
        };
        const result = await bot.getShopSellPrice('Logs');
        expect(result).toMatchObject({ success: false });
        expect(result.price).toBeUndefined();
    });

    test('does not value an absent item or a closed shop', async () => {
        const { sdk, bot, state } = harness();
        sdk.sendClickComponentWithOption = async () => { throw new Error('must not click'); };
        expect(await bot.getShopSellPrice('Sword')).toMatchObject({ success: false });
        state.shop.isOpen = false;
        expect(await bot.getShopSellPrice('Logs')).toMatchObject({ success: false });
    });
});
