import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
// The xmldom machinery comes from graphviz-renderer; the allowlist is pikchr's own (ADR 0006):
// exactly what pikchr emits, and nothing that can run script, fetch, or address another diagram.
const svgNamespace = 'http://www.w3.org/2000/svg';
const elements = new Set('svg path circle ellipse polygon text'.split(' '));
const attributes = new Set(('xmlns viewBox d cx cy r rx ry points x y text-anchor dominant-baseline ' +
    'font-style font-weight font-family font-size fill transform style').split(' '));
const declarations = new Set('fill stroke stroke-width stroke-linejoin stroke-dasharray font-size'.split(' '));
const number = String.raw `-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
/** `rgb(…)`, a keyword, or one or more numbers or lengths — no functions, escapes or comments. */
const plainValue = new RegExp(String.raw `^(?:rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|none|round|initial|` +
    String.raw `${number}(?:px|pt|em|%)?(?:[\s,]+${number}(?:px|pt|em|%)?)*)$`, 'i');
/** pikchr rotates text with `rotate(angle cx,cy)`; any other transform is dropped. */
const rotation = new RegExp(String.raw `^rotate\(\s*${number}(?:[\s,]+${number}){0,2}\s*\)$`);
/** Values that could reach outside the diagram, whatever attribute carries them. */
const reaching = /url\s*\(|\\|javascript:|data:|https?:|\/\//i;
const refused = 'pikchr produced SVG that could not be sanitized';
/** Keep the allowed declarations of a `style` attribute, normalised to `name:value;` each. */
function cleanStyle(style) {
    let kept = '';
    for (const declaration of style.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 0)
            continue;
        const name = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        if (declarations.has(name) && plainValue.test(value))
            kept += `${name}:${value};`;
    }
    return kept;
}
function clean(el) {
    for (const attr of Array.from(el.attributes)) {
        if (attr.name === 'style') {
            // Filtered per declaration: one bad declaration does not cost the diagram its colours.
            const style = cleanStyle(attr.value);
            if (style)
                el.setAttribute('style', style);
            else
                el.removeAttributeNode(attr);
        }
        else if (!attributes.has(attr.name) || (reaching.test(attr.value) && attr.name !== 'xmlns') ||
            (attr.name === 'transform' && !rotation.test(attr.value))) {
            el.removeAttributeNode(attr);
        }
    }
    for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 3)
            continue;
        const element = child;
        if (child.nodeType === 1 && element.namespaceURI === svgNamespace && elements.has(element.tagName) && element.tagName !== 'svg') {
            clean(element);
        }
        else {
            el.removeChild(child);
        }
    }
}
/**
 * Parse pikchr's SVG as XML and keep only the allowlisted elements, attributes and style
 * declarations. The root keeps its `viewBox` and the class `pikchr`, nothing that sizes it.
 * Throws, with a fixed plain message, on anything that is not a well-formed SVG document.
 */
export function sanitizeSvg(source) {
    if (/<!DOCTYPE|<!ENTITY/i.test(source))
        throw new Error(refused);
    let root;
    try {
        root = new DOMParser({ onError: () => { throw new Error(); } }).parseFromString(source, 'image/svg+xml').documentElement;
    }
    catch {
        // The parser's own message quotes the offending markup, which may be author-controlled.
        throw new Error(refused);
    }
    if (!root || root.tagName !== 'svg' || root.namespaceURI !== svgNamespace)
        throw new Error(refused);
    clean(root);
    if (!root.hasAttribute('viewBox'))
        throw new Error(refused);
    root.setAttribute('class', 'pikchr');
    return new XMLSerializer().serializeToString(root);
}
