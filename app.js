// PDF Resume Editor - app shell
// Libraries (globals from CDN): pdfjsLib (pdf.js), PDFLib (pdf-lib), fontkit
// Everything runs in the browser. No file is ever uploaded.

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const RENDER_SCALE = 1.5;

// ---------- App state ----------
const state = {
  fileName: '',
  originalBytes: null, // Uint8Array of the PDF as loaded
  currentBytes: null,  // Uint8Array of the current edited PDF
  pdfJsDoc: null,      // pdf.js document, used for display and reading text
  pages: [],           // { pageNum, viewport, wrapper, canvas, textLayer }
  undoStack: [],       // Stack of previous currentBytes for Undo
  originalLayout: {}   // Per page, from the file as first opened: { rightEdge, items: [{x, y, width}] }.
                       // Limits are measured from this so repeated edits can't creep past them.
};

// ---------- DOM ----------
const fileInput = document.getElementById('fileInput');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const pagesEl = document.getElementById('pages');

fileInput.addEventListener('change', onFileChosen);
if (undoBtn) undoBtn.addEventListener('click', onUndo);
downloadBtn.addEventListener('click', onDownload);

// ---------- UI helpers ----------
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

// Maps a PDF font name to a generic CSS font-family string for the editor input overlay.
function getCssFontFamily(fontName) {
  const lower = (fontName || '').toLowerCase();
  if (/times|serif|georgia|garamond|cambria|book/i.test(lower)) {
    return '"Times New Roman", Times, Georgia, serif';
  }
  if (/courier|mono|consolas/i.test(lower)) {
    return '"Courier New", Courier, monospace';
  }
  return 'Helvetica, Arial, sans-serif';
}

// Maps a font name and style attributes to the closest pdf-lib StandardFonts constant.
function getClosestStandardFont(fontName, isBold, isItalic) {
  const lower = (fontName || '').toLowerCase();
  const isTimes = /times|serif|georgia|garamond|cambria|book/i.test(lower);
  const isCourier = /courier|mono|consolas/i.test(lower);
  const bold = isBold || /bold|black|heavy|medium|semibold|bld/i.test(lower);
  const italic = isItalic || /italic|oblique|ital|it/i.test(lower);

  if (isTimes) {
    if (bold && italic) return PDFLib.StandardFonts.TimesRomanBoldItalic;
    if (bold) return PDFLib.StandardFonts.TimesRomanBold;
    if (italic) return PDFLib.StandardFonts.TimesRomanItalic;
    return PDFLib.StandardFonts.TimesRoman;
  }

  if (isCourier) {
    if (bold && italic) return PDFLib.StandardFonts.CourierBoldOblique;
    if (bold) return PDFLib.StandardFonts.CourierBold;
    if (italic) return PDFLib.StandardFonts.CourierOblique;
    return PDFLib.StandardFonts.Courier;
  }

  if (bold && italic) return PDFLib.StandardFonts.HelveticaBoldOblique;
  if (bold) return PDFLib.StandardFonts.HelveticaBold;
  if (italic) return PDFLib.StandardFonts.HelveticaOblique;
  return PDFLib.StandardFonts.Helvetica;
}

// ---------- Matched fonts ----------
// Free, open-licensed look-alike fonts stored in the fonts/ folder next to index.html.
// Each family lists the weights it has (normal and italic). Files are named like "Barlow_500Medium.ttf"
// and "Barlow_400Regular_Italic.ttf". Fonts load only when an edit needs them.
const FONT_DIR = 'fonts/';
const WEIGHT_NAMES = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' };
const MATCHED_FAMILIES = [
  // LaTeX resumes (Overleaf): Latin Modern and the older Computer Modern names (CMR10, CMBX12, CMTI10...)
  { test: /^(lmroman|latinmodernroman|cmr\d|cmbx|cmti|cmsl|cmu(serif|typewriter)?|computermodern)/, file: 'LatinModernRoman', weights: [400, 700], italics: [400, 700] },
  { test: /^(lmsans|latinmodernsans|cmss|cmusans)/, file: 'LatinModernSans', weights: [400, 700], italics: [400, 700] },
  { test: /^poppins/, file: 'Poppins', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^raleway/, file: 'Raleway', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^merriweather/, file: 'Merriweather', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^(carlito|calibri)/, file: 'Carlito', weights: [400, 700], italics: [400, 700] },
  { test: /^(arimo|arial|liberationsans)/, file: 'Arimo', weights: [400, 500, 600, 700], italics: [400, 700] },
  { test: /^(tinos|timesnewroman|liberationserif)/, file: 'Tinos', weights: [400, 700], italics: [400, 700] },
  { test: /^(gelasio|georgia)/, file: 'Gelasio', weights: [400, 500, 600, 700], italics: [400, 700] },
  { test: /^(caladea|cambria)/, file: 'Caladea', weights: [400, 700], italics: [400, 700] },
  { test: /^(ebgaramond|garamond|adobegaramond)/, file: 'EBGaramond', weights: [400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^roboto/, file: 'Roboto', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^opensans/, file: 'OpenSans', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^lato/, file: 'Lato', weights: [300, 400, 700], italics: [400, 700] },
  { test: /^inter/, file: 'Inter', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^barlow/, file: 'Barlow', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^montserrat/, file: 'Montserrat', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^(sourcesans|sourcesanspro|sourcesans3)/, file: 'SourceSans3', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^manrope/, file: 'Manrope', weights: [300, 400, 500, 600, 700, 800], italics: [] },
  { test: /^notosans(?!mono|display|symbols|cjk|math)/, file: 'NotoSans', weights: [300, 400, 500, 600, 700, 800], italics: [400, 700] },
  { test: /^dejavuserif/, file: 'DejaVuSerif', weights: [400, 700], italics: [400, 700] },
  { test: /^dejavusans(?!mono)/, file: 'DejaVuSans', weights: [400, 700], italics: [400, 700] }
];
// Weight words found in PDF font names. Longer words first so "semibold" is not read as "bold".
const WEIGHT_WORDS = [
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600],
  ['extrabold', 800], ['ultrabold', 800], ['thin', 100], ['light', 300], ['medium', 500],
  ['black', 900], ['heavy', 900], ['bold', 700], ['regular', 400], ['book', 400], ['normal', 400]
];

// Returns a font key for an item: "custom:<file>|<standard fallback>" when a matched font exists,
// otherwise the closest pdf-lib standard font name.
function getFontKey(item) {
  const raw = item.realFontName || item.fontName || '';
  const standard = getClosestStandardFont(raw, item.isBold, item.isItalic);
  const name = raw.replace(/^[A-Z]{6}\+/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const family = MATCHED_FAMILIES.find(f => f.test.test(name));
  if (!family) return standard;

  // The weight word in the font's name wins (e.g. "Barlow-Medium" is 500 even if the PDF flags it bold).
  // Only when the name has no weight word does the bold flag decide.
  let weight = null;
  for (const [word, w] of WEIGHT_WORDS) {
    if (name.includes(word)) { weight = w; break; }
  }
  if (weight === null && /^(cmbx|cmssbx|cmb\d)/.test(name)) weight = 700; // Computer Modern bold names
  if (weight === null) weight = item.isBold ? 700 : 400;

  let italic = Boolean(item.isItalic) || /italic|oblique|^cmti|^cmsl|^cmssi|^cmbxti/.test(name);
  let available = italic ? family.italics : family.weights;
  if (italic && available.length === 0) {
    italic = false;
    available = family.weights;
  }
  const nearest = available.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), available[0]);
  const file = `${family.file}_${nearest}${WEIGHT_NAMES[nearest]}${italic ? '_Italic' : ''}.ttf`;
  return `custom:${file}|${standard}`;
}

const fontBytesCache = new Map();
const failedFontFiles = new Set();

// Turns base64 text into raw bytes.
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Loads a font once and caches its bytes. Each font ships as a small script
// (fonts/Barlow_400Regular.js) that stores the font as base64 in window.__PDF_EDITOR_FONTS.
// Scripts load both from a web server and when index.html is opened directly as a file,
// where browsers block fetch() for local files.
function loadFontBytes(file) {
  if (!fontBytesCache.has(file)) {
    fontBytesCache.set(file, new Promise((resolve, reject) => {
      const store = () => window.__PDF_EDITOR_FONTS && window.__PDF_EDITOR_FONTS[file];
      if (store()) {
        resolve(base64ToBytes(store()));
        return;
      }
      const script = document.createElement('script');
      script.src = FONT_DIR + file.replace(/\.ttf$/, '.js');
      script.onload = () => {
        const data = store();
        if (data) {
          resolve(base64ToBytes(data));
          delete window.__PDF_EDITOR_FONTS[file]; // Bytes are cached; free the base64 copy
        } else {
          reject(new Error('Font script loaded but contained no data'));
        }
        script.remove();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Font script not found'));
      };
      document.head.appendChild(script);
    }));
  }
  return fontBytesCache.get(file);
}

// Embeds the font for a key into a pdf-lib document. Falls back to the standard font
// if the matched font file cannot be loaded.
async function embedFontByKey(doc, key) {
  if (key.startsWith('custom:')) {
    const [file, standard] = key.slice(7).split('|');
    if (!failedFontFiles.has(file)) {
      try {
        const bytes = await loadFontBytes(file);
        const f = await doc.embedFont(bytes, { subset: true });
        f.matchedFile = file;
        return f;
      } catch (err) {
        failedFontFiles.add(file);
        fontBytesCache.delete(file);
        console.warn(`[Font] Could not load ${FONT_DIR}${file}, using ${standard} instead.`, err);
      }
    }
    return await doc.embedFont(standard);
  }
  return await doc.embedFont(key);
}

// Returns true if every character in text exists in the font, so nothing draws as an empty box.
function fontCanDraw(font, text) {
  try {
    if (typeof font.getCharacterSet === 'function' && font.matchedFile) {
      const set = new Set(font.getCharacterSet());
      for (const ch of text) {
        if (!set.has(ch.codePointAt(0))) return false;
      }
      return true;
    }
    font.encodeText(text);
    return true;
  } catch (err) {
    return false;
  }
}

// Lazy document and cache for measuring text in PDF units.
let measureDocPromise = null;
const measureFontCache = new Map();

