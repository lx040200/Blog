/**
 * 自动生成「旅行草稿」
 *
 * 时机：sync.js 每次跑完相册同步后自动调用。
 *
 * 逻辑：把照片按「目录 + 拍摄月份」分组；某一组里如果**一张照片都没被任何文章引用过**，
 *       说明这趟还没写 → 生成一篇草稿，正文就是按拍摄时间排好的照片。
 *
 * 为什么用「有没有被引用」而不是「有没有同名文章」：
 *   生成的草稿正文里本身就带 {% photo %}，所以它一诞生，这一组立刻变成「已被引用」，
 *   下次同步不会再生成一遍 —— 天然幂等，不需要额外的记录文件。
 *   而且你手动写文章时只要引用了这组里的照片，也就不会再被生成草稿。
 *
 * 安全：只新建文件，绝不覆盖已存在的。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/** 扫描 source/_posts 下所有文章，收集 {% photo %} 引用过的照片 */
function collectReferenced(postsDir) {
  const full = new Set();   // 写成完整路径的
  const names = new Set();  // 只写了文件名的

  if (!fs.existsSync(postsDir)) return { full, names };

  const re = /\{%\s*photo\s+([^\s%}]+)/g;
  for (const f of fs.readdirSync(postsDir)) {
    if (!f.toLowerCase().endsWith('.md')) continue;
    const txt = fs.readFileSync(path.join(postsDir, f), 'utf8');
    let m;
    while ((m = re.exec(txt)) !== null) {
      const v = String(m[1]).trim().replace(/^\/+/, '');
      if (!v) continue;
      full.add(v);
      names.add(v.split('/').pop());
    }
  }
  return { full, names };
}

/** 读 albums.yml 的 names（英文目录名 → 中文显示名） */
function readNames(albumsFile) {
  if (!fs.existsSync(albumsFile)) return {};
  try {
    const data = yaml.load(fs.readFileSync(albumsFile, 'utf8')) || {};
    return data.names || {};
  } catch (err) {
    return {};
  }
}

/** '2026-07' → '2026年7月' */
function monthLabel(key) {
  const [y, m] = String(key).split('-');
  return `${y}年${Number(m)}月`;
}

/** '2026-07-09 10:23:51' → '2026-07-09' */
function dayOf(taken) {
  return String(taken).slice(0, 10);
}

/** 本地时间格式化 'YYYY-MM-DD HH:mm:ss' */
function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * @param {object} opts
 * @param {string} opts.postsDir   source/_posts 的绝对路径
 * @param {string} opts.albumsFile source/_data/albums.yml
 * @param {string} opts.base       图床地址（用于封面）
 * @param {string} opts.imageMode  'transformations' | 'direct'
 * @param {Array}  opts.photos     photo-index.json 里的 photos
 * @param {function} [opts.log]
 * @returns {{created: Array, skippedNoTime: number}}
 */
function generateDrafts(opts) {
  const { postsDir, albumsFile, base, imageMode, photos } = opts;
  const log = opts.log || (() => {});

  const referenced = collectReferenced(postsDir);
  const names = readNames(albumsFile);

  // 按「目录 + 月份」分组
  const groups = new Map();
  let skippedNoTime = 0;

  photos.forEach(p => {
    const taken = p.taken || '';
    if (!taken) { skippedNoTime += 1; return; }
    const month = String(taken).slice(0, 7);
    const key = p.dir + '|' + month;
    if (!groups.has(key)) groups.set(key, { dir: p.dir, month, photos: [] });
    groups.get(key).photos.push(p);
  });

  const created = [];

  for (const group of groups.values()) {
    const { dir, month, photos: list } = group;

    // 组里任意一张被引用过 → 这趟已经写过，跳过
    const used = list.some(p => referenced.full.has(p.p) || referenced.names.has(p.name));
    if (used) continue;

    list.sort((a, b) => String(a.taken).localeCompare(String(b.taken)));

    const slug = `trip-${month}-${dir.replace(/\//g, '-')}`;
    const file = path.join(postsDir, slug + '.md');
    if (fs.existsSync(file)) continue;   // 只新建，绝不覆盖

    const place = names[dir.split('/').pop()] || dir.split('/').pop();
    const title = `${monthLabel(month)} · ${place}`;

    const first = list[0];
    const coverPath = imageMode === 'direct'
      ? `${base}/${first.p}`
      : `${base}/cdn-cgi/image/width=800,quality=80,format=auto,onerror=redirect/${first.p}`;

    const body = list.map(p => `{% photo ${p.p} %}`).join('\n');

    const content = [
      '---',
      `title: ${title}`,
      `date: ${nowStamp()}`,
      `shot: ${dayOf(first.taken)}`,
      // 记下这篇属于哪一组（目录|月份）—— 以后往同一时段加照片时，
      // 靠它把这篇文章找出来补照片。加引号是因为 YAML 里 | 有特殊含义。
      `trip: "${dir}|${month}"`,
      'categories: 摄影',
      `cover: ${coverPath}`,
      '---',
      '',
      body,
      ''
    ].join('\n');

    fs.writeFileSync(file, content, 'utf8');
    created.push({ file, title, count: list.length });
    log(`  + ${title}（${list.length} 张）`);
    log(`      ${slug}.md`);
  }

  return { created, skippedNoTime };
}

