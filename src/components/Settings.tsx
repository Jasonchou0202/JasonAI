import { useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Upload,
  Plus,
  Pencil,
  ShieldCheck,
  FileSpreadsheet,
  Archive,
  CheckCircle2,
} from "lucide-react";
import type {
  Api,
  Product,
  ImportPreview,
  Backup,
  Totals,
  Bucket,
  Sale,
} from "../domain/model";
import { money, moneyInput, parseMoney } from "../domain/finance";
import { useQuery, ErrorNote, Modal, message, Loading } from "./ui";
import { readImport, readBackup, download, downloadCsv } from "../lib/files";
import { PushSettings } from "./PushSettings";
import { CustomerAliases } from "./CustomerAliases";
type CommitResult = {
  count: number;
  repeated?: boolean;
  done?: boolean;
  processed?: number;
};
export function Settings({
  api,
  version,
  demo,
  onBack,
  onChange,
  onLogout,
}: {
  api: Api;
  version: number;
  demo: boolean;
  onBack: () => void;
  onChange: (s: string) => void;
  onLogout: () => void;
}) {
  const { data: products, error } = useQuery<Product[]>(
    api,
    "products.list",
    {},
    version,
  );
  const [product, setProduct] = useState<Product | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [opError, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  async function exportSales() {
    setBusy(true);
    setError("");
    try {
      downloadCsv(await api.call<Sale[]>("export"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function read(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setStatus("正在检查表格…");
    try {
      const p = await readImport(file);
      if (p.rows.length && !p.issues.some((i) => i.kind === "error")) {
        const result = await api.call<{
          duplicateRows: number[];
          totals: Totals;
          months: Bucket[];
        }>("import.preview", { rows: p.rows, digest: p.digest });
        p.duplicateRows = result.duplicateRows;
        p.totals = result.totals;
        p.months = result.months;
      }
      setPreview(p);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setStatus("");
      if (input.current) input.current.value = "";
    }
  }
  async function commit() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      let result: CommitResult;
      do {
        result = await api.call<CommitResult>("import.commit", {
          rows: preview.rows,
          digest: preview.digest,
          fileName: preview.fileName,
        });
        setStatus(
          `已处理 ${result.processed ?? result.count} / ${preview.rows.length} 条`,
        );
      } while (result.done === false);
      setPreview(null);
      onChange(
        result.repeated
          ? "此文件已经导入，未重复添加"
          : `已导入 ${result.count} 条销售记录`,
      );
    } catch (e) {
      setError(message(e) + "；可以重试，不会重复导入已处理的行。");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }
  async function exportBackup() {
    setBusy(true);
    setError("");
    try {
      const b = await api.call<Backup>("backup");
      download(
        `章鱼哥账本备份-${b.exportedAt.slice(0, 10)}.json`,
        JSON.stringify(b, null, 2),
      );
      onChange("备份已下载，请妥善保存");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!backup || busy) return;
    setBusy(true);
    setError("");
    try {
      let r: CommitResult;
      do {
        r = await api.call<CommitResult>("backup.restore", { backup });
        setStatus(
          `已恢复 ${r.processed ?? r.count} / ${backup.sales.length} 条`,
        );
      } while (r.done === false);
      setBackup(null);
      onChange(`已恢复 ${r.count} 条记录`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={15} />
            返回看板
          </button>
          <h1>账本设置</h1>
          <p className="subtle">常用商品、历史记录和备份，都在这里。</p>
        </div>
        <span className="privacy-label">
          <ShieldCheck size={15} />
          个人私密账本
        </span>
      </div>
      <PushSettings api={api} demo={demo} />
      <CustomerAliases api={api} version={version} onChange={onChange} />
      {(error || opError) && <ErrorNote>{error || opError}</ErrorNote>}
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>常用商品</h2>
            <p>设置常用售价和成本，记账时一键带出，也可以临时修改。</p>
          </div>
          <button
            className="button secondary"
            onClick={() =>
              setProduct({
                id: crypto.randomUUID(),
                name: "",
                price: 0,
                cost: 0,
                active: true,
                order: products?.length || 0,
              })
            }
          >
            <Plus size={16} />
            添加商品
          </button>
        </div>
        <div className="product-table">
          <div className="product-table-head">
            <span>商品</span>
            <span>常用售价</span>
            <span>常用成本</span>
            <span />
          </div>
          {products?.map((p) => (
            <div className="product-table-row" key={p.id}>
              <span>
                {p.name}
                {!p.active && <small>已停用</small>}
              </span>
              <strong>¥{money(p.price)}</strong>
              <span>¥{money(p.cost)}</span>
              <button
                className="icon-button"
                aria-label={`设置${p.name}`}
                onClick={() => setProduct(p)}
              >
                <Pencil size={16} />
              </button>
            </div>
          ))}
          {!products?.length && (
            <p className="subtle empty-products">
              还没有商品。添加后，记账会更快。
            </p>
          )}
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel settings-action">
          <div className="settings-icon">
            <FileSpreadsheet size={23} />
          </div>
          <h2>导入飞书历史记录</h2>
          <p>支持 CSV 和 Excel。先检查日期、金额及原利润，确认无误后再导入。</p>
          <button
            className="button secondary"
            disabled={demo || busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
            选择销售表格
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.xls"
            hidden
            onChange={(e) => void read(e.target.files?.[0])}
          />
          {demo && <small>连接云端后可导入真实数据</small>}
        </section>
        <section className="panel settings-action">
          <div className="settings-icon">
            <Archive size={23} />
          </div>
          <h2>保存一份完整备份</h2>
          <p>
            包含销售、商品、客户别名和日程（含回收站）。保存为 JSON 文件，可用于恢复空账本；设备推送授权需重新开启。
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void exportBackup()}
          >
            <Download size={16} />
            下载完整备份
          </button>
          <button
            className="text-button restore-link"
            disabled={demo || busy}
            onClick={() => restoreInput.current?.click()}
          >
            从备份恢复 →
          </button>
          <input
            ref={restoreInput}
            hidden
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void readBackup(file)
                  .then(setBackup)
                  .catch((e) => setError(message(e)));
              e.target.value = "";
            }}
          />
        </section>
      </div>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void exportSales()}
      >
        <Download size={16} />
        导出全部销售明细 CSV
      </button>
      <div className="panel settings-note">
        <ShieldCheck size={23} />
        <div>
          <strong>你的生意，只属于你</strong>
          <p>
            利润按销售额减成本计算；周一至周日为一周，日期使用北京时间。删除的记录可以恢复，云端账本只允许本人访问。
          </p>
        </div>
      </div>
      <div className="form-actions">
        <button className="button secondary" disabled={busy} onClick={onLogout}>
          {demo ? "退出演示" : "退出登录"}
        </button>
      </div>
      {product && (
        <ProductEditor
          product={product}
          api={api}
          onClose={() => setProduct(null)}
          onSaved={() => {
            setProduct(null);
            onChange("商品预设已保存");
          }}
        />
      )}
      {preview && (
        <Modal
          title="核对导入内容"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <p className="file-name">{preview.fileName}</p>
          <div className="import-totals">
            <span>
              有效记录<strong>{preview.rows.length} 条</strong>
            </span>
            <span>
              销售额<strong>¥{money(preview.totals.revenue)}</strong>
            </span>
            <span>
              成本<strong>¥{money(preview.totals.cost)}</strong>
            </span>
            <span>
              利润<strong>¥{money(preview.totals.profit)}</strong>
            </span>
          </div>
          {preview.issues.length > 0 && (
            <div className="import-issues">
              {preview.issues.map((i, n) => (
                <p key={n}>
                  第 {i.row} 行：{i.message}
                </p>
              ))}
            </div>
          )}
          {preview.duplicateRows.length > 0 && (
            <div className="warning-note">
              有 {preview.duplicateRows.length} 行与已有订单相似（原表行号：
              {preview.duplicateRows.slice(0, 20).join("、")}
              ）。确认后仍会保留这些订单，不自动删去同额成交。
            </div>
          )}
          <div className="import-months">
            {preview.months.map((m) => (
              <div key={m.key}>
                <span>
                  {m.label} · {m.count} 笔
                </span>
                <strong>利润 ¥{money(m.profit)}</strong>
              </div>
            ))}
          </div>
          {opError && <ErrorNote>{opError}</ErrorNote>}
          {status && <p role="status">{status}</p>}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={
                busy ||
                !preview.rows.length ||
                preview.issues.some((i) => i.kind === "error")
              }
              onClick={() => void commit()}
            >
              <CheckCircle2 size={17} />
              {busy ? "正在导入…" : "确认导入"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              取消
            </button>
          </div>
        </Modal>
      )}
      {backup && (
        <Modal
          title="恢复到空账本"
          onClose={() => {
            if (!busy) setBackup(null);
          }}
        >
          <p>
            这份备份包含 {backup.sales.length} 条销售记录和{" "}
            {backup.products.length} 个商品、{backup.version === 2 ? backup.customers.length : 0} 个客户档案和 {backup.version === 2 ? backup.tasks.length : 0} 条日程。
          </p>
          <p className="subtle">
            仅允许恢复到空账本，不覆盖已有销售；回收站记录也会一并恢复。
          </p>
          {opError && <ErrorNote>{opError}</ErrorNote>}
          {status && <p role="status">{status}</p>}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? "正在恢复…" : "确认恢复"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setBackup(null)}
            >
              取消
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ProductEditor({
  product,
  api,
  onClose,
  onSaved,
}: {
  product: Product;
  api: Api;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(moneyInput(product.price));
  const [cost, setCost] = useState(moneyInput(product.cost));
  const [active, setActive] = useState(product.active);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.call("products.save", {
        ...product,
        name,
        price: parseMoney(price),
        cost: parseMoney(cost),
        active,
      });
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="商品预设"
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
        <label htmlFor="p-name">商品名称</label>
        <input
          id="p-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
        />
        <div className="field-grid">
          <div>
            <label htmlFor="p-price">常用售价</label>
            <input
              id="p-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="p-cost">常用成本</label>
            <input
              id="p-cost"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
            />
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          在常用商品中展示
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="form-actions">
          <button className="button primary" disabled={busy} type="submit">
            {busy ? "正在保存…" : "保存商品"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
