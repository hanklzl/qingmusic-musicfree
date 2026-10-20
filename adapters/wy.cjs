module.exports = function createAdapter(ctx) {
  const headers = { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' };
  const pageSize = 30;
  async function request(path, params) {
    const response = await ctx.http.get('https://music.163.com' + path, { params, headers });
    const body = response.data;
    if (!body || body.code !== 200) throw new Error('NetEase API error: ' + (body && body.code));
    return body;
  }
  function mapSong(song) {
    const album = song.album || song.al || {};
    return {
      id: String(song.id), rid: String(song.id), title: song.name || '',
      artist: (song.artists || song.ar || []).map(artist => artist.name).filter(Boolean).join('、'),
      album: album.name || '', artwork: album.picUrl || '',
      duration: Number(song.duration || song.dt || 0) / 1000,
    };
  }
  return {
    async search(query, page) {
      page = Math.max(1, Number(page) || 1);
      const body = await request('/api/search/get', { s: query, type: 1, offset: (page - 1) * pageSize, limit: pageSize });
      const result = body.result || {};
      const songs = result.songs || [];
      return { data: songs.map(mapSong), isEnd: songs.length === 0 || (Number.isFinite(Number(result.songCount))
        ? page * pageSize >= Number(result.songCount) : result.hasMore !== true) };
    },
    async getLyric(item) {
      const body = await request('/api/song/lyric', { id: String(item.rid || item.id), lv: -1, kv: -1, tv: -1 });
      return { rawLrc: body.lrc && body.lrc.lyric || '' };
    },
    async getMusicInfo(item) {
      const id = String(item.rid || item.id);
      if (!/^\d+$/.test(id)) throw new Error('Invalid NetEase song id');
      const body = await request('/api/song/detail', { ids: '[' + id + ']' });
      const song = body.songs && body.songs[0];
      if (!song) throw new Error('NetEase song detail unavailable');
      return Object.assign({}, item, mapSong(song));
    },
  };
};
