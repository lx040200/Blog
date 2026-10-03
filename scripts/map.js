/**
 * 相册地图页生成器
 *
 * 生成 /map/ 页面：读 source/photo-map.json（由 tools/extract-gps.js 产出），
 * 在高德地图上按坐标打点，点标记看照片。
 *
 * ⚠️ 关于 Key：
 * 生成的 HTML 里，高德 SDK 的地址带一个占位符 —— REPLACE_WITH_YOUR_AMAP_WEB_KEY。
 * 本生成器**不会写入任何真实密钥**。请你自己到 高德开放平台(lbs.amap.com)
 * 申请一个「Web端(JS API)」的 Key，绑定域名 lx042.cc.cd，然后替换掉那个占位符。
 *
 * 合规说明：只使用高德地图（符合国内地图合规白名单）；坐标统一为 GCJ-02
 * （tools/extract-gps.js 已把 EXIF 里的 WGS-84 转换过来）。
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'source', 'photo-map.json');
const KEY_PLACEHOLDER = 'REPLACE_WITH_YOUR_AMAP_WEB_KEY';

function readData(hexo) {
  if (!fs.existsSync(DATA_FILE)) {
    hexo.log.warn('[map] 还没生成 source/photo-map.json，先跑 node tools/extract-gps.js');
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const list = Array.isArray(parsed.photos) ? parsed.photos : [];
    return list.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
  } catch (err) {
    hexo.log.warn(`[map] photo-map.json 解析失败：${err.message}`);
    return [];
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

hexo.extend.generator.register('photo-map', function (locals) {
  const base = String(hexo.config.r2_base || '').replace(/\/+$/, '');
  const photos = readData(hexo);

  const data = photos.map(p => ({
    p: p.p,
    lat: p.lat,
    lng: p.lng,
    c: p.c || '',
    t: p.t || ''
  }));

  const content = `
<!--
  ⚠️ 下面是高德地图的 Key 占位符。请替换成你自己的 Key。
  申请：https://lbs.amap.com → 控制台 → 应用管理 → 创建应用 → 添加 Key
        Key 类型选「Web端(JS API)」，绑定域名填 lx042.cc.cd
-->
<div style="font-size:14px;color:#5c6470;margin:0 0 14px">
  这里的每个点，都是一张照片的拍摄地。点标记可以看照片。
</div>

<div id="photo-map" style="width:100%;height:70vh;min-height:420px;border-radius:10px;overflow:hidden;background:#efefe9"></div>
<p id="photo-map-tip" style="font-size:13px;color:#8a8a8a;margin:12px 0 0"></p>

<script src="https://webapi.amap.com/maps?v=2.0&key=${KEY_PLACEHOLDER}"></script>
<script>
(function () {
  var BASE = ${JSON.stringify(base)};
  var DATA = ${JSON.stringify(data)};
  var box = document.getElementById('photo-map');
  var tip = document.getElementById('photo-map-tip');

  if (!DATA.length) {
    tip.textContent = '还没有带坐标的照片。先在 albums.yml 里登记照片，再跑 node tools/extract-gps.js。';
    return;
  }

  if (typeof AMap === 'undefined') {
    box.innerHTML = '<div style="padding:24px;font-size:14px;color:#854f0b;line-height:1.7">'
      + '<strong>地图没能加载。</strong><br>'
      + '最可能的原因：HTML 里那行高德 SDK 的地址还带着占位符 <code>${KEY_PLACEHOLDER}</code>，'
      + '请换成你自己申请的 Key（Key 类型要选「Web端(JS API)」，并绑定域名 lx042.cc.cd）。</div>';
    return;
  }

  var map = new AMap.Map('photo-map', {
    zoom: 5,
    center: [104.0, 35.0],
    resizeEnable: true,
    viewMode: '2D'
  });

  var info = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) });

  function openInfo(item) {
    var url = BASE + '/' + item.p;
    var html = '<div style="max-width:230px">'
      + '<img src="' + url + '" alt="" style="width:100%;border-radius:6px;display:block">'
      + (item.c ? '<div style="margin-top:6px;font-size:13px;color:#1f2328">' + item.c + '</div>' : '')
      + (item.t ? '<div style="margin-top:2px;font-size:12px;color:#8a8a8a">' + item.t + '</div>' : '')
      + '</div>';
    info.setContent(html);
    info.open(map, [item.lng, item.lat]);
  }

  var markers = DATA.map(function (item) {
    var marker = new AMap.Marker({
      position: [item.lng, item.lat],
      title: item.c || item.p
    });
    marker.on('click', function () { openInfo(item); });
    return marker;
  });

  // 点聚合：照片多了必然需要，否则缩小后点会叠成一团。
  // 万一插件加载失败，退回成普通标记，不影响使用。
  map.plugin(['AMap.MarkerClusterer'], function () {
    try {
      new AMap.MarkerClusterer(map, markers, { gridSize: 60, maxZoom: 17 });
    } catch (err) {
      map.add(markers);
    }
  });

  // 打开就缩放到刚好装下所有点
  map.on('complete', function () {
    try {
      if (DATA.length === 1) return;
      var lngs = DATA.map(function (d) { return d.lng; });
      var lats = DATA.map(function (d) { return d.lat; });
      map.setBounds(new AMap.Bounds(
        new AMap.LngLat(Math.min.apply(null, lngs), Math.min.apply(null, lats)),
        new AMap.LngLat(Math.max.apply(null, lngs), Math.max.apply(null, lats))
      ));
    } catch (err) {
      /* 缩放失败不影响看图 */
    }
  });

  tip.textContent = '共 ' + DATA.length + ' 张带坐标的照片。';
})();
</script>
`;

  hexo.log.info(`[map] 生成地图页，带坐标照片 ${data.length} 张`);

  return [
    {
      path: 'map/index.html',
      layout: 'page',
      data: {
        title: '地图',
        date: new Date(),
        top_img: false,
        aside: false,
        comments: false,
        content
      }
    }
  ];
});
