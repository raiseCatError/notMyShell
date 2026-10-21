import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMath, MATH_LIMITS} from '../src/markdown/math.js';
import {parseBlocks} from '../src/markdown/blocks.js';
import {headingsOf} from '../src/markdown/sourceMap.js';
import {renderMarkdown} from '../src/markdown/render.js';
import {displayWidth} from '../src/util/text.js';

const inline = (source: string) => { const result = renderMath(source, {display: false}); return result.ok ? result.rows.join('\n') : `FAIL: ${result.reason}`; };
const display = (source: string, ascii = false) => { const result = renderMath(source, {display: true, ascii}); return result.ok ? result.rows.map(row => row.replace(/\s+$/u, '')).join('\n') : `FAIL: ${result.reason}`; };

test('inline: symbols, Greek letters, operators and spacing', () => {
  assert.equal(inline('\\alpha + \\beta = \\gamma'), 'α + β = γ');
  assert.equal(inline('x \\leq y \\neq z \\approx w'), 'x ≤ y ≠ z ≈ w');
  assert.equal(inline('a \\times b \\cdot c \\pm d'), 'a × b · c ± d');
  assert.equal(inline('-x + 1'), '−x + 1', 'a leading minus is unary: no space after it');
  assert.equal(inline('f(x, y)'), 'f(x, y)');
  assert.equal(inline('\\forall x \\in \\mathbb{R}, \\exists y'), '∀ x ∈ ℝ, ∃ y');
  assert.equal(inline('\\infty \\partial \\nabla \\emptyset'), '∞∂∇∅');
  assert.equal(inline('A \\to B \\Rightarrow C'), 'A → B ⇒ C');
});

test('inline: scripts use real Unicode super/subscripts only when every character has one; otherwise an unambiguous bracketed form', () => {
  assert.equal(inline('x^2 + y_1'), 'x² + y₁');
  assert.equal(inline('e^{i\\pi}'), 'e^(iπ)', 'π has no superscript form: the exponent is bracketed, never guessed');
  assert.equal(inline('x_{n+1}^{2}'), 'xₙ₊₁²');
  assert.equal(inline('a_{ij}'), 'aᵢⱼ');
  assert.equal(inline('2^{10}'), '2¹⁰');
  assert.equal(inline('x^{\\alpha}'), 'x^(α)');
});

test('inline: fractions, roots and operators stay one row and are unambiguous', () => {
  assert.equal(inline('\\frac{1}{2}'), '1/2');
  assert.equal(inline('\\frac{a+b}{c}'), '(a + b)/c');
  assert.equal(inline('\\sqrt{x}'), '√x');
  assert.equal(inline('\\sqrt{x+1}'), '√(x + 1)');
  assert.equal(inline('\\sqrt[3]{x}'), '∛x');
  assert.equal(inline('\\sqrt[5]{x}'), '⁵√x');
  assert.equal(inline('\\sin x + \\log_2 n'), 'sin x + log₂ n');
  assert.equal(inline('\\sum_{i=1}^{n} i'), '∑ᵢ₌₁ⁿ i');
  assert.equal(inline('\\binom{n}{k}'), '(n choose k)');
  assert.equal(inline('\\text{if } x'), 'if x');
  assert.equal(inline('\\mathbf{v} \\cdot \\vec{w}'), '𝐯 · w⃗');
});

test('display: a stacked fraction is centred over its bar; the baseline is the bar', () => {
  assert.equal(display('\\frac{a+b}{c}'), [' a + b', '───────', '   c'].join('\n'));
  assert.equal(display('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}').split('\n').length >= 3, true);
  const rows = display('y = \\frac{1}{2}').split('\n');
  assert.equal(rows.length, 3);
  assert.match(rows[1]!, /^y = ─+$/u, 'the equals sign sits on the bar row');
});

test('display: scripts that cannot be Unicode are placed in two dimensions', () => {
  const rows = display('x^{\\frac{1}{2}}').split('\n');
  assert.ok(rows.length >= 4, rows.join('|'));
  assert.ok(rows.some(row => /─/u.test(row)));
  assert.match(display('a_{\\frac{1}{2}}'), /a/u);
});

