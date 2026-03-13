#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Config & Auth ───────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_USERNAME = process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME;
const SERVICE_ACCOUNT_PASSWORD = process.env.MIXPANEL_SERVICE_ACCOUNT_PASSWORD;
const API_SECRET = process.env.MIXPANEL_API_SECRET;
const PROJECT_ID = process.env.MIXPANEL_PROJECT_ID;
const REGION = (process.env.MIXPANEL_REGION ?? "US").toUpperCase();

if (!PROJECT_ID) {
  console.error("MIXPANEL_PROJECT_ID is required");
  process.exit(1);
}

const hasServiceAccount = SERVICE_ACCOUNT_USERNAME && SERVICE_ACCOUNT_PASSWORD;
const hasSecret = !!API_SECRET;

if (!hasServiceAccount && !hasSecret) {
  console.error(
    "At least one auth method required: MIXPANEL_SERVICE_ACCOUNT_USERNAME/PASSWORD or MIXPANEL_API_SECRET"
  );
  process.exit(1);
}

function buildAuthHeader(): string {
  if (hasServiceAccount) {
    const creds = Buffer.from(
      `${SERVICE_ACCOUNT_USERNAME}:${SERVICE_ACCOUNT_PASSWORD}`
    ).toString("base64");
    return `Basic ${creds}`;
  }
  const creds = Buffer.from(`${API_SECRET}:`).toString("base64");
  return `Basic ${creds}`;
}

const AUTH_HEADER = buildAuthHeader();
console.error(
  `Auth: ${hasServiceAccount ? "Service Account" : "API Secret"} | Region: ${REGION} | Project: ${PROJECT_ID}`
);

// ─── Base URLs ───────────────────────────────────────────────────────────────

const isEU = REGION === "EU";

const BASE_URLS = {
  query: isEU
    ? "https://eu.mixpanel.com/api/2.0"
    : "https://mixpanel.com/api/2.0",
  ingestion: isEU
    ? "https://api-eu.mixpanel.com"
    : "https://api.mixpanel.com",
  export: isEU
    ? "https://data-eu.mixpanel.com/api/2.0"
    : "https://data.mixpanel.com/api/2.0",
};

// ─── Shared Request Helper ───────────────────────────────────────────────────

type ApiType = "query" | "ingestion" | "export";

async function mixpanelRequest(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  apiType: ApiType = "query",
  authOverride?: string
): Promise<unknown> {
  const baseUrl = BASE_URLS[apiType];
  let url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: authOverride ?? AUTH_HEADER,
  };

  // Attach project_id for query/export APIs
  if (apiType !== "ingestion") {
    headers["X-MIXPANEL-PROJECT-ID"] = PROJECT_ID!;
  }

  let body: string | undefined;

  if (method === "GET") {
    const searchParams = new URLSearchParams();
    if (apiType !== "ingestion") {
      searchParams.append("project_id", PROJECT_ID!);
    }
    if (params && Object.keys(params).length > 0) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.append(
            key,
            typeof value === "string" ? value : JSON.stringify(value)
          );
        }
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  } else {
    // POST
    if (apiType === "ingestion") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(params);
    } else {
      // For query POST endpoints, send as form data
      const formParams = new URLSearchParams();
      formParams.append("project_id", PROJECT_ID!);
      if (params && Object.keys(params).length > 0) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            formParams.append(
              key,
              typeof value === "string" ? value : JSON.stringify(value)
            );
          }
        }
      }
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = formParams.toString();
    }
  }

  const response = await fetch(url, { method, headers, body });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 401) {
      throw new Error(`Authentication failed (401): ${errorBody}`);
    }
    if (response.status === 403) {
      throw new Error(
        `Access denied (403). Check project permissions: ${errorBody}`
      );
    }
    if (response.status === 429) {
      throw new Error(`Rate limited (429). Please retry later: ${errorBody}`);
    }
    if (response.status >= 500) {
      throw new Error(`Mixpanel server error (${response.status}): ${errorBody}`);
    }
    throw new Error(
      `Mixpanel API error (${response.status}): ${errorBody}`
    );
  }

  return response;
}

