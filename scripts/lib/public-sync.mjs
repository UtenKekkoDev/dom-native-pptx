import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify, TextDecoder } from "node:util";
import ts from "typescript";

const execFile = promisify(execFileCallback);

export const PUBLIC_ROOTS = [
  ".github",
  "src",
  "tests",
  "examples",
  "skills",
  "docs",
  "scripts",
];

export const PUBLIC_ROOT_FILES = [
  ".gitattributes",
  ".gitignore",
  ".prettierignore",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "RASTER_POLICY.md",
  "SOURCE_MAP.md",
  "SUPPORTED_CSS.md",
  "THIRD_PARTY_NOTICES.md",
  "eslint.config.js",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "vitest.config.ts",
];

export const DENIED_PREFIXES = [
  "docs/superpowers/",
  ".tmp/",
  "outputs/",
  "work/",
  "dist/",
  "coverage/",
  "node_modules/",
];

const DENIED_SEGMENTS = new Set([
  ".cache",
  ".git",
  ".tmp",
  "attachment",
  "attachments",
  "build",
  "cache",
  "coverage",
  "customer",
  "customers",
  "dependencies",
  "deps",
  "dist",
  "download",
  "downloads",
  "logs",
  "node_modules",
  "outputs",
  "private",
  "vendor",
  "vendors",
  "work",
]);
const DENIED_BASENAME_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /\.log$/i,
  /(?:^|[-_.])customer(?:[-_.]|$)/i,
];
const BINARY_MEDIA_EXTENSION =
  /\.(?:avif|bmp|eot|flac|gif|ico|jpe?g|m4a|mov|mp3|mp4|otf|pdf|pptx?|ttf|wav|webm|webp|woff2?|zip)$/i;
const MAINTAINER_ABSOLUTE_PATH =
  /(?:[A-Za-z]:[\\/]Users[\\/]ROG(?:[\\/]|\b)|\/(?:Users|home)\/ROG(?:\/|\b))/i;
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bxapp-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];
const CREDENTIAL_FIELD_NAMES = new Set([
  "apikey",
  "clientsecret",
  "accesstoken",
  "authtoken",
  "password",
  "token",
]);
const PROVENANCE_PATH = "docs/asset-provenance.json";
const MAX_BUFFER = 128 * 1024 * 1024;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const ALLOWED_GIT_MODES = new Set(["100644", "100755"]);
const WINDOWS_RESERVED_NAME =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export class PublicSyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PublicSyncError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function formatPublicSyncFailure(error) {
  const isPublicSyncError = error instanceof PublicSyncError;
  const formatted = {
    code: isPublicSyncError ? error.code : "PUBLIC_SYNC_FAILED",
    message: isPublicSyncError
      ? error.message
      : "Public synchronization failed",
  };
  if (formatted.code === "APPLY_ROLLBACK_FAILED") {
    for (const key of [
      "recoveryPath",
      "lockPath",
      "journalPath",
      "originalIndexPath",
    ]) {
      if (typeof error?.[key] === "string") {
        formatted[key] = error[key];
      }
    }
  }
  return { error: formatted };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sha256Buffer(content) {
  return createHash("sha256").update(content).digest("hex");
}

function unwrapQuotedValue(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  if (
    (quote === '"' || quote === "'" || quote === "`") &&
    value.at(-1) === quote
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function isExplicitCredentialPlaceholder(value) {
  let normalized = unwrapQuotedValue(value.trim()).trim();
  if (
    (normalized.startsWith("[") && normalized.endsWith("]")) ||
    (normalized.startsWith("<") && normalized.endsWith(">"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return (
    normalized.length === 0 ||
    /^(?:placeholder|example|changeme|change[-_ ]?me|redacted|masked|dummy|undefined|null|none|todo|your[-_ ].*[-_ ]here)$/i.test(
      normalized,
    ) ||
    /^(?:\*{3,}|x{3,})$/iu.test(normalized)
  );
}

function isCredentialPlaceholder(rawValue) {
  const value = unwrapQuotedValue(rawValue.trim()).trim();
  if (isExplicitCredentialPlaceholder(value)) {
    return true;
  }
  if (
    /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(value) ||
    /^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(value) ||
    /^\$env:[A-Za-z_][A-Za-z0-9_]*$/iu.test(value) ||
    /^%[A-Za-z_][A-Za-z0-9_]*%$/u.test(value) ||
    /^(?:process\.)?env\.[A-Za-z_][A-Za-z0-9_]*$/u.test(value)
  ) {
    return true;
  }
  const fallback = /^\$\{[A-Za-z_][A-Za-z0-9_]*:-([\s\S]*)\}$/u.exec(value);
  if (fallback) {
    return isCredentialPlaceholder(fallback[1]);
  }
  return false;
}

function credentialFieldCandidates(field) {
  const normalized = field
    .split(".")
    .map((segment) => segment.replace(/[^A-Za-z0-9]/gu, "").toLowerCase());
  return [
    normalized.at(-1),
    normalized.length > 1 ? normalized.slice(-2).join("") : null,
  ];
}

function isCredentialFieldName(field) {
  return credentialFieldCandidates(field).some((candidate) =>
    CREDENTIAL_FIELD_NAMES.has(candidate),
  );
}

function parsedPropertyName(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return null;
}

function jsonSyntaxValueIsUnsafe(node) {
  if (ts.isStringLiteral(node)) {
    return !isCredentialPlaceholder(node.text);
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some(jsonSyntaxValueIsUnsafe);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some(
      (property) =>
        !ts.isPropertyAssignment(property) ||
        jsonSyntaxValueIsUnsafe(property.initializer),
    );
  }
  return true;
}

function jsonSyntaxContainsCredential(node) {
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some(jsonSyntaxContainsCredential);
  }
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const field = parsedPropertyName(property.name);
    return (
      (field !== null &&
        isCredentialFieldName(field) &&
        jsonSyntaxValueIsUnsafe(property.initializer)) ||
      jsonSyntaxContainsCredential(property.initializer)
    );
  });
}

function structurallyContainsJsonCredential(text) {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  const sourceFile = ts.parseJsonText("public-sync.json", text);
  if (sourceFile.parseDiagnostics.length > 0) return null;
  const expression = sourceFile.statements[0]?.expression;
  return expression ? jsonSyntaxContainsCredential(expression) : false;
}

const TYPESCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function scriptKindForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function credentialTargetName(node) {
  const propertyName = parsedPropertyName(node);
  if (propertyName !== null) return propertyName;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function templateExpressionHasUnsafeLiteral(node) {
  if (node.head.text.trim().length > 0) return true;
  for (const span of node.templateSpans) {
    if (
      typescriptValueContainsUnsafeLiteral(span.expression) ||
      span.literal.text.trim().length > 0
    ) {
      return true;
    }
  }
  return false;
}

function typescriptValueContainsUnsafeLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return !isCredentialPlaceholder(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    return templateExpressionHasUnsafeLiteral(node);
  }
  let unsafe = false;
  ts.forEachChild(node, (child) => {
    if (!unsafe && !ts.isTypeNode(child)) {
      unsafe = typescriptValueContainsUnsafeLiteral(child);
    }
  });
  return unsafe;
}

function unwrapTypescriptExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isSafeTypescriptComputedCredentialExpression(node) {
  const expression = unwrapTypescriptExpression(node);
  if (ts.isIdentifier(expression)) {
    return expression.text === "undefined";
  }
  if (
    ts.isCallExpression(expression) ||
    ts.isNewExpression(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isArrowFunction(expression)
  ) {
    return true;
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      !typescriptCredentialValueIsUnsafe(expression.whenTrue) &&
      !typescriptCredentialValueIsUnsafe(expression.whenFalse)
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
    ].includes(expression.operatorToken.kind)
  ) {
    return (
      !typescriptCredentialValueIsUnsafe(expression.left) &&
      !typescriptCredentialValueIsUnsafe(expression.right)
    );
  }
  return false;
}

function typescriptCredentialValueIsUnsafe(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return !isCredentialPlaceholder(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    return templateExpressionHasUnsafeLiteral(node);
  }
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  ) {
    return false;
  }
  if (
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  return (
    typescriptValueContainsUnsafeLiteral(node) ||
    !isSafeTypescriptComputedCredentialExpression(node)
  );
}

function structurallyContainsTypescriptCredential(text, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!TYPESCRIPT_EXTENSIONS.has(extension)) return null;
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(filePath),
  );
  const hasParseDiagnostics = sourceFile.parseDiagnostics.length > 0;
  let unsafe = false;
  const inspectAssignment = (target, value) => {
    const field = credentialTargetName(target);
    if (
      field !== null &&
      isCredentialFieldName(field) &&
      value &&
      typescriptCredentialValueIsUnsafe(value)
    ) {
      unsafe = true;
    }
  };
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isEnumMember(node)
    ) {
      inspectAssignment(node.name, node.initializer);
    } else if (ts.isPropertyAssignment(node)) {
      const field = parsedPropertyName(node.name);
      if (
        field !== null &&
        isCredentialFieldName(field) &&
        typescriptCredentialValueIsUnsafe(node.initializer)
      ) {
        unsafe = true;
      }
    } else if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      inspectAssignment(node.left, node.right);
    } else if (ts.isBindingElement(node)) {
      inspectAssignment(node.propertyName ?? node.name, node.initializer);
    } else if (
      ts.isLabeledStatement(node) &&
      isCredentialFieldName(node.label.text)
    ) {
      const value = ts.isExpressionStatement(node.statement)
        ? node.statement.expression
        : null;
      if (!value || typescriptCredentialValueIsUnsafe(value)) {
        unsafe = true;
      }
    }
    if (!unsafe) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { unsafe, hasParseDiagnostics };
}

function containsUnsafeStringLiteral(value) {
  for (let index = 0; index < value.length; index += 1) {
    const quote = value[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    let escaped = false;
    let cursor = index + 1;
    for (; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        break;
      }
    }
    if (cursor >= value.length) return true;
    const literal = value.slice(index, cursor + 1);
    if (!isCredentialPlaceholder(literal)) return true;
    index = cursor;
  }
  return false;
}

function isSafeComputedCredentialExpression(rawValue) {
  const value = rawValue.trim();
  if (value.length === 0 || containsUnsafeStringLiteral(value)) return false;
  if (/^(?:async\s+)?function\b/u.test(value) || /=>/u.test(value)) {
    return true;
  }
  const expression = value.replace(/[;,}\s]+$/u, "").trim();
  const identifier = "[A-Za-z_$][A-Za-z0-9_$]*";
  const member = `(?:\\?\\.|\\.)${identifier}|\\[[^\\]\\r\\n]+\\]`;
  const prefix = "(?:await\\s+|new\\s+)?";
  return (
    new RegExp(
      `^${prefix}${identifier}(?:${member})+\\s*(?:\\([\\s\\S]*\\))?$`,
      "u",
    ).test(expression) ||
    new RegExp(`^${prefix}${identifier}\\s*\\([\\s\\S]*\\)$`, "u").test(
      expression,
    )
  );
}

function stripCredentialComments(text) {
  const stripped = [];
  let inBlockComment = false;
  for (const sourceLine of text.split(/\r?\n/u)) {
    let output = "";
    let quote = null;
    let escaped = false;
    for (let index = 0; index < sourceLine.length; index += 1) {
      const character = sourceLine[index];
      const next = sourceLine[index + 1];
      if (inBlockComment) {
        if (character === "*" && next === "/") {
          inBlockComment = false;
          index += 1;
          output += " ";
        }
        continue;
      }
      if (quote) {
        output += character;
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        output += character;
        continue;
      }
      if (character === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        output += " ";
        continue;
      }
      if (character === "/" && next === "/") {
        break;
      }
      if (
        character === "#" &&
        (output.trim().length === 0 || /\s/u.test(output.at(-1)))
      ) {
        break;
      }
      output += character;
    }
    stripped.push(output);
  }
  return stripped;
}

function credentialFieldAtDelimiter(line, delimiterIndex, delimiter) {
  const prefix = line.slice(0, delimiterIndex);
  let end = prefix.length;
  while (end > 0 && /\s/u.test(prefix[end - 1])) end -= 1;
  if (end === 0) return null;

  let field;
  let start;
  const closingQuote = prefix[end - 1];
  if (closingQuote === '"' || closingQuote === "'") {
    let opening = end - 2;
    while (opening >= 0) {
      if (
        prefix[opening] === closingQuote &&
        (opening === 0 || prefix[opening - 1] !== "\\")
      ) {
        break;
      }
      opening -= 1;
    }
    if (opening < 0) return null;
    field = prefix.slice(opening + 1, end - 1);
    start = opening;
  } else {
    const match =
      /[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z_$][A-Za-z0-9_$-]*)*$/u.exec(
        prefix.slice(0, end),
      );
    if (!match) return null;
    field = match[0];
    start = end - field.length;
  }

  if (!isCredentialFieldName(field)) {
    return null;
  }
  if (delimiter === ":") {
    const context = prefix.slice(0, start).trimEnd();
    if (context.length > 0 && !/[{,[-]$/u.test(context)) {
      return null;
    }
  }
  return { field, start };
}

function fieldValueAt(line, start) {
  let index = start;
  while (index < line.length && /\s/u.test(line[index])) index += 1;
  if (index >= line.length) return "";
  const quote = line[index];
  if (quote === '"' || quote === "'" || quote === "`") {
    let escaped = false;
    for (let cursor = index + 1; cursor < line.length; cursor += 1) {
      const character = line[cursor];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        return line.slice(index, cursor + 1);
      }
    }
    return line.slice(index);
  }
  if (line.startsWith("${", index)) {
    let depth = 0;
    for (let cursor = index + 1; cursor < line.length; cursor += 1) {
      if (line[cursor] === "{") {
        depth += 1;
      } else if (line[cursor] === "}") {
        depth -= 1;
        if (depth === 0) return line.slice(index, cursor + 1);
      }
    }
  }
  return line.slice(index).trim();
}

function lineContainsCredentialAssignment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character !== ":" && character !== "=") continue;
    if (line.lastIndexOf("${", index) > line.lastIndexOf("}", index)) {
      continue;
    }
    if (
      character === "=" &&
      (line[index - 1] === "=" ||
        line[index - 1] === "!" ||
        line[index - 1] === "<" ||
        line[index - 1] === ">" ||
        line[index + 1] === "=" ||
        line[index + 1] === ">")
    ) {
      continue;
    }
    if (!credentialFieldAtDelimiter(line, index, character)) continue;
    const fieldValue = fieldValueAt(line, index + 1);
    if (
      !isCredentialPlaceholder(fieldValue) &&
      !isSafeComputedCredentialExpression(fieldValue)
    ) {
      return true;
    }
  }
  return false;
}

