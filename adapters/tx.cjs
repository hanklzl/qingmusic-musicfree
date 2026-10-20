module.exports = function createAdapter(ctx) {
  const http = ctx.http;
  const headers = { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' };
  const decode = value => ctx.he.decode(String(value || '')).replace(/\r/g, '');
  function json(value) {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    return JSON.parse(text.startsWith('{') ? text : text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, ''));
  }
  return {
    async search(query, page) {
      const currentPage = Math.max(1, Number(page) || 1);
      const response = await http.get('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp', {
        headers, timeout: 15000,
        params: { w: query, p: currentPage, n: 30, format: 'json', new_json: 1 },
      });
      const body = json(response.data);
      if (body.code !== 0 || !body.data || !body.data.song || !Array.isArray(body.data.song.list)) {
        throw new Error('QQ search failed: ' + body.code);
      }
      const song = body.data.song;
      const data = song.list.filter(item => item.songmid || item.mid).map(item => {
        const rid = String(item.songmid || item.mid);
        const albumMid = item.albummid || (item.album && item.album.mid);
        return {
          id: rid, rid, title: decode(item.songname || item.title || item.name),
          artist: (item.singer || []).map(singer => decode(singer.name)).join('、'),
          album: decode(item.albumname || (item.album && item.album.name)),
          artwork: albumMid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + albumMid + '.jpg' : '',
          duration: Number(item.interval) || 0,
          songid: item.songid || item.id,
          albumMid: albumMid || '',
        };
      });
      const total = Number(song.totalnum);
      return { data, isEnd: Number.isFinite(total) ? currentPage * 30 >= total : song.list.length < 30 };
    },
    async getLyric(item) {
      const rid = String(item.rid || item.id);
      const response = await http.get('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        headers, timeout: 15000,
        params: { g_tk: 5381, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8',
          notice: 0, platform: 'h5', needNewCode: 1, ct: 121, cv: 0, nobase64: 1, songmid: rid },
      });
      const body = json(response.data);
      if (body.code !== 0) throw new Error('QQ lyric failed: ' + body.code);
      const result = { rawLrc: decode(body.lyric) };
      if (body.trans) result.translation = decode(body.trans);
      return result;
    },
  };
};
