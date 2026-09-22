export type CatVariant = 'black' | 'white';
export type CatColorRole = 'body' | 'outline' | 'detail' | 'sleep';

export interface CatPalette {
  body: string;
  outline: string;
  detail: string;
  sleep: string;
}

export const CAT_PALETTES: Record<CatVariant, CatPalette> = {
  black: {
    body: '38;2;35;39;48',
    outline: '38;2;151;157;169',
    detail: '38;2;232;200;112',
    sleep: '38;2;125;139;165',
  },
  white: {
    body: '38;2;235;232;222',
    outline: '38;2;69;72;82',
    detail: '38;2;71;73;82',
    sleep: '38;2;145;157;181',
  },
};

export const DEFAULT_CAT_VARIANT: CatVariant = 'black';
