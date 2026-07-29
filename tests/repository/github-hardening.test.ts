import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  buildMainRuleset,
  buildRepositoryPatch,
  buildSecurityPatch,
  configureGitHub,
  createGhRequester,
} from "../../scripts/lib/github-hardening.mjs";
import { describe, expect, it, vi } from "vitest";

const EXPECTED_REPO = "UtenKekkoDev/dom-native-pptx";
const GITHUB_ACTIONS_INTEGRATION_ID = 15368;

function apiFailure(
  statusCode: number,
  responseMessage: string,
  documentationUrl = "https://docs.github.com/rest/repos/repos#update-a-repository",
) {
  return Object.assign(new Error("sensitive raw error"), {
    statusCode,
    responseMessage,
    documentationUrl,
  });
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    full_name: EXPECTED_REPO,
    owner: { login: "UtenKekkoDev" },
    visibility: "public",
    private: false,
    default_branch: "main",
    ...overrides,
  };
}

describe("GitHub hardening payloads", () => {
  it("protects main from destructive pushes and requires every matrix check", () => {
    expect(buildMainRuleset()).toEqual({
      name: "protect-main",
      target: "branch",
      enforcement: "active",
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: [] },
      },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: true,
          },
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            do_not_enforce_on_create: true,
            required_status_checks: [
              {
                context: "build-and-test (windows-latest)",
                integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
              },
              {
                context: "build-and-test (ubuntu-latest)",
                integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
              },
              {
                context: "build-and-test (macos-latest)",
                integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
              },
            ],
          },
        },
      ],
    });
  });

  it("keeps topics out of the repository PATCH payload", () => {
    expect(buildRepositoryPatch()).toEqual({
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    });
  });

  it("builds pagination-safe gh arguments for collection endpoints", async () => {
    const module = await import("../../scripts/lib/github-hardening.mjs");
    expect(module.buildGhArguments).toBeTypeOf("function");
    expect(
      module.buildGhArguments({
        method: "GET",
        endpoint: `/repos/${EXPECTED_REPO}/rulesets`,
        paginate: true,
      }),
    ).toEqual([
      "api",
      "--method",
      "GET",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28",
      `/repos/${EXPECTED_REPO}/rulesets`,
      "--paginate",
      "--slurp",
    ]);
  });

  it("parses structured gh failure metadata without making it public output", async () => {
    const module = await import("../../scripts/lib/github-hardening.mjs");
    expect(module.parseGhFailure).toBeTypeOf("function");
    expect(
      module.parseGhFailure(
        "gh: Secret scanning is not available for this repository. (HTTP 422)\n",
      ),
    ).toEqual({
      statusCode: 422,
      responseMessage: "Secret scanning is not available for this repository.",
      documentationUrl: undefined,
    });
  });

  it("requests secret scanning and push protection as optional security features", () => {
    expect(buildSecurityPatch()).toEqual({
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "enabled" },
      },
    });
  });
});

