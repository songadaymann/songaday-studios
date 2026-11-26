"""Wrap recovered F/H 300dpi JPEGs without recompression; add mirrored 4mm bleed."""
import hashlib,json,os
from pathlib import Path
from reportlab import rl_config
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import pypdfium2 as pdfium
rl_config.useA85=0
ROOT=Path(__file__).resolve().parent
SOURCE=Path(os.environ.get('SONGADAY_POSTER_SOURCE',ROOT.parent/'songaday-studios/output/poster-concepts/designs/print-300'))
OUT=ROOT/'output/songaday-fh-proof-v1';OUT.mkdir(parents=True,exist_ok=True)
B=4*72/25.4;TW=40*72;TH=30*72;W=TW+2*B;H=TH+2*B
names={'f':'Continuous grid','h':'Eighteen year blocks'}
for key,name in names.items():
 source=SOURCE/f'{key}-40x30-300dpi.jpg';dest=OUT/f'songaday-{key}-40x30-proof-v1.pdf'
 metadata=OUT/f'{key}-metadata.json'
 if dest.exists() and metadata.exists():
  m=json.loads(metadata.read_text())
  assert hashlib.sha256(dest.read_bytes()).hexdigest()==m['pdf_sha256']
  assert hashlib.sha256(source.read_bytes()).hexdigest()==m['source_jpeg_sha256']
  print(key,'existing immutable proof verified',flush=True);continue
 c=canvas.Canvas(str(dest),pagesize=(W,H),pageCompression=1,pdfVersion=(1,4))
 c.setTitle(f'Song A Day - {key.upper()} - {name} - 40 x 30 inch sample')
 c.setAuthor('Jonathan Mann');c.setTrimBox((B,B,B+TW,B+TH));c.setBleedBox((0,0,W,H))
 # Neighbor reflections sit entirely outside nominal trim; original art is unchanged.
 for x in [-1,0,1]:
  for y in [-1,0,1]:
   if x==0 and y==0:continue
   c.saveState()
   c.translate(2*(B if x==-1 else B+TW) if x else 0,2*(B if y==-1 else B+TH) if y else 0)
   c.scale(-1 if x else 1,-1 if y else 1)
   c.drawImage(str(source),B,B,TW,TH)
   c.restoreState()
 c.drawImage(str(source),B,B,TW,TH);c.showPage();c.save()
 r=PdfReader(dest);p=r.pages[0]
 assert len(r.pages)==1 and abs(float(p.trimbox.width)-TW)<.001 and abs(float(p.trimbox.height)-TH)<.001
 images=[x.get_object() for x in p['/Resources']['/XObject'].get_object().values() if x.get_object().get('/Subtype')=='/Image']
 assert len(images)==1
 image=images[0];assert str(image['/Filter'])=='/DCTDecode' or '/DCTDecode' in image['/Filter']
 assert image['/Width']==12000 and image['/Height']==9000 and image['/ColorSpace']=='/DeviceRGB'
 original=source.read_bytes();assert image._data==original
 d={'layout':key,'name':name,'trim_inches':[40,30],'page_mm':[1024,770],'bleed_mm':4,'bleed_treatment':'mirrored outside nominal trim','image_pixels':[12000,9000],'effective_ppi':300,'source_jpeg_sha256':hashlib.sha256(original).hexdigest(),'pdf_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'jpeg_bytes_unchanged':True,'artwork_status':'Recovered proof artwork; imagery through song6505; title/count unchanged','filename':dest.name}
 (OUT/f'{key}-metadata.json').write_text(json.dumps(d,indent=2)+'\n')
 doc=pdfium.PdfDocument(dest);page=doc[0];page.render(scale=.5).to_pil().save(OUT/f'{key}-pdf-preview.png');doc.close()
 print(key,'PDF created, source JPEG bytes verified, 300ppi,40x30 trim,4mm bleed',dest.stat().st_size,flush=True)