// Returns an embedded font instance (matched or standard) used for measuring text widths.
async function getFallbackFontForMeasuring(fontKey) {
  if (!measureDocPromise) {
    measureDocPromise = PDFLib.PDFDocument.create().then(d => {
      d.registerFontkit(fontkit);
      return d;
    });
  }
  const mDoc = await measureDocPromise;
  if (!measureFontCache.has(fontKey)) {
    measureFontCache.set(fontKey, embedFontByKey(mDoc, fontKey));
  }
  return measureFontCache.get(fontKey);
}

// Computes the adjusted font size for an item using bold variant measurement, clamped 0.75 to 1.4, with console logging (Fix 5).
// A matched font is the same (or a metric-compatible) font, so it keeps the original size; any width
// difference is letter-spacing, handled by letterSpacingFor().
function computeAdjustedFontSize(item, fallbackFont, fontName = '') {
  const originalText = item.hasBullet ? item.editableText : item.str;
  const originalWidth = item.hasBullet ? item.editableWidth : item.width;
  if (fallbackFont.matchedFile) {
    console.log(`[Fix 5 font adjustment] "${originalText}" | font: ${fallbackFont.matchedFile}, size kept at ${item.fontSize.toFixed(2)}`);
    return item.fontSize;
  }
  const measured = fallbackFont.widthOfTextAtSize(originalText || ' ', item.fontSize);
  let ratio = measured > 0 ? (originalWidth / measured) : 1.0;
  ratio = Math.max(0.75, Math.min(1.4, ratio));
  const adjustedSize = item.fontSize * ratio;
  console.log(`[Fix 5 font adjustment] "${originalText}" | font: ${fontName || fallbackFont.name || 'standard'}, original size: ${item.fontSize.toFixed(2)}, adjusted size: ${adjustedSize.toFixed(2)}, ratio: ${ratio.toFixed(3)}`);
  return adjustedSize;
}

// Letter-spacing (points added after each character) that makes a matched font reproduce the original
// text width, e.g. for spaced-out headings. Standard fallback fonts use size scaling instead, so 0.
function letterSpacingFor(item, font, text, width) {
  if (!font.matchedFile) return 0;
  const t = text !== undefined ? text : (item.hasBullet ? item.editableText : item.str);
  const w = width !== undefined ? width : (item.hasBullet ? item.editableWidth : item.width);
  const n = [...t].length;
  if (n < 2) return 0;
  let s = (w - font.widthOfTextAtSize(t, item.fontSize)) / (n - 1);
  s = Math.max(-0.1 * item.fontSize, Math.min(0.5 * item.fontSize, s));
  return Math.abs(s) < 0.05 ? 0 : s;
}

// Width of text drawn with a given letter-spacing.
function spacedWidth(font, text, size, spacing) {
  const n = [...text].length;
  return font.widthOfTextAtSize(text, size) + (n > 1 ? spacing * (n - 1) : 0);
}

// Draws text on a pdf-lib page, applying letter-spacing (PDF Tc) when needed.
function drawSpacedText(page, text, opts, spacing) {
  if (!spacing) {
    page.drawText(text, opts);
    return;
  }
  page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.setCharacterSpacing(spacing));
  page.drawText(text, opts);
  page.pushOperators(PDFLib.popGraphicsState());
}

// Samples the rendered canvas to determine the darkest pixel inside a box (text color)
// and the brightest pixel just outside the box (background color).
function sampleColors(canvas, box) {
  const pixelRatio = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');

  let textColor = { r: 0, g: 0, b: 0 };
  let bgColor = { r: 255, g: 255, b: 255 };

  try {
    const cLeft = Math.max(0, Math.floor(box.left * pixelRatio));
    const cTop = Math.max(0, Math.floor(box.top * pixelRatio));
    const cWidth = Math.min(canvas.width - cLeft, Math.max(1, Math.floor(box.width * pixelRatio)));
    const cHeight = Math.min(canvas.height - cTop, Math.max(1, Math.floor(box.height * pixelRatio)));

    // Sample inside box for darkest pixel
    const insideData = ctx.getImageData(cLeft, cTop, cWidth, cHeight).data;
    let minLum = Infinity;
    for (let i = 0; i < insideData.length; i += 4) {
      const a = insideData[i + 3];
      if (a < 128) continue;
      const r = insideData[i];
      const g = insideData[i + 1];
      const b = insideData[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < minLum) {
        minLum = lum;
        textColor = { r, g, b };
      }
    }

    // Sample just outside box (slightly above) for background color
    let sampleY = Math.floor((box.top - 3) * pixelRatio);
    if (sampleY < 0 || sampleY >= canvas.height) {
      sampleY = Math.min(canvas.height - 1, Math.floor((box.top + box.height + 3) * pixelRatio));
    }
    const bgData = ctx.getImageData(cLeft, sampleY, cWidth, 1).data;
    let maxLum = -1;
    for (let i = 0; i < bgData.length; i += 4) {
      const a = bgData[i + 3];
      if (a < 128) continue;
      const r = bgData[i];
      const g = bgData[i + 1];
      const b = bgData[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > maxLum) {
        maxLum = lum;
        bgColor = { r, g, b };
      }
    }
  } catch (err) {
    textColor = { r: 0, g: 0, b: 0 };
    bgColor = { r: 255, g: 255, b: 255 };
  }

  return { textColor, bgColor };
}

// Converts a Uint8Array into a binary-safe string preserving each byte 0..255.
function bytesToBinaryString(bytes) {
  let str = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return str;
}

// Multiplies two 2D affine transformation matrices [a, b, c, d, e, f].
function multiplyMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

// Tokenizes a PDF content stream string into operators and operands with byte ranges.
function tokenizePDFStream(str) {
  const ops = [];
  let operands = [];
  let opStart = null;
  let i = 0;
  const len = str.length;

  function isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\0';
  }
  function isDelimiter(ch) {
    return isWhitespace(ch) || ch === '(' || ch === ')' || ch === '<' || ch === '>' ||
           ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '/' || ch === '%';
  }

  while (i < len) {
    while (i < len && isWhitespace(str[i])) i++;
    if (i >= len) break;

    const ch = str[i];
    if (ch === '%') {
      while (i < len && str[i] !== '\r' && str[i] !== '\n') i++;
      continue;
    }

    const tokenStart = i;

    // Literal string (...)
    if (ch === '(') {
      if (opStart === null) opStart = tokenStart;
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (str[i] === '\\') {
          i += 2;
        } else if (str[i] === '(') {
          depth++;
          i++;
        } else if (str[i] === ')') {
          depth--;
          i++;
        } else {
          i++;
        }
      }
      operands.push({ type: 'string', value: str.slice(tokenStart, i), start: tokenStart, end: i });
      continue;
    }

    // Hex string <...> or Dictionary <<...>>
    if (ch === '<') {
      if (opStart === null) opStart = tokenStart;
      if (str[i + 1] === '<') {
        let depth = 1;
        i += 2;
        while (i < len && depth > 0) {
          if (str[i] === '<' && str[i + 1] === '<') { depth++; i += 2; }
          else if (str[i] === '>' && str[i + 1] === '>') { depth--; i += 2; }
          else i++;
        }
        operands.push({ type: 'dict', value: str.slice(tokenStart, i), start: tokenStart, end: i });
      } else {
        i++;
        while (i < len && str[i] !== '>') i++;
        if (i < len) i++;
        operands.push({ type: 'hex', value: str.slice(tokenStart, i), start: tokenStart, end: i });
      }
      continue;
    }

    // Array [...]
    if (ch === '[') {
      if (opStart === null) opStart = tokenStart;
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (str[i] === '[') { depth++; i++; }
        else if (str[i] === ']') { depth--; i++; }
        else if (str[i] === '(') {
          let sDepth = 1;
          i++;
          while (i < len && sDepth > 0) {
            if (str[i] === '\\') i += 2;
            else if (str[i] === '(') { sDepth++; i++; }
            else if (str[i] === ')') { sDepth--; i++; }
            else i++;
          }
        } else {
          i++;
        }
      }
      operands.push({ type: 'array', value: str.slice(tokenStart, i), start: tokenStart, end: i });
      continue;
    }

    // Name /...
    if (ch === '/') {
      if (opStart === null) opStart = tokenStart;
      i++;
      while (i < len && !isDelimiter(str[i])) i++;
      operands.push({ type: 'name', value: str.slice(tokenStart, i), start: tokenStart, end: i });
      continue;
    }

    // Single-quote and double-quote operators
    if (ch === "'" || ch === '"') {
      i++;
      ops.push({
        operator: ch,
        operands: operands,
        start: opStart !== null ? opStart : tokenStart,
        end: i
      });
      operands = [];
      opStart = null;
      continue;
    }

    // Regular token: number or operator
    while (i < len && !isDelimiter(str[i])) i++;
    const tokenVal = str.slice(tokenStart, i);

    // Skip inline images BI ... ID ... EI byte-for-byte
    if (tokenVal === 'BI') {
      const idIdx = str.indexOf('ID', i);
      if (idIdx !== -1) {
        let dataStart = idIdx + 2;
        if (dataStart < len && (str[dataStart] === ' ' || str[dataStart] === '\n' || str[dataStart] === '\r')) {
          dataStart++;
        }
        let eiIdx = str.indexOf('EI', dataStart);
        while (eiIdx !== -1) {
          if (isWhitespace(str[eiIdx - 1])) break;
          eiIdx = str.indexOf('EI', eiIdx + 2);
        }
        if (eiIdx !== -1) i = eiIdx + 2;
      }
      operands = [];
      opStart = null;
      continue;
    }

    const isNum = !isNaN(Number(tokenVal)) && tokenVal.trim().length > 0;
    if (isNum) {
      if (opStart === null) opStart = tokenStart;
      operands.push({ type: 'number', value: parseFloat(tokenVal), start: tokenStart, end: i });
    } else {
      ops.push({
        operator: tokenVal,
        operands: operands,
        start: opStart !== null ? opStart : tokenStart,
        end: i
      });
      operands = [];
      opStart = null;
    }
  }

  return ops;
}

// ---------- Loading ----------
async function onFileChosen(event) {
  const file = event.target.files[0];
  if (!file) return;
  await openFile(file);
}

// ---------- Drag and drop ----------
// Dropping a PDF anywhere on the page opens it in the editor instead of the browser's own viewer.
window.addEventListener('dragover', e => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', async e => {
  e.preventDefault();
  const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
  const file = files.find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!file) {
    setStatus('That is not a PDF. Drop a .pdf file.', true);
    return;
  }
  if (state.undoStack.length > 0 && !confirm('Open a different PDF? Edits you have not downloaded will be lost.')) {
    return;
  }
  await openFile(file);
});

