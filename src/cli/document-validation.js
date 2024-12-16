import { fuzzy } from "fast-fuzzy";
import { PDFExtract } from "pdf.js-extract";
import ValueNormalizer from "../validation/value-normalizer.js";
import HybridValidator from "../validation/hybrid-validator.js";
import { validationProfiles } from "../validation/validation-profiles.js";
import DocumentProcessor from "./document-processor.js";
import path from "path";

class DocumentValidationCLI {
  constructor() {
    this.pdfExtract = new PDFExtract();
    this.valueNormalizer = new ValueNormalizer();
    this.hybridValidator = new HybridValidator();
    this.documentProcessor = new DocumentProcessor({
      modelPath: path.join(process.cwd(), "eng.traineddata"),
      saveDebugImages: true,
      debugPath: path.join(process.cwd(), "debug_output"),
    });

    // normalized pages
    this.pages = [];

    // Add configurable matching thresholds
    this.matchingConfig = {
      labelMatchThreshold: 0.8,
      valueProximity: {
        maxHorizontalGap: 300,
        maxVerticalGap: 20,
        preferredGap: 50,
      },
    };

    // Define validation profiles
    this.validationProfiles = validationProfiles;
  }

  /**
   * Preprocess and normalize PDF pages
   */
  async preprocessPages(pdfData) {
    console.log("Preprocessing PDF pages...");
    this.pages = pdfData.pages.map((page, index) => {
      const normalized = this.normalizePageContent(page);
      console.log(`\nPreprocessed page ${index + 1}:`);
      console.log(`- Normalized ${normalized.length} content items`);
      return normalized;
    });
  }

