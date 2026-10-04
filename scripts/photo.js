/**
 * 相册照片标签外挂 —— 文章里插图用
 *
 * 用法（一张照片写一行）：
 *
 *   {% photo 文件名.jpg "说明" %}
 *   {% photo china/sichuan-aba/文件名.jpg "说明" %}
 *
 * 两种写法都行：
 *   · 只写文件名   —— 脚本去扫描索引里查它在哪个目录（推荐，省得记路径）
 *   · 写完整路径   —— 不在这张索引里时用这种
 *
 * 说明文字可省略。
 *
 * ⚠️ 文章里用 {% photo %} 插的照片会**自动并入相册**，
 *    并在相册里标出「出自《文章标题》」。逻辑见 scripts/album.js。
 *    文章尾部还会自动出现相册入口卡片，见 scripts/post-album.js。
 */

const { renderPhoto } = require('./lib/photo');
const { findByFilename } = require('./lib/albumData');

hexo.extend.tag.register('photo', function (args) {
  let path = (args[0] || '').trim();

  if (!path) {
    return '<!-- photo 标签缺少文件名。用法：{% photo 文件名.jpg "说明" %} -->';
  }

  // 只写文件名时，去 R2 扫描索引里查它的完整路径
  // （需要先跑过 node tools/sync.js，生成了 source/_data/photo-index.json）
  if (!path.includes('/')) {
    const found = findByFilename(path);
    if (found) path = found;
  }

  const caption = args
    .slice(1)
    .join(' ')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();

  return renderPhoto(hexo, path, caption);
});