// Loads a PDF file chosen with the button or dropped on the page.
async function openFile(file) {
  try {
    setStatus('Loading...');
    const buffer = await file.arrayBuffer();
    await loadPdf(new Uint8Array(buffer), file.name);
    setStatus(`${file.name} loaded. ${state.pages.length} page(s).`);
    downloadBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('Could not open that PDF.', true);
    downloadBtn.disabled = true;
  } finally {
    fileInput.value = '';
  }
}

// Reloads the PDF display, re-rendering all pages and text layers from state.currentBytes.
async function refreshFromCurrentBytes() {
  state.pages = [];
  pagesEl.innerHTML = '';

  state.pdfJsDoc = await pdfjsLib.getDocument({ data: state.currentBytes.slice() }).promise;

  for (let pageNum = 1; pageNum <= state.pdfJsDoc.numPages; pageNum++) {
    await renderPage(pageNum);
  }

  const shapesByPage = await findFilledShapes(state.currentBytes);

  for (const page of state.pages) {
    const items = await findTextItems(page.pageNum);
    if (!state.originalLayout[page.pageNum]) {
      state.originalLayout[page.pageNum] = {
        rightEdge: items.length > 0 ? Math.max(...items.map(it => it.x + it.width)) : 0,
        items: items.map(it => ({ x: it.x, y: it.y, width: it.width }))
      };
    }
    const pageShapes = shapesByPage[page.pageNum - 1] || { fills: [], dividers: [] };
    attachShapes(items, pageShapes.fills);
    page.dividers = pageShapes.dividers;
    page.items = items;
    buildTextLayer(page, items);
  }
}

// Reads every page's drawing commands and returns, per page:
//   fills: bounding boxes (page coordinates) of filled shapes: pills, tags, shaded bars and boxes
//   dividers: tall thin vertical lines (column dividers), drawn as strokes or thin fills
// Returns empty lists if anything goes wrong.
async function findFilledShapes(bytes) {
  const result = [];
  try {
    const doc = await PDFLib.PDFDocument.load(bytes.slice());
    for (const page of doc.getPages()) {
      const shapes = [];
      const dividers = [];
      result.push({ fills: shapes, dividers });
      // A box that is at most 3pt wide and at least 40pt tall is a vertical divider line
      const addIfDivider = s => {
        if (s.x1 - s.x0 <= 3 && s.y1 - s.y0 >= 40) dividers.push({ x: (s.x0 + s.x1) / 2, y0: s.y0, y1: s.y1 });
      };
      const contents = page.node.Contents();
      if (!contents) continue;
      const streams = [];
      if (contents.asArray) {
        for (const ref of contents.asArray()) {
          const s = doc.context.lookup(ref);
          if (s) streams.push(s);
        }
      } else {
        const s = doc.context.lookup(contents);
        if (s) streams.push(s);
      }
      const content = streams.map(s => bytesToBinaryString(PDFLib.decodePDFRawStream(s).decode())).join('\n');
      const ops = tokenizePDFStream(content);

      const stack = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      let pts = [];
      const addPoint = (x, y) => {
        pts.push([ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      };
      const nums = op => op.operands.map(o => o.value);

      for (const op of ops) {
        const n = op.operator;
        if (n === 'q') stack.push([...ctm]);
        else if (n === 'Q') { if (stack.length) ctm = stack.pop(); }
        else if (n === 'cm') ctm = multiplyMatrices(nums(op), ctm);
        else if (n === 'm' || n === 'l') { const v = nums(op); addPoint(v[0], v[1]); }
        else if (n === 'c') { const v = nums(op); addPoint(v[0], v[1]); addPoint(v[2], v[3]); addPoint(v[4], v[5]); }
        else if (n === 'v' || n === 'y') { const v = nums(op); addPoint(v[0], v[1]); addPoint(v[2], v[3]); }
        else if (n === 're') {
          const [x, y, w, h] = nums(op);
          addPoint(x, y); addPoint(x + w, y); addPoint(x, y + h); addPoint(x + w, y + h);
        } else if (['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(n)) {
          if (pts.length) {
            const xs = pts.map(p => p[0]);
            const ys = pts.map(p => p[1]);
            const s = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
            if (s.x1 - s.x0 >= 2 && s.y1 - s.y0 >= 2) shapes.push(s);
            addIfDivider(s);
          }
          pts = [];
        } else if (n === 'S' || n === 's') {
          // Stroked path (a line): only kept if it is a vertical divider
          if (pts.length) {
            const xs = pts.map(p => p[0]);
            const ys = pts.map(p => p[1]);
            addIfDivider({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
          }
          pts = [];
        } else if (n === 'n') {
          pts = [];
        }
      }
    }
  } catch (err) {
    console.warn('[Shapes] Could not read shapes, text limits will ignore them.', err);
  }
  return result;
}

// Gives each text item the smallest filled shape that snugly holds it (a pill, tag or shaded bar):
// the shape contains the item's text and is no taller than 3x its font size. Large boxes, page
// backgrounds and thin divider lines are ignored. item.shape is null when there is none.
function attachShapes(items, shapes) {
  for (const item of items) {
    const left = item.hasBullet ? item.editableStartX : item.x;
    const right = item.x + item.width;
    let best = null;
    let bestArea = Infinity;
    for (const s of shapes) {
      const fits =
        s.x0 <= left + 0.5 && s.x1 >= right - 0.5 &&
        s.y0 <= item.y + item.fontSize * 0.1 && s.y1 >= item.y + item.fontSize * 0.6 &&
        (s.y1 - s.y0) <= item.fontSize * 3;
      if (!fits) continue;
      const area = (s.x1 - s.x0) * (s.y1 - s.y0);
      if (area < bestArea) { best = s; bestArea = area; }
    }
    item.shape = best; // Same object for every item in the same shape
  }
}

async function loadPdf(bytes, fileName) {
  state.fileName = fileName;
  state.originalBytes = bytes;
  state.currentBytes = bytes;
  state.undoStack = [];
  state.originalLayout = {};
  if (undoBtn) undoBtn.disabled = true;

  await refreshFromCurrentBytes();
}

// ---------- Rendering ----------
async function renderPage(pageNum) {
  const pdfPage = await state.pdfJsDoc.getPage(pageNum);
  const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });
  const pixelRatio = window.devicePixelRatio || 1;

  const wrapper = document.createElement('div');
  wrapper.className = 'page';
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const textLayer = document.createElement('div');
  textLayer.className = 'text-layer';

  wrapper.appendChild(canvas);
  wrapper.appendChild(textLayer);
  pagesEl.appendChild(wrapper);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;

  state.pages.push({ pageNum, viewport, wrapper, canvas, textLayer });
}

// ---------- Text Items & Layer ----------

// Reads text items on a page, ignores rotated text/whitespace, separates bullet dots from editable text,
// detects right alignment, computes screen coordinates, and samples canvas colors.
async function findTextItems(pageNum) {
  const pageObj = state.pages.find(p => p.pageNum === pageNum);
  if (!pageObj) return [];

  const pdfPage = await state.pdfJsDoc.getPage(pageNum);
  const textContent = await pdfPage.getTextContent();
  const rawItems = [];

  // Bullet markers: • · ▪ ● ◦ ‣ - – * followed by a space
  const bulletRegex = /^([•·▪●◦‣–\-*]\s+)/;

  let uncombinedContent = null;
  const hasBullets = textContent.items.some(it => it.str && bulletRegex.test(it.str));
  if (hasBullets) {
    try {
      uncombinedContent = await pdfPage.getTextContent({ disableCombineTextItems: true });
    } catch (e) {
      uncombinedContent = null;
    }
  }

  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;

    const t = item.transform;
    // Skip rotated or mirrored text
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01 || t[0] <= 0 || t[3] <= 0) {
      continue;
    }

    const x = t[4];
    const y = t[5];
    const fontSize = Math.hypot(t[2], t[3]);
    const width = item.width;
    const height = item.height || fontSize;
    const fontName = item.fontName;

    let realFontName = fontName;
    let isBold = false;
    let isItalic = false;

    if (pdfPage.commonObjs && pdfPage.commonObjs.has && pdfPage.commonObjs.has(fontName)) {
      const fontObj = pdfPage.commonObjs.get(fontName);
      if (fontObj) {
        realFontName = fontObj.name || fontObj.fallbackName || fontObj.loadedName || fontName;
        if (fontObj.bold !== undefined) isBold = Boolean(fontObj.bold);
        if (fontObj.italic !== undefined) isItalic = Boolean(fontObj.italic);
      }
    }

    const lower = (realFontName || fontName || '').toLowerCase();
    if (!isBold && /bold|black|heavy|medium|semibold|bld/i.test(lower)) {
      isBold = true;
    }
    if (!isItalic && /italic|oblique|ital|it/i.test(lower)) {
      isItalic = true;
    }

    const bulletMatch = item.str.match(bulletRegex);
    const hasBullet = Boolean(bulletMatch);
    let bulletPrefix = '';
    let editableText = item.str;
    let editableStartX = x;
    let editableWidth = width;

    if (hasBullet) {
      bulletPrefix = bulletMatch[0];
      editableText = item.str.slice(bulletPrefix.length);

      let foundExactX = false;
      if (uncombinedContent && uncombinedContent.items) {
        const pieces = uncombinedContent.items.filter(u =>
          Math.abs(u.transform[5] - y) <= 0.5 &&
          u.transform[4] > x + 0.5 &&
          u.transform[4] < x + width &&
          u.str && u.str.trim()
        );
        if (pieces.length > 0) {
          pieces.sort((a, b) => a.transform[4] - b.transform[4]);
          editableStartX = pieces[0].transform[4];
          foundExactX = true;
        }
      }

      if (!foundExactX) {
        // Work out where the text after the bullet starts. With a matched font this is exact:
        // the line's right end minus the width of the text. With a fallback font, use the
        // bullet's share of the measured line width.
        const fKey = getFontKey({ realFontName, fontName, isBold, isItalic });
        const fFont = await getFallbackFontForMeasuring(fKey);
        const textW = fFont.widthOfTextAtSize(editableText, fontSize);
        if (fFont.matchedFile) {
          editableStartX = x + width - textW;
        } else {
          const fullW = fFont.widthOfTextAtSize(item.str, fontSize);
          const bulletShare = fullW > 0 ? (fullW - textW) / fullW : 0;
          editableStartX = x + width * bulletShare;
        }
      }

      editableWidth = Math.max(0, (x + width) - editableStartX);
    }

    const viewport = pageObj.viewport;
    const boxStartX = hasBullet ? editableStartX : x;
    const ptDescender = viewport.convertToViewportPoint(boxStartX, y - fontSize * 0.25);
    const ptAscender = viewport.convertToViewportPoint(x + width, y + fontSize * 0.85);

    const boxLeft = Math.min(ptDescender[0], ptAscender[0]);
    const boxTop = Math.min(ptDescender[1], ptAscender[1]);
    const boxWidth = Math.abs(ptAscender[0] - ptDescender[0]);
    const boxHeight = Math.abs(ptDescender[1] - ptAscender[1]);

    const box = {
      left: boxLeft,
      top: boxTop,
      width: boxWidth,
      height: boxHeight
    };

    const { textColor, bgColor } = sampleColors(pageObj.canvas, box);

    rawItems.push({
      str: item.str,
      x,
      y,
      fontSize,
      width,
      height,
      fontName,
      realFontName,
      isBold,
      isItalic,
      hasBullet,
      bulletPrefix,
      editableText,
      editableStartX,
      editableWidth,
      box,
      textColor,
      bgColor,
      transform: t
    });
  }

  // Detect right alignment across page items
  if (rawItems.length > 0) {
    // Use the right edge of the file as first opened, so lines lengthened by edits don't shift it
    const layout = state.originalLayout[pageNum];
    const pageRightTextEdge = layout ? layout.rightEdge : Math.max(...rawItems.map(it => it.x + it.width));
    const pageMiddleX = (pageObj.viewport.width / RENDER_SCALE) / 2;

    const endsAtRightEdge = it => Math.abs((it.x + it.width) - pageRightTextEdge) <= 1.5;
    for (const item of rawItems) {
      // A line that starts at the same x as another line which does NOT end at the right edge is part of a
      // left-aligned paragraph or column (it is just the widest line), not right-aligned text like a date.
      const leftAlignedWithOthers = rawItems.some(o =>
        o !== item &&
        Math.abs(o.y - item.y) > 1 &&
        Math.abs(o.x - item.x) <= 0.5 &&
        !endsAtRightEdge(o)
      );
      item.isRightAligned = endsAtRightEdge(item) && (item.x > pageMiddleX) && !leftAlignedWithOthers;
    }
  }

  return rawItems;
}

// Finds a column boundary to the right of the edited item across the page when none exists on the current line.
// Analyzes vertical bands and lines on the page to identify where the next column starts.
function findColumnBoundaryOnPage(items, editedItem, editedStartX, editedRightX, colThreshold) {
  let minColX = Infinity;
  let boundaryItem = null;

  // Non-right-aligned items excluding the edited item, only within a vertical band around the edited line
  // (baseline within 2.5 x font size), so gaps elsewhere on the page are not mistaken for a column edge.
  const band = editedItem.fontSize * 2.5;
  // The edited item stays in this list so its own line keeps its real gaps (removing it would leave a
  // fake "gutter" where it sits). Its own line is skipped below; same-line limits are handled elsewhere.
  const nonRightItems = items.filter(it =>
    !it.isRightAligned &&
    Math.abs(it.y - editedItem.y) <= band
  );

  // Group items by line based on vertical overlap >= 50%
  const lines = [];
  for (const it of nonRightItems) {
    const itTop = it.y + it.fontSize * 0.85;
    const itBottom = it.y - it.fontSize * 0.25;
    const itH = itTop - itBottom;
    let foundLine = false;
    for (const line of lines) {
      const rep = line[0];
      const repTop = rep.y + rep.fontSize * 0.85;
      const repBottom = rep.y - rep.fontSize * 0.25;
      const repH = repTop - repBottom;
      const overlap = Math.min(itTop, repTop) - Math.max(itBottom, repBottom);
      const minH = Math.min(itH, repH);
      if (minH > 0 && (overlap / minH) >= 0.5) {
        line.push(it);
        foundLine = true;
        break;
      }
    }
    if (!foundLine) {
      lines.push([it]);
    }
  }

  // 1. Check all lines on the page for column boundaries (gap > colThreshold) to the right of editedStartX
  for (const line of lines) {
    if (line.includes(editedItem)) continue; // Same line is handled by getLineAndSlidingPieces
    line.sort((a, b) => a.x - b.x);
    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1];
      const curr = line[i];
      const gap = curr.x - (prev.x + prev.width);
      if (gap > colThreshold && curr.x > editedStartX + colThreshold) {
        if (curr.x < minColX) {
          minColX = curr.x;
          boundaryItem = curr;
        }
      }
    }
  }

  // 2. Check for vertical bands of text (at least 2 items aligned at approximately the same left X across different lines)
  // strictly to the right of editedStartX + colThreshold and editedRightX
  const rightCandidates = nonRightItems.filter(it =>
    it !== editedItem &&
    Math.abs(it.y - editedItem.y) > editedItem.fontSize * 0.5 && // not on the edited line itself
    it.x > editedStartX + colThreshold &&
    it.x > editedRightX
  );

  for (let i = 0; i < rightCandidates.length; i++) {
    const a = rightCandidates[i];
    if (a.x >= minColX) continue;
    const hasAlignedItem = rightCandidates.some(b =>
      b !== a &&
      Math.abs(b.y - a.y) > 3.0 &&
      Math.abs(b.x - a.x) <= 3.0
    );
    if (hasAlignedItem) {
      if (a.x < minColX) {
        minColX = a.x;
        boundaryItem = a;
      }
    }
  }

  return boundaryItem;
}

