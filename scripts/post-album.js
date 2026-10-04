/**
 * 文章尾部的「相册入口」卡片
 *
 * 自动往文章末尾插一张（或多张）卡片，形如：
 *   📷 这篇的照片都在「中国 · 四川·阿坝」相册里 →
 *
 * 地点是从文章里 {% photo %} 的路径**自动推出来**的，不需要你另外写字段。
 * 一篇文章用到多个地点的照片，就会出现多张卡片。
 *
 * 正文里一张 {% photo %} 都没有的文章，不会插入任何东西。
 */

const { escapeHtml } = require('./lib/photo');
const { parsePhotoTags, displayName, findByFilename } = require('./lib/albumData');

hexo.extend.filter.register('after_post_render', function (data) {
  if (!data || !data.raw) return data;
  // 只处理文章，不动普通页面
  if (data.layout === 'page') return data;

  const tags = parsePhotoTags(data.raw);
  if (!tags.length) return data;

  // 收集这篇文章用到的相册目录（去重，保持出现顺序）
  const dirs = [];
  tags.forEach(tag => {
    let p = tag.path;
    if (p && !p.includes('/')) {
      const found = findByFilename(p);
      if (found) p = found;
    }
    const segs = String(p).replace(/^\/+/, '').split('/').filter(Boolean);
    segs.pop(); // 去掉文件名
    const dir = segs.join('/');
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  });

  if (!dirs.length) return data;

  const cards = dirs
    .map(dir => {
      const label = escapeHtml(dir.split('/').map(seg => displayName(seg)).join(' · '));
      return [
        `<a href="/gallery/${dir}/" style="display:block;padding:14px 18px;border:1px solid #d6e4f5;`,
        'background:#f3f8fe;border-radius:10px;text-decoration:none;color:#0c447c;font-size:14px;margin:10px 0">',
        `📷 这篇的照片都在「${label}」相册里 →`,
        '</a>'
      ].join('');
    })
    .join('\n');

  data.content +=
    `\n<div style="margin:34px 0 0;padding-top:20px;border-top:1px solid #e8e8e4">\n${cards}\n</div>`;

  return data;
});
