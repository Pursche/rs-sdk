import {expect,test} from 'bun:test';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('general-store overflow sales are optional and preserve other inventory limits',()=>{
    const dir=mkdtempSync(join(tmpdir(),'shop-capacity-'));
    try {
        mkdirSync(join(dir,'data/config'),{recursive:true});
        copyFileSync(join(import.meta.dir,'../data/config/private.pem'),join(dir,'data/config/private.pem'));
        const result=Bun.spawnSync([process.execPath,'test',join(import.meta.dir,'fixtures/shop-capacity.ts')],{cwd:dir,env:{...process.env,GE_DATABASE:join(dir,'market.sqlite')}});
        if(result.exitCode!==0)throw Error(result.stdout.toString()+result.stderr.toString());
        expect(result.exitCode).toBe(0);
    }finally{rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
},15000);
