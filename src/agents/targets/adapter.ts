/** Internal provider operations. Never passed to portable instances. */
export interface TargetAdapter {
  readonly pid: number | undefined;
  start(): {ok: true} | {ok: false; reason: string};
  send(text: string): boolean;
  answer(requestId: string, allow: boolean): boolean;
  choose?(requestId: string, answers: Record<string, string>): boolean;
  cancel(): void;
  close(): void;
}
