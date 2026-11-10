const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

async function archiveHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function githubApi(token) {
  return async (path, method = "GET", body) => {
    const response = await fetch("https://api.github.com" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error("GitHub API returned HTTP " + response.status);
    return response.json();
  };
}

async function main(env = process.env, api = githubApi(env.GH_TOKEN), sleep = delay) {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: attempt, DEPLOY_TARGET: target, PRIMARY_BRANCH: branch,
    ARTIFACT_ID: artifactId, IMAGE_NAME: image } = env;
  if (!/^[a-f0-9]{40}$/.test(sha || "") || !/^\d+$/.test(runId || "") ||
      !/^\d+$/.test(artifactId || "") || !/^[a-z0-9-]+$/.test(target || "") ||
      env.GITHUB_REF !== "refs/heads/" + branch ||
      !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error("Production deployment requires a trusted primary-branch run.");
  }
  const base = "/repos/" + repo;
  const head = await api(base + "/git/ref/heads/" + encodeURIComponent(branch));
  if (head.object.sha !== sha) {
    console.log("Skipped: a newer primary-branch revision exists.");
    return;
  }
  const checksum = await archiveHash(env.IMAGE_ARCHIVE || "image.tar.gz");
  const deployment = await api(base + "/deployments", "POST", {
    ref: sha,
    task: "deploy",
    auto_merge: false,
    required_contexts: [],
    environment: "production-" + target,
    production_environment: true,
    transient_environment: false,
    description: "HomeServer " + target + " " + sha.slice(0, 12),
    payload: {
      protocol: 1, target, image, sha, run_id: Number(runId),
      run_attempt: Number(attempt), artifact_id: Number(artifactId),
      archive_sha256: checksum
    }
  });
  console.log("Deployment request: https://github.com/" + repo + "/deployments");
  let lastState;
  for (let i = 0; i < 120; i++) {
    const statuses = await api(base + "/deployments/" + deployment.id + "/statuses?per_page=1");
    const state = statuses[0]?.state || "pending";
    if (state !== lastState) console.log("Deployment: " + state);
    lastState = state;
    if (state === "success") return;
    if (state === "inactive") {
      console.log("Skipped: deployment was superseded.");
      return;
    }
    if (["failure", "error"].includes(state)) {
      throw new Error("Ubuntu deployment failed. Check the deployment status and journalctl -u homeserver-cd.");
    }
    await sleep(10000);
  }
  await api(base + "/deployments/" + deployment.id + "/statuses", "POST", {
    state: "error", description: "Ubuntu did not confirm deployment within 20 minutes.",
    auto_inactive: false
  });
  throw new Error("Deployment confirmation timed out; the Ubuntu deployment service may be offline.");
}

module.exports = { archiveHash, githubApi, main };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
