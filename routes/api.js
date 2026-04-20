const express = require('express');
const multer = require('multer');
const { processPdf, processAmazonPdf, processFlipkartPdf } = require('../services/pdfProcessor');

const router = express.Router();

/**
 * Generates the output filename:
 * EcomCropper_<Platform>_DD_MM_YYYY.pdf
 */
function generateFilename(platform) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const name = `EcomCropper_${platform}_${dd}_${mm}_${yyyy}.pdf`;
    return name;
}

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});

router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API is running' });
});

// Separate handlers for independent platform updates
const handleMeeshoUpload = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const fileBuffers = req.files.map(f => f.buffer);
        const originalName = req.files[0].originalname;

        const options = {
            pickupSorting: req.body.pickupSorting === 'true',
            skuSorting: req.body.skuSorting === 'true',
            orderNumber: req.body.orderNumber === 'true',
            originalFile: req.body.originalFile === 'true',
            printText: req.body.printText === 'true',
            customText: req.body.customText || ''
        };

        const processedPdfBuffer = await processPdf(fileBuffers, 'Meesho', options);

        res.setHeader('Content-Type', 'application/pdf');
        const finalName = generateFilename('Meesho');
        res.setHeader('Content-Disposition', `attachment; filename="${finalName}"`);
        res.send(Buffer.from(processedPdfBuffer));
    } catch (error) {
        console.error('Error processing Meesho PDF:', error);
        res.status(500).json({ error: 'Failed to process Meesho PDF' });
    }
};

const handleAmazonUpload = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const fileBuffers = req.files.map(f => f.buffer);
        const originalName = req.files[0].originalname;

        const options = {
            pickupSorting: req.body.pickupSorting === 'true',
            skuSorting: req.body.skuSorting === 'true',
            orderNumber: req.body.orderNumber === 'true',
            originalFile: req.body.originalFile === 'true',
            printText: req.body.printText === 'true',
            customText: req.body.customText || '',
            amazonOption: req.body.amazonOption
        };

        const processedPdfBuffer = await processAmazonPdf(fileBuffers, options);

        res.setHeader('Content-Type', 'application/pdf');
        const finalName = generateFilename('Amazon');
        res.setHeader('Content-Disposition', `attachment; filename="${finalName}"`);
        res.send(Buffer.from(processedPdfBuffer));
    } catch (error) {
        console.error('Error processing Amazon PDF:', error);
        res.status(500).json({ error: 'Failed to process Amazon PDF' });
    }
};

const handleFlipkartUpload = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const fileBuffers = req.files.map(f => f.buffer);
        const originalName = req.files[0].originalname;

        const options = {
            pickupSorting: req.body.pickupSorting === 'true',
            skuSorting: req.body.skuSorting === 'true',
            orderNumber: req.body.orderNumber === 'true',
            originalFile: req.body.originalFile === 'true',
            printText: req.body.printText === 'true',
            customText: req.body.customText || ''
        };

        const processedPdfBuffer = await processFlipkartPdf(fileBuffers, options);

        res.setHeader('Content-Type', 'application/pdf');
        const finalName = generateFilename('Flipkart');
        res.setHeader('Content-Disposition', `attachment; filename="${finalName}"`);
        res.send(Buffer.from(processedPdfBuffer));
    } catch (error) {
        console.error('Error processing Flipkart PDF:', error);
        res.status(500).json({ error: 'Failed to process Flipkart PDF' });
    }
};

// Distinct platform endpoints
router.post('/meesho/process', upload.array('files', 10), handleMeeshoUpload);
router.post('/amazon/process', upload.array('files', 10), handleAmazonUpload);
router.post('/flipkart/process', upload.array('files', 10), handleFlipkartUpload);

module.exports = router;