/**
 * 把「后来加进同一时段的照片」补进已有的草稿
 *
 * 只处理自动生成的草稿（文件名以 trip- 开头）。
 * ⚠️ **只往文件末尾追加，绝不改动已有内容** —— 你写的文字一个字都不会被动。
 *
 * 怎么找出「一篇草稿对应哪一组」：
 *   1. 先读 front-matter 里的 `trip: "<目录>|<月份>"`（生成草稿时写进去的）；
 *   2. 老草稿没这个字段，就从正文里的 {% photo %} 反推（取第一张能认出来的照片）。
 *
 * @returns {{appended: Array<{file:string, count:number}>}}
 */
function appendNewPhotos(opts) {
  const { postsDir, photos } = opts;
  const log = opts.log || (() => {});
  const appended = [];

  if (!fs.existsSync(postsDir)) return { appended };

  // 两份索引，方便按完整路径或文件名查到照片
  const byPath = new Map();
  const byName = new Map();
  photos.forEach(p => {
    byPath.set(p.p, p);
    byName.set(p.name, p);
  });

  for (const f of fs.readdirSync(postsDir)) {
    if (!/^trip-.*\.md$/i.test(f)) continue;

    const file = path.join(postsDir, f);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      continue;
    }

    // 正文里引用过的照片
    const refs = [...text.matchAll(/\{%\s*photo\s+([^\s%}]+)/g)].map(m => m[1].trim());
    const usedFull = new Set();
    const usedName = new Set();
    refs.forEach(r => {
      const v = r.replace(/^\/+/, '');
      usedFull.add(v);
      usedName.add(v.split('/').pop());
    });

    // ① 这篇属于哪一组
    let group = null;
    const fm = text.match(/^trip:\s*"?(.+?)"?\s*$/m);
    if (fm && fm[1].includes('|')) {
      const [dir, month] = fm[1].split('|').map(s => s.trim());
      if (dir && month) group = { dir, month };
    }
    if (!group) {
      // ② 老草稿：从正文反推
      for (const r of refs) {
        const p = byPath.get(r) || byName.get(r.split('/').pop());
        if (p && p.taken) { group = { dir: p.dir, month: String(p.taken).slice(0, 7) }; break; }
      }
    }
    if (!group) continue;

    // ③ 这一组里还没被引用的照片
    const missing = photos
      .filter(p => p.dir === group.dir && p.taken && String(p.taken).slice(0, 7) === group.month)
      .filter(p => !usedFull.has(p.p) && !usedName.has(p.name))
      .sort((a, b) => String(a.taken).localeCompare(String(b.taken)));

    if (!missing.length) continue;

    // ④ 只追加，不动已有内容
    fs.appendFileSync(file, '\n' + missing.map(p => `{% photo ${p.p} %}`).join('\n') + '\n', 'utf8');
    appended.push({ file: f, count: missing.length });
    log(`  ~ ${f}：补进 ${missing.length} 张新照片`);
  }

  return { appended };
}

/**
 * 校正已有草稿的标题
 *
 * 场景：某篇草稿生成时，albums.yml 的 names 里**还没有**这个新地点，
 *       标题就退成了英文目录名（例如「2026年2月 · sichuan-liangshan」）。
 *       之后你补上 names、再跑同步，草稿因为「只新建、绝不覆盖」也不会自己更新。
 *
 * 做法：只处理 trip-*.md，从 front-matter 的 `trip: "<目录>|<月份>"` 算出正确标题。
 *       ⚠️ **只替换「标题末尾正好是英文目录名」的那种** —— 你自己改过的标题一律不动。
 *
 * @returns {Array<{file:string, from:string, to:string}>}
 */
function fixDraftTitles(opts) {
  const { postsDir, albumsFile } = opts;
  const log = opts.log || (() => {});
  const names = readNames(albumsFile);
  const fixed = [];

  if (!fs.existsSync(postsDir)) return fixed;

  for (const f of fs.readdirSync(postsDir)) {
    if (!/^trip-.*\.md$/i.test(f)) continue;

    const file = path.join(postsDir, f);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      continue;
    }

    // ① 这篇属于哪一组：trip: "<目录>|<月份>"
    const tripLine = text.match(/^trip:[^\n]*$/m);
    if (!tripLine) continue;
    const tripVal = tripLine[0].replace(/^trip:\s*/, '').replace(/^"|"$/g, '').trim();
    if (!tripVal.includes('|')) continue;

    const [dir, month] = tripVal.split('|').map(s => s.trim());
    if (!dir || !month) continue;

    const leaf = dir.split('/').pop();
    const cn = names[leaf];
    if (!cn) continue;                       // names 里还没登记 → 没法校正，跳过

    const correct = `${monthLabel(month)} · ${cn}`;

    // ② 只当标题末尾正好是英文目录名时才替换（保护你手改过的标题）
    const titleLine = text.match(/^title:[^\n]*$/m);
    if (!titleLine) continue;
    const oldTitle = titleLine[0].replace(/^title:\s*/, '').trim();

    if (oldTitle === correct) continue;                    // 已经对了
    if (!oldTitle.endsWith(`· ${leaf}`)) continue;         // 你改过 → 不动

    fs.writeFileSync(file, text.replace(titleLine[0], `title: ${correct}`), 'utf8');
    fixed.push({ file: f, from: oldTitle, to: correct });
    log(`  ✎ ${f}：${oldTitle} → ${correct}`);
  }

  return fixed;
}

module.exports = { generateDrafts, appendNewPhotos, fixDraftTitles, collectReferenced, readNames };
