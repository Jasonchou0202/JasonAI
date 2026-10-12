export interface SaleInput {
  productId: string;
  productName: string;
  customer: string;
  date: string;
  revenue: number;
  cost: number;
  note: string;
}
export interface Sale extends SaleInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
  importBatch?: string;
  sourceRow?: number;
  lastMutation?: string;
}
export interface Product {
  id: string;
  name: string;
  price: number;
  cost: number;
  active: boolean;
  order: number;
}
export interface Totals {
  revenue: number;
  cost: number;
  profit: number;
  count: number;
}
export interface Filters {
  from?: string;
  to?: string;
  search?: string;
  productId?: string;
  deleted?: boolean;
  page?: number;
}
export type Period = "day" | "week" | "month";
export interface Bucket extends Totals {
  key: string;
  label: string;
  from: string;
  to: string;
}
export interface Dashboard {
  today: Totals;
  week: Totals;
  month: Totals;
  all: Totals;
  days: Bucket[];
  weeks: Bucket[];
  months: Bucket[];
  recent: Sale[];
  products: { name: string; profit: number; count: number }[];
}
export interface ImportRow extends SaleInput {
  sourceRow: number;
  sourceProfit?: number;
}
export interface ImportIssue {
  row: number;
  message: string;
  kind: "error" | "warning";
}
export interface ImportPreview {
  rows: ImportRow[];
  issues: ImportIssue[];
  totals: Totals;
  months: Bucket[];
  fileName: string;
  digest: string;
  duplicateRows: number[];
}
export interface Backup {
  format: "zhangyuge-sales";
  version: 1;
  exportedAt: string;
  sales: Sale[];
  products: Product[];
}
export interface ImportBatch {
  id: string;
  fingerprint: string;
  name: string;
  count: number;
  createdAt: string;
  status: "pending" | "complete";
  processed: number;
}
export interface AppState {
  sales: Sale[];
  products: Product[];
  batches: ImportBatch[];
}
export interface SalesPage {
  items: Sale[];
  total: number;
  totals: Totals;
}
export interface Api {
  call<T>(action: string, payload?: unknown): Promise<T>;
}
