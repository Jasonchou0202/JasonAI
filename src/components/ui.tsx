import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Inbox,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Api, Sale } from "../domain/model";
import { money } from "../domain/finance";
import { dateLabel } from "../domain/dates";
import { displayCustomerName } from "../domain/customers";
export function message(e: unknown) {
  const text = e instanceof Error ? e.message : "";
  if (/fetch|network|timeout|timed out/i.test(text))
    return "连接暂时失败，请稍后重试。未保存的草稿仍在本机。";
  return /[\u4e00-\u9fa5]/.test(text) ? text : "操作未完成，请稍后重试";
}
export function useQuery<T>(
  api: Api,
  action: string,
  payload: unknown,
  version = 0,
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const encoded = JSON.stringify(payload);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setData(undefined);
    api
      .call<T>(action, JSON.parse(encoded))
      .then((r) => {
        if (current) setData(r);
      })
      .catch((e) => {
        if (current) setError(message(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, action, encoded, version]);
  return { data, error, loading };
}
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="error-note" role="alert">
      <AlertCircle size={17} />
      <span>{children}</span>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> 正在读取账本…
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={34} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Money({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className={`money ${value < 0 ? "negative" : ""} ${className}`}>
      {money(value)}
    </span>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}octopus.svg`} alt="" />
      <div>
        <strong>章鱼哥</strong>
        <span>AI 工作室 · 生意手账</span>
      </div>
    </div>
  );
}
export function SaleRows({
  rows,
  onEdit,
}: {
  rows: Sale[];
  onEdit: (sale: Sale) => void;
}) {
  return (
    <div className="sale-rows">
      {rows.map((r, i) => (
        <button className="sale-row" key={r.id} onClick={() => onEdit(r)}>
          <span className={`product-mark tone-${i % 4}`}>
            {r.productName.slice(0, 1).toUpperCase()}
          </span>
          <span className="sale-info">
            <strong>{r.productName}</strong>
            <small>
              {displayCustomerName(r.customer) || "未填写客户"}
              <i>·</i>
              {dateLabel(r.date)}
            </small>
          </span>
          <span className="sale-profit">
            <Money value={r.revenue - r.cost} />
            <small>收入 ¥{money(r.revenue)}</small>
          </span>
          <ArrowUpRight size={16} className="row-arrow" />
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
