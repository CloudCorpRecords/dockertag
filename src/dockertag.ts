/**
 * dockertag core: container image tag and OCI label audit.
 *
 *   auditImageTags(args) -> audit
 *
 * Reference parsing (pinned):
 *
 *   - If the reference contains "@", everything after the
 *     LAST "@" is the digest and everything before it is
 *     the name part.
 *   - In the name part, a tag is present when the final
 *     path segment (after the last "/") contains a ":"; the
 *     tag is the text after the LAST ":" in that segment
 *     and the repository path is what precedes it. A colon
 *     in an earlier segment (a registry port) is never a
 *     tag separator.
 *   - The registry is the first path segment of the
 *     repository path when it contains a "." or a ":" or
 *     equals "localhost"; otherwise the registry is
 *     "docker.io". The repository is the path after the
 *     registry segment, or the whole path when the
 *     registry was defaulted.
 *   - A reference is INVALID when the name part is empty,
 *     the repository is empty, or a present tag is empty.
 *
 * Checks run in this exact order, and an image may collect
 * several findings (INVALID_REFERENCE suppresses the rest,
 * and its parsed fields are all null):
 *
 *   1. INVALID_REFERENCE        (error)
 *   2. INVALID_DIGEST           (error)
 *   3. UPPERCASE_REPOSITORY     (error)
 *   4. UNPINNED                 (error)
 *   5. LATEST_TAG               (warning)
 *   6. MISSING_SOURCE_LABEL     (warning)
 *   7. MISSING_LICENSE_LABEL    (warning)
 *   8. MISSING_SERVER_NAME_LABEL (error, only when an
 *      expected server name is supplied)
 *   9. SERVER_NAME_MISMATCH     (error, only when an
 *      expected server name is supplied)
 *
 * Validation is strict and path-naming: any malformed
 * input throws an Error naming the offending path (for
 * example "images[1].reference must be a non-empty
 * string") and no partial result is produced.
 */
import type {
  DockerTagFinding,
  DockerTagImage,
  DockerTagImageEntry,
  DockerTagResult,
  DockerTagSeverity,
} from "./types.js";

export const VERSION = "0.1.0";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCE_LABEL = "org.opencontainers.image.source";
const LICENSE_LABEL = "org.opencontainers.image.licenses";
const SERVER_NAME_LABEL = "io.modelcontextprotocol.server.name";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the raw arguments object and return the
 * normalised image list plus the expected server name
 * (undefined when not supplied). The expected server name
 * is validated after the images array's presence/shape but
 * before the individual image entries, matching the fleet
 * pattern for top-level options.
 */
