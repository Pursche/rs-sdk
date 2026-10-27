import {expect,test} from 'bun:test';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('divisor six loads persisted thresholds and retains progression validation',()=>{
    const dir=mkdtempSync(join(tmpdir(),'world-curve-'));
    try {
        mkdirSync(join(dir,'data/config'),{recursive:true});
        writeFileSync(join(dir,'data/config/panel-world.json'),JSON.stringify({xpRate:25,curveDivisor:6,tickMs:600}));
        const child=Bun.spawnSync([process.execPath,join(import.meta.dir,'fixtures/world-settings.ts')],{cwd:dir});
        if(child.exitCode!==0)throw Error(child.stdout.toString()+child.stderr.toString());
        expect(child.exitCode).toBe(0);
    }finally{rmSync(dir,{recursive:true,force:true});}
});
