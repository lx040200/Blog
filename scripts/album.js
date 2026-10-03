/**
 * 相册页面自动生成器
 *
 * 数据来源：source/_data/albums.yml
 *   photos: 一行一张照片，写法 「R2 里的路径 | 说明」
 *   names:  目录名 → 显示的中文名
 *
 * 生成规则（层级完全由照片路径里的斜杠数量决定，不需要你声明）：
 *   某层还有子目录  → 生成「选下一级」的封面卡片
 *   某层没有子目录  → 生成照片墙
 *   两者都有        → 先卡片后照片墙
 *
 * 举例：登记了 china/sichuan/a-ba/1772962664015.jpg，就会生成
 *   /gallery/                        中国
 *   /gallery/china/                  四川
 *   /gallery/china/sichuan/          阿坝（封面自动取该目录下第一张照片）
 *   /gallery/china/sichuan/a-ba/     照片墙
 */

const { escapeHtml, baseUrl, urls, renderPhoto } = require('./lib/photo');

const GALLERY_DIR = 'gallery';
const CARD_MIN_WIDTH = 190;
const GRID_MIN_WIDTH = 200;

/** 把 yml 里的 photos 归一化成 [{path, caption}]，兼容字符串和对象两种写法 */
function normalizePhotos(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => {
      if (typeof item === 'string') {
        const s = item.trim();
        if (!s) return null;
        const i = s.indexOf('|');
        return i === -1
          ? { path: s, caption: '' }
          : { path: s.slice(0, i).trim(), caption: s.slice(i + 1).trim() };
      }
      if (item && typeof item === 'object') {
        const p = item.path || item.file || item.src || '';
        return {
          path: String(p).trim(),
          caption: String(item.caption || item.title || '').trim()
        };
      }
      return null;
    })
    .filter(item => item && item.path);
}

/** 按路径里的斜杠把照片挂成一棵树，顺序沿用清单里的先后 */
function buildTree(items) {
  const root = { name: '', key: '', parent: null, children: new Map(), photos: [] };

  items.forEach(item => {
    const segments = item.path.replace(/^\/+/, '').split('/').filter(Boolean);
    const file = segments.pop();
    if (!file) return;

    let node = root;
    segments.forEach(segment => {
      if (!node.children.has(segment)) {
        node.children.set(segment, {
          name: segment,
          key: node.key ? `${node.key}/${segment}` : segment,
          parent: node,
          children: new Map(),
          photos: []
        });
      }
      node = node.children.get(segment);
    });

    node.photos.push({ file, path: item.path, caption: item.caption });
  });

  return root;
}

/** 取该节点（含子目录）里的第一张照片，用来当封面 */
function firstPhoto(node) {
  if (node.photos.length) return node.photos[0];
  for (const child of node.children.values()) {
    const found = firstPhoto(child);
    if (found) return found;
  }
  return null;
}

function pageUrl(key) {
  return key ? `/${GALLERY_DIR}/${key}/` : `/${GALLERY_DIR}/`;
}

function displayName(names, name) {
  return (names && names[name]) || name;
}

/**
 * 相册首页最前面那张「地图」入口卡片
 *
 * 它不是一个真实相册（没有自己的照片），所以用图标代替封面。
 * 这里刻意用抽象的地图钉图标，不画任何地理图形 —— 避免地图合规问题。
 */
function renderMapCard() {
  return [
    '<a href="/map/" style="display:block;text-decoration:none">',
    '<div style="width:100%;aspect-ratio:4/3;border-radius:8px;background:#e6f1fb;display:flex;align-items:center;justify-content:center">',
    '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#185fa5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>',
    '<circle cx="12" cy="10" r="3"></circle>',
    '</svg>',
    '</div>',
    '<div style="font-size:13px;color:#8a8a8a;text-align:center;margin-top:8px">地图</div>',
    '</a>'
  ].join('\n');
}

