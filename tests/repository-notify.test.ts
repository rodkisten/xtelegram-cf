import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRepositoryNotify, resolveRepositoryNotify, loadManageNotifyOverrides, shouldNotifyEvent, repositoryEvent, renderRepositoryTemplate } from "../src/lib/repository-notify.ts";

describe("repository notify.yml integration", () => {
  it("accepts Manage schema and partial nested settings", () => {
    const result = parseRepositoryNotify("version: 1\nnotifications:\n  events: [workflow_failure]\n  windowSeconds: 5\n  retentionMinutes:\n    error: 0\n  template: '❌ {{workflow}}'\n");
    assert.deepEqual(result.events, ["workflow_failure"]);
    assert.equal(result.retentionMinutes?.error, 0);
  });
  it("rejects duplicate, unknown, unsafe and invalid fields", () => {
    for (const source of [
      "version: 1\nnotifications:\n  template: a\n  template: b",
      "version: 2\nnotifications: {}",
      "version: 1\nnotifications:\n  events: [unexpected]",
      "version: 1\nnotifications:\n  retentionMinutes:\n    error: -1",
      "version: 1\nnotifications:\n  windowSeconds: '5'",
      "version: 1\nnotifications:\n  grouping: 5",
      "version: 1\nnotifications:\n  updateMode: 1",
      "version: 1\nnotifications:\n  __proto__: test",
    ]) assert.throws(() => parseRepositoryNotify(source));
  });
  it("resolves leaf conflicts exactly as Manage does", () => {
    const yaml = { retentionMinutes: { error: 60 }, events: ["workflow_failure"] };
    const entry = { overrides: { retentionMinutes: { error: 90, running: 10 } }, choices: { "retentionMinutes.error": "repository" as const } };
    const result = resolveRepositoryNotify(yaml, entry);
    assert.equal(result.retentionMinutes.error, 60);
    assert.equal(result.retentionMinutes.running, 10);
    assert.throws(() => resolveRepositoryNotify(yaml, { overrides: entry.overrides }));
    assert.equal(resolveRepositoryNotify(yaml, { ...entry, choices: { "retentionMinutes.error": "manage" } }).retentionMinutes.error, 90);
  });
  it("loads nested retention choices from the authenticated Manage variable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
      return new Response(JSON.stringify({
        value: JSON.stringify({
          "owner/repo": {
            overrides: { retentionMinutes: { error: 90 } },
            choices: { "retentionMinutes.error": "manage" },
          },
        }),
      }), { status: 200 });
    };
    try {
      const entry = await loadManageNotifyOverrides("owner/repo", "test-token");
      assert.equal(resolveRepositoryNotify({ retentionMinutes: { error: 60 } }, entry).retentionMinutes.error, 90);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("rejects unknown Manage conflict paths", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      value: JSON.stringify({ "owner/repo": { choices: { "retentionMinutesXerror": "manage" } } }),
    }), { status: 200 });
    try {
      await assert.rejects(loadManageNotifyOverrides("owner/repo", "test-token"), /Invalid conflict choices/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("rejects invalid repository names before any GitHub request", async () => {
    await assert.rejects(loadManageNotifyOverrides("../owner/repo", "test-token"), /Invalid repository/);
    await assert.rejects(loadManageNotifyOverrides("owner/repo/extra", "test-token"), /Invalid repository/);
    await assert.rejects(loadManageNotifyOverrides("owner/..", "test-token"), /Invalid repository/);
  });
  it("rejects null conflict choices rather than ignoring them", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      value: JSON.stringify({ "owner/repo": { choices: null } }),
    }), { status: 200 });
    try {
      await assert.rejects(loadManageNotifyOverrides("owner/repo", "test-token"), /Invalid conflict choices/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("preserves legacy behavior without an explicit events filter", () => {
    assert.equal(shouldNotifyEvent("completed", "success", {}), true);
    assert.equal(shouldNotifyEvent("requested", "", { template: "Custom" }), true);
  });
  it("honors an explicit empty events list", () => {
    assert.equal(shouldNotifyEvent("completed", "failure", { events: [] }), false);
    assert.equal(shouldNotifyEvent("completed", "success", { events: ["workflow_failure"] }), false);
    assert.equal(shouldNotifyEvent("completed", "failure", { events: ["workflow_failure"] }), true);
  });
  it("uses Manage conflict choices for event filters", () => {
    const yaml = { events: ["workflow_failure"] };
    const overrides = { events: ["workflow_success"] };
    assert.equal(shouldNotifyEvent("completed", "success", yaml, overrides, { events: "manage" }), true);
    assert.equal(shouldNotifyEvent("completed", "success", yaml, overrides, { events: "repository" }), false);
    assert.throws(() => shouldNotifyEvent("completed", "success", yaml, overrides));
  });
  it("maps workflow actions to supported notification events", () => {
    assert.equal(repositoryEvent("in_progress", ""), "workflow_started");
    assert.equal(repositoryEvent("completed", "failure"), "workflow_failure");
    assert.equal(repositoryEvent("completed", "success"), "workflow_success");
    assert.equal(repositoryEvent("completed", "cancelled"), null);
  });
  it("escapes webhook fields in HTML templates", () => {
    assert.equal(renderRepositoryTemplate("{{workflow}} <b>{{repository}}</b>", { workflow: "<script>", repository: "a&b" }), "&lt;script&gt; <b>a&amp;b</b>");
  });
});