// Finds items on the same line (vertical extent overlap >= 50%), sliding pieces to the right,
// original consecutive gaps clamped to >= 0, and right-aligned / column barriers.
async function getLineAndSlidingPieces(items, editedItem, fallbackFont, adjustedSize) {
  const itemTop = editedItem.y + editedItem.fontSize * 0.85;
  const itemBottom = editedItem.y - editedItem.fontSize * 0.25;
  const itemH = itemTop - itemBottom;

  // The line = all text items on the page whose vertical extent overlaps the edited item's vertical extent by at least 50%
  const lineItems = items.filter(it => {
    const itTop = it.y + it.fontSize * 0.85;
    const itBottom = it.y - it.fontSize * 0.25;
    const itH = itTop - itBottom;
    const overlap = Math.min(itemTop, itTop) - Math.max(itemBottom, itBottom);
    const minH = Math.min(itemH, itH);
    return minH > 0 && (overlap / minH) >= 0.5;
  });

  const editedStartX = editedItem.hasBullet ? editedItem.editableStartX : editedItem.x;
  const editedRightX = editedItem.hasBullet ? editedItem.editableStartX + editedItem.editableWidth : editedItem.x + editedItem.width;

  // Space width of edited item's font at its adjusted size
  let sWidth = 4;
  if (fallbackFont && adjustedSize) {
    sWidth = fallbackFont.widthOfTextAtSize(' ', adjustedSize);
  }
  const colThreshold = Math.min(4 * sWidth, 24);

  // Candidates on the line strictly to the right of the edited item's left edge, excluding right-aligned items
  const candidates = lineItems
    .filter(it => it !== editedItem && !it.isRightAligned && it.x > editedStartX + 0.5)
    .sort((a, b) => a.x - b.x);

  // A piece on the line is a COLUMN BOUNDARY if the gap between it and the previous piece
  // is larger than 4 times the space width of the edited item's font at its size, or larger than 24 points, whichever is smaller.
  // Pieces at or after a column boundary never slide.
  const slidingPieces = [];
  const gaps = [];
  let firstColumnBoundary = null;
  let boundaryIsShapeWall = false;

  let prevRight = editedRightX;
  for (let i = 0; i < candidates.length; i++) {
    const curr = candidates[i];
    const rawGap = curr.x - prevRight;
    const gap = Math.max(0, rawGap);

    // Text sitting in a different shape (another pill or tag) never slides; it is a wall.
    if ((curr.shape || null) !== (editedItem.shape || null)) {
      firstColumnBoundary = curr;
      boundaryIsShapeWall = true;
      break;
    }

    if (gap > colThreshold) {
      // curr is the first column boundary
      firstColumnBoundary = curr;
      break;
    }

    slidingPieces.push(curr);
    gaps.push(gap);
    prevRight = curr.x + curr.width;
  }

  // If no column boundary was found on this specific line, check for column boundaries across the page
  if (!firstColumnBoundary) {
    firstColumnBoundary = findColumnBoundaryOnPage(items, editedItem, editedStartX, editedRightX, colThreshold);
  }

  for (const piece of slidingPieces) {
    const sFontName = getFontKey(piece);
    const sFont = await getFallbackFontForMeasuring(sFontName);
    piece.fallbackFont = sFont;
    piece.standardFontName = sFontName;
    piece.adjustedSize = computeAdjustedFontSize(piece, sFont, sFontName);
    piece.letterSpacing = letterSpacingFor(piece, sFont, piece.str, piece.width);
    piece.redrawWidth = spacedWidth(sFont, piece.str, piece.adjustedSize, piece.letterSpacing);
  }

  // Right-aligned barrier on the line
  const rightAlignedOnLine = lineItems
    .filter(it => it.isRightAligned && it.x > editedStartX)
    .sort((a, b) => a.x - b.x);

  return {
    lineItems,
    slidingPieces,
    gaps,
    firstColumnBoundary,
    boundaryIsShapeWall,
    rightAlignedOnLine
  };
}

