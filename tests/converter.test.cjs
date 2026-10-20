const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseConfig, compilePlugins } = require('../lib/converter.cjs');
const { createPlugin } = require('../lib/runtime.cjs');

const line = { id: 'tx', name: '小Q源', enabled: true, searchApi: 'txSearchMusic', detailApi: 'txMusicDetail', levels: ['standard', 'exhigh', 'lossless'] };
const config = { lines: [line] };
const factory = () => ({ search: async () => ({ data: [{ id: 'mid', rid: 'mid', title: '歌', duration: 300 }], isEnd: true }) });
function plugin(http, extra = {}) {
  return createPlugin({ line, version: '1.0.0', gatewayUrl: 'https://gateway.example/v1/music/resolve-url', platform: '青听QQ', ...extra }, factory, { http });
}
test('parses leading metadata comments without evaluating code or damaging URLs', () => {
  const parsed = parseConfig('/** @name 青听音源 */\n' + JSON.stringify(config));
  assert.equal(parsed.lines[0].id, 'tx');
  assert.throws(() => parseConfig('globalThis.executed=true; ' + JSON.stringify(config)), /JSON/);
});
test('rejects unknown handlers and duplicate line IDs', () => {
  assert.throws(() => parseConfig(JSON.stringify({ lines: [{ ...line, searchApi: 'evil' }] })), /handler/);
  assert.throws(() => parseConfig(JSON.stringify({ lines: [line, line] })), /duplicate/);
  assert.throws(() => parseConfig(JSON.stringify({ lines: [{ id: '__proto__', name: 'bad', levels: ['standard'] }] })), /Unsupported line/);
});
test('builds standalone CommonJS plugins and absolute subscription URLs', async () => {
  const files = compilePlugins(config, { baseUrl: 'https://owner.github.io/plugins/', adapters: { tx: factory } });
  assert.equal(files.manifest.plugins[0].url, 'https://owner.github.io/plugins/qing-tx.js');
  const sandbox = { module: { exports: {} }, require: () => ({}), console };
  vm.runInNewContext(files.scripts['qing-tx.js'], sandbox);
  const p = sandbox.module.exports;
  assert.equal(p.cacheControl, 'no-cache');
  assert.equal((await p.search('歌', 1, 'music')).data[0].platform, p.platform);
  assert.equal((await p.search('歌', 1, 'album')).data.length, 0);
  assert.ok(!files.scripts['qing-tx.js'].includes('NativeModules'));
});
test('omits disabled lines and rejects unhosted manifests instead of inventing URLs', () => {
  const files = compilePlugins({ lines: [{ ...line, enabled: false }] }, { baseUrl: 'https://owner.github.io/plugins/', adapters: {} });
  assert.equal(files.manifest.plugins.length, 0);
  assert.throws(() => compilePlugins(config, { baseUrl: 'file:///tmp/', adapters: { tx: factory } }), /HTTPS/);
});
test('uses songmid, mapped quality, returned playback headers; no app identity', async () => {
  let request;
  const p = plugin({ post: async (...args) => {
    request = args;
    return { data: { code: 0, data: { url: 'https://audio.example/song.mp3', headers: { Referer: 'https://a.example/' }, playbackHeaders: { Referer: 'https://b.example/' } } } };
  } });
  const source = await p.getMediaSource({ id: '123', rid: 'songmid' }, 'high');
  assert.equal(request[1].rid, 'songmid');
  assert.equal(request[1].level, 'exhigh');
  assert.equal(request[1].source, 'tx');
  assert.deepEqual(request[2].headers, { 'Content-Type': 'application/json' });
  assert.equal(source.headers.Referer, 'https://b.example/');
  assert.equal(source.quality, undefined);
  assert.equal(await p.getMediaSource({ id: 'x' }, 'low'), null);
});
test('surfaces upstream failure and refuses encrypted or local-only results', async () => {
  const response = { code: 'UPSTREAM_INVALID_RESPONSE', message: 'fail' };
  const p = plugin({ post: async () => ({ data: response }) });
  await assert.rejects(p.getMediaSource({ id: 'mid' }, 'standard'), /UPSTREAM_INVALID_RESPONSE/);
  response.code = 0;
  response.data = { url: 'https://audio.example/a', need_decrypt: true };
  await assert.rejects(p.getMediaSource({ id: 'mid' }, 'standard'), /ENCRYPTED/);
  response.data = { url: 'http://127.0.0.1:9999/song' };
  await assert.rejects(p.getMediaSource({ id: 'mid' }, 'standard'), /LOCAL/);
});
test('never silently downgrades requested quality or advertises undeclared levels', async () => {
  let calls = 0;
  const p = plugin({ post: async () => { calls++; return { data: { code: 0, data: { url: 'https://audio.example/a' } } }; } }, { line: { ...line, levels: ['standard'] } });
  assert.equal(await p.getMediaSource({ id: 'x' }, 'super'), null);
  assert.equal(calls, 0);
});
test('does not label gateway audio as lossless without returned quality evidence', async () => {
  const p = plugin({ post: async () => ({ data: { code: 0, data: { url: 'https://audio.example/a.mp3' } } }) });
  assert.equal((await p.getMediaSource({ id: 'x' }, 'super')).quality, undefined);
});
test('rejects private destinations and drops sensitive gateway-supplied headers', async () => {
  const result = { url: 'http://192.168.1.2/song' };
  const p = plugin({ post: async () => ({ data: { code: 0, data: result } }) });
  await assert.rejects(p.getMediaSource({ id: 'x' }, 'standard'), /LOCAL/);
  result.url = 'https://audio.example/song';
  result.headers = { Cookie: 'not-user-data', Authorization: 'not-user-data', Referer: 'https://example.org/', 'User-Agent': 'MusicFree' };
  result.userAgent = 'MusicFree\r\nInjected: invalid';
  const source = await p.getMediaSource({ id: 'x' }, 'standard');
  assert.equal(source.headers.Cookie, undefined);
  assert.equal(source.headers.Authorization, undefined);
  assert.equal(source.headers.Referer, 'https://example.org/');
  assert.equal(source.userAgent, undefined);
});
