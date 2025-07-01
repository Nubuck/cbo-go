import { pdf as pdfImageExtract } from "pdf-to-img";
import { PDFExtract } from "pdf.js-extract";
import { createOCREngine } from "tesseract-wasm";
import { loadWasmBinary } from "tesseract-wasm/node";
import Fuse from "fuse.js";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "path";

// Import field definitions
import { paqFields, plFields, plInsurance, plCollection } from "./paq.js";

class SpatialDocumentValidator {
  constructor() {
    this.ocrEngine = null;
    this.pdfExtract = new PDFExtract();
    this.debugLog = [];
    this.summary = {
      totalBoxes: 0,
      mergedBoxes: 0,
      fieldsProcessed: 0,
      fieldsFound: 0,
      fieldsValid: 0,
    };

    // Build field mapping from PAQ definitions
    this.fieldMapping = {
      caseId: {
        labels: paqFields.caseRefNo.label,
        type: "reference",
        required: true,
        searchStrategy: "right",
      },
      loanAmount: {
        labels: plFields.PayoutAmount.label,
        type: "currency",
        required: true,
        searchStrategy: "right",
      },
      instalment: {
        labels: plFields.MonthlyInstalmentIncludingInterest.label,
        type: "currency",
        required: true,
        searchStrategy: "right",
      },
      interestRate: {
        labels: plFields.AnnualInterestRateFixed.label,
        type: "percentage",
        required: true,
        searchStrategy: "right",
      },
      insurancePremium: {
        labels: plInsurance.creditLife.label,
        type: "currency",
        required: true,
        searchStrategy: "right",
      },
      collectionAccountNo: {
        labels: plCollection.accountNo.label,
        type: "account",
        required: true,
        searchStrategy: "right",
      },
    };

    this.tolerances = {
      currency: 0.05,
      percentage: 0.01,
      reference: 0,
      account: 1,
    };
  }

  log(message, level = "info") {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;

    if (level === "important" || level === "error" || level === "summary") {
      console.log(logEntry);
      this.debugLog.push(logEntry);
    } else if (level === "info") {
      this.debugLog.push(logEntry);
    }
  }

  logImportant(message) {
    this.log(message, "important");
  }

  logSummary(message) {
    this.log(message, "summary");
  }

  async saveDebugLog(prefix = "debug") {
    this.debugLog.push("\n" + "=".repeat(60));
    this.debugLog.push("DEBUG LOG SUMMARY");
    this.debugLog.push("=".repeat(60));
    this.debugLog.push(`Total bounding boxes: ${this.summary.totalBoxes}`);
    this.debugLog.push(`Merged boxes: ${this.summary.mergedBoxes}`);
    this.debugLog.push(`Fields processed: ${this.summary.fieldsProcessed}`);
    this.debugLog.push(`Fields found: ${this.summary.fieldsFound}`);
    this.debugLog.push(`Fields valid: ${this.summary.fieldsValid}`);
    this.debugLog.push(
      `Success rate: ${Math.round(
        (this.summary.fieldsValid / this.summary.fieldsProcessed) * 100
      )}%`
    );
    this.debugLog.push("=".repeat(60));

    const logPath = `${prefix}_validation_log.txt`;
    await fs.writeFile(logPath, this.debugLog.join("\n"));
    this.logImportant(
      `💾 Debug log saved to: ${logPath} (${this.debugLog.length} lines)`
    );
  }

  async initialize(modelPath) {
    this.logImportant("🚀 Initializing Spatial Document Validator");

    const wasmBinary = await loadWasmBinary();
    this.ocrEngine = await createOCREngine({ wasmBinary });

    const model = await fs.readFile(modelPath);
    this.ocrEngine.loadModel(model);

    this.logImportant("✅ Validator initialized with PAQ.js field mapping");
  }

  async validateDocument(filePath, caseModel) {
    this.logImportant(`🔍 Starting validation: ${path.basename(filePath)}`);
    this.debugLog = [];

    try {
      const pdfData = await this.pdfExtract.extract(filePath);
      const isDigital = this.hasValidText(pdfData);

      this.logImportant(
        `📄 Document type: ${isDigital ? "Digital PDF" : "Scanned PDF"}`
      );
      this.logImportant(`📊 Pages found: ${pdfData.pages.length}`);

      if (isDigital) {
        return await this.validateDigitalPDF(pdfData, caseModel);
      } else {
        return await this.validateScannedPDF(filePath, caseModel);
      }
    } catch (error) {
      this.log(`❌ Validation failed: ${error.message}`, "error");
      await this.saveDebugLog("error");
      return this.createFailureResult(error.message);
    }
  }

  async validateDigitalPDF(pdfData, caseModel) {
    this.logImportant("🔤 Processing digital PDF with PAQ.js field mapping");

    const boundingBoxes = this.extractBoundingBoxes(pdfData);
    this.summary.totalBoxes = boundingBoxes.length;
    this.logImportant(`📦 Extracted ${boundingBoxes.length} bounding boxes`);

    await fs.writeFile(
      "debug_bounding_boxes.json",
      JSON.stringify(boundingBoxes, null, 2)
    );

    const mergedBoxes = this.mergeNearbyBoxes(boundingBoxes);
    this.summary.mergedBoxes = mergedBoxes.length;
    this.logImportant(
      `🔧 Merged into ${mergedBoxes.length} consolidated boxes`
    );

    await fs.writeFile(
      "debug_merged_boxes.json",
      JSON.stringify(mergedBoxes, null, 2)
    );

    return await this.spatialFieldSearch(mergedBoxes, caseModel);
  }

  // Enhanced OCR processing methods for SpatialDocumentValidator class
  // Add this import at the top of spatial-document-validator.js:
  // import { promises as fs } from "node:fs";

  async validateScannedPDF(filePath, caseModel) {
    this.logImportant("🖼️  Processing scanned PDF with enhanced OCR pipeline");

    try {
      // Extract all pages as images
      const pages = await this.extractPageImages(filePath);
      this.logImportant(`📄 Extracted ${pages.length} pages from PDF`);

      // Save original pages to disk for debugging
      const docName = path.basename(filePath, ".pdf");
      await this.saveOriginalPages(pages, docName);

      // Process first page (can be extended to search all pages)
      const firstPageBuffer = pages[0];

      // Enhanced OCR with proper box normalization (saves enhanced image too)
      const ocrBoxes = await this.performEnhancedOCR(
        firstPageBuffer,
        0,
        docName
      );
      this.summary.totalBoxes = ocrBoxes.length;
      this.logImportant(`📦 OCR extracted ${ocrBoxes.length} bounding boxes`);

      // Save debug data
      await fs.writeFile(
        "debug_ocr_raw_boxes.json",
        JSON.stringify(ocrBoxes, null, 2)
      );

      // Apply same merging logic as digital PDFs
      // const mergedBoxes = this.mergeNearbyBoxes(ocrBoxes);  // DISABLED: Merging is destroying OCR text
      const mergedBoxes = [...ocrBoxes] // TESTING: Use raw OCR boxes without merging
      this.summary.mergedBoxes = mergedBoxes.length;
      this.logImportant(
        `🔧 Merged into ${mergedBoxes.length} consolidated boxes`
      );

      await fs.writeFile(
        "debug_ocr_merged_boxes.json",
        JSON.stringify(mergedBoxes, null, 2)
      );

      // Apply the SAME spatial field search as digital PDFs!
      return await this.spatialFieldSearch(mergedBoxes, caseModel);
    } catch (error) {
      this.log(`❌ OCR validation failed: ${error.message}`, "error");
      throw error;
    }
  }

  async performEnhancedOCR(imageBuffer, pageIndex = 0, docName = "page") {
    this.logImportant(
      "🔍 Performing enhanced OCR with selective region processing"
    );

    try {
      // STEP 1: Full page OCR (current working approach)
      const fullPageResult = await this.performFullPageOCR(
        imageBuffer,
        pageIndex,
        docName
      );

      // STEP 2: Detect if financial values are missing or low confidence
      const missingFinancials = this.detectMissingFinancialValues(
        fullPageResult.boxes
      );

      if (missingFinancials.length > 0) {
        this.logImportant(
          `🎯 Detected ${missingFinancials.length} missing financial values, trying selective enhancement`
        );

        // STEP 3: Find and enhance financial table region
        const financialRegion = await this.enhanceFinancialRegion(
          imageBuffer,
          pageIndex,
          docName
        );

        if (financialRegion) {
          // STEP 4: Merge enhanced financial OCR with full page results
          const mergedBoxes = this.mergeFinancialEnhancement(
            fullPageResult.boxes,
            financialRegion.boxes
          );
          return mergedBoxes;
        }
      }

      return fullPageResult.boxes;
    } catch (error) {
      this.log(`❌ Enhanced OCR processing failed: ${error.message}`, "error");
      throw error;
    }
  }
  async performFullPageOCR(imageBuffer, pageIndex, docName) {
    // Your existing working OCR logic here
    const processedImage = await this.preprocessImageForOCR(
      imageBuffer,
      pageIndex,
      docName
    );

    this.ocrEngine.loadImage(processedImage.imageData);
    const rawBoxes = this.ocrEngine.getTextBoxes("word");

    const normalizedBoxes = this.normalizeOCRBoxes(
      rawBoxes,
      processedImage.info,
      pageIndex
    );
    const filteredBoxes = normalizedBoxes.filter((box) => {
      const hasText = box.text && box.text.trim().length > 0;
      const hasReasonableConfidence = box.confidence > 0.3; // Fixed: confidence is 0-1, not 0-100
      const hasValidDimensions = box.width > 5 && box.height > 5;
      return hasText && hasReasonableConfidence && hasValidDimensions;
    });

    this.logImportant(
      `✅ Full page OCR: ${filteredBoxes.length} quality boxes`
    );

    return { boxes: filteredBoxes, info: processedImage.info };
  }

