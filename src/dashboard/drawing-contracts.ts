import { z } from 'zod';
import { isStrictGregorianDate } from '../analysis/strategy-validation/date.js';

const date = z.string().refine(isStrictGregorianDate);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const HorizontalWriteSchema = z.object({ id: z.uuid(), revision: z.number().int().nonnegative(),
  chartDigest: digest, price: z.number().positive().finite(), time: date }).strict();
export type HorizontalWrite = z.infer<typeof HorizontalWriteSchema>;
export const TrendlineWriteSchema = HorizontalWriteSchema.extend({ kind: z.literal('trendline'),
  endTime: date, endPrice: z.number().positive().finite() }).strict().refine(d => d.time < d.endTime);
export const DrawingWriteSchema = z.union([HorizontalWriteSchema, TrendlineWriteSchema]);
export type DrawingWrite = z.infer<typeof DrawingWriteSchema>;
export const HorizontalViewSchema = z.object({ id: z.uuid(), instrumentId: z.uuid(), revision: z.number().int().positive(),
  kind: z.literal('horizontal'), family: z.literal('swing'), adjustmentMode: z.literal('jquants_adjusted_ohlcv_not_total_return'),
  price: z.number().positive().finite(), time: date, evidenceFrom: date, evidenceThrough: date,
  basisDigest: digest, state: z.enum(['compatible', 'basis_review_required']) }).strict();
export type HorizontalView = z.infer<typeof HorizontalViewSchema>;
export const TrendlineViewSchema = HorizontalViewSchema.extend({ kind: z.literal('trendline'),
  endTime: date, endPrice: z.number().positive().finite() }).strict().refine(d => d.time < d.endTime);
export type DrawingView = HorizontalView | z.infer<typeof TrendlineViewSchema>;
export const DrawingPageSchema = z.object({ schemaVersion: z.literal('workspace_drawings_v2'), instrumentId: z.uuid(),
  chartDigest: digest.nullable(), items: z.array(z.union([HorizontalViewSchema, TrendlineViewSchema])).max(100), next: z.uuid().nullable() }).strict();
export type DrawingPage = z.infer<typeof DrawingPageSchema>;
export const DrawingSavedSchema = z.object({ schemaVersion: z.literal('workspace_drawing_saved_v2'),
  instrumentId: z.uuid(), id: z.uuid(), revision: z.number().int().positive(), historyToken: z.uuid(), historyState: z.uuid() }).strict();
export const DrawingDeletedSchema = z.object({ schemaVersion: z.literal('workspace_drawing_deleted_v2'), instrumentId: z.uuid(), id: z.uuid(), historyToken: z.uuid(), historyState: z.uuid() }).strict();
export const DrawingHistoryWriteSchema = z.object({ token: z.uuid(), direction: z.enum(['undo', 'redo']),
  revision: z.number().int().nonnegative(), state: z.uuid(), chartDigest: digest }).strict();
export const DrawingHistoryResultSchema = z.object({ schemaVersion: z.literal('workspace_drawing_history_v1'),
  instrumentId: z.uuid(), id: z.uuid(), revision: z.number().int().nonnegative(), state: z.uuid(), token: z.uuid(), direction: z.enum(['undo', 'redo']) }).strict();
