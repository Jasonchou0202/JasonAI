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
  category?: string;
  hasDefaultPrice?: boolean;
  hasDefaultCost?: boolean;
  archivedAt?: string | null;
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
export type RankPeriodType = "all" | "month" | "quarter" | "half" | "year";
export interface RankPeriod {
  type: RankPeriodType;
  value?: string;
}
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
export interface Customer {
  archivedAt?: string | null;
  id: string;
  name: string;
  mergedInto: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastMutation?: string;
}
export interface CustomerProduct {
  name: string;
  profit: number;
  count: number;
}
export interface CustomerRanking {
  pendingTaskCount: number;
  rank: number;
  customerId: string;
  name: string;
  aliases: string[];
  products: CustomerProduct[];
  totals: Totals;
}
export interface CustomerRankingResult {
  items: CustomerRanking[];
  unassigned: Totals;
  totals: Totals;
}
export interface CustomerSuggestionMember {
  customer: Customer;
  totals: Totals;
  taskCount: number;
}
export interface CustomerSuggestionGroup {
  id: string;
  reason: "ip_or_symbol" | "case";
  targetId: string;
  members: CustomerSuggestionMember[];
  totals: Totals;
  taskCount: number;
}
export interface CustomerDetail {
  customer: Customer;
  aliases: string[];
  totals: Totals;
  products: CustomerProduct[];
  sales: Sale[];
}
export interface CustomerTaskInput {
  customerId: string;
  at: string;
  title: string;
  feedback: string;
  nextAction: string;
  reminder: "both" | "due" | "off";
}
export interface CustomerTask extends CustomerTaskInput {
  id: string;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  lastMutation?: string;
  reminderGeneration: string;
  reminderStartAt: string;
}
export interface BackupV1 {
  format: "zhangyuge-sales";
  version: 1;
  exportedAt: string;
  sales: Sale[];
  products: Product[];
}
export interface BackupV2 extends Omit<BackupV1, "version"> {
  version: 2;
  customers: Customer[];
  tasks: CustomerTask[];
}
export type Backup = BackupV1 | BackupV2;
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
  customers?: Customer[];
  tasks?: CustomerTask[];
}
export interface SalesPage {
  items: Sale[];
  total: number;
  totals: Totals;
}
export interface Api {
  call<T>(action: string, payload?: unknown): Promise<T>;
}
