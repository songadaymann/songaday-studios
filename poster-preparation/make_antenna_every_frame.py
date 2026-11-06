"""Place every decoded source frame once, in order, on a 40x30-inch PDF proof."""
import hashlib,json,os
from pathlib import Path
from reportlab import rl_config
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader
import pypdfium2 as pdfium
rl_config.useA85=0
ROOT=Path(__file__).resolve().parent;TEMP=ROOT/'tmp/iphone-antenna-song';OUT=ROOT/'output/iphone-antenna-every-frame-v1';OUT.mkdir(parents=True,exist_ok=True)
frames=sorted((TEMP/'all-frames').glob('frame-*.jpg'))
assert len(frames)==3608
assert [int(p.stem.split('-')[-1]) for p in frames]==list(range(1,3609))
font=Path(os.environ.get('POSTER_HELVETICA_NEUE','/System/Library/Fonts/HelveticaNeue.ttc'))
pdfmetrics.registerFont(TTFont('Poster',str(font),subfontIndex=0));pdfmetrics.registerFont(TTFont('PosterBold',str(font),subfontIndex=1))
W,H,M=2880,2160,56;COLS,ROWS,GAP=54,67,.32
CW=(W-2*M-GAP*(COLS-1))/COLS;CH=CW*9/16
bottom=H-M-(ROWS*CH+GAP*(ROWS-1));assert bottom>120
pdf=OUT/'iphone-4-antenna-all-3608-frames.pdf'
c=canvas.Canvas(str(pdf),pagesize=(W,H),pageCompression=1)
c.setTitle('The iPhone 4 Antenna Song — Every frame');c.setAuthor('Jonathan Mann')
c.setFillColorRGB(8/255,8/255,8/255);c.rect(0,0,W,H,stroke=0,fill=1)
records=[]
for i,p in enumerate(frames):
 x=M+(i%COLS)*(CW+GAP);y=H-M-CH-(i//COLS)*(CH+GAP)
 assert x>=M-.001 and y>=bottom-.001 and x+CW<=W-M+.001
 c.drawImage(str(p),x,y,CW,CH)
 records.append({'source_frame':i+1,'source_time_seconds':round(i*1001/30000,6),'rect_pt':[round(x,5),round(y,5),round(CW,5),round(CH,5)]})
 if (i+1)%600==0:print('Placed',i+1,'frames',flush=True)
c.setFillColorRGB(1,1,1);c.setFont('PosterBold',54);c.drawString(M,56,'The iPhone 4 Antenna Song')
c.setFont('Poster',16);c.drawString(M,28,'Song A Day #561 · July 15, 2010 · Jonathan Mann')
c.drawRightString(W-M,56,'3,608 frames · the complete video');c.showPage();c.save()
r=PdfReader(pdf);page=r.pages[0];assert len(r.pages)==1 and float(page.mediabox.width)==W and float(page.mediabox.height)==H
images=[v.get_object() for v in page['/Resources']['/XObject'].get_object().values() if v.get_object().get('/Subtype')=='/Image']
assert len(images)==3608 and all(x['/Width']==320 and x['/Height']==180 for x in images)
embedded=sum(bool(f.get_object().get('/FontDescriptor') and f.get_object()['/FontDescriptor'].get_object().get('/FontFile2')) for f in page['/Resources']['/Font'].get_object().values());assert embedded>=2
source=TEMP/'VKIcaejkpD4_Song_A_Day_561_-_The_iPhone_Antenna_Song.mp4'
manifest={'size_inches':[40,30],'grid':[COLS,ROWS],'frame_count':len(frames),'empty_cells':COLS*ROWS-len(frames),'cell_inches':[CW/72,CH/72],'effective_image_ppi':320/(CW/72),'frame_order':'Chronological, row-major, every decoded source frame exactly once','includes_credits':True,'source_video':source.name,'source_video_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'extraction':'ffmpeg -i source.mp4 -map 0:v:0 -vf scale=320:180:flags=lanczos -fps_mode passthrough -q:v 2 all-frames/frame-%05d.jpg','pdf_sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'production_status':'Concept proof only; not uploaded or added to Gelato','frames':records}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
doc=pdfium.PdfDocument(pdf);doc[0].render(scale=1).to_pil().save(OUT/'preview.png');doc.close()
print('Verified all3608frames,54x67grid,40x30in,fontsembedded;cellwidth',round(CW/72,3),'in;PDF',pdf.stat().st_size,flush=True)
