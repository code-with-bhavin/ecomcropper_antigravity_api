const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const FLIPKART_LABEL_CROP = { x: 185, y: 455, width: 225, height: 365 };

/** Minimum extra height (pt) below the label when “Print text on label” is on; grows with line count. */
const FLIPKART_CUSTOM_TEXT_STRIP_MIN_PT = 14;

/** Gap (pt) between label bottom (c.y) and first line of custom text — smaller = text closer to label. */
const FLIPKART_TEXT_GAP_UNDER_LABEL_PT = 8;

/** Padding (pt) between lowest text descenders and bottom of the strip. */
const FLIPKART_TEXT_STRIP_BOTTOM_PAD_PT = 4;

/** Extra white height above the strip (into the label). Keep 0 so footer borders are not painted over. */
const FLIPKART_MASK_ABOVE_STRIP_PT = 0;

/** Leave this many pt at the top of the strip unpainted white so the footer box / rules stay visible. */
const FLIPKART_STRIP_WHITE_TOP_INSET_PT = 4;

const FLIPKART_SKU_NOISE = new Set([
    'STD', 'COD', 'HBD', 'CPD', 'SKU', 'QTY', 'ID', 'GSTIN', 'PAN', 'AWB', 'NO',
    'FOR', 'RESALE', 'NOT', 'PRINTED', 'ORDER', 'DESCRIPTION', 'SHIP', 'ADDRESS',
    'LOGISTICS', 'E-KART', 'EKART', 'SOLD', 'THROUGH', 'FLIPKART',
]);

function extractFlipkartOrderId(text) {
    const m = text.match(/\b(OD\d{10,})\b/);
    return m ? m[1] : '';
}

function extractFlipkartSku(text) {
    const re = /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9.]+)+(?:-[A-Z0-9]+)?)\b/g;
    let best = '';
    let m;
    while ((m = re.exec(text)) !== null) {
        const v = m[1];
        if (FLIPKART_SKU_NOISE.has(v) || v.length < 5) continue;
        if (v.length > best.length) best = v;
    }
    if (best) return best;
    const loose = text.match(/\b([A-Z][A-Z0-9_-]{6,})\b/g);
    if (!loose) return '';
    for (const token of loose) {
        if (FLIPKART_SKU_NOISE.has(token) || !/[0-9_-]/.test(token)) continue;
        if (token.length > best.length) best = token;
    }
    return best;
}

function compareFlipkartSortKeys(a, b, opts) {
    if (opts.orderNumber) {
        const c = compareNonEmptyStrings(a.orderId, b.orderId);
        if (c !== 0) return c;
    }
    if (opts.skuSorting) {
        const c = compareNonEmptyStrings(a.sku, b.sku);
        if (c !== 0) return c;
    }
    return a.seq - b.seq;
}

function compareNonEmptyStrings(ax, bx) {
    if (ax && bx) {
        return ax.localeCompare(bx, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (!ax && !bx) return 0;
    if (!ax) return 1;
    return -1;
}

async function getFlipkartPageSortMeta(buffer, getDocument) {
    const pdf = await getDocument({
        data: new Uint8Array(buffer),
        disableFontFace: true,
    }).promise;
    const rows = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const text = tc.items.map((item) => ('str' in item ? item.str : '')).join('\n');
        rows.push({
            pageIndex: i - 1,
            orderId: extractFlipkartOrderId(text),
            sku: extractFlipkartSku(text),
        });
    }
    return rows;
}

async function buildFlipkartPagePlan(buffers, options) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (options.orderNumber || options.skuSorting) {
        const entries = [];
        let seq = 0;
        for (let bi = 0; bi < buffers.length; bi++) {
            const metas = await getFlipkartPageSortMeta(buffers[bi], getDocument);
            for (const row of metas) {
                entries.push({
                    bufferIdx: bi,
                    pageIndex: row.pageIndex,
                    orderId: row.orderId,
                    sku: row.sku,
                    seq: seq++,
                });
            }
        }
        entries.sort((a, b) => compareFlipkartSortKeys(a, b, options));
        return entries.map(({ bufferIdx, pageIndex }) => ({ bufferIdx, pageIndex }));
    }
    const plan = [];
    for (let bi = 0; bi < buffers.length; bi++) {
        const pdf = await getDocument({
            data: new Uint8Array(buffers[bi]),
            disableFontFace: true,
        }).promise;
        for (let pi = 0; pi < pdf.numPages; pi++) {
            plan.push({ bufferIdx: bi, pageIndex: pi });
        }
    }
    return plan;
}