/**
 * 「选下一级」的封面卡片
 *
 * ⚠️ 结构上有讲究：<img> 必须**直接**放在 <a> 里面，并且带 no-lightbox 类。
 *
 * 因为主题的图片灯箱脚本（node_modules/hexo-theme-butterfly/source/js/utils.js）
 * 会给「父节点不是 <a> 的图片」自动套一层 <a data-fancybox>。
 * 如果这里在 <a> 和 <img> 之间再夹一层 <figure>，图片的父节点就成了 <figure>，
 * 会被误判为"没被链接包着" —— 结果是点封面弹出看图浮层，而不是进入相册页面。
 *
 * isRoot 为 true 时（相册首页），最前面强制插入「地图」卡片。
 */
function renderCards(entries, names, hexo, isRoot) {
  const cards = entries
    .map(child => {
      const label = escapeHtml(displayName(names, child.name));
      const cover = firstPhoto(child);
      const image = cover
        ? `<img class="no-lightbox" src="${urls(hexo, cover.path).thumb}" alt="${label}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block;background:#efefe9">`
        : '<div style="width:100%;aspect-ratio:4/3;border-radius:8px;background:#efefe9"></div>';

      return [
        `<a href="${pageUrl(child.key)}" style="display:block;text-decoration:none">`,
        image,
        `<div style="font-size:13px;color:#8a8a8a;text-align:center;margin-top:8px">${label}</div>`,
        '</a>'
      ].join('\n');
    })
    .join('\n');

  const items = isRoot ? `${renderMapCard()}\n${cards}` : cards;

  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${CARD_MIN_WIDTH}px,1fr));gap:18px;margin:22px 0;">\n${items}\n</div>`;
}

/** 照片墙 */
function renderGrid(photos, hexo) {
  const figures = photos
    .map(photo => renderPhoto(hexo, photo.path, photo.caption || photo.file))
    .join('\n');

  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${GRID_MIN_WIDTH}px,1fr));gap:14px;margin:22px 0;">\n${figures}\n</div>`;
}

/** 面包屑：相册 › 中国 › 四川 */
function renderCrumb(node, names) {
  if (!node.parent) return '';

  const chain = [];
  let cursor = node;
  while (cursor && cursor.parent) {
    chain.unshift(cursor);
    cursor = cursor.parent;
  }

  const link = (text, key) =>
    `<a href="${pageUrl(key)}" style="color:inherit;text-decoration:underline">${escapeHtml(text)}</a>`;

  const parts = [link('相册', '')];
  chain.forEach((item, index) => {
    const label = displayName(names, item.name);
    parts.push(index === chain.length - 1 ? escapeHtml(label) : link(label, item.key));
  });

  return `<p style="font-size:13px;color:#8a8a8a;margin:0 0 18px">${parts.join(' <span style="opacity:.45">›</span> ')}</p>`;
}

hexo.extend.generator.register('album', function (locals) {
  const data = (locals.data && locals.data.albums) || {};
  const names = data.names || {};
  const items = normalizePhotos(data.photos);

  if (!baseUrl(hexo)) {
    hexo.log.warn('[album] _config.yml 里还没设置 r2_base，相册生成不出照片地址。');
  }
  if (!items.length) {
    hexo.log.warn('[album] source/_data/albums.yml 里还没登记照片，相册会是空的。');
  }

  const root = buildTree(items);
  const pages = [];

  const walk = node => {
    const entries = Array.from(node.children.values());
    const isRoot = node.parent === null;
    const blocks = [renderCrumb(node, names)];

    // 相册首页即使一张照片都没登记，也要显示「地图」那张卡片，不然整页是空的
    if (entries.length || isRoot) blocks.push(renderCards(entries, names, hexo, isRoot));
    if (node.photos.length) blocks.push(renderGrid(node.photos, hexo));

    pages.push({
      path: node.key ? `${GALLERY_DIR}/${node.key}/index.html` : `${GALLERY_DIR}/index.html`,
      layout: 'page',
      data: {
        title: node.parent ? displayName(names, node.name) : '相册',
        date: new Date(),
        // 沉浸式：相册各级页面都不要顶部大图、不显示侧边栏
        top_img: false,
        aside: false,
        comments: false,
        content: blocks.filter(Boolean).join('\n')
      }
    });

    entries.forEach(child => walk(child));
  };

  walk(root);

  hexo.log.info(`[album] 生成相册页面 ${pages.length} 个`);
  return pages;
});
