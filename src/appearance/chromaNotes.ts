/** Shown wherever a theme preview includes Chroma, so it is never mistaken for the base theme. */
export const CHROMA_PREVIEW_NOTE = 'Chroma is enabled · previews include Chroma. Turn Chroma Off to view the base theme colors.';
/** What Chroma touches, said once (the Setup Cat Chroma row). */
export const CHROMA_SCOPE_NOTE = 'Chroma recolors the Native prompt/effects. Theme/UI chrome and text follow their own appearance settings unless explicitly configured otherwise.';

/** Local preview state can differ from the saved Chroma setting. Always label what is visible. */
export function chromaPreviewNote(on: boolean): string {
  return on ? 'Previews are colorized. Turn Chroma Off to view the base theme colors. /chroma for details.'
    : 'Showing base theme colors. /chroma for color and motion settings.';
}
