import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  approveQuotation,
  buildBookingEmailDraft,
  createOpCard,
  extractBookingFields,
  getOpCard,
  getQuotationDetail,
  getQuotationDocuments,
  listNewQuotations,
  markBookingEmailDrafted,
  updateOpCard,
  updateQuotationNetWeight,
} from '@/lib/mcp/booking-service';
import {
  getAwbTracking,
  listAwbsToTrack,
  manualResendDelivered,
  updateAwbTracking,
} from '@/lib/awb-tracking/service';
import { TRACKING_STATUSES } from '@/lib/awb-tracking/core';

const refInputSchema = fromJsonSchema<{ quotation_id?: string; omg_number?: string }>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
  },
  additionalProperties: false,
});

const approveInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  company_name?: string;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    company_name: {
      type: 'string',
      description:
        'Override Company name if empty on quotation (required to approve). Never changes destination or pricing.',
    },
  },
  additionalProperties: false,
});

const listInputSchema = fromJsonSchema<{
  status?: string;
  since?: string;
  exclude_drafted?: boolean;
  limit?: number;
}>({
  type: 'object',
  properties: {
    status: { type: 'string', description: 'Quotation status filter (default pending_approval)' },
    since: { type: 'string', description: 'ISO timestamp lower bound' },
    exclude_drafted: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
});

const markInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  drafted_by?: string;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    drafted_by: { type: 'string', description: 'Who drafted (default grok-bot)' },
  },
  additionalProperties: false,
});

const buildInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  net_weight_kg?: number;
  routing?: string;
  airline?: string;
  preferred_shipment_date?: string;
  mawb?: string;
  consignee?: string;
  number_of_pieces?: string;
  pallet_dimensions?: string;
  origin?: string;
  product?: string;
  destination?: string;
  packaging_type?: 'pallet' | 'box' | 'carton';
  pieces?: number;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    net_weight_kg: {
      type: 'number',
      description: 'Net weight KG from Commercial Invoice (override when pallets are 0)',
    },
    routing: { type: 'string', description: 'Routing e.g. BKK-ZRH' },
    airline: { type: 'string' },
    preferred_shipment_date: { type: 'string' },
    mawb: { type: 'string' },
    consignee: { type: 'string' },
    number_of_pieces: { type: 'string', description: 'Full override e.g. "12 Boxes"' },
    pallet_dimensions: { type: 'string' },
    origin: { type: 'string', description: 'Origin airport code e.g. BKK' },
    product: { type: 'string' },
    destination: { type: 'string' },
    packaging_type: {
      type: 'string',
      enum: ['pallet', 'box', 'carton'],
      description: 'Packaging unit for NUMBER OF PIECE (default pallet)',
    },
    pieces: { type: 'integer', minimum: 1, description: 'Piece count with packaging_type' },
  },
  additionalProperties: false,
});

const updateNetInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  net_weight_kg: number;
  source: string;
  note?: string;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    net_weight_kg: { type: 'number', description: 'Correct net weight in KG (writes total_actual_weight)' },
    source: {
      type: 'string',
      description: 'Provenance e.g. commercial-invoice, packing-list, manual',
    },
    note: { type: 'string', description: 'Optional audit note appended to internal_remark' },
  },
  required: ['net_weight_kg', 'source'],
  additionalProperties: false,
});

const opCardInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  topic?: string;
  stage?: string;
  notes?: string;
  owner_email?: string;
  owner_id?: string;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    topic: { type: 'string', description: 'Override opportunity topic (default quotation_no or company)' },
    stage: { type: 'string', description: 'Override stage (default inquiry)' },
    notes: { type: 'string', description: 'Override opportunity notes' },
    owner_email: { type: 'string', description: 'Staff owner email (default OPPORTUNITY_OWNER_EMAIL env)' },
    owner_id: { type: 'string', description: 'Staff owner profile UUID (overrides owner_email)' },
  },
  additionalProperties: false,
});

const getOpCardInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  op_card_id?: string;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    op_card_id: { type: 'string', description: 'Opportunity UUID' },
  },
  additionalProperties: false,
});

const OP_STAGES = [
  'inquiry',
  'quoting',
  'pending_docs',
  'pending_booking',
  'booking_requested',
  'awb_received',
  'waiting_for_pickup',
  'picked_up',
  'delivered',
  'payment_received',
] as const;

