/**
 * Parse pikchr's SVG as XML and keep only the allowlisted elements, attributes and style
 * declarations. The root keeps its `viewBox` and the class `pikchr`, nothing that sizes it.
 * Throws, with a fixed plain message, on anything that is not a well-formed SVG document.
 */
export declare function sanitizeSvg(source: string): string;
