import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function stripModernColors(cssText: string): string {
  if (!cssText) return "";

  let cleaned = cssText;

  // Helper: oklch to rgb/rgba
  function oklchToRgb(lStr: string, cStr: string, hStr: string, aStr?: string): string {
    let L = parseFloat(lStr);
    if (lStr.includes('%')) L /= 100;
    let C = parseFloat(cStr);
    if (cStr.includes('%')) C /= 100;
    let H = parseFloat(hStr);

    const hRad = (H * Math.PI) / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855414 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b_rgb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    const f = (x: number) => {
      if (x <= 0.0031308) return 12.92 * x;
      return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    };

    const rByte = Math.max(0, Math.min(255, Math.round(f(r) * 255)));
    const gByte = Math.max(0, Math.min(255, Math.round(f(g) * 255)));
    const bByte = Math.max(0, Math.min(255, Math.round(f(b_rgb) * 255)));

    if (aStr) {
      let alpha = parseFloat(aStr);
      if (aStr.includes('%')) alpha /= 100;
      return `rgba(${rByte}, ${gByte}, ${bByte}, ${alpha})`;
    }
    return `rgb(${rByte}, ${gByte}, ${bByte})`;
  }

  // Helper: oklab to rgb/rgba
  function oklabToRgb(lStr: string, aStr: string, bStr: string, opacityStr?: string): string {
    let L = parseFloat(lStr);
    if (lStr.includes('%')) L /= 100;
    let a = parseFloat(aStr);
    let b = parseFloat(bStr);

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855414 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b_rgb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    const f = (x: number) => {
      if (x <= 0.0031308) return 12.92 * x;
      return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    };

    const rByte = Math.max(0, Math.min(255, Math.round(f(r) * 255)));
    const gByte = Math.max(0, Math.min(255, Math.round(f(g) * 255)));
    const bByte = Math.max(0, Math.min(255, Math.round(f(b_rgb) * 255)));

    if (opacityStr) {
      let alpha = parseFloat(opacityStr);
      if (opacityStr.includes('%')) alpha /= 100;
      return `rgba(${rByte}, ${gByte}, ${bByte}, ${alpha})`;
    }
    return `rgb(${rByte}, ${gByte}, ${bByte})`;
  }

  // 1. Convert oklch
  const oklchRegex = /oklch\(\s*([0-9.%]+)(?:\s+|\s*,\s*)([0-9.%]+)(?:\s+|\s*,\s*)([0-9.-]+)(?:\s*(?:\/|,)\s*([0-9.%]+))?\s*\)/gi;
  cleaned = cleaned.replace(oklchRegex, (match, L, C, H, A) => {
    try {
      return oklchToRgb(L, C, H, A);
    } catch {
      return '#1e293b';
    }
  });

  // 2. Convert oklab
  const oklabRegex = /oklab\(\s*([0-9.%]+)(?:\s+|\s*,\s*)([0-9.-]+)(?:\s+|\s*,\s*)([0-9.-]+)(?:\s*(?:\/|,)\s*([0-9.%]+))?\s*\)/gi;
  cleaned = cleaned.replace(oklabRegex, (match, L, a, b, A) => {
    try {
      return oklabToRgb(L, a, b, A);
    } catch {
      return '#1e293b';
    }
  });

  // Helper to parse any color to standard rgba components
  function parseColorToRgba(colorStr: string): { r: number, g: number, b: number, a: number } | null {
    const s = colorStr.trim().toLowerCase();
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    
    const rgbMatch = s.match(/rgb\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*\)/i);
    if (rgbMatch) {
      return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]), a: 1 };
    }
    
    const rgbaMatch = s.match(/rgba\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9.]+)\s*\)/i);
    if (rgbaMatch) {
      return { r: parseInt(rgbaMatch[1]), g: parseInt(rgbaMatch[2]), b: parseInt(rgbaMatch[3]), a: parseFloat(rgbaMatch[4]) };
    }
    
    const hexMatch = s.match(/#([0-9a-f]{3,8})/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: 1
        };
      } else if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 1
        };
      }
    }
    return null;
  }

  // 3. Convert color-mix with transparent or solid colors
  const colorMixRegex = /color-mix\(\s*in\s+srgb\s*,\s*([^,]+?)(?:\s+([0-9.%]+))?\s*,\s*([^,]+?)(?:\s+([0-9.%]+))?\s*\)/gi;
  cleaned = cleaned.replace(colorMixRegex, (match, col1, wt1, col2, wt2) => {
    try {
      const c1 = parseColorToRgba(col1);
      const c2 = parseColorToRgba(col2);
      if (!c1 && !c2) return col1;
      if (!c1) return col2;
      if (!c2) return col1;

      let w1 = wt1 ? parseFloat(wt1) : 50;
      if (wt1 && wt1.includes('%')) w1 /= 100;
      let w2 = wt2 ? parseFloat(wt2) : (wt1 ? 1 - w1 : 0.5);
      if (wt2 && wt2.includes('%')) w2 /= 100;

      const sum = w1 + w2;
      const factor1 = sum > 0 ? w1 / sum : 0.5;
      const factor2 = sum > 0 ? w2 / sum : 0.5;

      const r = Math.round(c1.r * factor1 + c2.r * factor2);
      const g = Math.round(c1.g * factor1 + c2.g * factor2);
      const b = Math.round(c1.b * factor1 + c2.b * factor2);
      const a = c1.a * factor1 + c2.a * factor2;

      return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
    } catch {
      return col1;
    }
  });

  return cleaned;
}