// Places transparent clickable boxes in the textLayer for each item.
// Handles inline editing, sliding line movement, adjusted font scaling, space-left counter calculation, and alignment.
function buildTextLayer(page, items) {
  page.textLayer.innerHTML = '';

  // Limits come from the original layout so repeated edits can't creep past them
  const originalLayout = state.originalLayout[page.pageNum];
  const pageRightTextEdge = originalLayout
    ? originalLayout.rightEdge
    : (items.length > 0 ? Math.max(...items.map(it => it.x + it.width)) : 0);
  const layoutItems = originalLayout ? originalLayout.items : items;

  for (const item of items) {
    const boxEl = document.createElement('div');
    boxEl.className = 'text-box';
    boxEl.style.left = `${item.box.left}px`;
    boxEl.style.top = `${item.box.top}px`;
    boxEl.style.width = `${item.box.width}px`;
    boxEl.style.height = `${item.box.height}px`;

    const fontFamily = getCssFontFamily(item.realFontName || item.fontName);
    const standardFontName = getFontKey(item);

    boxEl.addEventListener('click', async (e) => {
      e.stopPropagation();

      boxEl.style.display = 'none';

      const fallbackFont = await getFallbackFontForMeasuring(standardFontName);
      const adjustedSize = computeAdjustedFontSize(item, fallbackFont, standardFontName);
      const screenFontSize = adjustedSize * page.viewport.scale;

      const spaceWidth = fallbackFont.widthOfTextAtSize(' ', adjustedSize);
      const letterSpacing = letterSpacingFor(item, fallbackFont);

      let availableWidth = 0;
      let lineInfo = null;

      if (item.isRightAligned) {
        // Right-aligned: grows to the left, bounded by previous item
        const lineTolerance = Math.max(3.0, item.fontSize * 0.4);
        const prevItems = items.filter(it => it !== item && Math.abs(it.y - item.y) <= lineTolerance && (it.x + it.width) <= item.x + 0.5);
        let prevRightEdge = 0;
        if (prevItems.length > 0) {
          prevRightEdge = Math.max(...prevItems.map(it => it.x + it.width));
        } else {
          prevRightEdge = Math.min(...items.map(it => it.x));
        }
        availableWidth = (item.x + item.width) - (prevRightEdge + spaceWidth);

        // Inside a pill or shaded bar: keep the same padding on the left as on the right
        if (item.shape) {
          const padRight = Math.max(1, item.shape.x1 - (item.x + item.width));
          const shapeAvail = (item.x + item.width) - (item.shape.x0 + padRight);
          console.log(`[Shape] right-aligned text in shape x=${item.shape.x0.toFixed(1)}-${item.shape.x1.toFixed(1)}, room ${shapeAvail.toFixed(1)}`);
          availableWidth = Math.min(availableWidth, shapeAvail);
        }
      } else {
        // Sliding line limit
        lineInfo = await getLineAndSlidingPieces(items, item, fallbackFont, adjustedSize);
        const editedStartX = item.hasBullet ? item.editableStartX : item.x;

        // Line limit = left edge of first right-aligned item on line minus one space width,
        // or page right text edge plus 2 points of wiggle room
        let lineLimit = 0;
        if (lineInfo.rightAlignedOnLine.length > 0) {
          lineLimit = lineInfo.rightAlignedOnLine[0].x - spaceWidth;
        } else {
          lineLimit = pageRightTextEdge + 2.0;
        }

        // The line limit becomes the left edge of the first column boundary minus one space width (if it is closer than the existing line limit).
        if (lineInfo.firstColumnBoundary) {
          // Stop at the next column's text, and also at this column's own right edge
          // (the widest text that ends before the next column, plus 2 points), so text
          // never runs into the gutter or past a drawn divider line.
          const bx = lineInfo.firstColumnBoundary.x;
          let leftColRight = Infinity;
          if (!lineInfo.boundaryIsShapeWall) {
            const leftColEdges = layoutItems.filter(it => it.x + it.width < bx - 0.5).map(it => it.x + it.width);
            if (leftColEdges.length > 0) leftColRight = Math.max(...leftColEdges) + 2.0;
          }
          const colLimit = Math.min(bx - spaceWidth, leftColRight);
          console.log(`[Column] boundary "${lineInfo.firstColumnBoundary.str}" at x=${bx.toFixed(1)}, column right edge ${leftColRight.toFixed(1)}, limit ${colLimit.toFixed(1)}`);
          if (colLimit < lineLimit) {
            lineLimit = colLimit;
          }
        }

        // A vertical divider line to the right of this text (covering its height) is a wall,
        // with 8pt of clearance so text never touches it.
        const dividerXs = (page.dividers || [])
          .filter(d => d.x > editedStartX + 1 && d.y0 <= item.y && d.y1 >= item.y + item.fontSize * 0.6)
          .map(d => d.x);
        if (dividerXs.length > 0) {
          const dividerLimit = Math.min(...dividerXs) - 8;
          console.log(`[Divider] vertical line at x=${Math.min(...dividerXs).toFixed(1)}, limit ${dividerLimit.toFixed(1)}`);
          if (dividerLimit < lineLimit) lineLimit = dividerLimit;
        }

        // Inside a pill, tag or shaded bar: text must stay inside it, keeping the same
        // padding on the right as it has on the left.
        if (item.shape) {
          const padLeft = Math.max(1, editedStartX - item.shape.x0);
          const shapeLimit = item.shape.x1 - padLeft;
          console.log(`[Shape] text in shape x=${item.shape.x0.toFixed(1)}-${item.shape.x1.toFixed(1)}, limit ${shapeLimit.toFixed(1)}`);
          if (shapeLimit < lineLimit) lineLimit = shapeLimit;
        }

        const sumGaps = lineInfo.gaps.reduce((acc, g) => acc + g, 0);
        const sumSlidingWidths = lineInfo.slidingPieces.reduce((acc, p) => acc + p.redrawWidth, 0);
        availableWidth = lineLimit - editedStartX - sumGaps - sumSlidingWidths;
      }

      const origTextWidth = item.hasBullet ? item.editableWidth : item.width;
      availableWidth = Math.max(availableWidth, origTextWidth);

      // Create editor input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.value = item.hasBullet ? item.editableText : item.str;
      input.style.left = `${item.box.left}px`;
      input.style.top = `${item.box.top}px`;
      input.style.width = `${item.box.width}px`;
      input.style.height = `${item.box.height}px`;
      input.style.fontSize = `${screenFontSize}px`;
      input.style.fontFamily = fontFamily;
      input.style.fontWeight = item.isBold ? 'bold' : 'normal';
      input.style.fontStyle = item.isItalic ? 'italic' : 'normal';
      input.style.color = `rgb(${item.textColor.r}, ${item.textColor.g}, ${item.textColor.b})`;
      input.style.backgroundColor = `rgb(${item.bgColor.r}, ${item.bgColor.g}, ${item.bgColor.b})`;

      // Create floating character counter
      const counterEl = document.createElement('div');
      counterEl.className = 'char-counter';
      counterEl.style.left = `${item.box.left}px`;
      counterEl.style.top = `${item.box.top + item.box.height + 4}px`;

      page.textLayer.appendChild(input);
      page.textLayer.appendChild(counterEl);
      input.focus();
      input.select();

      let isTooLong = false;

      function updateCounter(val) {
        // Width = the original text's true width plus however much wider or narrower the new text
        // measures, so the unchanged original always fits exactly (no measuring drift).
        const origText = item.hasBullet ? item.editableText : item.str;
        const origMeasured = spacedWidth(fallbackFont, origText, adjustedSize, letterSpacing);
        const newMeasured = val.length > 0 ? spacedWidth(fallbackFont, val, adjustedSize, letterSpacing) : 0;
        const textW = val.length > 0 ? Math.max(0, origTextWidth + (newMeasured - origMeasured)) : 0;
        const remaining = availableWidth - textW;
        const avgCharW = (val.length > 0) ? (textW / val.length) : fallbackFont.widthOfTextAtSize('a', adjustedSize);
        const charsLeft = Math.max(0, Math.floor(remaining / (avgCharW || 1)));
        // Allow 0.75pt of overflow: covers rounding and swaps like "7" to "8" that are a hair wider,
        // and is invisible next to normal spacing and padding.
        isTooLong = remaining < -0.75;

        // Auto-expand input width so text does not horizontally scroll or clip while typing
        const currentPxW = textW * page.viewport.scale;
        input.style.width = `${Math.max(item.box.width, currentPxW + 4)}px`;

        if (isTooLong) {
          counterEl.textContent = 'Too long for this spot';
          counterEl.classList.add('counter-too-long');
          input.classList.add('input-too-long');
        } else {
          counterEl.textContent = `${charsLeft} character${charsLeft === 1 ? '' : 's'} left`;
          counterEl.classList.remove('counter-too-long');
          input.classList.remove('input-too-long');
        }
      }

      updateCounter(input.value);
      input.addEventListener('input', () => updateCounter(input.value));

      let finished = false;

      async function commit() {
        if (finished) return;

        if (isTooLong) {
          setStatus('Too long for this spot. Shorten it to fit.', true);
          return;
        }

        finished = true;
        const val = input.value;
        cleanup();

        const originalCompare = item.hasBullet ? item.editableText : item.str;
        if (val === originalCompare) {
          return;
        }

        try {
          setStatus('Applying edit...');

          const oldPageItems = items.map(it => ({
            str: it.str,
            x: it.x,
            y: it.y,
            width: it.width
          }));

          const editPayload = {
            pageNum: page.pageNum,
            item,
            newText: val,
            slidingPieces: lineInfo ? lineInfo.slidingPieces : [],
            gaps: lineInfo ? lineInfo.gaps : []
          };

          const newBytesResult = await applyEdit(editPayload);

          if (!newBytesResult) {
            setStatus("This text can't be edited cleanly in this PDF.", true);
            console.warn('Could not apply edit: text removal failed.');
            return;
          }

          const { bytes: newBytes, expectedPositions, changedAreas } = newBytesResult;

          const isValid = await verifyEdit(
            newBytes,
            page.pageNum,
            item,
            val,
            editPayload.slidingPieces,
            expectedPositions,
            oldPageItems
          );
          if (!isValid) {
            setStatus("This text can't be edited cleanly in this PDF.", true);
            return;
          }

          // Picture check: nothing outside the edited line may look different
          setStatus('Checking edit...');
          const newDoc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
          let looksClean = false;
          try {
            looksClean = await visualCheck(state.pdfJsDoc, newDoc, page.pageNum, changedAreas || []);
          } finally {
            newDoc.destroy();
          }
          if (!looksClean) {
            setStatus("This text can't be edited cleanly in this PDF.", true);
            return;
          }

          state.undoStack.push(state.currentBytes.slice());
          if (undoBtn) undoBtn.disabled = false;
          state.currentBytes = newBytes.slice();
          await refreshFromCurrentBytes();
          setStatus('Text updated.');
        } catch (err) {
          console.error(err);
          setStatus("This text can't be edited cleanly in this PDF.", true);
        }
      }

      function cancel() {
        if (finished) return;
        finished = true;
        cleanup();
      }

      function cleanup() {
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('keydown', onKeyDown);
        if (counterEl.parentNode) counterEl.parentNode.removeChild(counterEl);
        if (input.parentNode) input.parentNode.removeChild(input);
        boxEl.style.display = '';
      }

      function onKeyDown(evt) {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          commit();
        } else if (evt.key === 'Escape') {
          evt.preventDefault();
          cancel();
        }
      }

      function onBlur() {
        if (isTooLong) {
          setStatus('Too long for this spot. Shorten it to fit.', true);
          cancel();
        } else {
          commit();
        }
      }

      input.addEventListener('keydown', onKeyDown);
      input.addEventListener('blur', onBlur);
    });

    page.textLayer.appendChild(boxEl);
  }
}

