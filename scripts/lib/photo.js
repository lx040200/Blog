/**
 * 照片地址与 HTML 的公共逻辑
 * 被 scripts/photo.js（{% photo %} 标签）和 scripts/album.js（相册生成器）共用。
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizePath(p) {
  return String(p == null ? '' : p).trim().replace(/^\/+/, '');
}

function baseUrl(hexo) {
  return String((hexo && hexo.config && hexo.config.r2_base) || '').replace(/\/+$/, '');
}

/**
 * 图片来源模式，由 _config.yml 里的 image_mode 控制：
 *   'direct'          —— 直接用原图。（当前使用：照片本身不大，不需要缩略图）
 *   'transformations' —— 用 Cloudflare 实时生成缩略图（需开启 Images → Transformations）
 * 不设置时默认 'transformations'。
 */
function imageMode(hexo) {
  const raw = String((hexo && hexo.config && hexo.config.image_mode) || '').trim().toLowerCase();
  return raw === 'direct' ? 'direct' : 'transformations';
}

/** 由 R2 路径推出「原图 / 缩略图 / 大图 / 横幅图」四个地址 */
function urls(hexo, photoPath) {
  const base = baseUrl(hexo);
  const p = normalizePath(photoPath);
  const original = `${base}/${p}`;

  if (imageMode(hexo) === 'direct') {
    return { original, thumb: original, view: original, banner: original };
  }

  const sized = (width, quality) =>
    `${base}/cdn-cgi/image/width=${width},quality=${quality},format=auto,onerror=redirect/${p}`;

  return {
    original,
    thumb: sized(800, 80),
    view: sized(1600, 85),
    banner: sized(1800, 80)
  };
}

/**
 * 单张照片的 HTML：缩略图 + 点击看大图 + 图注（说明 / 原图 / 出处）
 *
 * @param {object} hexo
 * @param {string} photoPath  R2 里的对象路径
 * @param {string} caption    说明文字；为空则图注里不显示说明
 * @param {object} [source]   可选出处 { title, url }，会显示「出自《标题》→」
 * @param {object} [opts]     { showOriginal: false } 可以不挂下面的「原图」链接
 *                            { showSource: false }   可以不挂「出自《…》→」
 *                            （相册页两个都不要 —— 图片下面保持干净，点图片就能看大图）
 */
function renderPhoto(hexo, photoPath, caption, source, opts) {
  const p = normalizePath(photoPath);
  if (!p) return '';

  const base = baseUrl(hexo);
  if (!base) return '<!-- 还没在 _config.yml 里设置 r2_base，无法生成照片地址 -->';

  const u = urls(hexo, p);

  // 没写说明时用【文件名】兜底，不要用整条路径 ——
  // 点开大图的灯箱标题里出现 "china/tianjin/Z30_0534.JPG" 很难看，
  // 只显示 "Z30_0534.JPG" 就够了。img 的 alt 也一并用它（无障碍友好）。
  const basename = p.split('/').filter(Boolean).pop() || p;
  const alt = escapeHtml(caption || basename);

  const showOriginal = !(opts && opts.showOriginal === false);
  const showSource = !(opts && opts.showSource === false);

  const captionHtml = caption ? `<span>${escapeHtml(caption)}</span>` : '';
  const originHtml = showOriginal
    ? `<a href="${u.original}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">原图</a>`
    : '';
  const noteLine = [captionHtml, originHtml].filter(Boolean).join(' · ');

  const sourceHtml =
    showSource && source && source.url && source.title
      ? `\n<div style="font-size:12px;text-align:center;margin-top:4px">` +
        `<a href="${source.url}" style="color:#185fa5;text-decoration:none">出自《${escapeHtml(source.title)}》 →</a></div>`
      : '';

  return [
    '<figure style="margin:0">',
    `<a href="${u.view}" data-fancybox="album" data-caption="${alt}">`,
    `<img src="${u.thumb}" alt="${alt}" loading="lazy" class="no-lightbox" style="width:100%;border-radius:8px;display:block">`,
    '</a>',
    noteLine
      ? `<figcaption style="font-size:12px;color:#8a8a8a;text-align:center;margin-top:6px">${noteLine}</figcaption>`
      : '',
    sourceHtml,
    '</figure>'
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = { escapeHtml, normalizePath, baseUrl, urls, renderPhoto };
