/**
 * 「轨迹」页生成器
 *
 * 和「归档」的区别：
 *   归档 = 所有文章，按**发布时间**（文章的 date）
 *   轨迹 = 只收录**写了拍摄时间**的文章，按**拍摄时间**（shot 字段）
 *
 * 用法：在文章头部加一行 ——
 *     shot: 2024-08-01
 * 这篇就会出现在轨迹里。没写 shot 的文章不会出现在轨迹（仍会出现在归档）。
 *
 * 页面结构：按年份分组，新的年份在上；同年内新的日期在上。
 */

const { escapeHtml } = require('./lib/photo');

/** 把 front-matter 里的 shot 读成一个「YYYY-MM-DD」字符串 */
function shotOf(post) {
  const raw = post.shot;
  if (raw === undefined || raw === null || raw === '') return '';

  // 取 Date 的「本地」年月日
  //
  // ⚠️ 必须用本地取值，不能用 getUTC*。
  //    js-yaml 把 `shot: 2024-08-01` 解析成的是**本地时间**的午夜，
  //    用 getUTC* 在东八区会退回一天（显示成 07-31）。
  const fromDate = d => {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (raw instanceof Date) return fromDate(raw);

  const s = String(raw).trim();

  // 纯日期写法（2024-08-01 / 2024.8.1 / 2024-08）直接取，绕开所有时区陷阱
  const plain = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (plain) {
    const month = String(plain[2]).padStart(2, '0');
    const day = plain[3] ? String(plain[3]).padStart(2, '0') : '';
    return day ? `${plain[1]}-${month}-${day}` : `${plain[1]}-${month}`;
  }

  // 带时间的写法 —— 也包括 Hexo 缓存(db.json)序列化出来的 ISO 串。
  // 交给 Date 解析后统一走「本地取值」，才能和上面保持一致。
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return fromDate(parsed);

  return '';
}

/** 取文章封面（没有就算了） */
function coverOf(post) {
  const c = post.cover;
  if (!c) return '';
  return String(c).trim();
}

hexo.extend.generator.register('timeline', function (locals) {
  const all = locals.posts && locals.posts.length ? locals.posts.toArray() : [];

  const entries = all
    .map(post => ({ post, shot: shotOf(post) }))
    .filter(item => item.shot)
    .sort((a, b) => (a.shot < b.shot ? 1 : a.shot > b.shot ? -1 : 0)); // 新的在前

  const missing = all.filter(post => !shotOf(post)).length;
  if (missing) {
    hexo.log.info(
      `[timeline] 有 ${missing} 篇文章没写 shot（不会出现在轨迹里，归档里照常有）`
    );
  }

  let body;
  if (!entries.length) {
    body =
      '<p style="font-size:14px;color:#8a8a8a;margin:20px 0">' +
      '还没有带拍摄时间的文章。在文章头部加一行 <code>shot: 2024-08-01</code>，这篇就会出现在这里。' +
      '</p>';
  } else {
    // 按年份分组
    const groups = new Map();
    entries.forEach(item => {
      const year = item.shot.slice(0, 4);
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(item);
    });

    body = Array.from(groups.entries())
      .map(([year, items]) => {
        const rows = items
          .map(({ post, shot }) => {
            const day = shot.length >= 10 ? shot.slice(5) : shot.slice(5) + '-';
            const cover = coverOf(post);
            const thumb = cover
              ? `<img class="no-lightbox" src="${escapeHtml(cover)}" alt="" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:8px;display:block;flex:none;background:#efefe9">`
              : '<div style="width:56px;height:56px;border-radius:8px;background:#efefe9;flex:none"></div>';

            return [
              `<a href="/${post.path}" style="display:flex;gap:14px;align-items:center;text-decoration:none;padding:12px 14px;border-radius:10px;background:#fafaf8">`,
              thumb,
              '<span style="min-width:0">',
              `<span style="display:block;font-size:12px;color:#8a8a8a;letter-spacing:.5px">${day}</span>`,
              `<span style="display:block;font-size:15px;color:#1f2328;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(post.title)}</span>`,
              '</span>',
              '</a>'
            ].join('');
          })
          .join('\n');

        return [
          `<h2 style="font-size:20px;margin:34px 0 14px;padding-left:12px;border-left:4px solid #185fa5;line-height:1.3">${year}</h2>`,
          `<div style="display:flex;flex-direction:column;gap:8px">`,
          rows,
          '</div>'
        ].join('\n');
      })
      .join('\n');
  }

  const header =
    '<p style="font-size:14px;color:#5c6470;margin:0 0 8px">' +
    '按<strong>拍摄时间</strong>排列，不是发布时间。' +
    (entries.length ? `共 ${entries.length} 篇。` : '') +
    '</p>';

  hexo.log.info(`[timeline] 生成轨迹页，收录 ${entries.length} 篇`);

  return [
    {
      path: 'timeline/index.html',
      layout: 'page',
      data: {
        title: '轨迹',
        description: '按拍摄时间排列的照片记录',
        date: new Date(),
        top_img: false,
        aside: false,
        comments: false,
        content: header + body
      }
    }
  ];
});
