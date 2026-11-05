(() => {
 "use strict";
 const $ = (id) => document.getElementById(id);
 const query = new URLSearchParams(location.search);
 let figures = [], config, figure, size = query.get("size") || "30x40", frame = query.get("frame") || "none";
 const labels = {none:"Unframed",black:"Black wood",white:"White wood"};
 function chooseButton(text,small,pressed,disabled,callback) {
  const b=document.createElement("button"); b.type="button"; b.textContent=text;
  if(small){const s=document.createElement("small");s.textContent=small;b.append(s);}
  b.setAttribute("aria-pressed",String(pressed)); b.disabled=disabled; b.addEventListener("click",callback);return b;
 }
 function renderOptions() {
  if(!config.sizes.some(s=>s.id===size))size="30x40";
  if(!config.variants.some(v=>v.size===size&&v.frame===frame))frame="none";
  $("store-sizes").replaceChildren(...config.sizes.map(s=>chooseButton(s.label,s.inches.join(" × ")+"″",size===s.id,false,()=>{size=s.id;renderOptions();})));
  $("store-frames").replaceChildren(...Object.entries(labels).map(([value,label])=>chooseButton(label,"",frame===value,!config.variants.some(v=>v.size===size&&v.frame===value),()=>{frame=value;renderOptions();})));
  document.querySelector(".store-art").dataset.frame=frame;
  $("store-frame-note").textContent=size==="30x40"?"30 × 40″ is available unframed. Choose small or medium for a ready-to-hang wooden frame.":frame==="none"?"Printed edge to edge on semi-glossy paper. Frame it your way.":"Wooden frame with plexiglass, assembled and ready to hang. Frame preview is illustrative.";
  updateUrl();
 }
 function updateUrl(){if(!figure)return;const u=new URL(location.href);u.searchParams.set("figure",figure.id);u.searchParams.set("size",size);u.searchParams.set("frame",frame);history.replaceState(null,"",u);}
 function select(f,scroll=false) {
  figure=f;$("figure-name").textContent="#"+String(f.id).padStart(3,"0")+" "+f.name;
  $("figure-image").src=f.image;$("figure-image").alt=f.name+" poster";updateUrl();renderGrid();
  if(scroll){$("figure-name").setAttribute("tabindex","-1");$("figure-name").focus({preventScroll:true});document.querySelector(".store-product").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});}
 }
 function renderGrid() {
  const q=$("store-search").value.trim().toLowerCase().replace(/^#/,"");
  const matched=figures.filter(f=>!q||f.name.toLowerCase().includes(q)||String(f.id)===q||String(f.id).padStart(3,"0")===q);
  $("store-count").textContent=matched.length?matched.length+" figure"+(matched.length===1?"":"s"):"No figures found. Try another name or number.";
  $("store-grid").replaceChildren(...matched.map(f=>{const b=document.createElement("button");b.type="button";b.className="store-figure";b.setAttribute("aria-pressed",String(figure?.id===f.id));const img=document.createElement("img");img.src=f.image;img.alt="";img.loading="lazy";img.width=300;img.height=400;const label=document.createElement("span");label.textContent="#"+String(f.id).padStart(3,"0")+" "+f.name;b.append(img,label);b.addEventListener("click",()=>select(f,true));return b;}));
 }
 $("store-search").addEventListener("input",renderGrid);
 Promise.all([fetch("/store/catalog.json").then(r=>{if(!r.ok)throw Error();return r.json();}),fetch("/store/variants.json").then(r=>{if(!r.ok)throw Error();return r.json();})]).then(([items,options])=>{figures=items;config=options;select(figures.find(f=>f.id===Number(query.get("figure")))||figures.find(f=>f.id===15));renderOptions();}).catch(()=>{$("store-count").textContent="The collection couldn’t load. Please refresh to try again.";});
})();
