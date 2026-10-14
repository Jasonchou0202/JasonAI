import { useState } from "react";
import type { Api, Customer, Product } from "../domain/model";
import {
  customerChoices,
  matchesCustomer,
  groupProducts,
} from "../domain/catalog";
import { displayCustomerName } from "../domain/customers";
import { useCustomerMutation, apiMode } from "../lib/customer-ui";
import { useQuery, ErrorNote, Loading } from "./ui";
type Cleanup = {
  customers: { id: string; name: string; blocked: boolean }[];
  products: { id: string; name: string; blocked: boolean }[];
};
type Deleted = { id: string; name: string; kind: "customer" | "product" };
export function CatalogSettings({
  api,
  version,
  onCustomer,
  onChange,
}: {
  api: Api;
  version: number;
  onCustomer: (id: string, month?: string) => void;
  onChange: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"customers" | "products">("customers");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const customerQuery = useQuery<Customer[]>(
    api,
    "customers.list",
    {},
    version + refresh,
  );
  const productQuery = useQuery<Product[]>(
    api,
    "products.catalog",
    {},
    version + refresh,
  );
  const preview = useQuery<Cleanup>(
    api,
    "catalog.cleanup.preview",
    {},
    version + refresh,
  );
  const deleted = useQuery<Deleted[]>(
    api,
    "catalog.deleted",
    {},
    version + refresh,
  );
  const mutation = useCustomerMutation(api, apiMode(api), "catalog-cleanup");
  const customers = customerChoices(customerQuery.data || []);
  const filtered = customers.filter((c) => matchesCustomer(c, search));
  const groups = groupProducts(
    (productQuery.data || []).filter((p) =>
      p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ),
  );
  const count =
    (preview.data?.customers.length || 0) +
    (preview.data?.products.length || 0);
  async function act(
    action: string,
    payload: Record<string, unknown>,
    msg: string,
  ) {
    if (await mutation.run(action, payload)) {
      setRefresh((v) => v + 1);
      onChange(msg);
    }
  }
  return (
    <>
      <section className="panel catalog-directory">
        <div className="panel-heading">
          <div>
            <h2>客户与商品清单</h2>
            <p>
              {customers.length} 位客户 · {productQuery.data?.length || 0}{" "}
              个商品名称，合并名称仅显示归属客户
            </p>
          </div>
        </div>
        <div className="customer-pad">
          <div className="segmented">
            <button
              aria-pressed={tab === "customers"}
              onClick={() => {
                setTab("customers");
                setSearch("");
              }}
            >
              所有客户
            </button>
            <button
              aria-pressed={tab === "products"}
              onClick={() => {
                setTab("products");
                setSearch("");
              }}
            >
              所有商品
            </button>
          </div>
          <input
            type="search"
            aria-label={tab === "customers" ? "搜索客户清单" : "搜索商品清单"}
            placeholder={
              tab === "customers" ? "搜索名字或合并前的别名" : "搜索商品名称"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(customerQuery.error || productQuery.error) && (
            <ErrorNote>{customerQuery.error || productQuery.error}</ErrorNote>
          )}
          {(customerQuery.loading || productQuery.loading) && <Loading />}
          {tab === "customers" ? (
            <ul className="catalog-list" aria-label="所有客户清单">
              {filtered.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>
                  <button
                    className="text-button"
                    onClick={() => onCustomer(c.id, "all")}
                  >
                    日程管理
                  </button>
                </li>
              ))}
              {!filtered.length && !customerQuery.loading && (
                <li>没有符合条件的客户</li>
              )}
            </ul>
          ) : (
            <div className="catalog-list" aria-label="所有商品清单">
              {groups.map((g) => (
                <section className="catalog-product-group" key={g.category}>
                  <h3>
                    {g.category}（{g.items.length}）
                  </h3>
                  <ul>
                    {g.items.map((p) => (
                      <li key={p.name}>
                        {p.name}
                        {!p.active && <small>已停用预设</small>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {!groups.length && !productQuery.loading && (
                <p>没有符合条件的商品</p>
              )}
            </div>
          )}
        </div>
      </section>
      <section className="panel catalog-cleanup">
        <div className="panel-heading">
          <div>
            <h2>清理验收资料</h2>
            <p>仅整理明确标记为虚构验收的客户和商品；删除后可以恢复。</p>
          </div>
        </div>
        <div className="customer-pad">
          {preview.error && <ErrorNote>{preview.error}</ErrorNote>}
          {mutation.error && <ErrorNote>{mutation.error}</ErrorNote>}
          {count > 0 ? (
            <>
              <p>
                待清理 {preview.data!.customers.length} 个验收客户、
                {preview.data!.products.length} 个验收商品。
              </p>
              <details>
                <summary>查看清理名单</summary>
                <ul>
                  {[...preview.data!.customers, ...preview.data!.products].map(
                    (c) => (
                      <li key={c.id}>
                        {displayCustomerName(c.name)}
                        {c.blocked
                          ? " · 仍关联有效销售或日程，暂不可清理"
                          : " · 无有效销售和日程"}
                      </li>
                    ),
                  )}
                </ul>
              </details>
              <button
                className="button secondary"
                disabled={
                  mutation.busy ||
                  mutation.hasPending ||
                  [...preview.data!.customers, ...preview.data!.products].some(
                    (c) => c.blocked,
                  )
                }
                onClick={() =>
                  void act(
                    "catalog.cleanup",
                    {},
                    "验收客户和商品已移出清单，可在已删除清单中恢复",
                  )
                }
              >
                清理验收客户与商品
              </button>
            </>
          ) : (
            !preview.loading && (
              <p className="subtle">没有需要清理的验收客户或商品。</p>
            )
          )}
          {mutation.hasPending && !mutation.busy && (
            <button
              className="button secondary"
              onClick={() => {
                const p = mutation.pending;
                if (p) void act(p.action, p.payload, "清单操作已确认");
              }}
            >
              重试上次清单操作
            </button>
          )}
          {!!deleted.data?.length && (
            <details>
              <summary>已删除清单（{deleted.data.length} 项）</summary>
              <ul className="catalog-list">
                {deleted.data.map((c) => (
                  <li key={c.kind + c.id}>
                    <span>
                      {c.kind === "customer" ? "客户" : "商品"} ·{" "}
                      {displayCustomerName(c.name)}
                    </span>
                    <button
                      className="text-button"
                      disabled={mutation.busy || mutation.hasPending}
                      onClick={() =>
                        void act(
                          "catalog.restore",
                          { id: c.id, kind: c.kind },
                          "清单资料已恢复",
                        )
                      }
                    >
                      恢复
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>
    </>
  );
}
