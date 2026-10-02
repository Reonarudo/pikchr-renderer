import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../dist/index.js';

const runtime = await createRuntime();
after(() => runtime.dispose());

test('a box renders to inline-ready SVG with the renderer name as its only class', () => {
  const result = runtime.render({ source: 'box "hi"' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.match(result.output, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" style="font-size:initial;" viewBox="0 0 112\.32 76\.32" class="pikchr">/);
  assert.match(result.output, /<\/svg>$/);
  assert.match(result.output, />hi<\/text>/);
  assert.doesNotMatch(result.output, /<\?xml|<!--|data-pikchr-date|\swidth=|\sheight=/);
  assert.deepEqual(result.notes, []);
});

test('an error is plain text with the 1-based line and column of the offending token', () => {
  assert.deepEqual(runtime.render({ source: 'box\nline from nowhere' }), {
    status: 'failure', message: 'no such variable', line: 2, column: 11
  });
});

test('an error inside a macro points into its body and names every call site', () => {
  const source = 'define inner {\n  box radius foo\n}\ndefine outer {\n  inner\n}\nbox\nouter\n';
  assert.deepEqual(runtime.render({ source }), {
    status: 'failure', message: 'no such variable (called from line 5) (called from line 8)', line: 2, column: 14
  });
  assert.deepEqual(runtime.render({ source: 'define m {\n  box $1\n}\nm(\n' }), {
    status: 'failure', message: 'unterminated macro argument list (called from line 4)', line: 4, column: 2
  });
});

test('columns count characters, not bytes, on the first line as on any other', () => {
  // pikchr's caret is a byte offset, and one byte early on the first line of the source.
  assert.deepEqual(runtime.render({ source: 'box radius foo' }), {
    status: 'failure', message: 'no such variable', line: 1, column: 12
  });
  assert.deepEqual(runtime.render({ source: 'box "é€"; line from nowhere' }), {
    status: 'failure', message: 'no such variable', line: 1, column: 21
  });
  assert.deepEqual(runtime.render({ source: 'box\nbox "é€"; line from nowhere' }), {
    status: 'failure', message: 'no such variable', line: 2, column: 21
  });
  assert.deepEqual(runtime.render({ source: 'box\tfoo' }), {
    status: 'failure', message: 'no such variable', line: 1, column: 5
  });
});

test('print output becomes plain-text notes and stays out of the SVG', () => {
  const result = runtime.render({ source: 'print "hi <b> & co"; print 1+2\nbox' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(result.notes, ['hi <b> & co', '3']);
  assert.match(result.output, /^<svg /);
});

test('a fence that draws nothing is a failure', () => {
  for (const source of ['', '   \n', 'print "only"']) {
    assert.deepEqual(runtime.render({ source }), { status: 'failure', message: 'empty pikchr diagram' }, JSON.stringify(source));
  }
});

test('a source over the character limit is a failure naming the limit; one at the limit renders', () => {
  const atLimit = 'box' + ' '.repeat(64000 - 3);
  assert.equal(runtime.render({ source: atLimit }).status, 'success');
  assert.deepEqual(runtime.render({ source: atLimit + ' ' }), {
    status: 'failure', message: 'pikchr source exceeds the 64000-character limit'
  });
});

test('limits are runtime options', async () => {
  const small = await createRuntime({ limits: { sourceChars: 10, outputBytes: 300 } });
  try {
    assert.equal(small.render({ source: 'box' }).status, 'success');
    assert.deepEqual(small.render({ source: 'box "eleven"' }), {
      status: 'failure', message: 'pikchr source exceeds the 10-character limit'
    });
    assert.deepEqual(small.render({ source: 'box; box' }), {
      status: 'failure', message: 'pikchr output exceeds the 300-byte limit'
    });
  } finally {
    await small.dispose();
  }
});

test('the default output limit is 4 MiB', () => {
  // 1000 boxes of 4500 characters each draw about 4.6 MB of text.
  const source = `define b {box "${'x'.repeat(4500)}"}\n` + 'b\n'.repeat(1000);
  assert.deepEqual(runtime.render({ source }), {
    status: 'failure', message: 'pikchr output exceeds the 4194304-byte limit'
  });
});

/** Nine levels of ten calls to an empty macro: 10^9 expansions that the token limit never sees. */
function runaway(): string {
  let source = 'define m0 {}\n';
  for (let level = 1; level <= 9; level++) source += `define m${level} {${Array(10).fill(`m${level - 1}`).join(' ')}}\n`;
  return source + 'm9\n';
}

test('a runaway fence times out within its budget, and the next render on the runtime succeeds', async () => {
  // Starting a worker takes about 50 ms, longer than this budget: the render after the timeout
  // succeeds only if the replacement's start is not charged to it.
  const quick = await createRuntime({ timeout: 30 });
  try {
    const started = performance.now();
    assert.deepEqual(quick.render({ source: runaway() }), { status: 'timeout', budget: 30 });
    assert.ok(performance.now() - started < 1000);
    assert.equal(quick.render({ source: 'box' }).status, 'success');
    assert.equal(quick.render({ source: 'circle' }).status, 'success');
  } finally {
    await quick.dispose();
  }
});

test('a fence that exhausts the engine heap is a failure, and the next render succeeds', () => {
  let source = `define m0 {box "${'x'.repeat(2000)}"}\n`;
  for (let level = 1; level <= 4; level++) source += `define m${level} {${Array(10).fill(`m${level - 1}`).join('\n')}}\n`;
  assert.deepEqual(runtime.render({ source: source + 'm4\n' }), { status: 'failure', message: 'pikchr ran out of memory' });
  assert.equal(runtime.render({ source: 'box' }).status, 'success');
});

test('an engine that does not start in time makes that render unavailable, not the runtime', async () => {
  const slow = await createRuntime({ startupTimeout: 1 });
  try {
    assert.deepEqual(slow.render({ source: 'box' }), { status: 'unavailable', reason: 'pikchr did not start within 1 ms' });
  } finally {
    await slow.dispose();
  }
});

test('invalid runtime options reject createRuntime', async () => {
  for (const options of [
    { timeout: 0 }, { timeout: -1 }, { timeout: Number.NaN }, { timeout: Infinity }, { startupTimeout: 0 },
    { limits: { sourceChars: 0 } }, { limits: { outputBytes: -5 } }, { limits: { sourceChars: Infinity } },
    { timeout: '100' }, { limits: null }
  ]) {
    await assert.rejects(createRuntime(options as never), TypeError, JSON.stringify(options));
  }
});

test('render throws only for programmer errors: malformed input or a disposed runtime', async () => {
  for (const input of [undefined, null, 'box', {}, { source: 42 }]) {
    assert.throws(() => runtime.render(input as never), TypeError, JSON.stringify(input));
  }
  const disposable = await createRuntime();
  await disposable.dispose();
  await disposable.dispose();
  assert.throws(() => disposable.render({ source: 'box' }), /dispose/);
});

/** Every attribute value in the SVG except the namespace declaration. */
const attributeValues = (svg: string): string[] => [...svg.matchAll(/\s(?!xmlns=)[\w:-]+="([^"]*)"/g)].map((m) => m[1]!);

test('markup and links in labels stay inert text', () => {
  const source = [
    'box "<script>alert(1)</script>"',
    'box "<foreignObject><img src=x onerror=alert(1)></foreignObject>"',
    `box "x' onload='alert(1)" "\\" onload=\\"alert(1)"`,
    'box "<a href=\'javascript:alert(1)\'>j</a>" "data:text/html,1" "https://evil.example/t"',
    'text "&lt;script&gt;" "&#60;svg onload=alert(1)&#62;"'
  ].join('\n');
  const result = runtime.render({ source });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.doesNotMatch(result.output, /<(?!\/?(?:svg|path|text|circle|ellipse|polygon)[\s>/])/);
  assert.doesNotMatch(result.output, /<[^>]*\son\w+=/);
  for (const value of attributeValues(result.output)) assert.doesNotMatch(value, /javascript:|data:|https?:|url\(/);
  assert.match(result.output, />&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/text>/);
});

test('a class in the render input never reaches the SVG', () => {
  // pikchr copies its zClass argument into the root unescaped; the library always passes NULL.
  const input = { source: 'box', class: 'x" onload="alert(1)' };
  const result = runtime.render(input as never);
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.match(result.output, /^<svg [^>]*\sclass="pikchr">/);
  assert.doesNotMatch(result.output, /onload|class="x/);
});

test('a label with an ampersand and angle brackets round-trips as text', () => {
  const result = runtime.render({ source: 'box "A & B <x>"' });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  // pikchr writes the spaces of a label as no-break spaces.
  assert.match(result.output, />A\u00a0&amp;\u00a0B\u00a0&lt;x&gt;<\/text>/);
});

test('two diagrams on one page cannot address or restyle each other', () => {
  for (const source of ['box "a"; arrow; circle "b" fill red', 'ellipse; arrow dashed; diamond']) {
    const result = runtime.render({ source });
    assert.equal(result.status, 'success');
    if (result.status !== 'success') continue;
    // No ids, no references and no stylesheets: isolated by construction.
    assert.doesNotMatch(result.output, /\sid=|href=|url\(|<style/);
  }
});

test('the same input yields byte-identical output, also across runtimes', async () => {
  const source = 'box "one"; arrow; circle "two" fill lightblue; text "t" mono; print "note"';
  const other = await createRuntime();
  try {
    const first = runtime.render({ source });
    assert.equal(first.status, 'success');
    assert.deepEqual(runtime.render({ source }), first);
    assert.deepEqual(other.render({ source }), first);
  } finally {
    await other.dispose();
  }
});

test('messages and notes from malformed fences are plain text', () => {
  for (const source of ['box "<b>x</b>" <script>', 'line from <img src=x>', 'define m {\n  box <svg>\n}\nm\n', '"&lt;" &gt;']) {
    const result = runtime.render({ source });
    assert.equal(result.status, 'failure', source);
    if (result.status !== 'failure') continue;
    assert.doesNotMatch(result.message, /[<>]|&\w+;|\/Users|\/home|vendor/, source);
  }
});
