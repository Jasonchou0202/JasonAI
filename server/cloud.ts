import cloudbase from "@cloudbase/node-sdk";
import { createHash } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";
import { pushAction, pushConfigFromEnv } from "./push";
import { webPushSender } from "./reminder-cloud";

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  const auth = await app.auth().getAuthContext(context);
  const ownerContext = {
    uid: auth.uid || null,
    ownerUid: process.env.OWNER_UID || "",
    hash: async (value: string) => createHash("sha256").update(value).digest("hex"),
  };
  const pushConfig = pushConfigFromEnv();
  return handle(
    () => new CloudStore(app.database()),
    ownerContext,
    event,
    (code) => console.warn("sales request failed", code),
    (store, action, payload) => pushAction(store, ownerContext, action, payload, pushConfig, webPushSender(pushConfig)),
  );
}
