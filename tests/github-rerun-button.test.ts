import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGithubWorkflowRun } from "../src/lib/github-notifications";

const payload = (conclusion: string) => ({
  action: "completed",
  repository: { full_name: "rodkisten/example", html_url: "https://github.com/rodkisten/example" },
  workflow_run: {
    id: 12345, name: "CI", conclusion, head_branch: "main",
    html_url: "https://github.com/rodkisten/example/actions/runs/12345",
  },
});

describe("GitHub workflow rerun button", () => {
  it("shows callback only for failed runs", () => {
    const message = formatGithubWorkflowRun(payload("failure"));
    assert.deepEqual(message?.buttons[0], [{
      text: "🔄 Executar novamente", callback_data: "ghrerun:12345",
    }]);
  });
  it("does not show rerun for successful runs", () => {
    const message = formatGithubWorkflowRun(payload("success"));
    assert.equal(message?.buttons.flat().some(button => button.callback_data), false);
  });
  it("shows rerun for timed out runs", () => {
    const message = formatGithubWorkflowRun(payload("timed_out"));
    assert.equal(message?.buttons[0]?.[0]?.callback_data, "ghrerun:12345");
  });
});
