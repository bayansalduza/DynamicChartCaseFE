const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { main } = require("./request-deployment.cjs");

const sha = "a".repeat(40);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-request-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = join(dir, "image.tar.gz");
  writeFileSync(archive, "test-image");
  return {
    GITHUB_REPOSITORY: "owner/repo", GITHUB_SHA: sha, GITHUB_RUN_ID: "12",
    GITHUB_RUN_ATTEMPT: "1", GITHUB_REF: "refs/heads/master",
    GITHUB_EVENT_NAME: "push", DEPLOY_TARGET: "test-api", PRIMARY_BRANCH: "master",
    ARTIFACT_ID: "34", IMAGE_NAME: "test-api", IMAGE_ARCHIVE: archive
  };
}

test("production requests bind the artifact, commit, run and target", async t => {
  let payload;
  const api = async (path, method, body) => {
    if (path.includes("/git/ref/")) return { object: { sha } };
    if (method === "POST") { payload = body; return { id: 5 }; }
    return [{ state: "success" }];
  };
  await main(fixture(t), api);
  assert.equal(payload.ref, sha);
  assert.equal(payload.environment, "production-test-api");
  assert.equal(payload.auto_merge, false);
  assert.deepEqual(payload.required_contexts, []);
  assert.equal(payload.payload.artifact_id, 34);
  assert.equal(payload.payload.run_id, 12);
  assert.match(payload.payload.archive_sha256, /^[a-f0-9]{64}$/);
});

test("pull requests and non-primary branches cannot request deployment", async t => {
  for (const change of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF: "refs/heads/feature" }]) {
    await assert.rejects(main({ ...fixture(t), ...change }, () => assert.fail("API must not be called")));
  }
});

test("outdated commits never create a deployment", async t => {
  await main(fixture(t), async (path, method) => {
    assert.equal(method, undefined);
    return { object: { sha: "b".repeat(40) } };
  });
});

test("failed deployment fails the workflow", async t => {
  await assert.rejects(main(fixture(t), async (path, method) => {
    if (path.includes("/git/ref/")) return { object: { sha } };
    if (method === "POST") return { id: 5 };
    return [{ state: "failure" }];
  }), /Ubuntu deployment failed/);
});

test("offline Ubuntu times out instead of producing a false green workflow", async t => {
  let errorStatus;
  await assert.rejects(main(fixture(t), async (path, method, body) => {
    if (path.includes("/git/ref/")) return { object: { sha } };
    if (method === "POST" && path.endsWith("/deployments")) return { id: 5 };
    if (method === "POST") { errorStatus = body; return {}; }
    return [];
  }, async () => {}), /timed out/);
  assert.equal(errorStatus.state, "error");
});
