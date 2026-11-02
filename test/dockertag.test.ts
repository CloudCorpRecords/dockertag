import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditImageTags } from "../src/dockertag.js";

/**
 * All tests are pure local computation over inline image
 * references and labels: no filesystem, no network, no
 * registry. Reference parsing is pinned (digest at the
 * last "@", a tag colon only in the final path segment,
 * localhost as a registry), the nine findings are pinned
 * with their exact messages and check order,
 * INVALID_REFERENCE is pinned as suppressing every other
 * check, the server-name checks are pinned as running
 * only when an expected server name is supplied, and every
 * validation path is pinned with its path-naming message.
 */

const HEX = "0123456789abcdef".repeat(4);
const DIGEST = `sha256:${HEX}`;

const GOOD_LABELS: Record<string, string> = {
  "org.opencontainers.image.source": "https://github.com/CloudCorpRecords/dockertag",
  "org.opencontainers.image.licenses": "MIT",
};

const SERVER_NAME = "io.github.CloudCorpRecords/dockertag";
const LABELS_WITH_SERVER: Record<string, string> = {
  ...GOOD_LABELS,
  "io.modelcontextprotocol.server.name": SERVER_NAME,
};

type ImageInput = Record<string, unknown>;

const img = (over: ImageInput): ImageInput => ({
  reference: "ghcr.io/owner/repo:1.2.3",
  labels: { ...GOOD_LABELS },
  ...over,
});

const one = (image: ImageInput, extra: ImageInput = {}) =>
  auditImageTags({ images: [image], ...extra });

const codes = (image: ImageInput, extra: ImageInput = {}) =>
  one(image, extra).images[0].findings;

describe("auditImageTags — reference parsing", () => {
  it("parses registry, repository, and tag from a fully qualified reference", () => {
    const out = one(img({}));
    assert.deepEqual(out.images[0], {
      reference: "ghcr.io/owner/repo:1.2.3",
      registry: "ghcr.io",
      repository: "owner/repo",
      tag: "1.2.3",
      digest: null,
      findings: [],
    });
  });

  it("defaults the registry to docker.io for a bare repository", () => {
    const out = one(img({ reference: "owner/repo:2.0" }));
    assert.equal(out.images[0].registry, "docker.io");
    assert.equal(out.images[0].repository, "owner/repo");
    assert.equal(out.images[0].tag, "2.0");
  });

  it("defaults the registry to docker.io for a single-segment repository", () => {
    const out = one(img({ reference: "repo:1.0" }));
    assert.equal(out.images[0].registry, "docker.io");
    assert.equal(out.images[0].repository, "repo");
  });

  it("treats localhost as a registry even without a dot or port", () => {
    const out = one(img({ reference: "localhost/myimg:2" }));
    assert.equal(out.images[0].registry, "localhost");
    assert.equal(out.images[0].repository, "myimg");
    assert.equal(out.images[0].tag, "2");
  });

  it("treats a first segment with a dot as a registry", () => {
    const out = one(img({ reference: "registry.example.com/team/app:0.9" }));
    assert.equal(out.images[0].registry, "registry.example.com");
    assert.equal(out.images[0].repository, "team/app");
  });

  it("a colon in an earlier segment is a registry port, never a tag", () => {
    const out = one(img({ reference: "example.com:5000/team/app" }));
    assert.equal(out.images[0].registry, "example.com:5000");
    assert.equal(out.images[0].repository, "team/app");
    assert.equal(out.images[0].tag, null);
    assert.deepEqual(out.images[0].findings, ["UNPINNED"]);
  });

  it("a registry port and a tag coexist: the tag colon is in the final segment", () => {
    const out = one(img({ reference: "localhost:5000/team/app:3" }));
    assert.equal(out.images[0].registry, "localhost:5000");
    assert.equal(out.images[0].repository, "team/app");
    assert.equal(out.images[0].tag, "3");
  });

  it("parses a tag and a digest together", () => {
    const out = one(img({ reference: `ghcr.io/owner/repo:1.2.3@${DIGEST}` }));
    assert.equal(out.images[0].tag, "1.2.3");
    assert.equal(out.images[0].digest, DIGEST);
    assert.deepEqual(out.images[0].findings, []);
  });

  it("parses a digest with no tag", () => {
    const out = one(img({ reference: `owner/repo@${DIGEST}` }));
    assert.equal(out.images[0].tag, null);
    assert.equal(out.images[0].digest, DIGEST);
    assert.deepEqual(out.images[0].findings, []);
  });

  it("the digest is everything after the LAST '@'", () => {
    // With a first-'@' split the digest would be
    // "b@sha256:<hex>" and fail the digest check; the
    // pinned last-'@' split yields a valid digest.
    const out = one(img({ reference: `a@b@${DIGEST}` }));
    assert.equal(out.images[0].digest, DIGEST);
    assert.equal(out.images[0].repository, "a@b");
    assert.deepEqual(out.images[0].findings, []);
  });

  it("uppercase in the registry or the tag is not an uppercase repository", () => {
    const out = one(img({ reference: "GHCR.IO/owner/repo:Release" }));
    assert.equal(out.images[0].registry, "GHCR.IO");
    assert.equal(out.images[0].repository, "owner/repo");
    assert.deepEqual(out.images[0].findings, []);
  });
});

