import { useState } from "react";
import type { Api } from "../domain/model";
import type { ReceiptKind } from "../domain/expenses";
import { RECEIPT_KIND_LABEL } from "../domain/expenses";
import { message } from "./ui";

interface Item {
  name: string;
  type: string;
  kind: ReceiptKind;
  size: number;
  url: string | null;
}

/** 点「查看」才经云函数换临时链接（2 小时有效），不提前拉取 */
export function ReceiptLinks({ api, id }: { api: Api; id: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.call<{ items: Item[] }>("expenses.receipts.urls", { id });
      setItems(r.items);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!items)
    return (
      <span className="exp-receipt-links">
        <button type="button" className="exp-receipt-view" onClick={() => void open()} disabled={busy}>
          {busy ? "打开中…" : "查看"}
        </button>
        {error && <small className="exp-receipt-error">{error}</small>}
      </span>
    );
  return (
    <span className="exp-receipt-links">
      {items.map((it, i) =>
        it.url ? (
          <a key={i} href={it.url} target="_blank" rel="noreferrer" title={it.name}>
            {RECEIPT_KIND_LABEL[it.kind]} {i + 1}
          </a>
        ) : (
          <small key={i} title={it.name}>{RECEIPT_KIND_LABEL[it.kind]} {i + 1} 暂时打不开</small>
        ),
      )}
    </span>
  );
}
