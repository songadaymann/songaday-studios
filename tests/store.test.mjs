import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {albumProblems,albumYear,parseBandcampMusic,renderAlbums,shelveAlbums} from '../store-albums.mjs';
import {productProblems,renderStore} from '../store-products.mjs';
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
test('old figure links and Stripe return links land on the poster page, with their choices',async()=>{
 const order='a'.repeat(32);
 for(const [from,to] of [['/STORE?figure=15&size=12x16','/store/muscle/?figure=15&size=12x16'],['/store/?order='+order,'/store/muscle/?order='+order],
  ['/store/?frame=black','/store/muscle/?frame=black'],['/store/muscle?figure=3','/store/muscle/?figure=3'],['/Store','/store/'],['/store?utm_source=x','/store/?utm_source=x']]){
  const response=await worker.fetch(new Request('https://songaday.studio'+from),{},{});
  assert.equal(response.status,302,from);assert.equal(response.headers.get('Location'),to,from);
 }
 const source=await readFile(new URL('../store.mjs',import.meta.url),'utf8');
 assert.match(source,/success_url:`\$\{env\.SITE_ORIGIN\}\/store\/muscle\/\?order=/);assert.match(source,/cancel_url:`\$\{env\.SITE_ORIGIN\}\/store\/muscle\/\?figure=/);
});

test('the album snapshot has every Song A Day year, newest first, then the other releases',async()=>{
 const releases=await read('albums.json');assert.deepEqual(albumProblems(releases),[]);
 const {years,more}=shelveAlbums(releases);
 assert.ok(years.length>=18);assert.deepEqual(years.map(y=>y.year),years.map((_,i)=>2008+years.length-i));
 assert.equal(years.at(-1).label,'Year One');assert.equal(years.at(-1).url,'https://jonathanmann.bandcamp.com/album/song-a-day-year-one');
 assert.equal(years.length+more.length,releases.length);assert.ok(more.every(r=>!/Year (One|Two|Eighteen)$/.test(r.title)));
 assert.deepEqual(albumYear('Song A Day: Year Twenty-One'),{count:21,year:2029,label:'Year Twenty-One'});
 for(const title of ['Song A Day: The Album','Song A Day: Year Zebra','Animals'])assert.equal(albumYear(title),null,title);
 assert.deepEqual(albumProblems([{kind:'album',title:'X',url:'https://example.com/album/x',image:'https://f4.bcbits.com/img/a0000000001_2.jpg'}]),["X doesn't link to Jonathan's Bandcamp."]);
 assert.deepEqual(albumProblems([]),['store/albums.json has no releases.']);
});

test('the Bandcamp page parser reads the markup rows and the lazy-loaded rows',()=>{
 const page=`<ol id="music-grid" data-client-items="[{&quot;art_id&quot;:615659003,&quot;band_id&quot;:1,&quot;id&quot;:2,&quot;page_url&quot;:&quot;/track/buddy-our-boy&quot;,&quot;title&quot;:&quot;Buddy, Our Boy&quot;,&quot;type&quot;:&quot;track&quot;}]">
 <li data-item-id="album-866225401" class="music-grid-item">
  <a href="/album/song-a-day-year-eighteen"><div class="art"><img src="https://f4.bcbits.com/img/a2220269328_2.jpg" alt="" /></div>
   <p class="title">
    The Mystery Bard&#39;s Jingles &amp; More
   </p></a>
 </li></ol>`;
 assert.deepEqual(parseBandcampMusic(page),[
  {kind:'album',title:"The Mystery Bard's Jingles & More",url:'https://jonathanmann.bandcamp.com/album/song-a-day-year-eighteen',image:'https://f4.bcbits.com/img/a2220269328_2.jpg'},
  {kind:'track',title:'Buddy, Our Boy',url:'https://jonathanmann.bandcamp.com/track/buddy-our-boy',image:'https://f4.bcbits.com/img/a0615659003_2.jpg'}]);
 assert.deepEqual(parseBandcampMusic('<html>Checking your browser</html>'),[]);
});

