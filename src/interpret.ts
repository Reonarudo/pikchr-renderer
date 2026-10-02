import type { RenderResult } from './runtime.js';
import { sanitizeSvg } from './sanitizer.js';

/**
 * Turn what pikchr returned for one source into a render result. `width` is pikchr's `pnWidth`:
 * positive for a diagram, 0 for nothing to draw, -1 for an error.
 */
export function interpret(text: string, width: number, source: string, outputBytes: number): RenderResult {
  if (width < 0) return failure(text, source.split('\n'));
  const start = text.indexOf('<svg');
  if (width === 0 || start < 0) return { status: 'failure', message: 'empty pikchr diagram' };
  let output: string;
  try {
    output = sanitizeSvg(text.slice(start));
  } catch (error) {
    return { status: 'failure', message: (error as Error).message };
  }
  if (Buffer.byteLength(output, 'utf8') > outputBytes) {
    return { status: 'failure', message: `pikchr output exceeds the ${outputBytes}-byte limit` };
  }
  return { status: 'success', output, notes: notes(text.slice(0, start)) };
}

/** `print` writes HTML-escaped lines ending in `<br>` before the diagram. */
function notes(printed: string): string[] {
  return printed.split('<br>\n').filter((line) => line !== '').map(decode);
}

/**
 * Undo pikchr's escaping. Named entities other than XML's own were left alone by pikchr, so they
 * were in the source as written and stay as written.
 */
function decode(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return codePoint(parseInt(lower.slice(2), 16), entity);
    if (lower.startsWith('#')) return codePoint(parseInt(lower.slice(1), 10), entity);
    return ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[lower]!;
  });
}

function codePoint(value: number, entity: string): string {
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
}

/** `/*   12 *\/  ` — the line-number gutter pikchr writes before each excerpt line. */
const marker = /^\/\*\s*(\d+) \*\/ {2}/;
const caret = /^ *\^+$/;
/** pikchr indents the caret by the gutter width it assumes, whatever the line number's width. */
const gutter = 12;

/** Where one excerpt points: the last numbered line before the caret, and the caret under it. */
interface Location { line: number; column: number }

/**
 * pikchr places the caret by byte offset, and on the first line of the source one byte early
 * (its backwards scan stops at offset 0 without counting it). The column is recomputed from the
 * source line itself, in characters as JavaScript counts them, 1-based.
 */
function locate(excerpt: string[], source: string[]): Location | undefined {
  const caretAt = excerpt.findIndex((l) => caret.test(l));
  if (caretAt < 1) return undefined;
  const numbered = marker.exec(excerpt[caretAt - 1]!);
  if (!numbered) return undefined;
  const line = Number(numbered[1]);
  const text = source[line - 1];
  if (text === undefined) return undefined;
  const offset = excerpt[caretAt]!.indexOf('^') - gutter + (line === 1 ? 1 : 0);
  const bytes = Buffer.from(text, 'utf8');
  if (offset < 0 || offset > bytes.length) return undefined;
  return { line, column: bytes.subarray(0, offset).toString('utf8').length + 1 };
}

/**
 * Read pikchr's plain-text error report:
 *
 *     /*    2 *\/  line from nowhere
 *                            ^^^^^^^
 *     ERROR: no such variable
 *     Called from:
 *     /*    5 *\/    inner
 *                    ^^^^^
 *
 * Only the error text and the call sites become the message; the excerpt is dropped. A report
 * in any other shape keeps its error text and gets no location, never a guessed one.
 */
function failure(text: string, source: string[]): RenderResult {
  const lines = text.replace(/\n$/, '').split('\n');
  const errorAt = lines.findIndex((l) => l.startsWith('ERROR: '));
  if (errorAt < 0) return { status: 'failure', message: 'pikchr reported an error it did not describe' };

  let message = lines[errorAt]!.slice('ERROR: '.length).trim();
  const blocks = lines.slice(errorAt + 1).join('\n').split(/^Called from:\n/m).slice(1);
  for (const block of blocks) {
    const call = locate(block.split('\n'), source);
    if (call) message += ` (called from line ${call.line})`;
  }

  const at = locate(lines.slice(0, errorAt), source);
  return at
    ? { status: 'failure', message, line: at.line, column: at.column }
    : { status: 'failure', message };
}
