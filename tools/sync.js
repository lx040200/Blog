#!/usr/bin/env node
/**
 * 同步 R2 → 网站数据（一条命令搞定）
 *
 * 用法（在 E:\Web\blog 目录下执行）：
 *
 *   node tools/sync.js             列目录 + 取 GPS（完整）
 *   node tools/sync.js --no-gps    只列目录，不取 GPS（快，照片多时用）
 *
 * 它做四件事：
 *   1. 连上 R2，列出桶里所有照片（按「国家/城市/」目录结构）
 *   2. 写出 source/_data/photo-index.json  —— 相册生成器读它来自动建树
 *   3. 把照片同步进 source/_data/albums.yml 的 photos: 段
 *      R2 里有、清单里没有的 → 自动补上；清单里有、R2 里没有的 → 自动删掉。
 *      你写的说明文字（`| 川主寺`）和文件里的注释一律保留。
 *      所以要「写图注 / 换封面 / 调顺序」，直接改那个文件里的行就行。
 *   4. 逐张读 EXIF GPS，写出 source/_data/photo-map.json  —— 地图页读它
 *
 * 密钥从 .env.local 读（该文件在 .gitignore 里，不会进 GitHub）。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { loadEnv, listObjects, ENV_FILE } = require('./lib/r2');
const { readGps, readManualGps, wgs84ToGcj02, mapLimit } = require('./lib/gps');
const { syncAlbumPhotos } = require('./lib/albums');
const { generateDrafts, appendNewPhotos } = require('./lib/draft');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, '_config.yml');
const DATA_DIR = path.join(ROOT, 'source', '_data');
const INDEX_OUT = path.join(DATA_DIR, 'photo-index.json');
const MAP_OUT = path.join(DATA_DIR, 'photo-map.json');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.yml');
const MANUAL_GPS_FILE = path.join(DATA_DIR, 'photo-gps.yml');

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

/** 照片显示模式，跟 _config.yml 的 image_mode 一致（草稿封面要用） */
function readImageMode() {
  const cfg = yaml.load(fs.readFileSync(CONFIG, 'utf8')) || {};
  const raw = String(cfg.image_mode || '').trim().toLowerCase();
  return raw === 'direct' ? 'direct' : 'transformations';
}

