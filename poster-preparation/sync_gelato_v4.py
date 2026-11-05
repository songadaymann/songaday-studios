"""Upload prepared artwork and save one unpaid, deduplicated Gelato draft per figure."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import time
import tomllib
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output/batch-centered-v4-original-color'
BASE = 'https://pub-628557d373994774b927858e58ccab6f.r2.dev'
PREFIX = 'centered-v4-original-color'
UID = 'flat_750x1000-mm-30x40-inch_170-gsm-65lb-coated-silk_4-0_ver'


def gelato(path, payload=None):
    req = urllib.request.Request('https://order.gelatoapis.com/v4/' + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'X-API-KEY': (Path.home() / '.config/gelato/api-key').read_text().strip(),
                 'Content-Type': 'application/json', 'User-Agent': 'LittlePinkMenPosterSetup/1.0'})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # HTTP 429 explicitly rejected the request; retrying is safe.
            if error.code != 429 or attempt == 7:
                raise
            time.sleep(min(45, 2 ** (attempt + 1)))


def put(path, key, content_type):
    cfg = tomllib.loads((Path.home() / 'Library/Preferences/.wrangler/config/default.toml').read_text())
    for attempt in range(5):
        try:
            req = urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/a79a1faef6e8f94566f3320429d54006/r2/buckets/muscle-poster-proofs/objects/' + key,
                data=path.read_bytes(), method='PUT', headers={'Authorization': 'Bearer ' + cfg['oauth_token'], 'Content-Type': content_type})
            with urllib.request.urlopen(req, timeout=30) as response:
                assert response.status == 200
            return
        except Exception as error:
            print(f'Upload retry for {key}: {type(error).__name__} {getattr(error, "code", "")}', flush=True)
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def sync(number, address):
    marker = OUT / 'gelato' / f'{number:03}.json'
    if marker.exists():
        return
    data = json.loads((OUT / 'metadata' / f'{number:03}.json').read_text())
    upload_marker = OUT / 'uploads' / f'{number:03}.json'
    if not upload_marker.exists():
        put(OUT / 'pdf' / f'{number:03}.pdf', f'{PREFIX}/pdf/{number:03}.pdf', 'application/pdf')
        put(OUT / 'preview' / f'{number:03}.jpg', f'{PREFIX}/preview/{number:03}.jpg', 'image/jpeg')
        upload_marker.write_text(json.dumps({'sha256': data['pdf_sha256']}))
    ref = f'LPM-{number:03}-centered-v4-original-color'
    # Reconcile by stable reference before creation, including resumed runs.
    matches = gelato('orders:search', {'orderReferenceId': ref, 'orderTypes': ['draft'], 'limit': 100})['orders']
    if matches:
        assert len(matches) == 1, 'Duplicate draft references require review'
        order = gelato('orders/' + matches[0]['id'])
    else:
        payload = {'orderType': 'draft', 'orderReferenceId': ref, 'customerReferenceId': 'lpm-catalog-review',
            'currency': 'USD', 'shippingAddress': address,
            'items': [{'itemReferenceId': f'{number:03}-{data["name"]}', 'productUid': UID, 'quantity': 1,
                       'files': [{'type': 'default', 'url': f'{BASE}/{PREFIX}/pdf/{number:03}.pdf'}]}],
            'metadata': [{'key': 'figure', 'value': str(number)}, {'key': 'name', 'value': data['name']},
                         {'key': 'framing', 'value': PREFIX}, {'key': 'purpose', 'value': 'Unpaid catalog review draft'}]}
        # Never automatically retry an uncertain POST; a rerun reconciles first.
        order = gelato('orders', payload)
    assert order['orderType'] == 'draft', 'Expected an unpaid draft'
    saved = {k: order.get(k) for k in ['id', 'orderType', 'orderReferenceId', 'fulfillmentStatus', 'financialStatus']}
    saved.update({'figure': number, 'name': data['name'], 'pdf_sha256': data['pdf_sha256']})
    temp = marker.with_suffix('.partial')
    temp.write_text(json.dumps(saved, indent=2) + '\n')
    temp.rename(marker)
    print(f'{number:03} uploaded and saved as draft {order["id"]}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--only', type=int)
    args = parser.parse_args()
    for folder in ['gelato', 'uploads']:
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    original = gelato('orders/c0a32584-1862-4883-a96c-ea0e9696a6a5')
    allowed = ['firstName', 'lastName', 'addressLine1', 'addressLine2', 'city', 'state', 'postCode', 'country', 'email', 'phone']
    address = {k: v for k, v in original['shippingAddress'].items() if k in allowed and v is not None}
    assert address['country'] == 'US'
    numbers = [args.only] if args.only else range(1, 237)
    while True:
        pending = [n for n in numbers if (OUT / 'metadata' / f'{n:03}.json').exists() and not (OUT / 'gelato' / f'{n:03}.json').exists()]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda n: sync(n, address), pending))
        if not args.watch or all((OUT / 'gelato' / f'{n:03}.json').exists() for n in numbers):
            break
        time.sleep(5)
