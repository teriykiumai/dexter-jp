import { z } from 'zod';
import { isStrictGregorianDate } from '../analysis/strategy-validation/date.js';

const date = z.string().refine(isStrictGregorianDate);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const HorizontalWriteSchema = z.object({ id: z.uuid(), revision: z.number().int().nonnegative(),
  chartDigest: digest, price: z.number().positive().finite(), time: date }).strict();
export type HorizontalWrite = z.infer<typeof HorizontalWriteSchema>;
export const TrendlineWriteSchema = HorizontalWriteSchema.extend({ kind: z.literal('trendline'),
  endTime: date, endPrice: z.number().positive().finite() }).strict().refine(d => d.time < d.endTime);
export const FibonacciWriteSchema = HorizontalWriteSchema.extend({ kind: z.literal('fibonacci'),
  endTime: date, endPrice: z.number().positive().finite() }).strict().refine(d => d.time < d.endTime);
export const DrawingWriteSchema = z.union([HorizontalWriteSchema, TrendlineWriteSchema, FibonacciWriteSchema]);
export const BasisAcceptSchema = z.object({ action: z.literal('accept_basis'), revision: z.number().int().positive(),
  chartDigest: digest, confirm: z.literal(true) }).strict();
export type BasisAccept = z.infer<typeof BasisAcceptSchema>;
const projection = z.union([
  z.object({ state: z.literal('available'), time: date, endTime: date }).strict(),
  z.object({ state: z.literal('unavailable'), reason: z.enum(['same_period', 'missing_period', 'basis_review_required']) }).strict(),
]);
export const DrawingProjectionsSchema = z.object({ day: projection, week: projection, month: projection }).strict();
export type DrawingWrite = z.infer<typeof DrawingWriteSchema>;
export const HorizontalViewSchema = z.object({ id: z.uuid(), instrumentId: z.uuid(), revision: z.number().int().positive(),
  kind: z.literal('horizontal'), family: z.literal('swing'), adjustmentMode: z.literal('jquants_adjusted_ohlcv_not_total_return'),
  price: z.number().positive().finite(), time: date, evidenceFrom: date, evidenceThrough: date,
  basisDigest: digest, acceptedBasis: z.object({ digest, revision: z.number().int().positive() }).strict().nullable(),
  projections: DrawingProjectionsSchema, state: z.enum(['compatible', 'basis_review_required']) }).strict();
export type HorizontalView = z.infer<typeof HorizontalViewSchema>;
export const TrendlineViewSchema = HorizontalViewSchema.extend({ kind: z.literal('trendline'),
  endTime: date, endPrice: z.number().positive().finite() }).strict().refine(d => d.time < d.endTime);
export const FibonacciViewSchema = HorizontalViewSchema.extend({ kind: z.literal('fibonacci'),
  endTime: date, endPrice: z.number().positive().finite(),
  levels: z.array(z.object({ ratio: z.number().min(0).max(1), price: z.number().positive().finite() }).strict()).length(7)
}).strict().refine(d => d.time < d.endTime);
export type DrawingView = HorizontalView | z.infer<typeof TrendlineViewSchema> | z.infer<typeof FibonacciViewSchema>;
export const DrawingPageSchema = z.object({ schemaVersion: z.literal('workspace_drawings_v3'), instrumentId: z.uuid(),
  chartDigest: digest.nullable(), items: z.array(z.union([HorizontalViewSchema, TrendlineViewSchema, FibonacciViewSchema])).max(100), next: z.uuid().nullable() }).strict();
export type DrawingPage = z.infer<typeof DrawingPageSchema>;
export const DrawingSavedSchema = z.object({ schemaVersion: z.literal('workspace_drawing_saved_v2'),
  instrumentId: z.uuid(), id: z.uuid(), revision: z.number().int().positive(), historyToken: z.uuid(), historyState: z.uuid() }).strict();
export const DrawingDeletedSchema = z.object({ schemaVersion: z.literal('workspace_drawing_deleted_v2'), instrumentId: z.uuid(), id: z.uuid(), historyToken: z.uuid(), historyState: z.uuid() }).strict();
export const DrawingHistoryWriteSchema = z.object({ token: z.uuid(), direction: z.enum(['undo', 'redo']),
  revision: z.number().int().nonnegative(), state: z.uuid(), chartDigest: digest }).strict();
export const DrawingHistoryResultSchema = z.object({ schemaVersion: z.literal('workspace_drawing_history_v1'),
  instrumentId: z.uuid(), id: z.uuid(), revision: z.number().int().nonnegative(), state: z.uuid(), token: z.uuid(), direction: z.enum(['undo', 'redo']) }).strict();
