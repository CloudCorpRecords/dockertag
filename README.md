# dockertag

An image reference looks pinned until you read it closely.
`repo` with no tag at all silently means `repo:latest`;
`latest` itself moves; a capital letter in the repository
breaks pushes to registries that require lowercase; and a
published image can be missing the labels that say where
its source lives, what license it carries, and — for MCP
servers — the server-name label the MCP Registry checks
before it will list the image. dockertag takes the middle
road: you hand it the references and the labels you found,
and it hands back an audit.

Every reference is parsed the same careful way. The digest
is everything after the **last** `@`. A tag exists only
when the final path segment contains a `:` — so the colon
in `localhost:5000` is a port, never a tag — and the tag is
the text after the last `:` in that segment. The registry
is the first segment when it contains a `.` or a `:` or is
exactly `localhost`; otherwise the registry is `docker.io`
and the whole path is the repository.

Against the parsed reference and the supplied labels, nine
checks run in a fixed order:

- **INVALID_REFERENCE** (error) — the name part is empty,
  the repository is empty, or a present tag is empty. No
  further checks run for that image and its parsed fields
  are null.
- **INVALID_DIGEST** (error) — a digest that is not
  `sha256:` followed by 64 lowercase hex characters.
- **UPPERCASE_REPOSITORY** (error) — an uppercase letter
  anywhere in the repository.
- **UNPINNED** (error) — no tag and no digest, so the
  reference resolves to the mutable `latest` tag.
- **LATEST_TAG** (warning) — the tag is exactly `latest`
  and no digest pins it.
- **MISSING_SOURCE_LABEL** (warning) — no
  `org.opencontainers.image.source` label.
- **MISSING_LICENSE_LABEL** (warning) — no
  `org.opencontainers.image.licenses` label.
- **MISSING_SERVER_NAME_LABEL** (error) — only checked
  when you supply `expected_server_name`: the
  `io.modelcontextprotocol.server.name` label is absent.
- **SERVER_NAME_MISMATCH** (error) — that label is present
  but differs from the expected value.

The result carries each image's parsed registry,
repository, tag, and digest with its finding codes, the
flat list of findings (by image input order, then check
order) with exact messages, and counts of images, errors,
warnings, and clean images.

dockertag never contacts a registry and never pulls an
image: the labels are the ones you supply, which makes the
audit usable in CI before anything is pushed. Malformed
input — a missing or empty image list, a missing, empty,
or duplicated reference, labels that are not a
string-to-string map, a bad `expected_server_name` — is a
validation error naming the offending path (for example
`images[1].labels.custom must be a string`), and no
partial audit is produced.

## CLI

```bash
npx @reneturcios/dockertag audit --input args.json
npx @reneturcios/dockertag --version
```

`args.json` contains the full arguments object:

```json
{
  "expected_server_name": "io.github.CloudCorpRecords/dockertag",
  "images": [
    {
      "reference": "ghcr.io/cloudcorprecords/dockertag:0.1.0",
      "labels": {
        "org.opencontainers.image.source": "https://github.com/CloudCorpRecords/dockertag",
        "org.opencontainers.image.licenses": "MIT",
        "io.modelcontextprotocol.server.name": "io.github.CloudCorpRecords/dockertag"
      }
    },
    { "reference": "myteam/worker" }
  ]
}
```

The audit is printed as JSON:

```json
{
  "images": [
    {
      "reference": "ghcr.io/cloudcorprecords/dockertag:0.1.0",
      "registry": "ghcr.io",
      "repository": "cloudcorprecords/dockertag",
      "tag": "0.1.0",
      "digest": null,
      "findings": []
    },
    {
      "reference": "myteam/worker",
      "registry": "docker.io",
      "repository": "myteam/worker",
      "tag": null,
      "digest": null,
      "findings": ["UNPINNED", "MISSING_SOURCE_LABEL", "MISSING_LICENSE_LABEL", "MISSING_SERVER_NAME_LABEL"]
    }
  ],
  "findings": [
    {
      "reference": "myteam/worker",
      "code": "UNPINNED",
      "severity": "error",
      "message": "no tag or digest: the reference resolves to the mutable latest tag"
    }
  ],
  "counts": { "images": 2, "errors": 2, "warnings": 2, "clean": 1 }
}
```

(The flat `findings` list above is abbreviated; it holds
one entry per finding.) Exit codes: `0` on success, `1`
on a runtime error (including an unreadable or invalid
input file, or invalid input), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/dockertag mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "dockertag": {
      "command": "npx",
      "args": ["-y", "@reneturcios/dockertag", "mcp"]
    }
  }
}
```

### Tools

- `audit_image_tags` — Audit container image references
  and OCI labels: tag pinning, lowercase repositories,
  source and license labels, and the MCP Registry
  server-name label.
  - `images` (array, required, at least one) — images as
    `{reference, labels?}` objects; `reference` is the
    full image reference as written and is unique across
    the set, and `labels` is the image's OCI labels as a
    string-to-string map
  - `expected_server_name` (string, optional, non-empty)
    — the expected value of the
    `io.modelcontextprotocol.server.name` label; the two
    server-name checks run only when this is supplied

  Returns `{images, findings, counts}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/dockertag
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/dockertag audit --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
