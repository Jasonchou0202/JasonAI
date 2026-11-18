// Canvas 2D 小工具：取画布、按像素比放大、画柱状对照和折线（不引入图表库，包体积小）
function dpr() {
  try {
    return (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
  } catch (e) {
    return 2;
  }
}
function canvas(page, selector) {
  return new Promise((resolve) =>
    wx
      .createSelectorQuery()
      .in(page)
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const r = res && res[0];
        if (!r || !r.node) return resolve(null);
        const ratio = dpr();
        r.node.width = r.width * ratio;
        r.node.height = r.height * ratio;
        const ctx = r.node.getContext("2d");
        ctx.scale(ratio, ratio);
        ctx.clearRect(0, 0, r.width, r.height);
        resolve({ ctx, width: r.width, height: r.height });
      }),
  );
}
function roundTop(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}
/** 利润对照：每月两根柱（只算销售 / 扣成本后），高度是 0–100 的百分比 */
function drawCompare(c, bars) {
  if (!c) return;
  const { ctx, width, height } = c;
  const base = height - 24;
  const top = 10;
  const slot = width / Math.max(bars.length, 1);
  const bw = Math.min(14, slot / 4);
  ctx.strokeStyle = "#EFE8E2";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, base + 0.5);
  ctx.lineTo(width, base + 0.5);
  ctx.stroke();
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  bars.forEach((b, i) => {
    const cx = slot * i + slot / 2;
    const hs = ((base - top) * b.sales) / 100;
    const ha = ((base - top) * b.actual) / 100;
    ctx.fillStyle = "#E8C4B6";
    roundTop(ctx, cx - bw - 2, base - hs, bw, hs, 4);
    ctx.fillStyle = "#D97757";
    roundTop(ctx, cx + 2, base - ha, bw, ha, 4);
    ctx.fillStyle = "#7A6A5F";
    ctx.fillText(b.label, cx, height - 6);
  });
}
/** 折线 + 面积（每月新增客户） */
function drawLine(c, chart, shown) {
  if (!c) return;
  const { ctx, height } = c;
  const pts = chart.points;
  if (!pts.length) return;
  ctx.strokeStyle = "#EFE8E2";
  ctx.beginPath();
  ctx.moveTo(pts[0].x - 10, chart.baseline + 0.5);
  ctx.lineTo(pts[pts.length - 1].x + 10, chart.baseline + 0.5);
  ctx.stroke();
  ctx.fillStyle = "rgba(217,119,87,0.12)";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, chart.baseline);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, chart.baseline);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#D97757";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  pts.forEach((p, i) => {
    ctx.fillStyle = i === shown ? "#B4532F" : "#D97757";
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === shown ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2B2522";
    ctx.fillText(String(p.value), p.x, p.y - 9);
    ctx.fillStyle = "#7A6A5F";
    ctx.fillText(p.label, p.x, height - 6);
  });
}
module.exports = { canvas, drawCompare, drawLine };
