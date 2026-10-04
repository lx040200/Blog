/**
 * 读本地密钥 + 列出 R2 桶里的对象
 *
 * 用的是 Cloudflare 官方 REST 接口（不用 S3 签名，一个 Bearer Token 搞定）：
 *   GET https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket}/objects
 *
 * 密钥从 E:\Web\blog\.env.local 读（这个文件在 .gitignore 里，不会进 GitHub）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env.local');

/** 极简 .env 解析：KEY=VALUE，支持 # 注释和引号 */
function loadEnv() {
  const env = Object.assign({}, process.env);

  if (!fs.existsSync(ENV_FILE)) return env;

  fs.readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .forEach(line => {
      const s = line.trim();
      if (!s || s.startsWith('#')) return;
      const eq = s.indexOf('=');
      if (eq === -1) return;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !env[key]) env[key] = val;
    });

  return env;
}

/** 检查密钥是否齐全，缺什么就明确告诉你缺什么 */
function requireCredentials(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const bucket = String(env.R2_BUCKET || '').trim();

  const missing = [];
  if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!token) missing.push('CLOUDFLARE_API_TOKEN');
  if (!bucket) missing.push('R2_BUCKET');

  if (missing.length) {
    console.error('\n❌ 还缺配置，请检查这个文件：');
    console.error('   ' + ENV_FILE);
    console.error('\n   缺少：' + missing.join('、'));
    console.error('\n   文件内容应该是这样（三行）：');
    console.error('     CLOUDFLARE_ACCOUNT_ID=你的账户ID');
    console.error('     CLOUDFLARE_API_TOKEN=你的API令牌');
    console.error('     R2_BUCKET=你的桶名');
    console.error('\n   参考同目录下的 .env.local.example');
    process.exit(1);
  }

  return { accountId, token, bucket };
}

/**
 * 列出桶里所有对象（自动翻页）。
 * 返回 [{ key, size, lastModified }]
 */
async function listObjects(env, onPage) {
  const { accountId, token, bucket } = requireCredentials(env);
  const all = [];
  let cursor = null;

  for (let page = 1; page <= 500; page += 1) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`
    );
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);

    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new Error(`连不上 Cloudflare：${err.message}`);
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      throw new Error(`Cloudflare 返回的不是 JSON（HTTP ${res.status}）`);
    }

    if (!res.ok || json.success === false) {
      const detail =
        (json.errors || []).map(e => `${e.code} ${e.message}`).join('；') || `HTTP ${res.status}`;
      if (res.status === 403 || res.status === 401) {
        throw new Error(
          `没有权限：${detail}\n   → 检查 API 令牌是否有「R2 读取」权限，以及账户 ID 是否正确`
        );
      }
      if (res.status === 404) {
        throw new Error(`找不到桶：${detail}\n   → 检查 R2_BUCKET 的桶名是否写对`);
      }
      throw new Error(`Cloudflare 报错：${detail}`);
    }

    const rows = Array.isArray(json.result) ? json.result : [];
    rows.forEach(o => {
      if (!o || !o.key) return;
      all.push({
        key: o.key,
        size: typeof o.size === 'number' ? o.size : 0,
        lastModified: o.last_modified || ''
      });
    });

    if (onPage) onPage(all.length);

    const info = json.result_info || {};
    if (info.is_truncated && info.cursor) cursor = info.cursor;
    else break;
  }

  return all;
}

module.exports = { loadEnv, requireCredentials, listObjects, ENV_FILE };