const updateOpCardInputSchema = fromJsonSchema<{
  quotation_id?: string;
  omg_number?: string;
  op_card_id?: string;
  stage?: string;
  pickup_date?: string;
  notes?: string;
  payment_date?: string;
}>({
  type: 'object',
  properties: {
    quotation_id: { type: 'string', description: 'Quotation UUID' },
    omg_number: { type: 'string', description: 'OMG number, e.g. OMG09014' },
    op_card_id: { type: 'string', description: 'Opportunity UUID' },
    stage: {
      type: 'string',
      enum: [...OP_STAGES],
      description: 'Opportunity stage e.g. waiting_for_pickup',
    },
    pickup_date: { type: 'string', description: 'Pickup date YYYY-MM-DD' },
    notes: { type: 'string', description: 'Opportunity notes (replaces field)' },
    payment_date: { type: 'string', description: 'Payment date YYYY-MM-DD' },
  },
  additionalProperties: false,
});

// ponytail: advertised schema via fromJsonSchema (SDK AJV); Zod 3 refines in handlers.
const listSchema = z.object({
  status: z.string().optional(),
  since: z.string().optional(),
  exclude_drafted: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const refSchema = z
  .object({
    quotation_id: z.string().uuid().optional(),
    omg_number: z.string().min(1).optional(),
  })
  .refine((a) => a.quotation_id || a.omg_number, 'Provide quotation_id or omg_number');

const markSchema = refSchema.and(
  z.object({ drafted_by: z.string().optional() })
);

const buildSchema = refSchema.and(
  z.object({
    net_weight_kg: z.number().positive().optional(),
    routing: z.string().min(1).optional(),
    airline: z.string().optional(),
    preferred_shipment_date: z.string().optional(),
    mawb: z.string().optional(),
    consignee: z.string().optional(),
    number_of_pieces: z.string().optional(),
    pallet_dimensions: z.string().optional(),
    origin: z.string().optional(),
    product: z.string().optional(),
    destination: z.string().optional(),
    packaging_type: z.enum(['pallet', 'box', 'carton']).optional(),
    pieces: z.number().int().min(1).optional(),
  })
);

const updateNetSchema = refSchema.and(
  z.object({
    net_weight_kg: z.number().positive(),
    source: z.string().min(1),
    note: z.string().optional(),
  })
);

const approveSchema = refSchema.and(
  z.object({
    company_name: z.string().min(1).optional(),
  })
);

const opCardSchema = refSchema.and(
  z.object({
    topic: z.string().optional(),
    stage: z.string().optional(),
    notes: z.string().optional(),
    owner_email: z.string().email().optional(),
    owner_id: z.string().uuid().optional(),
  })
);

const getOpCardSchema = z
  .object({
    quotation_id: z.string().uuid().optional(),
    omg_number: z.string().min(1).optional(),
    op_card_id: z.string().uuid().optional(),
  })
  .refine((a) => a.quotation_id || a.omg_number || a.op_card_id, 'Provide quotation_id, omg_number, or op_card_id');

const updateOpCardRefSchema = z
  .object({
    quotation_id: z.string().uuid().optional(),
    omg_number: z.string().min(1).optional(),
    op_card_id: z.string().uuid().optional(),
  })
  .refine((a) => a.quotation_id || a.omg_number || a.op_card_id, 'Provide quotation_id, omg_number, or op_card_id');

const updateOpCardSchema = updateOpCardRefSchema.and(
  z.object({
    stage: z.enum(OP_STAGES).optional(),
    pickup_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'pickup_date must be YYYY-MM-DD')
      .optional(),
    notes: z.string().optional(),
    payment_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD')
      .optional(),
  })
);

function jsonText(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function parseOrThrow<T>(schema: z.ZodType<T>, args: unknown): T {
  const r = schema.safeParse(args);
  if (!r.success) throw new Error(r.error.errors.map((e) => e.message).join('; '));
  return r.data;
}

export function registerBookingTools(server: McpServer): void {
  server.registerTool(
    'list_new_quotations',
    {
      description:
        'List quotations awaiting booking email (default status=pending_approval, excludes already drafted).',
      inputSchema: listInputSchema,
    },
    async (args) => jsonText(await listNewQuotations(parseOrThrow(listSchema, args)))
  );

  server.registerTool(
    'get_quotation',
    {
      description: 'Full quotation detail + attachment metadata by quotation_id or OMG number.',
      inputSchema: refInputSchema,
    },
    async (args) => {
      const ref = parseOrThrow(refSchema, args);
      const detail = await getQuotationDetail(ref);
      if (!detail) return jsonText({ error: 'Quotation not found.' });
      return jsonText(detail);
    }
  );

  server.registerTool(
    'get_quotation_documents',
    {
      description: 'List customer documents with signed download URLs for a quotation.',
      inputSchema: refInputSchema,
    },
    async (args) => {
      const ref = parseOrThrow(refSchema, args);
      const docs = await getQuotationDocuments(ref);
      if (!docs) return jsonText({ error: 'Quotation not found.' });
      return jsonText(docs);
    }
  );

  server.registerTool(
    'extract_booking_fields',
    {
      description:
        'Normalized booking fields for email drafting. Net weight from quotation pallets / total_actual_weight; when 0, read verify_from_documents (Commercial Invoice then packing list) and persist via update_quotation_net_weight. Returns packaging_type, pieces, chargeable_weight (info only). Never uses chargeable as net.',
      inputSchema: refInputSchema,
    },
    async (args) => {
      const ref = parseOrThrow(refSchema, args);
      const fields = await extractBookingFields(ref);
      if (!fields) return jsonText({ error: 'Quotation not found.' });
      return jsonText(fields);
    }
  );

  server.registerTool(
    'build_booking_email_draft',
    {
      description:
        'Build booking request email subject + body + to/cc in OMG standard format. Does not send mail. Pass net_weight_kg from Commercial Invoice when pallet weights are 0. Optional packaging_type + pieces for NUMBER OF PIECE.',
      inputSchema: buildInputSchema,
    },
    async (args) => {
      const parsed = parseOrThrow(buildSchema, args);
      const draft = await buildBookingEmailDraft(parsed);
      if (!draft) return jsonText({ error: 'Quotation not found.' });
      return jsonText(draft);
    }
  );

  server.registerTool(
    'mark_booking_email_drafted',
    {
      description: 'Mark quotation as drafted (idempotent — safe to retry for same OMG#).',
      inputSchema: markInputSchema,
    },
    async (args) => {
      const parsed = parseOrThrow(markSchema, args);
      return jsonText(await markBookingEmailDrafted(parsed));
    }
  );

  server.registerTool(
    'update_quotation_net_weight',
    {
      description:
        'Write correct net weight to quotation total_actual_weight (not chargeable). Idempotent re-set is ok.',
      inputSchema: updateNetInputSchema,
    },
    async (args) => jsonText(await updateQuotationNetWeight(parseOrThrow(updateNetSchema, args)))
  );

  server.registerTool(
    'approve_quotation',
    {
      description:
        'Staff approve customer quote request (pending_approval -> draft or docs_uploaded). Sets company_name if missing. Reassigns user_id to OPPORTUNITY_OWNER_EMAIL staff. NEVER changes destination_id, destination, rates, chargeable_weight, manual_rate, or any pricing. Idempotent if already approved.',
      inputSchema: approveInputSchema,
    },
    async (args) => jsonText(await approveQuotation(parseOrThrow(approveSchema, args)))
  );

  server.registerTool(
    'create_op_card',
    {
      description:
        'Create Opportunity / Op card from quotation (same as UI New Opportunity). Assigns staff owner_id so card appears in Opportunities list. Returns existing if already linked; repairs owner_id if mismatched. On existing cards, applies stage/notes if passed — use update_op_card for pickup_date/payment_date.',
      inputSchema: opCardInputSchema,
    },
    async (args) => jsonText(await createOpCard(parseOrThrow(opCardSchema, args)))
  );

  server.registerTool(
    'update_op_card',
    {
      description:
        'Update existing Opportunity stage, pickup_date, notes, and/or payment_date. Returns full get_op_card payload after update.',
      inputSchema: updateOpCardInputSchema,
    },
    async (args) => jsonText(await updateOpCard(parseOrThrow(updateOpCardSchema, args)))
  );

  server.registerTool(
    'get_op_card',
    {
      description:
        'Fetch Opportunity / Op card by quotation_id, omg_number, or op_card_id. Returns owner_id and linked quotation for debugging visibility.',
      inputSchema: getOpCardInputSchema,
    },
    async (args) => {
      const ref = parseOrThrow(getOpCardSchema, args);
      const card = await getOpCard(ref);
      if (!card) return jsonText({ error: 'Opportunity not found.' });
      return jsonText(card);
    }
  );

  const awbRefInputSchema = fromJsonSchema<{ awb_number?: string; omg_number?: string }>({
    type: 'object',
    properties: {
      awb_number: { type: 'string', description: 'AWB with or without dash/space' },
      omg_number: { type: 'string', description: 'OMG quotation number' },
    },
    additionalProperties: false,
  });

  const listAwbsToTrackInputSchema = fromJsonSchema<{ days?: number }>({
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: 'Only AWBs with pickup_date (or quotation created_at) within this many days. Default 30. Use 3650 for full backlog.',
      },
    },
    additionalProperties: false,
  });

  const updateAwbTrackingInputSchema = fromJsonSchema<{
    awb_number: string;
    status: string;
    raw_text: string;
    source_url: string;
    delivered_at?: string;
    send_email?: boolean;
    flight_no?: string;
    flight_date?: string;
    chargeable_weight_kg?: number;
  }>({
    type: 'object',
    properties: {
      awb_number: { type: 'string' },
      status: { type: 'string', enum: [...TRACKING_STATUSES] },
      raw_text: { type: 'string' },
      source_url: { type: 'string' },
      delivered_at: {
        type: 'string',
        description: 'ISO datetime with destination timezone offset, e.g. 2026-09-30T14:20:00+02:00',
      },
      send_email: {
        type: 'boolean',
        description: 'When status=delivered, default true. Set false to mark delivered without customer email.',
      },
      flight_no: { type: 'string', description: 'From airline tracking page (merged if not already set)' },
      flight_date: { type: 'string', description: 'Flight date YYYY-MM-DD from airline page' },
      chargeable_weight_kg: { type: 'number', description: 'Chargeable kg from airline if not on quotation' },
    },
    required: ['awb_number', 'status', 'raw_text', 'source_url'],
    additionalProperties: false,
  });

  const awbRefSchema = z
    .object({
      awb_number: z.string().min(1).optional(),
      omg_number: z.string().min(1).optional(),
    })
    .refine((a) => a.awb_number || a.omg_number, 'Provide awb_number or omg_number');

  const listAwbsToTrackSchema = z.object({
    days: z.number().int().positive().optional(),
  });

  const updateAwbTrackingSchema = z.object({
    awb_number: z.string().min(1),
    status: z.enum(TRACKING_STATUSES),
    raw_text: z.string(),
    source_url: z.string(),
    delivered_at: z.string().optional(),
    send_email: z.boolean().optional(),
    flight_no: z.string().optional(),
    flight_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'flight_date must be YYYY-MM-DD')
      .optional(),
    chargeable_weight_kg: z.number().positive().optional(),
  });

  server.registerTool(
    'list_awbs_to_track',
    {
      description:
        'List AWBs on Op cards at picked_up+ without delivered_at. Default: pickup_date (or created_at) within 30 days. carrier_code derived from AWB prefix when not stored.',
      inputSchema: listAwbsToTrackInputSchema,
    },
    async (args) => {
      const parsed = parseOrThrow(listAwbsToTrackSchema, args ?? {});
      return jsonText(await listAwbsToTrack({ days: parsed.days }));
    }
  );

  server.registerTool(
    'update_awb_tracking',
    {
      description:
        'Record airline tracking from Grokbot. delivered: sets delivered_at, advances Op stage, sends customer email once (unless send_email=false). Pass delivered_at with destination offset.',
      inputSchema: updateAwbTrackingInputSchema,
    },
    async (args) => {
      const parsed = parseOrThrow(updateAwbTrackingSchema, args);
      const result = await updateAwbTracking({
        ...parsed,
        created_by: 'grok-bot',
      });
      return jsonText(result);
    }
  );

  server.registerTool(
    'resend_delivered_email',
    {
      description: 'Resend delivered notification for an already-delivered AWB/OMG (manual log row, for retests).',
      inputSchema: awbRefInputSchema,
    },
    async (args) => {
      const ref = parseOrThrow(awbRefSchema, args);
      const result = await manualResendDelivered(ref);
      return jsonText(result);
    }
  );

  server.registerTool(
    'get_awb_tracking',
    {
      description: 'Current tracking status, history, and notification log for an AWB or OMG number.',
      inputSchema: awbRefInputSchema,
    },
    async (args) => {
      const ref = parseOrThrow(awbRefSchema, args);
      const data = await getAwbTracking(ref);
      if (!data) return jsonText({ error: 'Not found.' });
      return jsonText(data);
    }
  );
}