test('display: big operators carry their limits above and below; an integral has its limits at the side', () => {
  const sum = display('\\sum_{i=1}^{n} i^2').split('\n');
  assert.equal(sum.length, 3);
  assert.match(sum[0]!, /n/u); assert.match(sum[1]!, /∑\s+i²/u); assert.match(sum[2]!, /i = 1/u);
  const integral = display('\\int_0^1 x \\, dx');
  assert.match(integral, /∫/u); assert.match(integral, /dx/u);
});

test('display: roots, stretched delimiters and matrices', () => {
  const root = display('\\sqrt{\\frac{a}{b}}').split('\n');
  assert.ok(root.length >= 4);
  assert.ok(root.some(row => row.includes('√')));
  const paren = display('\\left( \\frac{a}{b} \\right)').split('\n');
  assert.equal(paren.length, 3);
  assert.ok(paren[0]!.startsWith('⎛') && paren[1]!.startsWith('⎜') && paren[2]!.startsWith('⎝'));
  const matrix = display('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}').split('\n');
  assert.equal(matrix.length, 2);
  assert.ok(matrix[0]!.includes('a') && matrix[0]!.includes('b') && matrix[1]!.includes('c') && matrix[1]!.includes('d'));
  assert.ok(matrix[0]!.startsWith('⎛') && matrix[1]!.startsWith('⎝'));
  const cases = display('f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & x \\leq 0 \\end{cases}');
  assert.match(cases, /⎧|⎨|⎩/u);
});

test('ASCII mode (Safe Glyphs) draws bars and brackets with plain characters and keeps the letters', () => {
  const rows = display('\\left( \\frac{a}{b} \\right)', true).split('\n');
  assert.ok(rows.every(row => !/[─⎛⎜⎝⎞⎟⎠]/u.test(row)), rows.join('|'));
  assert.match(rows.join('\n'), /-/u);
});

test('what is not in the subset fails with a reason and never draws something else', () => {
  for (const source of ['\\unknowncommand x', '\\begin{align} a &= b \\end{align}', '\\frac{1}', 'x^', '{', '}', '\\left( x', '\\href{http://x}{y}', '\\input{file}', '\\write18{ls}', '\\def\\x{1}', '\\verb|x|', '\\begin{pmatrix} a & b \\\\ c \\end{matrix}']) {
    const result = renderMath(source, {display: true});
    assert.equal(result.ok, false, source);
    assert.match((result as {reason: string}).reason, /\S/u);
  }
  assert.equal(renderMath('x^2^3', {display: true}).ok, false, 'a double superscript is an error in TeX too');
  assert.equal(renderMath('', {display: true}).ok, false);
});

test('inline refuses what needs more than one row, with the reason', () => {
  const result = renderMath('x^{\\frac{1}{2}} + \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix}', {display: false});
  assert.equal(result.ok, false);
});

test('limits are deterministic: oversize or deeply nested input is refused quickly', () => {
  assert.equal(renderMath('x'.repeat(MATH_LIMITS.source + 1), {display: true}).ok, false);
  assert.equal(renderMath('{'.repeat(200) + 'x' + '}'.repeat(200), {display: true}).ok, false, 'depth');
  assert.equal(renderMath(Array.from({length: 2000}, () => '\\frac{1}{2}').join('+'), {display: true}).ok, false, 'node count');
  const tall = Array.from({length: 60}, () => '\\frac{1}{').join('') + '2' + '}'.repeat(60);
  assert.equal(renderMath(tall, {display: true}).ok, false, 'height or depth');
  const started = process.hrtime.bigint();
  for (let index = 0; index < 200; index += 1) renderMath('\\sum_{i=1}^{n} \\frac{a_i}{b_i}', {display: true});
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 2);
});

test('every row of every supported construct has a measured width equal to its box and uses only terminal-safe text', () => {
  for (const source of ['\\frac{a}{b}', '\\sqrt{x+1}', '\\sum_{i=1}^n i', '\\left[ \\frac{a}{b} \\right]', '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}', '日本語 + \\alpha', '\\text{😀 ok}']) {
    const result = renderMath(source, {display: true});
    assert.equal(result.ok, true, source);
    if (!result.ok) continue;
    assert.ok(result.rows.every(row => displayWidth(row) === result.width), `${source}: ${JSON.stringify(result.rows)}`);
    assert.ok(result.rows.every(row => !/[\u0000-\u001f\u007f-\u009f]/u.test(row)));
  }
});

