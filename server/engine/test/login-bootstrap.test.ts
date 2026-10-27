import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('standalone SQLite login worker bootstraps entities and opens its listener',async()=>{
  const directory=await mkdtemp(resolve(tmpdir(),'login-bootstrap-'));
  const engine=resolve(import.meta.dir,'..');
  let child:ReturnType<typeof Bun.spawn>|undefined;
  try {
    // Reuse immutable packed definitions; the database and account files are
    // isolated and no login requests or world_startup messages are sent.
    await mkdir(resolve(directory,'data'),{recursive:true});
    for(const entry of ['pack','config'])await symlink(resolve(engine,'data',entry),resolve(directory,'data',entry),'dir');
    child=Bun.spawn([process.execPath,'-e',`await import(${JSON.stringify(pathToFileURL(resolve(engine,'src/login.ts')).href)});await Bun.sleep(100);process.exit(0);`],{
      cwd:directory,env:{...process.env,DB_BACKEND:'sqlite',EASY_STARTUP:'true',LOGIN_SERVER:'true',LOGIN_PORT:'0',BIND_HOST:'127.0.0.1',GE_DATABASE:resolve(directory,'market.sqlite')},stdout:'pipe',stderr:'pipe'
    });
    const timeout=setTimeout(()=>child?.kill(),10000);
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timeout);
    expect({code,stderr}).toEqual({code:0,stderr:''});
    expect(stdout).toContain('Login server listening on port 0');
  }finally{child?.kill();await rm(directory,{recursive:true,force:true});}
},15000);
