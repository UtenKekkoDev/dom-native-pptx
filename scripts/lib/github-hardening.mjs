import { spawn } from "node:child_process";

export const EXPECTED_REPOSITORY = "UtenKekkoDev/dom-native-pptx";
export const EXPECTED_OWNER = "UtenKekkoDev";
export const RULESET_NAME = "protect-main";

const API_VERSION = "2022-11-28";
// GitHub Actions public GitHub App ID. Source: REST `GET /apps/github-actions`.
const GITHUB_ACTIONS_INTEGRATION_ID = 15368;
const REPOSITORY_TOPICS = [
  "powerpoint",
  "pptx",
  "html-to-pptx",
  "editable-slides",
  "agent-skill",
];
const EXPLICIT_UNSUPPORTED_SECURITY_MESSAGES = new Set([
  "Secret scanning is not available for this repository.",
  "Secret scanning push protection is not available for this repository.",
]);
const SECURITY_CAPABILITY_DOCUMENTATION =
  "https://docs.github.com/rest/repos/repos#update-a-repository";

export class GitHubHardeningError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "GitHubHardeningError";
    this.code = code;
    this.statusCode = options.statusCode;
    Object.defineProperties(this, {
      responseMessage: { value: options.responseMessage },
      documentationUrl: { value: options.documentationUrl },
      responseErrors: { value: options.responseErrors },
    });
  }
}

function fail(code, message, options) {
  return new GitHubHardeningError(code, message, options);
}

export function buildMainRuleset() {
  return {
    name: RULESET_NAME,
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
  };
}

export function buildRepositoryPatch() {
  return {
    has_issues: true,
    has_projects: false,
    has_wiki: false,
  };
}

export function buildTopicsPayload() {
  return { names: [...REPOSITORY_TOPICS] };
}

export function buildSecurityPatch() {
  return {
    security_and_analysis: {
      secret_scanning: { status: "enabled" },
      secret_scanning_push_protection: { status: "enabled" },
    },
  };
}

export function buildHardeningPlan(repo = EXPECTED_REPOSITORY) {
  return {
    repository: buildRepositoryPatch(),
    topics: buildTopicsPayload(),
    dependencySecurity: {
      vulnerabilityAlerts: "enabled",
      automatedSecurityFixes: "enabled",
      privateVulnerabilityReporting: "enabled",
    },
    optionalSecurity: buildSecurityPatch(),
    ruleset: buildMainRuleset(),
    target: repo,
  };
}

function exactRepository(repo) {
  if (repo !== EXPECTED_REPOSITORY) {
    throw fail(
      "UNEXPECTED_REPOSITORY",
      `Only ${EXPECTED_REPOSITORY} can be configured by this script`,
    );
  }
}

function verifyIdentity(user, repository) {
  const valid =
    user?.login === EXPECTED_OWNER &&
    repository?.full_name === EXPECTED_REPOSITORY &&
    repository?.owner?.login === EXPECTED_OWNER &&
    repository?.visibility === "public" &&
    repository?.private === false &&
    repository?.default_branch === "main";
  if (!valid) {
    throw fail(
      "REPOSITORY_VERIFICATION_FAILED",
      "Authenticated owner, repository identity, public visibility, or default branch did not match",
    );
  }
}

function flattenRulesetPages(response) {
  if (!Array.isArray(response)) {
    throw fail(
      "INVALID_RULESET_RESPONSE",
      "GitHub returned an invalid ruleset list",
    );
  }
  const rulesets = response.every(Array.isArray) ? response.flat() : response;
  if (rulesets.some((ruleset) => !ruleset || typeof ruleset !== "object")) {
    throw fail(
      "INVALID_RULESET_RESPONSE",
      "GitHub returned an invalid ruleset entry",
    );
  }
  return rulesets;
}

function selectRuleset(response) {
  const rulesets = flattenRulesetPages(response);
  const matching = rulesets.filter((ruleset) => ruleset?.name === RULESET_NAME);
  if (matching.length > 1) {
    throw fail(
      "AMBIGUOUS_RULESET",
      `Multiple ${RULESET_NAME} rulesets already exist`,
    );
  }
  const existing = matching[0];
  if (!existing) return undefined;
  if (existing.target !== "branch" || !Number.isInteger(existing.id)) {
    throw fail(
      "INVALID_EXISTING_RULESET",
      `The existing ${RULESET_NAME} ruleset cannot be safely updated`,
    );
  }
  return existing;
}

function optionalSecurityUnsupported(error) {
  return (
    error?.statusCode === 422 &&
    error?.documentationUrl === SECURITY_CAPABILITY_DOCUMENTATION &&
    EXPLICIT_UNSUPPORTED_SECURITY_MESSAGES.has(error?.responseMessage)
  );
}

