/**
 * 开票状态的界面选项与展示：可选四态；作废/红冲已从选项里拿掉，只给历史数据做兜底展示。
 * 不改 domain 里的 InvoiceStatus / INVOICE_STATUSES，云函数仍接受旧值。
 */
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "../domain/invoices";

export const INVOICE_STATUS_CHOICES = ["awaiting_info", "pending", "issued", "sent"] as const satisfies readonly InvoiceStatus[];

export function isRetiredInvoiceStatus(status: InvoiceStatus): status is "void" | "red" {
  return status === "void" || status === "red";
}

export const INVOICE_STATUS_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "全部" },
  { id: "open", label: "未开" },
  ...INVOICE_STATUS_CHOICES.map((s) => ({ id: s, label: INVOICE_STATUS_LABEL[s] })),
];

/** 下拉/步骤选项：常用四态；若当前是历史作废或红冲，附带该项以便只读展示。 */
export function invoiceStatusSelectOptions(current: InvoiceStatus): InvoiceStatus[] {
  return isRetiredInvoiceStatus(current) ? [...INVOICE_STATUS_CHOICES, current] : [...INVOICE_STATUS_CHOICES];
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_LABEL[status] ?? "未知状态";
}