function validateArgs(args: unknown): {
  images: DockerTagImage[];
  expectedServerName: string | undefined;
} {
  const raw: Record<string, unknown> = isRecord(args) ? args : {};

  if (raw.images === undefined) throw new Error("images is required");
  if (!Array.isArray(raw.images) || raw.images.length === 0) {
    throw new Error("images must be a non-empty array");
  }

  let expectedServerName: string | undefined;
  if (raw.expected_server_name !== undefined) {
    if (
      typeof raw.expected_server_name !== "string" ||
      raw.expected_server_name.length === 0
    ) {
      throw new Error("expected_server_name must be a non-empty string");
    }
    expectedServerName = raw.expected_server_name;
  }

  const images: DockerTagImage[] = [];
  const indexByReference = new Map<string, number>();
  raw.images.forEach((entry, i) => {
    const path = `images[${i}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    if (entry.reference === undefined) {
      throw new Error(`${path}.reference is required`);
    }
    if (typeof entry.reference !== "string" || entry.reference.length === 0) {
      throw new Error(`${path}.reference must be a non-empty string`);
    }
    const firstIndex = indexByReference.get(entry.reference);
    if (firstIndex !== undefined) {
      throw new Error(
        `${path}.reference duplicates images[${firstIndex}].reference "${entry.reference}"`,
      );
    }
    indexByReference.set(entry.reference, i);

    let labels: Record<string, string> | undefined;
    if (entry.labels !== undefined) {
      if (!isRecord(entry.labels)) {
        throw new Error(`${path}.labels must be an object`);
      }
      labels = {};
      for (const [key, value] of Object.entries(entry.labels)) {
        if (typeof value !== "string") {
          throw new Error(`${path}.labels.${key} must be a string`);
        }
        labels[key] = value;
      }
    }

    images.push({ reference: entry.reference, labels });
  });

  return { images, expectedServerName };
}

/** The fields parsed out of one reference. */
interface ParsedReference {
  registry: string;
  repository: string;
  tag: string | null;
  digest: string | null;
}

/**
 * Parse one reference, or return null when it is invalid:
 * the name part is empty, the repository is empty, or a
 * present tag is empty.
 */
function parseReference(reference: string): ParsedReference | null {
  let namePart = reference;
  let digest: string | null = null;
  const at = reference.lastIndexOf("@");
  if (at >= 0) {
    digest = reference.slice(at + 1);
    namePart = reference.slice(0, at);
  }
  if (namePart.length === 0) return null;

  // A tag lives only in the final path segment.
  let repositoryPath = namePart;
  let tag: string | null = null;
  const lastSlash = namePart.lastIndexOf("/");
  const finalSegment = namePart.slice(lastSlash + 1);
  const colon = finalSegment.lastIndexOf(":");
  if (colon >= 0) {
    tag = finalSegment.slice(colon + 1);
    if (tag.length === 0) return null;
    repositoryPath = namePart.slice(0, lastSlash + 1 + colon);
  }

  const segments = repositoryPath.split("/");
  const first = segments[0] ?? "";
  let registry = "docker.io";
  let repository = repositoryPath;
  if (first.includes(".") || first.includes(":") || first === "localhost") {
    registry = first;
    repository = segments.slice(1).join("/");
  }
  if (repository.length === 0) return null;

  return { registry, repository, tag, digest };
}

function finding(
  reference: string,
  code: string,
  severity: DockerTagSeverity,
  message: string,
): DockerTagFinding {
  return { reference, code, severity, message };
}

/** Run the checks, in order, for one image. */
function auditOne(
  image: DockerTagImage,
  expectedServerName: string | undefined,
): { entry: DockerTagImageEntry; findings: DockerTagFinding[] } {
  const { reference, labels } = image;
  const parsed = parseReference(reference);

  if (parsed === null) {
    const findings = [
      finding(reference, "INVALID_REFERENCE", "error", "reference cannot be parsed"),
    ];
    return {
      entry: {
        reference,
        registry: null,
        repository: null,
        tag: null,
        digest: null,
        findings: findings.map((f) => f.code),
      },
      findings,
    };
  }

  const findings: DockerTagFinding[] = [];
  const { registry, repository, tag, digest } = parsed;

  if (digest !== null && !DIGEST_PATTERN.test(digest)) {
    findings.push(
      finding(
        reference,
        "INVALID_DIGEST",
        "error",
        "digest is not a sha256 digest of the form sha256:<64 lowercase hex>",
      ),
    );
  }
  if (/[A-Z]/.test(repository)) {
    findings.push(
      finding(
        reference,
        "UPPERCASE_REPOSITORY",
        "error",
        `repository ${repository} contains uppercase characters`,
      ),
    );
  }
  if (tag === null && digest === null) {
    findings.push(
      finding(
        reference,
        "UNPINNED",
        "error",
        "no tag or digest: the reference resolves to the mutable latest tag",
      ),
    );
  }
  if (tag === "latest" && digest === null) {
    findings.push(
      finding(
        reference,
        "LATEST_TAG",
        "warning",
        "tag latest is mutable; pin a version or digest",
      ),
    );
  }
  if (labels === undefined || !(SOURCE_LABEL in labels)) {
    findings.push(
      finding(
        reference,
        "MISSING_SOURCE_LABEL",
        "warning",
        `missing label ${SOURCE_LABEL}`,
      ),
    );
  }
  if (labels === undefined || !(LICENSE_LABEL in labels)) {
    findings.push(
      finding(
        reference,
        "MISSING_LICENSE_LABEL",
        "warning",
        `missing label ${LICENSE_LABEL}`,
      ),
    );
  }
  if (expectedServerName !== undefined) {
    if (labels === undefined || !(SERVER_NAME_LABEL in labels)) {
      findings.push(
        finding(
          reference,
          "MISSING_SERVER_NAME_LABEL",
          "error",
          `missing label ${SERVER_NAME_LABEL}`,
        ),
      );
    } else if (labels[SERVER_NAME_LABEL] !== expectedServerName) {
      findings.push(
        finding(
          reference,
          "SERVER_NAME_MISMATCH",
          "error",
          `server-name label is ${labels[SERVER_NAME_LABEL]}, expected ${expectedServerName}`,
        ),
      );
    }
  }

  return {
    entry: {
      reference,
      registry,
      repository,
      tag,
      digest,
      findings: findings.map((f) => f.code),
    },
    findings,
  };
}

/** Audit the supplied image references and OCI labels. */
export function auditImageTags(args: unknown): DockerTagResult {
  const { images, expectedServerName } = validateArgs(args);

  const entries: DockerTagImageEntry[] = [];
  const findings: DockerTagFinding[] = [];
  for (const image of images) {
    const one = auditOne(image, expectedServerName);
    entries.push(one.entry);
    findings.push(...one.findings);
  }

  const counts = {
    images: entries.length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    clean: entries.filter((e) => e.findings.length === 0).length,
  };

  return { images: entries, findings, counts };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
