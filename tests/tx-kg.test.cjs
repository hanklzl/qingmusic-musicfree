const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function adapter(source, responses, calls) {
  const factory = require('../adapters/' + source + '.cjs');
  // The converter embeds the factory source into a plugin, without CommonJS globals.
  const create = vm.runInNewContext('(' + String(factory) + ')');
  return create({
    http: { get: async (url, config) => {
      calls.push({ url, config });
      return { data: responses.shift() };
    } },
    he: { decode: value => String(value).replace(/&amp;/g, '&') },
    line: {},
  });
}

test('QQ uses songmid, decodes names and keeps one-based pagination', async () => {
  const calls = [];
  const api = adapter('tx', [{ code: 0, data: { song: { totalnum: 31, list: [
    { songid: 123, songmid: '001yS0N33yPm1B', songname: 'A &amp; B',
      singer: [{ name: 'Singer' }], albumname: 'Album', albummid: 'album-mid', interval: 324 },
  ] } } }], calls);
  const result = await api.search('海阔天空', 1);
  assert.equal(result.data[0].id, '001yS0N33yPm1B');
  assert.equal(result.data[0].rid, '001yS0N33yPm1B');
  assert.equal(result.data[0].title, 'A & B');
  assert.equal(result.data[0].artist, 'Singer');
  assert.equal(result.data[0].duration, 324);
  assert.equal(calls[0].config.params.p, 1);
  assert.equal(result.isEnd, false);
});

test('QQ lyric returns decoded MusicFree text and optional translation', async () => {
  const calls = [];
  const api = adapter('tx', [{ code: 0, lyric: '[00:01]A &amp; B\r\n', trans: '[00:01]译文' }], calls);
  const result = await api.getLyric({ rid: 'song-mid' });
  assert.equal(result.rawLrc, '[00:01]A & B\n');
  assert.equal(result.translation, '[00:01]译文');
  assert.equal(calls[0].config.params.songmid, 'song-mid');
});

test('Kugou flattens groups, deduplicates hashes and preserves search metadata', async () => {
  const song = { FileHash: 'c41e80a18d1448fa47086372999c7f43', SongName: '海阔天空',
    SingerName: 'BEYOND', AlbumName: '乐与怒', Duration: 324, Audioid: 3261014,
    Img: 'https://imge.kugou.com/{size}/cover.jpg' };
  const calls = [];
  const api = adapter('kg', [{ error_code: 0, data: { total: 1, lists: [
    { ...song, Grp: [song, { ...song, FileHash: 'OTHER' }] },
  ] } }], calls);
  const result = await api.search('海阔天空', 1);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].rid, song.FileHash.toUpperCase());
  assert.equal(result.data[0].artist, 'BEYOND');
  assert.equal(result.data[0].duration, 324);
  assert.equal(result.data[0].artwork, 'https://imge.kugou.com/240/cover.jpg');
  assert.equal(result.isEnd, true);
  assert.equal(calls[0].config.params.page, 1);
});

test('Kugou legacy lyric strips the response prefix and keeps LRC metadata', async () => {
  const api = adapter('kg', ['header\n[ti:海阔天空]\n[00:01.00]歌词\r\n'], []);
  assert.equal((await api.getLyric({ id: 'HASH' })).rawLrc, '[ti:海阔天空]\n[00:01.00]歌词\n');
});

test('QQ accepts the official JSONP wrapper and an empty final page', async () => {
  const calls = [];
  const api = adapter('tx', ['callback({"code":0,"data":{"song":{"list":[],"totalnum":30}}});'], calls);
  const result = await api.search('query', 2);
  assert.equal(result.data.length, 0);
  assert.equal(result.isEnd, true);
  assert.equal(calls[0].config.params.p, 2);
});

test('Kugou reports empty final pages and absent lyrics without fabricating text', async () => {
  const calls = [];
  const api = adapter('kg', [{ error_code: 0, data: { lists: [], total: 0 } }, '<html>not found</html>'], calls);
  const result = await api.search('query', 2);
  assert.equal(result.isEnd, true);
  assert.equal(result.data.length, 0);
  assert.equal(calls[0].config.params.page, 2);
  assert.equal((await api.getLyric({ rid: 'HASH' })).rawLrc, '');
});

for (const source of ['tx', 'kg']) {
  test(source + ' rejects service errors instead of silently ending search', async () => {
    const api = adapter(source, [{ code: 2001, error_code: 500, data: {} }], []);
    await assert.rejects(api.search('query', 1));
  });
}
