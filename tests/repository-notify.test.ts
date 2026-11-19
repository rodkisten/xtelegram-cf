import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRepositoryNotify, repositoryEvent, renderRepositoryTemplate } from "../src/lib/repository-notify.ts";

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
      "version: 1\nnotifications:\n  __proto__: test",
    ]) assert.throws(() => parseRepositoryNotify(source));
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