function containsCredentialLikeContent(text, filePath) {
  const lines = stripCredentialComments(text);
  const uncommented = lines.join("\n");
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(uncommented))) {
    return true;
  }
  const structuralJsonResult = structurallyContainsJsonCredential(uncommented);
  if (structuralJsonResult !== null) return structuralJsonResult;
  const structuralTypescriptResult = structurallyContainsTypescriptCredential(
    text,
    filePath,
  );
  if (structuralTypescriptResult === null) {
    return lines.some(lineContainsCredentialAssignment);
  }
  return (
    structuralTypescriptResult.unsafe ||
    (structuralTypescriptResult.hasParseDiagnostics &&
      lines.some(lineContainsCredentialAssignment))
  );
}

function decodeUtf8(buffer, code, message) {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    throw new PublicSyncError(code, message);
  }
}

function splitNull(buffer) {
  const parts = [];
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    if (end === -1) {
      throw new PublicSyncError(
        "INVALID_GIT_TREE",
        "Git emitted a non-NUL-terminated record",
      );
    }
    if (end > start) {
      parts.push(buffer.subarray(start, end));
    }
    start = end + 1;
  }
  return parts;
}

function assertPortablePublicPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new PublicSyncError(
      "NON_PORTABLE_PATH",
      "Public path must be a non-empty string",
    );
  }
  if (
    filePath.includes("\\") ||
    filePath.startsWith("/") ||
    /^[A-Za-z]:/.test(filePath) ||
    filePath.normalize("NFC") !== filePath
  ) {
    throw new PublicSyncError(
      "NON_PORTABLE_PATH",
      `Non-portable public path: ${JSON.stringify(filePath)}`,
      {
        path: filePath,
      },
    );
  }
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      [...segment].some(
        (character) => (character.codePointAt(0) ?? 0) <= 0x1f,
      ) ||
      /[<>:"|?*]/u.test(segment) ||
      /[. ]$/u.test(segment) ||
      WINDOWS_RESERVED_NAME.test(segment)
    ) {
      throw new PublicSyncError(
        "NON_PORTABLE_PATH",
        `Non-portable public path: ${JSON.stringify(filePath)}`,
        {
          path: filePath,
        },
      );
    }
  }
  return filePath;
}

function assertNoPathCollisions(paths) {
  const aliases = new Map();
  for (const filePath of paths) {
    const alias = filePath.normalize("NFC").toLowerCase();
    const existing = aliases.get(alias);
    if (existing && existing !== filePath) {
      throw new PublicSyncError(
        "PATH_COLLISION",
        `Public paths collide across portable filesystems: ${existing} and ${filePath}`,
      );
    }
    aliases.set(alias, filePath);
  }
}

function isDeniedPath(filePath) {
  const lower = filePath.toLowerCase();
  if (
    DENIED_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()))
  ) {
    return true;
  }
  const segments = lower.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    segments.some((segment) => DENIED_SEGMENTS.has(segment)) ||
    DENIED_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))
  );
}

function isAllowlistedPath(filePath) {
  return (
    PUBLIC_ROOT_FILES.includes(filePath) ||
    PUBLIC_ROOTS.some((root) => filePath.startsWith(`${root}/`))
  );
}

function decodeTextEntry(entry) {
  if (BINARY_MEDIA_EXTENSION.test(entry.path)) {
    return null;
  }
  let text;
  try {
    text = UTF8_DECODER.decode(entry.content);
  } catch {
    return null;
  }
  if (/[^\P{Cc}\t\r\n]/u.test(text)) {
    return null;
  }
  return text;
}

function isBinaryEntry(entry) {
  return decodeTextEntry(entry) === null;
}

async function runGit(repo, args, options = {}) {
  try {
    const result = await execFile("git", ["-C", repo, ...args], {
      encoding: options.encoding ?? "buffer",
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    throw new PublicSyncError(
      options.code ?? "GIT_COMMAND_FAILED",
      options.message ?? "Git command failed",
      { cause: error },
    );
  }
}

async function resolveSourceCommit(sourceRepo, sourceRef) {
  const stdout = await runGit(
    sourceRepo,
    ["rev-parse", "--verify", "--end-of-options", `${sourceRef}^{commit}`],
    {
      encoding: "utf8",
      code: "SOURCE_REF_UNAVAILABLE",
      message: `Source ref is unavailable: ${sourceRef}`,
    },
  );
  return stdout.trim();
}

function parseTreeRecord(recordBuffer) {
  const record = decodeUtf8(
    recordBuffer,
    "NON_PORTABLE_PATH",
    "Git tree contains a path that is not valid UTF-8",
  );
  const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
  if (!match) {
    throw new PublicSyncError(
      "INVALID_GIT_TREE",
      "Git emitted an invalid tree record",
    );
  }
  const [, mode, type, objectId, rawPath] = match;
  const publicPath = assertPortablePublicPath(rawPath);
  return { mode, type, objectId, path: publicPath };
}

export async function listPublicFiles({ sourceRepo, sourceRef }) {
  if (!sourceRepo || !sourceRef) {
    throw new PublicSyncError(
      "INVALID_ARGUMENTS",
      "sourceRepo and sourceRef are required",
    );
  }
  const resolvedRepo = path.resolve(sourceRepo);
  const sourceCommit = await resolveSourceCommit(resolvedRepo, sourceRef);
  const tree = await runGit(
    resolvedRepo,
    ["ls-tree", "-r", "-z", "--full-tree", sourceCommit],
    {
      code: "SOURCE_TREE_UNAVAILABLE",
      message: `Unable to enumerate source commit: ${sourceCommit}`,
    },
  );
  const records = splitNull(tree).map(parseTreeRecord);
  assertNoPathCollisions(records.map((record) => record.path));
  const entries = [];
  const ignored = [];

  for (const record of records) {
    if (record.type !== "blob" || !ALLOWED_GIT_MODES.has(record.mode)) {
      throw new PublicSyncError(
        "UNSUPPORTED_GIT_ENTRY",
        `Unsupported Git entry at ${record.path}: ${record.mode} ${record.type}`,
        { path: record.path },
      );
    }
    if (isDeniedPath(record.path) || !isAllowlistedPath(record.path)) {
      ignored.push(record.path);
      continue;
    }
    const content = await runGit(
      resolvedRepo,
      ["cat-file", "blob", record.objectId],
      {
        code: "SOURCE_ENTRY_UNAVAILABLE",
        message: `Unable to read committed source entry: ${record.path}`,
      },
    );
    entries.push({ ...record, content });
  }

  return { sourceCommit, entries, ignored: ignored.sort() };
}

function provenanceError(message) {
  throw new PublicSyncError("INVALID_PROVENANCE", message);
}

function validateProvenanceRecord(record, entryMap, binaryPaths) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    provenanceError("Asset provenance records must be objects");
  }
  if (!isNonEmptyString(record.path)) {
    provenanceError("Asset provenance path must be non-empty");
  }
  let assetPath;
  try {
    assetPath = assertPortablePublicPath(record.path);
  } catch {
    provenanceError("Asset provenance path is not portable");
  }
  if (
    !isNonEmptyString(record.type) ||
    !isNonEmptyString(record.license) ||
    !isNonEmptyString(record.sha256) ||
    !/^[0-9a-f]{64}$/i.test(record.sha256)
  ) {
    provenanceError(
      `Asset provenance requires type, license, and SHA-256: ${assetPath}`,
    );
  }
  if (isDeniedPath(assetPath) || !isAllowlistedPath(assetPath)) {
    provenanceError(`Provenance path is not public: ${assetPath}`);
  }
  if (!binaryPaths.has(assetPath)) {
    provenanceError(`Registered asset is absent or not binary: ${assetPath}`);
  }
  const assetEntry = entryMap.get(assetPath);
  const actualDigest = createHash("sha256")
    .update(assetEntry.content)
    .digest("hex");
  if (actualDigest.toLowerCase() !== record.sha256.toLowerCase()) {
    provenanceError(`Registered asset digest is stale: ${assetPath}`);
  }
  if (record.type === "generated") {
    if (
      !isNonEmptyString(record.sourceFixture) ||
      !isNonEmptyString(record.command)
    ) {
      provenanceError(`Generated asset provenance is incomplete: ${assetPath}`);
    }
    let sourceFixture;
    try {
      sourceFixture = assertPortablePublicPath(record.sourceFixture);
    } catch {
      provenanceError(
        `Generated asset source fixture is not portable: ${assetPath}`,
      );
    }
    if (!entryMap.has(sourceFixture)) {
      provenanceError(`Generated asset source fixture is absent: ${assetPath}`);
    }
  } else if (record.type === "third-party") {
    if (
      !isNonEmptyString(record.sourceUrl) ||
      !isNonEmptyString(record.author) ||
      record.redistributionPermission !== true
    ) {
      provenanceError(
        `Third-party asset redistribution is not affirmatively permitted: ${assetPath}`,
      );
    }
  } else {
    provenanceError(`Unsupported asset provenance type: ${assetPath}`);
  }
  return assetPath;
}

function registeredAssetPaths(entries) {
  const provenanceEntry = entries.find(
    (entry) => entry.path === PROVENANCE_PATH,
  );
  if (!provenanceEntry) {
    return new Set();
  }
  let provenance;
  try {
    provenance = JSON.parse(UTF8_DECODER.decode(provenanceEntry.content));
  } catch {
    provenanceError(`${PROVENANCE_PATH} is not valid UTF-8 JSON`);
  }
  if (
    !provenance ||
    typeof provenance !== "object" ||
    provenance.version !== 1 ||
    !Array.isArray(provenance.assets)
  ) {
    provenanceError(
      `${PROVENANCE_PATH} requires version 1 and an assets array`,
    );
  }
  const entryMap = new Map(entries.map((entry) => [entry.path, entry]));
  const binaryPaths = new Set(
    entries.filter(isBinaryEntry).map((entry) => entry.path),
  );
  const registered = new Set();
  for (const record of provenance.assets) {
    const assetPath = validateProvenanceRecord(record, entryMap, binaryPaths);
    if (registered.has(assetPath)) {
      provenanceError(`Duplicate asset provenance: ${assetPath}`);
    }
    registered.add(assetPath);
  }
  return registered;
}

export async function auditPublicEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new PublicSyncError("INVALID_ARGUMENTS", "entries must be an array");
  }
  const seen = new Set();
  const normalizedEntries = entries.map((entry) => {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !Buffer.isBuffer(entry.content)
    ) {
      throw new PublicSyncError(
        "INVALID_ENTRY",
        "Public entries require a path and Buffer content",
      );
    }
    const publicPath = assertPortablePublicPath(entry.path);
    const alias = publicPath.toLowerCase();
    if (seen.has(alias)) {
      throw new PublicSyncError(
        "PATH_COLLISION",
        `Duplicate or colliding public path: ${publicPath}`,
      );
    }
    seen.add(alias);
    if (isDeniedPath(publicPath)) {
      throw new PublicSyncError(
        "DENIED_PATH",
        `Denied public path: ${publicPath}`,
        { path: publicPath },
      );
    }
    if (!isAllowlistedPath(publicPath)) {
      throw new PublicSyncError(
        "PATH_NOT_ALLOWLISTED",
        `Path is not allowlisted: ${publicPath}`,
        {
          path: publicPath,
        },
      );
    }
    const mode = entry.mode ?? "100644";
    const type = entry.type ?? "blob";
    if (type !== "blob" || !ALLOWED_GIT_MODES.has(mode)) {
      throw new PublicSyncError(
        "UNSUPPORTED_GIT_ENTRY",
        `Unsupported public entry: ${publicPath}`,
      );
    }
    return { ...entry, path: publicPath, mode, type };
  });

  const registered = registeredAssetPaths(normalizedEntries);
  for (const entry of normalizedEntries) {
    const text = decodeTextEntry(entry);
    if (text === null) {
      if (!registered.has(entry.path)) {
        throw new PublicSyncError(
          "UNREGISTERED_BINARY",
          `Binary asset is not registered: ${entry.path}`,
          {
            path: entry.path,
          },
        );
      }
      continue;
    }
    if (MAINTAINER_ABSOLUTE_PATH.test(text)) {
      throw new PublicSyncError(
        "MAINTAINER_ABSOLUTE_PATH",
        `Maintainer absolute path detected in: ${entry.path}`,
        { path: entry.path },
      );
    }
    if (containsCredentialLikeContent(text, entry.path)) {
      throw new PublicSyncError(
        "CREDENTIAL_PATTERN",
        `Credential-like content detected in: ${entry.path}`,
        { path: entry.path },
      );
    }
  }
  return {
    entries: normalizedEntries,
    registeredAssets: [...registered].sort(),
  };
}

function sameFilesystemPath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new PublicSyncError(
      "DESTINATION_INSPECTION_FAILED",
      `Unable to inspect destination entry`,
      {
        cause: error,
      },
    );
  }
}

function destinationPath(destination, publicPath) {
  const target = path.resolve(destination, ...publicPath.split("/"));
  if (!isInsideRoot(destination, target)) {
    throw new PublicSyncError(
      "NON_PORTABLE_PATH",
      `Public path escapes destination: ${publicPath}`,
    );
  }
  return target;
}

