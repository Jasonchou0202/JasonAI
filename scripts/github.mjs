// Optional REST fallback when Git HTTPS transport is unavailable. Never prints credentials.
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const repository = "Jasonchou0202/JasonAI";
const mode = process.argv[2] || "inspect";
const credential = spawnSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  timeout: 15000,
});
const token = credential.stdout
  ?.split(/\r?\n/)
  .find((s) => s.startsWith("password="))
  ?.slice(9);
if (!token) throw new Error("需要本机已有 GitHub 登录；未获取凭据，不执行发布");
async function api(path, method = "GET", body, allow404 = false) {
  const response = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "User-Agent": "zhangyuge-sales-deployer",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (allow404 && [404, 409].includes(response.status)) return null;
  if (!response.ok)
    throw new Error(
      "GitHub API " + method + " " + path + " 返回 " + response.status,
    );
  return response.status === 204 ? {} : response.json();
}
const user = await api("/user");
if (user.login !== "Jasonchou0202")
  throw new Error("当前 GitHub 身份与指定仓库所有者不符，不执行发布");
const root = "/repos/" + repository;
const repo = await api(root);
if (!repo.permissions?.push) throw new Error("当前账号没有该仓库写权限");
if (mode === "inspect")
  console.log(
    JSON.stringify({
      login: user.login,
      repository: repo.full_name,
      push: repo.permissions.push,
      admin: repo.permissions.admin,
      pages: repo.has_pages,
    }),
  );
else if (mode === "publish") {
  const listed = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (listed.status !== 0) throw new Error("无法读取本地 Git 文件清单");
  const paths = listed.stdout.split("\0").filter(Boolean);
  if (
    paths.some(
      (p) =>
        /^(private-data|backups|artifacts|node_modules|dist)\//.test(p) ||
        (/^\.env/.test(p) && p !== ".env.example") ||
        /\.(xlsx|csv|log)$/.test(p) ||
        p === "cloudbaserc.json",
    )
  )
    throw new Error("发现不应发布的文件，已停止");
  let ref = await api(root + "/git/ref/heads/main", "GET", undefined, true);
  if (!ref) {
    await api(root + "/contents/README.md", "PUT", {
      message: "Initialize sales system",
      content: (await readFile("README.md")).toString("base64"),
      branch: "main",
    });
    ref = await api(root + "/git/ref/heads/main");
  }
  const parent = await api(root + "/git/commits/" + ref.object.sha);
  const tree = [];
  for (let i = 0; i < paths.length; i += 4) {
    tree.push(
      ...(await Promise.all(
        paths.slice(i, i + 4).map(async (path) => {
          const blob = await api(root + "/git/blobs", "POST", {
            content: (await readFile(path)).toString("base64"),
            encoding: "base64",
          });
          return { path, mode: "100644", type: "blob", sha: blob.sha };
        }),
      )),
    );
  }
  const next = await api(root + "/git/trees", "POST", {
    base_tree: parent.tree.sha,
    tree,
  });
  const commit = await api(root + "/git/commits", "POST", {
    message:
      "Implement private sales journal, profit dashboard and CloudBase backend",
    tree: next.sha,
    parents: [parent.sha],
  });
  await api(root + "/git/refs/heads/main", "PATCH", {
    sha: commit.sha,
    force: false,
  });
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/github-published.json",
    JSON.stringify(
      { repository, sha: commit.sha, tree: next.sha, files: paths.length },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      published: commit.sha,
      files: paths.length,
      url: "https://github.com/" + repository,
    }),
  );
} else if (mode === "pages") {
  const current = await api(root + "/pages", "GET", undefined, true);
  const pages = await api(root + "/pages", current ? "PUT" : "POST", {
    build_type: "workflow",
  });
  console.log(
    JSON.stringify({
      pages: pages.html_url || "https://jasonchou0202.github.io/JasonAI/",
    }),
  );
} else if (mode === "run") {
  await api(root + "/actions/workflows/pages.yml/dispatches", "POST", {
    ref: "main",
  });
  console.log("Pages 工作流已启动");
} else if (mode === "status") {
  const runs = await api(root + "/actions/workflows/pages.yml/runs?per_page=3");
  console.log(
    JSON.stringify(
      runs.workflow_runs.map((r) => ({
        id: r.id,
        sha: r.head_sha,
        status: r.status,
        conclusion: r.conclusion,
        url: r.html_url,
      })),
      null,
      2,
    ),
  );
} else throw new Error("不支持的命令");
