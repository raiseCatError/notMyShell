/**
 * Removes whole terminal control sequences from hostile display text (titles,
 * directory and module names) instead of leaving their printable debris: the
 * name `evil ESC ] 0 ; PWNED BEL` shows as `evil`, not `evil�]0;PWNED`.
 *
 * Strings (OSC, DCS, SOS, PM, APC) run to BEL or ST (or the next ESC); an unterminated one
 * swallows the rest of the input, as a terminal would. CSI runs to its final
 * byte. 7-bit and C1 introducers are both handled. Every remaining C0/C1
 * control and bidi formatting character is dropped. Input is bounded first,
 * and each pattern is linear (no nested quantifiers).
 */
const STRING_SEQUENCE = /(?:\u001b[\]PX^_]|[\u0090\u0098\u009d\u009e\u009f])[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c|(?=\u001b)|$)/gu;
const CSI_SEQUENCE = /(?:\u001b\[|\u009b)[0-?]*[ -/]*(?:[@-~]|$)/gu;
const ESCAPE_SEQUENCE = /\u001b[ -/]*[0-~]?/gu;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;

export function stripTerminalControls(value: string, maxLength = 1024): string {
  return value.slice(0, maxLength)
    .replace(STRING_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESCAPE_SEQUENCE, '')
    .replace(CONTROLS, '');
}
