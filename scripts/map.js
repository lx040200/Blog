/**
 * 相册地图页生成器
 *
 * 生成 /map/ 页面：读 source/photo-map.json（由 tools/extract-gps.js 产出），
 * 在高德地图上按坐标打点，点标记看照片。
 *
 * ⚠️ 关于 Key：
 * 本生成器**不写任何真实密钥**。Key 从 _config.yml 的 amap_key 读取，
 * 默认值是占位符 REPLACE_WITH_YOUR_AMAP_WEB_KEY。
 * 你需要到 高德开放平台(lbs.amap.com) 申请一个「Web端(JS API)」的 Key，
 * 绑定域名 lx042.cc.cd，然后填进 _config.yml 的 amap_key —— 只改那一处。
 *
 * 合规说明：只使用高德地图（在合规白名单内）；坐标统一为 GCJ-02
 * （tools/extract-gps.js 已把 EXIF 里的 WGS-84 转换过来）。
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'source', 'photo-map.json');
const DEFAULT_KEY = 'REPLACE_WITH_YOUR_AMAP_WEB_KEY';

/** 从 _config.yml 读高德 Key；没填就用占位符 */
function readKey(hexo) {
  const key = String((hexo.config && hexo.config.amap_key) || '').trim();
  return key || DEFAULT_KEY;
}

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

hexo.extend.generator.register('photo-map', function (locals) {
  const base = String(hexo.config.r2_base || '').replace(/\/+$/, '');
  const key = readKey(hexo);
  const photos = readData(hexo);

  if (key === DEFAULT_KEY) {
    hexo.log.warn('[map] _config.yml 里的 amap_key 还是占位符，地图页会加载不出地图。');
  }

  const data = photos.map(p => ({
    p: p.p,
    lat: p.lat,
    lng: p.lng,
    c: p.c || '',
    t: p.t || ''
  }));

  const content = `
<div style="font-size:14px;color:#5c6470;margin:0 0 14px">
  这里的每个点，都是一张照片的拍摄地。点标记可以看照片。
</div>

<div id="photo-map" style="width:100%;height:70vh;min-height:420px;border-radius:10px;overflow:hidden;background:#efefe9"></div>
<p id="photo-map-tip" style="font-size:13px;color:#8a8a8a;margin:12px 0 0"></p>

<script src="https://webapi.amap.com/maps?v=2.0&key=${key}"></script>
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
    box.innerHTML = '<div style="padding:24px;font-size:14px;color:#854f0b;line-height:1.8">'
      + '<strong>地图没能加载。</strong><br>'
      + '最可能的原因：_config.yml 里的 <code>amap_key</code> 还是占位符，或者 Key 类型不对。'
      + 'Key 必须是「Web端(JS API)」类型，并且绑定了域名 lx042.cc.cd。</div>';
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

  // ---- 打点 ----
  //
  // ⚠️ 高德 JS API 2.0 的点聚合类名是 AMap.MarkerCluster（不是 1.4 的 MarkerClusterer）。
  //    2.0 的 MarkerCluster 第二个参数要的是【坐标数组】[{lnglat:[lng,lat]}]，
  //    传 Marker 实例进去不会报错，但一个点都不会渲染（排查了很久才定位到）。
  //    所以这里：优先用 MarkerCluster，失败则退回普通 Marker。

  function usePlainMarkers() {
    var list = DATA.map(function (item) {
      var marker = new AMap.Marker({
        position: [item.lng, item.lat],
        title: item.c || item.p,
        offset: new AMap.Pixel(-7, -7)
      });
      marker.setContent(plainIcon());
      marker.on('click', function () { openInfo(item); });
      return marker;
    });
    map.add(list);
  }

  // 自绘标记点：不依赖高德默认图标（那个图元资源偶尔会 503）
  function plainIcon() {
    return '<div style="width:14px;height:14px;border-radius:50%;background:#185fa5;'
      + 'border:2px solid #fff;box-shadow:0 0 0 1px rgba(24,95,165,.55);cursor:pointer"></div>';
  }

  // 点击聚合点/标记时，用坐标回头找是哪张照片（误差 50 米内算命中）
  function findByLngLat(lnglat) {
    if (!lnglat) return null;
    var lng = (lnglat.lng !== undefined) ? lnglat.lng : lnglat[0];
    var lat = (lnglat.lat !== undefined) ? lnglat.lat : lnglat[1];
    var best = null;
    var bestGap = 1e9;
    DATA.forEach(function (item) {
      var gap = Math.abs(item.lng - lng) + Math.abs(item.lat - lat);
      if (gap < bestGap) { bestGap = gap; best = item; }
    });
    return bestGap < 0.0006 ? best : null;
  }

  map.plugin(['AMap.MarkerCluster'], function () {
    if (typeof AMap.MarkerCluster !== 'function') {
      usePlainMarkers();
      return;
    }
    try {
      var points = DATA.map(function (item) {
        return { lnglat: [item.lng, item.lat] };
      });

      var cluster = new AMap.MarkerCluster(map, points, {
        gridSize: 60,
        maxZoom: 17,
        // 单个点（未被聚合）
        renderMarker: function (ctx) {
          ctx.marker.setContent(plainIcon());
          ctx.marker.setOffset(new AMap.Pixel(-7, -7));
        },
        // 聚合点：数字气泡
        renderClusterMarker: function (ctx) {
          var size = Math.round(28 + Math.min(ctx.count, 60) * 0.4);
          var div = document.createElement('div');
          div.style.cssText = 'width:' + size + 'px;height:' + size + 'px;line-height:' + size
            + 'px;border-radius:50%;background:#185fa5;color:#fff;font-size:13px;text-align:center;'
            + 'box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer';
          div.innerHTML = ctx.count;
          ctx.marker.setOffset(new AMap.Pixel(-size / 2, -size / 2));
          ctx.marker.setContent(div);
        }
      });

      cluster.on('click', function (e) {
        var hit = findByLngLat(e.lnglat);
        if (hit) openInfo(hit);
      });
    } catch (err) {
      usePlainMarkers();
    }
  });

  // 打开就缩放到刚好装下所有点
  map.on('complete', function () {
    if (DATA.length < 2) return;
    try {
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
