import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('vendored files match SHA256SUMS', () => {
  const sums = readFileSync('vendor/pikchr/SHA256SUMS', 'utf8').trim().split('\n');
  assert.deepEqual(sums.map((line) => line.split(/\s+/)[1]).sort(), ['pikchr.c', 'pikchr.cjs', 'provenance.json']);
  for (const line of sums) {
    const [expected, name] = line.split(/\s+/) as [string, string];
    const actual = createHash('sha256').update(readFileSync(`vendor/pikchr/${name}`)).digest('hex');
    assert.equal(actual, expected, name);
  }
});

test('the vendored engine is pikchr.org trunk a7f1c35bc0, built with emcc 6.0.9', async () => {
  const provenance = JSON.parse(readFileSync('vendor/pikchr/provenance.json', 'utf8'));
  assert.equal(provenance.checkin, 'a7f1c35bc0448daf15e2bafa36e510c1517534e6');
  assert.equal(provenance.compiler, 'emcc 6.0.9');
  const engine = await require('../vendor/pikchr/pikchr.cjs')();
  assert.equal(engine.ccall('pikchr_version', 'string', [], []), '1.0 20260403102956');
  assert.match(readFileSync('vendor/pikchr/pikchr.c', 'utf8'), /MANIFEST_ISODATE "20260403102956"/);
});
