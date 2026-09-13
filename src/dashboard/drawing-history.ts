import { randomUUID } from 'node:crypto';
import { fail, json, type StoredDrawing } from '../analysis/workspace/contracts.js';

export type DrawingCommand = { instrumentId: string; id: string; before: StoredDrawing | null;
  after: StoredDrawing | null; direction: 'undo' | 'redo'; highRevision: number };
export class DrawingHistory {
  private entries = new Map<string, DrawingCommand>();
  private states = new Map<string, string>();
  record(instrumentId: string, id: string, before: StoredDrawing | null, after: StoredDrawing | null): { historyToken: string; historyState: string } {
    const token = randomUUID();
    this.entries.set(token, { instrumentId, id, before, after, direction: 'undo',
      highRevision: Math.max(before?.revision ?? 0, after?.revision ?? 0) });
    if (this.entries.size > 100) this.entries.delete(this.entries.keys().next().value!);
    for (const key of this.states.keys()) if (![...this.entries.values()].some(command => command.id === key)) this.states.delete(key);
    return { historyToken: token, historyState: this.advance(id) };
  }
  advance(id: string): string { const state = randomUUID(); this.states.set(id, state); return state; }
  requireState(id: string, state: string): void { if (this.states.get(id) !== state) fail('revision_conflict'); }
  get(token: string, instrumentId: string, id: string, direction: 'undo' | 'redo'): DrawingCommand {
    const command = this.entries.get(token);
    if (!command || command.instrumentId !== instrumentId || command.id !== id || command.direction !== direction) fail('revision_conflict');
    return command;
  }
}
export function sameDrawingContent(a: StoredDrawing | null, b: StoredDrawing | null): boolean {
  return json(a ? { ...a, revision: 0 } : null) === json(b ? { ...b, revision: 0 } : null);
}
