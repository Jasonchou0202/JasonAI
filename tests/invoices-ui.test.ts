import { describe, expect, it } from "vitest";
import {
  INVOICE_STATUS_CHOICES,
  INVOICE_STATUS_FILTERS,
  invoiceStatusLabel,
  invoiceStatusSelectOptions,
  isRetiredInvoiceStatus,
} from "../src/lib/invoice-status-ui";

describe("开票状态界面", () => {
  it("可选状态只有待收资料、待开票、已开票、已寄出", () => {
    expect([...INVOICE_STATUS_CHOICES]).toEqual(["awaiting_info", "pending", "issued", "sent"]);
    expect(INVOICE_STATUS_CHOICES).not.toContain("void");
    expect(INVOICE_STATUS_CHOICES).not.toContain("red");
  });

  it("筛选标签含全部和未开，不含已作废、已红冲", () => {
    expect(INVOICE_STATUS_FILTERS.map((f) => f.label)).toEqual(["全部", "未开", "待收资料", "待开票", "已开票", "已寄出"]);
    expect(INVOICE_STATUS_FILTERS.some((f) => f.id === "void" || f.id === "red" || /作废|红冲/.test(f.label))).toBe(false);
    expect(INVOICE_STATUS_FILTERS.find((f) => f.id === "open")?.label).toBe("未开");
  });

  it("下拉默认不含作废/红冲；历史记录才附带当前项", () => {
    expect(invoiceStatusSelectOptions("pending")).toEqual(["awaiting_info", "pending", "issued", "sent"]);
    expect(invoiceStatusSelectOptions("void")).toEqual(["awaiting_info", "pending", "issued", "sent", "void"]);
    expect(invoiceStatusSelectOptions("red")).toEqual(["awaiting_info", "pending", "issued", "sent", "red"]);
  });

  it("历史作废/红冲仍显示原标签，便于识别", () => {
    expect(isRetiredInvoiceStatus("void")).toBe(true);
    expect(isRetiredInvoiceStatus("red")).toBe(true);
    expect(isRetiredInvoiceStatus("issued")).toBe(false);
    expect(invoiceStatusLabel("void")).toBe("已作废");
    expect(invoiceStatusLabel("red")).toBe("已红冲");
    expect(invoiceStatusLabel("awaiting_info")).toBe("待收资料");
    expect(invoiceStatusLabel("pending")).toBe("待开票");
    expect(invoiceStatusLabel("issued")).toBe("已开票");
    expect(invoiceStatusLabel("sent")).toBe("已寄出");
  });
});
