import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg } from '../src/sanitizer.js';

const open = `<svg xmlns='http://www.w3.org/2000/svg' style='font-size:initial;' viewBox="0 0 100 50" data-pikchr-date="20260403102956">`;
const svg = (body: string, root = open): string => `${root}\n${body}\n</svg>\n`;

/** Sanitize, treating a refusal as an outcome whose message is checked like any output. */
function sanitizedOrRefused(input: string): string {
  try { return sanitizeSvg(input); } catch (error) { return (error as Error).message; }
}

test('real pikchr output keeps its shapes, colours, dashes, fonts and rotated text', () => {
  const body = [
    '<path d="M2.16,74.16L110.16,74.16Z"  style="fill:none;stroke-width:2.16;stroke:rgb(0,0,0);stroke-dasharray:7.2,7.2;" />',
    '<polygon points="10,2 20,8 10,14" style="fill:rgb(0,0,255);stroke-linejoin:round;" />',
    '<circle cx="38.16" cy="56.16" r="36"  style="fill:rgb(255,0,0);stroke-width:2.16;stroke:rgb(0,0,0);" />',
    '<ellipse cx="5" cy="6" rx="7" ry="8"  style="fill:none;stroke-width:3.24;stroke:rgb(0,0,0);" />',
    '<text x="1" y="2" text-anchor="middle" font-weight="bold" font-style="italic" font-size="115%" font-family="monospace" fill="rgb(0,0,0)" dominant-baseline="central">A &amp; B &lt;x&gt;</text>',
    '<text x="1" y="2" transform="rotate(-45 240.509,218.16)" fill="rgb(0,0,0)">tilted</text>'
  ].join('\n');
  assert.equal(sanitizeSvg(svg(body)), [
    '<svg xmlns="http://www.w3.org/2000/svg" style="font-size:initial;" viewBox="0 0 100 50" class="pikchr">',
    '<path d="M2.16,74.16L110.16,74.16Z" style="fill:none;stroke-width:2.16;stroke:rgb(0,0,0);stroke-dasharray:7.2,7.2;"/>',
    '<polygon points="10,2 20,8 10,14" style="fill:rgb(0,0,255);stroke-linejoin:round;"/>',
    '<circle cx="38.16" cy="56.16" r="36" style="fill:rgb(255,0,0);stroke-width:2.16;stroke:rgb(0,0,0);"/>',
    '<ellipse cx="5" cy="6" rx="7" ry="8" style="fill:none;stroke-width:3.24;stroke:rgb(0,0,0);"/>',
    '<text x="1" y="2" text-anchor="middle" font-weight="bold" font-style="italic" font-size="115%" font-family="monospace" fill="rgb(0,0,0)" dominant-baseline="central">A &amp; B &lt;x&gt;</text>',
    '<text x="1" y="2" transform="rotate(-45 240.509,218.16)" fill="rgb(0,0,0)">tilted</text>',
    '</svg>'
  ].join('\n'));
});

test('elements outside the allowlist are removed with their content', () => {
  const output = sanitizeSvg(svg([
    '<script>alert(1)</script>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
    '<image href="https://evil.example/x.png"/>',
    '<a href="javascript:alert(1)"><text>click</text></a>',
    '<style>svg { background: url(https://evil.example/t) }</style>',
    '<use href="#x"/><g><circle r="1"/></g><animate attributeName="href" to="javascript:alert(1)"/>',
    '<html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>',
    '<circle r="2"/>'
  ].join('')));
  assert.doesNotMatch(output, /script|foreignObject|image|<a|click|style>|<use|<g|animate|evil|alert/);
  assert.match(output, /<circle r="2"\/>/);
});

test('event handlers, links, foreign URLs and unknown attributes are dropped', () => {
  const output = sanitizeSvg(svg([
    '<circle r="1" onload="alert(1)" onclick="alert(1)" href="#x" xlink:href="#y" xmlns:xlink="http://www.w3.org/1999/xlink"/>',
    '<path d="M0,0" fill="url(https://evil.example/t)" filter="url(#f)" clip-path="url(#c)" id="x" class="y"/>',
    '<text x="javascript:alert(1)" y="data:text/html,1" font-family="//evil.example" fill="red">t</text>',
    '<polygon points="0,0" fill="u\\72l(https://evil.example)"/>'
  ].join('')));
  assert.doesNotMatch(output, /on\w+=|href|url\(|javascript|data:|evil|filter|clip-path|id=|class="y"/);
  assert.match(output, /<circle r="1"\/>/);
  assert.match(output, /<text fill="red">t<\/text>/);
});

test('style keeps only allowed declarations with plain values', () => {
  const output = sanitizeSvg(svg([
    '<path d="M0,0" style="fill:rgb(1,2,3);stroke:url(https://evil.example/t);background:red;stroke-width:2;"/>',
    '<path d="M1,1" style="fill:expression(alert(1));stroke:none;font-size:initial;"/>',
    '<path d="M2,2" style="fill:rgb(1,2,3) !important;stroke-width:2px;stroke-dasharray:1,2 ; stroke-linejoin:round"/>',
    '<path d="M3,3" style="fill:\\72gb(1,2,3);stroke:/* x */none;"/>'
  ].join('')));
  assert.match(output, /<path d="M0,0" style="fill:rgb\(1,2,3\);stroke-width:2;"\/>/);
  assert.match(output, /<path d="M1,1" style="stroke:none;font-size:initial;"\/>/);
  assert.match(output, /<path d="M2,2" style="stroke-width:2px;stroke-dasharray:1,2;stroke-linejoin:round;"\/>/);
  assert.match(output, /<path d="M3,3"\/>/);
  assert.doesNotMatch(output, /evil|background|expression|important|\\/);
});

test('transform survives only as a rotation', () => {
  const output = sanitizeSvg(svg([
    '<text transform="rotate(90)">a</text>',
    '<text transform="rotate(-45 240.509,218.16)">b</text>',
    '<text transform="translate(9999,0)">c</text>',
    '<text transform="rotate(1) scale(100)">d</text>',
    '<text transform="matrix(1 0 0 1 0 0)">e</text>'
  ].join('')));
  assert.match(output, /<text transform="rotate\(90\)">a<\/text>/);
  assert.match(output, /<text transform="rotate\(-45 240\.509,218\.16\)">b<\/text>/);
  for (const letter of 'cde') assert.match(output, new RegExp(`<text>${letter}</text>`));
});

test('the root loses its size and date and carries exactly the class pikchr', () => {
  const output = sanitizeSvg(svg('<circle r="1"/>',
    `<svg xmlns='http://www.w3.org/2000/svg' width="100" height="50" class="x&quot; onload=&quot;alert(1)" onload="alert(1)" viewBox="0 0 100 50" data-pikchr-date="1">`));
  assert.match(output, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 50" class="pikchr">/);
});

test('comments and processing instructions are removed; text is kept escaped', () => {
  const output = sanitizeSvg(svg('<!-- debug --><?pi x?><text>&lt;script&gt;alert(1)&lt;/script&gt;</text>'));
  assert.doesNotMatch(output, /<!--|<\?|<script/);
  assert.match(output, /<text>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/text>/);
});

test('anything that is not a well-formed SVG document is refused with a plain message', () => {
  for (const input of [
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">&x;</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle></svg>',
    '<html xmlns="http://www.w3.org/1999/xhtml"></html>',
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ''
  ]) {
    const message = sanitizedOrRefused(input);
    assert.match(message, /^pikchr produced SVG that could not be sanitized$/, input);
  }
});
