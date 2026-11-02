/**
 * dockertag MCP server. Tools: audit_image_tags.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The audit is pure local computation over the references and
 * labels the caller supplies: no registry is contacted, no
 * image is pulled, and no authentication is involved.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { auditImageTags, formatPayload, VERSION } from "./dockertag.js";

const TOOLS = [
  {
    name: "audit_image_tags",
    description:
      "Audit container image references and OCI labels: tag pinning, lowercase repositories, source and license labels, and the MCP Registry server-name label.",
    inputSchema: {
      type: "object" as const,
      properties: {
        images: {
          type: "array",
          description: "Image references to audit (at least one)",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              reference: {
                type: "string",
                description:
                  "Full image reference as written, e.g. ghcr.io/owner/repo:1.2.3 (unique across the set)",
              },
              labels: {
                type: "object",
                description:
                  "OCI labels present on the image, as a string-to-string map (optional)",
              },
            },
            required: ["reference"],
          },
        },
        expected_server_name: {
          type: "string",
          description:
            "Expected value of the io.modelcontextprotocol.server.name label (optional)",
        },
      },
      required: ["images"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "dockertag", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "audit_image_tags") {
      out = auditImageTags(args ?? {});
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