describe("auditImageTags — INVALID_REFERENCE", () => {
  it("an empty name part (reference starting with '@') is invalid", () => {
    const out = one(img({ reference: `@${DIGEST}` }));
    assert.deepEqual(out.images[0], {
      reference: `@${DIGEST}`,
      registry: null,
      repository: null,
      tag: null,
      digest: null,
      findings: ["INVALID_REFERENCE"],
    });
    assert.deepEqual(out.findings, [
      {
        reference: `@${DIGEST}`,
        code: "INVALID_REFERENCE",
        severity: "error",
        message: "reference cannot be parsed",
      },
    ]);
  });

  it("an empty repository after the registry segment is invalid", () => {
    assert.deepEqual(codes(img({ reference: "ghcr.io/" })), ["INVALID_REFERENCE"]);
    assert.deepEqual(codes(img({ reference: "ghcr.io/:1.0" })), ["INVALID_REFERENCE"]);
  });

  it("an empty tag is invalid", () => {
    assert.deepEqual(codes(img({ reference: "owner/repo:" })), ["INVALID_REFERENCE"]);
    assert.deepEqual(codes(img({ reference: ":" })), ["INVALID_REFERENCE"]);
  });

  it("INVALID_REFERENCE suppresses every other check and nulls the parsed fields", () => {
    const out = one(
      { reference: "UPPER/Repo:@sha256:not-a-digest" },
      { expected_server_name: SERVER_NAME },
    );
    assert.deepEqual(out.images[0], {
      reference: "UPPER/Repo:@sha256:not-a-digest",
      registry: null,
      repository: null,
      tag: null,
      digest: null,
      findings: ["INVALID_REFERENCE"],
    });
    assert.equal(out.findings.length, 1);
  });
});

