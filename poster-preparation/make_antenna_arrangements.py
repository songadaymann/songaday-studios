"""Four spatial arrangements of the same 3608 frames, with auditable mappings."""
import hashlib,json,os,random,sys
from pathlib import Path
import numpy as np
from PIL import Image
from reportlab import rl_config
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader
import pypdfium2 as pdfium
rl_config.useA85=0
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'output/iphone-antenna-arrangements-v2';OUT.mkdir(parents=True,exist_ok=True)
frames=sorted((ROOT/'tmp/iphone-antenna-song/all-frames').glob('frame-*.jpg'));assert len(frames)==3608
font=Path(os.environ.get('POSTER_HELVETICA_NEUE','/System/Library/Fonts/HelveticaNeue.ttc'))
pdfmetrics.registerFont(TTFont('Poster',str(font),subfontIndex=0));pdfmetrics.registerFont(TTFont('PosterBold',str(font),subfontIndex=1))
W,H,M=2880,2160,56;COLS,ROWS,GAP=54,67,.32
CW=(W-2*M-GAP*(COLS-1))/COLS;CH=CW*9/16
allpos=[(r,c) for r in range(ROWS) for c in range(COLS)]
# Clockwise perimeter walk, layer by layer toward center.
def spiral():
 result=[];top,left,bottom,right=0,0,ROWS-1,COLS-1
 while left<=right and top<=bottom:
  result.extend((top,c) for c in range(left,right+1));top+=1
  result.extend((r,right) for r in range(top,bottom+1));right-=1
  if top<=bottom:result.extend((bottom,c) for c in range(right,left-1,-1));bottom-=1
  if left<=right:result.extend((r,left) for r in range(bottom,top-1,-1));left+=1
 assert len(result)==len(allpos) and len(set(result))==len(allpos)
 return result
edgepos=spiral()
brightness=[];green_fraction=[]
for p in frames:
 a=np.asarray(Image.open(p).resize((32,18)),dtype=float);brightness.append(float((a@np.array([.2126,.7152,.0722])).mean()));green_fraction.append(float(((a[:,:,1]>a[:,:,0]*1.12)&(a[:,:,1]>a[:,:,2]*1.12)&(a[:,:,1]>35)).mean()))
dark=[i for i,v in enumerate(brightness) if v<58 or green_fraction[i]<.12];darkset=set(dark);light=[i for i in range(3608) if i not in darkset]
shuffled=list(range(3608));random.Random(561).shuffle(shuffled)
columnpos=[(r,c) for c in range(COLS) for r in range(ROWS)]
reserved=set(edgepos[:10]);usable=edgepos[10:];darkslots=usable[:len(dark)];lightslots=sorted(usable[len(dark):])
variants=[
 ('a','Vertical film strips','Chronological order down columns',list(zip(columnpos[:3608],range(3608)))),
 ('b','Center-out spiral','Chronological order spiraling outward',list(zip(list(reversed(edgepos))[:3608],range(3608)))),
 ('c','Dispersed mosaic','All frames shuffled; fixed seed 561',list(zip(allpos[:3608],shuffled))),
 ('d','Dark frames at the edge','Dark credits and typography form the border',list(zip(darkslots,dark))+list(zip(lightslots,light)))
]
summary=[]
for key,name,description,mapping in variants:
 if sys.argv[1:] and key not in sys.argv[1:]:
  previous=json.loads((OUT/f'{key}-mapping.json').read_text());previous.pop('mapping');summary.append(previous);continue
 assert len(mapping)==3608 and {i for _,i in mapping}==set(range(3608)) and len({pos for pos,_ in mapping})==3608
 pdf=OUT/f'{key}-all-3608-frames.pdf';c=canvas.Canvas(str(pdf),pagesize=(W,H),pageCompression=1)
 c.setTitle(f'The iPhone 4 Antenna Song — {name}');c.setAuthor('Jonathan Mann');c.setFillColorRGB(8/255,8/255,8/255);c.rect(0,0,W,H,stroke=0,fill=1)
 records=[]
 for (row,col),index in mapping:
  x=M+col*(CW+GAP);y=H-M-CH-row*(CH+GAP)
  c.drawImage(str(frames[index]),x,y,CW,CH)
  records.append({'source_frame':index+1,'row':row,'column':col})
 c.setFillColorRGB(1,1,1);c.setFont('PosterBold',54);c.drawString(M,56,'The iPhone 4 Antenna Song');c.setFont('Poster',16);c.drawString(M,28,'Song A Day #561 · July 15, 2010 · Jonathan Mann');c.drawRightString(W-M,56,'3,608 frames · '+name.lower());c.showPage();c.save()
 p=PdfReader(pdf).pages[0];imgs=[v.get_object() for v in p['/Resources']['/XObject'].get_object().values() if v.get_object().get('/Subtype')=='/Image'];assert len(imgs)==3608
 doc=pdfium.PdfDocument(pdf);doc[0].render(scale=.75).to_pil().save(OUT/f'{key}-preview.png');doc.close()
 manifest={'variant':key,'name':name,'description':description,'frame_count':3608,'grid':[COLS,ROWS],'size_inches':[40,30],'all_source_frames_once':True,'dark_threshold_luma':58 if key=='d' else None,'dark_frame_count':len(dark) if key=='d' else None,'green_fraction_threshold':.12 if key=='d' else None,'unchanged_frame_images':True,'pdf_sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'mapping':records}
 (OUT/f'{key}-mapping.json').write_text(json.dumps(manifest,indent=2)+'\n')
 summary.append({k:v for k,v in manifest.items() if k!='mapping'});print(key,name,'verified all3608frames',flush=True)
# A labeled document comparison, composed from the four rendered proofs.
compare=OUT/'comparison.pdf';c=canvas.Canvas(str(compare),pagesize=(1440,1160));c.setFillColorRGB(.035,.035,.035);c.rect(0,0,1440,1160,stroke=0,fill=1)
for n,(key,name,description,_) in enumerate(variants):
 x=24+(n%2)*708;y=1160-((n//2)+1)*564
 c.setFillColorRGB(1,1,1);c.setFont('PosterBold',20);c.drawString(x,y+534,f'{key.upper()} · {name}');c.setFont('Poster',12);c.drawString(x,y+513,description)
 c.drawImage(str(OUT/f'{key}-preview.png'),x,y-10,684,513)
c.showPage();c.save();doc=pdfium.PdfDocument(compare);doc[0].render(scale=1.5).to_pil().save(OUT/'comparison.png');doc.close()
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print('Comparison ready;dark frames:',len(dark),flush=True)