// Selects text-showing commands on the line that draw pieces to remove (Rule 1: Direct match, Rule 2: Preceding/Encompassing match).
function selectTextCommandsToRemove(baselineCommands, piecesToRemove, editedItem) {
  const selected = [];
  const selectedIndices = new Set();
  const matchedPieces = new Set();

  // Rule 1: Direct match — command starts inside piece bounds [minX, maxX]
  for (const p of piecesToRemove) {
    const isEdited = (p === editedItem);
    const pStartX = (isEdited && p.hasBullet) ? p.x : p.x;
    const pEndX = p.x + p.width;
    const minX = pStartX - 0.5;
    const maxX = pEndX + 0.5;

    for (let i = 0; i < baselineCommands.length; i++) {
      const cmd = baselineCommands[i];
      if (cmd.posX >= minX && cmd.posX <= maxX) {
        if (!selectedIndices.has(i)) {
          selectedIndices.add(i);
          selected.push({ ...cmd, rule: 'Rule 1 (Direct match)' });
        }
        matchedPieces.add(p);
      }
    }
  }

  // Rule 2: Preceding / Encompassing match — for any piece with no direct command, find the closest preceding command on the line
  for (const p of piecesToRemove) {
    if (matchedPieces.has(p)) continue;
    let closestIdx = -1;
    let maxPosX = -Infinity;
    for (let i = 0; i < baselineCommands.length; i++) {
      const cmd = baselineCommands[i];
      if (cmd.posX < p.x - 0.5 && cmd.posX > maxPosX) {
        maxPosX = cmd.posX;
        closestIdx = i;
      }
    }
    if (closestIdx !== -1) {
      if (!selectedIndices.has(closestIdx)) {
        selectedIndices.add(closestIdx);
        selected.push({ ...baselineCommands[closestIdx], rule: 'Rule 2 (Preceding/Encompassing match)' });
      }
      matchedPieces.add(p);
    }
  }

  return selected;
}

// Identifies items on the line drawn by selected commands that are outside the edit (collateral items to be redrawn).
function findCollateralItems(baselineCommands, selectedCommands, pageLineItems, piecesToRemove) {
  const selectedCmdSet = new Set(selectedCommands.map(c => c.op));
  const sortedCmds = [...baselineCommands].sort((a, b) => a.posX - b.posX);
  const collateral = [];
  const seenItems = new Set();

  for (let i = 0; i < sortedCmds.length; i++) {
    const cmd = sortedCmds[i];
    if (!selectedCmdSet.has(cmd.op)) continue;

    const cmdMinX = cmd.posX - 0.5;
    const cmdMaxX = (i + 1 < sortedCmds.length) ? (sortedCmds[i + 1].posX - 0.5) : Infinity;

    for (const item of pageLineItems) {
      if (item.x >= cmdMinX && item.x < cmdMaxX) {
        const isPieceToRemove = piecesToRemove.some(p =>
          Math.abs(p.x - item.x) <= 0.5 &&
          Math.abs(p.y - item.y) <= 0.5 &&
          p.str === item.str
        );
        if (!isPieceToRemove) {
          const key = `${item.x.toFixed(2)}_${item.y.toFixed(2)}_${item.str}`;
          if (!seenItems.has(key)) {
            seenItems.add(key);
            collateral.push(item);
          }
        }
      }
    }
  }

  return collateral;
}

// Converts an RGB color object (0-255 channels) to a pdf-lib color, unchanged.
function toPdfColor(colorObj) {
  const c = colorObj || { r: 0, g: 0, b: 0 };
  const clamp = v => Math.max(0, Math.min(1, v / 255));
  return PDFLib.rgb(clamp(c.r), clamp(c.g), clamp(c.b));
}

// Converts fill color operator operands (0-1 values) to an RGB object (0-255), or null if unknown.
// 1 value = gray, 3 = RGB, 4 = CMYK. Any name operand (pattern) = unknown.
function fillOperandsToRgb(operands) {
  if (operands.some(o => o.type !== 'number')) return null;
  const v = operands.map(o => o.value);
  if (v.length === 1) {
    return { r: v[0] * 255, g: v[0] * 255, b: v[0] * 255 };
  }
  if (v.length === 3) {
    return { r: v[0] * 255, g: v[1] * 255, b: v[2] * 255 };
  }
  if (v.length === 4) {
    const [c, m, y, k] = v;
    return { r: 255 * (1 - c) * (1 - k), g: 255 * (1 - m) * (1 - k), b: 255 * (1 - y) * (1 - k) };
  }
  return null;
}

// Picks the color to draw an item with: the real fill color of the command that drew it
// (the command on that baseline with the largest start x at or before the item's x), or the sampled color.
function colorForItem(item, baselineCommands, label) {
  let best = null;
  for (const cmd of baselineCommands) {
    if (Math.abs(cmd.posY - item.y) > 0.5) continue;
    if (cmd.posX <= item.x + 0.5 && (!best || cmd.posX > best.posX)) best = cmd;
  }
  if (best && best.fill) {
    const c = best.fill;
    console.log(`[Color] "${label}" source: stream, rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`);
    return c;
  }
  const s = item.textColor || { r: 0, g: 0, b: 0 };
  console.log(`[Color] "${label}" source: sampled, rgb(${s.r}, ${s.g}, ${s.b})`);
  return s;
}

