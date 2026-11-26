import assert from 'node:assert/strict';
import test from 'node:test';
import {roomGeometry} from '../store-preview.mjs';
test('room preview preserves the poster aspect ratio and scales with the selected inches',()=>{
 for(const size of ['12x16','18x24','30x40'])for(const frame of size==='30x40'?['none']:['none','black','white']){
  const g=roomGeometry(size,frame),[w,h]=size.split('x').map(Number);
  assert.ok(g.left>0&&g.top>0&&g.left+g.width<100&&g.top+g.height<100);
  const imageWidth=g.width/100*2016*g.printWidth/100,imageHeight=g.height/100*1512*g.printHeight/100;
  assert.ok(Math.abs(imageWidth/imageHeight-w/h)<1e-9);
  assert.ok(Math.abs(imageWidth-w*14)<1e-9);
  assert.ok(Math.abs((g.left+g.width/2)/100*2016-890)<1e-9);
  assert.ok(Math.abs((g.top+g.height/2)/100*1512-610)<1e-9);
 }
 assert.throws(()=>roomGeometry('30x40','black'));
});
