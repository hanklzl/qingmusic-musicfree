const test = require('node:test');
const assert = require('node:assert/strict');

function load(name, http, options = { legacy: true }) {
  const factory = require('../adapters/' + name + '.cjs');
  // Generated plugins embed the factory source, without CommonJS scope.
  return (0, eval)('(' + factory.toString() + ')')({ http, he: { decode: s => s.replace(/&amp;/g, '&') }, line: {}, ...options });
}

test('normal QingMusic variant keeps its highest-bandwidth standard audio behavior', async () => {
  const adapter = load('bili', { get: async () => ({ data: { code: 0, data: { dash: { audio: [
    { bandwidth: 64000, baseUrl: 'https://low' }, { bandwidth: 128000, baseUrl: 'https://medium' }, { bandwidth: 192000, baseUrl: 'https://highest' }
  ] } } } }) }, { legacy: false });
  assert.equal((await adapter.getMediaSource({ id: 'BVtest', cid: 88 }, 'standard')).url, 'https://highest');
});

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

test('bili resolves cid and returns standard DASH audio with required headers', async () => {
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

test('bili maps legacy quality names to ascending bandwidth ranks', async () => {
  const adapter = load('bili', { get: async () => ({ data: { code: 0, data: { dash: { audio: [
    { bandwidth: 192000, baseUrl: 'https://third' },
    { bandwidth: 64000, baseUrl: 'https://first' },
    { bandwidth: 256000, base_url: 'https://fourth' },
    { bandwidth: 128000, baseUrl: 'https://second' },
  ] } } } }) });
  const item = { id: 'BVtest', cid: 88 };
  for (const [quality, url] of Object.entries({ low: 'https://first', standard: 'https://second', high: 'https://third', super: 'https://fourth' })) {
    assert.equal((await adapter.getMediaSource(item, quality)).url, url, quality);
  }
});

test('bili clamps legacy quality rank when fewer audio streams exist', async () => {
  const adapter = load('bili', { get: async () => ({ data: { code: 0, data: { dash: { audio: [
    { bandwidth: 64000, baseUrl: 'https://only' },
  ] } } } }) });
  for (const quality of ['low', 'standard', 'high', 'super']) {
    assert.equal((await adapter.getMediaSource({ id: 'BVtest', cid: 88 }, quality)).url, 'https://only');
  }
});

test('bili rejects unknown quality before requesting an upstream stream', async () => {
  let requests = 0;
  const adapter = load('bili', { get: async () => {
    requests++;
    return { data: { code: 0, data: { dash: { audio: [{ baseUrl: 'https://audio', bandwidth: 64000 }] } } } };
  } });
  await assert.rejects(adapter.getMediaSource({ id: 'BVtest', cid: 88 }, 'lossless'), /unsupported.*quality/i);
  assert.equal(requests, 0);
});

test('bili uses aid for legacy numeric item pagelist and avid for playurl', async () => {
  const calls = [];
  const adapter = load('bili', { get: async (url, config) => {
    calls.push(url);
    if (url.endsWith('/pagelist')) {
      assert.equal(config.params.aid, '123');
      assert.equal(config.params.avid, undefined);
      return { data: { code: 0, data: [{ cid: 88 }] } };
    }
    assert.equal(config.params.avid, '123');
    assert.equal(config.params.aid, undefined);
    assert.equal(config.params.cid, 88);
    return { data: { code: 0, data: { dash: { audio: [{ bandwidth: 64000, baseUrl: 'https://legacy' }] } } } };
  } });
  const source = await adapter.getMediaSource({ id: 123, aid: 123 }, 'low');
  assert.equal(source.url, 'https://legacy');
  assert.equal(source.headers.Referer, 'https://www.bilibili.com/video/av123');
  assert.equal(calls.length, 2);
});

test('bili plays persisted aid-only items with supplied cid directly', async () => {
  const adapter = load('bili', { get: async (url, config) => {
    assert.match(url, /\/playurl$/);
    assert.equal(config.params.avid, '123');
    assert.equal(config.params.cid, 88);
    assert.equal(config.params.bvid, undefined);
    return { data: { code: 0, data: { dash: { audio: [{ bandwidth: 64000, baseUrl: 'https://legacy' }] } } } };
  } });
  assert.equal((await adapter.getMediaSource({ id: 123, aid: 123, cid: 88 }, 'standard')).url, 'https://legacy');
});
