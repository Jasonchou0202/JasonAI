import type { Filters } from "../domain/model";
export function routeParams() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}
export function readFilters(): Filters {
  const p = routeParams(),
    f: Filters = {};
  for (const key of ["from", "to", "search", "productId"] as const)
    if (p.has(key)) f[key] = p.get(key)!;
  if (p.get("deleted") === "true") f.deleted = true;
  if (p.has("page")) f.page = Math.max(1, Number(p.get("page")) || 1);
  return f;
}
export function filterQuery(f: Filters) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v) p.set(k, String(v));
  });
  return p.toString();
}
