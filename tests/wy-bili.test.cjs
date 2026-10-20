const test = require('node:test');
const assert = require('node:assert/strict');

function load(name, http) {
  const factory = require('../adapters/' + name + '.cjs');
  // Generated plugins embed the factory source, without CommonJS scope.
  return (0, eval)('(' + factory.toString() + ')')({ http, he: { decode: s => s.replace(/&amp;/g, '&') }, line: {} });
}

test('wy maps public song fields and uses zero-based search offset', async () => {
  const adapter = load('wy', { get: async (url, config) => {
    assert.match(url, /api\/search\/get$/);
    assert.equal(config.params.offset, 30);
    return { data: { code: 200, result: { songCount: 31, songs: [
      { id: 42, name: '海阔天空', artists: [{ name: 'Beyond' }, { name: '客席' }], album: { name: '乐与怒', picUrl: 'https://cover' }, duration: 326123 },
    ] } } };
  } });
  const result = await adapter.search('海阔天空', 2);
  assert.deepEqual(result, { data: [{ id: '42', rid: '42', title: '海阔天空', artist: 'Beyond、客席', album: '乐与怒', artwork: 'https://cover', duration: 326.123 }], isEnd: true });
});

test('wy lyric returns rawLrc and rejects upstream API errors', async () => {
  let fail = false;
  const adapter = load('wy', { get: async (url, config) => {
    assert.equal(config.params.id, '42');
    return { data: fail ? { code: 503 } : { code: 200, lrc: { lyric: '[00:01]海阔天空' } } };
  } });
  assert.deepEqual(await adapter.getLyric({ id: '42' }), { rawLrc: '[00:01]海阔天空' });
  fail = true;
  await assert.rejects(adapter.getLyric({ id: '42' }), /503/);
});

test('wy detail fills cover and keeps the stable song id', async () => {
  const adapter = load('wy', { get: async (url, config) => {
    assert.match(url, /\/api\/song\/detail$/);
    assert.equal(config.params.ids, '[42]');
    return { data: { code: 200, songs: [{ id: 42, name: '海阔天空', artists: [{ name: 'Beyond' }], album: { name: '乐与怒', picUrl: 'https://full-cover' }, duration: 327000 }] } };
  } });
  const detail = await adapter.getMusicInfo({ id: '42', rid: '42' });
  assert.equal(detail.id, '42');
  assert.equal(detail.artwork, 'https://full-cover');
  assert.equal(detail.duration, 327);
});

test('bili decodes titles, duration, cover and keeps bvid/aid across pagination', async () => {
  const adapter = load('bili', { get: async (url, config) => {
    assert.equal(config.params.page, 2);
    return { data: { code: 0, data: { numPages: 3, result: [
      { result_type: 'other', data: [] },
      { result_type: 'video', data: [{ aid: 123, bvid: 'BVtest', title: '<em class="keyword">海阔天空</em> &amp; Live', author: 'Beyond', pic: '//cover', duration: '1:05:27' }] },
    ] } } };
  } });
  const result = await adapter.search('海阔天空', 2);
  assert.equal(result.isEnd, false);
  assert.deepEqual(result.data[0], { id: 'BVtest', rid: 'BVtest', bvid: 'BVtest', aid: '123', title: '海阔天空 & Live', artist: 'Beyond', album: '', artwork: 'https://cover', duration: 3927 });
});

test('bili resolves cid and returns highest bandwidth DASH audio with required headers', async () => {
  const calls = [];
  const adapter = load('bili', { get: async (url, config) => {
    calls.push(url);
    if (url.endsWith('/pagelist')) return { data: { code: 0, data: [{ cid: 99 }] } };
    assert.equal(config.params.cid, 99);
    assert.equal(config.params.bvid, 'BVtest');
    assert.equal(config.params.fnval, 16);
    return { data: { code: 0, data: { dash: { audio: [{ bandwidth: 64000, baseUrl: 'https://low' }, { bandwidth: 192000, base_url: 'https://high' }] } } } };
  } });
  const source = await adapter.getMediaSource({ id: 'BVtest', bvid: 'BVtest' }, 'standard');
  assert.equal(source.url, 'https://high');
  assert.equal(source.headers.Referer, 'https://www.bilibili.com/video/BVtest');
  assert.match(source.headers['User-Agent'], /Mozilla/);
  assert.equal(calls.length, 2);
});

test('bili preserves supplied cid and reports missing audio rather than video fallback', async () => {
  const adapter = load('bili', { get: async (url, config) => {
    assert.match(url, /\/playurl$/);
    assert.equal(config.params.cid, 88);
    return { data: { code: 0, data: { dash: { audio: [] }, durl: [{ url: 'https://video' }] } } };
  } });
  await assert.rejects(adapter.getMediaSource({ id: 'BVtest', cid: 88 }), /audio/i);
});
