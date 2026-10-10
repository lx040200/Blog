/**
 * 首页大图轮播（左右滑动）
 *
 * 为什么是自己写：Butterfly 的 index_img 只接受**一张**图它生成的是单个 background-image，
 * 传数组会产出无效 CSS；主题自带的轮播是给「整站页面背景」用的，而首页大图正好盖住了它。
 *
 * 做法：用 after_render:html 过滤器，**只在首页**注入一小段 CSS + JS。
 * 不修改主题文件，主题升级也不会被覆盖。
 *
 * 图片来源（按优先级）：
 *   1. R2 的 banner/ 目录 —— 跑一次 `node tools/sync.js` 会把它扫出来、
 *      写成 source/_data/hero-slides.json，这里读清单拼地址。
 *      图片走 Cloudflare 的图片变换压到 1920 宽，比原图小得多。
 *   2. 退回本地 source/img/banner/（清单不存在或为空时用）
 *   两种都没有 → 不轮播，首页照常显示 index_img 那张（不会白屏）
 *   不足 2 张也不启用 —— 一张图没法「轮播」
 *
 * 为什么清单要在本地生成：Cloudflare 云端构建时**拿不到 R2 凭证**，扫不了桶。
 *   所以走跟照片一样的套路：本地同步一次 → 结果固化进 JSON → 构建时只读文件。
 */

const fs = require('fs');
const path = require('path');

const BANNER_DIR = path.join(__dirname, '..', 'source', 'img', 'banner');
const HERO_INDEX = path.join(__dirname, '..', 'source', '_data', 'hero-slides.json');
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.bmp', '.svg']);

/** 读 R2 轮播图清单（由 tools/sync.js 扫描 R2 的 banner/ 目录生成） */
function readR2Images() {
  try {
    if (!fs.existsSync(HERO_INDEX)) return [];
    const data = JSON.parse(fs.readFileSync(HERO_INDEX, 'utf8'));
    const list = data && Array.isArray(data.images) ? data.images : [];
    const base = String((data && data.base) || '').replace(/\/+$/, '');
    if (!base || !list.length) return [];
    return list.map(
      k => `${base}/cdn-cgi/image/width=1920,quality=85,format=auto,onerror=redirect/${k}`
    );
  } catch (err) {
    return [];
  }
}

/** 列出轮播图：优先用 R2 的清单，没有就退回本地文件夹 */
function listBannerImages() {
  const fromR2 = readR2Images();
  if (fromR2.length) return fromR2;

  // 降级：本地 source/img/banner/
  if (!fs.existsSync(BANNER_DIR)) return [];
  let files;
  try {
    files = fs.readdirSync(BANNER_DIR);
  } catch (err) {
    return [];
  }
  return files
    .filter(f => !f.startsWith('.'))
    .filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => '/img/banner/' + encodeURIComponent(f));
}

const STYLE = `
<style id="hero-slides-style">
#page-header.full_page.has-hero-slides{position:relative;overflow:hidden;}
.hero-slides{position:absolute;top:0;right:0;bottom:0;left:0;z-index:0;}
.hero-slide{position:absolute;top:0;right:0;bottom:0;left:0;background-size:cover;background-position:center;background-repeat:no-repeat;
  transform:translateX(100%);transition:transform .9s ease-in-out;will-change:transform;}
.hero-slide.active{transform:translateX(0);z-index:2;}
.hero-slide.leaving{transform:translateX(-100%);z-index:1;}
/* 让站名、打字机、向下箭头压在轮播图之上（导航栏本身是 fixed，不动它） */
#page-header.full_page.has-hero-slides #site-info,
#page-header.full_page.has-hero-slides #scroll-down,
#page-header.full_page.has-hero-slides #page-site-info{position:relative;z-index:3;}
@media (prefers-reduced-motion:reduce){.hero-slide{transition:none;}}
</style>
`;

function buildScript(images) {
  return `
<script id="hero-slides-script">
(function () {
  var IMAGES = ${JSON.stringify(images)};
  var INTERVAL = 5000;   /* 每张停留 5 秒，想改就改这个数 */

  var header = document.querySelector('#page-header.full_page');
  if (!header || IMAGES.length < 2) return;

  /* 先把图都预加载上，避免切过去时还是空白 */
  IMAGES.forEach(function (src) { var i = new Image(); i.src = src; });

  var wrap = document.createElement('div');
  wrap.className = 'hero-slides';

  var layers = IMAGES.map(function (src, idx) {
    var d = document.createElement('div');
    d.className = 'hero-slide';
    d.style.backgroundImage = 'url("' + src + '")';
    /* 第一张先标成 active，再插进 DOM —— 这样首屏不会有多余的滑入动画 */
    if (idx === 0) d.classList.add('active');
    wrap.appendChild(d);
    return d;
  });

  header.insertBefore(wrap, header.firstChild);
  /* 背景原本那张让给轮播层；万一上面哪步出错，这行不会执行，首页照常显示原图 */
  header.style.backgroundImage = 'none';
  header.classList.add('has-hero-slides');

  var cur = 0;
  var timer = null;

  function next() {
    var prev = cur;
    cur = (cur + 1) % layers.length;
    layers[cur].classList.add('active');    /* 从右边滑进来 */
    layers[prev].classList.remove('active');
    layers[prev].classList.add('leaving');  /* 往左边滑出去 */
    var p = prev;
    setTimeout(function () { layers[p].classList.remove('leaving'); }, 1000);
  }

  function start() {
    if (timer === null) timer = setInterval(next, INTERVAL);
  }
  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  start();
  /* 切到别的标签页时暂停，回来再继续 —— 省电，也不会回来一下跳好几张 */
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
})();
</script>
`;
}

let logged = false;

hexo.extend.filter.register('after_render:html', function (str, data) {
  const pagePath = data && data.path ? String(data.path) : '';
  if (pagePath !== 'index.html') return str;

  const images = listBannerImages();

  if (!logged) {
    logged = true;
    if (!images.length) {
      hexo.log.info(
        '[hero-slides] source/img/banner/ 里还没有图 —— 首页大图暂不轮播。放几张进去就会自动开启。'
      );
    } else if (images.length === 1) {
      hexo.log.info('[hero-slides] banner 文件夹里只有 1 张图，轮播需要至少 2 张');
    } else {
      hexo.log.info(`[hero-slides] 首页大图轮播已启用，共 ${images.length} 张`);
    }
  }

  if (images.length < 2) return str;
  if (str.indexOf('hero-slides-script') !== -1) return str; // 防重复注入

  const inject = STYLE + buildScript(images);
  return str.indexOf('</body>') !== -1 ? str.replace('</body>', inject + '</body>') : str + inject;
});