async function collectManagedFiles(destination, canonicalRoot, relativeRoot) {
  const start = destinationPath(destination, relativeRoot);
  const rootStat = await lstatOrNull(start);
  if (!rootStat) {
    return [];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new PublicSyncError(
      "UNSAFE_DESTINATION_ENTRY",
      `Unsafe managed root: ${relativeRoot}`,
    );
  }
  const canonicalStart = await fs.realpath(start);
  if (
    !isInsideRoot(canonicalRoot, canonicalStart) ||
    !sameFilesystemPath(canonicalStart, start)
  ) {
    throw new PublicSyncError(
      "UNSAFE_DESTINATION_ENTRY",
      `Managed root escapes destination: ${relativeRoot}`,
    );
  }

  const files = [];
  const walk = async (absoluteDirectory, relativeDirectory) => {
    let directoryEntries;
    try {
      directoryEntries = await fs.readdir(absoluteDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      throw new PublicSyncError(
        "DESTINATION_INSPECTION_FAILED",
        "Unable to read managed directory",
        {
          cause: error,
        },
      );
    }
    for (const directoryEntry of directoryEntries) {
      const relativePath = `${relativeDirectory}/${directoryEntry.name}`;
      const absolutePath = destinationPath(destination, relativePath);
      const stat = await lstatOrNull(absolutePath);
      if (!stat || stat.isSymbolicLink()) {
        throw new PublicSyncError(
          "UNSAFE_DESTINATION_ENTRY",
          `Unsafe destination entry: ${relativePath}`,
        );
      }
      if (stat.isDirectory()) {
        const canonical = await fs.realpath(absolutePath);
        if (
          !isInsideRoot(canonicalRoot, canonical) ||
          !sameFilesystemPath(canonical, absolutePath)
        ) {
          throw new PublicSyncError(
            "UNSAFE_DESTINATION_ENTRY",
            `Destination entry escapes root: ${relativePath}`,
          );
        }
        await walk(absolutePath, relativePath);
      } else if (stat.isFile()) {
        files.push(relativePath);
      } else {
        throw new PublicSyncError(
          "UNSAFE_DESTINATION_ENTRY",
          `Unsupported destination entry: ${relativePath}`,
        );
      }
    }
  };
  await walk(start, relativeRoot);
  return files;
}

function parseIndexRecord(buffer) {
  const record = decodeUtf8(
    buffer,
    "INVALID_DESTINATION",
    "Destination index path is not valid UTF-8",
  );
  const match = /^([0-7]{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record);
  if (!match) {
    throw new PublicSyncError(
      "INVALID_DESTINATION",
      "Destination index contains an invalid record",
    );
  }
  return {
    mode: match[1],
    objectId: match[2],
    stage: match[3],
    path: match[4],
  };
}

async function readDestinationIndex(destination) {
  const output = await runGit(destination, ["ls-files", "-s", "-z"], {
    code: "INVALID_DESTINATION",
    message: "Unable to read destination index",
  });
  const records = splitNull(output).map(parseIndexRecord);
  return new Map(records.map((record) => [record.path, record]));
}

async function validateDestinationManagedState(destination, canonicalRoot) {
  const currentPaths = [];
  for (const rootFile of PUBLIC_ROOT_FILES) {
    const absolutePath = destinationPath(destination, rootFile);
    const stat = await lstatOrNull(absolutePath);
    if (!stat) {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PublicSyncError(
        "UNSAFE_DESTINATION_ENTRY",
        `Unsafe destination root file: ${rootFile}`,
      );
    }
    currentPaths.push(rootFile);
  }
  for (const root of PUBLIC_ROOTS) {
    currentPaths.push(
      ...(await collectManagedFiles(destination, canonicalRoot, root)),
    );
  }
  currentPaths.sort();
  const index = await readDestinationIndex(destination);
  for (const currentPath of currentPaths) {
    const tracked = index.get(currentPath);
    if (!tracked) {
      throw new PublicSyncError(
        "UNTRACKED_MANAGED_ENTRY",
        `Managed destination entry is untracked or ignored: ${currentPath}`,
        { path: currentPath },
      );
    }
    if (tracked.stage !== "0" || !ALLOWED_GIT_MODES.has(tracked.mode)) {
      throw new PublicSyncError(
        "UNSAFE_DESTINATION_ENTRY",
        `Unsupported destination Git entry: ${currentPath}`,
      );
    }
  }
  return { currentPaths, index };
}

async function pathIdentity(target) {
  const canonicalPath = await fs.realpath(target);
  const stat = await fs.stat(target, { bigint: true });
  return {
    canonicalPath,
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
  };
}

function samePathIdentity(left, right) {
  if (!sameFilesystemPath(left.canonicalPath, right.canonicalPath)) {
    return false;
  }
  return (
    left.inode !== "0" &&
    right.inode !== "0" &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function assertStablePathIdentity(identity, label) {
  if (!identity || identity.inode === "0") {
    throw new PublicSyncError(
      "UNSTABLE_DESTINATION_IDENTITY",
      `Stable filesystem identity is unavailable for the destination ${label}`,
    );
  }
}

async function resolveDestinationIdentity(destination) {
  const resolved = path.resolve(destination);
  const root = (
    await runGit(resolved, ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      code: "INVALID_DESTINATION",
      message: "Destination must be an existing Git working tree",
    })
  ).trim();
  if (!sameFilesystemPath(root, resolved)) {
    throw new PublicSyncError(
      "INVALID_DESTINATION",
      "Destination must be the Git working-tree root",
    );
  }
  const canonicalRoot = await fs.realpath(resolved);
  if (!sameFilesystemPath(canonicalRoot, resolved)) {
    throw new PublicSyncError(
      "INVALID_DESTINATION",
      "Destination root must not be a symlink or junction",
    );
  }
  const gitDirectory = (
    await runGit(resolved, ["rev-parse", "--absolute-git-dir"], {
      encoding: "utf8",
      code: "INVALID_DESTINATION",
      message: "Unable to resolve destination Git directory",
    })
  ).trim();
  return {
    root: resolved,
    canonicalRoot,
    rootIdentity: await pathIdentity(resolved),
    gitDirectory,
    gitIdentity: await pathIdentity(gitDirectory),
  };
}

async function destinationStatus(destination) {
  return runGit(destination, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
  ]);
}

async function destinationIndexPath(destination) {
  return (
    await runGit(
      destination,
      ["rev-parse", "--path-format=absolute", "--git-path", "index"],
      {
        encoding: "utf8",
        code: "INVALID_DESTINATION",
        message: "Unable to resolve destination Git index",
      },
    )
  ).trim();
}

async function snapshotManagedFiles(destination, currentPaths) {
  const files = new Map();
  for (const publicPath of currentPaths) {
    const absolutePath = destinationPath(destination, publicPath);
    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath),
      fs.stat(absolutePath),
    ]);
    files.set(publicPath, {
      digest: sha256Buffer(content),
      mode: stat.mode & 0o777,
    });
  }
  return files;
}

async function captureDestinationSnapshot(destination) {
  const identity = await resolveDestinationIdentity(destination);
  const status = await destinationStatus(identity.root);
  if (status.length > 0) {
    throw new PublicSyncError(
      "DIRTY_DESTINATION",
      "Destination contains uncommitted changes",
    );
  }
  const managed = await validateDestinationManagedState(
    identity.root,
    identity.canonicalRoot,
  );
  const indexPath = await destinationIndexPath(identity.root);
  const indexStat = await fs.stat(indexPath);
  return {
    ...identity,
    ...managed,
    indexPath,
    indexBytes: await fs.readFile(indexPath),
    indexMode: indexStat.mode & 0o777,
    managedFiles: await snapshotManagedFiles(
      identity.root,
      managed.currentPaths,
    ),
  };
}

