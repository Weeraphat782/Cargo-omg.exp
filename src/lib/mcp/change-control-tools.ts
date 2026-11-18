import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  activeAssignments,
  addMove,
  applyChangeSet,
  createChangeSet,
  getChangeSet,
  getSlot,
  listChangeSets,
  listSlots,
  slotHistory,
  type ChangeControlDeps,
} from '@/lib/change-control/service';

function deps(): ChangeControlDeps {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Supabase not configured');
  return { supabase };
}

function jsonText(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

const slotIdInputSchema = fromJsonSchema<{ slot_id: string }>({
  type: 'object',
  properties: { slot_id: { type: 'string' } },
  required: ['slot_id'],
  additionalProperties: false,
});

const createCsInputSchema = fromJsonSchema<{ reason?: string; created_by: string }>({
  type: 'object',
  properties: {
    reason: { type: 'string' },
    created_by: { type: 'string' },
  },
  required: ['created_by'],
  additionalProperties: false,
});

const addMoveInputSchema = fromJsonSchema<{ change_set_id: string; move: unknown }>({
  type: 'object',
  properties: {
    change_set_id: { type: 'string' },
    move: { type: 'object' },
  },
  required: ['change_set_id', 'move'],
  additionalProperties: false,
});

const applyCsInputSchema = fromJsonSchema<{ change_set_id: string; actor_id: string }>({
  type: 'object',
  properties: {
    change_set_id: { type: 'string' },
    actor_id: { type: 'string' },
  },
  required: ['change_set_id', 'actor_id'],
  additionalProperties: false,
});

const getCsInputSchema = fromJsonSchema<{ change_set_id: string }>({
  type: 'object',
  properties: { change_set_id: { type: 'string' } },
  required: ['change_set_id'],
  additionalProperties: false,
});

const historyInputSchema = fromJsonSchema<{ quotation_id?: string; slot_id?: string }>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string' },
    slot_id: { type: 'string' },
  },
  additionalProperties: false,
});

const moveSchema = z.object({
  quotation_id: z.string().uuid(),
  from_slot_id: z.string().uuid().nullable().optional(),
  to_slot_id: z.string().uuid().nullable().optional(),
  move_type: z.enum(['replace', 'swap', 'move', 'park', 'new_booking']),
  new_slot: z
    .object({
      airline: z.string().optional(),
      flight_no: z.string().optional(),
      flight_date: z.string().optional(),
      load_date: z.string().optional(),
      awb_number: z.string().optional(),
      booked_pallets: z.number().int().positive().optional(),
    })
    .optional(),
});

export function registerChangeControlTools(server: McpServer): void {
  server.registerTool(
    'list_slots',
    { description: 'List airline slots with active OMG job assignment (vacant slots included).' },
    async () => jsonText(await listSlots(deps())),
  );

  server.registerTool(
    'get_slot',
    {
      description: 'Get one slot by UUID.',
      inputSchema: slotIdInputSchema,
    },
    async (args) => {
      const slotId = z.object({ slot_id: z.string().uuid() }).parse(args).slot_id;
      return jsonText(await getSlot(deps(), slotId));
    },
  );

  server.registerTool(
    'create_change_set',
    {
      description: 'Create a draft Change Set (CS-yymm-seq).',
      inputSchema: createCsInputSchema,
    },
    async (args) => {
      const p = z.object({ reason: z.string().optional(), created_by: z.string().uuid() }).parse(args);
      return jsonText(await createChangeSet(deps(), p));
    },
  );

  server.registerTool(
    'add_move',
    {
      description: 'Append a move to a draft Change Set.',
      inputSchema: addMoveInputSchema,
    },
    async (args) => {
      const p = z
        .object({ change_set_id: z.string().uuid(), move: moveSchema })
        .parse(args);
      return jsonText(await addMove(deps(), p.change_set_id, p.move));
    },
  );

  server.registerTool(
    'approve_change_set',
    {
      description: 'Apply all moves in a draft Change Set (atomic).',
      inputSchema: applyCsInputSchema,
    },
    async (args) => {
      const p = z
        .object({ change_set_id: z.string().uuid(), actor_id: z.string().uuid() })
        .parse(args);
      return jsonText(await applyChangeSet(deps(), p.change_set_id, p.actor_id));
    },
  );

  server.registerTool(
    'get_change_set',
    {
      description: 'Fetch Change Set header and ordered moves.',
      inputSchema: getCsInputSchema,
    },
    async (args) => {
      const id = z.object({ change_set_id: z.string().uuid() }).parse(args).change_set_id;
      return jsonText(await getChangeSet(deps(), id));
    },
  );

  server.registerTool(
    'slot_history',
    {
      description: 'Audit timeline for a quotation_id or slot_id.',
      inputSchema: historyInputSchema,
    },
    async (args) => {
      const ref = z
        .object({
          quotation_id: z.string().uuid().optional(),
          slot_id: z.string().uuid().optional(),
        })
        .parse(args ?? {});
      return jsonText(await slotHistory(deps(), ref));
    },
  );

  // ponytail: listChangeSets and activeAssignments exposed via UI only unless MCP needs them later
  void listChangeSets;
  void activeAssignments;
}