describe("GitHub hardening execution", () => {
  it("produces a deterministic dry run without consulting or mutating GitHub", async () => {
    const request = vi.fn();

    const first = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: false,
      request,
    });
    const second = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: false,
      request,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      mode: "dry-run",
      repo: EXPECTED_REPO,
      mutationsApplied: false,
    });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toMatch(/token|authorization|cookie/iu);
  });

  it("rejects every repository except the release target before any API call", async () => {
    const request = vi.fn();

    await expect(
      configureGitHub({
        repo: "UtenKekkoDev/another-repository",
        apply: true,
        request,
      }),
    ).rejects.toMatchObject({ code: "UNEXPECTED_REPOSITORY" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["authenticated owner", { user: { login: "someone-else" } }],
    ["repository identity", { repo: repository({ full_name: "other/repo" }) }],
    [
      "public visibility",
      { repo: repository({ visibility: "private", private: true }) },
    ],
    [
      "main default branch",
      { repo: repository({ default_branch: "develop" }) },
    ],
  ])("verifies %s before the first mutation", async (_name, overrides) => {
    const calls: Array<{ method: string; endpoint: string }> = [];
    const request = vi.fn(async ({ method, endpoint }) => {
      calls.push({ method, endpoint });
      if (endpoint === "/user") {
        return overrides.user ?? { login: "UtenKekkoDev" };
      }
      if (endpoint === `/repos/${EXPECTED_REPO}`) {
        return overrides.repo ?? repository();
      }
      throw new Error(`unexpected request ${method} ${endpoint}`);
    });

    await expect(
      configureGitHub({ repo: EXPECTED_REPO, apply: true, request }),
    ).rejects.toMatchObject({ code: "REPOSITORY_VERIFICATION_FAILED" });
    expect(calls.every(({ method }) => method === "GET")).toBe(true);
    expect(calls.map(({ endpoint }) => endpoint)).not.toContain(
      `/repos/${EXPECTED_REPO}/rulesets`,
    );
  });

  it("updates the named ruleset and applies idempotent repository security settings", async () => {
    const calls: Array<{
      method: string;
      endpoint: string;
      body?: unknown;
    }> = [];
    const request = vi.fn(async (call) => {
      calls.push(call);
      if (call.endpoint === "/user") return { login: "UtenKekkoDev" };
      if (call.endpoint === `/repos/${EXPECTED_REPO}` && call.method === "GET")
        return repository();
      if (call.endpoint === `/repos/${EXPECTED_REPO}/rulesets`) {
        return [{ id: 42, name: "protect-main", target: "branch" }];
      }
      return {};
    });

    const result = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: true,
      request,
    });

    expect(result).toMatchObject({
      mode: "apply",
      repo: EXPECTED_REPO,
      mutationsApplied: true,
      ruleset: { action: "updated", id: 42 },
      optionalFeatures: {
        secretScanning: { status: "configured" },
      },
    });
    expect(
      calls.slice(0, 3).map(({ method, endpoint }) => [method, endpoint]),
    ).toEqual([
      ["GET", "/user"],
      ["GET", `/repos/${EXPECTED_REPO}`],
      ["GET", `/repos/${EXPECTED_REPO}/rulesets`],
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          method: "PATCH",
          endpoint: `/repos/${EXPECTED_REPO}`,
          body: buildRepositoryPatch(),
        },
        {
          method: "PUT",
          endpoint: `/repos/${EXPECTED_REPO}/topics`,
          body: {
            names: [
              "powerpoint",
              "pptx",
              "html-to-pptx",
              "editable-slides",
              "agent-skill",
            ],
          },
        },
        {
          method: "PUT",
          endpoint: `/repos/${EXPECTED_REPO}/vulnerability-alerts`,
        },
        {
          method: "PUT",
          endpoint: `/repos/${EXPECTED_REPO}/automated-security-fixes`,
        },
        {
          method: "PUT",
          endpoint: `/repos/${EXPECTED_REPO}/private-vulnerability-reporting`,
        },
        {
          method: "PATCH",
          endpoint: `/repos/${EXPECTED_REPO}`,
          body: buildSecurityPatch(),
        },
        {
          method: "PUT",
          endpoint: `/repos/${EXPECTED_REPO}/rulesets/42`,
          body: buildMainRuleset(),
        },
      ]),
    );
    expect(
      calls.some(
        ({ method, endpoint }) =>
          method === "POST" && endpoint.endsWith("/rulesets"),
      ),
    ).toBe(false);
    expect(calls).not.toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ topics: expect.anything() }),
      }),
    );
  });

  it("finds the named ruleset on a later paginated response page", async () => {
    const calls: Array<{
      method: string;
      endpoint: string;
      body?: unknown;
      paginate?: boolean;
    }> = [];
    const request = vi.fn(async (call) => {
      calls.push(call);
      if (call.endpoint === "/user") return { login: "UtenKekkoDev" };
      if (call.endpoint === `/repos/${EXPECTED_REPO}` && call.method === "GET")
        return repository();
      if (call.endpoint.endsWith("/rulesets") && call.method === "GET") {
        return [
          [{ id: 7, name: "another-rule", target: "branch" }],
          [{ id: 42, name: "protect-main", target: "branch" }],
        ];
      }
      return {};
    });

    const result = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: true,
      request,
    });

    expect(calls[2]).toEqual({
      method: "GET",
      endpoint: `/repos/${EXPECTED_REPO}/rulesets`,
      paginate: true,
    });
    expect(result.ruleset).toEqual({ action: "updated", id: 42 });
    expect(calls).toContainEqual({
      method: "PUT",
      endpoint: `/repos/${EXPECTED_REPO}/rulesets/42`,
      body: buildMainRuleset(),
    });
  });

  it("creates the named ruleset when it does not exist", async () => {
    const calls: Array<{ method: string; endpoint: string; body?: unknown }> =
      [];
    const request = vi.fn(async (call) => {
      calls.push(call);
      if (call.endpoint === "/user") return { login: "UtenKekkoDev" };
      if (call.endpoint === `/repos/${EXPECTED_REPO}`) return repository();
      if (
        call.method === "GET" &&
        call.endpoint === `/repos/${EXPECTED_REPO}/rulesets`
      ) {
        return [];
      }
      if (call.method === "POST" && call.endpoint.endsWith("/rulesets")) {
        return { id: 77 };
      }
      return {};
    });

    const result = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: true,
      request,
    });

    expect(result.ruleset).toEqual({ action: "created", id: 77 });
    expect(calls).toContainEqual({
      method: "POST",
      endpoint: `/repos/${EXPECTED_REPO}/rulesets`,
      body: buildMainRuleset(),
    });
  });

  it("reports only an explicit secret-scanning capability response as unsupported", async () => {
    const calls: Array<{ method: string; endpoint: string; body?: unknown }> =
      [];
    const request = vi.fn(async (call) => {
      calls.push(call);
      if (call.endpoint === "/user") return { login: "UtenKekkoDev" };
      if (
        call.endpoint === `/repos/${EXPECTED_REPO}` &&
        call.method === "GET"
      ) {
        return repository();
      }
      if (call.endpoint.endsWith("/rulesets") && call.method === "GET")
        return [];
      if (
        call.endpoint === `/repos/${EXPECTED_REPO}` &&
        call.method === "PATCH" &&
        "security_and_analysis" in (call.body ?? {})
      ) {
        throw apiFailure(
          422,
          "Secret scanning is not available for this repository.",
        );
      }
      if (call.method === "POST" && call.endpoint.endsWith("/rulesets")) {
        return { id: 90 };
      }
      return {};
    });

    const result = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: true,
      request,
    });

    expect(result.optionalFeatures.secretScanning).toEqual({
      status: "unsupported",
      reason:
        "GitHub explicitly reported secret scanning is unavailable for this repository",
    });
    expect(JSON.stringify(result)).not.toContain("sensitive raw error");
    expect(result.ruleset).toEqual({ action: "created", id: 90 });
  });

  it.each([
    [403, "API rate limit exceeded", undefined],
    [403, "Resource not accessible by personal access token", undefined],
    [404, "Not Found", undefined],
    [422, "Validation Failed", undefined],
    [
      422,
      "Secret scanning is not available for this repository.",
      "https://example.invalid/not-a-github-capability-source",
    ],
  ])(
    "fails closed for optional security API error %i: %s",
    async (statusCode, responseMessage, documentationUrl) => {
      const request = vi.fn(async (call) => {
        if (call.endpoint === "/user") return { login: "UtenKekkoDev" };
        if (
          call.endpoint === `/repos/${EXPECTED_REPO}` &&
          call.method === "GET"
        ) {
          return repository();
        }
        if (call.endpoint.endsWith("/rulesets") && call.method === "GET") {
          return [];
        }
        if (
          call.endpoint === `/repos/${EXPECTED_REPO}` &&
          call.method === "PATCH" &&
          "security_and_analysis" in (call.body ?? {})
        ) {
          throw apiFailure(
            statusCode,
            responseMessage,
            documentationUrl ??
              "https://docs.github.com/rest/repos/repos#update-a-repository",
          );
        }
        return {};
      });

      await expect(
        configureGitHub({ repo: EXPECTED_REPO, apply: true, request }),
      ).rejects.toMatchObject({
        code: "OPTIONAL_SECURITY_CONFIGURATION_FAILED",
        message: "GitHub optional security configuration failed",
      });
      await expect(
        configureGitHub({ repo: EXPECTED_REPO, apply: true, request }),
      ).rejects.not.toThrow(
        /sensitive raw error|rate limit|personal access|not found|validation/iu,
      );
    },
  );
});

