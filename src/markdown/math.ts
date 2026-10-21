import {displayWidth} from '../util/text.js';

/**
 * A small, defined subset of LaTeX mathematics for the terminal (#462): a tokenizer, a recursive-descent parser and a
 * two-dimensional box layout. It is not TeX and does not pretend to be: anything outside the subset — an unknown command,
 * an environment other than the matrices and `cases`, an unbalanced brace, a double script — makes `renderMath` fail with a
 * reason, and the caller then shows the source as written. It never draws a different formula from the one written.
 *
 * Supported: letters, digits and punctuation; Greek letters and the common operator, relation, arrow and set symbols;
 * `\frac` (`\dfrac`, `\tfrac`), `\binom`, `\sqrt[n]{}`, `^` and `_`, `\sum \prod \int \oint \lim \max \min` with limits,
 * named functions (`\sin`, `\log` …), `\text`, `\mathrm \mathbf \mathbb \mathcal \mathit \mathsf \mathtt`, accents on one
 * character, `\left … \right`, spacing commands, and `matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix cases`.
 *
 * Inline mode produces exactly one row (a fraction reads `a/b` with brackets where needed, a script that has no Unicode form
 * becomes `x^(…)`), display mode a box of rows with the baseline on the fraction bar. Work is bounded: source length, nesting
 * depth, node count, rows and width all have fixed limits.
 */

export const MATH_LIMITS = {source: 4000, depth: 24, nodes: 800, rows: 40, width: 500} as const;

export type MathResult = {ok: true; rows: string[]; baseline: number; width: number} | {ok: false; reason: string};

class Unsupported extends Error {}
const fail = (reason: string): never => { throw new Unsupported(reason); };

// ---- Symbols ----------------------------------------------------------------------------------------------------

