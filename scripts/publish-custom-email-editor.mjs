import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const mode = process.argv[2];
if (!["inspect", "deploy", "status"].includes(mode)) {
  throw new Error("Use inspect, deploy, or status");
}
const root = new URL("../", import.meta.url);
const { token } = JSON.parse(
  await readFile(new URL("../cli/.vercel-auth/auth.json", root), "utf8"),
);
const projectId = "prj_93tuds8WOpVtj4L0DrjKaNSpZOk0";
const expectedBaseline = "dpl_6htDGciHydV4hR3mH6mCuZMrS5vE";
const resultFile = new URL("./outputs/editable-verified-checkout-deployment.json", root);
async function request(path, options = {}) {
  const response = await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}slug=drak1`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) throw new Error(`Vercel HTTP ${response.status} at ${path.split("?")[0]}`);
  return response.json();
}
if (mode === "status") {
  const { id } = JSON.parse(await readFile(resultFile, "utf8"));
  const deployment = await request(`/v13/deployments/${id}`);
  console.log(JSON.stringify({ id, url: deployment.url, readyState: deployment.readyState, errorMessage: deployment.errorMessage }));
  process.exit(0);
}
const project = await request(`/v9/projects/${projectId}`);
if (project.name !== "easy-steps-quiz.lovable.app") throw new Error("Unexpected Vercel project");
const baseline = project.targets?.production?.id;
if (baseline !== expectedBaseline) throw new Error(`Production changed: ${baseline}; review before publishing`);
const tree = await request(`/v6/deployments/${baseline}/files`);
const source = tree.find((entry) => entry.type === "directory" && entry.name === "src");
if (!source?.children) throw new Error("Deployment source unavailable");
const files = [];
function walk(entries, parts = []) {
  for (const entry of entries) {
    if (!entry.name || /[\\/]/.test(entry.name) || [".", ".."].includes(entry.name)) throw new Error("Unsafe path");
    const path = [...parts, entry.name];
    if (entry.type === "directory") walk(entry.children ?? [], path);
    else if (entry.type === "file" && entry.uid) files.push({ file: path.join("/"), sha: entry.uid, size: entry.size });
  }
}
walk(source.children);
const targets = [
  "src/features/emails/notification-editor.tsx",
  "src/features/emails/notification-policy.ts",
  "src/features/emails/campaign-form.tsx",
  "src/features/emails/checkout-url-constraint.ts",
  "src/features/emails/actions.ts",
];
const changes = [];
for (const name of targets) {
  const item = files.find((file) => file.file === name);
  const bytes = await readFile(new URL(name, root));
  const sha = createHash("sha1").update(bytes).digest("hex");
  if (sha === item?.sha) continue;
  changes.push({ name, sha, size: bytes.length, bytes });
}
console.log(JSON.stringify({ baseline, changes: changes.map((change) => change.name), sourceFiles: files.length }));
if (mode === "inspect") process.exit(0);
if (changes.length === 0) throw new Error("No changes to deploy");
for (const change of changes) {
  await request("/v2/files", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-vercel-digest": change.sha, "Content-Length": String(change.size) },
    body: change.bytes,
  });
  const item = files.find((file) => file.file === change.name);
  if (item) Object.assign(item, { sha: change.sha, size: change.size });
  else files.push({ file: change.name, sha: change.sha, size: change.size });
}
const deployment = await request("/v13/deployments", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: project.name, project: projectId, target: "production", files }),
});
await writeFile(resultFile, JSON.stringify({ id: deployment.id, url: deployment.url, baseline, files: changes.map((change) => change.name) }, null, 2));
console.log(JSON.stringify({ id: deployment.id, url: deployment.url, readyState: deployment.readyState }));