describe("gh transport boundary", () => {
  it("classifies an exact structured stdout capability response without exposing the raw body", async () => {
    const rawMarker = "credential-value-must-remain-private";
    const run = vi.fn(async (_command, args: string[], input?: string) => {
      const endpoint = args.find((argument) => argument.startsWith("/"));
      const method = args[args.indexOf("--method") + 1];
      if (endpoint === "/user") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ login: "UtenKekkoDev" }),
          stderr: "",
        };
      }
      if (endpoint === `/repos/${EXPECTED_REPO}` && method === "GET") {
        return {
          exitCode: 0,
          stdout: JSON.stringify(repository()),
          stderr: "",
        };
      }
      if (endpoint?.endsWith("/rulesets") && method === "GET") {
        return { exitCode: 0, stdout: "[[]]", stderr: "" };
      }
      if (
        endpoint === `/repos/${EXPECTED_REPO}` &&
        method === "PATCH" &&
        input?.includes("security_and_analysis")
      ) {
        return {
          exitCode: 1,
          stdout: JSON.stringify({
            message: "Secret scanning is not available for this repository.",
            documentation_url:
              "https://docs.github.com/rest/repos/repos#update-a-repository",
            status: "422",
            errors: [
              {
                resource: "Repository",
                field: "security_and_analysis",
                code: "unavailable",
                value: rawMarker,
              },
            ],
            raw_private_field: rawMarker,
          }),
          stderr: "gh: HTTP 422\n",
        };
      }
      if (endpoint?.endsWith("/rulesets") && method === "POST") {
        return { exitCode: 0, stdout: '{"id":91}', stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const request = createGhRequester({
      command: "never-executed-gh",
      run,
    });

    const result = await configureGitHub({
      repo: EXPECTED_REPO,
      apply: true,
      request,
    });

    expect(result.optionalFeatures.secretScanning).toEqual({
      status: "unsupported",
      reason:
        "GitHub explicitly reported secret scanning is unavailable for this repository",
    });
    expect(result.ruleset).toEqual({ action: "created", id: 91 });
    expect(JSON.stringify(result)).not.toContain(rawMarker);
    expect(run).toHaveBeenCalled();
  });

  it("fails closed and exposes only sanitized metadata for generic structured errors", async () => {
    const rawMarker = "github_pat_private-credential-value";
    const run = vi.fn(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        message: `Validation Failed: ${rawMarker}`,
        documentation_url:
          "https://docs.github.com/rest/repos/repos#update-a-repository",
        status: "422",
        errors: [
          {
            resource: "Repository",
            field: "topics",
            code: "invalid",
            value: rawMarker,
          },
        ],
        raw_private_field: rawMarker,
      }),
      stderr: "gh: HTTP 422\n",
    }));
    const request = createGhRequester({
      command: "never-executed-gh",
      run,
    });

    let error: unknown;
    try {
      await request({ method: "PATCH", endpoint: `/repos/${EXPECTED_REPO}` });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "GH_API_FAILED",
      message: "GitHub API request failed",
      statusCode: 422,
    });
    expect(JSON.stringify(error)).not.toContain(rawMarker);
    expect(JSON.stringify(error)).not.toMatch(
      /raw_private_field|validation failed|github_pat_/iu,
    );
  });
});

describe("configure-github CLI", () => {
  it("prints a redacted no-mutation dry run without requiring gh", () => {
    const script = path.resolve("scripts/configure-github.mjs");
    const secret = "must-not-appear-in-output";
    const result = spawnSync(
      process.execPath,
      [script, "--repo", EXPECTED_REPO],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, GH_TOKEN: secret, PATH: "" },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output).toMatchObject({
      mode: "dry-run",
      repo: EXPECTED_REPO,
      mutationsApplied: false,
    });
    expect(result.stdout).not.toContain(secret);
  });
});
