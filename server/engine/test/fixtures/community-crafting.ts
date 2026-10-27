import {expect,mock,test} from 'bun:test';
import {EventEmitter} from 'node:events';
class TestWorker extends EventEmitter {postMessage(){}}
mock.module('worker_threads',()=>({Worker:TestWorker}));
const {default:World}=await import('../../src/engine/World.js');
const cache=process.env.COMMUNITY_TEST_CACHE!;
for(const name of ['VarPlayerType','VarBitType','ParamType','ObjType','LocType','NpcType','InvType','SeqType','Component','StructType','DbTableType','DbRowType','EnumType','MesanimType','CategoryType','FontType']) {
    const type=(await import(`../../src/cache/config/${name}.js`)).default;
    type.load(cache);
}
const {default:ObjType}=await import('../../src/cache/config/ObjType.js');
const {default:InvType}=await import('../../src/cache/config/InvType.js');
const {default:Component}=await import('../../src/cache/config/Component.js');
const {default:VarPlayerType}=await import('../../src/cache/config/VarPlayerType.js');
const {default:DbTableIndex}=await import('../../src/cache/config/DbTableIndex.js');
const {default:ScriptProvider}=await import('../../src/engine/script/ScriptProvider.js');
const {default:ScriptRunner}=await import('../../src/engine/script/ScriptRunner.js');
const {default:ScriptState}=await import('../../src/engine/script/ScriptState.js');
const {default:ScriptPointer}=await import('../../src/engine/script/ScriptPointer.js');
const {NetworkPlayer}=await import('../../src/engine/entity/NetworkPlayer.js');
const {default:NullClientSocket}=await import('../../src/server/NullClientSocket.js');
const {Inventory}=await import('../../src/engine/Inventory.js');
const {activeWorldSettings,worldExperience,validateWorldSettings}=await import('../../src/util/WorldSettings.js');
const {loadCommunityCraftingItems,communityRestricted,communityShopAllows,restockShop}=await import('../../src/util/CommunityCrafting.js');
DbTableIndex.init();loadCommunityCraftingItems();
expect(ScriptProvider.load(cache)).toBeGreaterThan(0);
const id=(key:string)=>{const result=ObjType.getId(key);expect(result).toBeGreaterThanOrEqual(0);return result;};
const inv=InvType.getId('inv'),iron=id('iron_scimitar'),coins=id('coins'),axe=id('bronze_axe');
function shop(allstock:boolean) {
    const type=new InvType(InvType.count);
    type.scope=InvType.SCOPE_SHARED;type.restock=true;type.allstock=allstock;type.stackall=true;type.size=40;
    type.stockobj=new Uint16Array([iron,axe,id('shortbow')]);type.stockcount=new Uint16Array([5,10,7]);type.stockrate=new Int32Array([100,100,100]);
    (InvType as any).configs.push(type);
    const result=Inventory.fromType(type.id);World.invs.add(result);return result;
}
function player(smith=99,fletch=15) {
    const p=new NetworkPlayer('communitytest',1n,1n,new NullClientSocket());
    p.x=3210;p.z=3210;p.level=0;
    for(const [stat,level] of [[13,smith],[9,fletch]]) {
        p.levels[stat]=level;p.baseLevels[stat]=level;p.stats[stat]=(worldExperience[level-1]??0)*10;
    }
    return p;
}
function run(p:InstanceType<typeof NetworkPlayer>,name:string,args:any[]=[],choice?:number) {
    const script=ScriptProvider.getByName(name);expect(script).toBeDefined();
    const state=ScriptRunner.init(script!,p,null,args);state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    for(let step=0;step<40;step++) {
        const result=ScriptRunner.execute(state);
        expect(result).not.toBe(ScriptState.ABORTED);
        if(result===ScriptState.FINISHED)return;
        if(result===ScriptState.PAUSEBUTTON) {if(choice===undefined)return;p.lastCom=choice;}
        else expect(result).toBe(ScriptState.SUSPENDED);
    }
    throw Error('Script failed to finish');
}
test('policy covers packed recipes, Black gear and ranged products but preserves starter tools and menus',()=>{
    expect(validateWorldSettings({xpRate:1,curveDivisor:7,tickMs:600}).communityCraftingMode).toBe(false);
    expect(()=>validateWorldSettings({...activeWorldSettings,communityCraftingMode:'true'} as any)).toThrow('boolean');
    for(const key of ['iron_scimitar','black_platebody','black_halberd','iron_pickaxe','rune_pickaxe','shortbow','unstrung_magic_shortbow','bronze_arrow','bronze_arrowheads','bronze_dart','bolt','macro_iron_pickaxehead','macro_pickaxehandle'])expect(communityRestricted(id(key))).toBe(true);
    for(const key of ['bronze_axe','bronze_pickaxe','logs','iron_bar','hammer','knife','feather'])expect(communityRestricted(id(key))).toBe(false);
    activeWorldSettings.communityCraftingMode=true;
    expect(Inventory.fromType(InvType.getId('smithing_iron3')).getItemCount(id('macro_iron_pickaxehead'))).toBe(1);
});
test('only finite player supply survives activation and general-store resale never regenerates',()=>{
    activeWorldSettings.communityCraftingMode=false;const general=shop(true),special=shop(false);
    general.add(iron,3);expect(general.getItemCount(iron)).toBe(8);
    activeWorldSettings.communityCraftingMode=true;general.applyCommunityCrafting();special.applyCommunityCrafting();
    expect(general.getItemCount(iron)).toBe(3);expect(special.getItemCount(iron)).toBe(0);
    expect(special.getItemCount(axe)).toBe(10);expect(communityShopAllows(special.type,iron)).toBe(false);
    expect(special.add(iron,5)).toBe(0);expect(general.add(iron,5,-1,'stock')).toBe(0);
    for(let tick=100;tick<10000;tick+=100){restockShop(general,tick);restockShop(special,tick);}
    expect(general.getItemCount(iron)).toBe(3);expect(special.getItemCount(iron)).toBe(0);
    general.remove(iron,3);restockShop(general,10000);expect(general.getItemCount(iron)).toBe(0);
    activeWorldSettings.communityCraftingMode=false;general.applyCommunityCrafting();special.applyCommunityCrafting();
    expect(general.getItemCount(iron)).toBe(5);expect(special.getItemCount(iron)).toBe(5);
    activeWorldSettings.communityCraftingMode=true;general.applyCommunityCrafting();expect(general.getItemCount(iron)).toBe(0);
});
test('compiled shop transactions preserve coins, note conversion and exactly the player-delivered resale quantity',()=>{
    activeWorldSettings.communityCraftingMode=true;const general=shop(true),special=shop(false),p=player();
    for(const [key,value] of [['shop',general.type],['shop_buy',400],['shop_sell',1000],['shop_haggle',0]] as const)p.setVar(VarPlayerType.getId(key),value);
    p.invAdd(inv,id('cert_iron_scimitar'),2);p.invAdd(inv,coins,10000);
    run(p,'[label,sell_item]',[id('cert_iron_scimitar'),2]);
    expect(p.invTotal(inv,id('cert_iron_scimitar'))).toBe(0);expect(general.getItemCount(iron)).toBe(2);
    const soldCash=p.invTotal(inv,coins);expect(soldCash).toBeGreaterThan(10000);
    run(p,'[label,buy_item]',[iron,1]);expect(general.getItemCount(iron)).toBe(1);expect(p.invTotal(inv,iron)).toBe(1);
    const before=p.invTotal(inv,coins);p.setVar(VarPlayerType.getId('shop'),special.type);
    run(p,'[label,buy_item]',[iron,1]);run(p,'[label,sell_item]',[iron,1]);
    expect(p.invTotal(inv,coins)).toBe(before);expect(p.invTotal(inv,iron)).toBe(1);expect(special.getItemCount(iron)).toBe(0);
});
test('all six compiled Smithing recipes consume two matching bars, keep the hammer and enforce level gates',()=>{
    for(const [metal,bar,level] of [['bronze','bronze_bar',5],['iron','iron_bar',20],['steel','steel_bar',35],['mithril','mithril_bar',55],['adamant','adamantite_bar',75],['rune','runite_bar',90]] as const) {
        const head=id(`macro_${metal}_pickaxehead`),p=player(level);p.invAdd(inv,id('hammer'),1);p.invAdd(inv,id(bar),2);p.lastItem=head;
        const xp=p.stats[13];run(p,'[inv_button1,smithing:column3]');
        expect(p.invTotal(inv,head)).toBe(1);expect(p.invTotal(inv,id(bar))).toBe(0);expect(p.invTotal(inv,id('hammer'))).toBe(1);expect(p.stats[13]).toBeGreaterThan(xp);
        expect(ObjType.get(head).name).toBe(metal[0].toUpperCase()+metal.slice(1)+' pickaxe head');
        expect(ObjType.get(head).tradeable).toBe(true);
        const low=player(level-1);low.invAdd(inv,id('hammer'),1);low.invAdd(inv,id(bar),2);low.lastItem=head;
        run(low,'[inv_button1,smithing:column3]');expect(low.invTotal(inv,head)).toBe(0);expect(low.invTotal(inv,id(bar))).toBe(2);
    }
});
test('the real Fletching menu enforces level 15 and its queued production makes one handle from one log',()=>{
    for(const level of [14,15]) {
        const p=player(99,level);p.invAdd(inv,id('logs'),1);p.invAdd(inv,id('knife'),1);
        run(p,'[label,fletch_log]',[id('logs')],Component.getId('skill_multi4:make1_d'));
        if(level===14){expect(p.weakQueue.head()).toBeNull();expect(p.invTotal(inv,id('logs'))).toBe(1);}
        else {
            const queued=p.weakQueue.head()!;expect(queued).not.toBeNull();
            run(p,'[queue,fletch_logs]',queued.args);expect(p.invTotal(inv,id('macro_pickaxehandle'))).toBe(1);expect(p.invTotal(inv,id('logs'))).toBe(0);expect(p.invTotal(inv,id('knife'))).toBe(1);
        }
    }
});
test('ordinary reassembly remains usable in either mode with no skill/XP cost',()=>{
    for(const mode of [false,true])for(const metal of ['bronze','iron','steel','mithril','adamant','rune']) {
        activeWorldSettings.communityCraftingMode=mode;const p=player(1,1),head=id(`macro_${metal}_pickaxehead`),handle=id('macro_pickaxehandle');
        p.invAdd(inv,head,1);p.invAdd(inv,handle,1);const xp=[...p.stats];
        run(p,'[label,reattach_pickaxe]',[head]);expect(p.invTotal(inv,id(metal+'_pickaxe'))).toBe(1);expect(p.invTotal(inv,head)).toBe(0);expect(p.invTotal(inv,handle)).toBe(0);expect([...p.stats]).toEqual(xp);
    }
});


test('specialist ranged ticket purchases cannot bypass the mode or consume payment when blocked',()=>{
    const p=player(),tickets=id('archery_ticket'),arrow=id('rune_arrow');p.invAdd(inv,tickets,4000);
    activeWorldSettings.communityCraftingMode=true;
    run(p,'[if_button,tickets_shop:com_90]');expect(p.invTotal(inv,arrow)).toBe(0);expect(p.invTotal(inv,tickets)).toBe(4000);
    activeWorldSettings.communityCraftingMode=false;
    run(p,'[if_button,tickets_shop:com_90]');expect(p.invTotal(inv,arrow)).toBe(50);expect(p.invTotal(inv,tickets)).toBe(2000);
});
