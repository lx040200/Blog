/**
 * 相册照片标签外挂
 *
 * 用法（在文章或页面里，一张照片写一行）：
 *
 *   {% photo IMG20260405150924.jpg "外滩 · 入夜" %}
 *   {% photo china/sichuan/a-ba/1772962664015.jpg "阿坝 · 清晨" %}
 *
 * 第一个参数就是 R2 桶里的「对象路径」，要分类就写成 国家/省/市/文件名。
 * 说明文字可省略，省略时用文件名兜底。
 *
 * 具体地址拼装逻辑在 scripts/lib/photo.js，和相册生成器共用。
 * 相册页（/gallery/）是自动生成的，不用手写，见 scripts/album.js。
 */

const { renderPhoto } = require('./lib/photo');

hexo.extend.tag.register('photo', function (args) {
  const path = (args[0] || '').trim();

  if (!path) {
    return '<!-- photo 标签缺少文件名，用法：{% photo china/sichuan/a-ba/文件名.jpg "说明" %} -->';
  }

  const caption = args
    .slice(1)
    .join(' ')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();

  return renderPhoto(hexo, path, caption);
});