// A small store for the tests below: the live list's four kinds, each with one product.
const albumsForTests=()=>renderAlbums(Array.from({length:5},(_,i)=>({kind:'album',title:'Song A Day: Year '+['One','Two','Three','Four','Five'][i],url:'https://jonathanmann.bandcamp.com/album/year-'+(i+1),image:`https://f4.bcbits.com/img/a000000000${i+1}_2.jpg`})));
const values={ALBUM_COUNT:'5',PERSONAL_FROM:'$200',FIGURE_COUNT:'236',POSTER_FROM:'$29'};
const tiles=html=>[...html.matchAll(/<li><a href="([^"]+)"[^>]*><span class="store-item-image([^"]*)">((?:<img[^>]*>)+)<\/span><span class="store-item-name">([^<]+)<\/span><span class="store-item-note">(.*?)<\/span><\/a><\/li>/g)]
 .map(m=>({href:m[1],look:m[2].trim(),images:[...m[3].matchAll(/src="([^"]+)"/g)].map(i=>i[1]),lazy:/loading="lazy"/.test(m[3]),name:m[4],note:m[5].replace(/<[^>]+>/g,'')}));

test('the live product list is clean, and each kind with one product is a picture that goes straight to it',async()=>{
 const data=await read('products.json');
 assert.deepEqual(productProblems(data,values),[]);
 assert.deepEqual(data.kinds.map(k=>k.id),['music','custom-song','posters','clothing']);
 const store=renderStore(data,{albums:albumsForTests(),values});
 assert.deepEqual(tiles(store.items).map(t=>[t.href,t.name,t.note,t.look,t.images.length,t.lazy]),[
  ['#music','Music','5 albums on Bandcamp','store-item-mosaic',4,false],
  ['/commission','A song written for you','From $200, pay when it’s done','',1,false],
  ['/store/muscle/','MUSCLE posters','236 figures, from $29 · opens soon','store-item-print',1,false],
  ['https://cottonbureau.com/p/NW5ZGT/hat/songs-hat','Songs Hat','On Cotton Bureau ↗ (opens in a new tab)','store-item-contain',1,false]]);
 // Only Music has more to show than its picture: the album list.
 assert.deepEqual([...store.sections.matchAll(/<section class="store-kind" id="([^"]+)"/g)].map(m=>m[1]),['music']);
 assert.doesNotMatch(store.sections,/class="store-items"/);
});

test('adding a second product to a kind turns its picture into the kind, with a list further down',async()=>{
 const data=await read('products.json');
 data.products.push({id:'song-a-day-poster',kind:'posters',name:'Song A Day poster',note:'Every song in one picture',href:'/store/song-a-day/',image:'/assets/images/store/song-a-day-poster.jpg',fit:'print',checkout:'posters'},
  {id:'songs-shirt',kind:'clothing',name:'Songs Shirt',note:'On Cotton Bureau',href:'https://cottonbureau.com/p/EXAMPLE/shirt/songs-shirt',image:'https://cottonbureau.com/mockup?pid=1'});
 assert.deepEqual(productProblems(data,values),[]);
 const store=renderStore(data,{albums:albumsForTests(),values});
 const top=tiles(store.items);
 // Still four pictures on the first screen; the two kinds that grew now carry the kind's name.
 assert.deepEqual(top.map(t=>[t.href,t.name,t.note,t.look,t.images.length]),[
  ['#music','Music','5 albums on Bandcamp','store-item-mosaic',4],
  ['/commission','A song written for you','From $200, pay when it’s done','',1],
  ['#posters','Posters','MUSCLE posters and Song A Day poster','store-item-mosaic',2],
  ['#clothing','Clothing','Songs Hat and Songs Shirt','store-item-mosaic',2]]);
 assert.ok(top.every(t=>!t.lazy));
 assert.deepEqual([...store.sections.matchAll(/<section class="store-kind" id="([^"]+)" aria-labelledby="\1-heading">\s*<h2 id="\1-heading">([^<]+)<\/h2>/g)].map(m=>[m[1],m[2]]),
  [['posters','Posters'],['clothing','Clothing'],['music','Music']]);
 // The short lists come first; the album list is dozens of covers long, so its kind goes last.
 assert.ok(store.sections.indexOf('id="clothing"')<store.sections.indexOf('class="store-albums"'));
 const posters=tiles(store.sections.match(/<section class="store-kind" id="posters"[\s\S]*?<\/section>/)[0]);
 assert.deepEqual(posters.map(t=>[t.href,t.name,t.note,t.look,t.lazy]),[
  ['/store/muscle/','MUSCLE posters','236 figures, from $29 · opens soon','store-item-print',true],
  ['/store/song-a-day/','Song A Day poster','Every song in one picture · opens soon','store-item-print',true]]);
 const clothing=store.sections.match(/<section class="store-kind" id="clothing"[\s\S]*?<\/section>/)[0];
 assert.equal((clothing.match(/target="_blank" rel="noopener noreferrer"/g)??[]).length,2);
 // Four or more pictures in a kind show as two by two; past three names, the rest are counted.
 for(const n of [3,4])data.products.push({id:'shirt-'+n,kind:'clothing',name:'Shirt '+n,note:'On Cotton Bureau',href:'https://cottonbureau.com/p/'+n,image:'https://cottonbureau.com/mockup?pid='+n});
 const bigger=tiles(renderStore(data,{albums:albumsForTests(),values}).items)[3];
 assert.deepEqual([bigger.name,bigger.note,bigger.images.length],['Clothing','Songs Hat, Songs Shirt and 2 more',4]);
});

test('the product list says what is wrong with a row before the build uses it',async()=>{
 const data=await read('products.json');
 const withRow=row=>productProblems({...data,products:[...data.products,{id:'new-thing',kind:'posters',name:'New thing',note:'A note',href:'/store/new/',image:'/assets/new.jpg',...row}]},values);
 assert.deepEqual(withRow({}),[]);
 assert.deepEqual(withRow({kind:'stickers'}),['new-thing is in the kind "stickers", which isn\'t one of the kinds.']);
 assert.deepEqual(withRow({id:'songs-hat'}),['The product songs-hat is listed twice.']);
 assert.deepEqual(withRow({id:'New Thing'}),['New Thing needs an id in lowercase letters, numbers and hyphens.']);
 assert.deepEqual(withRow({note:'From {{SHIRT_PRICE}}'}),["new-thing's note uses {{SHIRT_PRICE}}, which the build doesn't know."]);
 assert.deepEqual(withRow({note:''}),['new-thing has no note (the line under its name).']);
 assert.deepEqual(withRow({href:'http://example.com/'}),['new-thing needs an href: a page here ("/…") or an https address.']);
 assert.deepEqual(withRow({href:'//example.com/'}),['new-thing needs an href: a page here ("/…") or an https address.']);
 assert.deepEqual(withRow({image:'poster.jpg'}),['new-thing needs an image: "/assets/…" or an https address.']);
 assert.deepEqual(withRow({fit:'stretch'}),['new-thing has the fit "stretch"; use cover, contain, print.']);
 assert.deepEqual(withRow({checkout:'stripe'}),['new-thing has the checkout "stripe"; the only one is "posters".']);
 assert.deepEqual(withRow({list:'albums',href:undefined,image:undefined}),['Only one product can stand for the albums.']);
 // A fifth kind wouldn't fit the first screen on a phone, so the build stops and says so.
 const five={kinds:[...data.kinds,{id:'stickers',name:'Stickers'}],products:[...data.products,{id:'sticker',kind:'stickers',name:'Sticker',note:'A note',href:'/store/sticker/',image:'/assets/sticker.jpg'}]};
 assert.deepEqual(productProblems(five,values),['The first screen fits 4 kinds, and 5 have products (Music, A song written for you, Posters, Clothing, Stickers). Put the new product in one of the first 4, or redesign the top row.']);
 // A kind with nothing in it yet is fine, and doesn't show.
 assert.deepEqual(productProblems({...data,kinds:[...data.kinds,{id:'stickers',name:'Stickers'}]},values),[]);
 assert.deepEqual(productProblems({},values),['store/products.json has no kinds.','store/products.json has no products.']);
});

test('the store front page shows everything up top, then the albums; the poster picker is a page of its own',async()=>{
 const out=await mkdtemp(path.join(tmpdir(),'songaday-studio-store-'));
 try{
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../build.mjs',import.meta.url)),'--out',out],{env:{...process.env,SONGADAY_OFFLINE:'1'}});
  const [front,muscle]=await Promise.all(['store/index.html','store/muscle/index.html'].map(p=>readFile(path.join(out,p),'utf8')));
  assert.match(front,/<title>Store · Song A Day Studio<\/title>/);
  // The four things in the store, before anything else on the page, each a link to where it's sold.
  const items=front.match(/<ul class="store-items"[\s\S]*?<\/ul>/)[0];
  assert.ok(front.indexOf('class="store-items"')<front.indexOf('id="music"'));
  assert.deepEqual([...items.matchAll(/<li><a href="([^"]+)"[\s\S]*?<span class="store-item-name">([^<]+)<\/span>/g)].map(m=>[m[1],m[2]]),
   [['#music','Music'],['/commission','A song written for you'],['/store/muscle/','MUSCLE posters'],['https://cottonbureau.com/p/NW5ZGT/hat/songs-hat','Songs Hat']]);
  assert.equal((items.match(/<span class="store-item-image store-item-mosaic">(?:<img src="https:\/\/f4\.bcbits\.com\/img\/a\d{10}_2\.jpg" alt="" referrerpolicy="no-referrer">){4}<\/span>/g)??[]).length,1);
  assert.match(items,/<span class="store-item-image"><img src="(?:https:\/\/songaday\.studio)?\/assets\/images\/jonathan-swing-800\.webp" alt=""><\/span>/);
  assert.match(items,/<span class="store-item-image store-item-print"><img src="https:\/\/pub-[a-z0-9]+\.r2\.dev\/centered-v4-original-color\/preview\/015\.jpg" alt="" referrerpolicy="no-referrer"><\/span>/);
  assert.match(items,/<span class="store-item-image store-item-contain"><img src="https:\/\/cottonbureau\.com\/mockup\?default=1&amp;hash=LSmS&amp;pid=115154&amp;w=1024" alt="" referrerpolicy="no-referrer"><\/span>/);
  assert.match(items,/<span class="store-item-note">32 albums on Bandcamp<\/span>/);
  assert.match(items,/<span class="store-item-note">From \$200, pay when it’s done<\/span>/);
  assert.match(items,/<span class="store-item-note">236 figures, from \$29<span data-store-opens-soon> · opens soon<\/span><\/span>/);
  assert.match(items,/<span class="store-item-note">On Cotton Bureau ↗<span class="visually-hidden"> \(opens in a new tab\)<\/span><\/span>/);
  assert.match(front,/querySelectorAll\("\[data-store-opens-soon\]"\)/);
  assert.match(items,/<a href="https:\/\/cottonbureau\.com\/p\/NW5ZGT\/hat\/songs-hat" target="_blank" rel="noopener noreferrer">/);
  // The row is on the first screen, so its pictures load and decode right away.
  assert.doesNotMatch(items,/loading="lazy"|decoding="async"/);
  assert.deepEqual([...front.matchAll(/<section class="store-kind" id="([^"]+)"/g)].map(m=>m[1]),['music']);
  assert.match(front,/<h2 id="music-heading">Music<\/h2>\s*<p>Every year of Song A Day is an album\. Listen and buy on Bandcamp\.<\/p>\s*<ul class="store-albums" aria-labelledby="music-heading">/);
  const years=[...front.matchAll(/<li><a href="https:\/\/jonathanmann\.bandcamp\.com\/album\/song-a-day-year-[a-z0-9-]+" target="_blank" rel="noopener noreferrer"><img src="https:\/\/f4\.bcbits\.com\/img\/a\d{10}_2\.jpg" alt="" width="350" height="350" loading="lazy" decoding="async"><span class="store-album-name">(\d{4})<\/span><span class="store-album-note">(Year [A-Za-z-]+)<\/span>/g)];
  assert.ok(years.length>=18);assert.equal(years[0][1],String(2008+years.length));assert.equal(years.at(-1)[2],'Year One');
  assert.match(front,/<h3 id="more-albums-heading">More albums<\/h3>/);assert.match(front,/<span class="store-album-name">Animals<\/span>/);
  // Singles stay off the shelf; the Bandcamp link reaches them.
  assert.doesNotMatch(front,/jonathanmann\.bandcamp\.com\/track\//);assert.match(front,/<span class="store-album-name">Every Day\.<\/span>/);
  assert.match(front,/<a class="store-more" href="\/albums" target="_blank" rel="noopener noreferrer">Everything on Bandcamp ↗<\/a>/);
  assert.doesNotMatch(front,/id="store-grid"|id="store-shipping"|roomGeometry/);
  assert.match(muscle,/<title>MUSCLE posters · Song A Day Studio<\/title>/);assert.match(muscle,/<h1>MUSCLE posters<\/h1><p>Pick a figure, a size and a frame\. <a href="\/store\/">Back to the store<\/a><\/p>/);
  for(const id of ['store-order-status','muscle-posters','store-sizes','store-frames','store-shipping','collection','store-grid'])assert.match(muscle,new RegExp(`id="${id}"`),id);
  assert.match(muscle,/function roomGeometry/);assert.doesNotMatch(muscle,/store-albums"|songs-hat/);
  for(const page of [front,muscle]){
   // Purchase pages: Store is the current section, and nothing about donating.
   assert.match(page,/<a href="\/store\/" aria-current="page">Store<\/a>/);
   assert.doesNotMatch(page.replace(/<style[\s\S]*?<\/style>/g,''),/nav-donate|#donate|tax.deductible|donat/i);
   assert.match(page,/<p class="sponsor-line">Posters and song commissions are purchases from Jonathan Mann\.<\/p>/);
   assert.doesNotMatch(page,/\{\{/);
  }
 }finally{await rm(out,{recursive:true,force:true});}
});