// ---- Markdown ---------------------------------------------------------------------------------------------------

const rowsOf = (source: string, columns = 60) => renderMarkdown(source, columns, {level: 'none', math: true, html: true} as never).map(row => row.plain);

test('display math blocks: $$ on one line, $$ on its own lines, and a math fence all become a block with an exact source span', () => {
  const blocks = parseBlocks(['Text', '', '$$ \\frac{a}{b} $$', '', '$$', 'x^2 +', 'y', '$$', '', '```math', '\\alpha', '```'].join('\n'), {math: true});
  assert.deepEqual(blocks.map(block => block.kind), ['paragraph', 'math', 'math', 'code']);
  assert.deepEqual([blocks[1]!.from, blocks[1]!.to, blocks[2]!.from, blocks[2]!.to], [2, 3, 4, 8]);
  const without = parseBlocks('$$ x $$', {});
  assert.equal(without[0]!.kind, 'paragraph', 'without the math option nothing changes (agent replies, GitHub bodies)');
  const rendered = rowsOf(['$$ \\frac{a}{b} $$', '', '```math', '\\alpha + \\beta', '```'].join('\n')).join('\n');
  assert.match(rendered, /─/u); assert.match(rendered, /α \+ β/u);
});

test('inline $…$ follows the GitHub rules: no space inside, not before a digit, escapes, code spans; failures stay as written', () => {
  const text = (source: string) => rowsOf(source, 80).join(' ');
  assert.match(text('Euler: $e^{i\\pi} = -1$ is nice.'), /e\^\(iπ\) = −1 is nice\./u);
  assert.match(text('Costs $5 and $6 today.'), /Costs \$5 and \$6 today\./u, 'prices are not math');
  assert.match(text('A \\$ sign and $x^2$.'), /A \$ sign and x²\./u);
  assert.match(text('Code `$x^2$` stays code.'), /Code `\$x\^2\$` stays code\./u);
  assert.match(text('Unsupported $\\unknown{x}$ stays.'), /Unsupported \$\\unknown\{x\}\$ stays\./u, 'unsupported inline math is shown as written');
  assert.match(text('Spaces $ x $ stay.'), /\$ x \$/u);
});

test('an unsupported display block shows its source and why, in readable form; a block too wide for the terminal does too', () => {
  const bad = rowsOf('$$\n\\begin{align} a &= b \\end{align}\n$$').join('\n');
  assert.match(bad, /align/u); assert.match(bad, /not rendered/iu);
  const wide = rowsOf('$$' + Array.from({length: 40}, (_, index) => `x_{${index}}`).join(' + ') + '$$', 30).join('\n');
  assert.match(wide, /not rendered/iu);
  for (const width of [10, 30, 80]) for (const row of renderMarkdown('$$\\frac{a}{b}$$\n\n$x^2$', width, {level: 'none', math: true} as never)) assert.ok(displayWidth(row.plain) <= width, `${width}: ${row.plain}`);
});

test('command names are never looked up on Object.prototype', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    for (const display of [false, true]) {
      const result = renderMath(`\\${name} x`, {display});
      assert.equal(result.ok, false, name);
    }
    assert.equal(renderMath(`\\begin{${name}} a \\end{${name}}`, {display: true}).ok, false, name);
    assert.equal(renderMath(`\\left${name} x \\right.`, {display: true}).ok, false, name);
  }
});

// ---- Findings of the independent review ----------------------------------------------------------------------------

test('review: unbraced nesting is refused fast and every intermediate box is bounded', () => {
  for (const source of ['\\sqrt'.repeat(780) + ' x', '\\frac1'.repeat(390) + '1']) {
    const started = process.hrtime.bigint();
    const result = renderMath(source, {display: true});
    assert.equal(result.ok, false);
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 200);
  }
});

