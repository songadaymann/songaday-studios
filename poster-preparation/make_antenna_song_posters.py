"""Two native PDF contact-sheet poster concepts using real archived video frames."""
import hashlib,json,os
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
ROOT=Path(__file__).resolve().parent;TEMP=ROOT/'tmp/iphone-antenna-song';OUT=ROOT/'output/iphone-antenna-song-v1';OUT.mkdir(parents=True,exist_ok=True)
font=Path(os.environ.get('POSTER_HELVETICA_NEUE','/System/Library/Fonts/HelveticaNeue.ttc'))
pdfmetrics.registerFont(TTFont('Poster',str(font),subfontIndex=0));pdfmetrics.registerFont(TTFont('PosterBold',str(font),subfontIndex=1))
source=TEMP/'VKIcaejkpD4_Song_A_Day_561_-_The_iPhone_Antenna_Song.mp4'
frames=[]
for p in sorted((TEMP/'poster-frames').glob('frame-*.jpg')):
 index=int(p.stem.split('-')[-1]);time=7+(index-1)/3
 if not(11.70<=time<=113.50) or 72.038633<=time<=77.243833:continue
 im=Image.open(p);assert im.size==(1280,720)
 # Drop the near-black end of a fade, but retain the monochrome FANBOY sequence.
 if np.asarray(im.resize((64,36))).mean()<8:continue
 frames.append({'path':p,'time':round(time,3)})
assert len(frames)>=180
W,H=2880,2160;M=56
for key,title,cols,rows,gap in [('a','Sequence',8,10,4.3),('b','Mosaic',12,15,1.8)]:
 count=cols*rows;indices=np.linspace(0,len(frames)-1,count).round().astype(int);assert len(set(indices))==count
 chosen=[frames[i] for i in indices]
 pdf=OUT/f'iphone-4-antenna-{key}-{count}-frames.pdf'
 c=canvas.Canvas(str(pdf),pagesize=(W,H),pageCompression=1)
 c.setTitle(f'The iPhone 4 Antenna Song — {title}, {count} frames');c.setAuthor('Jonathan Mann')
 c.setFillColorRGB(8/255,8/255,8/255);c.rect(0,0,W,H,stroke=0,fill=1)
 tw=(W-2*M-gap*(cols-1))/cols;th=tw*9/16;gridH=rows*th+gap*(rows-1);bottom=H-M-gridH
 assert bottom>120
 manifest=[]
 for i,f in enumerate(chosen):
  x=M+(i%cols)*(tw+gap);y=H-M-th-(i//cols)*(th+gap)
  c.drawImage(str(f['path']),x,y,tw,th)
  manifest.append({'frame':f['path'].name,'time_seconds':f['time'],'rect_pt':[x,y,tw,th]})
 c.setFillColorRGB(1,1,1);c.setFont('PosterBold',54);c.drawString(M,56,'The iPhone 4 Antenna Song')
 c.setFont('Poster',16);c.drawString(M,28,'Song A Day #561 · July 15, 2010 · Jonathan Mann')
 c.drawRightString(W-M,56,f'{count} frames')
 c.showPage();c.save()
 doc=pdfium.PdfDocument(pdf);doc[0].render(scale=.75).to_pil().save(OUT/f'{key}-preview.png');doc.close()
 reader=PdfReader(pdf);page=reader.pages[0];assert len(reader.pages)==1 and float(page.mediabox.width)==W and float(page.mediabox.height)==H
 images=[v.get_object() for v in page['/Resources']['/XObject'].get_object().values() if v.get_object().get('/Subtype')=='/Image'];assert len(images)==count
 assert all(im['/Width']==1280 and im['/Height']==720 for im in images)
 fonts=page['/Resources']['/Font'].get_object();embedded=0
 for f in fonts.values():
  fontobj=f.get_object();descriptor=fontobj.get('/FontDescriptor')
  if descriptor and descriptor.get_object().get('/FontFile2'):embedded+=1
 assert embedded>=2
 (OUT/f'{key}-manifest.json').write_text(json.dumps({'variant':key,'name':title,'size_inches':[40,30],'grid':[cols,rows],'frame_count':count,'font':'Helvetica Neue','source_video':source.name,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'song_number':561,'song_date':'2010-07-15','source_resolution':[1280,720],'effective_image_ppi':round(1280/(tw/72),1),'retail_status':'Concept proof, not uploaded to Gelato','frames':manifest,'pdf_sha256':hashlib.sha256(pdf.read_bytes()).hexdigest()},indent=2)+'\n')
 print(key,title,count,'frames;sourceimages1280x720,fonts embedded,ppi',round(1280/(tw/72),1),flush=True)
print('Created both 40x30 inch concepts',flush=True)
