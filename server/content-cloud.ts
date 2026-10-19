import cloudbase from "@cloudbase/node-sdk";
import { createHash } from "node:crypto";
import { ContentCloudStore } from "./content/cloud-store";
import { contentOnly } from "./content/guard";
import { handleContent } from "./content/handler";

/** content 云函数入口：只处理内容获客数据，和 sales 函数完全分开 */
export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  const auth = await app.auth().getAuthContext(context);
  return handleContent(
    () => contentOnly(new ContentCloudStore(app.database())),
    {
      uid: auth.uid || null,
      ownerUid: process.env.OWNER_UID || "",
      hash: async (value: string) =>
        createHash("sha256").update(value).digest("hex"),
    },
    event,
    (code) => console.warn("content request failed", code),
  );
}
