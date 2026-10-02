---
title: 相册
date: 2026-10-01 11:05:00
top_img: /img/cover.svg
comments: false
---

这里放我拍到的一些片段。点开看大图，图下方能打开原图。

## 示例占位图

下面 6 张是占位图。等你的照片传上 R2 之后，把这一整段删掉，换成「换成你自己的照片」里的写法。

{% gallery %}
![](/img/gallery/photo-01.svg)
![](/img/gallery/photo-02.svg)
![](/img/gallery/photo-03.svg)
![](/img/gallery/photo-04.svg)
![](/img/gallery/photo-05.svg)
![](/img/gallery/photo-06.svg)
{% endgallery %}

## 换成你自己的照片

照片传到 R2 桶的 `photos/` 目录后，一张照片写一行。文件名要跟 R2 里的一致，后面的说明文字可省略：

{% raw %}<pre style="background:#f1efe8;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.9;margin:14px 0;">{% photo 2026-10-01-001.jpg "清晨的街道" %}
{% photo 2026-10-01-002.jpg "雨后的玻璃" %}</pre>{% endraw %}

外面再套一层自适应网格，整段复制过去就行：

{% raw %}<pre style="background:#f1efe8;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.9;margin:14px 0;">&lt;div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;"&gt;

{% photo 文件名.jpg "说明文字" %}

&lt;/div&gt;</pre>{% endraw %}

缩略图和大图都是 Cloudflare 现场生成的，你只需要往 R2 传一份原图。
