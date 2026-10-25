import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {DisplayNames} from './DisplayNames.js';
import {toBase37,toSafeName} from './JString.js';

test('display metadata refreshes without changing account identity and rejects impersonating aliases',async()=>{
    const dir=await mkdtemp(resolve(tmpdir(),'display-names-')),path=resolve(dir,'names.json');
    try{
        const registry=new DisplayNames(path);registry.refresh(0);
        expect(registry.get('KelandanMine')).toBe('Kelandanmine');
        await Bun.write(path,JSON.stringify({kelandanmine:'KelandanMine',galinacook:'SomeoneElse',constructor:'Constructor'}));registry.refresh(Date.now()+2000);
        expect(registry.get('kelandanmine')).toBe('KelandanMine');expect(registry.get('galinacook')).toBe('Galinacook');expect(registry.get('constructor')).toBe('Constructor');
        expect(toBase37('KelandanMine')).toBe(toBase37('kelandanmine'));expect(toSafeName('KelandanMine')).toBe('kelandanmine');
        await Bun.write(path,'invalid json');registry.refresh(Date.now()+4000);expect(registry.get('kelandanmine')).toBe('KelandanMine');
        await Bun.write(path,'{}');registry.refresh(Date.now()+6000);expect(registry.get('kelandanmine')).toBe('Kelandanmine');
    }finally{await rm(dir,{recursive:true,force:true});}
});
