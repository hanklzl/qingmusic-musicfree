module.exports = function createAdapter(ctx) {
  const http = ctx.http;
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  const decode = value => ctx.he.decode(String(value || '')).replace(/\r/g, '');
  function artwork(item) {
    const keys = ['Img', 'img', 'Image', 'image', 'AlbumImg', 'AlbumPic', 'ImgUrl', 'imgurl', 'Pic', 'pic', 'album_image', 'img_url'];
    for (const key of keys) {
      const value = item[key];
      if (!value) continue;
      if (/^https?:\/\//.test(value)) return value.replace(/\{size\}/g, '240');
      if (/^\d{8}\//.test(value)) return 'https://imge.kugou.com/stdmusic/240/' + value;
    }
    return '';
  }
  return {
    async search(query, page) {
      const currentPage = Math.max(1, Number(page) || 1);
      const response = await http.get('https://songsearch.kugou.com/song_search_v2', {
        headers, timeout: 15000,
        params: { keyword: query, page: currentPage, pagesize: 30, userid: 0,
          platform: 'WebFilter', filter: 2, iscorrection: 1, privilege_filter: 0, area_code: 1 },
      });
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      if (body.error_code !== 0 || !body.data || !Array.isArray(body.data.lists)) {
        throw new Error('Kugou search failed: ' + body.error_code);
      }
      const seen = new Set();
      const data = [];
      for (const group of body.data.lists) {
        for (const item of [group].concat(group.Grp || [])) {
          if (!item.FileHash) continue;
          const rid = String(item.FileHash).toUpperCase();
          if (seen.has(rid)) continue;
          seen.add(rid);
          data.push({
            id: rid, rid, title: decode(item.SongName || item.OriSongName),
            artist: decode(item.SingerName || (item.Singers || []).map(singer => singer.name || singer.Name).join('、')),
            album: decode(item.AlbumName), artwork: artwork(item), duration: Number(item.Duration) || 0,
            audioId: item.Audioid || item.AudioId || '', albumId: String(item.AlbumID || ''),
          });
        }
      }
      const total = Number(body.data.total);
      return { data, isEnd: Number.isFinite(total) ? currentPage * 30 >= total : body.data.lists.length < 30 };
    },
    async getLyric(item) {
      const response = await http.get('https://m.kugou.com/app/i/krc.php', {
        headers, timeout: 15000,
        params: { cmd: 100, hash: String(item.rid || item.id), timelength: 1 },
      });
      const text = decode(response.data);
      const start = text.search(/\[(?:\d{1,3}:\d{2}|[a-z]+:)/i);
      return { rawLrc: start < 0 ? '' : text.slice(start) };
    },
  };
};
