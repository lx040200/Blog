/**
 * 相册页面自动生成器
 *
 * 照片来源（三处合并去重）：
 *   A. source/_data/photo-index.json —— tools/sync.js 扫描 R2 得到的全部照片
 *   B. 文章正文里的 {% photo %}     —— 写文章插图，自动并入相册，并标出「出自《…》」
 *   C. source/_data/albums.yml 的 photos —— 可选补充清单：给某张写说明、或手动排前面
 *
 * albums.yml 里的 names 负责「英文目录名 → 中文显示名」。
 * 层级完全由照片路径里的斜杠数量决定，不需要声明：
 *   某层还有子目录 → 生成「选下一级」的封面卡片；没有子目录 → 生成照片墙。
 */

const { escapeHtml, baseUrl, urls, renderPhoto } = require('./lib/photo');
const {
  readIndex,
  readAlbums,
  displayName,
  findByFilename,
  parsePhotoTags
} = require('./lib/albumData');

const GALLERY_DIR = 'gallery';
const CARD_MIN_WIDTH = 190;
const GRID_MIN_WIDTH = 200;

/* ---------------- 把三处来源合并成一份照片清单 ---------------- */

function collectPhotos(locals) {
  const entries = new Map();
  const albums = readAlbums();

  // C：补充清单最先来 —— 它决定「手写顺序」和说明文字
  albums.photos.forEach((item, i) => {
    entries.set(item.path, {
      path: item.path,
      caption: item.caption,
      order: i,
      source: null
    });
  });

  // B：文章里的插图
  const posts =
    locals && locals.posts && locals.posts.length ? locals.posts.toArray() : [];

  posts
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach(post => {
      parsePhotoTags(post.raw).forEach(tag => {
        let p = tag.path;
        // 只写了文件名的情况：去扫描索引里查它的完整路径
        if (p && !p.includes('/')) {
          const found = findByFilename(p);
          if (found) p = found;
        }
        if (!p) return;

        const exist = entries.get(p);
        if (exist) {
          if (!exist.caption && tag.caption) exist.caption = tag.caption;
          if (!exist.source) exist.source = { title: post.title, url: '/' + post.path };
          return;
        }

        entries.set(p, {
          path: p,
          caption: tag.caption || '',
          order: null,
          source: { title: post.title, url: '/' + post.path }
        });
      });
    });

  // A：R2 扫描结果（存在但既没进清单、也没进文章的照片）
  const idx = readIndex();
  if (idx && Array.isArray(idx.photos)) {
    idx.photos.forEach(item => {
      if (entries.has(item.p)) return;
      entries.set(item.p, {
        path: item.p,
        caption: '',
        order: null,
        source: null,
        mtime: item.mtime || ''
      });
    });
  }

  return Array.from(entries.values());
}

/* ---------------- 建树 ---------------- */

function buildTree(photos) {
  const root = { name: '', key: '', parent: null, children: new Map(), photos: [] };

  photos.forEach(photo => {
    const segments = String(photo.path).replace(/^\/+/, '').split('/').filter(Boolean);
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

    node.photos.push(photo);
  });

  return root;
}

/** 排序：补充清单里手写的排前面（按清单顺序），其余按文件名（时间由早到晚） */
function sortPhotos(list) {
  return list.slice().sort((a, b) => {
    const ao = a.order == null ? Number.MAX_SAFE_INTEGER : a.order;
    const bo = b.order == null ? Number.MAX_SAFE_INTEGER : b.order;
    if (ao !== bo) return ao - bo;
    return String(a.path).localeCompare(String(b.path));
  });
}

/** 取该节点（含子目录）里的第一张照片，用来当封面 */
function firstPhoto(node) {
  if (node.photos.length) return sortPhotos(node.photos)[0];
  for (const child of node.children.values()) {
    const found = firstPhoto(child);
    if (found) return found;
  }
  return null;
}

function pageUrl(key) {
  return key ? `/${GALLERY_DIR}/${key}/` : `/${GALLERY_DIR}/`;
}

/* ---------------- 渲染 ---------------- */

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
function renderCards(entries, hexo, isRoot) {
  const cards = entries
    .map(child => {
      const label = escapeHtml(displayName(child.name));
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
  const figures = sortPhotos(photos)
    .map(photo => renderPhoto(hexo, photo.path, photo.caption, photo.source))
    .join('\n');

  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${GRID_MIN_WIDTH}px,1fr));gap:14px;margin:22px 0;">\n${figures}\n</div>`;
}

/** 面包屑：相册 › 中国 › 四川 */
function renderCrumb(node) {
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
    const label = displayName(item.name);
    parts.push(index === chain.length - 1 ? escapeHtml(label) : link(label, item.key));
  });

  return `<p style="font-size:13px;color:#8a8a8a;margin:0 0 18px">${parts.join(' <span style="opacity:.45">›</span> ')}</p>`;
}

/* ---------------- 生成 ---------------- */

hexo.extend.generator.register('album', function (locals) {
  if (!baseUrl(hexo)) {
    hexo.log.warn('[album] _config.yml 里还没设置 r2_base，相册生成不出照片地址。');
  }

  const index = readIndex();
  if (!index) {
    hexo.log.warn(
      '[album] 还没有 source/_data/photo-index.json —— 先在 E:\\Web\\blog 跑 node tools/sync.js'
    );
  }

  const photos = collectPhotos(locals);
  const fromIndex = index && Array.isArray(index.photos) ? index.photos.length : 0;
  const fromPosts = photos.filter(p => p.source).length;

  const root = buildTree(photos);
  const pages = [];

  const walk = node => {
    const entries = Array.from(node.children.values());
    const isRoot = node.parent === null;
    const blocks = [renderCrumb(node)];

    // 相册首页即使一张照片都没有，也要显示「地图」那张卡片，不然整页是空的
    if (entries.length || isRoot) blocks.push(renderCards(entries, hexo, isRoot));
    if (node.photos.length) blocks.push(renderGrid(node.photos, hexo));

    pages.push({
      path: node.key ? `${GALLERY_DIR}/${node.key}/index.html` : `${GALLERY_DIR}/index.html`,
      layout: 'page',
      data: {
        title: node.parent ? displayName(node.name) : '相册',
        // 给分享卡片用的一句话描述（不设的话主题会从正文里随便抓，很难看）
        description: node.parent ? `${displayName(node.name)} 的照片` : '按地点整理的照片',
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

  hexo.log.info(
    `[album] 生成相册页面 ${pages.length} 个（照片 ${photos.length} 张；R2 扫描 ${fromIndex} 张，其中 ${fromPosts} 张出现在文章里）`
  );
  return pages;
});
