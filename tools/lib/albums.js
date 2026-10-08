/**
 * 把 R2 扫到的照片，自动同步进 albums.yml 的 photos: 段
 *
 * 规则（2026-10-05 与用户确认）：
 *   - R2 里有、清单里没有  → 追加到 photos 段末尾
 *   - 清单里有、R2 里没有  → 删掉那一行
 *   - 已有的说明文字（`| 川主寺`）和文件里的注释，一律保留
 *
 * ⚠️ 为什么要用「文本操作」而不是 yaml.dump 重新序列化？
 *    因为序列化会把文件里所有注释全部冲掉 —— 那个文件头部的说明、
 *    以及 photos 段里那几行「以后照着加行就行」的示例注释，都是给人看的，
 *    丢了就白写了。所以这里按行处理，只动列表行。
 */

const fs = require('fs');
const yaml = require('js-yaml');

/** 从一行列表项里取出 R2 路径（去掉 `| 说明` 和首尾引号） */
function pathOfItem(raw) {
  const s = String(raw).split('|')[0].trim().replace(/^["']|["']$/g, '');
  return s.replace(/^\/+/, '');
}

/**
 * @param {string} file       albums.yml 的绝对路径
 * @param {string[]} wanted   R2 里实际存在的照片路径（应已排好序）
 * @returns {{added: string[], removed: string[], removedWithCaption: string[]}}
 */
function syncAlbumPhotos(file, wanted) {
  if (!fs.existsSync(file)) return { added: [], removed: [], removedWithCaption: [] };
  // 空桶保护：R2 里一张照片都没有时（连接异常、桶选错、还没传图）一律不动清单，
  // 否则「删除」规则会把用户辛苦登记的行全部清空
  if (!Array.isArray(wanted) || !wanted.length) {
    return { added: [], removed: [], removedWithCaption: [] };
  }

  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  // ① 定位 photos: 段 —— 从 `photos:` 行到下一个顶层键（如 names:）
  const start = lines.findIndex(l => /^photos:\s*$/.test(l));
  if (start === -1) return { added: [], removed: [], removedWithCaption: [] };

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    // 顶层键 = 顶格、非空、不是注释
    if (l && !/^\s/.test(l) && !l.startsWith('#')) { end = i; break; }
  }

  // ② 收集段内所有列表行
  const itemRe = /^(\s*)-\s*(.+?)\s*$/;
  const items = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(itemRe);
    if (m) items.push({ index: i, indent: m[1] || '  ', raw: m[2] });
  }

  const want = new Set(wanted);
  const have = new Set(items.map(it => pathOfItem(it.raw)).filter(Boolean));

  // ③ 算出要删的和要加的和要留的
  const removeSet = new Set();
  const removed = [];
  const removedWithCaption = [];
  const keep = [];

  items.forEach(it => {
    const p = pathOfItem(it.raw);
    if (!p) return;
    if (want.has(p)) { keep.push(it); return; }
    removeSet.add(it.index);
    removed.push(p);
    if (String(it.raw).includes('|')) removedWithCaption.push(it.raw);
  });

  const added = wanted.filter(p => !have.has(p));
  if (!added.length && !removed.length) return { added: [], removed: [], removedWithCaption: [] };

  // ④ 重写：删掉失效行，新行插在「最后一个保留的列表项」之后
  const lastKeep = keep.length ? keep[keep.length - 1].index : start;
  const indent = items.length ? items[0].indent : '  ';
  const newLines = added.map(p => `${indent}- ${p}`);

  const out = [];
  lines.forEach((line, i) => {
    if (removeSet.has(i)) return;
    out.push(line);
    if (i === lastKeep) newLines.forEach(nl => out.push(nl));
  });

  // ⑤ 安全网：写完立刻解析一遍，解析不了就整份还原（绝不让网站因为清单坏掉）
  const backup = text;
  fs.writeFileSync(file, out.join(eol), 'utf8');
  try {
    const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.photos)) throw new Error('photos 段不是列表');
  } catch (err) {
    fs.writeFileSync(file, backup, 'utf8');
    throw new Error('写出的 albums.yml 无法解析，已还原原文件：' + err.message);
  }

  return { added, removed, removedWithCaption };
}

module.exports = { syncAlbumPhotos, pathOfItem };
