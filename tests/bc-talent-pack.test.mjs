import {test} from 'node:test';
import assert from 'node:assert/strict';
import {talentPatron} from '../script/creation/bc-talents.mjs';
import {withCopiedPack} from './helpers/pack-copy.mjs';

test('the pack itself carries the gods, so a card read on its own is right too',async()=>{
    const {talents,wrong}=await withCopiedPack('black-crusade',async db=>{
        const wrong=[];let talents=0;
        for await(const [key,value]of db.iterator()) {
            if(!key.startsWith('!items!')||value.type!=='talent')continue;
            talents++;const book=talentPatron(value.name);if(!book)continue;
            if(value.system?.patron!==book.patron)wrong.push(`${value.name}: pack says ${value.system?.patron}, book says ${book.patron}`);
            if(Number(value.system?.tier)!==book.tier)wrong.push(`${value.name}: pack tier ${value.system?.tier}, book tier ${book.tier}`);
        }
        return {talents,wrong};
    });
    assert.equal(talents,132,"the pack holds the book's talents");
    assert.deepEqual(wrong,[],'pack talent patrons and tiers must match the reviewed table');
});
