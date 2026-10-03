#!/usr/bin/env node
/**
 * 从 R2 上的原图里提取 GPS 坐标，生成地图页用的数据文件。
 *
 * 为什么直接从 R2 读、不依赖本地：照片本来就都在 R2 上，本地不需要留副本。
 * EXIF 数据在 JPEG 文件开头，所以只取前 256KB（HTTP Range 请求），
 * 不必下载整张（原图动辄 8MB+）。极少数 EXIF 很大、256KB 不够的，会自动整张重下一次。
 *
 * 用法（在 E:\Web\blog 目录下执行，不需要参数）：
 *
 *   node tools/extract-gps.js
 *
 * 它做四件事：
 *   1. 读 source/_data/albums.yml，拿到所有照片在 R2 里的路径与说明文字
 *   2. 读 _config.yml 里的 r2_base（图床域名）
 *   3. 从 R2 取每张图的开头一段，解析 EXIF GPS，把 WGS-84 转成高德用的 GCJ-02
 *   4. 写出 source/photo-map.json，地图页读这个文件
 *
 * 没取到 GPS、R2 上找不到的，都会在最后列出来。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const exifr = require('exifr');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, '_config.yml');
const ALBUMS = path.join(ROOT, 'source', '_data', 'albums.yml');
const OUT = path.join(ROOT, 'source', 'photo-map.json');

const HEAD_BYTES = 256 * 1024; // 先取开头 256KB
const CONCURRENCY = 6;

/* ---------------- 坐标系转换：WGS-84 → GCJ-02 ---------------- */

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/* ---------------- 读配置与清单 ---------------- */

function readBase() {
  const cfg = yaml.load(fs.readFileSync(CONFIG, 'utf8')) || {};
  const base = String(cfg.r2_base || '').replace(/\/+$/, '');
  if (!base) {
    console.error('_config.yml 里没有设置 r2_base，无法生成图片地址。');
    process.exit(1);
  }
  return base;
}

function readAlbums() {
  const data = yaml.load(fs.readFileSync(ALBUMS, 'utf8')) || {};
  const raw = Array.isArray(data.photos) ? data.photos : [];

  return raw
    .map(item => {
      let p = '';
      let c = '';
      if (typeof item === 'string') {
        const s = item.trim();
        const i = s.indexOf('|');
        p = i === -1 ? s : s.slice(0, i).trim();
        c = i === -1 ? '' : s.slice(i + 1).trim();
      } else if (item && typeof item === 'object') {
        p = String(item.path || item.file || '').trim();
        c = String(item.caption || item.title || '').trim();
      }
      return p ? { path: p.replace(/^\/+/, ''), caption: c } : null;
    })
    .filter(Boolean);
}

/* ---------------- 抓取与解析 ---------------- */

async function grab(url, partial) {
  const headers = partial ? { Range: `bytes=0-${HEAD_BYTES - 1}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) return { ok: false, status: res.status };
  const ab = await res.arrayBuffer();
  return { ok: true, buf: Buffer.from(ab) };
}

async function readGps(url) {
  // 先只取开头一段
  let got = await grab(url, true);
  if (!got.ok) return { error: `HTTP ${got.status}` };

  let gps = null;
  let meta = null;
  try {
    gps = await exifr.gps(got.buf);
    meta = await exifr.parse(got.buf, ['DateTimeOriginal']);
  } catch (err) {
    /* 截断导致解析失败时会走下面的整张重试 */
  }

  // 开头一段没读到 GPS，可能是 EXIF 比 256KB 还大，整张再下一次
  if (!gps || typeof gps.latitude !== 'number') {
    got = await grab(url, false);
    if (!got.ok) return { error: `HTTP ${got.status}` };
    try {
      gps = await exifr.gps(got.buf);
      meta = await exifr.parse(got.buf, ['DateTimeOriginal']);
    } catch (err) {
      return { error: `解析失败：${err.message}` };
    }
  }

  if (!gps || typeof gps.latitude !== 'number' || typeof gps.longitude !== 'number') {
    return { noGps: true };
  }

  let taken = '';
  if (meta && meta.DateTimeOriginal instanceof Date) {
    taken = meta.DateTimeOriginal.toISOString().slice(0, 19).replace('T', ' ');
  }

  return { lat: gps.latitude, lng: gps.longitude, taken };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const base = readBase();
  const albums = readAlbums();

  if (!albums.length) {
    console.log('albums.yml 里还没有登记照片，没什么可做的。');
    return;
  }

  console.log(`图床：${base}`);
  console.log(`清单里共有 ${albums.length} 张照片，开始读取 EXIF…\n`);

  let done = 0;
  const results = await mapLimit(albums, CONCURRENCY, async item => {
    const url = `${base}/${item.path}`;
    const r = await readGps(url);
    done += 1;
    process.stdout.write(`\r已处理 ${done}/${albums.length}`);
    return { item, ...r };
  });
  process.stdout.write('\n');

  const photos = [];
  const noGps = [];
  const notFound = [];
  const failed = [];

  for (const r of results) {
    if (r.error) {
      if (/HTTP 404/.test(r.error)) notFound.push(r.item.path);
      else failed.push(`${r.item.path}（${r.error}）`);
      continue;
    }
    if (r.noGps) {
      noGps.push(r.item.path);
      continue;
    }

    const [gcjLng, gcjLat] = wgs84ToGcj02(r.lng, r.lat);
    const entry = {
      p: r.item.path,
      lat: Number(gcjLat.toFixed(5)),
      lng: Number(gcjLng.toFixed(5))
    };
    if (r.item.caption) entry.c = r.item.caption;
    if (r.taken) entry.t = r.taken;
    photos.push(entry);
  }

  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), photos }), 'utf8');

  console.log('\n──────── 结果 ────────');
  console.log(`✅ 取到坐标：${photos.length} 张`);
  console.log(`⚠️  没有 GPS：${noGps.length} 张`);
  console.log(`⚠️  R2 上找不到：${notFound.length} 张`);
  if (failed.length) console.log(`❌ 读取失败：${failed.length} 张`);
  console.log(`\n已写出：${OUT}`);
  console.log(`大约 ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);

  const show = (title, list) => {
    if (!list.length) return;
    console.log(`\n【${title}】（前 10 个）`);
    list.slice(0, 10).forEach(p => console.log('  ' + p));
    if (list.length > 10) console.log(`  ……还有 ${list.length - 10} 个`);
  };
  show('没有 GPS', noGps);
  show('R2 上找不到', notFound);
  show('读取失败', failed);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
