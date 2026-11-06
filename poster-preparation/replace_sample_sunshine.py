"""Replace unpaid sample cart with Sunshine A; never convert or charge an order."""
import json,hashlib,time,urllib.request,urllib.error
from pathlib import Path
from sync_gelato_v4 import gelato,BASE,UID
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'output/songaday-fh-sunshine-a-proof-v2';OUT.mkdir(exist_ok=True)
OLD='434e3ddf-0a4e-469c-a6ce-33b842c22938';REF='STUDIO-F-H-MUSCLE039-SAMPLE-v2'
matches=gelato('orders:search',{'orderReferenceId':REF,'limit':100})['orders'];assert len(matches)<=1
try:prior=gelato('orders/'+OLD)
except urllib.error.HTTPError as e:
 if e.code==404 and matches:prior=None
 else:raise
if prior:assert prior['orderType']=='draft' and prior['financialStatus']=='draft','Original sample is no longer an unpaid draft'
items=[]
for key in ['f','h']:
 m=json.loads((ROOT/'output/songaday-fh-proof-v1'/f'{key}-metadata.json').read_text())
 items.append({'itemReferenceId':'SAD-'+key.upper()+'-40x30','productUid':'flat_750x1000-mm-30x40-inch_170-gsm-65lb-coated-silk_4-0_hor','quantity':1,'files':[{'type':'default','url':BASE+'/songaday-fh-proof-v1/'+m['filename']}],'sha256':m['pdf_sha256']})
m=json.loads((ROOT/'output/batch-centered-v4-original-color/metadata/039.json').read_text())
items.append({'itemReferenceId':'MUSCLE-039-Sunshine-A-centered-original-color','productUid':UID,'quantity':1,'files':[{'type':'default','url':BASE+'/centered-v4-original-color/pdf/039.pdf'}],'sha256':m['pdf_sha256']})
if matches:order=gelato('orders/'+matches[0]['id'])
else:
 address={k:v for k,v in prior['shippingAddress'].items() if k in ['firstName','lastName','addressLine1','addressLine2','city','state','postCode','country','email','phone'] and v is not None}
 order=gelato('orders',{'orderType':'draft','orderReferenceId':REF,'customerReferenceId':'studio-owner-proof-review','currency':'USD','shippingAddress':address,'items':[{k:v for k,v in item.items() if k!='sha256'} for item in items],'metadata':[{'key':'purpose','value':'UNPAID owner samples: F, H and Sunshine A #039; replaces Sunshine D cart'}]})
assert order['orderType']=='draft' and order['financialStatus']=='draft'
(OUT/'draft-created.json').write_text(json.dumps({'id':order['id'],'reference':REF},indent=2))
order=gelato('orders/'+order['id']);assert len(order['items'])==3
records=[]
for expected in items:
 actual=next(i for i in order['items'] if i['itemReferenceId']==expected['itemReferenceId']);assert actual['quantity']==1 and actual['productUid']==expected['productUid']
 for attempt in range(4):
  try:
   h=hashlib.sha256()
   with urllib.request.urlopen(urllib.request.Request(actual['files'][0]['url'],headers={'User-Agent':'SongADayPosterSetup/1.0'}),timeout=30) as r:
    while chunk:=r.read(1024*1024):h.update(chunk)
   assert h.hexdigest()==expected['sha256'];break
  except Exception:
   if attempt==3:raise
   time.sleep(2**attempt)
 records.append({'reference':expected['itemReferenceId'],'productUid':expected['productUid'],'quantity':1,'pdf_sha256':expected['sha256'],'verified':True});print('Verified',expected['itemReferenceId'],flush=True)
if prior:
 current=gelato('orders/'+OLD);assert current['orderType']=='draft' and current['financialStatus']=='draft'
 req=urllib.request.Request('https://order.gelatoapis.com/v4/orders/'+OLD,method='DELETE',headers={'X-API-KEY':(Path.home()/'.config/gelato/api-key').read_text().strip(),'User-Agent':'SongADayPosterSetup/1.0'})
 with urllib.request.urlopen(req,timeout=30) as r:assert r.status in [200,204]
result={'id':order['id'],'reference':REF,'url':f'https://dashboard.gelato.com/checkout/{order["id"]}/product','orderType':'draft','financialStatus':'draft','superseded_draft':OLD,'superseded_draft_removed':True,'items':records}
(OUT/'draft-verified.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