export async function configureGitHub({
  repo,
  apply = false,
  request = createGhRequester(),
}) {
  exactRepository(repo);
  const plan = buildHardeningPlan(repo);
  if (!apply) {
    return {
      mode: "dry-run",
      repo,
      mutationsApplied: false,
      plan,
    };
  }

  const base = `/repos/${repo}`;
  const user = await request({ method: "GET", endpoint: "/user" });
  const repository = await request({ method: "GET", endpoint: base });
  verifyIdentity(user, repository);

  const rulesets = await request({
    method: "GET",
    endpoint: `${base}/rulesets`,
    paginate: true,
  });
  const existingRuleset = selectRuleset(rulesets);

  await request({ method: "PATCH", endpoint: base, body: plan.repository });
  await request({
    method: "PUT",
    endpoint: `${base}/topics`,
    body: plan.topics,
  });
  await request({ method: "PUT", endpoint: `${base}/vulnerability-alerts` });
  await request({
    method: "PUT",
    endpoint: `${base}/automated-security-fixes`,
  });
  await request({
    method: "PUT",
    endpoint: `${base}/private-vulnerability-reporting`,
  });

  let secretScanning;
  try {
    await request({
      method: "PATCH",
      endpoint: base,
      body: plan.optionalSecurity,
    });
    secretScanning = { status: "configured" };
  } catch (error) {
    if (optionalSecurityUnsupported(error)) {
      secretScanning = {
        status: "unsupported",
        reason:
          "GitHub explicitly reported secret scanning is unavailable for this repository",
      };
    } else {
      throw fail(
        "OPTIONAL_SECURITY_CONFIGURATION_FAILED",
        "GitHub optional security configuration failed",
        {
          cause: error,
          statusCode: error?.statusCode,
          responseMessage: error?.responseMessage,
          documentationUrl: error?.documentationUrl,
        },
      );
    }
  }

  let ruleset;
  if (existingRuleset) {
    await request({
      method: "PUT",
      endpoint: `${base}/rulesets/${existingRuleset.id}`,
      body: plan.ruleset,
    });
    ruleset = { action: "updated", id: existingRuleset.id };
  } else {
    const created = await request({
      method: "POST",
      endpoint: `${base}/rulesets`,
      body: plan.ruleset,
    });
    if (!Number.isInteger(created?.id)) {
      throw fail(
        "INVALID_RULESET_RESPONSE",
        "GitHub did not return the created ruleset id",
      );
    }
    ruleset = { action: "created", id: created.id };
  }

  return {
    mode: "apply",
    repo,
    mutationsApplied: true,
    repository: { status: "configured" },
    dependencySecurity: { status: "configured" },
    optionalFeatures: { secretScanning },
    ruleset,
  };
}

function responseObject(stdout) {
  try {
    const value = JSON.parse(stdout);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function responseStatus(value) {
  const status = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

function responseDocumentationUrl(value) {
  if (typeof value !== "string" || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.github.com"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function responseErrorPart(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/u.test(value)
    ? value
    : undefined;
}

function responseErrors(value) {
  if (!Array.isArray(value)) return undefined;
  const sanitized = value.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const error = {
      resource: responseErrorPart(entry.resource),
      field: responseErrorPart(entry.field),
      code: responseErrorPart(entry.code),
    };
    const defined = Object.fromEntries(
      Object.entries(error).filter(([, part]) => part !== undefined),
    );
    return Object.keys(defined).length ? [defined] : [];
  });
  return sanitized.length ? sanitized : undefined;
}

export function parseGhFailure(stdout, stderr = "") {
  const response = responseObject(stdout);
  if (response) {
    const responseMessage =
      typeof response.message === "string" &&
      EXPLICIT_UNSUPPORTED_SECURITY_MESSAGES.has(response.message)
        ? response.message
        : undefined;
    const sanitizedErrors = responseErrors(response.errors);
    return {
      statusCode: responseStatus(response.status),
      responseMessage,
      documentationUrl: responseDocumentationUrl(response.documentation_url),
      ...(sanitizedErrors ? { responseErrors: sanitizedErrors } : {}),
    };
  }

  const combined = `${stdout}\n${stderr}`;
  const status = /(?:HTTP|status(?: code)?)[^0-9]*(4\d{2}|5\d{2})/iu.exec(
    combined,
  );
  const message = /^\s*gh:\s*(.*?)\s*\(HTTP\s+\d{3}\)\s*$/imu.exec(combined);
  const responseMessage = EXPLICIT_UNSUPPORTED_SECURITY_MESSAGES.has(
    message?.[1],
  )
    ? message[1]
    : undefined;
  const documentationUrl = /https:\/\/docs\.github\.com\/[^\s"')]+/iu.exec(
    combined,
  );
  return {
    statusCode: status ? Number(status[1]) : undefined,
    responseMessage,
    documentationUrl: responseDocumentationUrl(documentationUrl?.[0]),
  };
}

export function buildGhArguments({ method, endpoint, paginate = false }) {
  const args = [
    "api",
    "--method",
    method,
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    `X-GitHub-Api-Version: ${API_VERSION}`,
    endpoint,
  ];
  if (paginate) args.push("--paginate", "--slurp");
  return args;
}

function runGh(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", () => {
      reject(
        fail(
          "GH_UNAVAILABLE",
          "GitHub CLI could not be started; install and authenticate gh first",
        ),
      );
    });
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export function createGhRequester({ command = "gh", run = runGh } = {}) {
  return async ({ method, endpoint, body, paginate = false }) => {
    const args = buildGhArguments({ method, endpoint, paginate });
    const input = body === undefined ? undefined : JSON.stringify(body);
    if (input !== undefined) args.push("--input", "-");
    const result = await run(command, args, input);
    if (result.exitCode !== 0) {
      const metadata = parseGhFailure(result.stdout, result.stderr);
      throw fail("GH_API_FAILED", "GitHub API request failed", {
        ...metadata,
      });
    }
    if (!result.stdout.trim()) return undefined;
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw fail("INVALID_GH_RESPONSE", "GitHub CLI returned invalid JSON");
    }
  };
}
