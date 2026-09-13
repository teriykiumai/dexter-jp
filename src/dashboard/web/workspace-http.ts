import { z } from 'zod';
import { WorkspaceErrorSchema, WorkspaceSessionSchema } from '../workspace-contracts.js';
export class WorkspaceHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export async function read<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init), value = await response.json();
  if (!response.ok) {
    const { error } = WorkspaceErrorSchema.parse(value);
    throw new WorkspaceHttpError(response.status, error.code, error.message ?? ({ identity_review_required: '銘柄の同一性確認が必要です。',
    revision_conflict: '別の操作で更新されました。ページを再読み込みしてください。', invalid_input: '入力またはJ-Quants設定を確認してください。'
    } as Record<string, string>)[error.code] ?? '処理を確認できません。保存済みの状態を確認してください。');
  }
  return schema.parse(value);
}
export async function mutate<T>(url: string, body: unknown, schema: z.ZodType<T>, method = 'POST'): Promise<T> {
  const session = await read('/api/workspace/session', WorkspaceSessionSchema);
  return read(url, schema, { method, headers: { 'Content-Type': 'application/json', 'X-Dexter-CSRF': session.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
}
