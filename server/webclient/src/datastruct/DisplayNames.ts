let names: Record<string, string> = Object.create(null);
export function setDisplayNames(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const next: Record<string, string> = Object.create(null);
    for (const [key, name] of Object.entries(value)) {
        if (typeof name === 'string' && /^[a-zA-Z0-9_ ]{1,12}$/.test(name) && /^[a-z0-9_]{1,12}$/.test(key) && name.toLowerCase().replaceAll(' ', '_') === key) next[key] = name.replaceAll('_', ' ');
    }
    names = next;
}
export function displayNameOf(raw: string): string | undefined { return names[raw.toLowerCase().replaceAll(' ', '_')]; }
export async function refreshDisplayNames(origin = ''): Promise<void> {
    try {
        const response = await fetch(`${origin}/display-names.json`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (response.ok) setDisplayNames(await response.json());
    } catch { /* Old servers and temporary network failures keep normal legacy names. */ }
}
