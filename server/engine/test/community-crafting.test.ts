import {expect,test} from 'bun:test';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

test('Community Crafting stock policy and compiled production/repair scripts',()=>{
    const directory=mkdtempSync(resolve(tmpdir(),'community-crafting-'));
    try {
        mkdirSync(resolve(directory,'data/config'),{recursive:true});
        for(const key of ['private.pem','public.pem'])copyFileSync(resolve(import.meta.dir,'../data/config',key),resolve(directory,'data/config',key));
        mkdirSync(resolve(directory,'data/pack'),{recursive:true});
        for(const file of ['main_file_cache.dat',...Array.from({length:5},(_,i)=>'main_file_cache.idx'+i)])
            copyFileSync(resolve(import.meta.dir,'../data/pack',file),resolve(directory,'data/pack',file));
        const result=Bun.spawnSync([process.execPath,'test',resolve(import.meta.dir,'fixtures/community-crafting.ts')],{
            cwd:directory,env:{...process.env,COMMUNITY_TEST_CACHE:resolve(import.meta.dir,'../data/pack'),DB_BACKEND:'sqlite',GE_ENABLED:'false',NODE_XPRATE:'1'},stdout:'pipe',stderr:'pipe',
        });
        if(result.exitCode!==0)throw Error(result.stdout.toString()+result.stderr.toString());
        expect(result.exitCode).toBe(0);
    }finally{rmSync(directory,{recursive:true,force:true});}
},30_000);
