# dockertag — Build Report

MCP Rebuild 1000, Batch 16. Original program build from the
packages-100 plan (cluster E #58), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch16/dockertag.md`
(read first). There is no external original; the tool surface
is the program's defined spec. Local build only — nothing
pushed or published.

Identity: repo `dockertag`, npm `@reneturcios/dockertag`,
MCP name `io.github.CloudCorpRecords/dockertag`, version
`0.1.0`, bin `dockertag` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Audit image
  tags and OCI labels: pinning, lowercase repos, and the
  MCP server-name label." — verified 89 chars, matching the
  spec's count; npm entry carries `version: 0.1.0`; OCI
  entry `ghcr.io/cloudcorprecords/dockertag:0.1.0` carries
  **no** `version` field), `Dockerfile` (node:20-alpine
  two-stage, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/dockertag"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`audit --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/dockertag.ts` (core,
  `VERSION = "0.1.0"`)
- `test/dockertag.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/dockertag`,
  smoke-test server-name assertion `dockertag`)
- Plus the parity fixture at
  `harness/fixtures/dockertag-tools-original.json`
  (`_source` labelling it a program spec from the
  packages-100 plan, cluster E #58).

## Tools implemented (1)

- `audit_image_tags` — arguments: `images` (array,
  required, minItems 1) of `{reference (string, required,
  non-empty, unique across images), labels (object,
  optional, string-to-string map)}`, plus
  `expected_server_name` (string, optional, non-empty).

  Reference parsing is pinned exactly as the spec defines:
  the digest is everything after the LAST `@` and the name
  part is everything before it; a tag is present when the
  final path segment (after the last `/`) contains a `:`,
  and the tag is the text after the LAST `:` in that
  segment — so a registry port colon is never a tag. The
  registry is the first path segment when it contains a
  `.` or a `:` or equals `localhost`, otherwise
  `docker.io`; the repository is the path after the
  registry segment (or the whole path when the registry
  was defaulted). A reference is invalid when the name
  part is empty, the repository is empty, or a present
  tag is empty.

  Nine checks run per image in the spec's exact order,
  each with its exact message: INVALID_REFERENCE (error;
  suppresses all other checks for that image and nulls
  its parsed fields), INVALID_DIGEST (error),
  UPPERCASE_REPOSITORY (error), UNPINNED (error),
  LATEST_TAG (warning), MISSING_SOURCE_LABEL (warning),
  MISSING_LICENSE_LABEL (warning),
  MISSING_SERVER_NAME_LABEL (error), and
  SERVER_NAME_MISMATCH (error) — the last two only when
  `expected_server_name` is supplied. Returns `{images,
  findings, counts}`: per-image `{reference, registry,
  repository, tag, digest, findings}` in input order
  (tag/digest null when absent), the flat findings list
  ordered by image input order then check order, and
  counts `{images, errors, warnings, clean}` where clean
  is the number of images with zero findings. The audit
  is pure local computation over the supplied data: no
  registry is contacted and no image is pulled.

  The fixture literal
  (`harness/fixtures/dockertag-tools-original.json`) and
  the `src/mcp.ts` literal are identical, with no `$schema`
  and no `additionalProperties` — confirmed by the parity
  run below.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the
  fixture, per the standing fleet rule (no McpServer/zod
  schema conversion). Every `tools/call` is validated by
  the core itself, so the MCP and CLI paths share one
  validation implementation; the core takes the full
  arguments object (`{images, expected_server_name?}`).
- Validation is path-naming and total: missing/empty/
  non-array `images`, an entry that is not an object, a
  missing/empty/non-string or duplicated `reference`
  (the error names the second occurrence's path, e.g.
  `images[2].reference duplicates images[0].reference
  "dup:1"`), `labels` present but not an object or
  holding a non-string value, or an empty/non-string
  `expected_server_name` throws an Error naming the
  offending path and produces no partial result (MCP:
  `isError`; CLI: exit 1). Validation order (a pinned
  judgement call, see Gaps): `images` presence/shape
  first, then `expected_server_name`, then the
  individual image entries.

## Verification (foreground, this session)

- `npm test` (`tsx --test test/*.test.ts`): **47 tests,
  47 pass, 0 fail** — parsing (registry / repository /
  tag / digest, the docker.io default, a dotted registry,
  localhost with and without a port, a registry port
  never read as a tag, tag + digest together, a digest
  alone, the digest split at the LAST `@`, uppercase in
  the registry or tag not counting as an uppercase
  repository); INVALID_REFERENCE for an empty name part,
  an empty repository, and an empty tag, plus its
  suppression of every other check (including a bad
  digest, uppercase repository, missing labels, and the
  server-name checks) with all parsed fields null;
  INVALID_DIGEST for short, uppercase-hex, and
  non-sha256 digests and for an empty digest after `@`;
  UPPERCASE_REPOSITORY with its exact message; UNPINNED
  and LATEST_TAG with their exact messages, and a digest
  pinning even the `latest` tag; both missing-label
  warnings when labels are absent or empty, and only the
  missing one when one label is present; the server-name
  checks running only when `expected_server_name` is
  supplied (missing label, mismatch with exact actual /
  expected message, and a clean match); finding order
  within one image and across images (input order, then
  check order); counts; a full exact-result match for a
  small set; and every validation path (missing/empty/
  non-array `images`, non-object entry, missing/empty/
  non-string reference, duplicate reference naming the
  second occurrence, non-object `labels`, a non-string
  label value naming its exact path,
  `expected_server_name` empty and non-string, and no
  partial result on invalid input).
- `npx tsc --noEmit` → exit 0; `npm run build` clean,
  `dist/` present with all 15 outputs.
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `audit` with no `--input` exits 2;
  `audit --input <missing file>` exits 1 naming the file;
  `audit --input <valid file>` exits 0 and prints the
  audit JSON (verified against a hand-checked set: a
  labelled `ghcr.io/owner/repo:1.2.3` clean, and
  `myteam/worker` unpinned with both missing-label
  warnings, counts `{images: 2, errors: 1, warnings: 2,
  clean: 1}`); `audit --input <invalid file>` exits 1
  with `images[1].labels.x must be a string`.
- Parity: `harness/parity.py` vs
  `harness/fixtures/dockertag-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (run with
  the rebuild path as an absolute path; the harness does
  not expand a `~` inside the quoted stdio command
  string). Report saved under `parity-out/`.

## Lockfile status

`package-lock.json` generated clean via Route 3 (in the
build dir with no `node_modules` present, offline
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/dockertag`, **128 package entries**.
Resolved versions match the batch reference tree
(`@modelcontextprotocol/sdk` 1.32.2, `zod` 3.25.76,
`tsx` 4.23.15, `typescript` 5.9.3, `@types/node`
20.19.43).

## Gaps / honest notes

- **server.json description char count:** the spec's
  count is correct this time — the exact string "Audit
  image tags and OCI labels: pinning, lowercase repos,
  and the MCP server-name label." measures **89 chars**
  as stated, and was used verbatim (≤ 100 either way).
- **Pinned judgement calls** (each with a dedicated
  test): (1) validation order — `expected_server_name`
  is validated after the `images` array's presence/shape
  but before individual image entries, so a bad
  `expected_server_name` is reported even when an image
  is also malformed; (2) unknown extra fields, at the
  top level and per image, are ignored rather than
  rejected (the spec does not forbid them); (3) a
  non-object top-level arguments value is treated as an
  empty object, so it fails as `images is required`;
  (4) an empty digest (`reference@`) counts as a present
  digest: it is reported verbatim (empty string) in the
  parsed fields, fails INVALID_DIGEST, and suppresses
  UNPINNED/LATEST_TAG because a digest is present —
  the spec defines the digest as everything after the
  last `@` without carving out the empty case; (5)
  duplicate-reference wording is not fixed by the spec
  (only that the error names the second occurrence's
  path); the message used is
  `images[<i>].reference duplicates images[<first>].reference "<reference>"`,
  matching the fleet pattern; (6) the uppercase check
  applies to the repository as parsed (the path after
  the registry segment), so uppercase confined to the
  registry segment or the tag does not fire it — that is
  the spec's wording ("repository contains an uppercase
  letter") read against its own parsing rules. No other
  spec ambiguity was found in the core behaviour.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
