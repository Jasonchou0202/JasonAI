import { afterEach, describe, expect, it, vi } from "vitest";
import { checkReceiptFile, sizeLabel, uploadReceipts } from "../src/lib/receipt-upload";
import type { Api } from "../src/domain/model";

function fakeApi(ticket: boolean) {
  const calls: { action: string; payload: any }[] = [];
  const api: Api = {
    async call<T>(action: string, payload: any = {}) {
      calls.push({ action, payload });
      if (action === "expenses.receipts.prepare")
        return {
          items: payload.files.map((f: any, i: number) => ({
            type: f.name.endsWith(".pdf") ? "application/pdf" : "image/png",
            ticket: ticket ? { url: `https://cos.example/${i}`, headers: { authorization: "sig" }, fileID: `cloud://e/expenses/u/t${i}` } : null,
          })),
        } as T;
      if (action === "expenses.receipts.upload") return { fileID: "cloud://e/expenses/u/relay", type: "application/pdf", size: 9 } as T;
      throw new Error("unexpected " + action);
    },
  };
  return { api, calls };
}
const pdf = (size = 9, name = "发票.pdf") => new File([new Uint8Array(size).fill(37)], name, { type: "application/pdf" });

afterEach(() => vi.unstubAllGlobals());

describe("凭证上传（网页）", () => {
  it("本机先挡类型和大小", () => {
    expect(checkReceiptFile(pdf())).toBe(null);
    expect(checkReceiptFile(new File(["x"], "a.gif", { type: "image/gif" }))).toMatch(/不是 PDF 或图片/);
    expect(checkReceiptFile(new File(["x"], "IMG.HEIC", { type: "" }))).toBe(null);
    expect(checkReceiptFile(pdf(10 * 1024 * 1024 + 1))).toMatch(/10MB/);
    expect(sizeLabel(2048)).toBe("2 KB");
    expect(sizeLabel(3 * 1024 * 1024)).toBe("3.0 MB");
  });
  it("有签名就直传（PUT 到签名地址），不经云函数中转", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { api, calls } = fakeApi(true);
    const out = await uploadReceipts(api, [{ file: pdf(), kind: "invoice" }]);
    expect(out).toEqual([{ fileID: "cloud://e/expenses/u/t0", name: "发票.pdf", type: "application/pdf", size: 9, kind: "invoice" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://cos.example/0", expect.objectContaining({ method: "PUT" }));
    expect(calls.map((c) => c.action)).toEqual(["expenses.receipts.prepare"]);
  });
  it("直传失败（如跨域被拦）时，4MB 以内改走中转", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { api, calls } = fakeApi(true);
    const out = await uploadReceipts(api, [{ file: pdf(), kind: "payment" }]);
    expect(out[0]).toMatchObject({ fileID: "cloud://e/expenses/u/relay", kind: "payment" });
    const relay = calls.find((c) => c.action === "expenses.receipts.upload")!;
    expect(atob(relay.payload.data)).toBe("%".repeat(9));
  });
  it("没有签名且超过 4MB：提示压缩，不发中转请求", async () => {
    const { api, calls } = fakeApi(false);
    await expect(uploadReceipts(api, [{ file: pdf(4 * 1024 * 1024 + 1), kind: "invoice" }])).rejects.toThrow(/4MB/);
    expect(calls.map((c) => c.action)).toEqual(["expenses.receipts.prepare"]);
  });
});
