/**
 * The seven WebMCP tools of the living-room planner (docs/prd.md section 18), as data.
 *
 * Each definition carries what the model sees (`name`, `description`, `inputSchema`,
 * `annotations`) plus a `route` that maps the tool call onto the API route the UI calls
 * (section 19). `register.ts` turns these into `document.modelContext` registrations.
 *
 * Argument names are camelCase, matching the PRD's registration example; the request bodies use
 * the domain's snake_case column names.
 */
import { Kind } from "@/domain/types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";

export interface Route {
  method: HttpMethod;
  /** Path template; `:projectId` is substituted at call time. */
  path: string;
  /** Maps tool arguments to the JSON request body. Absent for GET. */
  body?: (args: ToolArgs) => unknown;
}

export type ToolArgs = Record<string, unknown>;

export interface JsonSchemaProperty {
  type?: "string" | "integer" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

export interface JsonObjectSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: JsonObjectSchema;
  annotations: { readOnlyHint: boolean };
  /** A fixed route, or a chooser when the route depends on the arguments. */
  route: Route | ((args: ToolArgs) => Route);
}

export const TOOL_NAMES = [
  "get_project_state",
  "add_product",
  "set_project_requirement",
  "update_bom",
  "replace_bom_item",
  "place_product",
  "evaluate_project"
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const BOM_ACTIONS = ["add", "remove", "approve"] as const;

export const REQUIREMENT_TYPES = [
  "budget",
  "room_dimensions",
  "required_item",
  "visual_direction",
  "layout_requirement",
  "delivery_date"
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

const PROJECT_PATH = "/api/projects/:projectId";

const NO_INPUT: JsonObjectSchema = { type: "object", properties: {}, additionalProperties: false };

const bomItemId: JsonSchemaProperty = {
  type: "string",
  description: "Id of a BOM line, as returned by get_project_state under bom[].id."
};

/**
 * Budget and required date live on the Project row (PATCH); every other requirement is one agreed
 * row that POST /requirements appends or updates in place (#60), so the route is chosen per type.
 * PUT /spec replaces every row and stays the plan form's route only.
 */
function requirementRoute(args: ToolArgs): Route {
  const type = args.type as RequirementType;
  if (type === "budget") {
    return { method: "PATCH", path: PROJECT_PATH, body: ({ value }) => ({ budget_cents: value }) };
  }
  if (type === "delivery_date") {
    return { method: "PATCH", path: PROJECT_PATH, body: ({ value }) => ({ required_by: value }) };
  }
  if (type === "room_dimensions") {
    return { method: "PUT", path: `${PROJECT_PATH}/spec`, body: ({ value }) => ({ space: value }) };
  }
  return {
    method: "POST",
    path: `${PROJECT_PATH}/requirements`,
    body: ({ type, value, scope }) => ({ type, value, scope: scope ?? "project" })
  };
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "get_project_state",
    description:
      "Read the current furnishing project: room dimensions, agreed requirements and visual direction, the bill of materials (BOM) with each product's title, price and status, the budget total and state, the delivery deadline and address, and open questions. Call this first, before any write, to learn the ids and the current numbers.",
    inputSchema: NO_INPUT,
    annotations: { readOnlyHint: true },
    route: { method: "GET", path: PROJECT_PATH }
  },
  {
    name: "add_product",
    description:
      "Add a product to the project from its merchant URL. The server ingests the product (price, dimensions, image), makes it a candidate, and adds a proposed BOM line for it; the budget updates at once. Call when the user pastes or names a specific product page to add. Do not call for a product already in the BOM; use update_bom with action add to restore a removed line.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          format: "uri",
          description: "The product page URL on the merchant's store, exactly as the user gave it."
        },
        category: {
          type: "string",
          description: "What the user calls the item, in their own words (for example \"side table\" or \"reading lamp\"), when they name it. Omit to use the product's title."
        },
        kind: {
          type: "string",
          enum: Kind.options,
          description: "How the item renders in the room plan. seating: sofas, chairs, benches. table: any table or desk. storage: shelves, cabinets. soft_floor: rugs. bed. lighting: lamps. decor: ottomans, plants, art. other. Omit to let the server infer it from the item name."
        },
        room: {
          type: "string",
          description: "Name of the room the product is for, when the project has more than one. Omit for a single-room project."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    route: {
      method: "POST",
      path: `${PROJECT_PATH}/products`,
      body: ({ url, category, kind, room }) => ({ url, category, kind, room })
    }
  },
  {
    name: "set_project_requirement",
    description:
      "Set one project requirement: the budget, the room dimensions, an item the project must include, the visual direction (palette), a layout rule, or the delivery date. Call when the user states or changes a constraint. Each call sets one requirement and leaves the others in place; a required_item with a name already recorded, or a layout_requirement with the same relation, subject, and objects, updates that row. Call again for another. Money is integer cents and lengths are integer millimetres.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: REQUIREMENT_TYPES,
          description: "Which requirement to set. budget: maximum spend in cents. room_dimensions: room size. required_item: an item the project must include, in the user's words. visual_direction: colours. layout_requirement: a placement rule between named items. delivery_date: the date everything must arrive by."
        },
        value: {
          description:
            "The requirement value, shaped by type. budget: integer cents, e.g. 250000 for $2,500. room_dimensions: {\"width_mm\": integer, \"length_mm\": integer}. required_item: the item in the user's words, either a string such as \"reading chair\" or {\"name\": string, \"kind\": seating | table | storage | soft_floor | bed | lighting | decor | other | null}. visual_direction: {\"base\": [hex colour], \"accent\": [hex colour]}. layout_requirement: {\"relation\": under | on_top_of | beside | facing | against_wall | clear_around, \"subject\": item name, \"objects\": [item name], \"distance_mm\"?: integer}, e.g. {\"relation\": \"under\", \"subject\": \"big rug\", \"objects\": [\"sofa\", \"coffee table\"]}. delivery_date: ISO date YYYY-MM-DD."
        },
        scope: {
          type: "string",
          description: "What the requirement applies to: \"project\" (default) or a room name."
        }
      },
      required: ["type", "value"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    route: requirementRoute
  },
  {
    name: "update_bom",
    description:
      "Change the status or quantity of one existing BOM line. action add restores a removed line to proposed; remove marks it removed (it leaves the budget); approve marks it approved. Call when the user accepts, drops, or restores a product already in the BOM. To bring in a new product use add_product; to swap one product for another use replace_bom_item.",
    inputSchema: {
      type: "object",
      properties: {
        bomItemId,
        action: {
          type: "string",
          enum: BOM_ACTIONS,
          description: "add restores a removed line; remove marks the line removed; approve marks it approved."
        },
        quantity: {
          type: "integer",
          minimum: 1,
          description: "New quantity for the line. Omit to keep the current quantity."
        }
      },
      required: ["bomItemId", "action"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    route: {
      method: "PUT",
      path: `${PROJECT_PATH}/bom`,
      body: ({ bomItemId, action, quantity }) => ({ bomItemId, action, quantity })
    }
  },
  {
    name: "replace_bom_item",
    description:
      "Replace one product in the BOM with another product in a single transaction: the old line is removed, the new product gets a line, its placement moves to the new line, and the budget recalculates. Call when the user picks a replacement (for example a cheaper coffee table) for a line that is already in the BOM. The replacement product must already be a candidate in the project; add it with add_product first if it is not.",
    inputSchema: {
      type: "object",
      properties: {
        existingBomItemId: { ...bomItemId, description: "Id of the BOM line being replaced." },
        replacementProductId: {
          type: "string",
          description: "Id of the product that takes its place, from a candidate or product listing in the project."
        }
      },
      required: ["existingBomItemId", "replacementProductId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    route: {
      method: "POST",
      path: `${PROJECT_PATH}/bom/replace`,
      body: ({ existingBomItemId, replacementProductId }) => ({ existingBomItemId, replacementProductId })
    }
  },
  {
    name: "place_product",
    description:
      "Place a BOM line's product on the room floor, or move it. xMm and yMm are the centre of the product's footprint in millimetres from the room's origin corner (x along the room width, y along the room length); rotationDeg turns the footprint counter-clockwise about that centre, seen from above, and 0 faces +y. The server saves the placement, runs the geometry check, and returns warnings: one per product this one overlaps and one if it crosses a room wall. An overlapping placement is saved, not rejected, so read the warnings and move the product when there is one. Call when the user asks to put, move, or turn a product.",
    inputSchema: {
      type: "object",
      properties: {
        bomItemId,
        xMm: {
          type: "integer",
          minimum: 0,
          description: "Footprint centre, in millimetres from the origin corner along the room width."
        },
        yMm: {
          type: "integer",
          minimum: 0,
          description: "Footprint centre, in millimetres from the origin corner along the room length."
        },
        rotationDeg: {
          type: "number",
          minimum: 0,
          maximum: 360,
          description: "Rotation in degrees counter-clockwise about the footprint centre, seen from above; 0 means the product's front faces +y."
        }
      },
      required: ["bomItemId", "xMm", "yMm", "rotationDeg"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    route: {
      method: "PUT",
      path: `${PROJECT_PATH}/placements`,
      body: ({ bomItemId, xMm, yMm, rotationDeg }) => ({
        placements: [{ bom_item_id: bomItemId, x_mm: xMm, y_mm: yMm, rotation_deg: rotationDeg }]
      })
    }
  },
  {
    name: "evaluate_project",
    description:
      "Check the project against its requirements without changing anything: budget state (under, exact, over) with the total, required items still missing from the BOM, geometry conflicts between placed products and the result of each layout rule, each BOM line's delivery status against the deadline, and unresolved issues. Call after a change to confirm the project still meets its constraints, or when the user asks whether the plan works.",
    inputSchema: NO_INPUT,
    annotations: { readOnlyHint: true },
    route: { method: "GET", path: PROJECT_PATH }
  }
];

export const TOOLS_BY_NAME: ReadonlyMap<ToolName, ToolDefinition> = new Map(
  TOOLS.map((tool) => [tool.name, tool])
);

export function resolveRoute(tool: ToolDefinition, args: ToolArgs): Route {
  return typeof tool.route === "function" ? tool.route(args) : tool.route;
}