const GREEK: Record<string, string> = {alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'};
const PREFIX: Record<string, string> = {forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬'};
const ORDINARY: Record<string, string> = {infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', varnothing: '∅', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', angle: '∠', prime: '′', degree: '°', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', top: '⊤', bot: '⊥', perp: '⊥', triangle: '△', square: '□', checkmark: '✓',
  '%': '%', '&': '&', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}', '|': '‖', '\\|': '‖'};
const BINARY: Record<string, string> = {times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', ast: '∗', star: '⋆', circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗', cup: '∪', cap: '∩', land: '∧', wedge: '∧', lor: '∨', vee: '∨', setminus: '∖', ominus: '⊖', odot: '⊙'};
const RELATION: Record<string, string> = {leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔', implies: '⇒', mapsto: '↦', uparrow: '↑', downarrow: '↓', ll: '≪', gg: '≫', parallel: '∥', mid: '∣', vdash: '⊢', models: '⊨', nsubseteq: '⊈', longrightarrow: '⟶', longleftarrow: '⟵'};
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'min', 'max', 'sup', 'inf', 'lim', 'liminf', 'limsup', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'Pr', 'hom', 'mod', 'sgn']);
const BIG: Record<string, string> = {sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂', bigvee: '⋁', bigwedge: '⋀'};
const LIMITS_ABOVE = new Set(['sum', 'prod', 'coprod', 'bigcup', 'bigcap', 'bigoplus', 'bigotimes', 'bigvee', 'bigwedge']);
const DELIMITERS: Record<string, string> = {'(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', '|': '|', '.': '', '\\{': '{', '\\}': '}', '\\|': '‖', '\\langle': '⟨', '\\rangle': '⟩', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉', '\\vert': '|', '\\Vert': '‖', '/': '/', '<': '⟨', '>': '⟩'};
const SPACES: Record<string, number> = {',': 1, ':': 1, ';': 1, ' ': 1, quad: 2, qquad: 4, '!': 0, enspace: 1};
const SUPERSCRIPT: Record<string, string> = {'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ', L: 'ᴸ', M: 'ᴹ', N: 'ᴺ', O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ', '′': '′', '∘': '°', '*': '*', β: 'ᵝ', γ: 'ᵞ', δ: 'ᵟ', φ: 'ᵠ', χ: 'ᵡ'};
const SUBSCRIPT: Record<string, string> = {'0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', β: 'ᵦ', γ: 'ᵧ', ρ: 'ᵨ', φ: 'ᵩ', χ: 'ᵪ'};
const MATH_ALPHABETS: Record<string, {upper: number; lower: number; digits?: number; exceptions?: Record<string, string>}> = {
  bf: {upper: 0x1d400, lower: 0x1d41a, digits: 0x1d7ce}, it: {upper: 0x1d434, lower: 0x1d44e, exceptions: {h: 'ℎ'}},
  cal: {upper: 0x1d49c, lower: 0x1d4b6, exceptions: {B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ'}},
  frak: {upper: 0x1d504, lower: 0x1d51e, exceptions: {C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ'}},
  bb: {upper: 0x1d538, lower: 0x1d552, digits: 0x1d7d8, exceptions: {C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ'}},
  sf: {upper: 0x1d5a0, lower: 0x1d5ba, digits: 0x1d7e2}, tt: {upper: 0x1d670, lower: 0x1d68a, digits: 0x1d7f6},
};
const FONT_COMMANDS: Record<string, string> = {mathbf: 'bf', boldsymbol: 'bf', bm: 'bf', mathit: 'it', mathcal: 'cal', mathscr: 'cal', mathfrak: 'frak', mathbb: 'bb', mathsf: 'sf', mathtt: 'tt'};
const ACCENTS: Record<string, string> = {hat: '̂', widehat: '̂', bar: '̄', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', widetilde: '̃', acute: '́', grave: '̀', breve: '̆', check: '̌', overline: '̅'};
// Lookup tables take command names from the document: no inherited keys (`\constructor`, `\toString`) may match.
for (const table of [GREEK, PREFIX, ORDINARY, BINARY, RELATION, BIG, DELIMITERS, SPACES, SUPERSCRIPT, SUBSCRIPT, MATH_ALPHABETS, FONT_COMMANDS, ACCENTS] as object[]) Object.setPrototypeOf(table, null);

function styled(text: string, font: string): string {
  const alphabet = MATH_ALPHABETS[font]!;
  let out = '';
  for (const char of text) {
    if (alphabet.exceptions?.[char]) out += alphabet.exceptions[char];
    else if (/[A-Z]/u.test(char)) out += String.fromCodePoint(alphabet.upper + char.charCodeAt(0) - 65);
    else if (/[a-z]/u.test(char)) out += String.fromCodePoint(alphabet.lower + char.charCodeAt(0) - 97);
    else if (alphabet.digits && /[0-9]/u.test(char)) out += String.fromCodePoint(alphabet.digits + char.charCodeAt(0) - 48);
    else out += char;
  }
  return out;
}

// ---- Tokens and syntax tree -------------------------------------------------------------------------------------

type Token = ({kind: 'command'; name: string} | {kind: 'char'; char: string} | {kind: 'open'} | {kind: 'close'} | {kind: 'sup'} | {kind: 'sub'} | {kind: 'amp'} | {kind: 'row'} | {kind: 'number'; text: string}) & {spaced?: true};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < source.length;) {
    const char = String.fromCodePoint(source.codePointAt(at)!);
    if (/\s/u.test(char)) { if (tokens.length) tokens[tokens.length - 1]!.spaced = true; at += 1; continue; }
    if (char === '\\') {
      const word = /^[A-Za-z]+/u.exec(source.slice(at + 1, at + 40));
      if (word) { tokens.push({kind: 'command', name: word[0]}); at += 1 + word[0].length; continue; }
      const next = source[at + 1];
      if (next === undefined) fail('a backslash at the end');
      if (next === '\\') { tokens.push({kind: 'row'}); at += 2; continue; }
      tokens.push({kind: 'command', name: next!}); at += 2; continue;
    }
    if (char === '{') tokens.push({kind: 'open'});
    else if (char === '}') tokens.push({kind: 'close'});
    else if (char === '^') tokens.push({kind: 'sup'});
    else if (char === '_') tokens.push({kind: 'sub'});
    else if (char === '&') tokens.push({kind: 'amp'});
    else if (/[0-9]/u.test(char)) { const number = /^[0-9]+(?:\.[0-9]+)?/u.exec(source.slice(at, at + 40))!; tokens.push({kind: 'number', text: number[0]}); at += number[0].length; continue; }
    else if (char === '$' || char === '~' || char === '#') fail(`“${char}” is not part of the subset`);
    else tokens.push({kind: 'char', char});
    at += char.length;
  }
  return tokens;
}

type Node =
  | {t: 'ord'; s: string} | {t: 'bin'; s: string} | {t: 'rel'; s: string} | {t: 'func'; s: string} | {t: 'punct'; s: string} | {t: 'text'; s: string}
  | {t: 'open'; s: string} | {t: 'close'; s: string} | {t: 'space'; n: number}
  | {t: 'group'; items: Node[]}
  | {t: 'script'; base: Node; sup?: Node; sub?: Node}
  | {t: 'frac'; num: Node; den: Node; bar: boolean}
  | {t: 'sqrt'; body: Node; index?: Node}
  | {t: 'delim'; left: string; right: string; body: Node}
  | {t: 'big'; name: string; s: string}
  | {t: 'accent'; mark: string; body: string}
  | {t: 'grid'; rows: Node[][]; left: string; right: string; cases?: boolean};

class Parser {
  private at = 0;
  private nodes = 0;
  constructor(private readonly tokens: Token[]) {}
  private count(): void { if (++this.nodes > MATH_LIMITS.nodes) fail('the formula is too large'); }
  private peek(): Token | undefined { return this.tokens[this.at]; }
  private next(): Token | undefined { return this.tokens[this.at++]; }

  parse(): Node {
    const node = this.row(0, 'end');
    if (this.at < this.tokens.length) fail('an unmatched closing brace or command');
    return node;
  }

  /** Items up to a stop token ('close' brace, '\\right', '\\end', '&', '\\\\' or the end). */
  private row(depth: number, stop: 'end' | 'brace' | 'right' | 'environment' | 'cell'): Node {
    if (depth > MATH_LIMITS.depth) fail('the formula is nested too deeply');
    const items: Node[] = [];
    for (;;) {
      const token = this.peek();
      if (!token) { if (stop === 'brace') fail('a brace is never closed'); if (stop === 'right') fail('\\left has no \\right'); if (stop === 'environment' || stop === 'cell') fail('an environment is never closed'); break; }
      if (token.kind === 'close') { if (stop === 'brace') break; fail('an unmatched closing brace'); }
      if (token.kind === 'command' && (token.name === 'right') ) { if (stop === 'right') break; fail('\\right without \\left'); }
      if (token.kind === 'command' && token.name === 'end') { if (stop === 'environment' || stop === 'cell') break; fail('\\end without \\begin'); }
      if ((token.kind === 'amp' || token.kind === 'row')) { if (stop === 'cell') break; fail('“&” or “\\\\” outside a matrix'); }
      items.push(this.scripted(depth));
    }
    return {t: 'group', items};
  }

  private scripted(depth: number): Node {
    let base = this.atom(depth);
    let sup: Node | undefined, sub: Node | undefined;
    for (;;) {
      const token = this.peek();
      if (token?.kind === 'command' && (token.name === 'limits' || token.name === 'nolimits')) { this.next(); continue; }
      if (token?.kind === 'sup') { if (sup) fail('two superscripts on one symbol'); this.next(); sup = this.argument(depth); }
      else if (token?.kind === 'sub') { if (sub) fail('two subscripts on one symbol'); this.next(); sub = this.argument(depth); }
      else break;
    }
    if (sup || sub) { this.count(); base = {t: 'script', base, ...(sup ? {sup} : {}), ...(sub ? {sub} : {})}; }
    return base;
  }

  /** `{…}` or one token. */
  private argument(depth: number): Node {
    const token = this.peek();
    if (!token) return fail('a script or argument is missing');
    if (token.kind === 'open') { this.next(); const body = this.row(depth + 1, 'brace'); this.next(); return body; }
    if (token.kind === 'close' || token.kind === 'sup' || token.kind === 'sub' || token.kind === 'amp' || token.kind === 'row') return fail('a script or argument is missing');
    if (token.kind === 'number') {
      // As in TeX, a script or argument takes one digit: x^23 is x² followed by 3.
      this.next();
      if (token.text.length > 1 && !token.text.includes('.')) this.tokens.splice(this.at, 0, {kind: 'number', text: token.text.slice(1)});
      return {t: 'ord', s: token.text.includes('.') ? token.text : token.text[0]!};
    }
    return this.atom(depth);
  }

  private text(depth: number, raw = true): string {
    const token = this.next();
    if (token?.kind !== 'open') return fail('\\text needs a braced argument');
    let text = token.spaced ? ' ' : '', open = 1;
    for (let count = 0; count < 400; count += 1) {
      const part = this.next();
      if (!part) return fail('a brace is never closed');
      if (part.kind === 'open') { open += 1; if (part.spaced) text += ' '; continue; }
      if (part.kind === 'close') { open -= 1; if (!open) return text; if (part.spaced) text += ' '; continue; }
      if (part.kind === 'char' && /[\p{C}\p{Zl}\p{Zp}]/u.test(part.char)) return fail('control characters are not allowed in text');
      if (part.kind === 'char') text += part.char; else if (part.kind === 'number') text += part.text; else if (part.kind === 'command' && part.name === ' ') text += ' '; else return fail('only plain text is supported inside \\text');
      if (part.spaced) text += ' ';
    }
    void depth; void raw;
    return fail('the text is too long');
  }

  private atom(depth: number): Node {
    if (depth > MATH_LIMITS.depth) fail('the formula is nested too deeply');
    this.count();
    const token = this.next();
    if (!token) return fail('the formula ends too soon');
    switch (token.kind) {
      case 'number': return {t: 'ord', s: token.text};
      case 'open': { const body = this.row(depth + 1, 'brace'); this.next(); return body; }
      case 'char': return this.character(token.char);
      case 'command': return this.command(token.name, depth);
      default: return fail('unexpected symbol');
    }
  }

  private character(char: string): Node {
    if (char === '-') return {t: 'bin', s: '−'};
    if (char === '+' || char === '*' || char === '/') return {t: 'bin', s: char === '*' ? '∗' : char};
    if (char === '=' || char === '<' || char === '>') return {t: 'rel', s: char};
    if (char === ',' || char === ';') return {t: 'punct', s: char};
    if (char === '(' || char === '[') return {t: 'open', s: char};
    if (char === ')' || char === ']') return {t: 'close', s: char};
    if (char === '|' || char === '!' || char === '.' || char === ':' || char === '?' || char === '\'' || char === '`' || char === '@') return {t: 'ord', s: char === '\'' ? '′' : char};
    if (/[\p{L}\p{N}\p{S}\p{P}]/u.test(char)) return {t: 'ord', s: char};
    return fail(`“${char}” is not supported`);
  }

  private command(name: string, depth: number): Node {
    if (GREEK[name]) return {t: 'ord', s: GREEK[name]!};
    if (BINARY[name]) return {t: 'bin', s: BINARY[name]!};
    if (RELATION[name]) return {t: 'rel', s: RELATION[name]!};
    if (ORDINARY[name]) return {t: 'ord', s: ORDINARY[name]!};
    if (BIG[name]) return {t: 'big', name, s: BIG[name]!};
    if (FUNCTIONS.has(name)) return {t: 'func', s: name};
    if (PREFIX[name]) return {t: 'func', s: PREFIX[name]!};
    if (name in SPACES) return {t: 'space', n: SPACES[name]!};
    if (name === 'langle') return {t: 'open', s: '⟨'}; if (name === 'rangle') return {t: 'close', s: '⟩'};
    if (name === 'lfloor') return {t: 'open', s: '⌊'}; if (name === 'rfloor') return {t: 'close', s: '⌋'};
    if (name === 'lceil') return {t: 'open', s: '⌈'}; if (name === 'rceil') return {t: 'close', s: '⌉'};
    if (name === 'lbrace') return {t: 'open', s: '{'}; if (name === 'rbrace') return {t: 'close', s: '}'};
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'binom' || name === 'dbinom') {
      const num = this.argument(depth + 1), den = this.argument(depth + 1);
      if (isEmpty(num) || isEmpty(den)) return fail('a fraction argument is empty');
      return name.endsWith('binom') ? {t: 'delim', left: '(', right: ')', body: {t: 'frac', num, den, bar: false}} : {t: 'frac', num, den, bar: true};
    }
    if (name === 'sqrt') {
      let index: Node | undefined;
      if (this.peek()?.kind === 'char' && (this.peek() as {char: string}).char === '[') {
        this.next();
        const items: Node[] = [];
        for (let count = 0; ; count += 1) {
          const token = this.peek();
          if (!token || count > 50) fail('the root index is not closed');
          if (token!.kind === 'char' && (token as {char: string}).char === ']') { this.next(); break; }
          items.push(this.scripted(depth + 1));
        }
        index = {t: 'group', items};
      }
      const body = this.argument(depth + 1);
      if (isEmpty(body)) return fail('a root has nothing under it');
      return {t: 'sqrt', body, ...(index ? {index} : {})};
    }
    if (name === 'operatorname') return {t: 'func', s: this.text(depth)};
    if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'mbox' || name === 'textit' || name === 'textbf') return {t: 'text', s: this.text(depth)};
    if (FONT_COMMANDS[name]) {
      const body = this.argument(depth + 1);
      const flat = flatText(body);
      if (flat === undefined) return fail(`\\${name} supports letters and digits only`);
      return {t: 'ord', s: styled(flat, FONT_COMMANDS[name]!)};
    }
    if (ACCENTS[name]) {
      const flat = flatText(this.argument(depth + 1));
      if (flat === undefined || [...flat].length !== 1) return fail(`\\${name} supports one character here`);
      return {t: 'accent', mark: ACCENTS[name]!, body: flat};
    }
    if (name === 'underline') { const flat = flatText(this.argument(depth + 1)); if (flat === undefined || [...flat].length !== 1) return fail('\\underline supports one character here'); return {t: 'accent', mark: '̲', body: flat}; }
    if (name === 'left') {
      const left = this.delimiter();
      const body = this.row(depth + 1, 'right');
      const closing = this.next();
      if (closing?.kind !== 'command' || closing.name !== 'right') return fail('\\left has no \\right');
      return {t: 'delim', left, right: this.delimiter(), body};
    }
    if (name === 'begin') return this.environment(depth);
    if (name === 'displaystyle' || name === 'textstyle' || name === 'limits' || name === 'nolimits') return {t: 'space', n: 0};
    return fail(`\\${name} is not supported`);
  }

  private delimiter(): string {
    const token = this.next();
    if (!token) return fail('a delimiter is missing');
    const key = token.kind === 'char' ? token.char : token.kind === 'command' ? `\\${token.name}` : token.kind === 'open' ? '{' : '';
    if (!(key in DELIMITERS)) return fail('this delimiter is not supported');
    return DELIMITERS[key]!;
  }

  private environment(depth: number): Node {
    const name = this.text(depth);
    const matrices: Record<string, [string, string]> = {matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', '']};
    if (!Object.hasOwn(matrices, name)) return fail(`the “${name}” environment is not supported`);
    const rows: Node[][] = [[]];
    for (let guard = 0; guard < 400; guard += 1) {
      rows.at(-1)!.push(this.row(depth + 1, 'cell'));
      const token = this.next();
      if (!token) return fail('an environment is never closed');
      if (token.kind === 'amp') continue;
      if (token.kind === 'row') { rows.push([]); continue; }
      if (token.kind === 'command' && token.name === 'end') {
        if (this.text(depth) !== name) return fail('\\end does not match \\begin');
        if (!rows.at(-1)!.length || (rows.at(-1)!.length === 1 && (rows.at(-1)![0] as {items: Node[]}).items.length === 0 && rows.length > 1)) rows.pop();
        const width = Math.max(...rows.map(row => row.length));
        if (rows.some(row => row.length !== width) && name !== 'cases') return fail('the rows of a matrix have different numbers of cells');
        if (rows.length * width > 144) return fail('the matrix is too large');
        const [left, right] = matrices[name]!;
        return {t: 'grid', rows, left, right, ...(name === 'cases' ? {cases: true} : {})};
      }
      return fail('unexpected symbol in an environment');
    }
    return fail('the environment is too long');
  }
}

const isEmpty = (node: Node) => node.t === 'group' && node.items.length === 0;

/** The plain text of a node made only of letters, digits and symbols (for font and accent commands), or undefined. */
/** A script's content written without operator spacing (x_{n+1} is `n+1`), or undefined if it holds anything but plain symbols. */
function compact(node: Node): string | undefined {
  if (node.t === 'ord' || node.t === 'punct' || node.t === 'bin' || node.t === 'rel' || node.t === 'text' || node.t === 'open' || node.t === 'close') return node.s;
  if (node.t === 'group') { let out = ''; for (const item of node.items) { const part = compact(item); if (part === undefined) return undefined; out += part; } return out; }
  return undefined;
}

function flatText(node: Node): string | undefined {
  if (node.t === 'ord' || node.t === 'punct') return node.s;
  if (node.t === 'group') { let out = ''; for (const item of node.items) { const part = flatText(item); if (part === undefined) return undefined; out += part; } return out; }
  return undefined;
}

// ---- Boxes ------------------------------------------------------------------------------------------------------

interface Box {rows: string[]; width: number; baseline: number}
const text = (s: string): Box => ({rows: [s], width: displayWidth(s), baseline: 0});
const EMPTY: Box = {rows: [''], width: 0, baseline: 0};
const pad = (row: string, width: number, align: 'left' | 'center' | 'right' = 'left') => {
  const room = Math.max(0, width - displayWidth(row));
  const before = align === 'center' ? Math.floor(room / 2) : align === 'right' ? room : 0;
  return ' '.repeat(before) + row + ' '.repeat(room - before);
};

/** Boxes side by side with their baselines on one row. */
function hcat(boxes: readonly Box[]): Box {
  const parts = boxes.filter(box => box.width > 0 || box.rows.length > 1);
  if (!parts.length) return EMPTY;
  const above = Math.max(...parts.map(box => box.baseline));
  const below = Math.max(...parts.map(box => box.rows.length - 1 - box.baseline));
  const width = parts.reduce((sum, box) => sum + box.width, 0);
  const rows: string[] = [];
  for (let row = 0; row <= above + below; row += 1) {
    rows.push(parts.map(box => { const index = row - (above - box.baseline); return index >= 0 && index < box.rows.length ? pad(box.rows[index]!, box.width) : ' '.repeat(box.width); }).join(''));
  }
  return {rows, width, baseline: above};
}

function vstack(top: Box, bottom: Box, baselineOf: 'top' | 'bottom' | number): Box {
  const width = Math.max(top.width, bottom.width);
  return {rows: [...top.rows.map(row => pad(row, width, 'center')), ...bottom.rows.map(row => pad(row, width, 'center'))], width, baseline: typeof baselineOf === 'number' ? baselineOf : baselineOf === 'top' ? top.baseline : top.rows.length + bottom.baseline};
}

interface Context {display: boolean; ascii: boolean}

function mapScript(box: string, table: Record<string, string>): string | undefined {
  let out = '';
  for (const char of box) { const mapped = table[char]; if (mapped === undefined) return undefined; out += mapped; }
  return out;
}

class Layout {
  constructor(private readonly context: Context) {}
  private get inline() { return !this.context.display; }

  node(node: Node): Box {
    const box = this.build(node);
    if (box.rows.length > MATH_LIMITS.rows || box.width > MATH_LIMITS.width) return fail('the formula is too large to draw');
    return box;
  }

  private build(node: Node): Box {
    switch (node.t) {
      case 'ord': case 'punct': return text(node.s);
      case 'bin': case 'rel': return text(node.s);
      case 'func': return text(node.s);
      case 'text': return text(node.s);
      case 'open': case 'close': return text(node.s);
      case 'space': return text(' '.repeat(node.n));
      case 'group': return this.sequence(node.items);
      case 'script': return this.script(node);
      case 'frac': return this.frac(node);
      case 'sqrt': return this.sqrt(node);
      case 'delim': return this.delim(node);
      case 'big': return text(node.s);
      case 'accent': return text(node.body + node.mark);
      case 'grid': return this.grid(node);
    }
  }

  /** Items in order with the spacing TeX gives operators and relations. */
  sequence(items: readonly Node[]): Box {
    const boxes: Box[] = [];
    let before: Node | undefined;
    const isOperand = (node: Node | undefined) => Boolean(node) && !(node!.t === 'bin' || node!.t === 'rel' || node!.t === 'open' || node!.t === 'punct' || node!.t === 'space' || node!.t === 'func' || node!.t === 'big' || (node!.t === 'script' && (node!.base.t === 'func' || node!.base.t === 'big')));
    const isFunc = (node: Node) => node.t === 'func' || node.t === 'big' || (node.t === 'script' && (node.base.t === 'func' || node.base.t === 'big'));
    items.forEach((item, index) => {
      const next = items[index + 1];
      const operand = Boolean(before) && !(before!.t === 'bin' || before!.t === 'rel' || before!.t === 'open' || before!.t === 'punct' || before!.t === 'space' || before!.t === 'func');
      if ((item.t === 'bin' || item.t === 'rel') && (item.t === 'rel' || operand)) {
        const rightOperand = Boolean(next) && next!.t !== 'close';
        boxes.push(text(item.t === 'bin' && !rightOperand ? item.s : ` ${item.s} `));
      } else if (item.t === 'punct') boxes.push(text(`${item.s} `));
      else if (isFunc(item)) {
        if (isOperand(before) && before!.t !== 'close' && !(before!.t === 'ord' && /^\d$/u.test(before!.s))) boxes.push(text(' '));
        else if (before?.t === 'ord' || before?.t === 'close') boxes.push(text(' '));
        boxes.push(this.node(item));
        if (next && !(next.t === 'open' || next.t === 'close' || next.t === 'rel' || next.t === 'punct' || next.t === 'space' || (next.t === 'script' && false) || (item.t === 'big' && next.t === 'script'))) boxes.push(text(' '));
      } else if (this.inline && (item.t === 'frac' || item.t === 'sqrt') && (isOperand(before) || isOperand(next))) {
        const box = this.node(item);
        boxes.push(text(`(${box.rows[0]!.trim()})`));
      } else boxes.push(this.node(item));
      before = item;
    });
    return hcat(boxes);
  }

  private script(node: Extract<Node, {t: 'script'}>): Box {
    let base = this.node(node.base);
    if (this.inline && (node.base.t === 'frac' || node.base.t === 'sqrt')) base = text(`(${base.rows[0]!.trim()})`);
    const baseNode = node.base;
    if (baseNode.t === 'big' && LIMITS_ABOVE.has(baseNode.name) && this.context.display) {
      const up = node.sup ? this.node(node.sup) : undefined, down = node.sub ? this.node(node.sub) : undefined;
      let box = base;
      if (up) box = vstack(up, box, up.rows.length + box.baseline);
      if (down) box = vstack(box, down, box.baseline);
      return box;
    }
    const sup = node.sup ? this.node(node.sup) : undefined, sub = node.sub ? this.node(node.sub) : undefined;
    const supCompact = node.sup ? compact(node.sup) : undefined, subCompact = node.sub ? compact(node.sub) : undefined;
    const superText = supCompact !== undefined ? mapScript(supCompact, SUPERSCRIPT) : undefined;
    const subText = subCompact !== undefined ? mapScript(subCompact, SUBSCRIPT) : undefined;
    const simple = (!sup || superText !== undefined) && (!sub || subText !== undefined);
    if (simple) return hcat([base, text(`${subText ?? ''}${superText ?? ''}`)]);
    if (this.inline) {
      if ((sup && sup.rows.length > 1) || (sub && sub.rows.length > 1)) return fail('a script needs more than one row');
      const wrap = (box: Box | undefined, plain: string | undefined, mark: string) => box ? text(`${mark}(${plain ?? box.rows[0]!.trim()})`) : EMPTY;
      return hcat([base, wrap(sub, subCompact, '_'), wrap(sup, supCompact, '^')]);
    }
    // Two dimensions: the superscript ends on the row above the baseline, the subscript starts on the row below it.
    const baseline = base.baseline;
    const supTop = sup ? baseline - sup.rows.length : 0;
    const subTop = baseline + 1;
    const top = Math.min(0, supTop);
    const bottom = Math.max(base.rows.length, sub ? subTop + sub.rows.length : 0);
    const side = Math.max(sup?.width ?? 0, sub?.width ?? 0);
    // Rows are composed from whole cells, never cut by string index: wide and astral characters keep their columns.
    const rows: string[] = [];
    for (let y = top; y < bottom; y += 1) {
      const left = y >= 0 && y < base.rows.length ? pad(base.rows[y]!, base.width) : ' '.repeat(base.width);
      const supRow = sup && y >= supTop && y < supTop + sup.rows.length ? sup.rows[y - supTop]! : undefined;
      const subRow = sub && y >= subTop && y < subTop + sub.rows.length ? sub.rows[y - subTop]! : undefined;
      rows.push(left + pad(supRow ?? subRow ?? '', side));
    }
    return {rows, width: base.width + side, baseline: baseline - top};
  }

  private frac(node: Extract<Node, {t: 'frac'}>): Box {
    const num = this.node(node.num), den = this.node(node.den);
    if (this.inline) {
      if (num.rows.length > 1 || den.rows.length > 1) return fail('a fraction needs more than one row');
      const wrap = (box: Box, source: Node, numerator: boolean) => { const row = box.rows[0]!.trim(); return /^[\p{L}\p{N}.]+$/u.test(row) || (numerator && source.t === 'group' && source.items.length === 1 && source.items[0]!.t === 'frac') ? row : `(${row})`; };
      if (!node.bar) return text(`${num.rows[0]!.trim()} choose ${den.rows[0]!.trim()}`);
      return text(`${wrap(num, node.num, true)}/${wrap(den, node.den, false)}`);
    }
    if (!node.bar) return vstack(num, den, Math.floor((num.rows.length + den.rows.length - 1) / 2));
    const width = Math.max(num.width, den.width) + 2;
    const bar = (this.context.ascii ? '-' : '─').repeat(width);
    return {rows: [...num.rows.map(row => pad(row, width, 'center')), bar, ...den.rows.map(row => pad(row, width, 'center'))], width, baseline: num.rows.length};
  }

  private sqrt(node: Extract<Node, {t: 'sqrt'}>): Box {
    const body = this.node(node.body);
    const index = node.index ? this.node(node.index) : undefined;
    const indexText = index && index.rows.length === 1 ? index.rows[0]!.trim() : undefined;
    if (index && indexText === undefined) return fail('a root index needs more than one row');
    const radical = indexText === '3' ? '∛' : indexText === '4' ? '∜' : indexText ? `${mapScript(indexText, SUPERSCRIPT) ?? `(${indexText})`}√` : '√';
    if (this.inline || (body.rows.length === 1 && !this.context.display)) {
      if (body.rows.length > 1) return fail('a root needs more than one row');
      const row = body.rows[0]!.trim();
      return text(/^[\p{L}\p{N}.]$/u.test(row) || /^[\p{L}\p{N}.]+$/u.test(row) && [...row].length === 1 ? `${radical}${row}` : `${radical}(${row})`);
    }
    const width = body.width;
    const lead = displayWidth(radical);
    const over = (this.context.ascii ? '_' : '‾').repeat(width);
    const rows = [' '.repeat(lead) + over, ...body.rows.map((row, index) => (index === body.baseline ? radical : ' '.repeat(lead)) + pad(row, width))];
    return {rows, width: width + lead, baseline: body.baseline + 1};
  }

  private delim(node: Extract<Node, {t: 'delim'}>): Box {
    const body = this.node(node.body);
    return hcat([this.stretch(node.left, body.rows.length, body.baseline, true), body, this.stretch(node.right, body.rows.length, body.baseline, false)]);
  }

  private stretch(char: string, height: number, baseline: number, left: boolean): Box {
    if (!char) return EMPTY;
    if (height <= 1) return text(char);
    const ascii = this.context.ascii;
    type Pieces = {top: string; mid: string; bottom: string; single?: string};
    const sets: Record<string, Pieces> = ascii ? {
      '(': {top: '/', mid: '|', bottom: '\\'}, ')': {top: '\\', mid: '|', bottom: '/'}, '[': {top: '[', mid: '|', bottom: '['}, ']': {top: ']', mid: '|', bottom: ']'},
      '{': {top: '/', mid: '|', bottom: '\\', single: '<'}, '}': {top: '\\', mid: '|', bottom: '/', single: '>'}, '|': {top: '|', mid: '|', bottom: '|'}, '‖': {top: '|', mid: '|', bottom: '|'},
      '⟨': {top: '/', mid: '|', bottom: '\\'}, '⟩': {top: '\\', mid: '|', bottom: '/'}, '⌊': {top: '|', mid: '|', bottom: '|'}, '⌋': {top: '|', mid: '|', bottom: '|'}, '⌈': {top: '|', mid: '|', bottom: '|'}, '⌉': {top: '|', mid: '|', bottom: '|'},
    } : {
      '(': {top: '⎛', mid: '⎜', bottom: '⎝'}, ')': {top: '⎞', mid: '⎟', bottom: '⎠'}, '[': {top: '⎡', mid: '⎢', bottom: '⎣'}, ']': {top: '⎤', mid: '⎥', bottom: '⎦'},
      '{': {top: '⎧', mid: '⎪', bottom: '⎩', single: '⎨'}, '}': {top: '⎫', mid: '⎪', bottom: '⎭', single: '⎬'}, '|': {top: '│', mid: '│', bottom: '│'}, '‖': {top: '║', mid: '║', bottom: '║'},
      '⟨': {top: '╱', mid: '│', bottom: '╲'}, '⟩': {top: '╲', mid: '│', bottom: '╱'}, '⌊': {top: '│', mid: '│', bottom: '└'}, '⌋': {top: '│', mid: '│', bottom: '┘'}, '⌈': {top: '┌', mid: '│', bottom: '│'}, '⌉': {top: '┐', mid: '│', bottom: '│'},
    };
    const pieces = Object.hasOwn(sets, char) ? sets[char] : undefined;
    if (!pieces) return text(char);
    void left;
    const rows = Array.from({length: height}, (_, index) => index === 0 ? pieces.top : index === height - 1 ? pieces.bottom : pieces.mid);
    // A brace has its point on the middle row (odd heights) or the two middle rows (even heights use the pieces' own join).
    if ((char === '{' || char === '}') && height >= 3) rows[Math.floor(height / 2)] = pieces.single ?? pieces.mid;
    return {rows, width: 1, baseline};
  }

  private grid(node: Extract<Node, {t: 'grid'}>): Box {
    const cells = node.rows.map(row => row.map(cell => this.node(cell)));
    const columns = Math.max(...cells.map(row => row.length));
    const widths = Array.from({length: columns}, (_, column) => Math.max(...cells.map(row => row[column]?.width ?? 0)));
    const gap = 2;
    const rowBoxes = cells.map(row => hcat(Array.from({length: columns}, (_, column) => {
      const cell = row[column] ?? EMPTY;
      const room = widths[column]! - cell.width;
      const aligned: Box = node.cases ? {...cell, rows: cell.rows.map(line => pad(line, widths[column]!)), width: widths[column]!} : {...cell, rows: cell.rows.map(line => ' '.repeat(Math.floor(room / 2)) + line + ' '.repeat(room - Math.floor(room / 2))), width: widths[column]!};
      return column === columns - 1 ? aligned : hcat([aligned, text(' '.repeat(gap))]);
    })));
    const rows: string[] = [];
    let width = 0;
    for (const box of rowBoxes) { width = Math.max(width, box.width); }
    rowBoxes.forEach(box => box.rows.forEach(line => rows.push(pad(line, width))));
    const baseline = Math.floor((rows.length - 1) / 2);
    const body: Box = {rows, width, baseline};
    return hcat([this.stretch(node.left, rows.length, baseline, true), body, this.stretch(node.right, rows.length, baseline, false)]);
  }
}

/** Render `source` (the inside of `$…$` or `$$…$$`) or say why it cannot be. */
export function renderMath(source: string, options: {display: boolean; ascii?: boolean}): MathResult {
  const trimmed = source.trim();
  if (!trimmed) return {ok: false, reason: 'the formula is empty'};
  if (trimmed.length > MATH_LIMITS.source) return {ok: false, reason: `the formula is longer than ${MATH_LIMITS.source} characters`};
  try {
    const tree = new Parser(tokenize(trimmed)).parse();
    const box = new Layout({display: options.display, ascii: options.ascii ?? false}).node(tree);
    if (!options.display && box.rows.length > 1) return {ok: false, reason: 'it needs more than one row; use $$…$$'};
    if (box.rows.length > MATH_LIMITS.rows || box.width > MATH_LIMITS.width) return {ok: false, reason: 'the formula is too large to draw'};
    const rows = box.rows.map(row => pad(row, box.width));
    return {ok: true, rows, baseline: box.baseline, width: box.width};
  } catch (error) {
    if (error instanceof Unsupported) return {ok: false, reason: error.message};
    return {ok: false, reason: 'the formula could not be drawn'};
  }
}
