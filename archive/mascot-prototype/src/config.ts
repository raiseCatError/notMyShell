import type {CatVariant} from './mascot/catPalettes.js';

export interface MascotConfig {
  enabled: boolean;
  variant: CatVariant;
  animation: boolean;
}

export interface ArchivedMascotConfig {
  mascot: MascotConfig;
}

export const appConfig: ArchivedMascotConfig = {
  mascot: {
    enabled: true,
    variant: 'black',
    animation: true,
  },
};
