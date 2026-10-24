// 用法：node scripts/task-sync-title.mjs < tasks.json （输入 tasks.sync.list 返回的 tasks 数组）
// 不另写逻辑，直接复用 src/domain/taskSyncTitle.mjs 的唯一实现。
import { readFileSync } from "node:fs";
import { taskSyncTitle } from "../src/domain/taskSyncTitle.mjs";
const tasks = JSON.parse(readFileSync(0, "utf8"));
for (const t of tasks) console.log(JSON.stringify({ id: t.id, title: taskSyncTitle(t.customer, t.title) }));
