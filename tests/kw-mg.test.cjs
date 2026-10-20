const test = require('node:test');
const assert = require('node:assert/strict');

function load(name, http) {
  const factory = require(`../adapters/${name}.cjs`);
  // The converter embeds factories by source; no module scope may be needed.
  return Function(`return (${factory.toString()})`)()({ http, he: { decode: text => text.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ') } });
}

test('kw maps public search fields, decodes entities, and converts one-based pages', async () => {
  const adapter = load('kw', { get: async (url, options) => {
    assert.equal(url, 'https://search.kuwo.cn/r.s');
    assert.equal(options.params.pn, 1);
    assert.equal(options.params.client, 'web_2013');
    return { data: { TOTAL: '31', abslist: [{ MUSICRID: 'MUSIC_123', SONGNAME: 'Song&nbsp;A', ARTIST: 'A&amp;B', ALBUM: 'Album', DURATION: '245', web_albumpic_short: '120/a.jpg' }] } };
  } });
  const result = await adapter.search('Song', 2);
  assert.deepEqual(result.data[0], { id: '123', rid: '123', title: 'Song A', artist: 'A&B', album: 'Album', duration: 245, artwork: 'https://img4.kuwo.cn/star/albumcover/120/a.jpg' });
  assert.equal(result.isEnd, true);
});

test('kw accepts single quoted JSON without eval and preserves escaped apostrophes', async () => {
  const adapter = load('kw', { get: async () => ({ data: "{'TOTAL':'1','abslist':[{'MUSICRID':'MUSIC_1','SONGNAME':'Don\\'t','DURATION':'1'}]}" }) });
  assert.equal((await adapter.search('x', 1)).data[0].title, "Don't");
});

test('kw converts lyric seconds to timestamped rawLrc', async () => {
  const adapter = load('kw', { get: async (_, options) => {
    assert.equal(options.params.musicId, '123');
    return { data: { data: { lrclist: [{ time: '61.25', lineLyric: 'A&amp;B' }] } } };
  } });
  assert.deepEqual(await adapter.getLyric({ rid: '123' }), { rawLrc: '[01:01.25]A&B' });
});

test('mg preserves song id for resolver and copyright/content ids separately', async () => {
  const adapter = load('mg', { get: async (url, options) => {
    assert.equal(url, 'https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do');
    assert.equal(options.params.pageNo, 2);
    return { data: { code: '000000', songResultData: { totalCount: '31', result: [{ id: '1135162566', contentId: '600913000009337537', copyrightId: '6005752DXKE', name: '海阔天空', singers: [{ name: 'Beyond' }], albums: [{ name: 'Album' }], duration: '05:01', imgItems: [{ img: 'https://example.test/cover.webp' }], lyricUrl: 'https://example.test/song.lrc' }] } } };
  } });
  const result = await adapter.search('海阔天空', 2);
  assert.deepEqual(result.data[0], { id: '1135162566', rid: '1135162566', contentId: '600913000009337537', copyrightId: '6005752DXKE', title: '海阔天空', artist: 'Beyond', album: 'Album', duration: 301, artwork: 'https://example.test/cover.webp', lyricUrl: 'https://example.test/song.lrc' });
  assert.equal(result.isEnd, true);
});

test('mg fetches public lyric URL and normalizes carriage returns', async () => {
  const adapter = load('mg', { get: async url => {
    assert.equal(url, 'https://example.test/song.lrc');
    return { data: '[00:01.00]hello\r\n' };
  } });
  assert.deepEqual(await adapter.getLyric({ lyricUrl: 'https://example.test/song.lrc' }), { rawLrc: '[00:01.00]hello\n' });
});

test('mg uses the public endpoint page size of 20 for pagination', async () => {
  const adapter = load('mg', { get: async (_, options) => {
    assert.equal(options.params.pageSize, 20);
    return { data: { code: '000000', songResultData: { totalCount: '21', result: [] } } };
  } });
  assert.equal((await adapter.search('x', 1)).isEnd, false);
});

test('mg keeps long numeric durations in seconds and leaves undocumented units unknown', async () => {
  const songs = [
    { id: '1', duration: 3927 },
    { id: '2', duration: '3927' },
    { id: '3', duration: '65:27' },
    { id: '4', length: 3927 },
    { id: '5' },
    { id: '6', timeLength: 3927000 }
  ];
  const adapter = load('mg', { get: async () => ({ data: { code: '000000', songResultData: { totalCount: '6', result: songs } } }) });
  assert.deepEqual((await adapter.search('x', 1)).data.map(song => song.duration), [3927, 3927, 3927, 3927, 0, 0]);
});

for (const source of ['kw', 'mg']) {
  test(`${source} keeps another page available when total exceeds page size`, async () => {
    const body = source === 'kw' ? { TOTAL: '31', abslist: [] } : { code: '000000', songResultData: { totalCount: '31', result: [] } };
    const adapter = load(source, { get: async () => ({ data: body }) });
    assert.equal((await adapter.search('x', 1)).isEnd, false);
  });
  test(`${source} recognizes a successful empty catalog result`, async () => {
    const body = source === 'kw' ? { TOTAL: '0', SHOW: '0', abslist: [] } : { code: '000000', songResultData: { totalCount: '0', result: [] } };
    const adapter = load(source, { get: async () => ({ data: body }) });
    assert.deepEqual(await adapter.search('x', 1), { data: [], isEnd: true });
  });
  test(`${source} propagates transport failures`, async () => {
    const adapter = load(source, { get: async () => { throw new Error('transport offline'); } });
    await assert.rejects(adapter.search('x', 1), /transport offline/);
  });
  test(`${source} rejects malformed response instead of reporting an empty page`, async () => {
    const adapter = load(source, { get: async () => ({ data: '<html>blocked</html>' }) });
    await assert.rejects(adapter.search('x', 1));
  });
}
