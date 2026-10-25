import {expect,test} from 'bun:test';
import {BotSDK} from '../index';
import {BotActions} from '../actions';

test('bronze wire uses the installed other-product slot and reports the observed wire',async()=>{
    const sdk=new BotSDK({botUsername:'test',password:'test',autoLaunchBrowser:false});
    const state:any={tick:1,player:{animId:-1},inventory:[{id:2347,name:'Hammer',slot:0,count:1},{id:2349,name:'Bronze bar',slot:1,count:1}],equipment:[],skills:[{name:'Smithing',experience:286}],nearbyLocs:[{id:2783,name:'Anvil',x:1,z:1,distance:1}],gameMessages:[],dialog:{isOpen:false},interface:{isOpen:false}};
    (sdk as any).state=state;
    sdk.sendUseItemOnLoc=async()=>{state.interface={isOpen:true,interfaceId:994};return {success:true,message:'Opened'};};
    sdk.sendClickComponentWithOption=async(component,option,slot)=>{
        expect([component,option,slot]).toEqual([1123,1,3]);
        state.inventory=[state.inventory[0],{id:1794,name:'Bronze wire',slot:1,count:1}];state.skills[0].experience+=12;
        return {success:true,message:'Smithed'};
    };
    expect(await new BotActions(sdk).smithAtAnvil('bronze wire')).toMatchObject({success:true,product:{id:1794,name:'Bronze wire'},xpGained:12});
});

test('bank IDs are explicit and numeric-slot mistakes explain the actual selector contract',async()=>{
    const sdk=new BotSDK({botUsername:'test',password:'test',autoLaunchBrowser:false});
    const state:any={inventory:[],bank:{isOpen:true,noteMode:false,items:[{id:436,name:'Copper ore',slot:3,count:10}]},interface:{isOpen:true}};
    (sdk as any).state=state;let calls=0;
    sdk.sendBankWithdraw=async(slot,amount)=>{calls++;expect([slot,amount]).toEqual([3,2]);state.inventory=[{id:436,name:'Copper ore',slot:0,count:2}];return {success:true,message:'Sent'};};
    const bot=new BotActions(sdk);
    expect((await bot.withdrawItem(436,2)).message).toContain('expects a bank SLOT');expect(calls).toBe(0);
    expect(await bot.withdrawItem({id:436},2)).toMatchObject({success:true,amountWithdrawn:2});expect(calls).toBe(1);
});
