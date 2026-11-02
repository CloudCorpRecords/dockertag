# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `audit_image_tags` MCP tool and `audit`
  CLI command auditing container image references and OCI
  labels from supplied data.
- Reference parsing pinned to the last `@` for the digest
  and a tag colon only in the final path segment, with the
  registry taken from the first segment when it contains a
  `.` or a `:` or equals `localhost`, and `docker.io`
  otherwise.
- Nine findings in a fixed check order — invalid reference,
  invalid digest, uppercase repository, unpinned, latest
  tag, missing source label, missing license label,
  missing server-name label, server-name mismatch — each
  with its exact message, plus per-image parsed fields and
  error / warning / clean counts.
- Path-naming validation errors for malformed input, with
  no partial result on invalid input.
