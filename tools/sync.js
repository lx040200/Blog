#!/usr/bin/env node
/**
 * 同步 R2 → 网站数据（一条命令搞定）
 *
 * 用法（在 E:\Web\blog 目录下执行）：
 *
 *   node tools/sync.js             列目录 + 取 GPS（完整）
 *   node tools/sync.js --no-gps    只列目录，不取 GPS（快，照片多时用）
 *
 * 它做三件事：
 *   1. 连上 R2，列出桶里所有照片（按「国家/城市/」目录结构）
 *   2. 写出 source/_data/photo-index.json  —— 相册生成器读它来自动建树
 *   3. 逐张读 EXIF GPS，写出 source/_data/photo-map.json  —— 地图页读它
 *
 * 密钥从 .env.local 读（该文件在 .gitignore 里，不会进 GitHub）。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { loadEnv, listObjects, ENV_FILE } = require('./lib/r2');
const { readGps, mapLimit } = require('./lib/gps');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, '_config.yml');
const DATA_DIR = path.join(ROOT, 'source', '_data');
const INDEX_OUT = path.join(DATA_DIR, 'photo-index.json');
const MAP_OUT = path.join(DATA_DIR, 'photo-map.json');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff', '.avif']);
const CONCURRENCY = 6;

function readBase() {
  const cfg = yaml.load(fs.readFileSync(CONFIG, 'utf8')) || {};
  const base = String(cfg.r2_base || '').replace(/\/+$/, '');
  if (!base) {
    console.error('_config.yml 里没有设置 r2_base，无法生成图片地址。');
    process.exit(1);
  }
  return base;
}

function formatSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

async function main() {
  const noGps = process.argv.includes('--no-gps');
  const base = readBase();
  const env = loadEnv();

  if (!fs.existsSync(ENV_FILE)) {
    console.error('\n❌ 缺少密钥文件：');
    console.error('   ' + ENV_FILE);
    console.error('\n   照着同目录下的 .env.local.example 建一个，填三项：');
    console.error('     CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / R2_BUCKET');
    process.exit(1);
  }

  console.log('图床：' + base);
  console.log('正在列 R2 目录…');

  const objects = await listObjects(env, n => process.stdout.write('\r  已列出 ' + n + ' 个对象'));
  process.stdout.write('\n');

  const photos = objects
    .filter(o => !o.key.endsWith('/'))
    .filter(o => IMAGE_EXT.has(path.extname(o.key).toLowerCase()))
    .map(o => {
      const segs = o.key.split('/');
      const name = segs.pop();
      return {
        p: o.key,
        name,
        dir: segs.join('/'),
        size: o.size,
        mtime: o.lastModified
      };
    });

  const dirs = new Set(photos.map(p => p.dir).filter(Boolean));
  const totalBytes = photos.reduce((sum, p) => sum + p.size, 0);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    INDEX_OUT,
    JSON.stringify({ generated: new Date().toISOString(), base, photos }, null, 0),
    'utf8'
  );

  console.log('\n──────── 目录 ────────');
  console.log(`照片：${photos.length} 张`);
  console.log(`地点目录：${dirs.size} 个`);
  console.log(`合计：${formatSize(totalBytes)}`);
  console.log(`已写出：${INDEX_OUT}`);

  if (!photos.length) {
    console.log('\n桶里还没有照片（或者目录结构不对），先传点照片再跑。');
    return;
  }

  if (noGps) {
    console.log('\n（加了 --no-gps，跳过 GPS 提取，地图数据保持不变）');
    return;
  }

  console.log('\n正在逐张读 EXIF GPS…');
  let done = 0;
  const results = await mapLimit(photos, CONCURRENCY, async photo => {
    const r = await readGps(`${base}/${photo.p}`);
    done += 1;
    process.stdout.write(`\r  已处理 ${done}/${photos.length}`);
    return { photo, ...r };
  });
  process.stdout.write('\n');

  const withGps = [];
  const noGpsList = [];
  const failed = [];

  for (const r of results) {
    if (r.error) {
      failed.push(`${r.photo.p}（${r.error}）`);
      continue;
    }
    if (r.noGps) {
      noGpsList.push(r.photo.p);
      continue;
    }
    const entry = {
      p: r.photo.p,
      lat: Number(r.lat.toFixed(5)),
      lng: Number(r.lng.toFixed(5))
    };
    if (r.taken) entry.t = r.taken;
    withGps.push(entry);
  }

  fs.writeFileSync(
    MAP_OUT,
    JSON.stringify({ generated: new Date().toISOString(), photos: withGps }),
    'utf8'
  );

  console.log('\n──────── 坐标 ────────');
  console.log(`✅ 带 GPS：${withGps.length} 张`);
  console.log(`⚠️  没有 GPS：${noGpsList.length} 张`);
  if (failed.length) console.log(`❌ 读取失败：${failed.length} 张`);
  console.log(`已写出：${MAP_OUT}`);

  const show = (title, list) => {
    if (!list.length) return;
    console.log(`\n【${title}】（前 10 个）`);
    list.slice(0, 10).forEach(p => console.log('  ' + p));
    if (list.length > 10) console.log(`  ……还有 ${list.length - 10} 个`);
  };
  show('没有 GPS（不会出现在地图上）', noGpsList);
  show('读取失败', failed);

  console.log('\n下一步：npx hexo server 看效果，满意就 git add . && git commit && git push');
}

main().catch(err => {
  console.error('\n❌ ' + err.message);
  process.exit(1);
});