// Removes text-showing commands for edited and sliding pieces in one pass,
// draws newText and shifts sliding pieces with original styles and gaps.
async function applyEdit(edit) {
  const pdfDoc = await PDFLib.PDFDocument.load(state.currentBytes);
  pdfDoc.registerFontkit(fontkit);

  const pages = pdfDoc.getPages();
  const page = pages[edit.pageNum - 1];
  if (!page) {
    console.warn('Page not found:', edit.pageNum);
    return null;
  }

  const contents = page.node.Contents();
  let streamObjects = [];
  if (contents) {
    if (contents.asArray) {
      const arr = contents.asArray();
      for (let i = 0; i < arr.length; i++) {
        const s = pdfDoc.context.lookup(arr[i]);
        if (s) streamObjects.push(s);
      }
    } else {
      const s = pdfDoc.context.lookup(contents);
      if (s) streamObjects.push(s);
    }
  }

  const decodedPieces = streamObjects.map(s => {
    const rawBytes = PDFLib.decodePDFRawStream(s).decode();
    return bytesToBinaryString(rawBytes);
  });
  const combinedContent = decodedPieces.join('\n');

  const ops = tokenizePDFStream(combinedContent);
  const gStateStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let Tm = [1, 0, 0, 1, 0, 0];
  let Tlm = [1, 0, 0, 1, 0, 0];
  let currentLeading = 0;
  let fill = { r: 0, g: 0, b: 0 }; // Current fill color (text color); null = unknown

  const baselineCommands = [];

  for (const op of ops) {
    const name = op.operator;
    if (name === 'q') {
      gStateStack.push({ ctm: [...ctm], currentLeading, fill });
    } else if (name === 'Q') {
      if (gStateStack.length > 0) {
        const s = gStateStack.pop();
        ctm = s.ctm;
        currentLeading = s.currentLeading;
        fill = s.fill;
      }
    } else if (name === 'g' || name === 'rg' || name === 'k' || name === 'sc' || name === 'scn') {
      // Fill color operators
      fill = fillOperandsToRgb(op.operands);
    } else if (name === 'cs') {
      // Setting a fill color space resets the fill color (black), except for patterns
      const csName = op.operands[0] ? op.operands[0].value : '';
      fill = csName === '/Pattern' ? null : { r: 0, g: 0, b: 0 };
    } else if (name === 'cm') {
      const vals = op.operands.map(o => o.value);
      ctm = multiplyMatrices(vals, ctm);
    } else if (name === 'BT') {
      Tm = [1, 0, 0, 1, 0, 0];
      Tlm = [1, 0, 0, 1, 0, 0];
    } else if (name === 'ET') {
      // End text
    } else if (name === 'TL') {
      currentLeading = typeof op.operands[0]?.value === 'number' ? op.operands[0].value : currentLeading;
    } else if (name === 'Tm') {
      const vals = op.operands.map(o => o.value);
      Tm = [vals[0], vals[1], vals[2], vals[3], vals[4], vals[5]];
      Tlm = [...Tm];
    } else if (name === 'Td') {
      const tx = op.operands[0]?.value || 0;
      const ty = op.operands[1]?.value || 0;
      Tlm = multiplyMatrices([1, 0, 0, 1, tx, ty], Tlm);
      Tm = [...Tlm];
    } else if (name === 'TD') {
      const tx = op.operands[0]?.value || 0;
      const ty = op.operands[1]?.value || 0;
      currentLeading = -ty;
      Tlm = multiplyMatrices([1, 0, 0, 1, tx, ty], Tlm);
      Tm = [...Tlm];
    } else if (name === 'T*') {
      Tlm = multiplyMatrices([1, 0, 0, 1, 0, -currentLeading], Tlm);
      Tm = [...Tlm];
    } else if (name === 'Tj' || name === 'TJ' || name === "'" || name === '"') {
      if (name === "'" || name === '"') {
        Tlm = multiplyMatrices([1, 0, 0, 1, 0, -currentLeading], Tlm);
        Tm = [...Tlm];
      }
      const trm = multiplyMatrices(Tm, ctm);
      const posX = trm[4];
      const posY = trm[5];

      if (Math.abs(posY - edit.item.y) <= 0.5) {
        baselineCommands.push({ op, posX, posY, fill });
      }
    }
  }

  // Pieces to remove: edited item + all sliding pieces
  const piecesToRemove = [edit.item, ...(edit.slidingPieces || [])];
  const selectedCommands = selectTextCommandsToRemove(baselineCommands, piecesToRemove, edit.item);

  if (selectedCommands.length === 0) {
    console.warn('Could not find matching text-showing operator for item', edit.item);
    return null;
  }

  // Log selected commands with start x and selected rule
  for (const cmd of selectedCommands) {
    console.log(`[Selected command] startX: ${cmd.posX.toFixed(2)}, rule: ${cmd.rule}`);
  }

  // Check if removed command covers bullet prefix for hasBullet items
  let removedBulletCommand = false;
  if (edit.item.hasBullet) {
    removedBulletCommand = selectedCommands.some(c => c.posX < edit.item.editableStartX - 0.5);
  }

  // Identify and log collateral items drawn by selected commands outside the edit
  const pageItems = state.pages[edit.pageNum - 1]?.items || [];
  const pageLineItems = pageItems.filter(it => Math.abs(it.y - edit.item.y) <= 0.5);
  const collateralItems = findCollateralItems(baselineCommands, selectedCommands, pageLineItems, piecesToRemove);

  if (collateralItems.length > 0) {
    console.log('[Redrawn collateral items]', collateralItems.map(c => `"${c.str}" at x=${c.x.toFixed(2)}`).join(', '));
  } else {
    console.log('[Redrawn collateral items] None');
  }

  // Deduplicate and delete matched commands in one pass, sorted by byte position descending
  const uniqueReplacements = [];
  const seenStarts = new Set();
  for (const c of selectedCommands) {
    if (!seenStarts.has(c.op.start)) {
      seenStarts.add(c.op.start);
      uniqueReplacements.push({ start: c.op.start, end: c.op.end, rep: '' });
    }
  }
  uniqueReplacements.sort((a, b) => b.start - a.start);

  let newContent = combinedContent;
  for (const r of uniqueReplacements) {
    newContent = newContent.slice(0, r.start) + r.rep + newContent.slice(r.end);
  }

  const newStream = pdfDoc.context.flateStream(newContent);
  const newRef = pdfDoc.context.register(newStream);
  page.node.set(PDFLib.PDFName.of('Contents'), newRef);

  // Embeds each font once for this edit. Uses the matched font when it has every character in the text,
  // otherwise the standard fallback font. Returns null if neither can draw the text.
  const docFontCache = new Map();
  async function fontFor(key, text, label) {
    const keys = key.startsWith('custom:') ? [key, key.split('|')[1]] : [key];
    for (const k of keys) {
      if (!docFontCache.has(k)) docFontCache.set(k, await embedFontByKey(pdfDoc, k));
      const f = docFontCache.get(k);
      if (fontCanDraw(f, text)) {
        console.log(`[Font] "${label}" drawn with ${f.matchedFile || k}`);
        return { font: f, key: k };
      }
    }
    console.warn('[Font] No font can draw this text, refusing edit:', text);
    return null;
  }

  // Areas of the page this edit is allowed to change (old and new positions of everything removed or
  // drawn). The picture check refuses the edit if anything outside these areas looks different.
  const changedAreas = [];

  // Redraw collateral items drawn by removed commands outside the edit
  for (const cItem of collateralItems) {
    const cPicked = await fontFor(getFontKey(cItem), cItem.str, cItem.str);
    if (!cPicked) return null;
    const cFont = cPicked.font;
    const cAdjustedSize = computeAdjustedFontSize(cItem, cFont, cPicked.key);

    const cSpacing = letterSpacingFor(cItem, cFont, cItem.str, cItem.width);

    const cColor = colorForItem(cItem, baselineCommands, cItem.str);
    drawSpacedText(page, cItem.str, {
      x: cItem.x,
      y: cItem.y,
      size: cAdjustedSize,
      font: cFont,
      color: toPdfColor(cColor)
    }, cSpacing);
    changedAreas.push({
      x0: cItem.x,
      x1: cItem.x + Math.max(cItem.width, spacedWidth(cFont, cItem.str, cAdjustedSize, cSpacing)),
      y: cItem.y,
      fs: Math.max(cItem.fontSize, cAdjustedSize)
    });
  }

  // Note: We keep willDrawBullet for items where edit.item.hasBullet is true because pdf.js did not
  // split the bullet into a separate item in page items, so the bullet prefix exists only in edit.item.bulletPrefix.
  const willDrawBullet = edit.item.hasBullet && removedBulletCommand;

  // Embed the matched (or fallback) font for the edited piece. It must be able to draw the new text,
  // the original text (used for size matching) and the bullet prefix if redrawn.
  const editedCheckText = (willDrawBullet ? (edit.item.bulletPrefix || '') : '') + edit.newText + edit.item.str;
  const editedPicked = await fontFor(getFontKey(edit.item), editedCheckText, edit.newText);
  if (!editedPicked) return null;
  const font = editedPicked.font;
  const standardFontName = editedPicked.key;
  // The bullet (if any) is drawn on its own, so size and spacing are matched on the text alone
  const originalText = edit.item.hasBullet ? edit.item.editableText : edit.item.str;
  const originalWidth = edit.item.hasBullet ? edit.item.editableWidth : edit.item.width;
  const measuredOriginalWidth = font.widthOfTextAtSize(originalText || ' ', edit.item.fontSize);
  let ratio = measuredOriginalWidth > 0 ? (originalWidth / measuredOriginalWidth) : 1.0;
  ratio = Math.max(0.75, Math.min(1.4, ratio));
  if (font.matchedFile) ratio = 1.0; // Matched font: keep original size, reproduce width with letter-spacing
  const adjustedSize = edit.item.fontSize * ratio;
  const editedSpacing = letterSpacingFor(edit.item, font, originalText, originalWidth);
  console.log(`[Fix applyEdit] "${originalText}" -> "${edit.newText}" | font: ${standardFontName}, original size: ${edit.item.fontSize.toFixed(2)}, adjusted size: ${adjustedSize.toFixed(2)}, ratio: ${ratio.toFixed(3)}`);

  let textToDraw = edit.newText;
  let drawX = edit.item.hasBullet ? edit.item.editableStartX : edit.item.x;

  // When the bullet was part of the removed command, redraw the bullet glyph at its own original x
  // and the new text at its original start, so the gap between them stays exactly as it was.
  let bulletDrawnAt = null;
  if (willDrawBullet) {
    const bulletGlyph = (edit.item.bulletPrefix || '').trim();
    if (bulletGlyph) {
      drawSpacedText(page, bulletGlyph, {
        x: edit.item.x,
        y: edit.item.y,
        size: adjustedSize,
        font: font,
        color: toPdfColor(colorForItem(edit.item, baselineCommands, bulletGlyph))
      }, 0);
      bulletDrawnAt = edit.item.x;
    }
    textToDraw = edit.newText;
    drawX = edit.item.editableStartX;
  }

  if (edit.item.isRightAligned) {
    const newTextWidth = spacedWidth(font, textToDraw, adjustedSize, editedSpacing);
    drawX = (edit.item.x + edit.item.width) - newTextWidth;
  }

  drawSpacedText(page, textToDraw, {
    x: drawX,
    y: edit.item.y,
    size: adjustedSize,
    font: font,
    color: toPdfColor(colorForItem(edit.item, baselineCommands, edit.newText))
  }, editedSpacing);

  const editedWidthDrawn = spacedWidth(font, textToDraw, adjustedSize, editedSpacing);
  let currRightX = drawX + editedWidthDrawn;
  const editedFs = Math.max(edit.item.fontSize, adjustedSize);
  const inkChars = s => s.replace(/\s/g, '').length;
  changedAreas.push({ x0: edit.item.x, x1: edit.item.x + edit.item.width, y: edit.item.y, fs: editedFs,
    pair: 'edited', role: 'old', chars: inkChars(edit.item.str) });
  changedAreas.push({ x0: bulletDrawnAt !== null ? bulletDrawnAt : drawX, x1: drawX + editedWidthDrawn, y: edit.item.y, fs: editedFs,
    pair: 'edited', role: 'new', chars: inkChars(textToDraw) + (bulletDrawnAt !== null ? 1 : 0) });

  // Draw each sliding piece at its shifted position
  const expectedPositions = [];
  const slidingPieces = edit.slidingPieces || [];
  for (let i = 0; i < slidingPieces.length; i++) {
    const piece = slidingPieces[i];
    const gap = edit.gaps[i] !== undefined ? edit.gaps[i] : 0;
    const pieceDrawX = currRightX + gap;

    const pPicked = await fontFor(piece.standardFontName || getFontKey(piece), piece.str, piece.str);
    if (!pPicked) return null;
    const pFont = pPicked.font;
    const pAdjustedSize = computeAdjustedFontSize(piece, pFont, pPicked.key);
    const pSpacing = letterSpacingFor(piece, pFont, piece.str, piece.width);

    drawSpacedText(page, piece.str, {
      x: pieceDrawX,
      y: piece.y,
      size: pAdjustedSize,
      font: pFont,
      color: toPdfColor(colorForItem(piece, baselineCommands, piece.str))
    }, pSpacing);

    const pWidthDrawn = spacedWidth(pFont, piece.str, pAdjustedSize, pSpacing);
    expectedPositions.push({
      str: piece.str,
      x: pieceDrawX,
      y: piece.y,
      width: pWidthDrawn
    });
    currRightX = pieceDrawX + pWidthDrawn;
    const pFs = Math.max(piece.fontSize, pAdjustedSize);
    const pChars = piece.str.replace(/\s/g, '').length;
    changedAreas.push({ x0: piece.x, x1: piece.x + piece.width, y: piece.y, fs: pFs, pair: 'slide' + i, role: 'old', chars: pChars });
    changedAreas.push({ x0: pieceDrawX, x1: pieceDrawX + pWidthDrawn, y: piece.y, fs: pFs, pair: 'slide' + i, role: 'new', chars: pChars });
  }

  const savedBytes = await pdfDoc.save();
  return {
    bytes: savedBytes,
    expectedPositions,
    changedAreas
  };
}

// Renders one page of a pdf.js document to an offscreen canvas and returns its pixels and viewport.
async function renderPageForCheck(pdfDoc, pageNum, scale) {
  const pdfPage = await pdfDoc.getPage(pageNum);
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height, viewport };
}

