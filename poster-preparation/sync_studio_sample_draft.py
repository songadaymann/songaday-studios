"""Host verified print proofs and save a single UNPAID draft with three samples."""
import concurrent.futures,hashlib,json,time,urllib.request
from pathlib import Path
from sync_gelato_v4 import gelato,put,BASE,UID
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'output/songaday-fh-proof-v1';REF='STUDIO-F-H-MUSCLE015-SAMPLE-v1'
landscape='flat_750x1000-mm-30x40-inch_170-gsm-65lb-coated-silk_4-0_hor'
items=[]
for key in ['f','h']:
 m=json.loads((OUT/f'{key}-metadata.json').read_text());p=OUT/m['filename'];object_key='songaday-fh-proof-v1/'+p.name
 items.append({'itemReferenceId':'SAD-'+key.upper()+'-40x30','productUid':landscape,'quantity':1,'files':[{'type':'default','url':BASE+'/'+object_key}],'pdf_sha256':m['pdf_sha256'],'path':p,'object_key':object_key})
m=json.loads((ROOT/'output/batch-centered-v4-original-color/metadata/015.json').read_text())
items.append({'itemReferenceId':'MUSCLE-015-Sunshine-centered-original-color','productUid':UID,'quantity':1,'files':[{'type':'default','url':BASE+'/centered-v4-original-color/pdf/015.pdf'}],'pdf_sha256':m['pdf_sha256']})
def upload(item):
 if 'path' not in item:return
 marker=OUT/(item['itemReferenceId']+'.uploaded.json')
 if marker.exists():assert json.loads(marker.read_text())['sha256']==item['pdf_sha256'],'Use a new version for changed print files'
 if not marker.exists():
  put(item['path'],item['object_key'],'application/pdf')
  marker.write_text(json.dumps({'url':item['files'][0]['url'],'sha256':item['pdf_sha256']}))
 req=urllib.request.Request(item['files'][0]['url'],method='HEAD',headers={'User-Agent':'SongADayPosterSetup/1.0'})
 with urllib.request.urlopen(req,timeout=20) as r:assert int(r.headers['Content-Length'])==item['path'].stat().st_size
 print(item['itemReferenceId'],'hosted and verified',flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:list(ex.map(upload,items))
original=gelato('orders/c0a32584-1862-4883-a96c-ea0e9696a6a5')
address={k:v for k,v in original['shippingAddress'].items() if k in ['firstName','lastName','addressLine1','addressLine2','city','state','postCode','country','email','phone'] and v is not None}
public_items=[{k:v for k,v in x.items() if k in ['itemReferenceId','productUid','quantity','files']} for x in items]
quote=gelato('orders:quote',{'orderReferenceId':REF,'customerReferenceId':'studio-owner-proof-review','currency':'USD','allowMultipleQuotes':False,'recipient':address,'products':public_items})
summary={'errors':quote.get('errors',[]),'quotes':[{'productCost':sum(p['price'] for p in q.get('products',[])),'shippingOptions':[{'name':s['name'],'price':s['price']} for s in q.get('shipmentMethods',[])],'carrierSurcharge':q.get('carrierSurcharge'),'currency':'USD'} for q in quote.get('quotes',[])]}
(OUT/'sample-quote.json').write_text(json.dumps(summary,indent=2));assert not summary['errors'] and summary['quotes']
matches=gelato('orders:search',{'orderReferenceId':REF,'orderTypes':['draft'],'limit':100})['orders'];assert len(matches)<=1
if matches:order=gelato('orders/'+matches[0]['id'])
else:
 # Never retry an ambiguous creation POST. Rerun this script to reconcile by stable ref.
 order=gelato('orders',{'orderType':'draft','orderReferenceId':REF,'customerReferenceId':'studio-owner-proof-review','currency':'USD','shippingAddress':address,'items':public_items,'metadata':[{'key':'purpose','value':'UNPAID owner sample review: F and H plus corrected Sunshine'},{'key':'artwork','value':'Recovered Song A Day proof layouts unchanged; MUSCLE original-color v4'}]})
assert order['orderType']=='draft' and order['financialStatus']=='draft'
(OUT/'draft-created.json').write_text(json.dumps({'id':order['id'],'reference':REF,'url':f'https://dashboard.gelato.com/checkout/{order["id"]}/product'},indent=2))
order=gelato('orders/'+order['id']);assert len(order['items'])==3
safe=[]
for expected in items:
 actual=next(i for i in order['items'] if i['itemReferenceId']==expected['itemReferenceId'])
 assert actual['quantity']==1 and actual['productUid']==expected['productUid']
 url=next(f['url'] for f in actual['files'] if f['type']=='default')
 for attempt in range(5):
  try:
   digest=hashlib.sha256()
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'SongADayPosterSetup/1.0'}),timeout=30) as r:
    while chunk:=r.read(1024*1024):digest.update(chunk)
   assert digest.hexdigest()==expected['pdf_sha256'];break
  except Exception:
   if attempt==4:raise
   time.sleep(2**attempt)
 safe.append({'reference':expected['itemReferenceId'],'quantity':1,'productUid':actual['productUid'],'pdf_sha256':expected['pdf_sha256'],'stored_file_verified':True})
 print(expected['itemReferenceId'],'Gelato file hash verified',flush=True)
result={'id':order['id'],'reference':REF,'url':f'https://dashboard.gelato.com/checkout/{order["id"]}/product','orderType':order['orderType'],'financialStatus':order['financialStatus'],'items':safe}
(OUT/'draft-verified.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