  /**
   * Process document with validation against case model
   */
  async processDocument(filePath, caseModel) {
    try {
      console.log(`Processing document: ${filePath}`);

      // Initialize document processor
      await this.documentProcessor.initialize(
        path.join(process.cwd(), "eng.traineddata")
      );

      // Process document through pipeline
      const processedDoc = await this.documentProcessor.processDocument(
        filePath
      );
      console.log(
        `Document processed: ${
          processedDoc.isDigital ? "Digital" : "Scanned"
        } PDF`
      );

      // Preprocess pages with both digital and OCR content
      const normalizedContent = await this.prepareContentForValidation(
        processedDoc
      );
      console.log("Content prepared for validation");

      // Perform hybrid validation
      const results = await this.hybridValidator.validateDocument(
        normalizedContent,
        caseModel,
        processedDoc.isDigital
      );

      // Generate enhanced report
      const report = this.generateEnhancedReport(results, caseModel);

      // Log detailed results
      this.printResults(report, processedDoc);

      return report;
    } catch (error) {
      console.error("Document processing failed:", error);
      throw error;
    } finally {
      // Clean up resources
      this.documentProcessor.destroy();
    }
  }
  /**
   * Print detailed results for debugging
   */
  printResults(report, processedDoc) {
    console.log("\n=== Document Validation Results ===");
    console.log(`Status: ${report.status}`);
    console.log(
      `Overall Confidence: ${(report.confidence.overall * 100).toFixed(2)}%`
    );

    console.log("\nField Results:");
    for (const [field, value] of Object.entries(report.fields)) {
      const confidence = report.confidence.fields[field];
      console.log(`${field}:`);
      console.log(`  Value: ${value}`);
      console.log(
        `  Confidence: ${(confidence?.confidence * 100 || 0).toFixed(2)}%`
      );
      if (confidence?.source) {
        console.log(`  Source: ${confidence.source}`);
      }
    }

    if (report.issues.length > 0) {
      console.log("\nValidation Issues:");
      report.issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
      });
    }

    if (processedDoc.metadata?.hasSignatures) {
      console.log("\nSignature Verification:");
      processedDoc.pages.forEach((page, index) => {
        if (page.signatures.length > 0) {
          console.log(
            `Page ${index + 1}: ${page.signatures.length} signature(s) detected`
          );
        }
      });
    }
  }

  /**
   * Prepare content for validation combining digital and OCR data
   */
  async prepareContentForValidation(processedDoc) {
    const content = {
      pages: [],
      sections: {},
      metadata: {
        pageCount: processedDoc.pages.length,
        isDigital: processedDoc.isDigital,
        hasSignatures: processedDoc.metadata.hasSignatures,
      },
    };

    // Process each page's content
    processedDoc.pages.forEach((page, index) => {
      // Ensure page.boxes exists and is an array
      const boxes = Array.isArray(page.boxes) ? page.boxes : [];
      content.pages.push(boxes);

      // Log box statistics per page
      console.log(`\nPage ${index + 1} Statistics:`);
      console.log(`- Total boxes: ${boxes.length}`);
      console.log(
        `- Digital boxes: ${boxes.filter((b) => b.source === "digital").length}`
      );
      console.log(
        `- OCR boxes: ${boxes.filter((b) => b.source === "ocr").length}`
      );

      if (page.signatures && page.signatures.length > 0) {
        console.log(`- Signatures detected: ${page.signatures.length}`);
      }
    });

    // Identify document sections using updated content
    for (const [sectionName, config] of Object.entries(
      this.validationProfiles.paq.contentSections
    )) {
      const sectionContent = this.identifySection(config, content.pages);
      if (sectionContent) {
        content.sections[sectionName] = sectionContent;
        console.log(`\nSection identified: ${sectionName}`);
        console.log(`- Page: ${sectionContent.page}`);
        console.log(`- Content items: ${sectionContent.content.length}`);
      }
    }

    return content;
  }

  identifySection(sectionConfig, pages) {
    // Find section bounds using markers
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageBoxes = pages[pageIndex];

      // Skip if page has no content
      if (!Array.isArray(pageBoxes)) continue;

      // Look for section markers
      const markerFound = sectionConfig.markers.some((marker) =>
        pageBoxes.some((box) => box.text && box.text.includes(marker))
      );

      if (markerFound) {
        // Get content within expected bounds
        const pageHeight = Math.max(
          ...pageBoxes.map((box) => box.bounds.y + box.bounds.height)
        );

        const sectionContent = pageBoxes.filter((box) => {
          const relativeY = box.bounds.y / pageHeight;
          return (
            relativeY >= sectionConfig.expectedBounds.top &&
            relativeY <= sectionConfig.expectedBounds.bottom
          );
        });

        return {
          content: sectionContent,
          page: pageIndex,
          bounds: sectionConfig.expectedBounds,
        };
      }
    }

    return null;
  }

  isDigitalDocument(pdfData) {
    // Check if document has searchable text
    return pdfData.pages.some(
      (page) =>
        page.content &&
        page.content.length > 0 &&
        page.content.some((item) => item.str && item.str.trim().length > 0)
    );
  }

  /**
   * Generate enhanced report with processing details
   */
  generateEnhancedReport(results, caseModel) {
    const report = {
      status: results.valid ? "VALID" : "INVALID",
      fields: results.fields,
      confidence: {
        overall: results.confidence,
        fields: results.matches,
      },
      validation: {
        digital: results.metadata?.isDigital,
        matchingStrategy: results.metadata?.strategy,
        spatialVerification: results.metadata?.spatial,
      },
      issues: this.generateIssuesList(results, caseModel),
    };

    // Add processing metadata if available
    if (results.metadata?.processing) {
      report.processing = {
        enhancedRegions: results.metadata.processing.enhancedRegions || 0,
        ocrRetries: results.metadata.processing.ocrRetries || 0,
        signatureVerification:
          results.metadata.processing.signatureVerification || {},
      };
    }

    return report;
  }

  /**
   * Generate list of validation issues
   */
  generateIssuesList(results, caseModel) {
    const issues = [];

    // Check required fields
    for (const [field, config] of Object.entries(
      this.hybridValidator.fieldPriorities
    )) {
      if (config.required && !results.fields[field]) {
        issues.push(`Missing required field: ${field}`);
      }
    }

    // Add validation failures with context
    if (results.failures) {
      for (const failure of results.failures) {
        issues.push(this.formatValidationFailure(failure));
      }
    }

    return issues;
  }

  formatValidationFailure(failure) {
    // Format validation failures with clear context
    return (
      `${failure.field} validation failed: ${failure.reason}` +
      (failure.details ? ` (${failure.details})` : "")
    );
  }

  /**
   * Verify PDF structure
   */
  verifyPdfStructure(pdfData) {
    if (!pdfData || !Array.isArray(pdfData.pages)) {
      console.error("Invalid PDF data structure - missing pages array");
      return false;
    }

    if (pdfData.pages.length === 0) {
      console.error("PDF contains no pages");
      return false;
    }

    const hasValidContent = pdfData.pages.every(
      (page) => page && Array.isArray(page.content) && page.content.length > 0
    );

    if (!hasValidContent) {
      console.error("One or more pages have invalid content structure");
      return false;
    }

    return true;
  }

  /**
   * Debug page content structure
   */
  debugPageContent(page) {
    if (!page || !Array.isArray(page.content)) {
      console.log("Invalid page structure:", page);
      return;
    }

    console.log("\nPage Content Sample:");
    page.content.slice(0, 5).forEach((item, index) => {
      console.log(`\nItem ${index}:`, {
        text: item.str || "",
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        font: item.fontName,
        dir: item.dir,
      });
    });

    console.log("\nTotal content items:", page.content.length);
  }

  /**
   * Normalize page content from PDF extraction
   */
  normalizePageContent(page) {
    if (!page || !Array.isArray(page.content)) {
      console.warn("Invalid page content structure");
      return [];
    }

    try {
      const normalized = page.content
        .filter((item) => {
          // Verify item structure
          if (!item || typeof item !== "object") {
            console.warn("Invalid content item:", item);
            return false;
          }

          // Ensure required properties exist
          if (typeof item.str !== "string") {
            console.warn("Missing or invalid str property:", item);
            return false;
          }

          return true;
        })
        .map((item) => {
          // Safe property access with defaults
          const text = item.str.trim();
          const bounds = {
            x: Number(item.x) || 0,
            y: Number(item.y) || 0,
            width: Number(item.width) || 0,
            height: Number(item.height) || 0,
          };

          return {
            text,
            bounds,
            meta: {
              fontName: item.fontName || "unknown",
              dir: item.dir || "ltr",
            },
          };
        })
        .filter((item) => item.text.length > 0);

      // Debug normalized output
      console.log("\nNormalized Content Sample:");
      normalized.slice(0, 3).forEach((item, index) => {
        console.log(`\nNormalized Item ${index}:`, {
          text: item.text,
          bounds: item.bounds,
          meta: item.meta,
        });
      });

      return normalized;
    } catch (error) {
      console.error("Content normalization failed:", error);
      return [];
    }
  }

  /**
   * Validate document against case model using preprocessed pages
   */
  async validateDocument(pdfData, caseModel) {
    const results = {
      valid: true,
      fields: {},
      validation: {},
      issues: [],
    };

    try {
      // Validate global fields (present on all pages)
      const globalResults = await this.validateGlobalFields(
        this.pages,
        this.validationProfiles.paq.globalFields,
        caseModel
      );

      Object.assign(results.fields, globalResults.fields);
      results.issues.push(...globalResults.issues);

      // Find and validate sections
      for (const [sectionKey, section] of Object.entries(
        this.validationProfiles.paq.sections
      )) {
        const sectionPageIndex = this.findSectionPage(section.title);
        if (sectionPageIndex === -1) continue;

        const sectionResults = await this.validateSection(
          sectionPageIndex,
          section,
          caseModel
        );

        if (sectionResults) {
          Object.assign(results.fields, sectionResults.fields);
          Object.assign(results.validation, sectionResults.validation);
          results.issues.push(...sectionResults.issues);
        }
      }

      results.valid = results.issues.length === 0;
      return results;
    } catch (error) {
      console.error("Document validation failed:", error);
      throw error;
    }
  }

  /**
   * Validate fields that should appear on multiple pages
   */
  async validateGlobalFields(pages, globalFields, caseModel) {
    const results = {
      fields: {},
      issues: [],
    };

    for (const [fieldName, config] of Object.entries(globalFields)) {
      // For each page except last
      for (let pageIndex = 0; pageIndex < this.pages.length - 1; pageIndex++) {
        const fieldResult = await this.findField(pageIndex, config.labels);

        if (!fieldResult && config.required) {
          results.issues.push(`Missing ${fieldName} on page ${pageIndex + 1}`);
          continue;
        }

        if (fieldResult) {
          // Store first occurrence of field
          if (!results.fields[fieldName]) {
            results.fields[fieldName] = fieldResult.value;
          }

          // Cross validate with case model if specified
          if (config.crossMatch && caseModel[config.crossMatch]) {
            const isMatch = this.crossValidateValue(
              fieldResult.value,
              caseModel[config.crossMatch],
              config.type
            );

            if (!isMatch) {
              results.issues.push(
                `${fieldName} mismatch on page ${pageIndex + 1}: ` +
                  `expected ${caseModel[config.crossMatch]}, ` +
                  `found ${fieldResult.value}`
              );
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Validate specific section fields
   */
  async validateSection(pageIndex, section, caseModel) {
    const results = {
      fields: {},
      validation: {},
      issues: [],
    };

    // Extract and validate fields
    for (const [fieldName, config] of Object.entries(section.fields)) {
      const fieldResult = await this.findField(pageIndex, config.labels);

      if (!fieldResult && config.required) {
        results.issues.push(`Missing ${fieldName} in ${section.title}`);
        continue;
      }

      if (fieldResult) {
        // Normalize value based on type
        const normalized = await this.valueNormalizer.normalizeValue(
          fieldResult.value,
          config.type
        );

        results.fields[fieldName] = normalized.value;

        // Validate against case model
        const modelField = this.mapFieldToModel(fieldName, caseModel);
        if (modelField !== undefined) {
          const isValid = this.validateFieldValue(
            normalized.value,
            modelField,
            config
          );

          results.validation[fieldName] = isValid;

          if (!isValid) {
            results.issues.push(
              `${fieldName} mismatch in ${section.title}: ` +
                `expected ${modelField}, found ${normalized.value}`
            );
          }
        }
      }
    }

    return results;
  }

  /**
   * Find field in page content using preprocessed data
   */
  async findField(pageIndex, labels) {
    const content = this.pages[pageIndex];
    if (!content || content.length === 0) {
      console.warn(
        `No valid content found for field search on page ${pageIndex + 1}`
      );
      return null;
    }

    console.log(`\nSearching for labels on page ${pageIndex + 1}:`, labels);

    let bestMatch = null;
    let highestConfidence = 0;

    for (const label of labels) {
      for (const item of content) {
        try {
          const matchScore = fuzzy(
            label.toLowerCase(),
            item.text.toLowerCase()
          );

          if (matchScore > this.matchingConfig.labelMatchThreshold) {
            console.log(`\nPotential label match:`, {
              label,
              text: item.text,
              score: matchScore,
            });

            const value = this.findValueNearLabel(content, item);
            if (value) {
              const confidence = this.calculateMatchConfidence(
                matchScore,
                item.bounds,
                value.bounds
              );

              console.log("Found value:", {
                text: value.text,
                confidence,
              });

              if (confidence > highestConfidence) {
                highestConfidence = confidence;
                bestMatch = {
                  value: value.text,
                  bounds: value.bounds,
                  confidence,
                  matchData: {
                    label: item.text,
                    labelScore: matchScore,
                    labelBounds: item.bounds,
                  },
                };
              }
            }
          }
        } catch (error) {
          console.error("Error processing match:", error);
          continue;
        }
      }
    }

    if (bestMatch) {
      console.log("\nBest match:", bestMatch);
    } else {
      console.log("\nNo matches found");
    }

    return bestMatch;
  }

  /**
   * Find value near label with improved bounds checking
   */
  findValueNearLabel(content, label) {
    const { maxHorizontalGap, maxVerticalGap } =
      this.matchingConfig.valueProximity;
    const labelBounds = label.bounds;

    // Filter candidates by position
    const candidates = content.filter((item) => {
      if (item === label) return false;

      const bounds = item.bounds;
      const horizontalGap = bounds.x - (labelBounds.x + labelBounds.width);
      const verticalGap = Math.abs(bounds.y - labelBounds.y);

      // Must be after label horizontally and within vertical range
      const isCandidate =
        horizontalGap >= 0 &&
        horizontalGap < maxHorizontalGap &&
        verticalGap < maxVerticalGap;

      if (isCandidate) {
        console.log(
          `Found value candidate: "${item.text}" (gap: h=${horizontalGap}, v=${verticalGap})`
        );
      }

      return isCandidate;
    });

    // Sort by combined proximity score
    return candidates.sort((a, b) => {
      const aScore = this.calculateProximityScore(labelBounds, a.bounds);
      const bScore = this.calculateProximityScore(labelBounds, b.bounds);
      return bScore - aScore;
    })[0];
  }

  /**
   * Calculate proximity score with null checks
   */
  calculateProximityScore(labelBounds, valueBounds) {
    if (!labelBounds || !valueBounds) return 0;

    const { preferredGap } = this.matchingConfig.valueProximity;

    const horizontalGap = valueBounds.x - (labelBounds.x + labelBounds.width);
    const verticalGap = Math.abs(valueBounds.y - labelBounds.y);

    const horizontalScore = 1 / (1 + Math.abs(horizontalGap - preferredGap));
    const verticalScore = 1 / (1 + verticalGap);

    return horizontalScore * 0.7 + verticalScore * 0.3;
  }

  /**
   * Calculate overall match confidence based on label match and positioning
   */
  calculateMatchConfidence(labelScore, labelBounds, valueBounds) {
    const { maxHorizontalGap, maxVerticalGap, preferredGap } =
      this.matchingConfig.valueProximity;

    // Calculate positioning score
    const horizontalGap = valueBounds.x - (labelBounds.x + labelBounds.width);
    const verticalGap = Math.abs(valueBounds.y - labelBounds.y);

    // Penalize based on deviation from preferred positioning
    const horizontalScore = Math.max(
      0,
      1 - Math.abs(horizontalGap - preferredGap) / maxHorizontalGap
    );
    const verticalScore = Math.max(0, 1 - verticalGap / maxVerticalGap);

    // Weight the scores (label match is most important)
    const weights = {
      labelMatch: 0.6,
      horizontalPosition: 0.25,
      verticalPosition: 0.15,
    };

    return (
      labelScore * weights.labelMatch +
      horizontalScore * weights.horizontalPosition +
      verticalScore * weights.verticalPosition
    );
  }

  /**
   * Generate validation report
   */
  generateReport(results, caseModel) {
    const report = {
      status: results.valid ? "VALID" : "INVALID",
      fields: results.fields,
      validation: results.validation,
      issues: results.issues,
    };

    return report;
  }

  /**
   * Find section page using preprocessed content
   */
  findSectionPage(title) {
    return this.pages.findIndex((page) =>
      page.some((item) => item.text.includes(title))
    );
  }

  mapFieldToModel(fieldName, caseModel) {
    // Map document field names to case model fields
    const fieldMap = {
      payoutAmount: "loanAmount",
      initiationFee: "initiationFee",
      monthlyServiceFee: "serviceFee",
      monthlyInstalment: "instalment",
      annualInterestRate: "interestRate",
      creditLifeInsurance: "insurancePremium",
      bank: "collectionBank",
      accountNumber: "collectionAccountNo",
    };

    return caseModel[fieldMap[fieldName]];
  }

  validateFieldValue(value, modelValue, config) {
    if (config.type === "currency" && config.variance) {
      return Math.abs(value - modelValue) <= config.variance;
    }
    return value === modelValue;
  }

  crossValidateValue(value, modelValue, type) {
    if (type === "text") {
      return value.replace(/\s+/g, "") === modelValue.replace(/\s+/g, "");
    }
    return value === modelValue;
  }
}

export default DocumentValidationCLI;
