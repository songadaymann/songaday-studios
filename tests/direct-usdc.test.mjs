import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';

const source = readFileSync(new URL('../profile.js', import.meta.url), 'utf8');
const donationEnd = source.indexOf('  // wallet-detect.js and wallet-gate.js');
assert.ok(donationEnd > 0, 'profile.js ends the donation code before starting the wallet gate');
const donationScript = new Script(`${source.slice(0, donationEnd)}\n})();`, { filename: 'profile.js' });

const account = '0x0000000000000000000000000000000000000001';
const recipient = '42469b0a89ce1215e72ad1f8f5d03ad4776c1fcb';

function element(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(type, listener) { listeners.set(type, listener); },
    async submit() {
      let prevented = false;
      const listener = listeners.get('submit');
      assert.ok(listener, 'the form has a submit listener');
      await listener({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    },
    focus() { this.focused = true; }
  };
}

async function setUp(options = {}) {
  const { selectedNetwork = 'base', chain = '0x2105', amount = '12.345678', respond = () => undefined } = options;
  const calls = [];
  let activeChain = chain;
  const provider = {
    async request({ method, params }) {
      calls.push(structuredClone({ method, params }));
      const response = respond(method);
      if (response !== undefined) return response;
      if (method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') return activeChain;
      if (method === 'wallet_switchEthereumChain') {
        activeChain = params[0].chainId;
        return null;
      }
      if (method === 'eth_sendTransaction') return '0xtest';
      throw new Error(`Unexpected wallet method ${method}`);
    }
  };
  const elements = new Map([
    ['crypto-donate', element({ hidden: true })],
    ['zeffy-donate', element({ hidden: false })],
    ['charitable-tax-note', element({ hidden: false })],
    ['direct-usdc', element({ hidden: false })],
    ['usdc-amount', element({ value: amount })],
    ['usdc-network', element({ value: selectedNetwork })],
    ['open-usdc-wallet', element({ disabled: false })],
    ['usdc-status', element({ textContent: '' })]
  ]);
  const window = new EventTarget();
  const document = { documentElement: { dataset: {} }, getElementById: (id) => elements.get(id) };
  donationScript.runInNewContext({ window, document, CustomEvent });
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'test', name: 'MetaMask', icon: 'test', rdns: 'io.metamask' }, provider }
  }));
  await Promise.resolve();
  return { elements, calls, submit: () => elements.get('direct-usdc').submit() };
}

test('a Base USDC tip requests the correct transfer only after form submission', async () => {
  const { elements, calls, submit } = await setUp();
  assert.deepEqual(calls, []);
  assert.equal(elements.get('crypto-donate').hidden, false);
  assert.equal(elements.get('charitable-tax-note').hidden, true);

  await submit();
  assert.deepEqual(calls.map(({ method }) => method), ['eth_requestAccounts', 'eth_chainId', 'eth_sendTransaction']);
  assert.deepEqual(calls.at(-1).params, [{
    from: account,
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: `0xa9059cbb${recipient.padStart(64, '0')}${'bc614e'.padStart(64, '0')}`
  }]);
  assert.equal(elements.get('usdc-amount').value, '');
  assert.equal(elements.get('open-usdc-wallet').disabled, false);
});

test('an Ethereum USDC tip switches and verifies chain before sending to the Ethereum token', async () => {
  const { calls, submit } = await setUp({ selectedNetwork: 'ethereum', amount: '1,25' });
  await submit();

  assert.deepEqual(calls.map(({ method }) => method), [
    'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId', 'eth_sendTransaction'
  ]);
  assert.deepEqual(calls[2].params, [{ chainId: '0x1' }]);
  assert.deepEqual(calls.at(-1).params, [{
    from: account,
    to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    data: `0xa9059cbb${recipient.padStart(64, '0')}${'1312d0'.padStart(64, '0')}`
  }]);
});

test('a rejected wallet connection never asks for a transfer', async () => {
  const { elements, calls, submit } = await setUp({
    respond(method) { if (method === 'eth_requestAccounts') throw Object.assign(new Error('Rejected'), { code: 4001 }); }
  });
  await submit();

  assert.deepEqual(calls.map(({ method }) => method), ['eth_requestAccounts']);
  assert.match(elements.get('usdc-status').textContent, /canceled/i);
  assert.equal(elements.get('open-usdc-wallet').disabled, false);
});

test('a rejected Base chain switch never asks for a transfer', async () => {
  const { elements, calls, submit } = await setUp({
    chain: '0x1',
    respond(method) { if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('Rejected'), { code: 4001 }); }
  });
  await submit();

  assert.deepEqual(calls.map(({ method }) => method), ['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain']);
  assert.deepEqual(calls[2].params, [{ chainId: '0x2105' }]);
  assert.match(elements.get('usdc-status').textContent, /canceled/i);
});

test('a wallet still on the wrong chain after switching never asks for a transfer', async () => {
  const { elements, calls, submit } = await setUp({
    chain: '0x1',
    respond(method) { if (method === 'wallet_switchEthereumChain') return null; }
  });
  await submit();

  assert.deepEqual(calls.map(({ method }) => method), [
    'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId'
  ]);
  assert.match(elements.get('usdc-status').textContent, /connected to Base/);
});

test('invalid precision never prompts the wallet', async () => {
  const { elements, calls, submit } = await setUp({ amount: '0.0000001' });
  await submit();

  assert.deepEqual(calls, []);
  assert.equal(elements.get('usdc-amount').focused, true);
  assert.match(elements.get('usdc-status').textContent, /up to six decimal places/);
});