describe("auditImageTags — digest, repository case, and pinning checks", () => {
  it("INVALID_DIGEST: a short digest is not a sha256 digest", () => {
    const out = one(img({ reference: "owner/repo@sha256:abc" }));
    assert.deepEqual(out.findings, [
      {
        reference: "owner/repo@sha256:abc",
        code: "INVALID_DIGEST",
        severity: "error",
        message:
          "digest is not a sha256 digest of the form sha256:<64 lowercase hex>",
      },
    ]);
  });

  it("INVALID_DIGEST: uppercase hex and a non-sha256 algorithm both fail", () => {
    assert.deepEqual(codes(img({ reference: `owner/repo@sha256:${HEX.toUpperCase()}` })), [
      "INVALID_DIGEST",
    ]);
    assert.deepEqual(codes(img({ reference: `owner/repo@md5:${"a".repeat(32)}` })), [
      "INVALID_DIGEST",
    ]);
  });

  it("INVALID_DIGEST: an empty digest after '@' is present but invalid, and still pins", () => {
    const out = one(img({ reference: "owner/repo@" }));
    assert.equal(out.images[0].digest, "");
    assert.deepEqual(out.images[0].findings, ["INVALID_DIGEST"]);
  });

  it("UPPERCASE_REPOSITORY names the repository in its message", () => {
    const out = one(img({ reference: "ghcr.io/Owner/Repo:1" }));
    assert.deepEqual(out.findings, [
      {
        reference: "ghcr.io/Owner/Repo:1",
        code: "UPPERCASE_REPOSITORY",
        severity: "error",
        message: "repository Owner/Repo contains uppercase characters",
      },
    ]);
  });

  it("UNPINNED: no tag and no digest is an error with the exact message", () => {
    const out = one(img({ reference: "owner/repo" }));
    assert.deepEqual(out.findings, [
      {
        reference: "owner/repo",
        code: "UNPINNED",
        severity: "error",
        message:
          "no tag or digest: the reference resolves to the mutable latest tag",
      },
    ]);
  });

  it("LATEST_TAG: the latest tag with no digest is a warning, not UNPINNED", () => {
    const out = one(img({ reference: "owner/repo:latest" }));
    assert.deepEqual(out.findings, [
      {
        reference: "owner/repo:latest",
        code: "LATEST_TAG",
        severity: "warning",
        message: "tag latest is mutable; pin a version or digest",
      },
    ]);
  });

  it("a digest pins even the latest tag: neither UNPINNED nor LATEST_TAG", () => {
    assert.deepEqual(codes(img({ reference: `owner/repo:latest@${DIGEST}` })), []);
  });

  it("a non-latest tag on its own pins the reference", () => {
    assert.deepEqual(codes(img({ reference: "owner/repo:0.0.1" })), []);
  });
});

describe("auditImageTags — label checks", () => {
  it("labels absent produces both missing-label warnings", () => {
    const out = one({ reference: "owner/repo:1" });
    assert.deepEqual(out.findings, [
      {
        reference: "owner/repo:1",
        code: "MISSING_SOURCE_LABEL",
        severity: "warning",
        message: "missing label org.opencontainers.image.source",
      },
      {
        reference: "owner/repo:1",
        code: "MISSING_LICENSE_LABEL",
        severity: "warning",
        message: "missing label org.opencontainers.image.licenses",
      },
    ]);
  });

  it("an empty labels object is the same as absent for the label checks", () => {
    assert.deepEqual(codes(img({ reference: "owner/repo:1", labels: {} })), [
      "MISSING_SOURCE_LABEL",
      "MISSING_LICENSE_LABEL",
    ]);
  });

  it("only the missing label is reported when one is present", () => {
    assert.deepEqual(
      codes(
        img({
          reference: "owner/repo:1",
          labels: { "org.opencontainers.image.source": "https://example.com/src" },
        }),
      ),
      ["MISSING_LICENSE_LABEL"],
    );
    assert.deepEqual(
      codes(
        img({
          reference: "owner/repo:1",
          labels: { "org.opencontainers.image.licenses": "Apache-2.0" },
        }),
      ),
      ["MISSING_SOURCE_LABEL"],
    );
  });
});

