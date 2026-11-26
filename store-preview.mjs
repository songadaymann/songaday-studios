// Jonathan's 2016x1512 studio photo. The old poster proofs estimated wall scale at
// 14 px/in; retain that calibration, and label this illustrative rather than measured.
export function roomGeometry(size, frame) {
  const sizes={'12x16':[12,16],'18x24':[18,24],'30x40':[30,40]};
  if(!sizes[size]||!['none','black','white'].includes(frame)||(size==='30x40'&&frame!=='none'))throw Error('Unsupported poster preview');
  const [width,height]=sizes[size],edge=frame==='none'?0:12/25.4;
  const outerWidth=(width+2*edge)*14,outerHeight=(height+2*edge)*14;
  return {left:(890-outerWidth/2)/2016*100,top:(610-outerHeight/2)/1512*100,
    width:outerWidth/2016*100,height:outerHeight/1512*100,
    insetX:edge/(width+2*edge)*100,insetY:edge/(height+2*edge)*100,
    printWidth:width/(width+2*edge)*100,printHeight:height/(height+2*edge)*100};
}