export async function runWithCleanStyles<T>(fn: () => Promise<T>): Promise<T> {
  const originalStates = new Map<StyleSheet, boolean>();
  let combinedCss = "";

  // 1. Safely grab all document stylesheets
  const sheets = Array.from(document.styleSheets);
  for (const sheet of sheets) {
    // Record original disabled state
    originalStates.set(sheet, sheet.disabled);

    if (sheet.disabled) continue;

    let sheetCss = "";
    try {
      // Standard CSS rules reader
      const rules = Array.from(sheet.cssRules || []);
      for (const rule of rules) {
        sheetCss += rule.cssText + "\n";
      }
    } catch {
      // Fallback: If stylesheet is CORS restricted, try to get from node content
      const node = sheet.ownerNode;
      if (node && node.textContent) {
        sheetCss = node.textContent;
      }
    }

    if (sheetCss) {
      combinedCss += sheetCss + "\n";
    }

    // Disable the active stylesheet to prevent html2canvas reading it
    sheet.disabled = true;
  }

  // 1.5 Safely disable all host <link rel="stylesheet"> elements to prevent html2canvas from making background fetches and parsing them manually
  const linkElements = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  const originalRels = new Map<HTMLLinkElement, string>();
  for (const link of linkElements) {
    originalRels.set(link, link.rel);
    link.rel = 'stylesheet-disabled';
  }

  // 1.6 Disable host <style> tags temporarily so they cannot be parsed either
  const styleElements = Array.from(document.querySelectorAll<HTMLStyleElement>('style:not(#temp-html2canvas-clean-style)'));
  const originalMedias = new Map<HTMLStyleElement, string>();
  for (const style of styleElements) {
    originalMedias.set(style, style.media || '');
    style.media = 'none';
  }

  // 2. Clean the collected styles with absolute precision
  const cleanedCss = stripModernColors(combinedCss);

  // 3. Inject a single, clean style layout for html2canvas to capture correctly
  const tempStyleEl = document.createElement('style');
  tempStyleEl.id = 'temp-html2canvas-clean-style';
  tempStyleEl.textContent = cleanedCss;
  document.head.appendChild(tempStyleEl);

  // 3.5 Monkey-patch getComputedStyle to intercept oklch/oklab in computed colors
  const originalGetComputedStyle = window.getComputedStyle;
  const createCleanProxy = (style: CSSStyleDeclaration) => {
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === 'getPropertyValue') {
          return function(propertyName: string) {
            const val = target.getPropertyValue(propertyName);
            if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab') || val.includes('color-mix'))) {
              return stripModernColors(val);
            }
            return idToFallback(propertyName, val);
          };
        }
        const val = Reflect.get(target, prop);
        if (typeof val === 'string') {
          if (val.includes('oklch') || val.includes('oklab') || val.includes('color-mix')) {
            return stripModernColors(val);
          }
        }
        if (typeof val === 'function') {
          return val.bind(target);
        }
        return val;
      }
    });
  };

  function idToFallback(propName: string, val: any): any {
    if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab') || val.includes('color-mix'))) {
      const isBg = propName.toLowerCase().includes('background');
      return isBg ? '#ffffff' : '#1e293b';
    }
    return val;
  }

  window.getComputedStyle = function(el, pseudo) {
    const style = originalGetComputedStyle.call(this, el, pseudo);
    return createCleanProxy(style);
  };

  try {
    return await fn();
  } finally {
    // Restore window.getComputedStyle
    window.getComputedStyle = originalGetComputedStyle;

    // Restore host <link> tags
    for (const link of linkElements) {
      const origRel = originalRels.get(link);
      if (origRel !== undefined) {
        link.rel = origRel;
      }
    }

    // Restore host <style> tags
    for (const style of styleElements) {
      const origMedia = originalMedias.get(style);
      if (origMedia !== undefined) {
        style.media = origMedia;
      }
    }

    // 4. Restore original active stylesheet states
    for (const sheet of sheets) {
      const orig = originalStates.get(sheet);
      if (orig !== undefined) {
        sheet.disabled = orig;
      }
    }
    // Remove the temporary style element
    if (tempStyleEl.parentNode) {
      tempStyleEl.parentNode.removeChild(tempStyleEl);
    }
  }
}

