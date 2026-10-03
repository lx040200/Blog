/**
 * 相册照片标签外挂
 *
 * 用法（在 source/gallery/index.md 或任何文章里，一张照片写一行）：
 *
 *   {% photo IMG20260405150924.jpg "外滩 · 入夜" %}
 *   {% photo china/shanghai/IMG20260405150924.jpg "外滩 · 入夜" %}
 *
 * 第一个参数就是 R2 桶里的「对象路径」，要分类就写成 国家/城市/文件名。
 * 说明文字可省略，省略时用文件名兜底。
 *
 * 它会根据 _config.yml 里的 r2_base 自动拼出三个地址：
 *   缩略图  宽 800   ← 相册网格显示
 *   看大图  宽 1600  ← 点开后在 Fancybox 里显示
 *   原图    直取原始文件，点「原图」在新标签页打开
 *
 * 注意：缩略图和大图都不是事先压好的文件，而是 Cloudflare 的 Image
 * Transformations 现场生成的（/cdn-cgi/image/...），所以 R2 里只要存一份原图。
 * 参数里的 onerror=redirect 是保险：万一免费额度用超、变换失败，
 * 会自动退回显示原图，页面不会出现裂图。
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

hexo.extend.tag.register('photo', function (args) {
  // 去掉路径开头的斜杠，避免拼出双斜杠
  const path = (args[0] || '').trim().replace(/^\/+/, '');

  if (!path) {
    return '<!-- photo 标签缺少文件名，用法：{% photo china/shanghai/文件名.jpg "说明" %} -->';
  }

  const caption = args
    .slice(1)
    .join(' ')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim();

  const base = String(hexo.config.r2_base || '').replace(/\/+$/, '');

  if (!base) {
    return `<!-- 还没有在 _config.yml 里设置 r2_base，无法生成照片地址：${escapeHtml(path)} -->`;
  }

  const original = `${base}/${path}`;
  const resized = (width, quality) =>
    `${base}/cdn-cgi/image/width=${width},quality=${quality},format=auto,onerror=redirect/${path}`;

  const thumb = resized(800, 80);
  const view = resized(1600, 85);
  const alt = escapeHtml(caption || path);

  return [
    '<figure style="margin:0">',
    `<a href="${view}" data-fancybox="album" data-caption="${alt}">`,
    `<img src="${thumb}" alt="${alt}" loading="lazy" class="no-lightbox" style="width:100%;border-radius:8px;display:block">`,
    '</a>',
    '<figcaption style="font-size:12px;color:#8a8a8a;text-align:center;margin-top:6px">',
    `<span>${alt}</span>`,
    ` · <a href="${original}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">原图</a>`,
    '</figcaption>',
    '</figure>'
  ].join('\n');
});
