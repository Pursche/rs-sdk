import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import Environment from './Environment.js';

const path = 'data/config/panel-world.json';
const tokenPath = 'data/config/panel-world.token';
export type WorldSettings = { xpRate: number; curveDivisor: number; tickMs: number; stockDependentShopPricing?: boolean; unlimitedGeneralStoreSales?: boolean; communityCraftingMode?: boolean };

export function validateWorldSettings(value: WorldSettings): WorldSettings {
    if (!Number.isFinite(value.xpRate) || value.xpRate < 0.1 || value.xpRate > 100)
        throw new Error('XP multiplier must be between 0.1 and 100');
    if (!Number.isFinite(value.curveDivisor) || value.curveDivisor < 6 || value.curveDivisor > 20)
        throw new Error('Curve divisor must be between 6 and 20');
    if (!Number.isInteger(value.tickMs) || value.tickMs < 100 || value.tickMs > 2000)
        throw new Error('Tick duration must be an integer between 100 and 2000 ms');
    if (value.stockDependentShopPricing !== undefined && typeof value.stockDependentShopPricing !== 'boolean')
        throw new Error('Stock-dependent shop pricing must be a boolean');
    if (value.unlimitedGeneralStoreSales !== undefined && typeof value.unlimitedGeneralStoreSales !== 'boolean')
        throw new Error('Unlimited general-store sales must be a boolean');
    if (value.communityCraftingMode !== undefined && typeof value.communityCraftingMode !== 'boolean')
        throw new Error('Community Crafting Mode must be a boolean');
    return { xpRate: value.xpRate, curveDivisor: value.curveDivisor, tickMs: value.tickMs,
        stockDependentShopPricing: value.stockDependentShopPricing ?? false,
        unlimitedGeneralStoreSales: value.unlimitedGeneralStoreSales ?? true,
        communityCraftingMode: value.communityCraftingMode ?? false };
}

export const activeWorldSettings = validateWorldSettings(fs.existsSync(path)
    ? JSON.parse(fs.readFileSync(path, 'utf8'))
    : { xpRate: Environment.node.xpRate, curveDivisor: 7, tickMs: Environment.NODE_TICKRATE });

export function saveWorldSettings(settings: WorldSettings): void {
    const validated = validateWorldSettings(settings);
    fs.writeFileSync(`${path}.tmp`, JSON.stringify(validated, null, 2) + '\n');
    fs.renameSync(`${path}.tmp`, path);
}

fs.mkdirSync('data/config', { recursive: true });
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, randomUUID(), { mode: 0o600 });
export const worldSettingsToken = fs.readFileSync(tokenPath, 'utf8').trim();

// Real XP units; the engine's internal table uses ten times these values.
export const worldExperience: number[] = [];
let accumulated = 0;
for (let level = 1; level <= 99; level++) {
    accumulated += Math.floor(level + Math.pow(2, level / activeWorldSettings.curveDivisor) * 300);
    worldExperience.push(Math.floor(accumulated / 4));
}
