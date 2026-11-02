/**
 * dockertag types.
 *
 * dockertag audits container image references and the OCI
 * labels present on the images. The caller supplies the
 * references exactly as written and, per image, the labels
 * found on that image, plus optionally the expected value
 * of the MCP Registry server-name label. From that data
 * alone, as pure local computation, dockertag reports:
 *
 *   - for every image, the parsed registry, repository,
 *     tag, and digest (null when absent, and all null when
 *     the reference cannot be parsed)
 *   - every finding, with its code, severity, and exact
 *     message, ordered by image input order then check
 *     order
 *   - counts of images, error findings, warning findings,
 *     and clean images (images with zero findings)
 *
 * An audit is a report, not a fetch: nothing here pulls an
 * image, contacts a registry, or reads a label off a live
 * image. The caller supplies the labels to check.
 */

/** One image to audit, as supplied by the caller. */
export interface DockerTagImage {
  /** Full image reference as written; unique across the set. */
  reference: string;
  /**
   * OCI labels present on the image, as a string-to-string
   * map. Absent when no labels were supplied.
   */
  labels?: Record<string, string>;
}

/** The severity of one finding. */
export type DockerTagSeverity = "error" | "warning";

/** The parsed fields and finding codes for one image. */
export interface DockerTagImageEntry {
  /** The reference exactly as supplied. */
  reference: string;
  /** The registry segment, or "docker.io" when defaulted; null when unparseable. */
  registry: string | null;
  /** The repository path after the registry segment; null when unparseable. */
  repository: string | null;
  /** The tag, or null when no tag is present or the reference is unparseable. */
  tag: string | null;
  /** The digest, or null when no digest is present or the reference is unparseable. */
  digest: string | null;
  /** This image's finding codes, in check order. */
  findings: string[];
}

/** One finding against one image. */
export interface DockerTagFinding {
  /** The reference the finding is about. */
  reference: string;
  /** The finding code, e.g. "UNPINNED". */
  code: string;
  /** Whether the finding is an error or a warning. */
  severity: DockerTagSeverity;
  /** The finding's exact message. */
  message: string;
}

/** Tallies over the whole audit. */
export interface DockerTagCounts {
  /** How many images were audited. */
  images: number;
  /** How many findings have severity "error". */
  errors: number;
  /** How many findings have severity "warning". */
  warnings: number;
  /** How many images collected zero findings. */
  clean: number;
}

/** The image tag and label audit. */
export interface DockerTagResult {
  /** Per-image parsed fields and finding codes, in input order. */
  images: DockerTagImageEntry[];
  /** Every finding, by image input order then check order. */
  findings: DockerTagFinding[];
  /** Tallies over the audit. */
  counts: DockerTagCounts;
}
