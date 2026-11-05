import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import worker from '../worker.mjs';
const read = async p => JSON.parse(await readFile(new URL('../store/'+p,import.meta.url),'utf8'));
test('every figure has exactly one original-color preview and no dashboard links',async()=>{
 const rows=await read('catalog.json');assert.equal(rows.length,236);assert.equal(new Set(rows.map(f=>f.id)).size,236);
 for(let id=1;id<=236;id++) {const f=rows.find(f=>f.id===id);assert.ok(f.name);assert.match(f.image,new RegExp('/centered-v4-original-color/preview/'+String(id).padStart(3,'0')+'\\.jpg$'));assert.equal(f.gelatoUrl,undefined);}
});
test('size and frame options only map to quote-verified products',async()=>{
 const c=await read('variants.json');assert.equal(c.variants.length,7);assert.equal(c.checkoutEnabled,false);
 for(const s of c.sizes){const v=c.variants.filter(v=>v.size===s.id);assert.deepEqual(v.map(v=>v.frame),s.id==='30x40'?['none']:['none','black','white']);for(const p of v){assert.ok(p.productUid);assert.ok(Number.isInteger(p.priceCents)&&p.priceCents>0);assert.ok(p.artworkPrefix.startsWith('https://'));}}
});
test('the store canonical route preserves chosen figure options',async()=>{
 const response=await worker.fetch(new Request('https://songaday.studio/STORE?figure=15&size=12x16'),{},{});
 assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'/store/?figure=15&size=12x16');
});
