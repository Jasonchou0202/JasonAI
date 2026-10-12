import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { exportCsv, parseGrid, validateBackup } from "../src/domain/import";
import { readImport } from "../src/lib/files";
const header = [
  "商品名称",
  "客户名称",
  "日期",
  "销售额",
  "出资",
  "纯利",
  "备注",
];
describe("CSV and XLSX migration", () => {
  it("preserves symbols, customer IP and genuine duplicate source orders", () => {
    const row = [
      "商品 原名",
      "✅小林 · 1.2.3.4",
      "2026/5/26",
      "10.50",
      "2.25",
      "8.25",
      "",
    ];
    const p = parseGrid([header, row, row], "sample.csv", "fingerprint");
    expect(p.issues).toHaveLength(0);
    expect(p.rows.map((r) => r.sourceRow)).toEqual([2, 3]);
    expect(p.rows[0].customer).toBe(row[1]);
    expect(p.totals).toEqual({
      revenue: 2100,
      cost: 450,
      profit: 1650,
      count: 2,
    });
  });
  it("reports empty amounts, invalid dates and formula differences instead of silently correcting", () => {
    const p = parseGrid(
      [
        header,
        ["x", "", "2026-01-01", "", 10, "", ""],
        ["x", "", "2026-02-29", 10, 0, 10, ""],
        ["x", "", "2026-01-01", 10, 2, 9, ""],
        ["x", "", "2026-01-02", 0, 2, -2, ""],
      ],
      "invalid.xlsx",
      "hash",
    );
    expect(p.issues.map((i) => i.row)).toEqual([2, 3, 4]);
    expect(p.rows.at(-1)?.revenue).toBe(0);
    expect(p.rows.at(-1)?.cost).toBe(200);
    expect(parseGrid([["客户"]], "missing.csv", "hash").issues).toHaveLength(4);
  });
  it("reads an actual Excel file including numeric date cells", async () => {
    const dateSerial = Math.round(
      (Date.UTC(2026, 4, 26) - Date.UTC(1899, 11, 30)) / 86400000,
    );
    const b = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      b,
      XLSX.utils.aoa_to_sheet([
        header,
        ["示例商品", "示例客户", dateSerial, 10.5, 2.25, 8.25, "测试"],
      ]),
      "销售",
    );
    const bytes = XLSX.write(b, { type: "array", bookType: "xlsx" });
    const p = await readImport(new File([bytes], "sample.xlsx"));
    expect(p.rows[0].date).toBe("2026-05-26");
    expect(p.rows[0].revenue).toBe(1050);
    expect(p.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("reads UTF-8 CSV and protects exported spreadsheet formulas", async () => {
    const file = new File(
      [
        "\uFEFF商品名称,客户名称,日期,销售额,出资,纯利\r\n示例商品,✅示例客户,2026/05/26,0,10,-10",
      ],
      "sample.csv",
    );
    const p = await readImport(file);
    expect(p.issues).toHaveLength(0);
    expect(p.rows[0].customer).toBe("✅示例客户");
    const csv = exportCsv([
      {
        ...p.rows[0],
        id: "s",
        productName: "=danger()",
        customer: "+formula",
        note: "@test",
        revision: 1,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(csv).toContain("'=danger()");
    expect(csv).toContain("'+formula");
    expect(csv).toContain('"-10.00"');
  });
  it("rejects malformed backups and sanitizes extra fields", () => {
    expect(() => validateBackup({})).toThrow();
    const b = {
      format: "zhangyuge-sales",
      version: 1,
      exportedAt: "2026-01-01T00:00:00Z",
      products: [],
      sales: [],
    };
    expect(validateBackup({ ...b, uid: "fake" })).not.toHaveProperty("uid");
    expect(() => validateBackup({ ...b, exportedAt: "invalid" })).toThrow();
  });
});
