import { useEffect, useState } from "react";
import type { Api, Product } from "../domain/model";
import { moneyInput, parseMoney } from "../domain/finance";
import { productCategories, productCategory } from "../domain/catalog";
import {
  apiMode,
  readLocal,
  writeLocal,
  removeLocal,
} from "../lib/customer-ui";
import { Modal, ErrorNote, message } from "./ui";

type Draft = {
  id: string;
  requestId: string;
  name: string;
  category: string;
  manualCategory: boolean;
  price: string;
  cost: string;
  active: boolean;
  pending?: Product;
};
export function ProductEditor({
  product,
  api,
  onClose,
  onSaved,
}: {
  product?: Product;
  api: Api;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const creating = !product;
  const key = `zhangyuge-product-draft-${apiMode(api)}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = creating ? readLocal<Draft>(key) : undefined;
    return (
      saved ?? {
        id: product?.id ?? crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        name: product?.name ?? "",
        category: product?.category ?? productCategory(product?.name ?? ""),
        manualCategory: Boolean(product?.category),
        price:
          product && product.hasDefaultPrice !== false
            ? moneyInput(product.price)
            : "",
        cost:
          product && product.hasDefaultCost !== false
            ? moneyInput(product.cost)
            : "",
        active: product?.active ?? true,
      }
    );
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (creating)
      try {
        writeLocal(key, draft);
      } catch (e) {
        setError(message(e));
      }
  }, [draft, key, creating]);
  function changeName(name: string) {
    setDraft((d) => ({
      ...d,
      name,
      category: d.manualCategory ? d.category : productCategory(name),
    }));
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const candidate = draft.pending ?? {
        ...product,
        id: draft.id,
        name: draft.name.trim(),
        category: draft.category,
        price: draft.price.trim() ? parseMoney(draft.price) : 0,
        cost: draft.cost.trim() ? parseMoney(draft.cost) : 0,
        hasDefaultPrice: Boolean(draft.price.trim()),
        hasDefaultCost: Boolean(draft.cost.trim()),
        active: draft.active,
        order: product?.order ?? 0,
      };
      if (!candidate.name) throw new Error("请填写商品名称");
      let saved: Product;
      if (creating) {
        const next = { ...draft, pending: candidate };
        writeLocal(key, next);
        setDraft(next);
        const result = await api.call<{ product: Product; reused: boolean }>(
          "products.create",
          {
            product: candidate,
            requestId: draft.requestId,
          },
        );
        saved = result.product;
        removeLocal(key);
      } else saved = await api.call<Product>("products.save", candidate);
      onSaved(saved);
    } catch (e) {
      const text = message(e);
      if (
        /同名商品已|商品编号已|商品类目无效|商品资料无效|商品金额无效/.test(
          text,
        )
      ) {
        setDraft((d) => {
          const { pending, ...rest } = d;
          return { ...rest, requestId: crypto.randomUUID() };
        });
      }
      setError(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={creating ? "增加商品" : "商品预设"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={busy || Boolean(draft.pending)}
          className="product-editor-fields"
        >
          <label htmlFor="p-name">商品名称</label>
          <input
            id="p-name"
            value={draft.name}
            onChange={(e) => changeName(e.target.value)}
            required
            maxLength={200}
          />
          <label htmlFor="p-category">商品类目</label>
          <select
            id="p-category"
            value={draft.category}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                category: e.target.value,
                manualCategory: true,
              }))
            }
          >
            {productCategories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <div className="field-grid">
            <div>
              <label htmlFor="p-price">常用售价（选填）</label>
              <input
                id="p-price"
                inputMode="decimal"
                placeholder="未填则记账时输入"
                value={draft.price}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, price: e.target.value }))
                }
              />
            </div>
            <div>
              <label htmlFor="p-cost">常用成本（选填）</label>
              <input
                id="p-cost"
                inputMode="decimal"
                placeholder="未填则记账时输入"
                value={draft.cost}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, cost: e.target.value }))
                }
              />
            </div>
          </div>
          {!creating && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, active: e.target.checked }))
                }
              />
              在常用商品中展示
            </label>
          )}
        </fieldset>
        {error && <ErrorNote>{error}</ErrorNote>}
        {draft.pending && !busy && (
          <p className="subtle">
            上次保存结果尚未确认，重试会核对同一次提交，不会重复增加商品。
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "正在保存…" : draft.pending ? "重试保存商品" : "保存商品"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