function destinationLockPath(destination) {
  return path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.public-sync.lock`,
  );
}

async function acquireDestinationLock(destination, durability) {
  const lockPath = destinationLockPath(path.resolve(destination));
  try {
    await fs.mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new PublicSyncError(
        "DESTINATION_LOCKED",
        "Another public synchronization owns the destination lock",
      );
    }
    throw new PublicSyncError(
      "DESTINATION_LOCK_FAILED",
      "Unable to acquire destination lock",
      { cause: error },
    );
  }
  try {
    await syncDirectories([lockPath, path.dirname(lockPath)], durability);
    const identity = await pathIdentity(lockPath);
    assertStablePathIdentity(identity, "lock");
    return { path: lockPath, identity };
  } catch (error) {
    let cleanupError;
    try {
      await fs.rmdir(lockPath);
    } catch (caught) {
      cleanupError = caught;
    }
    throw new PublicSyncError(
      "DESTINATION_LOCK_FAILED",
      "Unable to capture stable destination lock identity",
      { cause: error, cleanupError },
    );
  }
}

async function assertLockIdentity(lock) {
  try {
    const current = await pathIdentity(lock.path);
    if (!samePathIdentity(current, lock.identity)) {
      throw new Error("lock identity changed");
    }
  } catch (error) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination lock changed during synchronization",
      { cause: error },
    );
  }
}

async function releaseDestinationLock(lock, durability) {
  try {
    await assertLockIdentity(lock);
    await fs.rmdir(lock.path);
    await syncDirectory(path.dirname(lock.path), durability);
  } catch (error) {
    if (error instanceof PublicSyncError) {
      throw error;
    }
    throw new PublicSyncError(
      "LOCK_RELEASE_FAILED",
      "Unable to release destination lock",
      { cause: error },
    );
  }
}

async function assertDestinationIdentity(snapshot, lock) {
  await assertLockIdentity(lock);
  let current;
  try {
    current = await resolveDestinationIdentity(snapshot.root);
  } catch (error) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination identity changed during synchronization",
      { cause: error },
    );
  }
  if (
    !samePathIdentity(current.rootIdentity, snapshot.rootIdentity) ||
    !samePathIdentity(current.gitIdentity, snapshot.gitIdentity) ||
    !sameFilesystemPath(current.gitDirectory, snapshot.gitDirectory)
  ) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination root or Git directory was replaced during synchronization",
    );
  }
}

async function assertDestinationSnapshot(snapshot, lock) {
  await assertDestinationIdentity(snapshot, lock);
  const status = await destinationStatus(snapshot.root);
  if (status.length > 0) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination cleanliness changed during synchronization",
    );
  }
  const managed = await validateDestinationManagedState(
    snapshot.root,
    snapshot.canonicalRoot,
  );
  if (
    managed.currentPaths.length !== snapshot.currentPaths.length ||
    managed.currentPaths.some(
      (publicPath, index) => publicPath !== snapshot.currentPaths[index],
    )
  ) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Managed destination paths changed during synchronization",
    );
  }
  const indexBytes = await fs.readFile(snapshot.indexPath);
  if (!indexBytes.equals(snapshot.indexBytes)) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination Git index changed during synchronization",
    );
  }
  const currentFiles = await snapshotManagedFiles(
    snapshot.root,
    managed.currentPaths,
  );
  for (const publicPath of snapshot.currentPaths) {
    const before = snapshot.managedFiles.get(publicPath);
    const current = currentFiles.get(publicPath);
    if (
      !before ||
      !current ||
      before.digest !== current.digest ||
      before.mode !== current.mode
    ) {
      throw new PublicSyncError(
        "DESTINATION_CHANGED",
        `Managed destination content or mode changed: ${publicPath}`,
        { path: publicPath },
      );
    }
  }
}

const MANAGED_UNITS = [...PUBLIC_ROOT_FILES, ...PUBLIC_ROOTS];

function managedUnitForPath(publicPath) {
  if (PUBLIC_ROOT_FILES.includes(publicPath)) {
    return publicPath;
  }
  return PUBLIC_ROOTS.find((root) => publicPath.startsWith(`${root}/`));
}

function planManagedUnits(snapshot, desiredEntries) {
  const currentPaths = new Set(snapshot.currentPaths);
  const desiredPaths = new Set(desiredEntries.map((entry) => entry.path));
  return MANAGED_UNITS.map((unit) => ({
    unit,
    hadOld:
      currentPaths.has(unit) ||
      [...currentPaths].some((entryPath) => entryPath.startsWith(`${unit}/`)),
    hasNew:
      desiredPaths.has(unit) ||
      [...desiredPaths].some((entryPath) => entryPath.startsWith(`${unit}/`)),
  })).filter(({ hadOld, hasNew }) => hadOld || hasNew);
}

function createDurabilityState() {
  return {
    directoryFsync: "not-attempted",
    unsupportedDirectorySyncCodes: new Set(),
    fileSyncCount: 0,
    stagedFileSyncCount: 0,
  };
}

function durabilitySummary(durability) {
  return {
    stagedFiles:
      durability.stagedFileSyncCount > 0 ? "fsynced" : "not-required",
    directoryFsync: durability.directoryFsync,
    recoveryProtocol: "hash-reconcile-v1",
    ...(durability.unsupportedDirectorySyncCodes.size > 0
      ? {
          unsupportedDirectorySyncCodes: [
            ...durability.unsupportedDirectorySyncCodes,
          ].sort(),
        }
      : {}),
  };
}

async function syncDirectory(directory, durability) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
    if (durability.directoryFsync === "not-attempted") {
      durability.directoryFsync = "supported";
    }
  } catch (error) {
    if (!["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error?.code)) {
      throw error;
    }
    durability.directoryFsync = "unsupported";
    durability.unsupportedDirectorySyncCodes.add(error.code);
  } finally {
    await handle?.close();
  }
}

async function syncDirectories(directories, durability) {
  for (const directory of [
    ...new Set(directories.map((entry) => path.resolve(entry))),
  ]) {
    await syncDirectory(directory, durability);
  }
}

async function writeDurableFile(
  target,
  content,
  mode,
  durability,
  { staged = false } = {},
) {
  const handle = await fs.open(target, "wx", mode);
  try {
    await handle.writeFile(content);
    await handle.chmod(mode);
    await handle.sync();
    durability.fileSyncCount += 1;
    if (staged) durability.stagedFileSyncCount += 1;
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(target), durability);
}

async function syncExistingFile(target, durability) {
  const handle = await fs.open(target, "r+");
  try {
    await handle.sync();
    durability.fileSyncCount += 1;
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(target), durability);
}

async function durableRename(
  source,
  target,
  durability,
  { finalValidate, onRenamed } = {},
) {
  const parents = [path.dirname(source), path.dirname(target)];
  await syncDirectories(parents, durability);
  if (finalValidate) await finalValidate();
  await fs.rename(source, target);
  if (onRenamed) onRenamed();
  try {
    await syncDirectories(parents, durability);
  } catch (error) {
    throw new PublicSyncError(
      "DURABLE_RENAME_POST_SYNC_FAILED",
      "A rename completed but its parent directory sync failed",
      { cause: error, renameApplied: true },
    );
  }
}

async function atomicWriteJson(target, value, durability) {
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeDurableFile(
      temporary,
      Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
      0o600,
      durability,
    );
    await durableRename(temporary, target, durability);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function serializeFileSnapshot(files) {
  return [...files.entries()]
    .map(([publicPath, metadata]) => ({
      path: publicPath,
      sha256: metadata.digest,
      mode: metadata.mode,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function prepareRecoveryWorkspace(
  snapshot,
  workspace,
  unitPlan,
  lock,
  desiredFiles,
  durability,
) {
  const backupRoot = path.join(workspace, "backup");
  await fs.mkdir(backupRoot, { recursive: false });
  await syncDirectories([backupRoot, workspace], durability);
  const originalIndexPath = path.join(workspace, "original-index");
  await writeDurableFile(
    originalIndexPath,
    snapshot.indexBytes,
    snapshot.indexMode,
    durability,
  );
  const persistedIndex = await fs.readFile(originalIndexPath);
  const persistedMode = (await fs.stat(originalIndexPath)).mode & 0o777;
  if (
    !persistedIndex.equals(snapshot.indexBytes) ||
    persistedMode !== snapshot.indexMode
  ) {
    throw new PublicSyncError(
      "RECOVERY_PREPARATION_FAILED",
      "The durable destination index recovery copy does not match",
    );
  }
  const journalPath = path.join(workspace, "journal.json");
  const journal = {
    version: 2,
    destinationRoot: snapshot.root,
    gitDirectory: snapshot.gitDirectory,
    lockPath: lock.path,
    phase: "prepared",
    movedOld: [],
    installedNew: [],
    indexState: "original",
    pending: null,
    originalIndex: {
      relativePath: path.basename(originalIndexPath),
      sha256: sha256Buffer(snapshot.indexBytes),
      mode: snapshot.indexMode,
    },
    destinationIdentity: {
      root: snapshot.rootIdentity,
      git: snapshot.gitIdentity,
    },
    lockIdentity: lock.identity,
    originalFiles: serializeFileSnapshot(snapshot.managedFiles),
    desiredFiles: serializeFileSnapshot(desiredFiles),
    durability: durabilitySummary(durability),
    units: unitPlan,
  };
  await atomicWriteJson(journalPath, journal, durability);
  return {
    workspace,
    backupRoot,
    journalPath,
    originalIndexPath,
    journal,
    durability,
  };
}

async function updateRecoveryJournal(recovery, patch) {
  Object.assign(recovery.journal, patch);
  recovery.journal.durability = durabilitySummary(recovery.durability);
  await atomicWriteJson(
    recovery.journalPath,
    recovery.journal,
    recovery.durability,
  );
}

function deserializeFileSnapshot(records, label) {
  if (!Array.isArray(records)) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_JOURNAL",
      `${label} file manifest is missing`,
    );
  }
  const files = new Map();
  for (const record of records) {
    if (
      !record ||
      typeof record.path !== "string" ||
      !/^[0-9a-f]{64}$/u.test(record.sha256) ||
      !Number.isInteger(record.mode) ||
      record.mode < 0 ||
      record.mode > 0o777
    ) {
      throw new PublicSyncError(
        "INVALID_RECOVERY_JOURNAL",
        `${label} file manifest is invalid`,
      );
    }
    assertPortablePublicPath(record.path);
    if (!managedUnitForPath(record.path) || files.has(record.path)) {
      throw new PublicSyncError(
        "INVALID_RECOVERY_JOURNAL",
        `${label} file manifest contains an invalid path`,
      );
    }
    files.set(record.path, { digest: record.sha256, mode: record.mode });
  }
  return files;
}

function snapshotForUnit(files, unit) {
  return new Map(
    [...files].filter(
      ([publicPath]) =>
        publicPath === unit || publicPath.startsWith(`${unit}/`),
    ),
  );
}

function sameFileSnapshot(left, right) {
  if (left.size !== right.size) return false;
  for (const [publicPath, expected] of right) {
    const actual = left.get(publicPath);
    if (
      !actual ||
      actual.digest !== expected.digest ||
      actual.mode !== expected.mode
    ) {
      return false;
    }
  }
  return true;
}

function classifyRecoveryUnit(actual, original, desired) {
  if (actual.size === 0) return "absent";
  const isOriginal = sameFileSnapshot(actual, original);
  const isDesired = sameFileSnapshot(actual, desired);
  if (isOriginal && isDesired) return "both";
  if (isOriginal) return "original";
  if (isDesired) return "desired";
  return "unknown";
}

function stateContains(state, kind) {
  return state === kind || state === "both";
}

async function snapshotRecoveryTree(root) {
  const paths = await collectManagedTreePaths(root);
  return snapshotManagedFiles(root, paths);
}

const TERMINAL_RECOVERY_PHASES = new Set([
  "committed",
  "finalized",
  "recovered",
]);

async function loadRecoveryWorkspace(recoveryPath) {
  const workspace = path.resolve(recoveryPath);
  let canonicalWorkspace;
  try {
    canonicalWorkspace = await fs.realpath(workspace);
  } catch (error) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_PATH",
      "Recovery workspace does not exist",
      { cause: error },
    );
  }
  if (!sameFilesystemPath(workspace, canonicalWorkspace)) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_PATH",
      "Recovery workspace must not be a symlink or junction",
    );
  }
  const journalPath = path.join(workspace, "journal.json");
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
  } catch (error) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_JOURNAL",
      "Unable to read recovery journal",
      { cause: error },
    );
  }
  if (
    journal?.version !== 2 ||
    typeof journal.destinationRoot !== "string" ||
    typeof journal.gitDirectory !== "string" ||
    typeof journal.lockPath !== "string" ||
    journal.originalIndex?.relativePath !== "original-index" ||
    !/^[0-9a-f]{64}$/u.test(journal.originalIndex?.sha256) ||
    !Number.isInteger(journal.originalIndex?.mode)
  ) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_JOURNAL",
      "Recovery journal is incomplete or unsupported",
    );
  }
  const destinationRoot = path.resolve(journal.destinationRoot);
  const expectedWorkspacePrefix = `.${path.basename(destinationRoot)}.public-sync-recovery-`;
  if (
    !sameFilesystemPath(
      path.dirname(workspace),
      path.dirname(destinationRoot),
    ) ||
    !path.basename(workspace).startsWith(expectedWorkspacePrefix) ||
    !sameFilesystemPath(journal.lockPath, destinationLockPath(destinationRoot))
  ) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_PATH",
      "Recovery workspace is not bound to its destination",
    );
  }
  const identity = await resolveDestinationIdentity(destinationRoot);
  if (
    !sameFilesystemPath(identity.gitDirectory, journal.gitDirectory) ||
    !samePathIdentity(
      identity.rootIdentity,
      journal.destinationIdentity?.root,
    ) ||
    !samePathIdentity(identity.gitIdentity, journal.destinationIdentity?.git)
  ) {
    throw new PublicSyncError(
      "RECOVERY_DESTINATION_CHANGED",
      "Recovery destination identity does not match the journal",
    );
  }
  const terminalPhase = TERMINAL_RECOVERY_PHASES.has(journal.phase);
  const lockIdentity = await pathIdentity(journal.lockPath).catch(() => null);
  if (
    (lockIdentity && !samePathIdentity(lockIdentity, journal.lockIdentity)) ||
    (!lockIdentity && !terminalPhase)
  ) {
    throw new PublicSyncError(
      "RECOVERY_LOCK_CHANGED",
      "Recovery lock is missing or has changed identity",
    );
  }
  const originalFiles = deserializeFileSnapshot(
    journal.originalFiles,
    "Original",
  );
  const desiredFiles = deserializeFileSnapshot(journal.desiredFiles, "Desired");
  const originalIndexPath = path.join(workspace, "original-index");
  let indexBytes = null;
  let indexStat = null;
  try {
    [indexBytes, indexStat] = await Promise.all([
      fs.readFile(originalIndexPath),
      fs.stat(originalIndexPath),
    ]);
  } catch (error) {
    if (!terminalPhase || error?.code !== "ENOENT") {
      throw new PublicSyncError(
        "INVALID_RECOVERY_JOURNAL",
        "Recovery index copy is unavailable",
        { cause: error },
      );
    }
  }
  if (
    indexBytes &&
    (sha256Buffer(indexBytes) !== journal.originalIndex.sha256 ||
      (indexStat.mode & 0o777) !== journal.originalIndex.mode)
  ) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_JOURNAL",
      "Recovery index copy does not match the journal",
    );
  }
  const durability = createDurabilityState();
  durability.stagedFileSyncCount = desiredFiles.size;
  if (journal.durability?.directoryFsync === "unsupported") {
    durability.directoryFsync = "unsupported";
  }
  for (const code of journal.durability?.unsupportedDirectorySyncCodes ?? []) {
    durability.unsupportedDirectorySyncCodes.add(code);
  }
  return {
    recovery: {
      workspace,
      journalPath,
      originalIndexPath,
      journal,
      durability,
    },
    snapshot: {
      ...identity,
      indexPath: await destinationIndexPath(destinationRoot),
      indexBytes,
      indexMode: journal.originalIndex.mode,
      currentPaths: [...originalFiles.keys()].sort(),
      managedFiles: originalFiles,
    },
    lock: lockIdentity
      ? { path: journal.lockPath, identity: journal.lockIdentity }
      : null,
    originalFiles,
    desiredFiles,
  };
}

async function assertRecoveryIdentity(
  snapshot,
  lock,
  allowMissingLock = false,
) {
  let current;
  try {
    current = await resolveDestinationIdentity(snapshot.root);
  } catch (error) {
    throw new PublicSyncError(
      "RECOVERY_DESTINATION_CHANGED",
      "Recovery destination identity changed",
      { cause: error },
    );
  }
  if (
    !sameFilesystemPath(current.gitDirectory, snapshot.gitDirectory) ||
    !samePathIdentity(current.rootIdentity, snapshot.rootIdentity) ||
    !samePathIdentity(current.gitIdentity, snapshot.gitIdentity)
  ) {
    throw new PublicSyncError(
      "RECOVERY_DESTINATION_CHANGED",
      "Recovery destination root or Git directory changed",
    );
  }
  if (!lock) {
    if (!allowMissingLock) {
      throw new PublicSyncError(
        "RECOVERY_LOCK_CHANGED",
        "Recovery lock is missing",
      );
    }
    return;
  }
  const currentLock = await pathIdentity(lock.path).catch(() => null);
  if (!currentLock || !samePathIdentity(currentLock, lock.identity)) {
    throw new PublicSyncError(
      "RECOVERY_LOCK_CHANGED",
      "Recovery lock is missing or changed identity",
    );
  }
}

async function captureRecoveryTrees(snapshot, backupRoot, stagedRoot) {
  try {
    const [destination, backup, staged] = await Promise.all([
      snapshotRecoveryTree(snapshot.root),
      snapshotRecoveryTree(backupRoot),
      snapshotRecoveryTree(stagedRoot),
    ]);
    return { destination, backup, staged };
  } catch (error) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Recovery transaction trees changed",
      { cause: error },
    );
  }
}

function assertKnownRecoveryTrees(states, originalFiles, desiredFiles) {
  for (const unit of MANAGED_UNITS) {
    const original = snapshotForUnit(originalFiles, unit);
    const desired = snapshotForUnit(desiredFiles, unit);
    for (const actual of Object.values(states)) {
      if (
        classifyRecoveryUnit(
          snapshotForUnit(actual, unit),
          original,
          desired,
        ) === "unknown"
      ) {
        throw new PublicSyncError(
          "RECOVERY_STATE_CHANGED",
          `Recovery transaction bytes or modes changed: ${unit}`,
        );
      }
    }
  }
}

async function assertRecoveryIndexUnchanged(indexPath, expectedIndex) {
  const current = await readIndexFileSnapshot(indexPath);
  if (
    !current.bytes.equals(expectedIndex.bytes) ||
    current.mode !== expectedIndex.mode
  ) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Recovery destination index changed",
    );
  }
}

async function assertRecoveryBoundary(context, rename = null) {
  const {
    snapshot,
    lock,
    backupRoot,
    stagedRoot,
    originalFiles,
    desiredFiles,
    expectedIndex,
  } = context;
  await assertRecoveryIdentity(snapshot, lock);
  const states = await captureRecoveryTrees(snapshot, backupRoot, stagedRoot);
  assertKnownRecoveryTrees(states, originalFiles, desiredFiles);
  await assertRecoveryIndexUnchanged(snapshot.indexPath, expectedIndex);
  if (!rename) return;
  const sourceState = states[rename.sourceTree];
  const targetState = states[rename.targetTree];
  const expectedSource = snapshotForUnit(
    rename.sourceKind === "original" ? originalFiles : desiredFiles,
    rename.unit,
  );
  if (
    !sameFileSnapshot(
      snapshotForUnit(sourceState, rename.unit),
      expectedSource,
    ) ||
    snapshotForUnit(targetState, rename.unit).size !== 0
  ) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      `Recovery rename source or target changed: ${rename.unit}`,
    );
  }
}

async function recoveryRename(
  context,
  { source, target, operation, unit, sourceTree, targetTree, sourceKind },
) {
  const { recovery, faultInjector } = context;
  await updateRecoveryJournal(recovery, {
    phase: "recovering",
    pending: { operation, unit },
  });
  const rename = { unit, sourceTree, targetTree, sourceKind };
  await assertRecoveryBoundary(context, rename);
  await callFaultInjector(faultInjector, {
    phase: "recovery-after-revalidate",
    operation,
    unit,
  });
  await assertRecoveryBoundary(context, rename);
  await durableRename(source, target, recovery.durability, {
    finalValidate: async () => {
      await callFaultInjector(faultInjector, {
        phase: "recovery-before-rename-final-validation",
        operation,
        unit,
      });
      await assertRecoveryBoundary(context, rename);
    },
  });
  await updateRecoveryJournal(recovery, {
    phase: "recovering",
    pending: null,
  });
}

async function assertTerminalRecoveryState({
  snapshot,
  lock,
  files,
  indexHash,
  indexMode,
}) {
  await assertRecoveryIdentity(snapshot, lock, true);
  try {
    await assertTreeSnapshot(snapshot.root, files, "Recovered destination");
  } catch (error) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Recovered destination bytes or modes changed",
      { cause: error },
    );
  }
  const currentIndex = await readIndexFileSnapshot(snapshot.indexPath);
  if (
    sha256Buffer(currentIndex.bytes) !== indexHash ||
    currentIndex.mode !== indexMode
  ) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Recovered destination index changed",
    );
  }
}

function finalizedTombstonePath(recoveryPath) {
  return `${path.resolve(recoveryPath)}.finalized.json`;
}

const FINALIZED_TOMBSTONE_KEYS = [
  "cleanupState",
  "destinationIdentity",
  "destinationRoot",
  "durability",
  "gitDirectory",
  "lockIdentity",
  "lockPath",
  "lockState",
  "outcome",
  "phase",
  "recoveryPath",
  "terminalFiles",
  "terminalIndex",
  "transactionId",
  "version",
  "workspaceIdentity",
];
const IDENTITY_KEYS = ["canonicalPath", "device", "inode"];
const TERMINAL_FILE_KEYS = ["mode", "path", "sha256"];
const TERMINAL_INDEX_KEYS = ["mode", "sha256"];
const DURABILITY_KEYS = ["directoryFsync", "recoveryProtocol", "stagedFiles"];
const DIRECTORY_SYNC_CODES = new Set(["EINVAL", "EISDIR", "ENOTSUP", "EPERM"]);

function invalidFinalizedTombstone() {
  return new PublicSyncError(
    "INVALID_RECOVERY_TOMBSTONE",
    "Finalized recovery tombstone is invalid",
  );
}

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expectedKeys].sort())
  );
}

function hasStableIdentitySchema(identity) {
  return (
    hasExactKeys(identity, IDENTITY_KEYS) &&
    typeof identity.canonicalPath === "string" &&
    typeof identity.device === "string" &&
    typeof identity.inode === "string" &&
    identity.inode !== "0"
  );
}

function assertFinalizedTombstoneSchema(tombstone) {
  try {
    if (
      !hasExactKeys(tombstone, FINALIZED_TOMBSTONE_KEYS) ||
      tombstone.version !== 1 ||
      tombstone.phase !== "finalized" ||
      !["committed", "rolled-back"].includes(tombstone.outcome) ||
      !["held", "released"].includes(tombstone.lockState) ||
      !["pending", "complete"].includes(tombstone.cleanupState) ||
      (tombstone.cleanupState === "complete" &&
        tombstone.lockState !== "released") ||
      typeof tombstone.recoveryPath !== "string" ||
      typeof tombstone.transactionId !== "string" ||
      tombstone.transactionId.length === 0 ||
      typeof tombstone.destinationRoot !== "string" ||
      typeof tombstone.gitDirectory !== "string" ||
      typeof tombstone.lockPath !== "string" ||
      !hasStableIdentitySchema(tombstone.workspaceIdentity) ||
      !hasStableIdentitySchema(tombstone.lockIdentity) ||
      !hasExactKeys(tombstone.destinationIdentity, ["git", "root"]) ||
      !hasStableIdentitySchema(tombstone.destinationIdentity.root) ||
      !hasStableIdentitySchema(tombstone.destinationIdentity.git) ||
      !hasExactKeys(tombstone.terminalIndex, TERMINAL_INDEX_KEYS) ||
      !/^[0-9a-f]{64}$/u.test(tombstone.terminalIndex.sha256) ||
      !Number.isInteger(tombstone.terminalIndex.mode) ||
      tombstone.terminalIndex.mode < 0 ||
      tombstone.terminalIndex.mode > 0o777 ||
      !Array.isArray(tombstone.terminalFiles)
    ) {
      throw invalidFinalizedTombstone();
    }

    const terminalPaths = [];
    const seenPaths = new Set();
    for (const record of tombstone.terminalFiles) {
      if (
        !hasExactKeys(record, TERMINAL_FILE_KEYS) ||
        typeof record.path !== "string" ||
        !/^[0-9a-f]{64}$/u.test(record.sha256) ||
        !Number.isInteger(record.mode) ||
        record.mode < 0 ||
        record.mode > 0o777
      ) {
        throw invalidFinalizedTombstone();
      }
      assertPortablePublicPath(record.path);
      if (!managedUnitForPath(record.path) || seenPaths.has(record.path)) {
        throw invalidFinalizedTombstone();
      }
      seenPaths.add(record.path);
      terminalPaths.push(record.path);
    }
    if (
      JSON.stringify(terminalPaths) !==
      JSON.stringify(
        [...terminalPaths].sort((left, right) => left.localeCompare(right)),
      )
    ) {
      throw invalidFinalizedTombstone();
    }

    const hasUnsupportedCodes = Object.prototype.hasOwnProperty.call(
      tombstone.durability,
      "unsupportedDirectorySyncCodes",
    );
    const durabilityKeys = hasUnsupportedCodes
      ? [...DURABILITY_KEYS, "unsupportedDirectorySyncCodes"]
      : DURABILITY_KEYS;
    if (
      !hasExactKeys(tombstone.durability, durabilityKeys) ||
      !["fsynced", "not-required"].includes(tombstone.durability.stagedFiles) ||
      !["not-attempted", "supported", "unsupported"].includes(
        tombstone.durability.directoryFsync,
      ) ||
      tombstone.durability.recoveryProtocol !== "hash-reconcile-v1"
    ) {
      throw invalidFinalizedTombstone();
    }
    if (
      (tombstone.durability.directoryFsync === "unsupported") !==
      hasUnsupportedCodes
    ) {
      throw invalidFinalizedTombstone();
    }
    if (hasUnsupportedCodes) {
      const codes = tombstone.durability.unsupportedDirectorySyncCodes;
      if (
        tombstone.durability.directoryFsync !== "unsupported" ||
        !Array.isArray(codes) ||
        codes.length === 0 ||
        codes.some(
          (code) => typeof code !== "string" || !DIRECTORY_SYNC_CODES.has(code),
        ) ||
        new Set(codes).size !== codes.length ||
        JSON.stringify(codes) !== JSON.stringify([...codes].sort())
      ) {
        throw invalidFinalizedTombstone();
      }
    }

    if (
      !sameFilesystemPath(
        tombstone.workspaceIdentity.canonicalPath,
        tombstone.recoveryPath,
      ) ||
      !sameFilesystemPath(
        tombstone.lockIdentity.canonicalPath,
        tombstone.lockPath,
      ) ||
      !sameFilesystemPath(
        tombstone.destinationIdentity.root.canonicalPath,
        tombstone.destinationRoot,
      ) ||
      !sameFilesystemPath(
        tombstone.destinationIdentity.git.canonicalPath,
        tombstone.gitDirectory,
      )
    ) {
      throw invalidFinalizedTombstone();
    }
  } catch (error) {
    if (error instanceof PublicSyncError) {
      if (error.code === "INVALID_RECOVERY_TOMBSTONE") throw error;
    }
    throw invalidFinalizedTombstone();
  }
}

function finalizedTombstoneBytes(tombstone) {
  return Buffer.from(`${JSON.stringify(tombstone, null, 2)}\n`, "utf8");
}

function bigintStatMode(stat) {
  return Number(stat.mode & 0o777n);
}

function identityFromBigintStat(canonicalPath, stat) {
  return {
    canonicalPath,
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
  };
}

function sameObjectIdentity(left, right) {
  return (
    left?.inode !== "0" &&
    right?.inode !== "0" &&
    (left?.device === right?.device || process.platform === "win32") &&
    left?.inode === right?.inode
  );
}

async function readVerifiedRegularFile(
  target,
  { code, message, expectedBytes, expectedAuthority, expectedMode },
) {
  const resolvedTarget = path.resolve(target);
  let handle;
  try {
    const before = await fs.lstat(resolvedTarget, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new PublicSyncError(code, message);
    }
    const canonicalPath = await fs.realpath(resolvedTarget);
    if (!sameFilesystemPath(canonicalPath, resolvedTarget)) {
      throw new PublicSyncError(code, message);
    }
    const beforeIdentity = identityFromBigintStat(canonicalPath, before);
    if (beforeIdentity.inode === "0") {
      throw new PublicSyncError(code, message);
    }
    const beforeMode = bigintStatMode(before);
    if (process.platform !== "win32" && beforeMode !== expectedMode) {
      throw new PublicSyncError(code, message);
    }
    if (
      expectedAuthority &&
      !sameObjectIdentity(beforeIdentity, expectedAuthority)
    ) {
      throw new PublicSyncError(code, message);
    }

    const noFollow =
      typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
    handle = await fs.open(resolvedTarget, fsConstants.O_RDONLY | noFollow);
    const openedBefore = await handle.stat({ bigint: true });
    const openedBeforeIdentity = identityFromBigintStat(
      canonicalPath,
      openedBefore,
    );
    if (
      !openedBefore.isFile() ||
      !sameObjectIdentity(beforeIdentity, openedBeforeIdentity) ||
      (process.platform !== "win32" &&
        bigintStatMode(openedBefore) !== expectedMode)
    ) {
      throw new PublicSyncError(code, message);
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const openedAfterIdentity = identityFromBigintStat(
      canonicalPath,
      openedAfter,
    );
    if (
      !openedAfter.isFile() ||
      !sameObjectIdentity(openedBeforeIdentity, openedAfterIdentity) ||
      (process.platform !== "win32" &&
        bigintStatMode(openedAfter) !== expectedMode) ||
      (expectedBytes && !bytes.equals(expectedBytes))
    ) {
      throw new PublicSyncError(code, message);
    }
    await handle.close();
    handle = undefined;

    const after = await fs.lstat(resolvedTarget, { bigint: true });
    const finalCanonicalPath = await fs.realpath(resolvedTarget);
    const afterIdentity = identityFromBigintStat(finalCanonicalPath, after);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      !sameFilesystemPath(finalCanonicalPath, resolvedTarget) ||
      !sameObjectIdentity(openedAfterIdentity, afterIdentity) ||
      (process.platform !== "win32" && bigintStatMode(after) !== expectedMode)
    ) {
      throw new PublicSyncError(code, message);
    }
    return { bytes, identity: afterIdentity, mode: bigintStatMode(after) };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof PublicSyncError && error.code === code) {
      throw error;
    }
    throw new PublicSyncError(code, message);
  }
}

async function readVerifiedFinalizedTombstone(
  tombstonePath,
  { expectedBytes, expectedAuthority } = {},
) {
  const verified = await readVerifiedRegularFile(tombstonePath, {
    code: "INVALID_RECOVERY_TOMBSTONE",
    message: "Finalized recovery tombstone verification failed",
    expectedBytes,
    expectedAuthority,
    expectedMode: 0o600,
  });
  let tombstone;
  try {
    tombstone = JSON.parse(UTF8_DECODER.decode(verified.bytes));
  } catch {
    throw invalidFinalizedTombstone();
  }
  assertFinalizedTombstoneSchema(tombstone);
  if (!verified.bytes.equals(finalizedTombstoneBytes(tombstone))) {
    throw invalidFinalizedTombstone();
  }
  return { ...verified, tombstone };
}

async function writeVerifiedFinalizedTombstone(
  tombstonePath,
  tombstone,
  durability,
) {
  assertFinalizedTombstoneSchema(tombstone);
  const expectedBytes = finalizedTombstoneBytes(tombstone);
  const temporary = `${tombstonePath}.tmp-${randomUUID()}`;
  let renameAuthority;
  try {
    await writeDurableFile(temporary, expectedBytes, 0o600, durability);
    await durableRename(temporary, tombstonePath, durability, {
      finalValidate: async () => {
        const verifiedTemporary = await readVerifiedRegularFile(temporary, {
          code: "INVALID_RECOVERY_TOMBSTONE",
          message: "Finalized recovery tombstone preparation failed",
          expectedBytes,
          expectedMode: 0o600,
        });
        renameAuthority = verifiedTemporary.identity;
      },
    });
    if (!renameAuthority) throw invalidFinalizedTombstone();
    const verified = await readVerifiedFinalizedTombstone(tombstonePath, {
      expectedBytes,
      expectedAuthority: renameAuthority,
    });
    return {
      bytes: expectedBytes,
      identity: verified.identity,
      tombstone: verified.tombstone,
    };
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (
      error instanceof PublicSyncError &&
      error.code === "INVALID_RECOVERY_TOMBSTONE"
    ) {
      throw error;
    }
    throw new PublicSyncError(
      "RECOVERY_TOMBSTONE_WRITE_FAILED",
      "Unable to persist the finalized recovery tombstone",
    );
  }
}

async function readExistingDirectoryIdentity(target, code, message) {
  const resolvedTarget = path.resolve(target);
  let before;
  try {
    before = await fs.lstat(resolvedTarget, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new PublicSyncError(code, message);
  }
  try {
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new PublicSyncError(code, message);
    }
    const canonicalPath = await fs.realpath(resolvedTarget);
    if (!sameFilesystemPath(canonicalPath, resolvedTarget)) {
      throw new PublicSyncError(code, message);
    }
    const followed = await fs.stat(resolvedTarget, { bigint: true });
    const after = await fs.lstat(resolvedTarget, { bigint: true });
    const finalCanonicalPath = await fs.realpath(resolvedTarget);
    const beforeIdentity = identityFromBigintStat(canonicalPath, before);
    const followedIdentity = identityFromBigintStat(canonicalPath, followed);
    const afterIdentity = identityFromBigintStat(finalCanonicalPath, after);
    if (
      !followed.isDirectory() ||
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      !sameFilesystemPath(finalCanonicalPath, resolvedTarget) ||
      !sameObjectIdentity(beforeIdentity, followedIdentity) ||
      !sameObjectIdentity(followedIdentity, afterIdentity)
    ) {
      throw new PublicSyncError(code, message);
    }
    return afterIdentity;
  } catch (error) {
    if (error instanceof PublicSyncError && error.code === code) throw error;
    throw new PublicSyncError(code, message);
  }
}

async function writeFinalizedTombstone(state, patch = {}) {
  const nextTombstone = {
    ...state.tombstone,
    ...patch,
    durability: durabilitySummary(state.durability),
  };
  const verified = await writeVerifiedFinalizedTombstone(
    state.tombstonePath,
    nextTombstone,
    state.durability,
  );
  state.tombstone = verified.tombstone;
  state.tombstoneBytes = verified.bytes;
  state.tombstoneAuthority = verified.identity;
}

async function assertFinalizedTombstoneAuthority(state) {
  if (!state.tombstoneBytes || !state.tombstoneAuthority) {
    throw invalidFinalizedTombstone();
  }
  await readVerifiedFinalizedTombstone(state.tombstonePath, {
    expectedBytes: state.tombstoneBytes,
    expectedAuthority: state.tombstoneAuthority,
  });
}

async function assertFinalizedWorkspaceIdentity(state) {
  const current = await readExistingDirectoryIdentity(
    state.recoveryPath,
    "RECOVERY_STATE_CHANGED",
    "Finalized recovery workspace changed identity",
  );
  if (!current) {
    if (state.tombstone.lockState === "held") {
      throw new PublicSyncError(
        "RECOVERY_STATE_CHANGED",
        "Finalized recovery workspace disappeared before lock release",
      );
    }
    return false;
  }
  if (
    state.tombstone.cleanupState === "complete" ||
    !samePathIdentity(current, state.tombstone.workspaceIdentity)
  ) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Finalized recovery workspace identity changed",
    );
  }
  return true;
}

async function assertFinalizedLockAuthority(state) {
  const current = await readExistingDirectoryIdentity(
    state.tombstone.lockPath,
    "RECOVERY_LOCK_CHANGED",
    "Finalized recovery lock changed identity",
  );
  if (state.tombstone.lockState === "released") {
    if (current) {
      throw new PublicSyncError(
        "RECOVERY_LOCK_CHANGED",
        "A finalized recovery lock was recreated",
      );
    }
    state.lock = null;
    return false;
  }
  if (!current) {
    state.lock = null;
    return false;
  }
  if (!samePathIdentity(current, state.tombstone.lockIdentity)) {
    throw new PublicSyncError(
      "RECOVERY_LOCK_CHANGED",
      "Finalized recovery lock changed identity",
    );
  }
  state.lock = {
    path: state.tombstone.lockPath,
    identity: state.tombstone.lockIdentity,
  };
  return true;
}

async function assertFinalizedTerminalAuthority(state) {
  await assertFinalizedTombstoneAuthority(state);
  await assertFinalizedLockAuthority(state);
  const workspaceBefore = await assertFinalizedWorkspaceIdentity(state);
  await assertTerminalRecoveryState({
    snapshot: state.snapshot,
    lock: state.lock,
    files: state.files,
    indexHash: state.tombstone.terminalIndex.sha256,
    indexMode: state.tombstone.terminalIndex.mode,
  });
  await assertFinalizedTombstoneAuthority(state);
  await assertFinalizedLockAuthority(state);
  const workspaceAfter = await assertFinalizedWorkspaceIdentity(state);
  await assertFinalizedTombstoneAuthority(state);
  await assertFinalizedLockAuthority(state);
  if (workspaceBefore !== workspaceAfter) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Finalized recovery workspace changed during terminal validation",
    );
  }
  return workspaceAfter;
}

const TERMINAL_INTEGRITY_CODES = new Set([
  "INVALID_RECOVERY_TOMBSTONE",
  "RECOVERY_DESTINATION_CHANGED",
  "RECOVERY_LOCK_CHANGED",
  "RECOVERY_STATE_CHANGED",
]);

function preserveTerminalIntegrityFailure(error) {
  if (
    error instanceof PublicSyncError &&
    TERMINAL_INTEGRITY_CODES.has(error.code)
  ) {
    error.preserveTerminalAuthority = true;
    return true;
  }
  return false;
}

async function finishFinalizedTombstone(
  state,
  faultInjector,
  { newlyPersisted = false } = {},
) {
  const warnings = [];
  const addCleanupWarning = () => {
    warnings.push({
      code: "CLEANUP_FAILED",
      message: "Synchronization is verified but recovery cleanup is incomplete",
      recoveryPath: state.recoveryPath,
      tombstonePath: state.tombstonePath,
    });
  };

  await assertFinalizedTerminalAuthority(state);
  if (newlyPersisted) {
    await callFaultInjector(faultInjector, {
      phase: "terminal-after-tombstone",
      outcome: state.tombstone.outcome,
    });
    await assertFinalizedTerminalAuthority(state);
  }

  if (state.tombstone.lockState === "held") {
    await assertFinalizedTerminalAuthority(state);
    if (state.lock) {
      await callFaultInjector(faultInjector, {
        phase: "recovery-after-revalidate",
        operation: "release-lock",
      });
      await assertFinalizedTerminalAuthority(state);
      const ownedLock = state.lock;
      await assertFinalizedTombstoneAuthority(state);
      await assertFinalizedWorkspaceIdentity(state);
      await releaseDestinationLock(ownedLock, state.durability);
      state.lock = null;
      await assertFinalizedLockAuthority(state);
      await assertFinalizedTombstoneAuthority(state);
      await assertFinalizedWorkspaceIdentity(state);
    }
    await callFaultInjector(faultInjector, {
      phase: "terminal-after-lock-release",
      outcome: state.tombstone.outcome,
    });
    await assertFinalizedTerminalAuthority(state);
    await writeFinalizedTombstone(state, { lockState: "released" });
    await assertFinalizedTerminalAuthority(state);
    await callFaultInjector(faultInjector, {
      phase: "terminal-after-lock-release-recorded",
      outcome: state.tombstone.outcome,
    });
    await assertFinalizedTerminalAuthority(state);
  }

  if (state.tombstone.cleanupState !== "complete") {
    await assertFinalizedTerminalAuthority(state);
    await callFaultInjector(faultInjector, {
      phase: "terminal-before-workspace-cleanup",
      outcome: state.tombstone.outcome,
    });
    let workspacePresent = await assertFinalizedTerminalAuthority(state);

    let cleanupFailed = false;
    try {
      await callFaultInjector(faultInjector, {
        phase: "cleanup",
        index: 0,
      });
    } catch (error) {
      if (preserveTerminalIntegrityFailure(error)) throw error;
      cleanupFailed = true;
      addCleanupWarning();
    }
    await assertFinalizedTerminalAuthority(state);

    if (!cleanupFailed && workspacePresent) {
      try {
        workspacePresent = await assertFinalizedTerminalAuthority(state);
        if (!workspacePresent) {
          throw new PublicSyncError(
            "RECOVERY_STATE_CHANGED",
            "Finalized recovery workspace disappeared before cleanup",
          );
        }
        await fs.rm(state.recoveryPath, { recursive: true, force: true });
        await syncDirectory(path.dirname(state.recoveryPath), state.durability);
      } catch (error) {
        if (error instanceof PublicSyncError) throw error;
        cleanupFailed = true;
        addCleanupWarning();
      }
      await assertFinalizedTerminalAuthority(state);
    }

    if (!cleanupFailed) {
      await callFaultInjector(faultInjector, {
        phase: "terminal-after-workspace-cleanup",
        outcome: state.tombstone.outcome,
      });
      await assertFinalizedTerminalAuthority(state);
      try {
        await writeFinalizedTombstone(state, { cleanupState: "complete" });
      } catch (error) {
        if (
          !(error instanceof PublicSyncError) ||
          error.code !== "RECOVERY_TOMBSTONE_WRITE_FAILED"
        ) {
          throw error;
        }
        await assertFinalizedTerminalAuthority(state);
        addCleanupWarning();
      }
      await assertFinalizedTerminalAuthority(state);
    }
  }

  await assertFinalizedTerminalAuthority(state);

  return {
    status:
      state.tombstone.outcome === "committed" ? "committed" : "rolled-back",
    finalized: true,
    verified: true,
    destinationRoot: state.snapshot.root,
    recoveryPath: state.recoveryPath,
    tombstonePath: state.tombstonePath,
    warnings,
    durability: durabilitySummary(state.durability),
  };
}

async function createFinalizedTombstoneState(
  { recovery, snapshot, lock, files, indexHash, indexMode },
  outcome,
) {
  const recoveryPath = recovery.workspace;
  const workspaceIdentity = await readExistingDirectoryIdentity(
    recoveryPath,
    "RECOVERY_STATE_CHANGED",
    "Finalized recovery workspace is unavailable",
  );
  if (!workspaceIdentity) {
    throw new PublicSyncError(
      "RECOVERY_STATE_CHANGED",
      "Finalized recovery workspace is unavailable",
    );
  }
  const tombstone = {
    version: 1,
    phase: "finalized",
    outcome,
    transactionId: path.basename(recoveryPath),
    recoveryPath,
    workspaceIdentity,
    destinationRoot: snapshot.root,
    gitDirectory: snapshot.gitDirectory,
    lockPath: recovery.journal.lockPath,
    destinationIdentity: {
      root: snapshot.rootIdentity,
      git: snapshot.gitIdentity,
    },
    lockIdentity: recovery.journal.lockIdentity,
    terminalFiles: serializeFileSnapshot(files),
    terminalIndex: { sha256: indexHash, mode: indexMode },
    lockState: "held",
    cleanupState: "pending",
    durability: durabilitySummary(recovery.durability),
  };
  return {
    recoveryPath,
    tombstonePath: finalizedTombstonePath(recoveryPath),
    tombstone,
    snapshot,
    lock,
    files,
    durability: recovery.durability,
  };
}

async function loadFinalizedTombstone(recoveryPath) {
  const resolvedRecoveryPath = path.resolve(recoveryPath);
  const tombstonePath = finalizedTombstonePath(resolvedRecoveryPath);
  let markerStat;
  try {
    markerStat = await fs.lstat(tombstonePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw invalidFinalizedTombstone();
  }
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw invalidFinalizedTombstone();
  }
  const verifiedMarker = await readVerifiedFinalizedTombstone(tombstonePath);
  const tombstone = verifiedMarker.tombstone;
  if (
    !sameFilesystemPath(tombstone.recoveryPath, resolvedRecoveryPath) ||
    tombstone.transactionId !== path.basename(resolvedRecoveryPath)
  ) {
    throw invalidFinalizedTombstone();
  }
  const destinationRoot = path.resolve(tombstone.destinationRoot);
  const expectedPrefix = `.${path.basename(destinationRoot)}.public-sync-recovery-`;
  if (
    !sameFilesystemPath(
      path.dirname(resolvedRecoveryPath),
      path.dirname(destinationRoot),
    ) ||
    !path.basename(resolvedRecoveryPath).startsWith(expectedPrefix) ||
    !sameFilesystemPath(
      tombstone.lockPath,
      destinationLockPath(destinationRoot),
    )
  ) {
    throw invalidFinalizedTombstone();
  }
  let identity;
  try {
    identity = await resolveDestinationIdentity(destinationRoot);
  } catch {
    throw new PublicSyncError(
      "RECOVERY_DESTINATION_CHANGED",
      "Finalized destination identity changed",
    );
  }
  if (
    !sameFilesystemPath(identity.gitDirectory, tombstone.gitDirectory) ||
    !samePathIdentity(
      identity.rootIdentity,
      tombstone.destinationIdentity?.root,
    ) ||
    !samePathIdentity(identity.gitIdentity, tombstone.destinationIdentity?.git)
  ) {
    throw new PublicSyncError(
      "RECOVERY_DESTINATION_CHANGED",
      "Finalized destination identity does not match its tombstone",
    );
  }
  const files = new Map(
    tombstone.terminalFiles.map((record) => [
      record.path,
      { digest: record.sha256, mode: record.mode },
    ]),
  );
  const durability = createDurabilityState();
  durability.stagedFileSyncCount = files.size;
  if (tombstone.durability?.directoryFsync === "unsupported") {
    durability.directoryFsync = "unsupported";
  }
  for (const code of tombstone.durability?.unsupportedDirectorySyncCodes ??
    []) {
    durability.unsupportedDirectorySyncCodes.add(code);
  }
  const state = {
    recoveryPath: resolvedRecoveryPath,
    tombstonePath,
    tombstone,
    tombstoneBytes: verifiedMarker.bytes,
    tombstoneAuthority: verifiedMarker.identity,
    snapshot: {
      ...identity,
      indexPath: await destinationIndexPath(destinationRoot),
    },
    lock: null,
    files,
    durability,
  };
  await assertFinalizedTerminalAuthority(state);
  return state;
}

async function finalizeRecoveryState(
  { recovery, snapshot, lock, originalFiles, desiredFiles },
  outcome,
  faultInjector,
  { cleanupPolicy = outcome === "rolled-back" ? "retain" : "remove" } = {},
) {
  const committed = outcome === "committed";
  const updatedIndex = recovery.journal.updatedIndex;
  if (
    committed &&
    (!/^[0-9a-f]{64}$/u.test(updatedIndex?.sha256) ||
      !Number.isInteger(updatedIndex?.mode))
  ) {
    throw new PublicSyncError(
      "INVALID_RECOVERY_JOURNAL",
      "Committed recovery journal has no verified destination index",
    );
  }
  const terminal = {
    snapshot,
    lock,
    files: committed ? desiredFiles : originalFiles,
    indexHash: committed
      ? updatedIndex.sha256
      : recovery.journal.originalIndex.sha256,
    indexMode: committed
      ? updatedIndex.mode
      : recovery.journal.originalIndex.mode,
  };
  await assertTerminalRecoveryState(terminal);
  if (!committed && cleanupPolicy === "retain") {
    await updateRecoveryJournal(recovery, {
      phase: "recovered",
      movedOld: [],
      installedNew: [],
      indexState: "original",
      pending: null,
    });
    await assertTerminalRecoveryState(terminal);
    if (lock) {
      await callFaultInjector(faultInjector, {
        phase: "recovery-after-revalidate",
        operation: "release-lock",
      });
      await assertTerminalRecoveryState(terminal);
      await releaseDestinationLock(lock, recovery.durability);
    }
    return {
      status: "rolled-back",
      finalized: true,
      verified: true,
      destinationRoot: snapshot.root,
      recoveryPath: recovery.workspace,
      warnings: [],
      durability: durabilitySummary(recovery.durability),
    };
  }
  const state = await createFinalizedTombstoneState(
    {
      recovery,
      snapshot,
      lock,
      files: terminal.files,
      indexHash: terminal.indexHash,
      indexMode: terminal.indexMode,
    },
    committed ? "committed" : "rolled-back",
  );
  await writeFinalizedTombstone(state);
  return finishFinalizedTombstone(state, faultInjector, {
    newlyPersisted: true,
  });
}

export async function recoverPublicSync({ recoveryPath, faultInjector } = {}) {
  if (!recoveryPath) {
    throw new PublicSyncError("INVALID_ARGUMENTS", "recoveryPath is required");
  }
  const finalized = await loadFinalizedTombstone(recoveryPath);
  if (finalized) {
    return finishFinalizedTombstone(finalized, faultInjector);
  }
  const { recovery, snapshot, lock, originalFiles, desiredFiles } =
    await loadRecoveryWorkspace(recoveryPath);
  if (["committed", "finalized"].includes(recovery.journal.phase)) {
    return finalizeRecoveryState(
      { recovery, snapshot, lock, originalFiles, desiredFiles },
      "committed",
      faultInjector,
    );
  }
  if (recovery.journal.phase === "recovered") {
    return finalizeRecoveryState(
      { recovery, snapshot, lock, originalFiles, desiredFiles },
      "rolled-back",
      faultInjector,
    );
  }
  const backupRoot = path.join(recovery.workspace, "backup");
  const stagedRoot = path.join(recovery.workspace, "staged");
  const states = await captureRecoveryTrees(snapshot, backupRoot, stagedRoot);
  const destinationState = states.destination;
  const backupState = states.backup;
  const stagedState = states.staged;
  const expectedIndex = await readIndexFileSnapshot(snapshot.indexPath);
  const context = {
    recovery,
    snapshot,
    lock,
    backupRoot,
    stagedRoot,
    originalFiles,
    desiredFiles,
    expectedIndex,
    faultInjector,
  };
  await assertRecoveryBoundary(context);

  for (const unit of MANAGED_UNITS) {
    const original = snapshotForUnit(originalFiles, unit);
    const desired = snapshotForUnit(desiredFiles, unit);
    const destination = classifyRecoveryUnit(
      snapshotForUnit(destinationState, unit),
      original,
      desired,
    );
    const backup = classifyRecoveryUnit(
      snapshotForUnit(backupState, unit),
      original,
      desired,
    );
    const staged = classifyRecoveryUnit(
      snapshotForUnit(stagedState, unit),
      original,
      desired,
    );
    if ([destination, backup, staged].includes("unknown")) {
      throw new PublicSyncError(
        "RECOVERY_STATE_INVALID",
        `Recovery state contains unknown bytes or modes: ${unit}`,
      );
    }
    if (
      original.size > 0 &&
      !stateContains(destination, "original") &&
      !stateContains(backup, "original")
    ) {
      throw new PublicSyncError(
        "RECOVERY_DATA_MISSING",
        `Original recovery data is missing: ${unit}`,
      );
    }
    if (
      desired.size > 0 &&
      ![destination, backup, staged].some((state) =>
        stateContains(state, "desired"),
      )
    ) {
      throw new PublicSyncError(
        "RECOVERY_DATA_MISSING",
        `Staged recovery data is missing: ${unit}`,
      );
    }
    if (
      stateContains(backup, "desired") &&
      !stateContains(backup, "original")
    ) {
      throw new PublicSyncError(
        "RECOVERY_STATE_INVALID",
        `Desired data is in the recovery backup: ${unit}`,
      );
    }

    if (original.size === 0) {
      if (stateContains(destination, "desired")) {
        if (staged !== "absent") {
          throw new PublicSyncError(
            "RECOVERY_STATE_INVALID",
            `Duplicate staged data prevents recovery: ${unit}`,
          );
        }
        await recoveryRename(context, {
          source: destinationPath(snapshot.root, unit),
          target: destinationPath(stagedRoot, unit),
          operation: "remove-new",
          unit,
          sourceTree: "destination",
          targetTree: "staged",
          sourceKind: "desired",
        });
      }
      continue;
    }
    if (stateContains(destination, "original")) continue;
    if (!stateContains(backup, "original")) {
      throw new PublicSyncError(
        "RECOVERY_DATA_MISSING",
        `Original backup is unavailable: ${unit}`,
      );
    }
    if (stateContains(destination, "desired")) {
      if (staged !== "absent") {
        throw new PublicSyncError(
          "RECOVERY_STATE_INVALID",
          `Duplicate staged data prevents recovery: ${unit}`,
        );
      }
      await recoveryRename(context, {
        source: destinationPath(snapshot.root, unit),
        target: destinationPath(stagedRoot, unit),
        operation: "preserve-new",
        unit,
        sourceTree: "destination",
        targetTree: "staged",
        sourceKind: "desired",
      });
    } else if (destination !== "absent") {
      throw new PublicSyncError(
        "RECOVERY_STATE_INVALID",
        `Destination cannot be reconciled: ${unit}`,
      );
    }
    await recoveryRename(context, {
      source: destinationPath(backupRoot, unit),
      target: destinationPath(snapshot.root, unit),
      operation: "restore-old",
      unit,
      sourceTree: "backup",
      targetTree: "destination",
      sourceKind: "original",
    });
  }

  if (
    !expectedIndex.bytes.equals(snapshot.indexBytes) ||
    expectedIndex.mode !== snapshot.indexMode
  ) {
    await updateRecoveryJournal(recovery, {
      phase: "recovering",
      pending: { operation: "restore-index" },
    });
    await assertRecoveryBoundary(context);
    await callFaultInjector(faultInjector, {
      phase: "recovery-after-revalidate",
      operation: "restore-index",
    });
    await assertRecoveryBoundary(context);
    await restoreDestinationIndex(
      snapshot,
      recovery,
      recovery.durability,
      async () => {
        await callFaultInjector(faultInjector, {
          phase: "recovery-before-rename-final-validation",
          operation: "restore-index",
        });
        await assertRecoveryBoundary(context);
      },
    );
  }
  return finalizeRecoveryState(
    { recovery, snapshot, lock, originalFiles, desiredFiles },
    "rolled-back",
    faultInjector,
  );
}

function recoveryErrorDetails(recovery, lock) {
  return {
    recoveryPath: recovery.workspace,
    journalPath: recovery.journalPath,
    originalIndexPath: recovery.originalIndexPath,
    lockPath: lock.path,
  };
}

async function collectManagedTreePaths(root) {
  const canonicalRoot = await fs.realpath(root);
  if (!sameFilesystemPath(canonicalRoot, root)) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "A transaction tree root changed identity",
    );
  }
  const currentPaths = [];
  for (const rootFile of PUBLIC_ROOT_FILES) {
    const stat = await lstatOrNull(destinationPath(root, rootFile));
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PublicSyncError(
        "DESTINATION_CHANGED",
        `Unsafe transaction root file: ${rootFile}`,
      );
    }
    currentPaths.push(rootFile);
  }
  for (const publicRoot of PUBLIC_ROOTS) {
    currentPaths.push(
      ...(await collectManagedFiles(root, canonicalRoot, publicRoot)),
    );
  }
  return currentPaths.sort();
}

async function assertTreeSnapshot(root, expected, label) {
  const currentPaths = await collectManagedTreePaths(root);
  const expectedPaths = [...expected.keys()].sort();
  if (
    currentPaths.length !== expectedPaths.length ||
    currentPaths.some(
      (publicPath, index) => publicPath !== expectedPaths[index],
    )
  ) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      `${label} managed paths changed during synchronization`,
    );
  }
  const currentFiles = await snapshotManagedFiles(root, currentPaths);
  for (const publicPath of expectedPaths) {
    const before = expected.get(publicPath);
    const current = currentFiles.get(publicPath);
    if (
      !before ||
      !current ||
      before.digest !== current.digest ||
      before.mode !== current.mode
    ) {
      throw new PublicSyncError(
        "DESTINATION_CHANGED",
        `${label} bytes or mode changed: ${publicPath}`,
        { path: publicPath },
      );
    }
  }
}

async function readIndexFileSnapshot(indexPath) {
  const [bytes, stat] = await Promise.all([
    fs.readFile(indexPath),
    fs.stat(indexPath),
  ]);
  return { bytes, mode: stat.mode & 0o777 };
}

function expectedTransactionTrees(snapshot, desiredFiles, transaction) {
  const destination = new Map();
  const backup = new Map();
  const staged = new Map();
  const movedOld = new Set(transaction.movedOld);
  const installedNew = new Set(transaction.installedNew);
  for (const [publicPath, metadata] of snapshot.managedFiles) {
    const unit = managedUnitForPath(publicPath);
    (movedOld.has(unit) ? backup : destination).set(publicPath, metadata);
  }
  for (const [publicPath, metadata] of desiredFiles) {
    const unit = managedUnitForPath(publicPath);
    (installedNew.has(unit) ? destination : staged).set(publicPath, metadata);
  }
  return { destination, backup, staged };
}

async function assertTransactionSnapshot({
  snapshot,
  lock,
  backupRoot,
  stagedRoot,
  desiredFiles,
  transaction,
  requireClean = false,
}) {
  await assertDestinationIdentity(snapshot, lock);
  const expectedIndex =
    transaction.indexState === "updated"
      ? transaction.updatedIndex
      : { bytes: snapshot.indexBytes, mode: snapshot.indexMode };
  const currentIndex = await readIndexFileSnapshot(snapshot.indexPath);
  if (
    !expectedIndex ||
    !currentIndex.bytes.equals(expectedIndex.bytes) ||
    currentIndex.mode !== expectedIndex.mode
  ) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination Git index bytes or mode changed during synchronization",
    );
  }
  if (requireClean && (await destinationStatus(snapshot.root)).length > 0) {
    throw new PublicSyncError(
      "DESTINATION_CHANGED",
      "Destination cleanliness changed during synchronization",
    );
  }
  const expected = expectedTransactionTrees(
    snapshot,
    desiredFiles,
    transaction,
  );
  await assertTreeSnapshot(snapshot.root, expected.destination, "Destination");
  await assertTreeSnapshot(backupRoot, expected.backup, "Recovery backup");
  await assertTreeSnapshot(stagedRoot, expected.staged, "Staged tree");
}

async function stageManagedTree(workspace, entries, durability) {
  const stagedRoot = path.join(workspace, "staged");
  try {
    await fs.mkdir(stagedRoot, { recursive: false });
    const stagedDirectories = new Set([workspace, stagedRoot]);
    for (const entry of entries) {
      const target = destinationPath(stagedRoot, entry.path);
      const targetDirectory = path.dirname(target);
      await fs.mkdir(targetDirectory, { recursive: true });
      let currentDirectory = targetDirectory;
      while (isInsideRoot(stagedRoot, currentDirectory)) {
        stagedDirectories.add(currentDirectory);
        if (sameFilesystemPath(currentDirectory, stagedRoot)) break;
        currentDirectory = path.dirname(currentDirectory);
      }
      await writeDurableFile(
        target,
        entry.content,
        entry.mode === "100755" ? 0o755 : 0o644,
        durability,
        { staged: true },
      );
    }
    await syncDirectories(
      [...stagedDirectories].sort((left, right) => right.length - left.length),
      durability,
    );
    return stagedRoot;
  } catch (error) {
    throw new PublicSyncError(
      "STAGING_FAILED",
      "Unable to stage the public tree",
      { cause: error },
    );
  }
}

async function callFaultInjector(faultInjector, context) {
  if (typeof faultInjector === "function") {
    await faultInjector(context);
  }
}

async function restoreDestinationIndex(
  snapshot,
  recovery,
  durability,
  beforeRename,
) {
  const persisted = await fs.readFile(recovery.originalIndexPath);
  const persistedMode =
    (await fs.stat(recovery.originalIndexPath)).mode & 0o777;
  if (
    !persisted.equals(snapshot.indexBytes) ||
    persistedMode !== snapshot.indexMode ||
    sha256Buffer(persisted) !== recovery.journal.originalIndex.sha256
  ) {
    throw new PublicSyncError(
      "INDEX_RESTORE_FAILED",
      "The durable destination index recovery copy is invalid",
      recoveryErrorDetails(recovery, { path: recovery.journal.lockPath }),
    );
  }
  const indexLockPath = `${snapshot.indexPath}.lock`;
  const expectedTarget = await readIndexFileSnapshot(snapshot.indexPath);
  let handle;
  let ownsLock = false;
  try {
    handle = await fs.open(indexLockPath, "wx", snapshot.indexMode);
    ownsLock = true;
    await handle.writeFile(persisted);
    await handle.chmod(snapshot.indexMode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const prepared = await readIndexFileSnapshot(indexLockPath);
    if (
      !prepared.bytes.equals(persisted) ||
      prepared.mode !== snapshot.indexMode
    ) {
      throw new PublicSyncError(
        "INDEX_RESTORE_FAILED",
        "The prepared destination index recovery file does not match",
      );
    }
    await durableRename(indexLockPath, snapshot.indexPath, durability, {
      finalValidate: async () => {
        if (beforeRename) await beforeRename();
        const [persistedFinal, preparedFinal, targetFinal] = await Promise.all([
          fs.readFile(recovery.originalIndexPath),
          readIndexFileSnapshot(indexLockPath),
          readIndexFileSnapshot(snapshot.indexPath),
        ]);
        const persistedFinalMode =
          (await fs.stat(recovery.originalIndexPath)).mode & 0o777;
        if (
          !persistedFinal.equals(snapshot.indexBytes) ||
          persistedFinalMode !== snapshot.indexMode ||
          sha256Buffer(persistedFinal) !==
            recovery.journal.originalIndex.sha256 ||
          !preparedFinal.bytes.equals(persistedFinal) ||
          preparedFinal.mode !== snapshot.indexMode ||
          !targetFinal.bytes.equals(expectedTarget.bytes) ||
          targetFinal.mode !== expectedTarget.mode
        ) {
          throw new PublicSyncError(
            "INDEX_RESTORE_FAILED",
            "The index restore source or live target changed before rename",
          );
        }
      },
    });
    ownsLock = false;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (ownsLock) {
      await fs.rm(indexLockPath, { force: true }).catch(() => {});
    }
    if (
      error instanceof PublicSyncError &&
      error.code.startsWith("RECOVERY_")
    ) {
      throw error;
    }
    throw new PublicSyncError(
      "INDEX_RESTORE_FAILED",
      "Unable to atomically restore the destination Git index",
      { cause: error },
    );
  }
  const restored = await readIndexFileSnapshot(snapshot.indexPath);
  if (
    !restored.bytes.equals(snapshot.indexBytes) ||
    restored.mode !== snapshot.indexMode
  ) {
    throw new PublicSyncError(
      "INDEX_RESTORE_FAILED",
      "The atomically restored destination Git index does not match",
    );
  }
}

async function updateDestinationIndex(
  destination,
  currentPaths,
  desiredEntries,
  indexPath,
  durability,
) {
  const managedPaths = [
    ...new Set([...currentPaths, ...desiredEntries.map((entry) => entry.path)]),
  ].sort();
  if (managedPaths.length > 0) {
    await runGit(destination, ["add", "-A", "--", ...managedPaths], {
      code: "INDEX_UPDATE_FAILED",
      message: "Unable to stage synchronized destination files",
    });
  }
  for (const entry of desiredEntries) {
    await runGit(
      destination,
      [
        "update-index",
        entry.mode === "100755" ? "--chmod=+x" : "--chmod=-x",
        "--",
        entry.path,
      ],
      {
        code: "INDEX_UPDATE_FAILED",
        message: `Unable to preserve Git mode for: ${entry.path}`,
      },
    );
  }
  await syncExistingFile(indexPath, durability);
}

async function assertDesiredManagedState(snapshot, lock, desiredEntries) {
  await assertDestinationIdentity(snapshot, lock);
  const managed = await validateDestinationManagedState(
    snapshot.root,
    snapshot.canonicalRoot,
  );
  const desiredPaths = desiredEntries.map((entry) => entry.path).sort();
  if (
    managed.currentPaths.length !== desiredPaths.length ||
    managed.currentPaths.some(
      (publicPath, index) => publicPath !== desiredPaths[index],
    )
  ) {
    throw new PublicSyncError(
      "APPLY_VALIDATION_FAILED",
      "Installed managed paths do not match the audited source tree",
    );
  }
  for (const entry of desiredEntries) {
    const installed = await fs.readFile(
      destinationPath(snapshot.root, entry.path),
    );
    const indexEntry = managed.index.get(entry.path);
    if (!installed.equals(entry.content) || indexEntry?.mode !== entry.mode) {
      throw new PublicSyncError(
        "APPLY_VALIDATION_FAILED",
        `Installed bytes or Git mode do not match: ${entry.path}`,
        { path: entry.path },
      );
    }
    if (process.platform !== "win32") {
      const actualMode = (
        await fs.stat(destinationPath(snapshot.root, entry.path))
      ).mode;
      const expectedExecutable = entry.mode === "100755";
      if (Boolean(actualMode & 0o111) !== expectedExecutable) {
        throw new PublicSyncError(
          "APPLY_VALIDATION_FAILED",
          `Installed executable mode does not match: ${entry.path}`,
          { path: entry.path },
        );
      }
    }
  }
}

async function applyManagedTree({
  snapshot,
  lock,
  stagedRoot,
  recovery,
  unitPlan,
  desiredFiles,
  desiredEntries,
  faultInjector,
}) {
  const backupRoot = recovery.backupRoot;
  const transaction = {
    movedOld: [],
    installedNew: [],
    indexState: "original",
    updatedIndex: null,
  };
  let indexMutationStarted = false;

  const assertCurrentTransaction = (requireClean = false) =>
    assertTransactionSnapshot({
      snapshot,
      lock,
      backupRoot,
      stagedRoot,
      desiredFiles,
      transaction,
      requireClean,
    });

  const finalValidateRename =
    (operation, index, unit, requireClean = false) =>
    async () => {
      await callFaultInjector(faultInjector, {
        phase: "before-rename-final-validation",
        operation,
        index,
        unit,
      });
      await assertCurrentTransaction(requireClean);
    };

  await callFaultInjector(faultInjector, {
    phase: "before-revalidate",
    index: 0,
  });
  await assertDestinationSnapshot(snapshot, lock);
  await assertCurrentTransaction(true);

  try {
    let backupIndex = 0;
    for (const { unit, hadOld } of unitPlan) {
      if (!hadOld) continue;
      backupIndex += 1;
      await updateRecoveryJournal(recovery, {
        phase: "backing-up",
        movedOld: [...transaction.movedOld],
        installedNew: [...transaction.installedNew],
        indexState: "original",
        pending: { operation: "backup", unit },
      });
      await assertCurrentTransaction(transaction.movedOld.length === 0);
      await callFaultInjector(faultInjector, {
        phase: "after-revalidate",
        operation: "backup",
        index: backupIndex,
        unit,
      });
      await assertCurrentTransaction(transaction.movedOld.length === 0);
      const current = destinationPath(snapshot.root, unit);
      const backup = destinationPath(backupRoot, unit);
      await durableRename(current, backup, recovery.durability, {
        finalValidate: finalValidateRename(
          "backup",
          backupIndex,
          unit,
          transaction.movedOld.length === 0,
        ),
        onRenamed: () => transaction.movedOld.push(unit),
      });
      await callFaultInjector(faultInjector, {
        phase: "after-durable-rename",
        operation: "backup",
        index: backupIndex,
        unit,
      });
      await updateRecoveryJournal(recovery, {
        phase: "backing-up",
        movedOld: [...transaction.movedOld],
        pending: null,
      });
      await callFaultInjector(faultInjector, {
        phase: "backup",
        index: backupIndex,
        unit,
      });
    }

    let installIndex = 0;
    for (const { unit, hasNew } of unitPlan) {
      if (!hasNew) continue;
      installIndex += 1;
      await updateRecoveryJournal(recovery, {
        phase: "installing",
        movedOld: [...transaction.movedOld],
        installedNew: [...transaction.installedNew],
        pending: { operation: "install", unit },
      });
      await assertCurrentTransaction();
      await callFaultInjector(faultInjector, {
        phase: "after-revalidate",
        operation: "install",
        index: installIndex,
        unit,
      });
      await assertCurrentTransaction();
      const staged = destinationPath(stagedRoot, unit);
      const target = destinationPath(snapshot.root, unit);
      await durableRename(staged, target, recovery.durability, {
        finalValidate: finalValidateRename("install", installIndex, unit),
        onRenamed: () => transaction.installedNew.push(unit),
      });
      await callFaultInjector(faultInjector, {
        phase: "after-durable-rename",
        operation: "install",
        index: installIndex,
        unit,
      });
      await updateRecoveryJournal(recovery, {
        phase: "installing",
        installedNew: [...transaction.installedNew],
        pending: null,
      });
      await callFaultInjector(faultInjector, {
        phase: "install",
        index: installIndex,
        unit,
      });
    }

    await updateRecoveryJournal(recovery, {
      phase: "updating-index",
      movedOld: [...transaction.movedOld],
      installedNew: [...transaction.installedNew],
      indexState: "updating",
      pending: { operation: "update-index" },
    });
    await assertCurrentTransaction();
    await callFaultInjector(faultInjector, {
      phase: "before-index-update",
      index: 0,
    });
    await assertCurrentTransaction();
    indexMutationStarted = true;
    transaction.indexState = "unknown";
    await updateDestinationIndex(
      snapshot.root,
      snapshot.currentPaths,
      desiredEntries,
      snapshot.indexPath,
      recovery.durability,
    );
    transaction.updatedIndex = await readIndexFileSnapshot(snapshot.indexPath);
    transaction.indexState = "updated";
    await updateRecoveryJournal(recovery, {
      phase: "index-updated",
      indexState: "updated",
      updatedIndex: {
        sha256: sha256Buffer(transaction.updatedIndex.bytes),
        mode: transaction.updatedIndex.mode,
      },
      pending: null,
    });
    await callFaultInjector(faultInjector, {
      phase: "after-index-update",
      index: 0,
    });
    await assertDesiredManagedState(snapshot, lock, desiredEntries);
    await updateRecoveryJournal(recovery, {
      phase: "committed",
      movedOld: [...transaction.movedOld],
      installedNew: [...transaction.installedNew],
      indexState: "updated",
      pending: null,
    });
    await callFaultInjector(faultInjector, {
      phase: "after-commit",
      index: 0,
    });
    return { committed: true, backupRoot };
  } catch (error) {
    if (error?.renameApplied) {
      try {
        await updateRecoveryJournal(recovery, {
          phase: "recovery-required",
          movedOld: [...transaction.movedOld],
          installedNew: [...transaction.installedNew],
          indexState: transaction.indexState,
        });
      } catch {
        // The already-durable pending record and tree hashes remain authoritative.
      }
      throw new PublicSyncError(
        "APPLY_ROLLBACK_FAILED",
        "A rename completed without a durable parent sync; recovery is required",
        {
          cause: error,
          ...recoveryErrorDetails(recovery, lock),
        },
      );
    }
    if (
      transaction.movedOld.length === 0 &&
      transaction.installedNew.length === 0 &&
      !indexMutationStarted
    ) {
      throw error;
    }
    try {
      let rollbackIndex = 0;
      await updateRecoveryJournal(recovery, {
        phase: "rolling-back",
        movedOld: [...transaction.movedOld],
        installedNew: [...transaction.installedNew],
        indexState: transaction.indexState,
        pending: null,
      });
      await assertCurrentTransaction();
      rollbackIndex += 1;
      await callFaultInjector(faultInjector, {
        phase: "rollback",
        index: rollbackIndex,
      });
      await assertCurrentTransaction();
      for (const unit of [...transaction.installedNew].reverse()) {
        await updateRecoveryJournal(recovery, {
          phase: "rolling-back",
          pending: { operation: "uninstall", unit },
        });
        await assertCurrentTransaction();
        const installed = destinationPath(snapshot.root, unit);
        const staged = destinationPath(stagedRoot, unit);
        await durableRename(installed, staged, recovery.durability, {
          finalValidate: finalValidateRename("uninstall", rollbackIndex, unit),
          onRenamed: () => {
            transaction.installedNew = transaction.installedNew.filter(
              (installedUnit) => installedUnit !== unit,
            );
          },
        });
        await updateRecoveryJournal(recovery, {
          installedNew: [...transaction.installedNew],
          pending: null,
        });
      }
      for (const unit of [...transaction.movedOld].reverse()) {
        await updateRecoveryJournal(recovery, {
          phase: "rolling-back",
          pending: { operation: "restore", unit },
        });
        await assertCurrentTransaction();
        const backup = destinationPath(backupRoot, unit);
        const target = destinationPath(snapshot.root, unit);
        await durableRename(backup, target, recovery.durability, {
          finalValidate: finalValidateRename("restore", rollbackIndex, unit),
          onRenamed: () => {
            transaction.movedOld = transaction.movedOld.filter(
              (movedUnit) => movedUnit !== unit,
            );
          },
        });
        await updateRecoveryJournal(recovery, {
          movedOld: [...transaction.movedOld],
          pending: null,
        });
      }
      if (indexMutationStarted) {
        await updateRecoveryJournal(recovery, {
          phase: "restoring-index",
          indexState: transaction.indexState,
          pending: { operation: "restore-index" },
        });
        await assertCurrentTransaction();
        await callFaultInjector(faultInjector, {
          phase: "before-index-restore",
          index: 0,
        });
        await assertCurrentTransaction();
        await restoreDestinationIndex(
          snapshot,
          recovery,
          recovery.durability,
          async () => {
            await callFaultInjector(faultInjector, {
              phase: "before-rename-final-validation",
              operation: "restore-index",
              index: 0,
            });
            await assertCurrentTransaction();
          },
        );
        transaction.indexState = "original";
        transaction.updatedIndex = null;
        await updateRecoveryJournal(recovery, {
          phase: "index-restored",
          indexState: "original",
          pending: null,
        });
      }
      await assertDestinationSnapshot(snapshot, lock);
      await updateRecoveryJournal(recovery, {
        phase: "rolled-back",
        movedOld: [],
        installedNew: [],
        indexState: "original",
        pending: null,
      });
    } catch (rollbackError) {
      try {
        await updateRecoveryJournal(recovery, {
          phase: "rollback-failed",
          movedOld: [...transaction.movedOld],
          installedNew: [...transaction.installedNew],
          indexState: transaction.indexState,
        });
      } catch {
        // Keep the last atomically persisted journal and every recovery file.
      }
      throw new PublicSyncError(
        "APPLY_ROLLBACK_FAILED",
        "Public tree apply and rollback both failed",
        {
          cause: error,
          rollbackError,
          ...recoveryErrorDetails(recovery, lock),
        },
      );
    }
    throw new PublicSyncError(
      "APPLY_FAILED",
      "Public tree apply failed and was rolled back",
      {
        cause: error,
      },
    );
  }
}

export async function materializePublicTree({
  sourceRepo,
  sourceRef,
  destination,
  dryRun = false,
  faultInjector,
}) {
  if (!sourceRepo || !sourceRef || !destination) {
    throw new PublicSyncError(
      "INVALID_ARGUMENTS",
      "sourceRepo, sourceRef, and destination are required",
    );
  }
  const listed = await listPublicFiles({ sourceRepo, sourceRef });
  const audited = await auditPublicEntries(listed.entries);
  const durability = createDurabilityState();
  const lock = await acquireDestinationLock(
    path.resolve(destination),
    durability,
  );
  const warnings = [];
  let result;
  let failure;
  let terminalLockReleased = false;
  try {
    const snapshot = await captureDestinationSnapshot(destination);
    const desired = new Map(
      audited.entries.map((entry) => [entry.path, entry]),
    );
    const currentPathSet = new Set(snapshot.currentPaths);
    const added = [];
    const changed = [];
    for (const entry of audited.entries) {
      if (!currentPathSet.has(entry.path)) {
        added.push(entry.path);
        continue;
      }
      const absolutePath = destinationPath(snapshot.root, entry.path);
      const [current, stat] = await Promise.all([
        fs.readFile(absolutePath),
        fs.stat(absolutePath),
      ]);
      const currentMode = snapshot.index.get(entry.path)?.mode;
      const physicalModeMismatch =
        process.platform !== "win32" &&
        Boolean(stat.mode & 0o111) !== (entry.mode === "100755");
      if (
        !current.equals(entry.content) ||
        currentMode !== entry.mode ||
        physicalModeMismatch
      ) {
        changed.push(entry.path);
      }
    }
    const removed = snapshot.currentPaths.filter(
      (publicPath) => !desired.has(publicPath),
    );
    added.sort();
    changed.sort();
    removed.sort();

    if (
      !dryRun &&
      (added.length > 0 || changed.length > 0 || removed.length > 0)
    ) {
      assertStablePathIdentity(snapshot.rootIdentity, "root");
      assertStablePathIdentity(snapshot.gitIdentity, "Git directory");
      assertStablePathIdentity(lock.identity, "lock");
      const unitPlan = planManagedUnits(snapshot, audited.entries);
      const workspace = path.join(
        path.dirname(snapshot.root),
        `.${path.basename(snapshot.root)}.public-sync-recovery-${randomUUID()}`,
      );
      await fs.mkdir(workspace, { recursive: false });
      await syncDirectories([workspace, path.dirname(workspace)], durability);
      let recovery;
      let desiredFiles;
      try {
        const stagedRoot = await stageManagedTree(
          workspace,
          audited.entries,
          durability,
        );
        desiredFiles = await snapshotManagedFiles(
          stagedRoot,
          audited.entries.map((entry) => entry.path),
        );
        recovery = await prepareRecoveryWorkspace(
          snapshot,
          workspace,
          unitPlan,
          lock,
          desiredFiles,
          durability,
        );
        await callFaultInjector(faultInjector, {
          phase: "after-prepare",
          index: 0,
        });
        await applyManagedTree({
          snapshot,
          lock,
          stagedRoot,
          recovery,
          unitPlan,
          desiredFiles,
          desiredEntries: audited.entries,
          faultInjector,
        });
      } catch (error) {
        if (error?.code === "APPLY_FAILED" && recovery && desiredFiles) {
          try {
            const terminal = await finalizeRecoveryState(
              {
                recovery,
                snapshot,
                lock,
                originalFiles: snapshot.managedFiles,
                desiredFiles,
              },
              "rolled-back",
              faultInjector,
              { cleanupPolicy: "remove" },
            );
            terminalLockReleased = true;
            warnings.push(...terminal.warnings);
          } catch (terminalError) {
            if (preserveTerminalIntegrityFailure(terminalError)) {
              throw terminalError;
            }
            throw new PublicSyncError(
              "APPLY_ROLLBACK_FAILED",
              "Rollback succeeded but durable terminal finalization failed",
              {
                cause: error,
                terminalError,
                ...recoveryErrorDetails(recovery, lock),
              },
            );
          }
          throw error;
        }
        if (error?.code !== "APPLY_ROLLBACK_FAILED") {
          await fs.rm(workspace, { recursive: true, force: true });
          await syncDirectory(path.dirname(workspace), durability);
        }
        throw error;
      }
      try {
        const terminal = await finalizeRecoveryState(
          {
            recovery,
            snapshot,
            lock,
            originalFiles: snapshot.managedFiles,
            desiredFiles,
          },
          "committed",
          faultInjector,
        );
        terminalLockReleased = true;
        warnings.push(...terminal.warnings);
      } catch (terminalError) {
        if (preserveTerminalIntegrityFailure(terminalError)) {
          throw terminalError;
        }
        throw new PublicSyncError(
          "APPLY_ROLLBACK_FAILED",
          "Committed synchronization requires terminal recovery",
          {
            cause: terminalError,
            ...recoveryErrorDetails(recovery, lock),
          },
        );
      }
    }

    result = {
      sourceCommit: listed.sourceCommit,
      dryRun: Boolean(dryRun),
      added,
      changed,
      removed,
      ignored: listed.ignored,
      warnings,
      durability: durabilitySummary(durability),
    };
  } catch (error) {
    failure = error;
  }

  if (failure?.code === "APPLY_ROLLBACK_FAILED") {
    failure.lockPath = lock.path;
  } else if (!failure?.preserveTerminalAuthority && !terminalLockReleased) {
    try {
      await releaseDestinationLock(lock, durability);
    } catch (lockError) {
      if (failure) {
        failure.lockReleaseError = lockError;
      } else {
        warnings.push({
          code: "LOCK_RELEASE_FAILED",
          message: "Synchronization completed but the cooperative lock remains",
          lockPath: lock.path,
        });
      }
    }
  }
  if (failure) {
    throw failure;
  }
  result.durability = durabilitySummary(durability);
  return result;
}
