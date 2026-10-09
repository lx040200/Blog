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
// shot 的解析放在 lib 里 —— 相册「按拍摄月份分组」要用同一套逻辑，
// 两份实现迟早会漂移（比如时区处理改了一边忘了另一边）
const { shotOf } = require('./lib/albumData');

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
        // 每个月只在第一条上加锚点 id —— 相册页那句「这趟写了 N 篇」要跳到这里
        const seenMonths = new Set();

        const rows = items
          .map(({ post, shot }) => {
            const day = shot.length >= 10 ? shot.slice(5) : shot.slice(5) + '-';
            const cover = coverOf(post);
            // ⚠️ 缩略图必须显式写 margin:0
            // 主题给文章里的 <img> 设了 `margin: 0 auto 20px`（本意是让单张插图居中）。
            // 但在这种「图 + 文字」的 flex 并排布局里，auto 外边距会把图片推到行中间、
            // 文字被挤到最右边，整行看着就是散的。内联 margin:0 优先级高于主题 CSS，能把它按回左边。
            // （相册的 renderPhoto 里踩过同一个坑，用的是同一招）
            const thumb = cover
              ? `<img class="no-lightbox" src="${escapeHtml(cover)}" alt="" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:8px;display:block;flex:none;margin:0;background:#efefe9">`
              : '<div style="width:56px;height:56px;border-radius:8px;background:#efefe9;flex:none;margin:0"></div>';

            const month = shot.slice(0, 7);
            const anchor = seenMonths.has(month) ? '' : ` id="y${month}"`;
            seenMonths.add(month);

            return [
              `<a${anchor} href="/${post.path}" style="display:flex;gap:14px;align-items:center;text-decoration:none;padding:12px 14px;border-radius:10px;background:#fafaf8">`,
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
