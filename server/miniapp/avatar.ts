/**
 * 小程序「我的」页设置本人微信头像：只写调用者自己的成员资料，uid 以绑定身份为准，不接受指定别人。
 * 图片校验复用 server/avatar.ts（JPEG/WebP、≤40KB、边长 ≤256）；上传走云函数侧存储，不改云存储安全规则。
 */
import { decodeAvatar, type AvatarRef, type AvatarStorage } from "../avatar";
import { OWNER_PROFILE_ID } from "../team";
import type { Member } from "../team";
import type { MiniStore } from "./types";

export class MiniappAvatarError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function setOwnAvatar(
  store: MiniStore,
  opts: {
    uid: string;
    ownerUid: string;
    role: "owner" | "member";
    storage: AvatarStorage;
    hash: (text: string) => Promise<string>;
    now: () => string;
    image: unknown;
  },
): Promise<{ avatarUrl: string }> {
  if (!opts.storage) throw new MiniappAvatarError("AVATAR_STORAGE_OFF", "头像存储暂不可用");
  const { bytes, type } = decodeAvatar(opts.image);
  const isOwner = opts.role === "owner" || opts.uid === opts.ownerUid;
  const docId = isOwner ? OWNER_PROFILE_ID : opts.uid;
  if (!isOwner) {
    const m = await store.get<Member>("members", opts.uid);
    if (!m || m.status !== "active") throw new MiniappAvatarError("NO_ACCESS", "无权限");
  }
  const time = opts.now();
  const hash = (await opts.hash("avatar:" + String(opts.image))).slice(0, 16);
  const ext = type === "webp" ? "webp" : "jpg";
  const fileID = await opts.storage.upload(`avatars/${isOwner ? "_owner" : opts.uid}/${hash}.${ext}`, bytes);
  const ref: AvatarRef = { fileID, hash, bytes: bytes.length, type, updatedAt: time, updatedBy: opts.uid };
  let oldId: string | undefined;
  try {
    await store.transaction(async (tx) => {
      const prev = await tx.get<Partial<Member> & { avatar?: AvatarRef }>("members", docId);
      if (!isOwner && !prev) throw new MiniappAvatarError("NO_ACCESS", "无权限");
      oldId = prev?.avatar?.fileID;
      const { avatar: _old, ...rest } = prev ?? { uid: OWNER_PROFILE_ID };
      const next: Record<string, unknown> = {
        ...rest,
        avatar: ref,
        ...(isOwner ? { updatedAt: time } : { updatedAt: time, revision: ((prev as Member)?.revision ?? 0) + 1 }),
      };
      await tx.put("members", docId, next);
    });
  } catch (error) {
    await opts.storage.remove(fileID).catch(() => undefined);
    throw error;
  }
  if (oldId && oldId !== fileID) await opts.storage.remove(oldId).catch(() => undefined);
  const urls = await opts.storage.tempUrls([fileID]);
  const avatarUrl = urls.get(fileID) || "";
  if (!avatarUrl) throw new MiniappAvatarError("AVATAR_URL_FAILED", "头像已保存，但暂时无法显示，请稍后重新打开");
  return { avatarUrl };
}

export async function avatarUrlOf(
  store: MiniStore,
  storage: AvatarStorage | undefined,
  role: string,
  uid: string,
  ownerUid: string,
): Promise<string> {
  if (!storage) return "";
  const docId = role === "owner" || uid === ownerUid ? OWNER_PROFILE_ID : uid;
  const row = await store.get<{ avatar?: AvatarRef }>("members", docId);
  const fileID = row?.avatar?.fileID;
  if (!fileID) return "";
  try {
    const urls = await storage.tempUrls([fileID]);
    return urls.get(fileID) || "";
  } catch {
    return "";
  }
}