function wrapTextToWidth(text, font, fontSize, maxWidth) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
        const next = `${line} ${words[i]}`;
        if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
            line = next;
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    lines.push(line);
    return lines;
}

/**
 * Main entry point for processing PDF Buffer(s).
 * 
 * @param {Buffer | Buffer[]} pdfBuffers - The uploaded PDF file buffer(s).
 * @param {string} platform - The selected e-commerce platform.
 * @param {Object} options - Features selected by the user.
 * @returns {Promise<Uint8Array>} - The processed PDF bytes.
 */
async function processPdf(pdfBuffers, platform, options) {
    const outPdfDoc = await PDFDocument.create();
    const buffers = Array.isArray(pdfBuffers) ? pdfBuffers : [pdfBuffers];

    for (const buffer of buffers) {
        const pdfDoc = await PDFDocument.load(buffer);
        const pages = pdfDoc.getPages();
        const localFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const { width, height } = page.getSize();

            // If originalFile is checked, we generally don't apply the tight crop
            if (!options.originalFile && platform === 'Meesho') {
                const cropY = 471.31;
                page.setCropBox(0, cropY, 595, 370.69);

                // Mask out "TAX INVOICE" and "Original For Recipient"
                // We draw this covering the bottom ~30 units to handle variations in text placement
                page.drawRectangle({
                    x: 0,
                    y: cropY,
                    width: width,
                    height: 17, // Increased from 18 to 30 to cover shifted text
                    color: rgb(1, 1, 1),
                });
            }

            // Apply text if requested
            if (options.printText && options.customText && options.customText.trim() !== '') {
                const currentCropBox = page.getCropBox();
                const drawX = currentCropBox.x + 35;
                const drawY = currentCropBox.y + 5;

                page.drawText(options.customText, {
                    x: drawX,
                    y: drawY,
                    size: 11,
                    font: localFont,
                    color: rgb(0, 0, 0),
                });
            }
        }

        // Copy processed pages to the output document
        const copiedPages = await outPdfDoc.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach((p) => outPdfDoc.addPage(p));
    }

    const pdfBytes = await outPdfDoc.save();
    return pdfBytes;
}

async function processAmazonPdf(pdfBuffers, options) {
    const outPdfDoc = await PDFDocument.create();
    const buffers = Array.isArray(pdfBuffers) ? pdfBuffers : [pdfBuffers];

    const hasCustomText =
        options.printText &&
        options.customText &&
        options.customText.trim() !== '';

    for (const buffer of buffers) {
        const pdfDoc = await PDFDocument.load(buffer);

        // ✅ Copy ONLY first page
        const [copiedPage] = await outPdfDoc.copyPages(pdfDoc, [0]);

        const { width, height } = copiedPage.getSize();

        // ✅ CROP instead of masking
        const newHeight = height * 1.00; // adjust this (0.55 - 0.65 based on label)

        copiedPage.setMediaBox(0, height - newHeight, width, newHeight);
        copiedPage.setCropBox(0, height - newHeight, width, newHeight);

        // ✅ Embed font in output PDF
        let font = null;
        if (hasCustomText) {
            font = await outPdfDoc.embedFont(StandardFonts.Helvetica);
        }

        // ✅ Add custom text (adjust Y after crop)
        if (hasCustomText) {
            copiedPage.drawText(options.customText, {
                x: 35,
                y: 10,
                size: 11,
                font: font,
                color: rgb(0, 0, 0),
            });
        }

        outPdfDoc.addPage(copiedPage);
    }

    return await outPdfDoc.save();
}

