const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { compilePlugins } = require('../lib/converter.cjs');
const { createPlugin } = require('../lib/runtime.cjs');
const definitions = {
  wy: ['wySearchMusic', 'wyMusicDetail', '元力WY', ['id']],
  kw: ['fetchSearchMusic', 'fetchMusicDetail', '元力KW', ['id']],
  kg: ['kgSearchMusic', 'kgMusicDetail', '元力KG', ['id', 'album_id', 'album_audio_id']],
  tx: ['txSearchMusic', 'txMusicDetail', '元力QQ', ['id', 'songmid']],
  bili: ['biliSearchMusic', 'biliMusicDetail', 'bilibili', ['id', 'aid', 'bvid', 'cid']],
  mg: ['mgSearchMusic', 'mgMusicDetail', '元力MG', ['id', 'copyrightId']]
};
const line = id => ({ id, name: id, enabled: true, searchApi: definitions[id][0], detailApi: definitions[id][1], levels: ['standard', 'exhigh', 'lossless'] });
test('legacy output exactly matches six old platform identities and primary keys', async () => {
  const lines = Object.keys(definitions).map(line);
  const factory = () => ({ search: async () => ({ data: [{ id: 'mid', rid: 'mid', songid: 4835784 }], isEnd: true }) });
  const result = compilePlugins({ lines }, { legacy: true, baseUrl: 'https://example.org/', adapters: Object.fromEntries(lines.map(l => [l.id, factory])) });
  assert.deepEqual(result.manifest.plugins.map(p => p.name), Object.values(definitions).map(d => d[2]));
  for (const [id, definition] of Object.entries(definitions)) {
    const box = { module: { exports: {} }, require: () => ({}), console };
    vm.runInNewContext(result.scripts['yuanli-' + id + '.js'], box);
    const plugin = box.module.exports;
    assert.deepEqual(Array.from(plugin.primaryKey), definition[3]);
    assert.equal(plugin.platform, definition[2]);
    assert.match(plugin.srcUrl, new RegExp('/yuanli-' + id + '\\.js$'));
    assert.ok(plugin.version.split('.').map(Number)[1] >= 2);
  }
});
test('legacy QQ search retains numeric song identity and songmid for future playlists', async () => {
  const plugin = createPlugin({ line: line('tx'), legacy: true, platform: '元力QQ' }, () => ({
    search: async () => ({ data: [{ id: '001mid', rid: '001mid', songid: 4835784 }], isEnd: true })
  }), {});
  const item = (await plugin.search('歌', 1, 'music')).data[0];
  assert.equal(item.id, '4835784');
  assert.equal(item.songmid, '001mid');
  assert.equal(item.rid, '001mid');
});
test('old QQ playlist uses songmid for playback and lyrics without mutating stored data', async () => {
  const old = Object.freeze({ id: 4835784, songmid: '001yS0N33yPm1B', platform: '元力QQ' });
  let request;
  const plugin = createPlugin({ line: line('tx'), legacy: true, platform: '元力QQ', gatewayUrl: 'https://example.org/resolve' }, () => ({
    getLyric: async item => ({ rawLrc: item.rid }), search: async () => ({ data: [], isEnd: true })
  }), { http: { post: async (...args) => { request = args[1]; return { data: { code: 0, data: { url: 'https://audio.example/a.mp3' } } }; } } });
  await plugin.getMediaSource(old, 'standard');
  assert.equal(request.rid, old.songmid);
  assert.equal((await plugin.getLyric(old)).rawLrc, old.songmid);
  assert.equal(old.rid, undefined);
});
test('old WY KW KG MG identifiers pass through without name-based song matching', async () => {
  const items = { wy: { id: 1357375695 }, kw: { id: '5886682' }, kg: { id: 'C41E80A18D1448FA47086372999C7F43', album_id: '973001', album_audio_id: 0 }, mg: { id: '1135162566', copyrightId: '6005752DXKE' } };
  for (const [id, item] of Object.entries(items)) {
    let body;
    const plugin = createPlugin({ line: line(id), legacy: true, platform: definitions[id][2] }, () => ({}), {
      http: { post: async (_, data) => { body = data; return { data: { code: 0, data: { url: 'https://audio.example/a.mp3' } } }; } }
    });
    await plugin.getMediaSource(Object.freeze(item), 'standard');
    assert.equal(body.rid, String(item.id));
  }
});
test('legacy KG new searches retain album identity field names', async () => {
  const plugin = createPlugin({ line: line('kg'), legacy: true, platform: '元力KG' }, () => ({
    search: async () => ({ data: [{ id: 'HASH', rid: 'HASH', albumId: '973001', album_audio_id: 7 }], isEnd: true })
  }), {});
  const item = (await plugin.search('歌', 1, 'music')).data[0];
  assert.equal(item.album_id, '973001');
  assert.equal(item.album_audio_id, 7);
});
test('legacy bili permits saved quality settings, normal version keeps standard-only contract', async () => {
  const factory = () => ({ getMediaSource: async (_, q) => ({ url: 'https://audio.example/' + q }) });
  const options = { line: line('bili'), platform: 'bilibili', legacy: true };
  assert.equal((await createPlugin(options, factory, {}).getMediaSource({ id: 'BV1' }, 'super')).url, 'https://audio.example/super');
  assert.equal(await createPlugin({ ...options, legacy: false }, factory, {}).getMediaSource({ id: 'BV1' }, 'super'), null);
});
