/** 树状图布局（squarified）：面积与数值成正比，坐标用 0–100 的百分比，方便直接写进 CSS */
export interface TreemapCell<T> {
  item: T;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export function treemap<T>(
  items: readonly { item: T; value: number }[],
  width = 100,
  height = 100,
): TreemapCell<T>[] {
  const list = items
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = list.reduce((n, i) => n + i.value, 0);
  if (!total) return [];
  const scale = (width * height) / total;
  const out: TreemapCell<T>[] = [];
  let x = 0,
    y = 0,
    w = width,
    h = height;
  let row: { item: T; value: number; area: number }[] = [];
  const worst = (r: typeof row, side: number) => {
    const s = r.reduce((n, i) => n + i.area, 0);
    const max = Math.max(...r.map((i) => i.area));
    const min = Math.min(...r.map((i) => i.area));
    return Math.max(
      (side * side * max) / (s * s),
      (s * s) / (side * side * min),
    );
  };
  const flush = () => {
    const s = row.reduce((n, i) => n + i.area, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const r of row) {
        const ch = r.area / cw;
        out.push({ item: r.item, value: r.value, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      for (const r of row) {
        const cw = r.area / ch;
        out.push({ item: r.item, value: r.value, x: cx, y, w: cw, h: ch });
        cx += cw;
      }
      y += ch;
      h -= ch;
    }
    row = [];
  };
  for (const i of list) {
    const next = { ...i, area: i.value * scale };
    const side = Math.min(w, h);
    if (row.length && worst([...row, next], side) > worst(row, side)) flush();
    row.push(next);
  }
  if (row.length) flush();
  return out;
}
