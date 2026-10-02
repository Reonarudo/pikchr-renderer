import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { ENGINE, FAILED, HEADER, LENGTH, READY, STARTED } from './protocol.js';
import { interpret } from './interpret.js';
const PIKCHR_PLAINTEXT_ERRORS = 1;
const { buffer } = workerData;
const state = new Int32Array(buffer, 0, HEADER / 4);
const bytes = new Uint8Array(buffer, HEADER);
function write(text) {
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > bytes.length)
        throw new RangeError('reply exceeds the shared buffer');
    bytes.set(encoded);
    Atomics.store(state, LENGTH, encoded.length);
    return encoded.length;
}
function reply(result) {
    try {
        write(JSON.stringify(result));
    }
    catch {
        write(JSON.stringify({ status: 'failure', message: 'pikchr output is too large to return' }));
    }
    Atomics.store(state, READY, 1);
    Atomics.notify(state, READY);
}
/**
 * Run pikchr on one source. The source is copied into wasm memory with malloc rather than
 * passed through `ccall`, which would put up to 192 KB on a 64 KB stack; the result is freed
 * after reading, so the fixed heap does not leak across renders. `zClass` is always NULL.
 */
function run(engine, source) {
    const size = engine.lengthBytesUTF8(source) + 1;
    const text = engine._malloc(size);
    const dimensions = engine._malloc(8);
    try {
        engine.stringToUTF8(source, text, size);
        const result = engine._pikchr(text, 0, PIKCHR_PLAINTEXT_ERRORS, dimensions, dimensions + 4);
        const output = engine.UTF8ToString(result);
        const width = engine.getValue(dimensions, 'i32');
        engine._free(result);
        return { text: output, width };
    }
    finally {
        engine._free(text);
        engine._free(dimensions);
    }
}
const require = createRequire(import.meta.url);
// Loaded inside the promise, so a missing or broken engine file is a failed start, not a crash.
const load = async () => require('../vendor/pikchr/pikchr.cjs')();
load().then((engine) => {
    parentPort.on('message', ({ source, outputBytes }) => {
        let raw;
        try {
            raw = run(engine, source);
        }
        catch (error) {
            // An abort leaves the instance unusable; the host discards this worker.
            const oom = error instanceof Error && /OOM/.test(error.message);
            reply({ status: 'failure', message: oom ? 'pikchr ran out of memory' : 'pikchr stopped unexpectedly', discard: true });
            return;
        }
        reply(interpret(raw.text, raw.width, source, outputBytes));
    });
    Atomics.store(state, ENGINE, STARTED);
    Atomics.notify(state, ENGINE);
    parentPort.postMessage('started');
}, () => {
    // The error would name vendor paths on this machine; the reason stays plain and path-free.
    write('pikchr could not start');
    Atomics.store(state, ENGINE, FAILED);
    Atomics.notify(state, ENGINE);
    parentPort.postMessage('failed');
});
