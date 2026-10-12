import cloudbase from "@cloudbase/node-sdk";
import { createHash } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  const auth = await app.auth().getAuthContext(context);
  return handle(
    () => new CloudStore(app.database()),
    {
      uid: auth.uid || null,
      ownerUid: process.env.OWNER_UID || "",
      hash: async (value) => createHash("sha256").update(value).digest("hex"),
    },
    event,
  );
}