describe("auditImageTags — server-name label checks", () => {
  it("no server-name finding when expected_server_name is not supplied", () => {
    assert.deepEqual(codes(img({ reference: "owner/repo:1" })), []);
    assert.deepEqual(
      codes(
        img({
          reference: "owner/repo:1",
          labels: {
            ...GOOD_LABELS,
            "io.modelcontextprotocol.server.name": "io.github.CloudCorpRecords/anything",
          },
        }),
      ),
      [],
    );
  });

  it("MISSING_SERVER_NAME_LABEL when the label is absent and a name is expected", () => {
    const out = one(img({ reference: "owner/repo:1" }), {
      expected_server_name: SERVER_NAME,
    });
    assert.deepEqual(out.findings, [
      {
        reference: "owner/repo:1",
        code: "MISSING_SERVER_NAME_LABEL",
        severity: "error",
        message: "missing label io.modelcontextprotocol.server.name",
      },
    ]);
  });

  it("SERVER_NAME_MISMATCH names the actual and expected values", () => {
    const out = one(
      img({
        reference: "owner/repo:1",
        labels: {
          ...GOOD_LABELS,
          "io.modelcontextprotocol.server.name": "io.github.CloudCorpRecords/other",
        },
      }),
      { expected_server_name: SERVER_NAME },
    );
    assert.deepEqual(out.findings, [
      {
        reference: "owner/repo:1",
        code: "SERVER_NAME_MISMATCH",
        severity: "error",
        message:
          "server-name label is io.github.CloudCorpRecords/other, expected io.github.CloudCorpRecords/dockertag",
      },
    ]);
  });

  it("a matching server-name label is clean", () => {
    const out = one(
      img({ reference: "owner/repo:1", labels: { ...LABELS_WITH_SERVER } }),
      { expected_server_name: SERVER_NAME },
    );
    assert.deepEqual(out.findings, []);
    assert.equal(out.counts.clean, 1);
  });
});

describe("auditImageTags — finding order and counts", () => {
  it("findings for one image follow the check order", () => {
    const out = one(
      { reference: "ghcr.io/Owner/Repo" },
      { expected_server_name: SERVER_NAME },
    );
    assert.deepEqual(out.images[0].findings, [
      "UPPERCASE_REPOSITORY",
      "UNPINNED",
      "MISSING_SOURCE_LABEL",
      "MISSING_LICENSE_LABEL",
      "MISSING_SERVER_NAME_LABEL",
    ]);
  });

  it("INVALID_DIGEST comes before UPPERCASE_REPOSITORY in check order", () => {
    assert.deepEqual(
      codes(img({ reference: "ghcr.io/Owner/Repo:1@sha256:xyz", labels: { ...GOOD_LABELS } })),
      ["INVALID_DIGEST", "UPPERCASE_REPOSITORY"],
    );
  });

  it("the flat findings list is ordered by image input order, then check order", () => {
    const out = auditImageTags({
      images: [
        { reference: "owner/repo:1", labels: { ...GOOD_LABELS } },
        { reference: "ghcr.io/Owner/Repo" },
      ],
    });
    assert.deepEqual(
      out.findings.map((f) => `${f.reference}:${f.code}`),
      [
        "ghcr.io/Owner/Repo:UPPERCASE_REPOSITORY",
        "ghcr.io/Owner/Repo:UNPINNED",
        "ghcr.io/Owner/Repo:MISSING_SOURCE_LABEL",
        "ghcr.io/Owner/Repo:MISSING_LICENSE_LABEL",
      ],
    );
    assert.deepEqual(
      out.images.map((i) => i.reference),
      ["owner/repo:1", "ghcr.io/Owner/Repo"],
    );
  });

  it("counts tally images, errors, warnings, and clean images", () => {
    const out = auditImageTags({
      images: [
        img({ reference: "owner/clean:1" }),
        img({ reference: "owner/warn:latest" }),
        img({ reference: "owner/err" }),
      ],
    });
    assert.deepEqual(out.counts, { images: 3, errors: 1, warnings: 1, clean: 1 });
  });

  it("the full result object matches exactly for a small set", () => {
    const out = auditImageTags({
      images: [
        { reference: "owner/repo:1", labels: { ...GOOD_LABELS } },
        { reference: "owner/old" },
      ],
    });
    assert.deepEqual(out, {
      images: [
        {
          reference: "owner/repo:1",
          registry: "docker.io",
          repository: "owner/repo",
          tag: "1",
          digest: null,
          findings: [],
        },
        {
          reference: "owner/old",
          registry: "docker.io",
          repository: "owner/old",
          tag: null,
          digest: null,
          findings: ["UNPINNED", "MISSING_SOURCE_LABEL", "MISSING_LICENSE_LABEL"],
        },
      ],
      findings: [
        {
          reference: "owner/old",
          code: "UNPINNED",
          severity: "error",
          message:
            "no tag or digest: the reference resolves to the mutable latest tag",
        },
        {
          reference: "owner/old",
          code: "MISSING_SOURCE_LABEL",
          severity: "warning",
          message: "missing label org.opencontainers.image.source",
        },
        {
          reference: "owner/old",
          code: "MISSING_LICENSE_LABEL",
          severity: "warning",
          message: "missing label org.opencontainers.image.licenses",
        },
      ],
      counts: { images: 2, errors: 1, warnings: 2, clean: 1 },
    });
  });

  it("unknown extra fields are ignored (pinned judgement call)", () => {
    const out = auditImageTags({
      images: [{ reference: "owner/repo:1", labels: { ...GOOD_LABELS }, comment: "x" }],
      note: "not part of the spec",
    });
    assert.deepEqual(out.findings, []);
  });
});

