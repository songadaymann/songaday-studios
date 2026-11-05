"""Upload immutable sized PDFs, then verify public byte lengths."""
import concurrent.futures,json,time,urllib.request
from pathlib import Path
from sync_gelato_v4 import put,BASE
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'output/store-original-color-v1'
def upload(meta):
 m=json.loads(meta.read_text());size=m['size'];n=m['figure'];marker=meta.with_suffix('.uploaded.json');pdf=meta.with_suffix('.pdf');key=f'store-original-color-v1/{size}/{n:03}.pdf'
 if marker.exists():return
 put(pdf,key,'application/pdf')
 for attempt in range(4):
  try:
   req=urllib.request.Request(BASE+'/'+key,method='HEAD',headers={'User-Agent':'LittlePinkMenPosterSetup/1.0'})
   with urllib.request.urlopen(req,timeout=20) as r:assert int(r.headers['Content-Length'])==pdf.stat().st_size;assert 'application/pdf' in r.headers['Content-Type']
   break
  except Exception:
   if attempt==3:raise
   time.sleep(2**attempt)
 marker.write_text(json.dumps({'sha256':m['sha256'],'url':BASE+'/'+key}))
 return key
if __name__=='__main__':
 files=sorted(OUT.glob('*/*.json'));files=[f for f in files if not f.name.endswith('.uploaded.json')]
 assert len(files)==472
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
  for i,_ in enumerate(ex.map(upload,files),1):
   if i%40==0:print('Uploaded and verified',i,flush=True)
 print('Uploaded and verified all 472 sized print files',flush=True)
