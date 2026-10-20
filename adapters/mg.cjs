module.exports = function createAdapter(ctx) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.migu.cn/' };
  function parse(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
  function duration(value) {
    if (typeof value === 'string' && value.includes(':')) return value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    return Number(value) || 0;
  }
  return {
    async search(query, page = 1) {
      const pageNumber = Math.max(1, Number(page) || 1);
      // Public app catalog endpoint; no gateway credentials or signature needed.
      const response = await ctx.http.get('https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do', {
        headers, timeout: 15000,
        params: { ua: 'Android_migu', version: '5.0.1', text: query, pageNo: pageNumber, pageSize: 20, searchSwitch: JSON.stringify({ song: 1 }) }
      });
      const body = parse(response.data);
      if (!body || String(body.code) !== '000000') throw new Error('Migu search: ' + (body && body.info || 'invalid response'));
      const result = body.songResultData;
      if (!result || !Array.isArray(result.result)) throw new Error('Migu search: invalid song result');
      const seen = new Set();
      const data = result.result.filter(song => {
        const rid = song.songId || song.id;
        if (!rid || seen.has(String(rid))) return false;
        seen.add(String(rid));
        return true;
      }).map(song => {
        const rid = String(song.songId || song.id);
        return {
          id: rid, rid, contentId: String(song.contentId || ''), copyrightId: String(song.copyrightId || ''),
          title: song.name || song.songName || '',
          artist: (song.singers || song.singerList || []).map(singer => typeof singer === 'string' ? singer : singer.name || singer.singerName || '').filter(Boolean).join('、'),
          album: song.album || (song.albums && song.albums[0] && song.albums[0].name) || '',
          // duration / length are seconds; timeLength has no verified unit in this endpoint.
          duration: duration(song.duration || song.length),
          artwork: song.imgItems && song.imgItems.length ? song.imgItems[song.imgItems.length - 1].img : song.img3 || song.img2 || song.img1 || '',
          lyricUrl: song.lyricUrl || song.lrcUrl || ''
        };
      });
      const total = Number(result.totalCount);
      return { data, isEnd: Number.isFinite(total) ? pageNumber * 20 >= total : result.result.length < 20 };
    },
    async getLyric(item) {
      let lyricUrl = item.lyricUrl;
      if (!lyricUrl) {
        const lookupId = item.contentId || item.rid || item.id;
        if (!lookupId) throw new Error('Migu lyric: missing song ID');
        const response = await ctx.http.get('https://c.musicapp.migu.cn/MIGUM3.0/resource/song/by-contentids/v2.0', {
          // Despite the parameter name, this public endpoint also accepts songId.
          headers, timeout: 15000, params: { contentId: String(lookupId) }
        });
        const body = parse(response.data);
        if (!body || String(body.code) !== '000000' || !Array.isArray(body.data)) throw new Error('Migu lyric: invalid song response');
        const song = body.data.find(candidate =>
          (candidate.songId && String(candidate.songId) === String(item.rid || item.id)) ||
          (item.contentId && String(candidate.contentId) === String(item.contentId)) ||
          (item.copyrightId && String(candidate.copyrightId) === String(item.copyrightId))
        );
        if (!song) throw new Error('Migu lyric: song identity did not match');
        lyricUrl = song.lrcUrl || song.lyricUrl;
      }
      if (!lyricUrl) throw new Error('Migu lyric: lyric URL unavailable');
      const response = await ctx.http.get(lyricUrl, { headers, timeout: 15000, responseType: 'text' });
      if (typeof response.data !== 'string' || !response.data.trim() || /^\s*</.test(response.data)) throw new Error('Migu lyric: invalid lyric response');
      return { rawLrc: response.data.replace(/\r/g, '') };
    }
  };
};
