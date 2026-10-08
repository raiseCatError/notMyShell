/** Exact bare invocation only, and only after runtime proof and shell resolution. */
export function bareProviderRoute(command: string, resolution: Readonly<Record<string, string>>, proven: boolean): string | undefined {
  return proven && command.trim() === 'claude' && resolution.claude === 'executable' ? 'claude' : undefined;
}
