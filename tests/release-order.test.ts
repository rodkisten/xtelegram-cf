import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
const releaseWorkflow = readFileSync(".github/workflows/relay-deploy.yml", "utf8");
const ciWorkflow = readFileSync(".github/workflows/rodx-ci.yml", "utf8");

describe("Relay migration ordering", () => {
  it("migrates remote D1 before building and publishing a release", () => {
    assert.equal(scripts["build:release"], "npm run db:migrate:remote && npm run build");
    assert.equal(scripts.deploy, "npm run build:release && wrangler deploy");
    assert.match(scripts["db:migrate:remote"], /d1 migrations apply RELAY_DB --remote/);
  });

  it("keeps the PR build dry-run free of remote D1 mutations", () => {
    assert.equal(scripts.build, "wrangler deploy --dry-run");
    assert.doesNotMatch(ciWorkflow, /db:migrate:remote/);
    assert.ok(ciWorkflow.indexOf("npm run db:migrate:local") < ciWorkflow.indexOf("npm run build"));
  });

  it("migrates D1 before remote release build and never on PR runs", () => {
    const migration = releaseWorkflow.indexOf("run: npm run db:migrate:remote");
    const build = releaseWorkflow.indexOf("run: npm run build");
    const deploy = releaseWorkflow.indexOf("run: npx wrangler deploy");
    assert.ok(migration > 0 && migration < build && build < deploy);
    assert.ok(releaseWorkflow.includes("github.ref == 'refs/heads/main'"));
    assert.ok(releaseWorkflow.includes("RELAY_AUTO_DEPLOY"));
  });
});
