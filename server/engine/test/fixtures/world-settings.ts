import {strict as assert} from 'node:assert';
import {activeWorldSettings,saveWorldSettings,validateWorldSettings,worldExperience} from '../../src/util/WorldSettings.js';
import {readFileSync} from 'node:fs';
assert.equal(activeWorldSettings.curveDivisor,6);
assert.equal(worldExperience.length,99);
assert.ok(worldExperience.every((xp,i)=>Number.isSafeInteger(xp)&&xp>0&&(i===0||xp>worldExperience[i-1]!)));
assert.ok(worldExperience[97]!>13034431); // Standard level-99 requirement: divisor 6 must be harder.
for(const curveDivisor of [6,6.1,7,20])assert.equal(validateWorldSettings({...activeWorldSettings,curveDivisor}).curveDivisor,curveDivisor);
for(const curveDivisor of [5.9,20.1,0,NaN,Infinity])assert.throws(()=>validateWorldSettings({...activeWorldSettings,curveDivisor}),/between 6 and 20/);
saveWorldSettings({...activeWorldSettings,curveDivisor:6});
assert.equal(JSON.parse(readFileSync('data/config/panel-world.json','utf8')).curveDivisor,6);
