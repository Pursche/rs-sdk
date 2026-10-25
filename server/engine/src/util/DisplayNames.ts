import fs from 'node:fs';
import { toDisplayName, toSafeName } from './JString.js';

// Display-only registry. Account keys, base-37 wire identities and saves never change.
export class DisplayNames {
    private names: Record<string, string> = Object.create(null);
    private checkedAt = -Infinity;
    constructor(private path = 'data/config/display-names.json') {}
    get(username: string): string {
        this.refresh();
        return this.names[toSafeName(username)] ?? toDisplayName(username);
    }
    refresh(now = Date.now()): void {
        if (now - this.checkedAt < 1000) return;
        this.checkedAt = now;
        try {
            const parsed = JSON.parse(fs.readFileSync(this.path, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
            const names: Record<string, string> = Object.create(null);
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === 'string' && /^[a-zA-Z0-9_ ]{1,12}$/.test(value) && toSafeName(value) === key && key === toSafeName(key)) names[key] = value.replaceAll('_', ' ');
            }
            this.names = names;
        } catch { /* Missing/invalid optional metadata retains the last valid registry. */ }
    }
}
export const displayNames = new DisplayNames();