test('review: inline fractions and roots are bracketed against their neighbours, scripts and denominators', () => {
  assert.equal(inline('2\\frac{1}{2}'), '2(1/2)');
  assert.equal(inline('\\frac{a}{b}\\frac{c}{d}'), '(a/b)(c/d)');
  assert.equal(inline('\\frac{1}{2}x'), '(1/2)x');
  assert.equal(inline('x = \\frac{1}{2}'), 'x = 1/2');
  assert.equal(inline('\\frac{a}{\\frac{b}{c}}'), 'a/(b/c)');
  assert.equal(inline('\\frac{a}{b}^2'), '(a/b)²');
  assert.equal(inline('\\sqrt{x}^2'), '(√x)²');
  assert.equal(inline('\\sqrt{2}3'), '(√2)3');
});

test('review: two-dimensional scripts keep their columns for wide and astral bases', () => {
  for (const source of ['\\left(\\frac{\\mathbf{ab}}{c}\\right)^{\\alpha}', '\\frac{中中}{b}^{\\alpha}', '\\{a_{\\mathbf{b}}\\}_{c}', '\\begin{pmatrix}\\mathbf{A}&b\\\\c&d\\\\e&f\\end{pmatrix}^{\\alpha}_{\\beta}']) {
    const result = renderMath(source, {display: true});
    assert.equal(result.ok, true, source);
    if (!result.ok) continue;
    assert.ok(result.rows.every(row => displayWidth(row) === result.width), `${source}: ${JSON.stringify(result.rows)}`);
    assert.ok(result.rows.every(row => !/[\ud800-\udfff]/u.test(row.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))), source);
  }
  const rows = (renderMath('\\left(\\frac{a}{b}\\right)^{n}', {display: true}) as {rows: string[]}).rows;
  assert.ok(rows.some(row => row.endsWith('⎟ⁿ')), JSON.stringify(rows));
});

test('review: \\limits is accepted, functions are spaced from what precedes them, and empty arguments are refused', () => {
  assert.match((renderMath('\\sum\\limits_{i=1}^{n} i', {display: true}) as {rows: string[]}).rows.join('\n'), /i = 1/u);
  assert.equal(inline('a\\sin x'), 'a sin x');
  assert.equal(inline('a \\mod b'), 'a mod b');
  assert.equal(inline('\\operatorname{sgn}x'), 'sgn x');
  assert.equal(inline('\\sin -x'), 'sin −x');
  assert.equal(renderMath('\\sqrt{}', {display: false}).ok, false);
  assert.equal(renderMath('\\frac{}{}', {display: false}).ok, false);
  assert.equal(renderMath('\\text{a\u001b[31mb}', {display: false}).ok, false);
});

test('review: fallback shows the source exactly, $$ pairs on one line are separate inline formulas, $$ interrupts a paragraph', () => {
  const rows = rowsOf('$$x^{\\foo}$$');
  assert.equal(rows[0]!.trim(), '$$x^{\\foo}$$');
  assert.match(rows.join('\n'), /not rendered: /u);
  const indented = rowsOf('$$\n  a + \\foo\n$$');
  assert.ok(indented.some(row => row.startsWith('    a + \\foo')), JSON.stringify(indented));
  const fenced = rowsOf('```math\nx^{\\foo}\n```');
  assert.ok(fenced.join('\n').includes('x^{\\foo}') && /not rendered/u.test(fenced.join('\n')));
  assert.ok(!rowsOf('$$x$$ and $$y$$').join('').includes('x$$ and $$y'));
  const paragraph = rowsOf('Text\n$$\nx^2\n$$');
  assert.ok(!paragraph.join('\n').includes('$$'), JSON.stringify(paragraph));
  assert.ok(rowsOf('$$a$$ and text\nthen x$$').join('\n').includes('and text'));
});

test('review: a code span binds tighter than a formula, and the outline ignores headings inside math', () => {
  assert.ok(rowsOf('$a `b$` c').join('').includes('`b$`'));
  assert.deepEqual(headingsOf('$$\n# Not a heading\n$$\n\n# Real'), headingsOf('$$\n# Not a heading\n$$\n\n# Real').filter(heading => heading.text === 'Real'));
});
