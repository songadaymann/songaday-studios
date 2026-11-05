"""Derive full-bleed US sizes without decoding or recoloring approved PDF images."""
import concurrent.futures,hashlib,json
from pathlib import Path
from pypdf import PdfReader,PdfWriter,Transformation
from pypdf.generic import RectangleObject
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'output/store-original-color-v1'
MM=72/25.4

def prepare(n):
 source=ROOT/'output/batch-centered-v4-original-color/pdf'/f'{n:03}.pdf'
 for size,inch in [('12x16',(12,16)),('18x24',(18,24))]:
  dest=OUT/size/f'{n:03}.pdf'
  if dest.with_suffix('.json').exists(): continue
  r=PdfReader(source);p=r.pages[0];sw,sh=float(p.mediabox.width),float(p.mediabox.height)
  w,h=[v*72+8*MM for v in inch];s=max(w/sw,h/sh)
  dx,dy=(w-sw*s)/2,(h-sh*s)/2
  p.add_transformation(Transformation().scale(s).translate(dx,dy))
  p.mediabox=RectangleObject([0,0,w,h]);p.cropbox=RectangleObject([0,0,w,h]);p.bleedbox=RectangleObject([0,0,w,h]);p.trimbox=RectangleObject([4*MM,4*MM,w-4*MM,h-4*MM])
  writer=PdfWriter();writer.add_page(p);writer.add_metadata({'/Title':f'MUSCLE #{n:03} — {size} — original color'})
  dest.parent.mkdir(parents=True,exist_ok=True)
  with dest.open('wb') as f:writer.write(f)
  check=PdfReader(dest);q=check.pages[0]
  assert abs(float(q.trimbox.width)-inch[0]*72)<.001
  assert abs(float(q.trimbox.height)-inch[1]*72)<.001
  assert q['/Resources']['/XObject'].get_object().values()
  original_images=[v.get_object()._data for v in r.pages[0]['/Resources']['/XObject'].get_object().values() if v.get_object().get('/Subtype')=='/Image']
  saved_images=[v.get_object()._data for v in q['/Resources']['/XObject'].get_object().values() if v.get_object().get('/Subtype')=='/Image']
  assert saved_images==original_images
  assert '/OutputIntents' not in check.trailer['/Root']
  m={'figure':n,'size':size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'scale':s,'offset':[dx,dy],'source_version':'centered-v4-original-color','color':'unchanged embedded image','bleed_mm':4}
  dest.with_suffix('.json').write_text(json.dumps(m,indent=2))
 return n
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
  for n in ex.map(prepare,range(1,237)):
   if n%25==0:print('Prepared',n,flush=True)
 print('Prepared and structurally verified 472 size PDFs',flush=True)
