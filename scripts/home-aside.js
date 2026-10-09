/**
 * 首页单栏（首页不显示右侧栏）
 *
 * 为什么这么写：Butterfly 没有「只给首页关侧栏」的配置开关——
 *   aside.display 只认 archive / category / tag 三种页面类型，没有 home。
 * 所以用主题**自己的原生机制**：
 *   layout/includes/layout.pug 里有这么两行
 *     - var hideAside = !theme.aside.enable || page.aside === false ? 'hide-aside' : ''
 *     - if theme.aside.enable && page.aside !== false
 * 只要把首页 page 对象的 aside 设成 false，主题就会自动：
 *   1) 给 <main id="content-inner"> 加上 hide-aside 类 → 正文区拉满整宽（主题 CSS 自己处理）
 *   2) 跳过侧栏 widget 的渲染 → 侧栏 DOM 根本不生成（不是用 CSS 藏起来）
 * 优点：不写一行自定义 CSS，不碰主题源码，主题升级后行为不变。
 *
 * 只在首页生效：Hexo 的首页 page 带 __index 标记，
 * 文章详情页 / 归档页 / 关于页 / 相册页都不受影响，侧栏照旧。
 *
 * 想改回两栏：删掉这个文件（或把下面 return 提前）即可。
 */

'use strict';

hexo.extend.filter.register('template_locals', function (locals) {
  if (locals && locals.page && locals.page.__index) {
    locals.page.aside = false;
  }
  return locals;
});
