import type { RenderResult } from './runtime.js';
/**
 * Turn what pikchr returned for one source into a render result. `width` is pikchr's `pnWidth`:
 * positive for a diagram, 0 for nothing to draw, -1 for an error.
 */
export declare function interpret(text: string, width: number, source: string, outputBytes: number): RenderResult;
