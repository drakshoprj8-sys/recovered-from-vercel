import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const mode = process.argv[2];
if (!["inspect", "deploy", "status", "alias"].includes(mode)) throw new Error("Use inspect, deploy, status or alias");
const root = new URL("../", import.meta.url);
const { token } = JSON.parse(await readFile(new URL("../cli/.vercel-auth/auth.json", root), "utf8"));
const projectId = "prj_93tuds8WOpVtj4L0DrjKaNSpZOk0";
const expectedBaseline = "dpl_8gUz5YBAmzZ7kZeV2nPvPKXxS7Ay";
const resultFile = new URL("outputs/all-customers-notice-deployment.json", root);
async function api(path, options = {}) {
  const response = await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}slug=drak1`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) throw new Error(`Vercel HTTP ${response.status} at ${path.split("?")[0]}`);
  return response.json();
}
if (mode === "status" || mode === "alias") {
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  const deployment = await api(`/v13/deployments/${result.id}`);
  if (mode === "alias") {
    if (deployment.readyState !== "READY" || deployment.projectId !== projectId) throw new Error("Deployment not ready or wrong project");
    const project = await api(`/v9/projects/${projectId}`);
    if (project.targets?.production?.id !== result.id) throw new Error("Production changed");
    const previous = await api(`/v13/deployments/${result.baseline}`);
    const aliases = [...new Set(["easy-steps-quizlovableapp-drak1.vercel.app", "suaempresacto.site", ...(previous.alias ?? [])])];
    for (const alias of aliases) {
      if (!/^(?:easy-steps-quizlovableapp-drak1\.vercel\.app|(?:www\.)?suaempresacto?\.site)$/.test(alias)) throw new Error(`Unexpected alias ${alias}`);
      await api(`/v2/deployments/${result.id}/aliases`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alias }),
      });
    }
    console.log(JSON.stringify({ deployment: result.id, aliases, status: "updated" }));
  } else console.log(JSON.stringify({ id: result.id, readyState: deployment.readyState, url: deployment.url, alias: deployment.alias, errorMessage: deployment.errorMessage }));
  process.exit(0);
}
const project = await api(`/v9/projects/${projectId}`);
if (project.name !== "easy-steps-quiz.lovable.app") throw new Error("Wrong project");
const baseline = project.targets?.production?.id;
if (baseline !== expectedBaseline) throw new Error(`Production changed: ${baseline}`);
const tree = await api(`/v6/deployments/${baseline}/files`);
const source = tree.find((entry) => entry.type === "directory" && entry.name === "src");
if (!source?.children) throw new Error("Source unavailable");
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
const targets = ["src/features/emails/store-notice.ts", "src/features/emails/store-notice-editor.tsx", "src/features/emails/campaign-form.tsx", "src/features/emails/actions.ts", "src/features/emails/campaigns.ts", "src/app/(painel)/emails/page.tsx"];
const changes = [];
await mkdir(new URL("outputs/all-customers-notice-baseline/", root), { recursive: true });
for (const name of targets) {
  const existing = files.find((file) => file.file === name);
  if (!existing && !name.includes("/store-notice")) throw new Error(`Missing ${name}`);
  const bytes = await readFile(new URL(name, root));
  const sha = createHash("sha1").update(bytes).digest("hex");
  if (sha === existing?.sha) continue;
  if (existing) {
    const original = await api(`/v8/deployments/${baseline}/files/${existing.sha}`);
    await writeFile(new URL(`outputs/all-customers-notice-baseline/${name.split("/").at(-1)}.txt`, root), Buffer.from(original.data, "base64"));
  }
  changes.push({ name, sha, size: bytes.length, bytes });
}
console.log(JSON.stringify({ baseline, changes: changes.map((change) => change.name), sourceFiles: files.length }));
if (mode === "inspect") process.exit(0);
if (changes.length !== 6) throw new Error("Expected six reviewed files");
for (const change of changes) {
  await api("/v2/files", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-vercel-digest": change.sha, "Content-Length": String(change.size) }, body: change.bytes });
  const existing = files.find((file) => file.file === change.name);
  if (existing) Object.assign(existing, { sha: change.sha, size: change.size });
  else files.push({ file: change.name, sha: change.sha, size: change.size });
}
const deployment = await api("/v13/deployments", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: project.name, project: projectId, target: "production", files }),
});
await writeFile(resultFile, JSON.stringify({ id: deployment.id, url: deployment.url, baseline, files: changes.map((change) => change.name) }, null, 2));
console.log(JSON.stringify({ id: deployment.id, url: deployment.url, readyState: deployment.readyState }));
