/**
 * 从 R2 上的原图里读 EXIF GPS，并转成高德用的坐标。
 *
 * 技巧：EXIF 数据在 JPEG 开头，所以只发 HTTP Range 请求取前 256KB，
 * 不用下载整张（原图动辄 8MB）。极少数 EXIF 特别大的，会自动整张重下一次。
 */

const fs = require('fs');
const exifr = require('exifr');
const yaml = require('js-yaml');

const HEAD_BYTES = 256 * 1024;

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

/* ---------------- 抓取与解析 ---------------- */

async function grab(url, partial) {
  const headers = partial ? { Range: `bytes=0-${HEAD_BYTES - 1}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) return { ok: false, status: res.status };
  const ab = await res.arrayBuffer();
  return { ok: true, buf: Buffer.from(ab) };
}

/**
 * 读一张图的 GPS。
 * 返回 { lat, lng, taken } 或 { noGps: true } 或 { error: '...' }
 * 注意：这里返回的 lat/lng 已经是 GCJ-02（高德坐标系）。
 */
async function readGps(url) {
  let got = await grab(url, true);
  if (!got.ok) return { error: `HTTP ${got.status}` };

  let gps = null;
  let meta = null;
  try {
    gps = await exifr.gps(got.buf);
    meta = await exifr.parse(got.buf, ['DateTimeOriginal']);
  } catch (err) {
    /* 截断导致解析失败时，下面会整张重试 */
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

  const [gcjLng, gcjLat] = wgs84ToGcj02(gps.longitude, gps.latitude);
  return { lat: gcjLat, lng: gcjLng, taken };
}

/* ---------------- 手写坐标补充表 ---------------- */

/**
 * 解析一条坐标。支持三种写法：
 *   "39.1342, 117.2010"        ← 字符串（最常用）
 *   [39.1342, 117.2010]        ← 数组
 *   { lat: 39.1342, lng: 117.2010 }
 * 一律「先纬度后经度」。
 *
 * 容错：中国经度 73~136、纬度 3~54。所以只要第一个数超过 90，
 * 基本就是把经度写前面了 —— 自动换回来，并让调用方打个警告。
 */
function parseCoord(raw) {
  let lat;
  let lng;

  if (Array.isArray(raw)) {
    if (raw.length < 2) return null;
    lat = Number(raw[0]);
    lng = Number(raw[1]);
  } else if (raw && typeof raw === 'object') {
    lat = Number(raw.lat !== undefined ? raw.lat : raw.latitude);
    lng = Number(raw.lng !== undefined ? raw.lng : raw.longitude);
  } else if (typeof raw === 'string') {
    const nums = raw
      .split(/[,，;；\s]+/)
      .map(Number)
      .filter(n => Number.isFinite(n));
    if (nums.length < 2) return null;
    lat = nums[0];
    lng = nums[1];
  } else {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let swapped = false;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    [lat, lng] = [lng, lat];
    swapped = true;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng, swapped };
}

/**
 * 读坐标补充表（source/_data/photo-gps.yml）
 *
 * 返回 Map：照片路径 → { lat, lng }
 * ⚠️ 这里读到的是 WGS-84，用之前还要过一遍 wgs84ToGcj02。
 */
function readManualGps(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;

  let data;
  try {
    data = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (err) {
    throw new Error('photo-gps.yml 解析失败（检查缩进和逗号）：' + err.message);
  }

  // 容错：坐标行漏了缩进时，YAML 会把它当成顶层键，于是静默失效。
  // 这种情况 YAML 不报错（缩进少两个空格照样能解析），所以必须专门提醒。
  const stray = Object.keys(data).filter(
    k => k !== 'photos' && /\.(jpe?g|png|webp|heic|tif?f|avif)$/i.test(k)
  );
  if (stray.length) {
    console.warn(`\n   ⚠️  photo-gps.yml 里有 ${stray.length} 行漏了缩进（写到 photos: 外面了），不会生效：`);
    stray.slice(0, 5).forEach(k => console.warn('        ' + k));
    console.warn('      每行前面要有两个空格，跟 photos: 下面的示例对齐。');
  }

  const table = data.photos || {};
  Object.keys(table).forEach(key => {
    const coord = parseCoord(table[key]);
    if (!coord) {
      console.warn(`\n   ⚠️  photo-gps.yml 里这条看不懂，已跳过：${key}: ${JSON.stringify(table[key])}`);
      return;
    }
    if (coord.swapped) {
      console.warn(`\n   ⚠️  ${key} 的经纬度看着像写反了，已自动换过来：${coord.lat}, ${coord.lng}`);
    }
    out.set(String(key).replace(/^\/+/, ''), { lat: coord.lat, lng: coord.lng });
  });

  return out;
}

/** 并发受限的 map */
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

module.exports = { wgs84ToGcj02, readGps, readManualGps, parseCoord, mapLimit };
