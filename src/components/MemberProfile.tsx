import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../domain/model";
import { MemberAvatar, useDirectory } from "../lib/members-ui";
import { AVATAR_ACCEPT, drawCrop, encodeAvatar, loadImage, type Crop } from "../lib/avatar-image";
import { ErrorNote, Modal, message } from "./ui";

/** ⑦ 顶栏「我是谁」：日程归属开时显示头像（可点开换头像），关时原样 */
export function MeBadge({ fallback, className, size = 32, onOpen }: { fallback: React.ReactNode; className: string; size?: number; onOpen?: () => void }) {
  const dir = useDirectory();
  if (!dir.on || !dir.meUid) return <span className={className}>{fallback}</span>;
  const inner = <MemberAvatar uid={dir.meUid} size={size} />;
  return dir.avatars && onOpen ? (
    <button type="button" className={`${className} m-me m-who`} aria-label={`我是${dir.name(dir.meUid)}，换头像`} title="换头像" onClick={onOpen}>
      {inner}
    </button>
  ) : (
    <span className={`${className} m-me`} title={dir.name(dir.meUid)}>
      {inner}
    </span>
  );
}

/** ⑥b 头像上传与裁剪：本人改自己的；Jason 可以替任何人换或清除 */
export function AvatarEditor({ api, uid, onClose }: { api: Api; uid: string; onClose: () => void }) {
  const dir = useDirectory();
  const [img, setImg] = useState<ImageBitmap | HTMLImageElement>();
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  useEffect(() => {
    if (img && canvas.current) drawCrop(canvas.current, img, crop, 320);
  }, [img, crop]);
  const self = uid === dir.meUid;
  const has = !!dir.person(uid)?.avatar;
  async function save() {
    if (!img) return;
    setBusy(true);
    setError("");
    try {
      const out = encodeAvatar(img, crop);
      await api.call("members.avatar.set", { ...(self ? {} : { uid }), image: out.dataUrl });
      dir.refresh();
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    setError("");
    try {
      await api.call("members.avatar.clear", self ? {} : { uid });
      dir.refresh();
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={self ? "我的头像" : `${dir.name(uid)}的头像`} onClose={onClose}>
      <div className="m-avatar-editor">
        <div className="m-preview">
          <MemberAvatar uid={uid} size={64} />
          <p className="subtle">
            {has ? "现在用的是上传的头像。" : "现在用的是默认头像（成员色底 + 姓氏）。"}
            <br />
            外面那圈颜色是{self ? "你" : dir.name(uid)}的固定成员色，换头像也不变。
          </p>
        </div>
        <label className="button secondary">
          选择图片
          <input
            type="file"
            accept={AVATAR_ACCEPT}
            hidden
            aria-label="选择头像图片"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setError("");
              try {
                setImg(await loadImage(f));
                setCrop({ zoom: 1, x: 0, y: 0 });
                setInfo(`原图 ${(f.size / 1024 / 1024).toFixed(1)}MB，会在本机裁成 128×128 小图再上传`);
              } catch (err) {
                setError(message(err));
              }
            }}
          />
        </label>
        <p className="subtle">支持 JPG、PNG、WebP、HEIC，原图不超过 10MB。请用头像或插画，不要用他人照片。</p>
        {img && (
          <>
            <canvas
              ref={canvas}
              aria-label="头像裁切预览，拖动调整位置"
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY, crop };
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const k = 2 / 160;
                setCrop({
                  ...d.crop,
                  x: Math.max(-1, Math.min(1, d.crop.x - (e.clientX - d.x) * k)),
                  y: Math.max(-1, Math.min(1, d.crop.y - (e.clientY - d.y) * k)),
                });
              }}
              onPointerUp={() => (drag.current = null)}
            />
            <label className="m-zoom">
              <span>缩放</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={crop.zoom}
                style={{ "--fill": `${((crop.zoom - 1) / 2) * 100}%` } as CSSProperties}
                aria-label="头像缩放"
                onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
              />
            </label>
            {info && <p className="subtle">{info}</p>}
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="team-row">
          <button className="button primary" disabled={!img || busy} onClick={() => void save()}>
            {busy ? "正在上传…" : "保存头像"}
          </button>
          {has && (
            <button className="text-button negative" disabled={busy} onClick={() => void clear()}>
              清除头像，恢复默认
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