// Picture check: draws the page before and after the edit and compares them pixel by pixel.
// Pixels inside the changed areas (the edited line's old and new text) are ignored. If anything
// else on the page looks different, returns false so the edit is refused.
async function visualCheck(oldDoc, newDoc, pageNum, changedAreas) {
  const SCALE = 1.5;
  const before = await renderPageForCheck(oldDoc, pageNum, SCALE);
  const after = await renderPageForCheck(newDoc, pageNum, SCALE);
  if (before.width !== after.width || before.height !== after.height) {
    console.warn('[Picture check] Page size changed');
    return false;
  }

  // Convert each allowed area (PDF units) into a pixel rectangle, with a small margin.
  const margin = 1.5;
  const rects = changedAreas.map(a => {
    const p1 = before.viewport.convertToViewportPoint(a.x0 - margin, a.y - a.fs * 0.4 - margin);
    const p2 = before.viewport.convertToViewportPoint(a.x1 + margin, a.y + a.fs * 1.1 + margin);
    return {
      l: Math.floor(Math.min(p1[0], p2[0])), r: Math.ceil(Math.max(p1[0], p2[0])),
      t: Math.floor(Math.min(p1[1], p2[1])), b: Math.ceil(Math.max(p1[1], p2[1]))
    };
  });
  const allowed = (x, y) => rects.some(r => x >= r.l && x <= r.r && y >= r.t && y <= r.b);

  let changed = 0;
  let box = null;
  const w = before.width;
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(
        Math.abs(before.data[i] - after.data[i]),
        Math.abs(before.data[i + 1] - after.data[i + 1]),
        Math.abs(before.data[i + 2] - after.data[i + 2])
      );
      if (d <= 40 || allowed(x, y)) continue;
      changed++;
      if (!box) box = { l: x, r: x, t: y, b: y };
      else { box.l = Math.min(box.l, x); box.r = Math.max(box.r, x); box.t = Math.min(box.t, y); box.b = Math.max(box.b, y); }
    }
  }

  // A handful of stray anti-aliasing pixels is allowed; anything more means something else changed.
  if (changed > 6) {
    console.warn(`[Picture check] ${changed} pixels changed outside the edited line, around x=${box.l}-${box.r}, y=${box.t}-${box.b} (screen pixels at ${SCALE}x). Refusing edit.`);
    return false;
  }

  // Ink check: the redrawn text must actually be visible. Compares ink per character in the old
  // text (before image) with the new text (after image). Catches fonts that draw blank letters,
  // which the text check can't see because the letters still read correctly behind the scenes.
  const rectOf = a => rects[changedAreas.indexOf(a)];
  const pairs = {};
  for (const a of changedAreas) {
    if (!a.pair) continue;
    (pairs[a.pair] = pairs[a.pair] || {})[a.role] = a;
  }
  for (const [name, p] of Object.entries(pairs)) {
    if (!p.old || !p.new || !p.old.chars || !p.new.chars) continue;
    const inkBefore = countInk(before, rectOf(p.old));
    const inkAfter = countInk(after, rectOf(p.new));
    const perCharBefore = inkBefore / p.old.chars;
    const perCharAfter = inkAfter / p.new.chars;
    if (perCharBefore > 0 && perCharAfter < perCharBefore * 0.5) {
      console.warn(`[Ink check] "${name}" text looks faded or missing (${perCharAfter.toFixed(1)} ink pixels per letter, was ${perCharBefore.toFixed(1)}). Refusing edit.`);
      return false;
    }
  }

  console.log(`[Picture check] passed (${changed} stray pixels outside the edited line)`);
  return true;
}

// Counts "ink" pixels in a rectangle: pixels clearly different from the rectangle's most common
// color (its background, which may be white or a shaded box).
function countInk(img, r) {
  const counts = new Map();
  const l = Math.max(0, r.l), t = Math.max(0, r.t);
  const rr = Math.min(img.width - 1, r.r), b = Math.min(img.height - 1, r.b);
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= rr; x++) {
      const i = (y * img.width + x) * 4;
      const key = ((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let bgKey = 0, best = -1;
  for (const [k, c] of counts) if (c > best) { best = c; bgKey = k; }
  const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8];
  let ink = 0;
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= rr; x++) {
      const i = (y * img.width + x) * 4;
      const d = Math.max(Math.abs(img.data[i] - bg[0]), Math.abs(img.data[i + 1] - bg[1]), Math.abs(img.data[i + 2] - bg[2]));
      if (d > 60) ink++;
    }
  }
  return ink;
}

// Verifies that the new PDF placed the new text, shifted sliding pieces, preserved other text, and has no overlaps.
async function verifyEdit(newBytes, pageNum, editedItem, newText, slidingPieces, expectedPositions, oldPageItems) {
  try {
    const checkDoc = await pdfjsLib.getDocument({ data: newBytes.slice() }).promise;
    const checkPage = await checkDoc.getPage(pageNum);
    const checkContent = await checkPage.getTextContent();
    const checkItems = checkContent.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0
      }));

    const allowedNewItemIndices = new Set();
    let newTextFound = false;

    if (editedItem.hasBullet) {
      const expectedCombined = editedItem.bulletPrefix + newText;
      const combinedIdx = checkItems.findIndex(it =>
        Math.abs(it.x - editedItem.x) <= 1.5 &&
        Math.abs(it.y - editedItem.y) <= 0.5 &&
        (it.str === expectedCombined || it.str === expectedCombined.trim() || it.str.includes(newText.trim()))
      );

      if (combinedIdx !== -1) {
        newTextFound = true;
        allowedNewItemIndices.add(combinedIdx);
      } else {
        const bulletIdx = checkItems.findIndex(it =>
          Math.abs(it.x - editedItem.x) <= 1.5 &&
          Math.abs(it.y - editedItem.y) <= 0.5 &&
          (it.str.trim() === editedItem.bulletPrefix.trim() || it.str.trim() === '•' || it.str.trim() === '-')
        );
        const textIdx = checkItems.findIndex(it =>
          Math.abs(it.x - editedItem.editableStartX) <= 1.5 &&
          Math.abs(it.y - editedItem.y) <= 0.5 &&
          (it.str === newText || it.str.trim() === newText.trim() || it.str.includes(newText.trim()))
        );
        if (bulletIdx !== -1 && textIdx !== -1) {
          newTextFound = true;
          allowedNewItemIndices.add(bulletIdx);
          allowedNewItemIndices.add(textIdx);
        }
      }
    } else {
      const targetY = editedItem.y;
      const idx = checkItems.findIndex(it =>
        Math.abs(it.y - targetY) <= 0.5 &&
        (it.str === newText || it.str.trim() === newText.trim() || it.str.includes(newText.trim())) &&
        (
          Math.abs(it.x - editedItem.x) <= 1.5 ||
          (editedItem.isRightAligned && Math.abs((it.x + it.width) - (editedItem.x + editedItem.width)) <= 1.5)
        )
      );
      if (idx !== -1) {
        newTextFound = true;
        allowedNewItemIndices.add(idx);
      }
    }

    if (!newTextFound) {
      console.warn('Self-check failed: New text is not present at the edited position', newText);
      return false;
    }

    // Verify each sliding piece's original text at its new position (within 1 point) or as consecutive text in merged item
    const slidingList = slidingPieces || [];
    const expList = expectedPositions || [];
    for (let i = 0; i < slidingList.length; i++) {
      const exp = expList[i];
      if (!exp) continue;

      let found = false;
      for (let j = 0; j < checkItems.length; j++) {
        if (allowedNewItemIndices.has(j)) continue;
        const it = checkItems[j];
        if (Math.abs(it.y - exp.y) <= 0.5) {
          // Separate item at expected position
          if (Math.abs(it.x - exp.x) <= 1.5 && (it.str === exp.str || it.str.trim() === exp.str.trim())) {
            allowedNewItemIndices.add(j);
            found = true;
            break;
          }
          // Or merged item on the line containing the sliding text
          if (it.str.includes(exp.str.trim())) {
            allowedNewItemIndices.add(j);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        console.warn('Self-check failed: Sliding piece not found at expected position', exp);
        return false;
      }
    }

    // Safety check: No two text items on the line overlap
    const editedLineY = editedItem.y;
    const lineCheckItems = checkItems.filter(it => Math.abs(it.y - editedLineY) <= 0.5);
    for (let i = 0; i < lineCheckItems.length; i++) {
      for (let j = i + 1; j < lineCheckItems.length; j++) {
        const a = lineCheckItems[i];
        const b = lineCheckItems[j];
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (overlap > 0.5) {
          console.warn('Self-check failed: Text items on line overlap', a, b, overlap);
          return false;
        }
      }
    }

    // Every item from before the edit, except the edited item and sliding pieces, is still present and unchanged
    const movedItems = [editedItem, ...slidingList];
    for (const before of oldPageItems) {
      const wasMoved = movedItems.some(m =>
        Math.abs(before.x - m.x) <= 0.5 &&
        Math.abs(before.y - m.y) <= 0.5 &&
        before.str === m.str
      );
      if (wasMoved) continue;

      const match = checkItems.find(it =>
        Math.abs(it.x - before.x) <= 0.5 &&
        Math.abs(it.y - before.y) <= 0.5 &&
        (it.str === before.str || it.str.trim() === before.str.trim())
      );
      if (!match) {
        console.warn('Self-check failed: Item from before edit is missing or moved', before.str, before.x, before.y);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.warn('Self-check error during verification:', err);
    return false;
  }
}

// Restores previous bytes from the undo stack and refreshes display.
async function onUndo() {
  if (!state.undoStack || state.undoStack.length === 0) return;
  try {
    setStatus('Undoing...');
    const prevBytes = state.undoStack.pop();
    state.currentBytes = prevBytes.slice();
    if (undoBtn) undoBtn.disabled = state.undoStack.length === 0;
    await refreshFromCurrentBytes();
    setStatus('Undo applied.');
  } catch (err) {
    console.error(err);
    setStatus('Could not undo.', true);
  }
}

// Returns the current edited PDF bytes for saving.
async function savePdf() {
  return state.currentBytes;
}

// ---------- Download ----------
async function onDownload() {
  try {
    setStatus('Saving...');
    const bytes = await savePdf();
    downloadBytes(bytes, makeOutputName(state.fileName));
    setStatus('Downloaded.');
  } catch (err) {
    console.error(err);
    setStatus('Could not save the PDF.', true);
  }
}

function makeOutputName(name) {
  const base = name.replace(/\.pdf$/i, '');
  return `${base}-edited.pdf`;
}

// Downloads bytes as a file attachment, avoiding Firefox inline navigation (Fix 5).
function downloadBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
