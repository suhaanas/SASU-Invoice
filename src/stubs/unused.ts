/**
 * Stub for jsPDF's optional dependencies (html2canvas, DOMPurify, canvg).
 * They are only used by jsPDF's `doc.html()` / SVG features, which this app
 * never calls, so they are aliased here and kept out of the bundle.
 */
export default function unused(): never {
  throw new Error('This optional jsPDF feature is not bundled.');
}
