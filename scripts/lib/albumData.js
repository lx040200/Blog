/**
 * 相册数据读取（供相册生成器、文章尾部卡片、{% photo %} 标签共用）
 *
 * 三个数据来源：
 *   A. photo-index.json  —— tools/sync.js 扫描 R2 得到的全部照片（自动）
 *   B. 文章正文里的 {% photo %}  —— 写文章时插图自动并入相册
 *   C. albums.yml 的 photos  —— 可选的「补充清单」：给某张写说明、或手动排前面
 *
 * albums.yml 的 names 是必需项：R2 目录名是英文，要显示成中文得有对照表。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'source', '_data');
const INDEX_FILE = path.join(DATA_DIR, 'photo-index.json');
const MAP_FILE = path.join(DATA_DIR, 'photo-map.json');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.yml');

let indexCache;
let albumsCache;

/* ---------------- 扫描结果索引（来源 A） ---------------- */

function readIndex() {
  if (indexCache !== undefined) return indexCache;
  if (!fs.existsSync(INDEX_FILE)) {
    indexCache = null;
    return null;
  }
  try {
    indexCache = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (err) {
    indexCache = null;
  }
  return indexCache;
}

/** 按文件名找完整路径（用于 {% photo 只写文件名 %}） */
function findByFilename(name) {
  const idx = readIndex();
  if (!idx || !Array.isArray(idx.photos)) return '';

  const needle = String(name).toLowerCase();
  const hits = idx.photos.filter(p => String(p.name || '').toLowerCase() === needle);
  return hits.length ? hits[0].p : '';
}

/** 目录（如 china/sichuan-aba）在索引里有没有照片 */
function indexDirs() {
  const idx = readIndex();
  if (!idx || !Array.isArray(idx.photos)) return new Set();
  return new Set(idx.photos.map(p => p.dir).filter(Boolean));
}

/* ---------------- 补充清单 + 中文名（来源 C） ---------------- */

function readAlbums() {
  if (albumsCache) return albumsCache;

  const empty = { names: {}, photos: [], order: [] };
  if (!fs.existsSync(ALBUMS_FILE)) {
    albumsCache = empty;
    return empty;
  }

  let data;
  try {
    data = yaml.load(fs.readFileSync(ALBUMS_FILE, 'utf8')) || {};
  } catch (err) {
    albumsCache = empty;
    return empty;
  }

  const photos = (Array.isArray(data.photos) ? data.photos : [])
    .map(item => {
      if (typeof item === 'string') {
        const s = item.trim();
        if (!s) return null;
        const i = s.indexOf('|');
        return i === -1
          ? { path: s.replace(/^\/+/, ''), caption: '' }
          : { path: s.slice(0, i).trim().replace(/^\/+/, ''), caption: s.slice(i + 1).trim() };
      }
      if (item && typeof item === 'object') {
        const p = String(item.path || item.file || '').trim();
        if (!p) return null;
        return {
          path: p.replace(/^\/+/, ''),
          caption: String(item.caption || item.title || '').trim()
        };
      }
      return null;
    })
    .filter(Boolean);

  albumsCache = {
    names: data.names || {},
    photos,
    order: Array.isArray(data.order) ? data.order.map(String) : []
  };
  return albumsCache;
}

function displayName(name) {
  const { names } = readAlbums();
  return names[name] || name;
}

/* ---------------- 文章里的 {% photo %}（来源 B） ---------------- */

/**
 * 从 markdown 源文本里抓出 {% photo 路径 "说明" %}
 * 注意必须用源文本（post.raw）：渲染后的 HTML 里标签已经没了
 */
function parsePhotoTags(raw) {
  const out = [];
  if (!raw) return out;

  const re = /\{%\s*photo\s+([^\s%}]+)([^%}]*?)\s*%\}/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let caption = (m[2] || '').trim();
    caption = caption.replace(/^["“”']+|["“”']+$/g, '').trim();
    out.push({ path: String(m[1]).trim().replace(/^\/+/, ''), caption });
  }
  return out;
}

/** 由照片路径推出它属于哪个相册目录（去掉最后一段文件名） */
function dirOf(photoPath) {
  const segs = String(photoPath).replace(/^\/+/, '').split('/').filter(Boolean);
  segs.pop();
  return segs.join('/');
}

/**
 * 读一篇文章的「拍摄日期」—— front-matter 里的 shot，返回 'YYYY-MM-DD' 或 'YYYY-MM'
 * 没写就返回 ''（表示这篇不算拍摄类文章，不进取景轨迹）
 *
 * 轨迹页和相册的时间关联都用这一个函数，保证两边算出来的月份永远一致。
 *
 * ⚠️ 时区坑（这个坑踩过两次，别再踩）：
 *   1. js-yaml 把 `shot: 2024-08-01` 解析成的是**本地时间**的午夜，
 *      所以必须用 getFullYear / getMonth / getDate 取值，用 getUTC* 在东八区会退回一天。
 *   2. Hexo 缓存（db.json）会把 Date 序列化成 ISO 串（本地午夜 → 前一天 16:00Z）。
 *      字符串分支若直接取前 10 位，同样退一天 —— 所以带时间的写法一律交给 Date，
 *      再统一走「本地取值」。
 */
function shotOf(post) {
  const raw = post && post.shot;
  if (raw === undefined || raw === null || raw === '') return '';

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

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return fromDate(parsed);

  return '';
}

module.exports = {
  ROOT,
  DATA_DIR,
  INDEX_FILE,
  MAP_FILE,
  ALBUMS_FILE,
  readIndex,
  findByFilename,
  indexDirs,
  readAlbums,
  displayName,
  parsePhotoTags,
  dirOf,
  shotOf
};