async function mixpanelJSON(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  apiType: ApiType = "query",
  authOverride?: string
): Promise<unknown> {
  const response = (await mixpanelRequest(
    method,
    path,
    params,
    apiType,
    authOverride
  )) as Response;
  return response.json();
}

async function mixpanelNDJSON(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  apiType: ApiType = "query",
  limit: number = 5000
): Promise<unknown[]> {
  const response = (await mixpanelRequest(
    method,
    path,
    params,
    apiType
  )) as Response;
  const text = await response.text();
  const lines = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, limit);
  return lines.map((line) => JSON.parse(line));
}

// ─── Tool Result Helpers ─────────────────────────────────────────────────────

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-mixpanel",
  version: "1.0.0",
});

// ─── 1. query_events ─────────────────────────────────────────────────────────

server.tool(
  "query_events",
  "Query event data with segmentation. Returns time-series event counts, optionally segmented by a property.",
  {
    event: z.string().describe("Event name to query"),
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    on: z
      .string()
      .optional()
      .describe('Property to segment by (e.g. "properties[\\"$browser\\"]")'),
    unit: z
      .enum(["minute", "hour", "day", "week", "month"])
      .optional()
      .describe("Time unit for bucketing (default: day)"),
    where: z.string().optional().describe("Filter expression"),
    limit: z
      .number()
      .optional()
      .describe("Max number of segments to return"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/segmentation", {
        event: params.event,
        from_date: params.from_date,
        to_date: params.to_date,
        ...(params.on && { on: params.on }),
        ...(params.unit && { unit: params.unit }),
        ...(params.where && { where: params.where }),
        ...(params.limit && { limit: params.limit }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 2. top_events ───────────────────────────────────────────────────────────

server.tool(
  "top_events",
  "Get the most common events over the last day. Returns event names ranked by volume.",
  {
    type: z
      .enum(["general", "average", "unique"])
      .default("general")
      .describe("Type of event count (default: general)"),
    limit: z.number().optional().describe("Max events to return"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/events/top", {
        type: params.type,
        ...(params.limit && { limit: params.limit }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 3. event_properties ────────────────────────────────────────────────────

server.tool(
  "event_properties",
  "Get the top properties for a specific event. Returns property names ranked by prevalence.",
  {
    event: z.string().describe("Event name"),
    limit: z.number().optional().describe("Max properties to return"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/events/properties/top", {
        event: params.event,
        ...(params.limit && { limit: params.limit }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 4. query_funnels ───────────────────────────────────────────────────────

server.tool(
  "query_funnels",
  "Query a saved funnel by ID. Returns conversion rates and drop-off at each step.",
  {
    funnel_id: z.number().describe("Funnel ID to query"),
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    unit: z
      .enum(["day", "week", "month"])
      .optional()
      .describe("Time unit for grouping"),
    on: z.string().optional().describe("Property to segment by"),
    where: z.string().optional().describe("Filter expression"),
    limit: z.number().optional().describe("Max segments to return"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/funnels", {
        funnel_id: params.funnel_id,
        from_date: params.from_date,
        to_date: params.to_date,
        ...(params.unit && { unit: params.unit }),
        ...(params.on && { on: params.on }),
        ...(params.where && { where: params.where }),
        ...(params.limit && { limit: params.limit }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 5. list_funnels ────────────────────────────────────────────────────────

server.tool(
  "list_funnels",
  "List all saved funnels in the project. Returns funnel IDs and names.",
  {},
  async () => {
    try {
      const data = await mixpanelJSON("GET", "/funnels/list");
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 6. query_retention ─────────────────────────────────────────────────────

server.tool(
  "query_retention",
  "Query retention data. Shows how many users come back after an initial event.",
  {
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    born_event: z
      .string()
      .describe("Initial event that qualifies a user (required for birth retention)"),
    event: z.string().optional().describe("Return event to measure"),
    retention_type: z
      .enum(["birth", "compounding"])
      .optional()
      .describe("Retention type (default: birth)"),
    unit: z
      .enum(["day", "week", "month"])
      .optional()
      .describe("Time unit"),
    on: z.string().optional().describe("Property to segment by"),
    where: z.string().optional().describe("Filter expression"),
    born_where: z
      .string()
      .optional()
      .describe("Filter for the born event"),
    limit: z.number().optional().describe("Max segments to return"),
  },
  async (params) => {
    try {
      const queryParams: Record<string, unknown> = {
        from_date: params.from_date,
        to_date: params.to_date,
      };
      queryParams.born_event = params.born_event;
      if (params.event) queryParams.event = params.event;
      if (params.retention_type)
        queryParams.retention_type = params.retention_type;
      if (params.unit) queryParams.unit = params.unit;
      if (params.on) queryParams.on = params.on;
      if (params.where) queryParams.where = params.where;
      if (params.born_where) queryParams.born_where = params.born_where;
      if (params.limit) queryParams.limit = params.limit;
      const data = await mixpanelJSON("GET", "/retention", queryParams);
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 7. frequency_report ────────────────────────────────────────────────────

server.tool(
  "frequency_report",
  "Get a frequency report (addiction report). Shows how often users perform an event within a time window.",
  {
    event: z.string().describe("Event name"),
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    addiction_unit: z
      .enum(["day", "week", "month"])
      .default("day")
      .describe("Frequency bucket unit (default: day)"),
    unit: z
      .enum(["day", "week", "month"])
      .default("day")
      .describe("Time unit for grouping results (default: day)"),
    where: z.string().optional().describe("Filter expression"),
    limit: z.number().optional().describe("Max segments to return"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/retention/frequency", {
        event: params.event,
        from_date: params.from_date,
        to_date: params.to_date,
        addiction_unit: params.addiction_unit,
        unit: params.unit,
        ...(params.where && { where: params.where }),
        ...(params.limit && { limit: params.limit }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 8. query_profiles ──────────────────────────────────────────────────────

server.tool(
  "query_profiles",
  "Query user profiles using the Engage API. Filter and retrieve user profile data.",
  {
    where: z
      .string()
      .optional()
      .describe(
        'Filter expression (e.g. \'properties["$last_seen"] > "2024-01-01"\')'
      ),
    output_properties: z
      .array(z.string())
      .optional()
      .describe("List of profile properties to return"),
    page: z.number().optional().describe("Page number for pagination"),
    session_id: z
      .string()
      .optional()
      .describe("Session ID for paginated queries"),
    page_size: z
      .number()
      .min(100)
      .optional()
      .describe("Number of results per page (min 100, default: 1000)"),
  },
  async (params) => {
    try {
      const queryParams: Record<string, unknown> = {};
      if (params.where) queryParams.where = params.where;
      if (params.output_properties)
        queryParams.output_properties = params.output_properties;
      if (params.page !== undefined) queryParams.page = params.page;
      if (params.session_id) queryParams.session_id = params.session_id;
      if (params.page_size) queryParams.page_size = params.page_size;
      const data = await mixpanelJSON("POST", "/engage", queryParams);
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 9. user_activity ───────────────────────────────────────────────────────

server.tool(
  "user_activity",
  "Get a user's activity stream. Returns recent events for a specific user.",
  {
    distinct_id: z.string().describe("User's distinct ID"),
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/stream/query", {
        distinct_ids: [params.distinct_id],
        from_date: params.from_date,
        to_date: params.to_date,
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 10. query_insights ─────────────────────────────────────────────────────

server.tool(
  "query_insights",
  "Run an Insights report. Flexible analytics query supporting multiple event types.",
  {
    bookmark_id: z.number().describe("Saved Insights report ID"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/insights", {
        bookmark_id: params.bookmark_id,
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 11. run_jql ────────────────────────────────────────────────────────────

server.tool(
  "run_jql",
  "Run a JQL (JavaScript Query Language) script against Mixpanel data. Allows complex custom queries.",
  {
    script: z.string().describe("JQL script to execute"),
    params: z
      .record(z.unknown())
      .optional()
      .describe("Parameters to pass to the JQL script"),
  },
  async (args) => {
    try {
      const queryParams: Record<string, unknown> = {
        script: args.script,
      };
      if (args.params) queryParams.params = JSON.stringify(args.params);
      const data = await mixpanelJSON("POST", "/jql", queryParams);
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 12. segmentation_sum ───────────────────────────────────────────────────

server.tool(
  "segmentation_sum",
  "Get the sum of a numeric event property over time. Useful for tracking totals like revenue.",
  {
    event: z.string().describe("Event name"),
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    on: z
      .string()
      .describe('Numeric property to sum (e.g. "properties[\\"amount\\"]")'),
    unit: z
      .enum(["minute", "hour", "day", "week", "month"])
      .optional()
      .describe("Time unit for bucketing"),
    where: z.string().optional().describe("Filter expression"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/segmentation/sum", {
        event: params.event,
        from_date: params.from_date,
        to_date: params.to_date,
        on: params.on,
        ...(params.unit && { unit: params.unit }),
        ...(params.where && { where: params.where }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 13. segmentation_average ───────────────────────────────────────────────

server.tool(
  "segmentation_average",
  "Get the average of a numeric event property over time. Useful for tracking averages like order value.",
  {
    event: z.string().describe("Event name"),
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    on: z
      .string()
      .describe(
        'Numeric property to average (e.g. "properties[\\"duration\\"]")'
      ),
    unit: z
      .enum(["minute", "hour", "day", "week", "month"])
      .optional()
      .describe("Time unit for bucketing"),
    where: z.string().optional().describe("Filter expression"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/segmentation/average", {
        event: params.event,
        from_date: params.from_date,
        to_date: params.to_date,
        on: params.on,
        ...(params.unit && { unit: params.unit }),
        ...(params.where && { where: params.where }),
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 14. list_cohorts ───────────────────────────────────────────────────────

server.tool(
  "list_cohorts",
  "List all cohorts in the project. Returns cohort IDs, names, and metadata.",
  {},
  async () => {
    try {
      const data = await mixpanelJSON("POST", "/cohorts/list");
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 15. export_events ──────────────────────────────────────────────────────

server.tool(
  "export_events",
  "Export raw event data as NDJSON. Returns individual events with all properties. Capped at 5000 events.",
  {
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
    event: z
      .array(z.string())
      .optional()
      .describe("Filter to specific event names"),
    where: z.string().optional().describe("Filter expression"),
    limit: z
      .number()
      .optional()
      .describe("Max events to return (max 5000, default 5000)"),
  },
  async (params) => {
    try {
      const cap = Math.min(params.limit ?? 5000, 5000);
      const queryParams: Record<string, unknown> = {
        from_date: params.from_date,
        to_date: params.to_date,
      };
      if (params.event) queryParams.event = params.event;
      if (params.where) queryParams.where = params.where;
      const data = await mixpanelNDJSON(
        "GET",
        "/export",
        queryParams,
        "export",
        cap
      );
      return toolResult({ count: data.length, events: data });
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── 16. list_annotations ───────────────────────────────────────────────────

server.tool(
  "list_annotations",
  "List all annotations in the project. Annotations are notes attached to specific dates.",
  {
    from_date: z.string().describe("Start date (YYYY-MM-DD)"),
    to_date: z.string().describe("End date (YYYY-MM-DD)"),
  },
  async (params) => {
    try {
      const data = await mixpanelJSON("GET", "/annotations", {
        from_date: params.from_date,
        to_date: params.to_date,
      });
      return toolResult(data);
    } catch (error) {
      return toolError(error);
    }
  }
);

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mixpanel MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
