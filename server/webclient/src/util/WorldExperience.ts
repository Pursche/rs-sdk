// One shared table for the browser, lite client, and interface scripts.
export const worldExperience: number[] = [];
let accumulated = 0;
for (let level = 1; level <= 99; level++) {
    accumulated += Math.floor(level + Math.pow(2, level / 7) * 300);
    worldExperience.push(Math.floor(accumulated / 4));
}

export async function loadWorldExperience(origin: string): Promise<void> {
    const response = await fetch(`${origin}/world-settings`, { cache: 'no-store' });
    // Older upstream servers use the standard table and lack this endpoint.
    if (response.status === 404) return;
    if (!response.ok) throw new Error('Could not load world XP thresholds');
    const { experience } = await response.json();
    if (!Array.isArray(experience) || experience.length !== 99 ||
        experience.some((xp, index) => !Number.isInteger(xp) || xp <= 0 || (index > 0 && xp <= experience[index - 1])))
        throw new Error('Invalid world XP thresholds');
    worldExperience.splice(0, worldExperience.length, ...experience);
}
