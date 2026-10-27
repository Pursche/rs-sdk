import ObjType from '#/cache/config/ObjType.js';
import InvType from '#/cache/config/InvType.js';
import CategoryType from '#/cache/config/CategoryType.js';
import DbTableType from '#/cache/config/DbTableType.js';
import DbRowType from '#/cache/config/DbRowType.js';
import { activeWorldSettings } from '#/util/WorldSettings.js';
import type { Inventory } from '#/engine/Inventory.js';

const restricted = new Set<number>();
export function loadCommunityCraftingItems() {
    restricted.clear();
    const add = (id: unknown) => { if (typeof id === 'number' && id >= 0) restricted.add(id); };
    for (const [name, fields] of [
        ['smithing', ['product']], ['fletching_table', ['product']],
        ['fletch_bow_table', ['shortbow', 'longbow']]
    ] as const) {
        const table = DbTableType.getByName(name);
        if (!table) throw new Error(`Community Crafting requires packed ${name} recipes`);
        for (const row of DbRowType.getInTable(table.id)) for (const field of fields) {
            const column = table.columnNames.indexOf(field);
            if (column >= 0) add(row.columnValues[column]?.[0]);
        }
    }
    const ranged = new Set(['weapon_bow', 'unstrung_bow', 'weapon_crossbow', 'arrows', 'bolts', 'weapon_thrown']);
    const components = new Set(['arrow_shaft', 'headless_arrow', 'ogre_arrow_shaft', 'ogre_headless_arrow', 'wolfbone_arrowheads', 'macro_pickaxehandle']);
    for (const obj of ObjType.configs) {
        if (!obj || obj.certtemplate >= 0) continue;
        const name = obj.debugname ?? '';
        if (/^(bronze|iron|steel|mithril|adamant|rune)_pickaxe$/.test(name) ||
            /^black_(axe|battleaxe|dagger|sword|longsword|2h_sword|scimitar|mace|warhammer|halberd|med_helm|full_helm|sq_shield|kiteshield|platelegs|plateskirt|chainbody|platebody)$/.test(name) ||
            ranged.has(CategoryType.get(obj.category)?.debugname ?? '') || components.has(name)) add(obj.id);
    }
    restricted.delete(ObjType.getId('bronze_axe'));
    restricted.delete(ObjType.getId('bronze_pickaxe'));
}

export function communityRestricted(id: number) {
    const obj = ObjType.get(id);
    return restricted.has(obj?.certtemplate >= 0 ? obj.certlink : id);
}
export function communityShop(inv: number) {
    const type = InvType.get(inv);
    return !!type && type.scope === InvType.SCOPE_SHARED && type.restock;
}
export function communityShopAllows(inv: number, obj: number) {
    return !activeWorldSettings.communityCraftingMode || !communityRestricted(obj) || InvType.get(inv).allstock;
}

// Item identity, not slot identity: suppressed stock slots can be reused for
// player deliveries. Zero sold stock must never regenerate from a base count.
export function restockShop(inv: Inventory, tick: number) {
    const type = InvType.get(inv.type);
    if (!type.restock || !type.stockobj || !type.stockcount || !type.stockrate) return;
    for (let i = 0; i < type.stockobj.length; i++) {
        const id = type.stockobj[i];
        if (activeWorldSettings.communityCraftingMode && communityRestricted(id)) continue;
        if (tick % type.stockrate[i] !== 0) continue;
        const count = inv.getItemCount(id), base = type.stockcount[i];
        if (count < base) inv.add(id, 1, -1, 'stock');
        else if (count > base) inv.remove(id, 1);
    }
    if (type.allstock && tick % 100 === 0) for (const item of [...inv.itemsFiltered]) {
        if (type.stockobj.includes(item.id)) continue;
        if (activeWorldSettings.communityCraftingMode && communityRestricted(item.id)) continue;
        inv.remove(item.id, 1);
    }
}
