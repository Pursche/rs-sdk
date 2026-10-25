/**
 * Logic test for sdk.clickDialogByText() — no bot required.
 *
 * Verifies the helper resolves dialog options by visible text and dispatches
 * the published index with a page token and exact component ID.
 */

import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import type { ActionResult, BotAction, BotWorldState, DialogOption } from '../types';

function makeOption(index: number, text: string): DialogOption {
    return { index, text, componentId: 1000 + index, buttonType: 0 };
}

function makeState(opts: { dialogOpen: boolean; options?: DialogOption[] }): BotWorldState {
    // Only the dialog field matters — cast the rest. clickDialogByText only
    // touches state.dialog.
    return {
        dialog: {
            isOpen: opts.dialogOpen,
            options: opts.options ?? [],
            isWaiting: false,
            pageId: 'test-page',
        },
    } as unknown as BotWorldState;
}

function mountSdk(state: BotWorldState | null): { sdk: BotSDK; calls: number[]; actions: BotAction[] } {
    const sdk = new BotSDK({ botUsername: 'test' });
    (sdk as any).state = state;

    // Stub the protocol-level call so we can record what the helper dispatches.
    const calls: number[] = [];
    const actions: BotAction[] = [];
    (sdk as any).sendAction = async (action: BotAction): Promise<ActionResult> => {
        actions.push(action);
        if (action.type === 'clickDialogOption') calls.push(action.optionIndex);
        return { success: true, message: 'stub-clicked' };
    };

    return { sdk, calls, actions };
}

describe('clickDialogByText()', () => {
    test('rejects ambiguous production choices instead of silently selecting Smelt X', async () => {
        const { sdk, actions } = mountSdk(makeState({ dialogOpen: true, options: [
            makeOption(1, 'Smelt X Bronze'), makeOption(2, 'Smelt 10 Bronze'), makeOption(3, 'Smelt 5 Bronze'), makeOption(4, '\\n\\n\\n\\nBronze')
        ] }));
        expect(await sdk.clickDialogByText(/bronze/i)).toMatchObject({success:false,reason:'ambiguous_match'});
        expect(actions).toEqual([]);
        expect(await sdk.clickDialogByText(/^Bronze$/i)).toMatchObject({success:true});
        expect(actions[0]).toMatchObject({type:'clickDialogOption',optionIndex:4});
    });

    test('stateful regex selectors are reset for each visible choice', async () => {
        const {sdk,calls}=mountSdk(makeState({dialogOpen:true,options:[makeOption(1,'No'),makeOption(2,'Yes')]}));
        const pattern=/yes/gi;pattern.lastIndex=3;
        expect(await sdk.clickDialogByText(pattern)).toMatchObject({success:true});
        expect(calls).toEqual([2]);
    });

    test('sendWait observes server ticks without dispatching the legacy client-frame wait action',async()=>{
        const {sdk,actions}=mountSdk(makeState({dialogOpen:false}));
        const waited:number[]=[];
        sdk.waitForTicks=async ticks=>{waited.push(ticks!);return {} as BotWorldState;};
        expect(await sdk.sendWait(5)).toMatchObject({success:true,message:'Waited 5 server ticks'});
        expect(waited).toEqual([5]);expect(actions).toEqual([]);
        expect(sdk.sendWait(0)).rejects.toThrow('positive integer');
    });
    test('sends the page token and exact component ID selected from that snapshot', async () => {
        const { sdk, actions } = mountSdk(makeState({ dialogOpen: true, options: [makeOption(2, 'Yes')] }));
        expect((await sdk.clickDialogByText('yes')).success).toBe(true);
        expect(actions).toEqual([{
            type: 'clickDialogOption', optionIndex: 2,
            guard: { pageId: 'test-page', componentId: 1002 }, reason: 'SDK'
        }]);
    });

    for (const missing of ['pageId', 'componentId'] as const) {
        test(`refuses legacy state missing ${missing} without dispatching`, async () => {
            const state = makeState({ dialogOpen: true, options: [makeOption(1, 'Yes')] });
            if (missing === 'pageId') delete state.dialog.pageId;
            else delete state.dialog.options[0]!.componentId;
            const { sdk, actions } = mountSdk(state);
            expect(await sdk.clickDialogByText('yes')).toMatchObject({ success: false, reason: 'unsupported_client' });
            expect(actions).toEqual([]);
        });
    }

    test('returns no_dialog when dialog is closed', async () => {
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: false }));
        const r = await sdk.clickDialogByText(/yes/i);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_dialog');
        expect(calls).toEqual([]);
    });

    test('returns no_dialog when state is null', async () => {
        const { sdk, calls } = mountSdk(null);
        const r = await sdk.clickDialogByText(/yes/i);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_dialog');
        expect(calls).toEqual([]);
    });

    // The core footgun fix: array position 0 maps to server index 1.
    test('dispatches server-assigned index 1 for first option (NOT array position 0)', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/yes/i);

        expect(r.success).toBe(true);
        expect(calls).toEqual([1]);
    });

    test('dispatches index 2 for the alleyway option', async () => {
        const options = [
            makeOption(1, 'Yes, ok.'),
            makeOption(2, 'Is there anything down this alleyway?'),
            makeOption(3, 'No thanks.'),
        ];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText('alleyway');

        expect(r.success).toBe(true);
        expect(calls).toEqual([2]);
    });

    test('string pattern is case-insensitive', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText('YES');

        expect(r.success).toBe(true);
        expect(calls).toEqual([1]);
    });

    // Caller-supplied RegExp flags are respected — no /i means no match on "Yes".
    test('explicit RegExp without /i is honoured (no match)', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/YES/);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_match');
        expect(calls).toEqual([]);
    });

    test('returns no_match when no option matches, listing available options', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/maybe/i);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_match');
        expect(r.message).toContain('Yes, ok.');
        expect(r.message).toContain('No thanks.');
        expect(calls).toEqual([]);
    });

    test('returns no_match when option list is empty', async () => {
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options: [] }));
        const r = await sdk.clickDialogByText(/anything/);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_match');
        expect(r.message).toContain('(none)');
        expect(calls).toEqual([]);
    });

    // Real dialogs assign 1..N contiguously today, but the SDK must never
    // assume that — it has to trust DialogOption.index.
    test('passes through non-contiguous server-assigned indices', async () => {
        const options = [makeOption(7, 'Yes, ok.'), makeOption(42, 'Tell me more.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/tell me/i);

        expect(r.success).toBe(true);
        expect(calls).toEqual([42]);
    });
});