async function processFlipkartPdf(pdfBuffers, options) {
    const outPdfDoc = await PDFDocument.create();
    const buffers = Array.isArray(pdfBuffers) ? pdfBuffers : [pdfBuffers];

    const hasCustomText =
        options.printText &&
        options.customText &&
        options.customText.trim() !== '';

    let font = null;
    if (hasCustomText) {
        font = await outPdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const c = FLIPKART_LABEL_CROP;
    const fontSize = 9;
    const lineHeight = fontSize * 1.25;
    const marginX = 8;

    const pagePlan = await buildFlipkartPagePlan(buffers, options);
    const pdfCache = new Map();
    async function getSourcePdf(bufferIdx) {
        if (!pdfCache.has(bufferIdx)) {
            pdfCache.set(bufferIdx, await PDFDocument.load(buffers[bufferIdx]));
        }
        return pdfCache.get(bufferIdx);
    }

    for (const { bufferIdx, pageIndex } of pagePlan) {
        const pdfDoc = await getSourcePdf(bufferIdx);
        const [copiedPage] = await outPdfDoc.copyPages(pdfDoc, [pageIndex]);

        let lines = [];
        let stripPt = 0;
        if (hasCustomText && font) {
            const maxW = Math.max(40, c.width - 2 * marginX);
            lines = wrapTextToWidth(options.customText, font, fontSize, maxW);
            const nLines = lines.length;
            const stripNeeded =
                FLIPKART_TEXT_GAP_UNDER_LABEL_PT +
                (nLines - 1) * lineHeight +
                FLIPKART_TEXT_STRIP_BOTTOM_PAD_PT;
            stripPt = Math.max(FLIPKART_CUSTOM_TEXT_STRIP_MIN_PT, stripNeeded);
        }

        if (!options.originalFile) {
            const bottom = c.y - stripPt;
            const cropH = c.height + stripPt;
            copiedPage.setCropBox(c.x, bottom, c.width, cropH);

            if (hasCustomText && stripPt > 0) {
                copiedPage.setMediaBox(c.x, bottom, c.width, cropH);
                const maskH = stripPt + FLIPKART_MASK_ABOVE_STRIP_PT;
                const whiteH = Math.max(0, maskH - FLIPKART_STRIP_WHITE_TOP_INSET_PT);
                copiedPage.drawRectangle({
                    x: c.x,
                    y: bottom,
                    width: c.width,
                    height: whiteH,
                    color: rgb(1, 1, 1),
                    opacity: 1,
                });

                const n = lines.length;
                const topBaseline = c.y - FLIPKART_TEXT_GAP_UNDER_LABEL_PT;
                const drawX = c.x + marginX;
                for (let j = 0; j < n; j++) {
                    const baselineY = topBaseline - j * lineHeight;
                    copiedPage.drawText(lines[j], {
                        x: drawX,
                        y: baselineY,
                        size: fontSize,
                        font,
                        color: rgb(0, 0, 0),
                    });
                }
            }
        } else if (hasCustomText && stripPt > 0) {
            const stripBottom = c.y - stripPt;
            const maskH = stripPt + FLIPKART_MASK_ABOVE_STRIP_PT;
            const whiteH = Math.max(0, maskH - FLIPKART_STRIP_WHITE_TOP_INSET_PT);
            copiedPage.drawRectangle({
                x: c.x,
                y: stripBottom,
                width: c.width,
                height: whiteH,
                color: rgb(1, 1, 1),
                opacity: 1,
            });
            const n = lines.length;
            const topBaseline = c.y - FLIPKART_TEXT_GAP_UNDER_LABEL_PT;
            const drawX = c.x + marginX;
            for (let j = 0; j < n; j++) {
                const baselineY = topBaseline - j * lineHeight;
                copiedPage.drawText(lines[j], {
                    x: drawX,
                    y: baselineY,
                    size: fontSize,
                    font,
                    color: rgb(0, 0, 0),
                });
            }
        }

        outPdfDoc.addPage(copiedPage);
    }

    return await outPdfDoc.save();
}

module.exports = {
    processPdf,
    processAmazonPdf,
    processFlipkartPdf
};