async function main() {
  const noGps = process.argv.includes('--no-gps');
  const base = readBase();
  const env = loadEnv();

  // 安全网：模板文件是会被提交到 GitHub 的，一旦有人往里面填真值就是泄露
  const exampleFile = path.join(ROOT, '.env.local.example');
  if (fs.existsSync(exampleFile)) {
    const txt = fs.readFileSync(exampleFile, 'utf8');
    // 注意：这里必须用 [ \t] 而不是 \s —— \s 会连换行一起吃掉，
    // 导致空值行也误报（三个占位符空着时是最常见的正常状态）
    const leaked = /^[ \t]*(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|R2_BUCKET)[ \t]*=[ \t]*\S+/m.test(txt);
    if (leaked) {
      console.error('\n🚨 危险：.env.local.example 里被填了真实密钥！');
      console.error('   ' + exampleFile);
      console.error('\n   这个文件【会被提交到 GitHub】，是给未来的自己看的模板。');
      console.error('   请把它的值清空，真密钥只填在 .env.local 里（那个不会进仓库）。');
      process.exit(1);
    }
  }

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

  // 上一次索引里的「拍摄时间」先继承过来 —— 加了 --no-gps 会跳过 EXIF 读取，
  // 没有这一步就把已经读到的拍摄时间清空了
  const takenFromPrev = new Map();
  if (fs.existsSync(INDEX_OUT)) {
    try {
      const old = JSON.parse(fs.readFileSync(INDEX_OUT, 'utf8'));
      (old.photos || []).forEach(p => { if (p.taken) takenFromPrev.set(p.p, p.taken); });
    } catch (err) { /* 旧文件坏了就当没有 */ }
  }
  photos.forEach(p => {
    if (!p.taken && takenFromPrev.has(p.p)) p.taken = takenFromPrev.get(p.p);
  });

  const writeIndex = () => fs.writeFileSync(
    INDEX_OUT,
    JSON.stringify({ generated: new Date().toISOString(), base, photos }, null, 0),
    'utf8'
  );

  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeIndex();

  console.log('\n──────── 目录 ────────');
  console.log(`照片：${photos.length} 张`);
  console.log(`地点目录：${dirs.size} 个`);
  console.log(`合计：${formatSize(totalBytes)}`);
  console.log(`已写出：${INDEX_OUT}`);

  // 把扫到的照片同步进 albums.yml 的 photos 段
  // （保留你写的说明文字和文件注释，只增删照片行；空桶时不动）
  const album = syncAlbumPhotos(ALBUMS_FILE, photos.map(p => p.p).sort());
  console.log('\n──────── 相册清单 ────────');
  if (album.added.length || album.removed.length) {
    if (album.added.length) {
      console.log(`新增：${album.added.length} 行`);
      album.added.slice(0, 8).forEach(p => console.log('  + ' + p));
      if (album.added.length > 8) console.log(`  ……还有 ${album.added.length - 8} 行`);
    }
    if (album.removed.length) {
      console.log(`删除：${album.removed.length} 行`);
      album.removed.slice(0, 8).forEach(p => console.log('  - ' + p));
    }
    if (album.removedWithCaption.length) {
      console.log(`\n⚠️  删掉的行里，有 ${album.removedWithCaption.length} 行原本写着说明文字：`);
      album.removedWithCaption.slice(0, 5).forEach(r => console.log('     ' + r));
      console.log('   如果那些照片只是还没传上去，重新传一次再跑本命令就会自动回来（说明要重写）。');
    }
    console.log(`已更新：${ALBUMS_FILE}`);
  } else {
    console.log('清单已经和 R2 一致，无需改动');
  }

  if (!photos.length) {
    console.log('\n桶里还没有照片（或者目录结构不对），先传点照片再跑。');
    return;
  }

  if (noGps) {
    console.log('\n（加了 --no-gps，跳过 GPS 提取，地图数据保持不变）');
    return;
  }

  // 坐标补充表：照片自己没有 EXIF 坐标时，从这里取
  const manual = readManualGps(MANUAL_GPS_FILE);
  if (manual.size) console.log(`\n坐标补充表：读到 ${manual.size} 条手写坐标`);

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
  const manualUsed = [];

  for (const r of results) {
    if (r.error) {
      failed.push(`${r.photo.p}（${r.error}）`);
      continue;
    }
    if (r.noGps) {
      // EXIF 里没有坐标 → 查坐标补充表（手写的，WGS-84，要转成 GCJ-02）
      const m = manual.get(r.photo.p);
      if (m) {
        const [gcjLng, gcjLat] = wgs84ToGcj02(m.lng, m.lat);
        withGps.push({
          p: r.photo.p,
          lat: Number(gcjLat.toFixed(5)),
          lng: Number(gcjLng.toFixed(5))
        });
        manualUsed.push(r.photo.p);
        continue;
      }
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

  // 把拍摄时间回填进相册索引。
  // 地图数据（MAP_OUT）里的 t 只有「带 GPS」的照片才有，相册要的是每一张。
  const byPath = new Map(photos.map(p => [p.p, p]));
  let takenFilled = 0;
  for (const r of results) {
    if (!r.taken) continue;
    const photo = byPath.get(r.photo.p);
    if (photo && !photo.taken) { photo.taken = r.taken; takenFilled += 1; }
  }
  if (takenFilled) {
    writeIndex();
    console.log(`\n已把 ${takenFilled} 张的拍摄时间写进相册数据（相册按时间分组要用）`);
  }

  // ──────── 自动生成旅行草稿 ────────
  // 某一组（目录 + 月份）的照片，一张都没被文章引用过 → 这趟还没写 → 生成草稿。
  // 草稿正文本身就带 {% photo %}，所以生成过一次之后就不会再重复生成。
  const drafts = generateDrafts({
    postsDir: path.join(ROOT, 'source', '_posts'),
    albumsFile: ALBUMS_FILE,
    base,
    imageMode: readImageMode(),
    photos,
    log: msg => console.log(msg)
  });

  console.log('\n──────── 旅行草稿 ────────');
  if (drafts.created.length) {
    console.log(`新建 ${drafts.created.length} 篇（正文只有照片，补上文字再提交就行）`);
  } else {
    console.log('没有需要新建的草稿');
  }

  // 往已有草稿里补「后来加进同一时段的照片」
  // 只往文件末尾追加，绝不改动你已经写下的文字
  const filled = appendNewPhotos({
    postsDir: path.join(ROOT, 'source', '_posts'),
    photos,
    log: msg => console.log(msg)
  });
  if (filled.appended.length) {
    console.log(`已补进 ${filled.appended.length} 篇草稿`);
  }

  console.log('\n──────── 坐标 ────────');
  console.log(`✅ 能上地图：${withGps.length} 张`);
  if (manualUsed.length) {
    console.log(`   （其中 ${manualUsed.length} 张来自坐标补充表的手写坐标）`);
  }
  console.log(`⚠️  没坐标、上不了地图：${noGpsList.length} 张`);
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
