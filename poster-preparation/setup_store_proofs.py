"""Validate each additional store configuration as an unpaid Sunshine review draft."""
import concurrent.futures,hashlib,json,urllib.request
from pathlib import Path
from sync_gelato_v4 import gelato
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'output/store-original-color-v1/proofs';OUT.mkdir(exist_ok=True)
original=gelato('orders/c0a32584-1862-4883-a96c-ea0e9696a6a5')
address={k:v for k,v in original['shippingAddress'].items() if k in ['firstName','lastName','addressLine1','addressLine2','city','state','postCode','country','email','phone'] and v is not None}
variants=json.loads((ROOT/'research/store-variants.json').read_text())
def setup(v):
 if v['size']=='30x40':return
 marker=OUT/(v['id']+'.json')
 if marker.exists():return
 ref='LPM-015-store-v1-'+v['id'];matches=gelato('orders:search',{'orderReferenceId':ref,'orderTypes':['draft'],'limit':100})['orders']
 assert len(matches)<=1
 url=f'https://pub-628557d373994774b927858e58ccab6f.r2.dev/store-original-color-v1/{v["size"]}/015.pdf'
 if matches:order=gelato('orders/'+matches[0]['id'])
 else:order=gelato('orders',{'orderType':'draft','orderReferenceId':ref,'customerReferenceId':'lpm-store-review','currency':'USD','shippingAddress':address,'items':[{'itemReferenceId':v['id'],'productUid':v['productUid'],'quantity':1,'files':[{'type':'default','url':url}]}]})
 assert order['orderType']=='draft' and order['financialStatus']=='draft'
 stored=gelato('orders/'+order['id']);item=stored['items'][0]
 assert item['productUid']==v['productUid']
 with urllib.request.urlopen(urllib.request.Request(item['files'][0]['url'],headers={'User-Agent':'LittlePinkMenPosterSetup/1.0'}),timeout=30) as response: data=response.read()
 expected=json.loads((ROOT/'output/store-original-color-v1'/v['size']/'015.json').read_text())['sha256']
 assert hashlib.sha256(data).hexdigest()==expected
 safe={**v,'gelatoId':order['id'],'gelatoUrl':f'https://dashboard.gelato.com/checkout/{order["id"]}/product','reference':ref,'sha256':expected,'verified':True,'unpaid':True}
 marker.write_text(json.dumps(safe,indent=2));print(v['id'],'draft verified',flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:list(ex.map(setup,variants))
