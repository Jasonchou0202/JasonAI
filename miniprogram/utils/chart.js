// Canvas 2D 小工具：取 canvas 节点、按像素比放大，再交给 domain 里的绘图函数（和浏览器预览同一段代码）
function pixelRatio() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().pixelRatio || 2;
    return wx.getSystemInfoSync().pixelRatio || 2;
  } catch (e) {
    return 2;
  }
}
function canvas(page, selector) {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const r = res && res[0];
        if (!r || !r.node) return resolve(null);
        const dpr = pixelRatio();
        const node = r.node;
        node.width = Math.round(r.width * dpr);
        node.height = Math.round(r.height * dpr);
        const ctx = node.getContext("2d");
        ctx.setTransform ? ctx.setTransform(dpr, 0, 0, dpr, 0, 0) : ctx.scale(dpr, dpr);
        resolve({ ctx, width: r.width, height: r.height });
      });
  });
}
module.exports = { canvas };
