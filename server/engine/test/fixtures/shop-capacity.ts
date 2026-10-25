import {expect,mock,test} from 'bun:test';
import {EventEmitter} from 'node:events';
class TestWorker extends EventEmitter {postMessage(){}}
mock.module('worker_threads',()=>({Worker:TestWorker}));
await import('../../src/engine/World.js');
const {default:InvOps}=await import('../../src/engine/script/handlers/InvOps.js');
const {ScriptOpcode}=await import('../../src/engine/script/ScriptOpcode.js');
const {default:InvType}=await import('../../src/cache/config/InvType.js');
const {default:ObjType}=await import('../../src/cache/config/ObjType.js');
const {activeWorldSettings,validateWorldSettings}=await import('../../src/util/WorldSettings.js');
const general=new InvType(0),player=new InvType(1),specialist=new InvType(2);
general.allstock=true;general.scope=InvType.SCOPE_SHARED;general.size=40;
player.protect=false;player.size=28;specialist.size=40;specialist.protect=false;
(InvType as any).configs=[general,player,specialist];
const ordinary=new ObjType(0),note=new ObjType(1);note.certtemplate=0;note.certlink=0;
ObjType.configs=[ordinary,note];

test('default is unlimited; explicit off persists and invalid input is refused',()=>{
    expect(validateWorldSettings({xpRate:1,curveDivisor:7,tickMs:600}).unlimitedGeneralStoreSales).toBe(true);
    expect(validateWorldSettings({xpRate:1,curveDivisor:7,tickMs:600,unlimitedGeneralStoreSales:false}).unlimitedGeneralStoreSales).toBe(false);
    expect(()=>validateWorldSettings({xpRate:1,curveDivisor:7,tickMs:600,unlimitedGeneralStoreSales:'true'} as any)).toThrow('boolean');
});
test('only general-store stock capacity is bypassed; player and specialist inventories retain limits',()=>{
    for(const enabled of [false,true])for(const inv of [0,1,2]) {
        activeWorldSettings.unlimitedGeneralStoreSales=enabled;
        let result=-1;
        InvOps[ScriptOpcode.INV_ITEMSPACE]!({popInts:()=>[inv,0,100,inv===1?28:40],pushInt:(n:number)=>result=n,activePlayer:{invItemSpace:()=>100}} as any);
        expect(result).toBe(enabled&&inv===0?1:0);
    }
});
test('ordinary and noted overflow sales remove actual owned units once, without expanding stock or inventing goods',()=>{
    activeWorldSettings.unlimitedGeneralStoreSales=true;
    for(const obj of [0,1]) {
        let owned=75,added=0;
        const state:any={popInts:()=>[1,0,obj,100],pointerGet:()=>true,activePlayer:{invDel:(_inv:number,id:number,n:number)=>{expect(id).toBe(obj);const amount=Math.min(owned,n);owned-=amount;return amount;},invAdd:(inv:number,id:number,n:number)=>{expect([inv,id,n]).toEqual([0,0,75]);added++;return 0;}}};
        InvOps[ScriptOpcode.INV_MOVEITEM_UNCERT]!(state);
        expect(owned).toBe(0);expect(added).toBe(1);
        InvOps[ScriptOpcode.INV_MOVEITEM_UNCERT]!(state);expect(added).toBe(1);
    }
});