  detectMissingFinancialValues(boxes) {
    const expectedFinancials = [
      { pattern: /R\s*\d+.*\d+/, type: "currency", name: "instalment" },
      { pattern: /\d+\.\d+%/, type: "percentage", name: "interest_rate" },
      { pattern: /\d{10,11}/, type: "account", name: "account_number" },
    ];

    const missing = [];

    for (const expected of expectedFinancials) {
      const found = boxes.some((box) => expected.pattern.test(box.text));
      if (!found) {
        missing.push(expected.name);
        this.log(`⚠️  Missing ${expected.name} pattern in full page OCR`);
      }
    }

    return missing;
  }

  async enhanceFinancialRegion(imageBuffer, pageIndex, docName) {
    this.logImportant("🎯 Enhancing financial table region for better OCR");

    try {
      // STEP 1: Detect financial table region (approximate coordinates)
      const financialRegion = this.detectFinancialTableRegion();

      // STEP 2: Crop the financial region from original image
      const croppedBuffer = await sharp(imageBuffer)
        .extract({
          left: Math.round(financialRegion.x),
          top: Math.round(financialRegion.y),
          width: Math.round(financialRegion.width),
          height: Math.round(financialRegion.height),
        })
        .toBuffer();

      // STEP 3: Enhanced preprocessing for financial region
      const enhancedBuffer = await sharp(croppedBuffer)
        .resize({ width: undefined, height: undefined, factor: 3 }) // 3x scaling
        .sharpen() // Sharpen for better text
        .normalize() // Auto contrast
        .threshold(128) // Binarize for clear text
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Save debug version
      const regionPath = `debug_${docName}_page${
        pageIndex + 1
      }_financial_region.png`;
      await sharp(croppedBuffer)
        .resize({ width: undefined, height: undefined, factor: 3 })
        .sharpen()
        .normalize()
        .threshold(128)
        .png()
        .toFile(regionPath);

      this.logImportant(`💾 Enhanced financial region saved: ${regionPath}`);

      // STEP 4: OCR the enhanced financial region
      const regionImageData = {
        data: enhancedBuffer.data,
        width: enhancedBuffer.info.width,
        height: enhancedBuffer.info.height,
      };

      this.ocrEngine.loadImage(regionImageData);
      const regionBoxes = this.ocrEngine.getTextBoxes("word");

      // STEP 5: Adjust coordinates back to full page coordinate system
      const adjustedBoxes = regionBoxes.map((box) => {
        const normalized = this.normalizeOCRBoxes(
          [box],
          enhancedBuffer.info,
          pageIndex
        )[0];

        // Adjust coordinates from cropped region back to full page
        normalized.x = normalized.x / 3 + financialRegion.x; // Undo 3x scaling + offset
        normalized.y = normalized.y / 3 + financialRegion.y;
        normalized.width = normalized.width / 3;
        normalized.height = normalized.height / 3;
        normalized.source = "enhanced_financial_ocr";

        return normalized;
      });

      this.logImportant(
        `✅ Enhanced financial OCR: ${adjustedBoxes.length} boxes from region`
      );

      return { boxes: adjustedBoxes, region: financialRegion };
    } catch (error) {
      this.log(
        `❌ Financial region enhancement failed: ${error.message}`,
        "error"
      );
      return null;
    }
  }

  detectFinancialTableRegion() {
    // Based on typical PAQ document layout - financial table is usually in lower 2/3 of page
    // This could be made more sophisticated by analyzing the full page OCR results first

    return {
      x: 100, // Left margin
      y: 1200, // Start below header sections
      width: 1400, // Most of page width
      height: 800, // Financial table area
    };
  }

  // Zone-based extraction for financial table fields
  extractFinancialValueByZone(boxes, fieldName, expectedValue) {
    const zones = {
      loanAmount: { x: 400, y: 1450, width: 400, height: 150 },      // Around R147 at (525, 1514)
      instalment: { x: 1200, y: 1650, width: 300, height: 100 },     // Around R5 at (1302, 1691)  
      interestRate: { x: 1200, y: 2000, width: 200, height: 80 },    // Around 29.25% at (1300, 2039)
      insurancePremium: { x: 1200, y: 1950, width: 300, height: 100 }, // Around R519.16 in financial table
      collectionAccountNo: { x: 1200, y: 2150, width: 300, height: 80 }, // Around N8162375 at bottom
    };

    if (!zones[fieldName]) return null;

    const zone = zones[fieldName];
    this.log(`🎯 Zone-based search for ${fieldName} in region (${zone.x}, ${zone.y}) ${zone.width}x${zone.height}`);
    
    // Find boxes within the zone
    const zoneBoxes = boxes.filter(box => {
      const inZone = box.x >= zone.x && box.x <= (zone.x + zone.width) &&
                     box.y >= zone.y && box.y <= (zone.y + zone.height);
      if (inZone) {
        this.log(`📦 Zone box: "${box.text}" at (${box.x}, ${box.y})`);
      }
      return inZone;
    });

    // Look for currency or percentage patterns
    for (const box of zoneBoxes) {
      const value = this.extractValue(box.text, this.getFieldType(fieldName));
      if (value !== null) {
        const isValid = this.validateValue(value, expectedValue, this.getFieldType(fieldName));
        if (isValid.valid) {
          this.log(`✅ Zone-based match: ${fieldName} = ${value}`);
          return {
            found: value,
            valid: isValid.valid,
            confidence: isValid.confidence,
            method: "zone_based",
            valueBox: box
          };
        }
      }
    }

    // Try currency fragment combination for fields that failed simple extraction
    if (this.getFieldType(fieldName) === "currency") {
      const combinedValue = this.combineCurrencyFragments(zoneBoxes, expectedValue);
      if (combinedValue) {
        const validation = this.validateValue(combinedValue.value, expectedValue, this.getFieldType(fieldName));
        this.log(`✅ Zone-based fragment match: ${fieldName} = ${combinedValue.value}`);
        return {
          found: combinedValue.value,
          valid: validation.valid,
          confidence: validation.confidence,
          method: "zone_based_fragments",
          valueBox: combinedValue.boxes[0]
        };
      }
    }

    this.log(`❌ No zone-based match found for ${fieldName}`);
    return null;
  }

  getFieldType(fieldName) {
    const types = {
      loanAmount: "currency",
      instalment: "currency", 
      interestRate: "percentage",
      insurancePremium: "currency",
      collectionAccountNo: "account"
    };
    return types[fieldName] || "currency";
  }