/**
 * Highly compatible print-to-PDF utility that triggers the browser's native print engine.
 * Generates vector-sharp output, and falls back to a sandbox iframe for maximum popup compatibility.
 */
export function printElement(element: HTMLElement, title: string) {
  // Try popup window first
  let printWindow: Window | null = null;
  try {
    printWindow = window.open("", "_blank");
  } catch (e) {
    console.warn("Popup blocked, falling back to iframe print method", e);
  }

  if (!printWindow) {
    // If popup is blocked, create a dynamic printable sandbox iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "0px";
    iframe.style.height = "0px";
    iframe.style.border = "none";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);
    
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (iframeDoc) {
      iframeDoc.write(`
        <html>
          <head>
            <title>${title}</title>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                color: #1e293b;
                line-height: 1.6;
                padding: 40px;
                background-color: #ffffff;
              }
              .markdown-body h1, h1 { font-size: 26px; font-weight: 800; margin-bottom: 20px; color: #0f172a; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; }
              .markdown-body h2, h2 { font-size: 20px; font-weight: 700; margin-top: 28px; margin-bottom: 12px; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
              .markdown-body h3, h3 { font-size: 16px; font-weight: 700; margin-top: 20px; margin-bottom: 8px; color: #334155; }
              .markdown-body p, p { margin-bottom: 14px; }
              .markdown-body table, table { width: 100%; border-collapse: collapse; margin: 20px 0; }
              .markdown-body th, th { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; font-weight: bold; text-align: left; color: #475569; }
              .markdown-body td, td { border: 1px solid #e2e8f0; padding: 12px; color: #51525d; }
              .markdown-body ul, ol { margin-left: 24px; margin-bottom: 14px; }
              .markdown-body li { margin-bottom: 6px; }
              @media print {
                body { padding: 0; }
                button { display: none !important; }
              }
            </style>
          </head>
          <body>
            <div>${element.innerHTML}</div>
            <script>
              window.onload = function() {
                window.focus();
                window.print();
                setTimeout(() => {
                  window.parent.document.body.removeChild(window.frameElement);
                }, 1000);
              }
            </script>
          </body>
        </html>
      `);
      iframeDoc.close();
    }
    return;
  }

  // If popup window succeeded, write to printWindow
  printWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            color: #1e293b;
            line-height: 1.6;
            padding: 40px;
            background-color: #ffffff;
          }
          .markdown-body h1, h1 { font-size: 26px; font-weight: 800; margin-bottom: 20px; color: #0f172a; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; }
          .markdown-body h2, h2 { font-size: 20px; font-weight: 700; margin-top: 28px; margin-bottom: 12px; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
          .markdown-body h3, h3 { font-size: 16px; font-weight: 700; margin-top: 20px; margin-bottom: 8px; color: #334155; }
          .markdown-body p, p { margin-bottom: 14px; }
          .markdown-body table, table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .markdown-body th, th { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; font-weight: bold; text-align: left; color: #475569; }
          .markdown-body td, td { border: 1px solid #e2e8f0; padding: 12px; color: #51525d; }
          .markdown-body ul, ol { margin-left: 24px; margin-bottom: 14px; }
          .markdown-body li { margin-bottom: 6px; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div>${element.innerHTML}</div>
        <script>
          window.onload = function() {
            window.focus();
            window.print();
            window.close();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

