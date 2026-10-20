module.exports = function createAdapter(ctx) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kuwo.cn/' };
  const decode = value => ctx.he.decode(String(value || ''));
  function parse(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) {
      // The public web_2013 API also serves JSON with single quoted strings.
      // Convert string tokens only; never execute the response as JavaScript.
      return JSON.parse(value.replace(/'((?:\\.|[^'\\])*)'/g, (_, token) => {
        const jsonToken = token.replace(/\\'/g, "'").replace(/"/g, '\\"');
        return '"' + jsonToken + '"';
      }));
    }
  }
  function artwork(song) {
    if (song.web_albumpic_short) return 'https://img4.kuwo.cn/star/albumcover/' + song.web_albumpic_short;
    if (song.web_artistpic_short) return 'https://img4.kuwo.cn/star/starheads/' + song.web_artistpic_short;
    return song.pic || song.PICPATH || '';
  }
  return {
    async search(query, page = 1) {
      const pageNumber = Math.max(1, Number(page) || 1);
      const response = await ctx.http.get('https://search.kuwo.cn/r.s', {
        headers, timeout: 15000,
        params: { client: 'web_2013', all: query, pn: pageNumber - 1, rn: 30, ft: 'music', rformat: 'json', encoding: 'utf8' }
      });
      const body = parse(response.data);
      if (!body || !Array.isArray(body.abslist)) throw new Error('Kuwo search: invalid response');
      if (String(body.SHOW) === '0' && Number(body.TOTAL) > 0) throw new Error('Kuwo search: upstream rejected search');
      const data = body.abslist.filter(song => song.MUSICRID || song.rid).map(song => {
        const rid = String(song.MUSICRID || song.rid).replace(/^MUSIC_/, '');
        return { id: rid, rid, title: decode(song.SONGNAME || song.NAME), artist: decode(song.ARTIST), album: decode(song.ALBUM), duration: Number(song.DURATION) || 0, artwork: artwork(song) };
      });
      const total = Number(body.TOTAL);
      return { data, isEnd: Number.isFinite(total) ? pageNumber * 30 >= total : body.abslist.length < 30 };
    },
    async getLyric(item) {
      const response = await ctx.http.get('https://wapi.kuwo.cn/openapi/v1/www/lyric/getlyric', {
        headers, timeout: 15000, params: { musicId: String(item.rid || item.id), httpsStatus: 1 }
      });
      const body = parse(response.data);
      if (!body || !body.data || !Array.isArray(body.data.lrclist)) throw new Error('Kuwo lyric: invalid response');
      const rawLrc = body.data.lrclist.map(line => {
        const centiseconds = Math.max(0, Math.round(Number(line.time) * 100) || 0);
        const minutes = String(Math.floor(centiseconds / 6000)).padStart(2, '0');
        const seconds = String(Math.floor(centiseconds / 100) % 60).padStart(2, '0');
        const fraction = String(centiseconds % 100).padStart(2, '0');
        return '[' + minutes + ':' + seconds + '.' + fraction + ']' + decode(line.lineLyric);
      }).join('\n');
      return { rawLrc };
    }
  };
};