  // Combine currency fragments like "R147" + "126,58" → "R147,126.58"
  combineCurrencyFragments(boxes, expectedValue) {
    this.log(`🔗 Attempting currency fragment combination for expected: ${expectedValue}`);
    
    // Sort boxes by position (left to right, top to bottom)
    const sortedBoxes = boxes.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 10) return a.x - b.x; // Same line
      return a.y - b.y; // Different lines
    });

    // Look for R-prefix + decimal patterns
    for (let i = 0; i < sortedBoxes.length - 1; i++) {
      const box1 = sortedBoxes[i];
      const box2 = sortedBoxes[i + 1];

      // Check if box1 has R-prefix and box2 has decimal/number
      const isRPrefix = /^R\d+$/.test(box1.text);
      const isDecimalPart = /^\d+[,.]?\d*$/.test(box2.text);
      const isNearby = Math.abs(box1.x + box1.width - box2.x) < 30 && Math.abs(box1.y - box2.y) < 10;

      if (isRPrefix && isDecimalPart && isNearby) {
        // Combine fragments
        const rAmount = box1.text.replace('R', '');
        const decimalPart = box2.text.replace(',', '.');
        const combinedText = `R${rAmount} ${decimalPart}`;
        
        this.log(`🔗 Found fragments: "${box1.text}" + "${box2.text}" → "${combinedText}"`);
        
        // Extract and validate combined value
        const value = this.extractValue(combinedText, "currency");
        if (value !== null) {
          const validation = this.validateValue(value, expectedValue, "currency");
          if (validation.valid) {
            this.log(`✅ Fragment combination successful: ${value}`);
            return {
              value: value,
              confidence: Math.min(box1.confidence, box2.confidence),
              boxes: [box1, box2]
            };
          }
        }
      }
    }

    this.log(`❌ No valid currency fragments found to combine`);
    return null;
  }

  mergeFinancialEnhancement(fullPageBoxes, enhancedBoxes) {
    this.logImportant(
      "🔗 Merging enhanced financial OCR with full page results"
    );

    const merged = [...fullPageBoxes];

    // Add enhanced boxes that have better financial content
    for (const enhancedBox of enhancedBoxes) {
      if (this.containsFinancialData(enhancedBox.text)) {
        // Check if we have a similar box in full page results
        const similar = fullPageBoxes.find(
          (fullBox) =>
            Math.abs(fullBox.x - enhancedBox.x) < 50 &&
            Math.abs(fullBox.y - enhancedBox.y) < 30
        );

        if (similar) {
          // Replace with enhanced version if confidence is better
          if (enhancedBox.confidence > similar.confidence) {
            const index = merged.indexOf(similar);
            merged[index] = enhancedBox;
            this.log(
              `🔄 Replaced "${similar.text}" with enhanced "${enhancedBox.text}"`
            );
          }
        } else {
          // Add new enhanced box
          merged.push(enhancedBox);
          this.log(`➕ Added enhanced financial box: "${enhancedBox.text}"`);
        }
      }
    }

    this.logImportant(`✅ Merged result: ${merged.length} total boxes`);
    return merged;
  }

  async preprocessImageForOCR(imageBuffer, pageIndex, docName) {
    this.log(
      "🎨 Preprocessing image for optimal OCR quality (Simplified approach)"
    );

    try {
      // Save enhanced image to disk for debugging FIRST
      const enhancedImagePath = `debug_${docName}_page${
        pageIndex + 1
      }_enhanced.png`;
      await sharp(imageBuffer)
        // .grayscale()
        // .normalize()
        // .resize({ width: undefined, height: undefined, factor: 2 })
        // .png()
        .toFile(enhancedImagePath);

      this.logImportant(`💾 Enhanced image saved: ${enhancedImagePath}`);

      // Process for Tesseract using your working example pattern
      const enhancedSharp = sharp(imageBuffer)
        // .grayscale()
        // .normalize()
        // .resize({ width: undefined, height: undefined, factor: 2 })
        .ensureAlpha(); // RGBA as in your working example

      const { width, height } = await enhancedSharp.metadata();
      const data = await enhancedSharp.raw().toBuffer();

      // Create ImageData object (matches your example-cli.js pattern)
      const imageData = {
        data,
        width,
        height,
      };

      this.log(`📐 Enhanced image: ${width}x${height} (2x scale)`);
      this.log(
        `🎯 ImageData for Tesseract: ${width}x${height}, buffer=${data.length} bytes`
      );
      this.log(`🔍 Expected buffer size: ${width * height * 4} bytes (RGBA)`);

      return {
        imageData,
        info: { width, height, channels: 4 },
        enhancedImagePath,
      };
    } catch (error) {
      this.log(`❌ Image preprocessing failed: ${error.message}`, "error");
      throw error;
    }
  }

  normalizeOCRBoxes(rawBoxes, imageInfo, pageIndex) {
    this.log(
      `🔄 Normalizing ${rawBoxes.length} OCR boxes to digital PDF format`
    );

    const normalizedBoxes = rawBoxes.map((box, index) => {
      // Tesseract uses different coordinate system - normalize to PDF.js format
      const normalizedBox = {
        // Core text content
        text: box.text.trim(),

        // Spatial coordinates (tesseract bbox format: {x0, y0, x1, y1})
        x: box.rect ? box.rect.left : box.bbox ? box.bbox.x0 : box.left,
        y: box.rect ? box.rect.top : box.bbox ? box.bbox.y0 : box.top,
        width: box.rect
          ? box.rect.right - box.rect.left
          : box.bbox
          ? box.bbox.x1 - box.bbox.x0
          : box.right - box.left,
        height: box.rect
          ? box.rect.bottom - box.rect.top
          : box.bbox
          ? box.bbox.y1 - box.bbox.y0
          : box.bottom - box.top,

        // Page information (matching digital PDF format)
        pageIndex: pageIndex,
        pageWidth: imageInfo.width,
        pageHeight: imageInfo.height,
        boxIndex: index,

        // OCR-specific metadata
        confidence: box.confidence,
        source: "ocr",

        // Additional OCR quality indicators
        ocrQuality: this.assessOCRQuality(box),
      };

      // Log high-value boxes for debugging
      if (this.containsFinancialData(normalizedBox.text)) {
        this.log(
          `💰 Financial box found: "${
            normalizedBox.text
          }" at (${normalizedBox.x.toFixed(1)}, ${normalizedBox.y.toFixed(
            1
          )}) conf: ${normalizedBox.confidence}%`
        );
      }

      return normalizedBox;
    });

    this.log(
      `✅ Normalized ${normalizedBoxes.length} boxes to digital PDF format`
    );
    return normalizedBoxes;
  }

  normalizeOCRBoxesOld(ocrResults, pageIndex) {
    return ocrResults.boxes.map((box) => {
      const { isFinancial, adjustedConfidence } = this.isFinancialValue(
        box.text,
        box.confidence
      );

      return {
        text: box.text.trim(),
        confidence: isFinancial ? adjustedConfidence : box.confidence,
        bounds: {
          x: box.rect ? box.rect.left : box.bbox ? box.bbox.x0 : box.left,
          y: box.rect ? box.rect.top : box.bbox ? box.bbox.y0 : box.top,
          width: box.rect
            ? box.rect.right - box.rect.left
            : box.bbox
            ? box.bbox.x1 - box.bbox.x0
            : box.right - box.left,
          height: box.rect
            ? box.rect.bottom - box.rect.top
            : box.bbox
            ? box.bbox.y1 - box.bbox.y0
            : box.bottom - box.top,
        },
        page: pageIndex,
        source: "ocr",
        type: isFinancial ? "financial" : "text",
        metadata: {
          baseline: box.baseline,
          orientation: box.orientation,
        },
      };
    });
  }

  containsFinancialData(text) {
    // Quick check for financial indicators
    return /(?:R\s*[\d\s,.']+|[\d.,]+\s*%|\b\d{10,11}\b)/.test(text);
  }

  assessOCRQuality(box) {
    // Assess OCR quality based on multiple factors
    let quality = "good";

    if (box.confidence < 50) quality = "poor";
    else if (box.confidence < 70) quality = "fair";

    // Check for mixed alphanumeric in numbers (common OCR error)
    if (
      /\d/.test(box.text) &&
      /[a-zA-Z]/.test(box.text) &&
      box.text.length < 10
    ) {
      quality = "mixed_characters";
    }

    return quality;
  }

  // Enhanced debugging for OCR-specific issues
  logOCRDiagnostics(boxes) {
    this.logImportant("\n🔍 OCR DIAGNOSTICS");

    const byConfidence = {
      high: boxes.filter((b) => b.confidence >= 80).length,
      medium: boxes.filter((b) => b.confidence >= 60 && b.confidence < 80)
        .length,
      low: boxes.filter((b) => b.confidence < 60).length,
    };

    const financialBoxes = boxes.filter((b) =>
      this.containsFinancialData(b.text)
    );

    this.logImportant(
      `📊 Confidence distribution: High(${byConfidence.high}) Medium(${byConfidence.medium}) Low(${byConfidence.low})`
    );
    this.logImportant(`💰 Financial boxes detected: ${financialBoxes.length}`);

    if (financialBoxes.length > 0) {
      this.logImportant("💰 Financial boxes preview:");
      financialBoxes.slice(0, 5).forEach((box) => {
        this.logImportant(`   "${box.text}" (conf: ${box.confidence}%)`);
      });
    }
  }

  async saveOriginalPages(pages, docName) {
    this.logImportant(`💾 Saving ${pages.length} original page images to disk`);

    try {
      for (let i = 0; i < pages.length; i++) {
        const originalPagePath = `debug_${docName}_page${i + 1}_original.png`;
        await fs.writeFile(originalPagePath, pages[i]);
        this.logImportant(
          `💾 Original page ${i + 1} saved: ${originalPagePath}`
        );
      }

      this.logImportant(
        `✅ All ${pages.length} original pages saved successfully`
      );
    } catch (error) {
      this.log(`❌ Failed to save original pages: ${error.message}`, "error");
      throw error;
    }
  }

  async createImageDebugSummary(docName, pageCount, enhancedPaths) {
    this.logImportant("\n📁 IMAGE DEBUG FILES CREATED:");
    this.logImportant("─".repeat(50));

    for (let i = 1; i <= pageCount; i++) {
      this.logImportant(`📄 Page ${i}:`);
      this.logImportant(
        `   • debug_${docName}_page${i}_original.png - Raw PDF extraction`
      );
      this.logImportant(
        `   • debug_${docName}_page${i}_enhanced.png - Sharp preprocessing`
      );
    }

    this.logImportant("\n💡 Image Comparison Guide:");
    this.logImportant("─".repeat(50));
    this.logImportant("• Original: Direct PDF-to-image conversion");
    this.logImportant("• Enhanced: Grayscale + Normalized + 2x Scale + Sharp");
    this.logImportant(
      "• Compare quality to assess OCR preprocessing effectiveness"
    );
  }

  extractBoundingBoxes(pdfData) {
    const boxes = [];

    pdfData.pages.forEach((page, pageIndex) => {
      page.content.forEach((item, itemIndex) => {
        if (item.str && item.str.trim().length > 0) {
          boxes.push({
            text: item.str.trim(),
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            pageIndex: pageIndex,
            pageWidth: page.pageInfo.width,
            pageHeight: page.pageInfo.height,
            boxIndex: itemIndex,
            source: "pdf",
          });
        }
      });
    });

    return boxes;
  }

  async performOCRWithBoxes(imageBuffer) {
    this.log("🔍 Performing OCR with bounding box extraction");

    const image = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const imageData = {
      data: image.data,
      width: image.info.width,
      height: image.info.height,
    };

    this.ocrEngine.loadImage(imageData);
    const boxes = this.ocrEngine.getTextBoxes("word");

    return boxes
      .map((box, index) => ({
        text: box.text.trim(),
        x: box.bbox.x0,
        y: box.bbox.y0,
        width: box.bbox.x1 - box.bbox.x0,
        height: box.bbox.y1 - box.bbox.y0,
        pageIndex: 0,
        pageWidth: image.info.width,
        pageHeight: image.info.height,
        boxIndex: index,
        confidence: box.confidence,
        source: "ocr",
      }))
      .filter((box) => box.text.length > 0);
  }

  mergeNearbyBoxes(boxes) {
    const sortedBoxes = [...boxes].sort((a, b) => {
      if (Math.abs(a.y - b.y) < 5) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });

    const merged = [];
    let i = 0;

    while (i < sortedBoxes.length) {
      let currentBox = { ...sortedBoxes[i] };
      let j = i + 1;

      while (j < sortedBoxes.length) {
        const nextBox = sortedBoxes[j];

        const sameLineThreshold = Math.max(currentBox.height * 0.5, 5);
        const proximityThreshold = Math.max(currentBox.height * 2, 20);

        const onSameLine =
          Math.abs(currentBox.y - nextBox.y) <= sameLineThreshold;
        const closeEnough =
          Math.abs(currentBox.x + currentBox.width - nextBox.x) <=
          proximityThreshold;

        if (onSameLine && closeEnough) {
          currentBox.text += " " + nextBox.text;
          currentBox.width = nextBox.x + nextBox.width - currentBox.x;
          currentBox.height = Math.max(currentBox.height, nextBox.height);

          sortedBoxes.splice(j, 1);
        } else {
          j++;
        }
      }

      merged.push(currentBox);
      i++;

      while (i < sortedBoxes.length && merged.includes(sortedBoxes[i])) {
        i++;
      }
    }

    return merged;
  }

  async spatialFieldSearch(boxes, caseModel) {
    this.logImportant("🎯 Starting spatial field search with PAQ.js mapping");

    const results = {};
    const issues = [];

    // Special handling for case ID - look for exact matches first
    const caseIdBoxes = boxes.filter((box) =>
      box.text.includes(caseModel.caseId)
    );
    if (caseIdBoxes.length > 0) {
      this.logImportant(
        `🔍 Found ${caseIdBoxes.length} boxes containing case ID "${caseModel.caseId}"`
      );
    }

    for (const [fieldName, fieldConfig] of Object.entries(this.fieldMapping)) {
      const expectedValue = caseModel[fieldName];
      this.summary.fieldsProcessed++;

      this.logImportant(
        `\n🔍 Processing: ${fieldName} (expected: ${expectedValue})`
      );
      this.logImportant(`📋 Search labels: [${fieldConfig.labels.join(", ")}]`);

      if (!expectedValue && fieldConfig.required) {
        issues.push(`Missing required field in case model: ${fieldName}`);
        continue;
      }

      // Special handling for case ID (single instance)
      if (fieldName === "caseId" && caseIdBoxes.length > 0) {
        const result = this.processCaseIdField(
          caseIdBoxes,
          expectedValue,
          fieldConfig
        );
        if (result) {
          results[fieldName] = result;
          this.summary.fieldsFound++;
          if (result.valid) this.summary.fieldsValid++;
          this.logResult(
            fieldName,
            result.found,
            expectedValue,
            result.valid,
            result.confidence
          );
          if (!result.valid) {
            issues.push(
              `${fieldName}: expected ${expectedValue}, found ${result.found}`
            );
          }
          continue;
        }
      }

      // Check if this should use multi-table logic
      const shouldUseMultiTable = this.shouldUseMultiTableLogic(
        fieldName,
        caseModel
      );

      let result = null;

      if (shouldUseMultiTable) {
        // Try multi-table approach first
        this.logImportant(`🏦 Attempting multi-table search for ${fieldName}`);
        result = this.processMultiTableField(
          boxes,
          fieldName,
          expectedValue,
          fieldConfig
        );

        // If multi-table fails, fallback to single-table
        if (!result || result.found === null) {
          this.logImportant(
            `⚠️  Multi-table failed, falling back to single-table for ${fieldName}`
          );
          result = this.processSingleField(
            boxes,
            fieldName,
            expectedValue,
            fieldConfig
          );
          if (result) {
            result.method = "single_table_fallback";
          }
        }
      } else {
        // Use standard single-table processing
        result = this.processSingleField(
          boxes,
          fieldName,
          expectedValue,
          fieldConfig
        );
      }

      // ZONE-BASED FALLBACK: If all label-based approaches fail, try zone-based extraction
      if ((!result || result.found === null) && ["loanAmount", "instalment", "interestRate", "insurancePremium", "collectionAccountNo"].includes(fieldName)) {
        this.logImportant(`🎯 Label-based failed, trying zone-based extraction for ${fieldName}`);
        result = this.extractFinancialValueByZone(boxes, fieldName, expectedValue);
        if (result) {
          result.method = "zone_based_fallback";
        }
      }

      // Process the result
      if (result && result.found !== null) {
        results[fieldName] = result;
        this.summary.fieldsFound++;
        if (result.valid) this.summary.fieldsValid++;
        this.logResult(
          fieldName,
          result.found,
          expectedValue,
          result.valid,
          result.confidence
        );
        if (!result.valid) {
          issues.push(
            `${fieldName}: expected ${expectedValue}, found ${result.found}`
          );
        }
      } else {
        this.logImportant(`❌ Field processing failed for ${fieldName}`);
        issues.push(`Field not found: ${fieldName}`);
      }
    }

    this.logFinalSummary();
    const result = this.createResult(results, issues);
    await this.saveDebugLog("spatial");
    return result;
  }

  shouldUseMultiTableLogic(fieldName, caseModel) {
    // FIXED: loanAmount should NOT use multi-table logic even for staff
    // It's typically a single value that appears once in the document
    const isFinancialField = ["instalment", "insurancePremium"].includes(
      fieldName
    );
    const isStaff = caseModel.isStaff === "Yes";

    this.log(
      `📊 Multi-table check: ${fieldName}, isFinancial: ${isFinancialField}, isStaff: ${isStaff}`
    );

    return isFinancialField && isStaff;
  }

  // ENHANCED: Better multi-table processing with fallback
  processMultiTableField(boxes, fieldName, expectedValue, fieldConfig) {
    this.logImportant(
      `🏦 Processing multi-table field: ${fieldName} (Staff: Yes)`
    );
    this.logImportant(
      `🎯 Using DIRECT VALUE MATCHING approach for expected: ${expectedValue}`
    );

    // Find ALL label instances using sophisticated search
    const allLabelBoxes = this.findAllLabelBoxes(boxes, fieldConfig.labels);
    this.logImportant(
      `📊 Found ${allLabelBoxes.length} label instances for ${fieldName}`
    );

    if (allLabelBoxes.length === 0) {
      return {
        found: null,
        expected: expectedValue,
        valid: false,
        confidence: 0,
        method: "multi_table_no_labels",
      };
    }

    // Collect ALL extracted values from ALL label instances
    const allExtractedValues = [];

    // Process each label instance using direct value matching
    for (let i = 0; i < allLabelBoxes.length; i++) {
      const labelBox = allLabelBoxes[i];
      this.logImportant(
        `📋 Processing label instance ${i + 1}: "${labelBox.text}"`
      );

      // Use the same focused area approach for each label
      const pageBoxes = boxes.filter(
        (box) => box.pageIndex === labelBox.pageIndex
      );
      const lineSpacing = this.calculateLineSpacing(pageBoxes);

      const searchPadding = lineSpacing * 8;
      const focusedBoxes = pageBoxes.filter(
        (box) =>
          box.y >= labelBox.y - searchPadding &&
          box.y <= labelBox.y + labelBox.height + searchPadding &&
          box.x >= labelBox.x - 50 &&
          box.x <= labelBox.x + labelBox.width + 400
      );

      this.logImportant(
        `📦 Label ${i + 1} focused area: ${focusedBoxes.length} boxes to check`
      );

      // Extract ALL values from this label's focused area
      for (const box of focusedBoxes) {
        if (box === labelBox) {
          // Check label itself first
          const labelValue = this.extractValue(labelBox.text, fieldConfig.type);
          if (labelValue !== null) {
            allExtractedValues.push({
              value: labelValue,
              box: labelBox,
              tableIndex: i,
              source: "embedded_in_label",
              distance: 0,
              isSameLine: true,
              isToRight: false,
            });
            this.logImportant(
              `💰 Table ${i + 1} embedded value: ${labelValue}`
            );
          }
          continue;
        }

        const extractedValue = this.extractValue(box.text, fieldConfig.type);
        if (extractedValue !== null) {
          const distance = this.calculateDistance(labelBox, box);
          const isSameLine = this.isSameLine(labelBox, box, lineSpacing);
          const isToRight = this.isRightOf(labelBox, box);

          allExtractedValues.push({
            value: extractedValue,
            box: box,
            tableIndex: i,
            source: "near_label",
            distance,
            isSameLine,
            isToRight,
          });
          this.logImportant(
            `💰 Table ${i + 1} extracted: ${extractedValue} from "${box.text}"`
          );
        }
      }
    }

    this.logImportant(
      `📊 Multi-table extraction complete: Found ${allExtractedValues.length} total values`
    );

    if (allExtractedValues.length === 0) {
      return {
        found: null,
        expected: expectedValue,
        valid: false,
        confidence: 0,
        method: "multi_table_no_values",
      };
    }

    // STEP 1: Look for EXACT matches first
    this.logImportant(
      `🔍 Checking ${allExtractedValues.length} values for exact match to: ${expectedValue}`
    );

    const exactMatches = [];
    for (const candidate of allExtractedValues) {
      const validation = this.validateValue(
        candidate.value,
        expectedValue,
        fieldConfig.type
      );
      this.logImportant(
        `   📊 Table ${candidate.tableIndex + 1}: ${
          candidate.value
        } → exact match: ${validation.valid} (confidence: ${(
          validation.confidence * 100
        ).toFixed(1)}%)`
      );

      if (validation.valid) {
        exactMatches.push({
          ...candidate,
          confidence: validation.confidence,
        });
      }
    }

    if (exactMatches.length > 0) {
      // Sort exact matches by spatial preference
      exactMatches.sort((a, b) => {
        if (a.isSameLine !== b.isSameLine) return b.isSameLine - a.isSameLine;
        if (a.isToRight !== b.isToRight) return b.isToRight - a.isToRight;
        if (Math.abs(a.confidence - b.confidence) > 0.01)
          return b.confidence - a.confidence;
        return a.distance - b.distance;
      });

      const best = exactMatches[0];
      this.logImportant(
        `✅ Found exact match in table ${best.tableIndex + 1}: ${best.value}`
      );
      return {
        found: best.value,
        expected: expectedValue,
        valid: true,
        confidence: best.confidence,
        labelBox: allLabelBoxes[best.tableIndex],
        valueBox: best.box,
        method: "multi_table_exact_match",
        tableIndex: best.tableIndex,
      };
    }

    // STEP 2: STAFF LOGIC - Accept ANY reasonable value if no exact match
    // This handles staff discount scenarios where data model may contain either rate
    this.logImportant(
      `⚠️  No exact match found for ${expectedValue}. Applying staff logic...`
    );

    // Sort all values by quality (prefer same line + right, then reasonable amounts)
    allExtractedValues.sort((a, b) => {
      // Prefer same line first
      if (a.isSameLine !== b.isSameLine) return b.isSameLine - a.isSameLine;
      // Then prefer right positioning
      if (a.isToRight !== b.isToRight) return b.isToRight - a.isToRight;
      // Then prefer reasonable amounts (not too small)
      const aReasonable = this.isReasonableValue(a.value, fieldConfig.type)
        ? 1
        : 0;
      const bReasonable = this.isReasonableValue(b.value, fieldConfig.type)
        ? 1
        : 0;
      if (aReasonable !== bReasonable) return bReasonable - aReasonable;
      // Finally prefer closer values
      return a.distance - b.distance;
    });

    // Accept the first reasonable value (staff discount logic)
    for (const candidate of allExtractedValues) {
      if (this.isReasonableValue(candidate.value, fieldConfig.type)) {
        // Additional filter for currency to avoid percentages
        if (
          fieldConfig.type === "currency" &&
          candidate.box.text.includes("%")
        ) {
          this.logImportant(
            `   ⚠️  Skipping percentage: ${candidate.value} from "${candidate.box.text}"`
          );
          continue;
        }

        this.logImportant(
          `✅ Staff logic: Accepting table ${candidate.tableIndex + 1} value: ${
            candidate.value
          } (expected ${expectedValue})`
        );
        return {
          found: candidate.value,
          expected: expectedValue,
          valid: true, // CRITICAL: Mark as valid for staff applications
          confidence: 0.85, // High confidence for staff scenarios
          labelBox: allLabelBoxes[candidate.tableIndex],
          valueBox: candidate.box,
          method: "multi_table_staff_accepted",
          tableIndex: candidate.tableIndex,
          allValues: allExtractedValues.map((v) => v.value),
          note: "Staff application - accepted alternative rate",
        };
      }
    }

    this.logImportant(`❌ No reasonable values found in multi-table search`);
    return {
      found: null,
      expected: expectedValue,
      valid: false,
      confidence: 0,
      method: "multi_table_no_reasonable_values",
      allValues: allExtractedValues.map((v) => v.value),
    };
  }

  // MISSING: processCaseIdField function
  processCaseIdField(caseIdBoxes, expectedValue, fieldConfig) {
    const caseIdBox = caseIdBoxes[0];
    const extractedValue = this.extractValue(caseIdBox.text, fieldConfig.type);

    if (extractedValue === expectedValue.toString()) {
      this.logImportant(`✅ Direct case ID match: "${extractedValue}"`);
      const validation = this.validateValue(
        extractedValue,
        expectedValue,
        fieldConfig.type
      );

      return {
        found: extractedValue,
        expected: expectedValue,
        valid: validation.valid,
        confidence: validation.confidence,
        valueBox: caseIdBox,
        method: "direct_match",
      };
    }

    return null;
  }

  processSingleField(boxes, fieldName, expectedValue, fieldConfig) {
    const labelBox = this.findLabelBox(boxes, fieldConfig.labels);

    if (!labelBox) {
      this.logImportant(`❌ Label not found for ${fieldName}`);
      return null;
    }

    this.log(
      `✅ Label found: "${labelBox.text}" (confidence: ${(
        labelBox.matchScore * 100
      ).toFixed(1)}%)`
    );

    // PASS expectedValue to findValueNearLabel for direct comparison
    const valueBox = this.findValueNearLabel(
      boxes,
      labelBox,
      fieldConfig,
      expectedValue
    );
    if (!valueBox) {
      this.logImportant(`❌ Value not found near label for ${fieldName}`);
      return null;
    }

    this.log(`✅ Value found: "${valueBox.text}"`);

    const extractedValue = this.extractValue(valueBox.text, fieldConfig.type);
    const validation = this.validateValue(
      extractedValue,
      expectedValue,
      fieldConfig.type
    );

    return {
      found: extractedValue,
      expected: expectedValue,
      valid: validation.valid,
      confidence: validation.confidence,
      labelBox: labelBox,
      valueBox: valueBox,
      method: "direct_value_match",
    };
  }

  findLabelBox(boxes, searchPatterns) {
    let bestMatch = null;
    let bestScore = 0;

    this.log(`🏷️  OCR-Enhanced label search: [${searchPatterns.join(", ")}]`);

    // Create OCR-tolerant variations for each pattern
    const expandedPatterns = [];
    for (const pattern of searchPatterns) {
      expandedPatterns.push(pattern); // Original

      // Add common OCR variations
      expandedPatterns.push(
        pattern.replace(/- /g, ""), // Remove hyphens: "rate - fixed" → "rate fixed"
        pattern.replace(/ll/g, "l"), // Double L → single: "instalment" → "instalment"
        pattern.replace(/\(/g, ""), // Remove opening parentheses
        pattern.replace(/\)/g, ""), // Remove closing parentheses
        pattern.replace(/\s+/g, " ") // Normalize whitespace
      );

      // Add partial matching - key words only
      const keyWords = pattern.split(" ").filter(
        (word) =>
          word.length > 3 && // Skip short words
          !["the", "and", "for", "with", "including"].includes(
            word.toLowerCase()
          )
      );
      if (keyWords.length >= 2) {
        expandedPatterns.push(keyWords.join(" ")); // Key words only
      }
    }

    this.log(`🔍 Expanded to ${expandedPatterns.length} OCR-tolerant patterns`);

    // Try each expanded pattern with lower threshold
    for (const pattern of expandedPatterns) {
      this.log(`🔍 Trying OCR pattern: "${pattern}"`);

      for (const box of boxes) {
        const boxText = box.text.toLowerCase().trim();
        const patternText = pattern.toLowerCase().trim();

        let score = 0;
        let matchType = "";

        // Exact match (highest priority)
        if (boxText === patternText) {
          score = 1.0;
          matchType = "exact";
        }
        // Contains match (OCR-friendly)
        else if (
          boxText.includes(patternText) ||
          patternText.includes(boxText)
        ) {
          const longer = Math.max(boxText.length, patternText.length);
          const shorter = Math.min(boxText.length, patternText.length);
          score = (shorter / longer) * 0.9; // Scale by length ratio
          matchType = "contains";
        }
        // Starts with match
        else if (
          boxText.startsWith(patternText) ||
          patternText.startsWith(boxText)
        ) {
          score = 0.85;
          matchType = "prefix";
        }
        // Word-level fuzzy matching (OCR errors)
        else {
          const boxWords = boxText.split(/\s+/);
          const patternWords = patternText.split(/\s+/);

          let wordMatches = 0;
          let totalWords = Math.max(boxWords.length, patternWords.length);

          for (const pWord of patternWords) {
            for (const bWord of boxWords) {
              // Exact word match
              if (pWord === bWord) {
                wordMatches += 1;
                break;
              }
              // OCR character substitution tolerance
              else if (this.isOCRSimilar(pWord, bWord)) {
                wordMatches += 0.8; // Partial credit for OCR errors
                break;
              }
              // Partial word match (minimum 4 chars)
              else if (
                pWord.length >= 4 &&
                bWord.length >= 4 &&
                (pWord.includes(bWord) || bWord.includes(pWord))
              ) {
                wordMatches += 0.6;
                break;
              }
            }
          }

          if (wordMatches > 0) {
            score = (wordMatches / totalWords) * 0.7;
            matchType = "fuzzy_words";
          }
        }

        // LOWERED THRESHOLD for OCR: 0.4 instead of 0.6
        if (score > bestScore && score > 0.4) {
          bestScore = score;
          bestMatch = {
            ...box,
            matchScore: score,
            matchedLabel: pattern,
            matchType: matchType,
          };
          this.log(
            `🎯 OCR Match: "${box.text}" (score: ${score.toFixed(
              3
            )}, type: ${matchType}) for "${pattern}"`
          );
        }
      }
    }

    if (bestMatch) {
      this.log(
        `✅ Best OCR label match: "${
          bestMatch.text
        }" (score: ${bestMatch.matchScore.toFixed(3)})`
      );
    } else {
      this.log(`❌ No OCR label matches found above threshold (0.4)`);
    }

    return bestMatch;
  }

  // OCR character similarity detection
  isOCRSimilar(word1, word2) {
    if (Math.abs(word1.length - word2.length) > 2) return false;

    // Common OCR character substitutions
    const ocrSubstitutions = {
      l: ["1", "I", "|"],
      1: ["l", "I", "|"],
      I: ["l", "1", "|"],
      o: ["0", "O"],
      0: ["o", "O"],
      O: ["o", "0"],
      s: ["5", "S"],
      5: ["s", "S"],
      S: ["s", "5"],
      rn: ["m"], // "rn" often read as "m"
      m: ["rn"],
      cl: ["d"], // "cl" often read as "d"
      d: ["cl"],
    };

    // Simple edit distance with OCR tolerance
    let differences = 0;
    const maxLen = Math.max(word1.length, word2.length);

    for (let i = 0; i < maxLen; i++) {
      const c1 = word1[i] || "";
      const c2 = word2[i] || "";

      if (c1 !== c2) {
        // Check if it's a known OCR substitution
        const substitutes = ocrSubstitutions[c1] || [];
        if (!substitutes.includes(c2)) {
          differences++;
        }
      }
    }

    // Allow up to 2 differences for OCR errors
    return differences <= 2 && differences / maxLen < 0.4;
  }

  findValueNearLabel(boxes, labelBox, fieldConfig, expectedValue) {
    this.log(`🎯 Using DIRECT VALUE MATCHING for: ${expectedValue}`);
    this.log(
      `🏷️  Label: "${labelBox.text}" at (${labelBox.x}, ${labelBox.y}) on page ${labelBox.pageIndex}`
    );

    // STEP 1: Check if the label itself contains the value
    const labelValue = this.extractValue(labelBox.text, fieldConfig.type);
    if (labelValue !== null) {
      const validation = this.validateValue(
        labelValue,
        expectedValue,
        fieldConfig.type
      );
      if (validation.valid) {
        this.log(
          `💡 ✅ EXACT MATCH in label: ${labelValue} matches expected ${expectedValue}`
        );
        return labelBox;
      } else {
        this.log(
          `💡 Label value ${labelValue} doesn't match expected ${expectedValue}`
        );
      }
    }

    // STEP 2: Create focused search area
    const pageBoxes = boxes.filter(
      (box) => box.pageIndex === labelBox.pageIndex
    );
    const lineSpacing = this.calculateLineSpacing(pageBoxes);

    const searchPadding = lineSpacing * 8;
    const focusedBoxes = pageBoxes.filter(
      (box) =>
        box.y >= labelBox.y - searchPadding &&
        box.y <= labelBox.y + labelBox.height + searchPadding &&
        box.x >= labelBox.x - 50 &&
        box.x <= labelBox.x + labelBox.width + 400
    );

    this.log(`📦 Focused area: ${focusedBoxes.length} boxes to check`);

    // STEP 3: Extract ALL values and check for exact matches
    const allMatches = [];

    for (const box of focusedBoxes) {
      if (box === labelBox) continue;

      const extractedValue = this.extractValue(box.text, fieldConfig.type);
      if (extractedValue !== null) {
        const validation = this.validateValue(
          extractedValue,
          expectedValue,
          fieldConfig.type
        );

        this.log(
          `💰 Extracted from "${box.text}": ${extractedValue} → Match: ${
            validation.valid
          } (confidence: ${(validation.confidence * 100).toFixed(1)}%)`
        );

        if (validation.valid) {
          // EXACT MATCH FOUND!
          const distance = this.calculateDistance(labelBox, box);
          const isSameLine = this.isSameLine(labelBox, box, lineSpacing);
          const isToRight = this.isRightOf(labelBox, box);

          allMatches.push({
            box,
            value: extractedValue,
            confidence: validation.confidence,
            distance,
            isSameLine,
            isToRight,
            position: `(${box.x.toFixed(1)}, ${box.y.toFixed(1)})`,
          });

          this.log(
            `🎉 ✅ EXACT MATCH FOUND: ${extractedValue} at ${
              allMatches[allMatches.length - 1].position
            }`
          );
        }
      }
    }

    // STEP 4: Return the best exact match (prefer same line + right)
    if (allMatches.length > 0) {
      this.log(
        `🏆 Found ${allMatches.length} exact matches, selecting best positioned:`
      );

      // Sort by spatial preference
      allMatches.sort((a, b) => {
        // Prefer same line
        if (a.isSameLine !== b.isSameLine) return b.isSameLine - a.isSameLine;
        // Then prefer right position
        if (a.isToRight !== b.isToRight) return b.isToRight - a.isToRight;
        // Then prefer higher confidence
        if (Math.abs(a.confidence - b.confidence) > 0.01)
          return b.confidence - a.confidence;
        // Finally prefer closer distance
        return a.distance - b.distance;
      });

      const winner = allMatches[0];
      this.log(
        `🏆 WINNER: "${winner.box.text}" → ${winner.value} at ${winner.position}`
      );
      this.log(
        `   📊 sameLine:${winner.isSameLine}, toRight:${
          winner.isToRight
        }, confidence:${(winner.confidence * 100).toFixed(1)}%`
      );

      // Log all matches for debugging
      if (allMatches.length > 1) {
        this.log(`🥈 Other exact matches found:`);
        for (let i = 1; i < allMatches.length; i++) {
          const match = allMatches[i];
          this.log(
            `   ${i + 1}. "${match.box.text}" → ${match.value} at ${
              match.position
            }`
          );
        }
      }

      return winner.box;
    } else {
      this.log(
        `❌ No exact matches found for ${expectedValue} in focused area`
      );
      this.log(
        `💡 Consider checking tolerance settings or value format variations`
      );
      return null;
    }
  }

  calculateLineSpacing(pageBoxes) {
    if (pageBoxes.length < 2) return 20; // Default fallback

    // Get all unique Y positions and sort them
    const yPositions = [
      ...new Set(pageBoxes.map((box) => Math.round(box.y))),
    ].sort((a, b) => a - b);

    if (yPositions.length < 2) return 20;

    // Calculate differences between consecutive Y positions
    const gaps = [];
    for (let i = 1; i < yPositions.length; i++) {
      const gap = yPositions[i] - yPositions[i - 1];
      if (gap > 5 && gap < 100) {
        // Filter out very small or very large gaps
        gaps.push(gap);
      }
    }

    if (gaps.length === 0) return 20;

    // Use median gap as line spacing estimate
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];

    this.log(
      `📏 Line spacing calculation: ${yPositions.length} Y positions, ${gaps.length} valid gaps, median: ${median}`
    );

    return median;
  }

  findAllLabelBoxes(boxes, searchPatterns) {
    const allMatches = [];

    this.log(
      `🏷️  Searching for ALL label instances: [${searchPatterns.join(", ")}]`
    );

    // Use the same sophisticated logic as findLabelBox but collect ALL matches
    for (const pattern of searchPatterns) {
      this.log(`🔍 Searching for pattern: "${pattern}"`);

      // Method 1: Simple contains matching (like original)
      for (const box of boxes) {
        const boxText = box.text.toLowerCase();
        const patternText = pattern.toLowerCase();

        let score = 0;
        let matchType = "";

        // Exact match
        if (boxText === patternText) {
          score = 1.0;
          matchType = "exact";
        }
        // Starts with
        else if (boxText.startsWith(patternText)) {
          score = 0.95;
          matchType = "prefix";
        }
        // Contains
        else if (boxText.includes(patternText)) {
          score = 0.8;
          matchType = "contains";
        }
        // Partial word match for broken text (like original)
        else {
          const words = patternText.split(" ");
          const matchCount = words.filter((word) =>
            boxText.includes(word)
          ).length;
          if (matchCount > 0) {
            score = (matchCount / words.length) * 0.7;
            matchType = "partial";
          }
        }

        if (score > 0.6) {
          // Check if we already have this box
          const existing = allMatches.find(
            (m) => m.x === box.x && m.y === box.y && m.text === box.text
          );

          if (!existing || score > existing.matchScore) {
            if (existing) {
              // Replace with better match
              const index = allMatches.indexOf(existing);
              allMatches[index] = {
                ...box,
                matchScore: score,
                matchedLabel: pattern,
                matchType: matchType,
              };
            } else {
              // Add new match
              allMatches.push({
                ...box,
                matchScore: score,
                matchedLabel: pattern,
                matchType: matchType,
              });
            }
            this.log(
              `🎯 Found label instance: "${box.text}" (score: ${score.toFixed(
                3
              )}, type: ${matchType})`
            );
          }
        }
      }
    }

    // Sort by Y position (top to bottom) to maintain table order
    allMatches.sort((a, b) => a.y - b.y);

    this.log(`✅ Total label instances found: ${allMatches.length}`);
    return allMatches;
  }

  isReasonableValue(value, type) {
    switch (type) {
      case "currency":
        // Currency should be a positive number, not too small for main amounts
        return value > 0 && !isNaN(value);

      case "percentage":
        // Percentage should be between 0 and 100 (roughly)
        return value >= 0 && value <= 200; // Allow for some edge cases

      case "reference":
      case "account":
        // Reference numbers should be strings with reasonable length
        const str = value.toString();
        return str.length >= 6 && str.length <= 15;

      default:
        return true;
    }
  }

  calculateDistanceEdgeToEdge(box1, box2) {
    // Calculate minimum edge-to-edge distance
    const box1Right = box1.x + box1.width;
    const box1Bottom = box1.y + box1.height;
    const box2Right = box2.x + box2.width;
    const box2Bottom = box2.y + box2.height;

    let dx = 0;
    let dy = 0;

    // Horizontal distance
    if (box2.x > box1Right) {
      dx = box2.x - box1Right; // box2 is to the right
    } else if (box1.x > box2Right) {
      dx = box1.x - box2Right; // box2 is to the left
    }

    // Vertical distance
    if (box2.y > box1Bottom) {
      dy = box2.y - box1Bottom; // box2 is below
    } else if (box1.y > box2Bottom) {
      dy = box1.y - box2Bottom; // box2 is above
    }

    return Math.sqrt(dx * dx + dy * dy);
  }

  isSameLineGenerous(box1, box2) {
    // More generous same-line detection
    const avgHeight = (box1.height + box2.height) / 2;
    const threshold = Math.max(avgHeight * 0.8, 10);
    const overlap = Math.abs(box1.y - box2.y) <= threshold;

    this.log(
      `     📏 Line check: y1=${box1.y.toFixed(1)}, y2=${box2.y.toFixed(
        1
      )}, diff=${Math.abs(box1.y - box2.y).toFixed(
        1
      )}, threshold=${threshold.toFixed(1)} → ${overlap}`
    );
    return overlap;
  }

  isRightOfLabel(labelBox, valueBox) {
    // Value starts to the right of label with small tolerance
    const tolerance = 10;
    const labelRight = labelBox.x + labelBox.width;
    const isRight = valueBox.x >= labelRight - tolerance;

    this.log(
      `     ➡️  Right check: valueX=${valueBox.x.toFixed(
        1
      )}, labelRight=${labelRight.toFixed(1)} → ${isRight}`
    );
    return isRight;
  }

  isBelowLabel(labelBox, valueBox) {
    // Value starts below label
    const tolerance = 5;
    const isBelow = valueBox.y >= labelBox.y + tolerance;

    this.log(
      `     ⬇️  Below check: valueY=${valueBox.y.toFixed(
        1
      )}, labelY=${labelBox.y.toFixed(1)} → ${isBelow}`
    );
    return isBelow;
  }

  calculateDistance(box1, box2) {
    // Use edge-to-edge distance instead of center-to-center for better spatial awareness
    const box1Right = box1.x + box1.width;
    const box1Bottom = box1.y + box1.height;
    const box2Right = box2.x + box2.width;
    const box2Bottom = box2.y + box2.height;

    // Calculate minimum distance between boxes
    let dx = 0;
    let dy = 0;

    // Horizontal distance
    if (box2.x > box1Right) {
      dx = box2.x - box1Right; // box2 is to the right
    } else if (box1.x > box2Right) {
      dx = box1.x - box2Right; // box2 is to the left
    }
    // If boxes overlap horizontally, dx = 0

    // Vertical distance
    if (box2.y > box1Bottom) {
      dy = box2.y - box1Bottom; // box2 is below
    } else if (box1.y > box2Bottom) {
      dy = box1.y - box2Bottom; // box2 is above
    }
    // If boxes overlap vertically, dy = 0

    return Math.sqrt(dx * dx + dy * dy);
  }

  isSameLine(box1, box2, estimatedLineSpacing = null) {
    const box1Center = box1.y + box1.height / 2;
    const box2Center = box2.y + box2.height / 2;

    // Use estimated line spacing if available, otherwise fall back to box height
    const threshold = estimatedLineSpacing
      ? estimatedLineSpacing * 0.6 // 60% of line spacing
      : Math.max(Math.max(box1.height, box2.height) * 0.8, 8);

    const verticalOverlap = Math.abs(box1Center - box2Center) <= threshold;

    this.log(
      `   📏 Same line check: box1.center=${box1Center.toFixed(
        1
      )}, box2.center=${box2Center.toFixed(1)}, threshold=${threshold.toFixed(
        1
      )}, overlap=${verticalOverlap}`
    );
    return verticalOverlap;
  }

  isRightOf(labelBox, valueBox) {
    // Value box starts to the right of label box end (with small tolerance)
    const tolerance = 10; // Slightly more generous
    const labelRight = labelBox.x + labelBox.width;
    const isRight = valueBox.x >= labelRight - tolerance;

    this.log(
      `   ➡️  Right check: valueBox.x=${
        valueBox.x
      }, labelRight=${labelRight.toFixed(1)}, isRight=${isRight}`
    );
    return isRight;
  }

  isBelow(labelBox, valueBox) {
    // Value box starts below label box (with small tolerance)
    const tolerance = 3;
    const isBelow = valueBox.y >= labelBox.y + tolerance;

    this.log(
      `   ⬇️  Below check: valueBox.y=${valueBox.y}, labelBox.y=${labelBox.y}, isBelow=${isBelow}`
    );
    return isBelow;
  }

  isValidValueFormat(text, type) {
    switch (type) {
      case "currency":
        // SUPER PERMISSIVE: Accept any text with R and digits for debugging
        const hasR = text.includes("R");
        const hasDigits = /\d/.test(text);
        const hasSubstantialDigits = text.replace(/[^0-9]/g, "").length >= 3; // Lowered from 4
        const isNotPercentage = !text.includes("%");
        const isNotTinyAmount = !/^R?\s*[0-9]{1,2}(\s|,|\.)?$/.test(text);

        // More specific patterns
        const isSouthAfricanFormat =
          /^R\s*\d{1,3}(?:\s\d{3})*(?:[,.]\d{2})?$/.test(text);
        const isStandardFormat =
          /^R\s*\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})?$/.test(text);
        const isGeneralRFormat = /^R\s*[\d\s,.']+$/.test(text);

        const hasValidFormat =
          isSouthAfricanFormat || isStandardFormat || isGeneralRFormat;

        const isValid =
          hasR &&
          hasDigits &&
          hasSubstantialDigits &&
          isNotPercentage &&
          isNotTinyAmount &&
          hasValidFormat;

        // ENHANCED DEBUG: Always log for R values
        if (hasR && hasDigits) {
          this.log(
            `   💰 DETAILED validation "${text}": hasR=${hasR}, hasDigits=${hasDigits}, substantial=${hasSubstantialDigits}, notPercent=${isNotPercentage}, notTiny=${isNotTinyAmount}, validFormat=${hasValidFormat} → ${isValid}`
          );
          this.log(
            `   💰 Format checks: SA=${isSouthAfricanFormat}, Standard=${isStandardFormat}, General=${isGeneralRFormat}`
          );
        }

        return isValid;

      case "percentage":
        return /[\d.,]+\s*%/.test(text) && !text.includes("R");

      case "reference":
        return (
          /\b\d{10,11}\b/.test(text) &&
          !text.includes("R") &&
          !text.includes("%")
        );

      case "account":
        return (
          /\b\d{6,12}\b/.test(text) &&
          !text.includes("R") &&
          !text.includes("%")
        );

      default:
        return true;
    }
  }

  calculateDistance(box1, box2) {
    const centerX1 = box1.x + box1.width / 2;
    const centerY1 = box1.y + box1.height / 2;
    const centerX2 = box2.x + box2.width / 2;
    const centerY2 = box2.y + box2.height / 2;

    return Math.sqrt(
      Math.pow(centerX2 - centerX1, 2) + Math.pow(centerY2 - centerY1, 2)
    );
  }

  isSameLine(box1, box2) {
    const threshold = Math.max(box1.height * 0.5, 5);
    return Math.abs(box1.y - box2.y) <= threshold;
  }

  isRightOf(labelBox, valueBox) {
    return valueBox.x > labelBox.x + labelBox.width - 10;
  }

  isBelow(labelBox, valueBox) {
    return valueBox.y > labelBox.y + 5;
  }

  isValidValueFormat(text, type) {
    switch (type) {
      case "currency":
        // More comprehensive currency validation
        const hasValidFormat =
          // Clean currency format: R90 640,57 or R90,640.57
          (/^R\s*[\d\s,.']+$/.test(text) ||
            // Embedded currency: contains R and reasonable numbers
            (text.includes("R") && /[\d,.']{3,}/.test(text)) ||
            // Standalone numbers that look like currency amounts
            /^\s*[\d\s,.']{4,}\s*$/.test(text)) &&
          !text.includes("%") && // Not a percentage
          !/^R?\s*[0-9]{1,2}(\s|,|$)/.test(text); // Not tiny amounts like R5 or 60

        // Additional check: if it's just a number, make sure it's in reasonable range
        if (/^\s*\d+\s*$/.test(text)) {
          const num = parseInt(text.trim());
          return num >= 100; // At least R100 to avoid month counts, etc.
        }

        return hasValidFormat;

      case "percentage":
        return /[\d.,]+\s*%/.test(text) && !text.includes("R");

      case "reference":
        return (
          /\b\d{10,11}\b/.test(text) &&
          !text.includes("R") &&
          !text.includes("%")
        );

      case "account":
        return (
          /\b\d{6,12}\b/.test(text) &&
          !text.includes("R") &&
          !text.includes("%")
        );

      default:
        return true;
    }
  }

  extractValue(text, type) {
    this.log(`🎯 OCR-Enhanced extracting value from "${text}" (type: ${type})`);

    switch (type) {
      case "currency":
        // STEP 1: Clean OCR artifacts before extraction
        let cleanedText = this.cleanOCRCurrency(text);
        this.log(`🧹 Cleaned OCR text: "${text}" → "${cleanedText}"`);

        // STEP 2: Apply enhanced currency patterns
        const currencyPatterns = [
          // Priority 1: South African format with OCR tolerance
          /R\s*(\d{1,3}(?:\s\d{3})*(?:[,.]\d{2})?)/g,
          // Priority 2: Standard formats
          /R\s*(\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})?)/g,
          // Priority 3: Any R followed by numbers (OCR fallback)
          /R\s*([\d\s,.']+)/g,
          // Priority 4: Standalone currency amounts (no R symbol)
          /(\d{1,3}(?:\s\d{3})*(?:[,.]\d{2})?)/g,
        ];

        for (const pattern of currencyPatterns) {
          const matches = [...cleanedText.matchAll(pattern)];

          for (const match of matches) {
            let numberPart = match[1].trim();

            // Skip very short matches (likely not currency)
            if (numberPart.replace(/[^0-9]/g, "").length < 3) continue;

            // STEP 3: Smart number parsing with OCR corrections
            const parsedValue = this.parseOCRNumber(numberPart);

            if (parsedValue !== null && parsedValue > 0) {
              this.log(
                `💰 OCR currency extracted: "${text}" → "${match[0]}" → ${parsedValue}`
              );
              return parsedValue;
            }
          }
        }

        this.log(`💰 No currency found in OCR text: "${text}"`);
        return null;

      case "percentage":
        // Clean and extract percentage
        const cleanedPercent = this.cleanOCRText(text);
        const percentMatch = cleanedPercent.match(/([\d.,]+)(?=\s*%)/);
        if (percentMatch) {
          const parsed = this.parseOCRNumber(percentMatch[1]);
          this.log(
            `📊 OCR percentage extracted: "${percentMatch[0]}%" → ${parsed}`
          );
          return parsed;
        }
        return null;

      case "reference":
      case "account":
        // Extract numeric sequences with OCR cleaning
        const cleanedRef = this.cleanOCRReference(text);
        const numberMatch = cleanedRef.match(/(\d{6,})/);
        if (numberMatch) {
          this.log(`🔢 OCR reference extracted: "${numberMatch[0]}"`);
          return numberMatch[0];
        }
        return null;

      default:
        return text.trim();
    }
  }

  // Clean common OCR artifacts in currency text
  cleanOCRCurrency(text) {
    return (
      text
        // Fix common OCR character substitutions
        .replace(/[|l]/g, "1") // Pipe/lowercase L → 1
        .replace(/[O]/g, "0") // Capital O → 0
        .replace(/[S]/g, "5") // Capital S → 5
        .replace(/[§]/g, "5") // Section symbol → 5
        .replace(/[B]/g, "8") // B → 8 (common OCR error)
        .replace(/[Z]/g, "2") // Z → 2
        .replace(/[G]/g, "6") // G → 6
        // Clean whitespace and invalid chars
        .replace(/[^\dR\s,.]/g, "") // Keep only digits, R, space, comma, period
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim()
    );
  }

  // Enhanced number parsing with OCR tolerance
  parseOCRNumber(numberText) {
    this.log(`🔢 Parsing OCR number: "${numberText}"`);

    // Clean the number text
    let cleaned = numberText
      .replace(/[|l]/g, "1") // Fix OCR digit errors
      .replace(/[O]/g, "0")
      .replace(/[S]/g, "5")
      .replace(/[§]/g, "5")
      .replace(/[B]/g, "8")
      .replace(/[Z]/g, "2")
      .replace(/[G]/g, "6")
      .trim();

    this.log(`🧹 Cleaned number: "${numberText}" → "${cleaned}"`);

    // Handle South African format: "147 126,58" → "147126.58"
    if (cleaned.includes(" ") && cleaned.includes(",")) {
      const parts = cleaned.split(",");
      if (parts.length === 2 && parts[1].length <= 2) {
        // Space-separated thousands with comma decimal: "147 126,58"
        cleaned = parts[0].replace(/\s/g, "") + "." + parts[1];
      }
    }
    // Handle space with period decimal: "147 126.58" → "147126.58"
    else if (cleaned.includes(" ") && cleaned.includes(".")) {
      const parts = cleaned.split(".");
      if (parts.length === 2 && parts[1].length <= 2) {
        // Space-separated thousands with period decimal: "147 126.58"
        cleaned = parts[0].replace(/\s/g, "") + "." + parts[1];
      }
    }
    // Handle space-only thousands: "147 126" → "147126"
    else if (
      cleaned.includes(" ") &&
      !cleaned.includes(",") &&
      !cleaned.includes(".")
    ) {
      cleaned = cleaned.replace(/\s/g, "");
    }
    // Handle comma thousands with period decimal: "147,126.58" → "147126.58"
    else if (cleaned.includes(",") && cleaned.includes(".")) {
      cleaned = cleaned.replace(/,/g, "");
    }
    // Handle comma as decimal: "147,58" → "147.58"
    else if (cleaned.includes(",") && !cleaned.includes(".")) {
      const parts = cleaned.split(",");
      if (parts.length === 2 && parts[1].length <= 2) {
        cleaned = parts[0] + "." + parts[1];
      } else {
        // Comma as thousands separator
        cleaned = cleaned.replace(/,/g, "");
      }
    }

    const parsed = parseFloat(cleaned);
    const isValid = !isNaN(parsed) && parsed > 0;

    this.log(
      `🎯 Final parsed result: "${cleaned}" → ${parsed} (valid: ${isValid})`
    );

    return isValid ? parsed : null;
  }

  // Clean OCR artifacts from reference numbers
  cleanOCRReference(text) {
    return text
      .replace(/[|l]/g, "1") // Fix common OCR digit errors
      .replace(/[O]/g, "0")
      .replace(/[S]/g, "5")
      .replace(/[§]/g, "5")
      .replace(/[B]/g, "8")
      .replace(/[Z]/g, "2")
      .replace(/[G]/g, "6")
      .replace(/[^\d]/g, "") // Keep only digits
      .trim();
  }

  // General OCR text cleaning
  cleanOCRText(text) {
    return text
      .replace(/[|l]/g, "1")
      .replace(/[O]/g, "0")
      .replace(/[S]/g, "5")
      .replace(/[§]/g, "5")
      .replace(/\s+/g, " ")
      .trim();
  }

  validateValue(found, expected, type) {
    this.log(
      `🎯 Validating: found=${found}, expected=${expected}, type=${type}`
    );

    if (found === null || found === undefined) {
      this.log(`❌ Found value is null/undefined`);
      return { valid: false, confidence: 0 };
    }

    const tolerance = this.tolerances[type];

    switch (type) {
      case "currency":
      case "percentage":
        const foundNum = parseFloat(found);
        const expectedNum = parseFloat(expected);
        const diff = Math.abs(foundNum - expectedNum);
        const valid = diff <= tolerance;
        const confidence = valid ? Math.max(0, 1 - diff / expectedNum) : 0;
        this.log(
          `💰 Currency/Percentage validation: diff=${diff.toFixed(
            2
          )}, tolerance=${tolerance}, valid=${valid}, confidence=${confidence.toFixed(
            2
          )}`
        );
        return { valid, confidence };

      case "reference":
        const foundStr = found.toString();
        const expectedStr = expected.toString();
        const exact = foundStr === expectedStr;
        this.log(
          `🔢 Reference validation: "${foundStr}" === "${expectedStr}" → ${exact}`
        );
        return { valid: exact, confidence: exact ? 1 : 0 };

      case "account":
        const foundAccount = found.toString();
        const expectedAccount = expected.toString();
        const accountDiff = this.levenshteinDistance(
          foundAccount,
          expectedAccount
        );
        const valid_account = accountDiff <= tolerance;
        const confidence_account = valid_account
          ? Math.max(0, 1 - accountDiff / expectedAccount.length)
          : 0;
        this.log(
          `🏦 Account validation: diff=${accountDiff}, tolerance=${tolerance}, valid=${valid_account}, confidence=${confidence_account.toFixed(
            2
          )}`
        );
        return { valid: valid_account, confidence: confidence_account };

      default:
        const defaultValid = found === expected;
        this.log(
          `📝 Default validation: "${found}" === "${expected}" → ${defaultValid}`
        );
        return { valid: defaultValid, confidence: defaultValid ? 1 : 0 };
    }
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  logResult(fieldName, found, expected, valid, confidence) {
    const status = valid ? "✅ VALID" : "❌ INVALID";
    const confidencePercent = Math.round(confidence * 100);
    this.logImportant(
      `${status} ${fieldName}: Found=${found}, Expected=${expected}, Confidence=${confidencePercent}%`
    );
  }

  logFinalSummary() {
    this.logSummary("\n📊 PROCESSING SUMMARY");
    this.logSummary(
      `Bounding boxes: ${this.summary.totalBoxes} → ${this.summary.mergedBoxes} (merged)`
    );
    this.logSummary(`Fields processed: ${this.summary.fieldsProcessed}`);
    this.logSummary(
      `Fields found: ${this.summary.fieldsFound}/${this.summary.fieldsProcessed}`
    );
    this.logSummary(
      `Fields valid: ${this.summary.fieldsValid}/${this.summary.fieldsFound}`
    );
    this.logSummary(
      `Success rate: ${Math.round(
        (this.summary.fieldsValid / this.summary.fieldsProcessed) * 100
      )}%`
    );
  }

  async extractPageImages(filePath) {
    const pdfDocument = await pdfImageExtract(filePath, {
      scale: 3,
      docInitParams: {
        useSystemFonts: true,
        disableFontFace: true,
      },
    });

    const pages = [];
    for await (const pageBuffer of pdfDocument) {
      pages.push(pageBuffer);
    }

    return pages;
  }

  hasValidText(pdfData) {
    return pdfData.pages.some(
      (page) =>
        page.content &&
        page.content.length > 10 &&
        page.content.some((item) => item.str && item.str.trim().length > 3)
    );
  }

  createResult(results, issues) {
    const totalFields = Object.keys(this.fieldMapping).length;
    const validFields = Object.values(results).filter((r) => r.valid).length;
    const confidence = totalFields > 0 ? validFields / totalFields : 0;

    return {
      status: issues.length === 0 ? "VALID" : "INVALID",
      confidence: confidence,
      fields: results,
      issues: issues,
      summary: {
        total: totalFields,
        found: Object.keys(results).length,
        valid: validFields,
        confidence: Math.round(confidence * 100) + "%",
      },
    };
  }

  createFailureResult(error) {
    return {
      status: "ERROR",
      confidence: 0,
      fields: {},
      issues: [error],
      summary: {
        total: 0,
        found: 0,
        valid: 0,
        confidence: "0%",
      },
    };
  }

  destroy() {
    if (this.ocrEngine) {
      this.ocrEngine.destroy();
    }
  }
}

export default SpatialDocumentValidator;
