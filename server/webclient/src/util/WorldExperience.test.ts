import { afterEach, expect, test } from 'bun:test';
import { loadWorldExperience, worldExperience } from './WorldExperience.js';

const originalFetch = globalThis.fetch;
const standard = [...worldExperience];
afterEach(() => {
    globalThis.fetch = originalFetch;
    worldExperience.splice(0, worldExperience.length, ...standard);
});

test('standard RuneScape level thresholds', () => {
    expect(worldExperience[8]).toBe(1154);
    expect(worldExperience[48]).toBe(101333);
    expect(worldExperience[97]).toBe(13034431);
});

test('server thresholds update existing table references', async () => {
    const reference = worldExperience;
    const custom = standard.map(xp => xp + 1);
    globalThis.fetch = (async () => Response.json({ experience: custom })) as typeof fetch;
    await loadWorldExperience('http://localhost');
    expect(worldExperience).toBe(reference);
    expect(reference[97]).toBe(13034432);
});

test('invalid server thresholds fail without changing the current table', async () => {
    globalThis.fetch = (async () => Response.json({ experience: [100, 0] })) as typeof fetch;
    await expect(loadWorldExperience('http://localhost')).rejects.toThrow('Invalid world XP thresholds');
    expect(worldExperience).toEqual(standard);
});