describe("auditImageTags — validation", () => {
  const throws = (args: unknown, message: string) =>
    assert.throws(() => auditImageTags(args), { message });

  it("images missing is an error naming images", () => {
    throws({}, "images is required");
    throws(null, "images is required");
    throws([], "images is required");
  });

  it("images empty or not an array is an error", () => {
    throws({ images: [] }, "images must be a non-empty array");
    throws({ images: "owner/repo:1" }, "images must be a non-empty array");
    throws({ images: 7 }, "images must be a non-empty array");
  });

  it("an image entry that is not an object names its path", () => {
    throws({ images: ["owner/repo:1"] }, "images[0] must be an object");
    throws({ images: [img({}), null] }, "images[1] must be an object");
  });

  it("reference missing names its path", () => {
    throws({ images: [{ labels: {} }] }, "images[0].reference is required");
  });

  it("reference empty or non-string names its path", () => {
    throws({ images: [img({ reference: "" })] }, "images[0].reference must be a non-empty string");
    throws({ images: [img({ reference: 42 })] }, "images[0].reference must be a non-empty string");
  });

  it("a duplicate reference names the second occurrence's path", () => {
    throws(
      {
        images: [
          img({ reference: "dup:1" }),
          img({ reference: "other:1" }),
          img({ reference: "dup:1" }),
        ],
      },
      'images[2].reference duplicates images[0].reference "dup:1"',
    );
  });

  it("labels present but not an object names its path", () => {
    throws({ images: [img({ labels: "none" })] }, "images[0].labels must be an object");
    throws({ images: [img({ labels: [] })] }, "images[0].labels must be an object");
    throws({ images: [img({ labels: null })] }, "images[0].labels must be an object");
  });

  it("a non-string label value names its path", () => {
    throws(
      {
        images: [
          img({ labels: { "org.opencontainers.image.source": 7 } }),
        ],
      },
      "images[0].labels.org.opencontainers.image.source must be a string",
    );
    throws(
      { images: [img({}), img({ reference: "x:1", labels: { custom: true } })] },
      "images[1].labels.custom must be a string",
    );
  });

  it("expected_server_name empty or non-string names the path", () => {
    throws(
      { images: [img({})], expected_server_name: "" },
      "expected_server_name must be a non-empty string",
    );
    throws(
      { images: [img({})], expected_server_name: 9 },
      "expected_server_name must be a non-empty string",
    );
  });

  it("expected_server_name is validated before individual images (pinned judgement call)", () => {
    throws(
      { images: [{ reference: "" }], expected_server_name: "" },
      "expected_server_name must be a non-empty string",
    );
  });

  it("no partial result is produced on invalid input", () => {
    assert.throws(() =>
      auditImageTags({
        images: [img({ reference: "fine:1" }), img({ reference: "fine:1" })],
      }),
    );
  });
});
