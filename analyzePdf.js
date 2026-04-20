const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function analyze() {
  const fileBytes = fs.readFileSync('d:/Products/ecomcropper/frontend/src/assets/MeeshoCrop_2026-04-17.pdf');
  const pdfDoc = await PDFDocument.load(fileBytes);
  const pages = pdfDoc.getPages();
  
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const cropBox = page.node.CropBox();
    const mediaBox = page.node.MediaBox();
    console.log(`Page ${i + 1}: Width: ${width}, Height: ${height}`);
    console.log(`CropBox:`, cropBox ? cropBox.toString() : 'None');
    console.log(`MediaBox:`, mediaBox ? mediaBox.toString() : 'None');
  });
}

analyze().catch(console.error);
