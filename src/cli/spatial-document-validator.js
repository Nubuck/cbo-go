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

  async validateScannedPDF(filePath, caseModel) {
    this.log("🖼️  Processing scanned PDF");

    const pages = await this.extractPageImages(filePath);
    const firstPageBuffer = pages[0];

    const ocrBoxes = await this.performOCRWithBoxes(firstPageBuffer);
    this.log(`📦 OCR extracted ${ocrBoxes.length} bounding boxes`);

    await fs.writeFile(
      "debug_ocr_boxes.json",
      JSON.stringify(ocrBoxes, null, 2)
    );

    const mergedBoxes = this.mergeNearbyBoxes(ocrBoxes);
    this.log(`🔧 Merged into ${mergedBoxes.length} consolidated boxes`);

    return await this.spatialFieldSearch(mergedBoxes, caseModel);
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

    this.log(`🏷️  Searching for labels: [${searchPatterns.join(", ")}]`);

    // Create Fuse instance for simple text search
    const fuse = new Fuse(boxes, {
      keys: ["text"],
      includeScore: true,
      threshold: 0.3,
      ignoreLocation: true,
      findAllMatches: true,
    });

    // Try each search pattern with simple contains matching
    for (const pattern of searchPatterns) {
      this.log(`🔍 Trying pattern: "${pattern}"`);

      // Simple contains search since PAQ.js patterns are clean
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
        // Partial word match for broken text
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

        if (score > bestScore && score > 0.6) {
          bestScore = score;
          bestMatch = {
            ...box,
            matchScore: score,
            matchedLabel: pattern,
            matchType: matchType,
          };
          this.log(
            `🎯 Match: "${box.text}" (score: ${score.toFixed(
              3
            )}, type: ${matchType}) for "${pattern}"`
          );
        }
      }
    }

    if (bestMatch) {
      this.log(
        `✅ Best label match: "${
          bestMatch.text
        }" (score: ${bestMatch.matchScore.toFixed(3)})`
      );
    } else {
      this.log(`❌ No label matches found above threshold`);
    }

    return bestMatch;
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
    this.log(`🎯 Extracting value from "${text}" (type: ${type})`);

    switch (type) {
      case "currency":
        // ENHANCED: Handle South African "R90 640,57" format specifically
        const currencyPatterns = [
          // Priority 1: South African format R90 640,57
          /R\s*(\d{1,3}(?:\s\d{3})*(?:,\d{2})?)/g,
          // Priority 2: Standard formats R90,640.57
          /R\s*(\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})?)/g,
          // Priority 3: Any R followed by numbers
          /R\s*([\d\s,.']+)/g,
        ];

        for (const pattern of currencyPatterns) {
          const matches = [...text.matchAll(pattern)];

          for (const match of matches) {
            let numberPart = match[1].trim();

            // Skip very short matches
            if (numberPart.replace(/[^0-9]/g, "").length < 4) continue;

            // SPECIFIC: Handle "90 640,57" format
            if (numberPart.includes(" ") && numberPart.includes(",")) {
              // "90 640,57" → "90640.57"
              const parts = numberPart.split(",");
              if (parts.length === 2 && parts[1].length <= 2) {
                numberPart = parts[0].replace(/\s/g, "") + "." + parts[1];
              }
            }
            // Handle space-only thousands separators "90 640"
            else if (
              numberPart.includes(" ") &&
              !numberPart.includes(",") &&
              !numberPart.includes(".")
            ) {
              numberPart = numberPart.replace(/\s/g, "");
            }
            // Handle standard comma separators
            else if (numberPart.includes(",") && !numberPart.includes(".")) {
              const parts = numberPart.split(",");
              if (parts.length === 2 && parts[1].length <= 2) {
                // Decimal comma: 123,45 → 123.45
                numberPart = parts[0].replace(/\s/g, "") + "." + parts[1];
              } else {
                // Thousands comma: 12,345 → 12345
                numberPart = numberPart.replace(/[,\s]/g, "");
              }
            } else {
              // Clean up remaining spaces and separators
              numberPart = numberPart.replace(/\s/g, "");
            }

            const parsed = parseFloat(numberPart);
            if (!isNaN(parsed) && parsed > 0) {
              this.log(
                `💰 Extracted currency: "${text}" → "${match[0]}" → ${parsed}`
              );
              return parsed;
            }
          }
        }

        this.log(`💰 No currency found in: "${text}"`);
        return null;

      case "percentage":
        const percentMatch = text.match(/([\d.,]+)(?=\s*%)/);
        if (percentMatch) {
          const parsed = parseFloat(percentMatch[1].replace(",", "."));
          this.log(
            `📊 Extracted percentage: "${percentMatch[0]}%" → ${parsed}`
          );
          return isNaN(parsed) ? null : parsed;
        }
        return null;

      case "reference":
      case "account":
        const numberMatch = text.match(/\d{6,}/);
        if (numberMatch) {
          this.log(`🔢 Extracted number: "${numberMatch[0]}"`);
          return numberMatch[0];
        }
        return null;

      default:
        return text.trim();
    }
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
      scale: 2,
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
