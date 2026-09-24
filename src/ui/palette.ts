export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export const UI_COLORS = {
  projectBackground: {red: 84, green: 82, blue: 132},
  projectForeground: {red: 245, green: 244, blue: 250},
  cwdBackground: {red: 69, green: 73, blue: 94},
  gitBackground: {red: 52, green: 105, blue: 98},
  gitForeground: {red: 239, green: 248, blue: 246},
  
  primary: {red: 242, green: 240, blue: 236},
  secondary: {red: 176, green: 184, blue: 194},
  subtle: {red: 125, green: 133, blue: 144},
  
  separator: {red: 139, green: 132, blue: 178},
  accent: {red: 197, green: 185, blue: 232},
  command: {red: 242, green: 240, blue: 236}, // Primary input
  
  workingBase: {red: 139, green: 132, blue: 178},
  workingPeak: {red: 211, green: 202, blue: 238},
  success: {red: 116, green: 181, blue: 154},
  failure: {red: 205, green: 115, blue: 123},
  selection: {red: 88, green: 96, blue: 145},
} as const satisfies Record<string, RgbColor>;

export function foreground(color: RgbColor): string {
  return `\u001B[38;2;${color.red};${color.green};${color.blue}m`;
}

export function background(color: RgbColor): string {
  return `\u001B[48;2;${color.red};${color.green};${color.blue}m`;
}
