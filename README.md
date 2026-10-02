# pikchr-renderer

Render [Pikchr](https://pikchr.org) diagrams to safe, inline-ready SVG in Node, at build
time. One of five renderer libraries that share the
[render contract](http://192.168.188.68:3001/projects/markdown-renderers/wiki/Render_contract).

```sh
npm install github:Reonarudo/pikchr-renderer#v0.1.0
```

On npm 12 or later, a project installing git dependencies also needs `allow-git=root` in its
`.npmrc`. Nothing runs on install: `dist/` and the engine are committed.

## Use

```js
import { createRuntime } from '@reonarudo/pikchr-renderer';

const runtime = await createRuntime();
const result = runtime.render({ source: 'box "hello"; arrow; circle "world"' });
await runtime.dispose();
```

`render` is synchronous and returns one of:

| `status` | Fields | When |
| --- | --- | --- |
| `success` | `output`, `notes` | `output` is one `<svg class="pikchr" viewBox="…">` with no size, ready to inline; `notes` holds `print` output as plain text |
| `failure` | `message`, `line?`, `column?` | a pikchr error (plain text, 1-based fence-relative position), an empty diagram, an exceeded limit, or an out-of-memory abort |
| `timeout` | `budget` | the render ran past `timeout` milliseconds |
| `unavailable` | `reason` | the engine could not start |

It throws only for programmer errors: input other than `{ source: string }`, or a call after
`dispose()`. `createRuntime` rejects only for invalid options.

### Options

| Option | Default | |
| --- | --- | --- |
| `timeout` | `3000` | milliseconds per render |
| `startupTimeout` | `10000` | milliseconds per engine start, never charged to a render |
| `limits.sourceChars` | `64000` | fence body, in string length |
| `limits.outputBytes` | `4194304` | sanitized SVG, in UTF-8 bytes |

Each must be a finite positive number. Limits can be raised or lowered, never disabled.

### What the consumer does

Wrap the SVG (figure, caption, alt text, the author's class, alignment), escape `message`,
`notes` and `reason` when writing them into HTML, keep one runtime per build or preview and
dispose of it, and cache if wanted. pikchr output is black on transparent; any dark-mode
treatment is the consumer's.

## How the safety guarantees are met

Fence source is treated as untrusted.

- **Bounded time.** pikchr runs in a worker thread that `render` blocks on with
  `Atomics.wait`. A render past its budget terminates the worker. The next render starts a
  fresh one and waits for it under `startupTimeout` before its own budget begins. pikchr's
  100 000-token limit stays as defence in depth, but it is not the bound: nested calls to
  empty macros escape it.
- **Bounded memory.** The wasm heap is fixed at 16 MiB and cannot grow. The worker's
  JavaScript heap is capped at 128 MB. An out-of-memory abort is `failure` ("pikchr ran out
  of memory"), and that worker is discarded.
- **Bounded input and output.** `limits.sourceChars` is checked before the engine sees the
  source. `limits.outputBytes` is checked on the sanitized SVG.
- **Safe to inline.** Every SVG is parsed as XML and rebuilt from an allowlist: the elements
  `svg path circle ellipse polygon text`, the geometry, text and fill attributes pikchr
  emits, `transform` only as a rotation, and `style` only as `fill`, `stroke`,
  `stroke-width`, `stroke-linejoin`, `stroke-dasharray` and `font-size` declarations with
  `rgb(…)`, keyword, number or length values. Comments are removed. Anything that is not
  well-formed SVG is refused. pikchr's class argument is always NULL, because pikchr copies
  it into the root unescaped; the root's class is set to exactly `pikchr`.
- **Isolated.** The allowlist admits no `id`, no reference and no `<style>`, so one diagram
  cannot address or restyle anything outside it.
- **Plain text out.** pikchr runs with `PIKCHR_PLAINTEXT_ERRORS`. Its source excerpt is
  dropped from the message, leaving the error text and `(called from line N)` for each macro
  call site. `print` output is entity-decoded into `notes`.

Output is deterministic: the same source yields byte-identical SVG in any runtime.

## The engine

`vendor/pikchr/` holds pikchr.org trunk at check-in `a7f1c35bc0` (2026-04-03), compiled to a
single-file wasm module. To move to another check-in, on a machine with `fossil`, `make`, a C
compiler and emcc 6.0.9:

```sh
scripts/build-wasm.sh <checkin>
```

The script clones pikchr.org with Fossil, generates `pikchr.c` from `pikchr.y`, compiles it
and rewrites `provenance.json` and `SHA256SUMS`. Then update the check-in pinned in
`test/vendor.test.ts`. CI never runs emcc; it only verifies the committed files against
`SHA256SUMS`. The generated `pikchr.c` records the host C compiler's name, so a rebuild on
another machine can differ in that line. A rebuild on the same machine is byte-identical.

## Development

```sh
npm ci
npm run lint
npm run compile        # tsc → dist/, which is committed; CI fails if it is stale
npm test               # tests import dist/, so compile first
npm run test:packed    # npm pack, install into a temp project, render one fence
```

Requires Node 22 or later (`.nvmrc` pins the version used in development).
