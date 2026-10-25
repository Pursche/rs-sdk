import {afterEach,expect,test} from 'bun:test';
import '../lite/dom-shim.js';
import JString from './JString.js';
import {setDisplayNames} from './DisplayNames.js';
import ClientPlayer from '../dash3d/ClientPlayer.js';
afterEach(()=>setDisplayNames({}));
test('browser and lite players, social names and base37 identities preserve casing independently',()=>{
    const player=new ClientPlayer();player.name='Kelandanmine';
    expect(player.name).toBe('Kelandanmine');expect(JString.toScreenName('constructor')).toBe('Constructor');
    setDisplayNames({kelandanmine:'KelandanMine',galinacook:'GalinaCook',aldedansmith:'AldedanSmith',someone:'<bad>',other:'WrongName'});
    expect(player.name).toBe('KelandanMine');
    for(const name of ['KelandanMine','GalinaCook','AldedanSmith']){
        const hash=JString.toUserhash(name);expect(hash).toBe(JString.toUserhash(name.toLowerCase()));expect(JString.toScreenName(JString.toRawUsername(hash))).toBe(name);
    }
    expect(JString.toScreenName('other')).toBe('Other');expect(JString.toScreenName('someone')).toBe('Someone');
    setDisplayNames({});expect(player.name).toBe('Kelandanmine');
});
