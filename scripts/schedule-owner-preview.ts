// 上线第 3 步：只读预演（不连云端、不写任何数据）。
// 用法（数据文件是管理员在网页「导出」得到的备份 JSON，放在本机私有目录，不进仓库）：
//   npx esbuild scripts/schedule-owner-preview.ts --bundle --platform=node --format=esm --outfile=/tmp/preview.mjs \
//     && node /tmp/preview.mjs <备份.json> --owner <OWNER_UID> [--members <members.json>] [--now 2026-11-13T00:00:00Z]
// 输出：同步条数（前/后）、撤下清单、第一轮对账会从手机删掉哪些、已有成员的补色计划。
import { readFile } from "node:fs/promises";
import { previewScheduleOwner } from "../server/schedule-owner-preview";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args[0];
const owner = opt("--owner");
if (!file || !owner) {
  console.error("用法：node preview.mjs <备份.json> --owner <OWNER_UID> [--members members.json] [--now ISO]");
  process.exit(2);
}
const backup = JSON.parse(await readFile(file, "utf8"));
const membersFile = opt("--members");
const members = membersFile ? JSON.parse(await readFile(membersFile, "utf8")) : [];
const out = await previewScheduleOwner({
  tasks: backup.tasks ?? [],
  customers: backup.customers ?? [],
  members: Array.isArray(members) ? members : members.members ?? [],
  ownerUid: owner,
  now: opt("--now") ?? new Date().toISOString(),
});
console.log(JSON.stringify(out, null, 2));
