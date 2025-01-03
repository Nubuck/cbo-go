import { fuzzy } from "fast-fuzzy";
import Fuse from "fuse.js";
import ValueNormalizer from "./value-normalizer.js";
import { promises as fs } from "node:fs";
import path from "path";

class HybridValidator {
  constructor(options = {}) {
    // Debug logging configuration
    this.debug = {
      enabled: true,
      logPath: options.debugPath || path.join(process.cwd(), "debug_output"),
      logFile: "processing.log",
    };

    this.valueNormalizer = new ValueNormalizer();
    this.fuzzyConfig = {
      currency: {
        tolerance: 0.05,
        ignoreFormatting: true,
        patterns: [/^R?\s*[\d,\s]+\.?\d*$/i],
      },
      percentage: {
        tolerance: 0.001,
        ignoreFormatting: true,
        patterns: [/^[\d,\.]+\s*%$/],
      },
      text: {
        threshold: 0.8,
        caseInsensitive: true,
        patterns: [/.+/],
      },
      reference: {
        threshold: 0.9,
        exactMatch: true,
        patterns: [/^\d{10}$/, /^[A-Z0-9]{8,12}$/],
      },
      bankName: {
        threshold: 0.6,
        caseInsensitive: true,
        minLength: 3,
        patterns: [/^[A-Za-z\s]{2,20}$/],
      },
      accountNumber: {
        digital: { tolerance: 0 },
        ocr: { tolerance: 1 },
        patterns: [/^\d{6,12}$/, /^[\d\s-]{8,14}$/],
      },
    };

    // Updated field priorities with removed product validation
    this.fieldPriorities = {
      caseId: { weight: 1.0, required: true },
      loanAmount: { weight: 1.0, required: true },
      instalment: { weight: 0.8, required: true },
      interestRate: { weight: 0.7, required: true },
      insurancePremium: { weight: 0.6, required: true },
      collectionAccountNo: { weight: 0.8, required: true }, // Increased priority
      serviceFee: { weight: 0.4, required: false },
      initiationFee: { weight: 0.4, required: false },
      collectionBank: { weight: 0.2, required: false }, // Reduced priority
    };

    // Field types with updated priorities
    this.fieldTypes = {
      loanAmount: { type: "currency", required: true, priority: 1.0 },
      initiationFee: { type: "currency", required: true, priority: 0.8 },
      serviceFee: { type: "currency", required: true, priority: 0.8 },
      instalment: { type: "currency", required: true, priority: 0.9 },
      interestRate: { type: "percentage", required: true, priority: 0.9 },
      insurancePremium: { type: "currency", required: true, priority: 0.8 },
      collectionBank: { type: "bankName", required: false, priority: 0.2 }, // Updated
      collectionAccountNo: {
        type: "accountNumber",
        required: true,
        priority: 0.8,
      },
      caseId: { type: "reference", required: true, priority: 1.0 },
      clientIdNo: { type: "reference", required: true, priority: 0.9 },
    };

    // Define value indicators for hunting
    this.valueIndicators = {
      currency: ["R", "$", ".00", ",00", "amount", "fee", "payment"],
      percentage: ["%", "percent", "rate", "interest"],
      reference: ["ref", "reference", "number", "no"],
      accountNumber: ["account", "acc no", "acc number"],
      bankName: ["bank", "institution", "branch"],
    };

    // Add section markers for account details
    this.sectionMarkers = {
      accountDetails: [
        "AUTHORITY TO DEBIT YOUR ACCOUNT",
        "PERSONAL LOAN - AUTHORITY",
        "PAYMENT OF INSTALMENTS",
      ],
    };

    // Enhanced patterns for account detection
    this.accountPatterns = {
      accountNumber: {
        markers: ["Account number", "Account No", "Acc No", "Account Number"],
        patterns: [
          /Account\s+(?:number|no)[:\s]+(\d[\d\s-]*\d)/i,
          /Acc\s+(?:number|no)[:\s]+(\d[\d\s-]*\d)/i,
          /Account:\s*(\d[\d\s-]*\d)/i,
        ],
      },
      bank: {
        markers: ["Bank", "Branch", "Institution"],
      },
    };

    this.referencePatterns = {
      quote: {
        markers: ["Quote ref number", "Quote reference", "Quote ref"],
        patterns: [
          /Quote ref\s*(?:number)?[:\s]+(\d{10})/i,
          /Quote ref(?:erence)?\s*(?:number)?[:\s]+(\d{10})/i,
          /Quote ref[:\s]+(\d{10})/i,
        ],
      },
      case: {
        markers: ["Case reference no", "Case ref no", "Case reference number"],
        patterns: [
          /Case reference no[:\s]+(\d{10})/i,
          /Case ref\s*(?:no)?[:\s]+(\d{10})/i,
          /Case ref(?:erence)?\s*(?:no)?[:\s]+(\d{10})/i,
        ],
      },
    };

    // Footer validation config
    this.footerConfig = {
      maxDistance: 100, // px from bottom
      required: true,
      minMatches: 4, // Number of pages that must have matching reference
    };

    // Search configurations
    this.searchConfigs = {
      strict: {
        includeScore: true,
        threshold: 0.3,
        useExtendedSearch: true,
        keys: ["text"],
      },
      wide: {
        includeScore: true,
        threshold: 0.4,
        keys: ["text"],
      },
    };

    // Known values to hunt for with OCR variations
    this.knownValues = {
      caseId: {
        quoteRef: {
          labels: [
            `'"Quote ref number"`,
            `'"Quote reference"`,
            "Quats ref numper",
            "Quote ref",
            "=Quote =ref",
          ],
          position: "right",
          section: "header",
        },
        caseRef: {
          labels: [
            `'"Case reference no"`,
            `=case =no`,
            "Casa reference",
            "Case ref",
          ],
          position: "right",
          required: true,
          multiPage: true,
        },
      },
      accountNo: {
        label: [
          `'"Account number"`,
          "Acc no",
          "Account no",
          "=Account =number",
        ],
        position: "right",
        section: "AUTHORITY TO DEBIT YOUR ACCOUNT",
      },
    };
  }

  info(message, data = null) {
    this.log(message, "INFO", data);
  }
  warn(message, data = null) {
    this.log(message, "WARN", data);
  }
  err(message, data = null) {
    this.log(message, "ERROR", data);
  }

  log(message, level = "INFO", data = null) {
    if (!this.debug.enabled) return;

    const timestamp = new Date().toISOString();
    const logMessage = `HybridValidator: [${timestamp}] ${level}: ${message}${
      data ? "\nData: " + JSON.stringify(data, null, 2) : ""
    }\n`;

    // Console output
    console.log(logMessage);

    // File output
    fs.appendFile(
      path.join(this.debug.logPath, this.debug.logFile),
      logMessage
    ).catch(this.err);
  }

  async validateDocument(extractedContent, caseModel, isDigital = true) {
    const results = {
      valid: true,
      confidence: 1.0,
      fields: {},
      matches: {},
      issues: [],
    };

    try {
      // Skip validation of non-critical fields
      const criticalFields = Object.entries(caseModel).filter(
        ([field]) => this.fieldPriorities[field]?.required
      );

      for (const [field, value] of criticalFields) {
        if (field === "product") continue;

        const match = await this.findKnownValue(
          extractedContent,
          field,
          value,
          isDigital
        );

        if (match) {
          // Get field type and isOCR flag
          const fieldType =
            this.fieldTypes[field]?.type ||
            this.determineFieldType(field, value);
          const isOCR = !isDigital || match.source === "ocr";

          // Normalize and compare values
          const normalizedMatch = this.valueNormalizer.normalizeValue(
            match.value,
            fieldType,
            isOCR
          );
          const normalizedExpected = this.valueNormalizer.normalizeValue(
            value,
            fieldType,
            false
          );

          const comparison = this.compareNormalizedValues(
            normalizedMatch,
            normalizedExpected,
            fieldType,
            isOCR
          );

          // Store results
          results.fields[field] = normalizedMatch.value;
          results.matches[field] = {
            ...match,
            normalizedValue: normalizedMatch.value,
            expectedValue: normalizedExpected.value,
            confidence: comparison.confidence,
          };

          // Add validation issues if comparison failed
          if (comparison.confidence < 0.8) {
            results.issues.push({
              field,
              type: "value_mismatch",
              found: match.value,
              expected: value,
              normalized: {
                found: normalizedMatch.value,
                expected: normalizedExpected.value,
              },
              reason: comparison.reason,
              confidence: comparison.confidence,
            });
          }

          results.confidence *= comparison.confidence;
        } else if (this.fieldPriorities[field]?.required) {
          results.valid = false;
          results.issues.push({
            field,
            type: "missing_field",
            reason: `Required field ${field} not found`,
          });
        }
      }

      // Set valid flag based on issues
      results.valid = results.issues.length === 0;

      return results;
    } catch (error) {
      this.err("Validation failed:", error);
      throw error;
    }
  }

  compareNormalizedValues(
    normalizedFound,
    normalizedExpected,
    fieldType,
    isOCR
  ) {
    if (!normalizedFound.value || !normalizedExpected.value) {
      return {
        confidence: 0,
        reason: "normalization_failed",
      };
    }

    switch (fieldType) {
      case "currency":
      case "percentage": {
        const tolerance = isOCR ? 0.05 : 0.001;
        const diff = Math.abs(normalizedFound.value - normalizedExpected.value);
        const percentDiff = diff / normalizedExpected.value;

        // Check for decimal shift errors
        const decimalShiftDiff =
          Math.abs(normalizedFound.value * 100 - normalizedExpected.value) /
          normalizedExpected.value;

        if (decimalShiftDiff < tolerance) {
          return {
            confidence: 0.8, // Lower confidence for decimal shift fixes
            reason: "decimal_shift_corrected",
            value: normalizedFound.value * 100,
          };
        }

        return {
          confidence:
            percentDiff <= tolerance ? 1 - percentDiff / tolerance : 0,
          reason: percentDiff <= tolerance ? "match" : "value_mismatch",
        };
      }

      case "reference": {
        const isMatch = normalizedFound.value === normalizedExpected.value;
        return {
          confidence: isMatch ? 1.0 : 0,
          reason: isMatch ? "exact_match" : "reference_mismatch",
        };
      }

      default:
        return {
          confidence:
            normalizedFound.confidence * normalizedExpected.confidence,
          reason: "default_comparison",
        };
    }
  }

  determineFieldType(field, value) {
    // First check field type from configuration
    if (this.fieldTypes[field]) {
      return this.fieldTypes[field].type;
    }

    // Analyze value and context
    const valueStr = String(value).toLowerCase();

    // Check contextual indicators
    for (const [type, indicators] of Object.entries(this.valueIndicators)) {
      if (
        indicators.some((indicator) =>
          valueStr.includes(indicator.toLowerCase())
        )
      ) {
        return type;
      }
    }

    // Pattern-based detection
    if (/^R?\s*[\d.,]+/.test(valueStr)) return "currency";
    if (/[\d.,]+\s*%/.test(valueStr)) return "percentage";
    if (/^\d{10}$/.test(valueStr)) return "reference";
    if (/^\d{6,12}$/.test(valueStr)) return "accountNumber";

    return "text";
  }

  async findKnownValue(content, field, expectedValue, isDigital) {
    if (field === "caseId") {
      return await this.validateCaseReferences(
        content,
        expectedValue,
        isDigital
      );
    }

    if (field === "collectionAccountNo") {
      return await this.findAccountNumber(content, expectedValue, isDigital);
    }

    // Original findKnownValue logic for other fields
    const fieldConfig = this.fieldTypes[field];
    const fieldType =
      fieldConfig?.type || this.determineFieldType(field, expectedValue);
    const config = this.fuzzyConfig[fieldType];

    if (!config) {
      this.warn(`No fuzzy config for field type: ${fieldType}`);
      return null;
    }

    let bestMatch = null;
    let highestScore = 0;

    for (const page of content.pages) {
      for (const item of page) {
        try {
          // Skip items with no text
          if (!item?.text) continue;

          // Skip invalid content based on field type rules
          if (!this.isValidCandidate(item.text, fieldType, config)) {
            continue;
          }

          const matchScore = this.compareValues(
            item.text,
            String(expectedValue), // Ensure string conversion
            fieldType,
            isDigital
          );

          // Use field-specific threshold if available
          const threshold = isDigital
            ? config.threshold || 0.8
            : config.threshold || 0.6;

          if (
            matchScore.score > highestScore &&
            matchScore.score >= threshold
          ) {
            bestMatch = {
              value: this.normalizeValue(item.text, fieldType),
              confidence: matchScore.score,
              bounds: item.bounds,
              page: content.pages.indexOf(page),
            };
            highestScore = matchScore.score;
          }
        } catch (error) {
          this.warn(`Error comparing values for ${field}:`, error);
          continue;
        }
      }
    }

    return bestMatch;
  }

  async findValueNearLabel(
    page,
    labelItem,
    expectedValue,
    position,
    isDigital
  ) {
    const bounds = labelItem.bounds;
    const searchArea =
      position === "right"
        ? {
            left: bounds.x + bounds.width,
            right: bounds.x + bounds.width + 200,
            top: bounds.y - 10,
            bottom: bounds.y + bounds.height + 10,
          }
        : {
            left: Math.max(0, bounds.x - 200),
            right: bounds.x,
            top: bounds.y - 10,
            bottom: bounds.y + bounds.height + 10,
          };

    // Find all candidates in search area
    const candidates = page.filter((item) => {
      const itemBounds = item.bounds;
      return (
        itemBounds.x >= searchArea.left &&
        itemBounds.x <= searchArea.right &&
        itemBounds.y >= searchArea.top &&
        itemBounds.y <= searchArea.bottom
      );
    });

    // For exact values we're hunting, try direct match first
    if (expectedValue) {
      const exactMatches = candidates.filter(
        (item) =>
          this.normalizeValue(item.text) === this.normalizeValue(expectedValue)
      );
      if (exactMatches.length > 0) {
        return {
          value: expectedValue,
          bounds: exactMatches[0].bounds,
          confidence: 1,
        };
      }
    }

    // Try fuzzy matching if no exact match
    for (const candidate of candidates) {
      const normalizedCandidate = this.normalizeValue(candidate.text);
      const normalizedExpected = this.normalizeValue(expectedValue);

      const score = fuzzy(normalizedCandidate, normalizedExpected, {
        useExtendedSearch: true,
      });

      if (score > (isDigital ? 0.9 : 0.7)) {
        return {
          value: normalizedCandidate,
          bounds: candidate.bounds,
          confidence: score,
        };
      }
    }

    return null;
  }

  async validateCaseReferences(content, expectedValue, isDigital) {
    try {
      // First find quote reference on first page
      const firstPage = content.pages[0];

      // Try strict search first
      let fusePrimary = new Fuse(firstPage, this.searchConfigs.strict);
      let quoteRef = null;

      // Search for quote reference
      for (const pattern of this.knownValues.caseId.quoteRef.labels) {
        if (quoteRef) break;

        const results = fusePrimary.search(pattern);
        for (const result of results) {
          // Look for expected value near label
          const number = await this.findValueNearLabel(
            firstPage,
            result.item,
            expectedValue,
            this.knownValues.caseId.quoteRef.position,
            isDigital
          );

          if (number && number.value === expectedValue) {
            quoteRef = {
              value: number.value,
              bounds: number.bounds,
              confidence: 1 - result.score,
              page: 0,
            };
            break;
          }
        }
      }

      // Try wide search if no match
      if (!quoteRef) {
        const fuseWide = new Fuse(firstPage, this.searchConfigs.wide);
        for (const pattern of this.knownValues.caseId.quoteRef.labels) {
          if (quoteRef) break;

          const results = fuseWide.search(pattern);
          for (const result of results) {
            const number = await this.findValueNearLabel(
              firstPage,
              result.item,
              expectedValue,
              this.knownValues.caseId.quoteRef.position,
              isDigital
            );

            if (number && number.value === expectedValue) {
              quoteRef = {
                value: number.value,
                bounds: number.bounds,
                confidence: 0.8 * (1 - result.score), // Lower confidence for wide match
                page: 0,
              };
              break;
            }
          }
        }
      }

      // Look for case references in footers
      const caseRefs = [];
      for (
        let pageIndex = 0;
        pageIndex < content.pages.length - 1;
        pageIndex++
      ) {
        const page = content.pages[pageIndex];
        const pageHeight = Math.max(
          ...page.map((p) => p.bounds.y + p.bounds.height)
        );

        // Create Fuse instance for current page
        const fusePage = new Fuse(page, this.searchConfigs.strict);
        let foundOnPage = false;

        // Look for case ref markers
        for (const pattern of this.knownValues.caseId.caseRef.labels) {
          if (foundOnPage) break;

          const results = fusePage.search(pattern);
          for (const result of results) {
            // Only look in footer area
            if (result.item.bounds.y / pageHeight < 0.7) continue;

            const number = await this.findValueNearLabel(
              page,
              result.item,
              expectedValue,
              this.knownValues.caseId.caseRef.position,
              isDigital
            );

            if (number && number.value === expectedValue) {
              caseRefs.push({
                value: number.value,
                bounds: number.bounds,
                confidence: 1 - result.score,
                page: pageIndex,
              });
              foundOnPage = true;
              break;
            }
          }
        }
      }

      // Validate we found enough matching references
      if (quoteRef && caseRefs.length >= 3) {
        return {
          value: quoteRef.value,
          bounds: quoteRef.bounds,
          confidence: Math.min(
            quoteRef.confidence,
            ...caseRefs.map((ref) => ref.confidence)
          ),
          page: quoteRef.page,
          validation: {
            quoteRef: true,
            caseRefs: caseRefs.length,
            totalPages: content.pages.length,
          },
        };
      }

      return null;
    } catch (error) {
      this.err("Case reference validation failed:", error);
      return null;
    }
  }

  async findAccountNumber(content, expectedValue, isDigital) {
    try {
      // First, locate the account details section
      let accountSection = null;
      let sectionPage = -1;

      // Search for section markers
      for (let pageIndex = 0; pageIndex < content.pages.length; pageIndex++) {
        const page = content.pages[pageIndex];
        for (const item of page) {
          if (!item.text) continue;

          const isMarker = this.sectionMarkers.accountDetails.some((marker) =>
            item.text.includes(marker)
          );

          if (isMarker) {
            // Found the section, search within next ~20 items or until next major heading
            accountSection = {
              startIndex: page.indexOf(item),
              items: page.slice(page.indexOf(item), page.indexOf(item) + 20),
            };
            sectionPage = pageIndex;
            break;
          }
        }
        if (accountSection) break;
      }

      if (!accountSection) {
        this.warn("Account details section not found");
        return null;
      }

      // Search for account number within the section
      let bestMatch = null;
      let highestConfidence = 0;

      for (const item of accountSection.items) {
        // Skip items without text
        if (!item.text) continue;

        // Check for account number patterns
        for (const pattern of this.accountPatterns.accountNumber.patterns) {
          const match = item.text.match(pattern);
          if (match) {
            const extractedNumber = match[1].replace(/[\s-]/g, "");
            const confidence = this.compareAccountNumbers(
              extractedNumber,
              expectedValue,
              isDigital
            );

            if (confidence > highestConfidence) {
              bestMatch = {
                value: extractedNumber,
                confidence: confidence,
                bounds: item.bounds,
                page: sectionPage,
              };
              highestConfidence = confidence;
            }
          }
        }

        // Also check if the item itself is just the account number
        if (/^\d[\d\s-]*\d$/.test(item.text)) {
          const extractedNumber = item.text.replace(/[\s-]/g, "");
          const confidence = this.compareAccountNumbers(
            extractedNumber,
            expectedValue,
            isDigital
          );

          if (confidence > highestConfidence) {
            bestMatch = {
              value: extractedNumber,
              confidence: confidence,
              bounds: item.bounds,
              page: sectionPage,
            };
            highestConfidence = confidence;
          }
        }
      }

      return bestMatch;
    } catch (error) {
      this.err("Account number search failed:", error);
      return null;
    }
  }

  compareAccountNumbers(found, expected, isDigital) {
    // Remove any formatting
    const cleanFound = String(found).replace(/[\s-]/g, "");
    const cleanExpected = String(expected).replace(/[\s-]/g, "");

    if (isDigital) {
      // For digital documents, require exact match
      return cleanFound === cleanExpected ? 1 : 0;
    } else {
      // For OCR, allow for minor differences
      const maxErrors = Math.floor(cleanExpected.length * 0.1); // Allow up to 10% errors
      let errors = 0;

      for (let i = 0; i < cleanExpected.length; i++) {
        if (cleanFound[i] !== cleanExpected[i]) errors++;
      }

      return errors <= maxErrors ? 1 - errors / cleanExpected.length : 0;
    }
  }

  isValidCandidate(text, fieldType, config) {
    // Basic validation
    if (!text || text.length < (config.minLength || 1)) {
      return false;
    }

    // Pattern matching
    if (config.patterns) {
      return config.patterns.some((pattern) => pattern.test(text));
    }

    return true;
  }

  normalizeValue(value) {
    if (!value) return "";
    return String(value)
      .replace(/\s+/g, "")
      .replace(/[^\w\d]/g, "")
      .toLowerCase();
  }

  normalizeValuePrevious(value, fieldType) {
    switch (fieldType) {
      case "currency":
        return value.replace(/\s+/g, " ").trim();
      case "percentage":
        return value.replace(/\s+/g, "").trim();
      case "reference":
        return value.replace(/\s+/g, "");
      case "bankName":
        return value.trim();
      case "accountNumber":
        return value.replace(/[\s-]/g, "");
      default:
        return value.trim();
    }
  }

  compareValues(found, expected, fieldType, isDigital) {
    // Ensure both values exist and convert to strings
    if (found == null || expected == null) {
      return { score: 0, reason: "missing_value" };
    }

    found = String(found);
    expected = String(expected);

    const config = this.fuzzyConfig[fieldType];

    try {
      switch (fieldType) {
        case "currency": {
          // Clean and normalize currency values
          const foundNum = this.normalizeCurrencyToNumber(found);
          const expectedNum =
            typeof expected === "number"
              ? expected
              : this.normalizeCurrencyToNumber(expected);

          if (isNaN(foundNum) || isNaN(expectedNum)) {
            return {
              score: 0,
              reason: `invalid_number: found=${found}, expected=${expected}`,
            };
          }

          const percentDiff = Math.abs((foundNum - expectedNum) / expectedNum);
          return {
            score:
              percentDiff <= this.fuzzyConfig.currency.tolerance
                ? 1 - percentDiff / this.fuzzyConfig.currency.tolerance
                : 0,
            reason: "match",
            normalizedFound: foundNum,
            normalizedExpected: expectedNum,
          };
        }

        case "percentage": {
          // Clean and normalize percentage values
          const foundNum = this.normalizePercentageToNumber(found);
          const expectedNum =
            typeof expected === "number"
              ? expected
              : this.normalizePercentageToNumber(expected);

          if (isNaN(foundNum) || isNaN(expectedNum)) {
            return {
              score: 0,
              reason: `invalid_percentage: found=${found}, expected=${expected}`,
            };
          }

          const diff = Math.abs(foundNum - expectedNum);
          return {
            score: diff <= this.fuzzyConfig.percentage.tolerance ? 1 : 0,
            reason: "match",
            normalizedFound: foundNum,
            normalizedExpected: expectedNum,
          };
        }

        case "reference": {
          if (!found || !expected) {
            return { score: 0, reason: "empty_value" };
          }

          const normalizedFound = found.replace(/\s+/g, "");
          const normalizedExpected = expected.replace(/\s+/g, "");

          if (config.exactMatch) {
            return {
              score: normalizedFound === normalizedExpected ? 1 : 0,
              reason: "exact_match",
            };
          }

          return {
            score: fuzzy(normalizedFound, normalizedExpected),
            reason: "fuzzy_match",
          };
        }

        case "bankName": {
          if (!found || !expected) {
            return { score: 0, reason: "empty_value" };
          }

          // Avoid matching single characters or punctuation
          if (found.length < (config.minLength || 3)) {
            return { score: 0, reason: "too_short" };
          }

          const score = fuzzy(
            config.caseInsensitive ? found.toLowerCase() : found,
            config.caseInsensitive ? expected.toLowerCase() : expected
          );

          return { score, reason: "fuzzy_match" };
        }

        case "text":
        default: {
          if (!found || !expected) {
            return { score: 0, reason: "empty_value" };
          }

          const score = fuzzy(
            config.caseInsensitive ? found.toLowerCase() : found,
            config.caseInsensitive ? expected.toLowerCase() : expected
          );

          return { score, reason: "fuzzy_match" };
        }
      }
    } catch (error) {
      this.err(`Comparison failed for ${fieldType}:`, error);
      return { score: 0, reason: "error" };
    }
  }
  normalizeCurrencyToNumber(value) {
    if (typeof value === "number") return value;

    // Remove currency symbols and clean string
    const cleaned = String(value)
      .toLowerCase()
      .replace(/[r$]/i, "")
      .replace(/\s+/g, "")
      .replace(/,(\d{2})$/, ".$1") // Handle comma as decimal separator
      .replace(/[,\']/g, ""); // Remove other separators

    const number = parseFloat(cleaned);

    if (isNaN(number)) {
      console.warn(`Failed to normalize currency value: ${value}`);
    }

    return number;
  }

  normalizePercentageToNumber(value) {
    if (typeof value === "number") return value;

    // Clean percentage string
    const cleaned = String(value)
      .replace(/\s+/g, "")
      .replace(/[%]/g, "")
      .replace(/,/g, ".");

    const number = parseFloat(cleaned);

    if (isNaN(number)) {
      this.warn(`Failed to normalize percentage value: ${value}`);
    }

    return number;
  }

  parseNumber(value) {
    if (value == null) return NaN;

    // Handle both period and comma decimal separators
    let processed = String(value)
      .replace(/[R$]/g, "")
      .replace(/\s/g, "")
      .replace(/(\d+),(\d{2})$/, "$1.$2") // Convert trailing comma to period
      .replace(/[,]/g, ""); // Remove other commas

    return parseFloat(processed);
  }

  parsePercentage(value) {
    if (value == null) return NaN;

    // Remove percentage sign and spaces
    const processed = String(value).replace(/[%\s]/g, "").replace(/,/g, ".");

    return parseFloat(processed);
  }

  countDigitDifferences(str1, str2) {
    if (str1.length !== str2.length) return Infinity;

    let differences = 0;
    for (let i = 0; i < str1.length; i++) {
      if (str1[i] !== str2[i]) differences++;
    }
    return differences;
  }

  validateFieldPosition(match, content) {
    if (!match?.bounds || !content?.sections) return false;

    // Find containing section
    const containingSection = this.findContainingSection(
      match.bounds,
      content.sections
    );

    if (!containingSection) return false;

    // Calculate relative position within section
    const relativeY =
      (match.bounds.y - containingSection.bounds.y) /
      containingSection.bounds.height;

    // Score position based on expected location
    return {
      valid: true,
      section: containingSection.name,
      position: this.categorizePosition(relativeY),
      confidence: 0.8, // Base confidence for found position
    };
  }

  findContainingSection(bounds, sections) {
    for (const [name, section] of Object.entries(sections)) {
      if (
        bounds.y >= section.bounds.y &&
        bounds.y <= section.bounds.y + section.bounds.height
      ) {
        return { name, ...section };
      }
    }
    return null;
  }

  categorizePosition(relativeY) {
    if (relativeY <= 0.33) return "top";
    if (relativeY <= 0.66) return "middle";
    return "bottom";
  }

  compareCurrency(found, expected, isDigital) {
    const config = this.fuzzyConfig.currency;

    // Normalize values
    const normalizedFound = this.normalizeCurrency(found);
    const normalizedExpected = this.normalizeCurrency(expected);

    if (normalizedFound === null || normalizedExpected === null) {
      return { isMatch: false, confidence: 0 };
    }

    const diff = Math.abs(normalizedFound - normalizedExpected);
    const percentDiff = diff / normalizedExpected;

    // More forgiving for OCR
    const tolerance = isDigital ? config.tolerance : config.tolerance * 2;

    return {
      isMatch: percentDiff <= tolerance,
      confidence: percentDiff <= tolerance ? 1 - percentDiff / tolerance : 0,
    };
  }

  compareBankName(found, expected) {
    const config = this.fuzzyConfig.bankName;

    if (config.caseInsensitive) {
      found = found.toLowerCase();
      expected = expected.toLowerCase();
    }

    // Use fast-fuzzy for bank name comparison
    const score = distance(found, expected);

    return {
      isMatch: score >= config.minScore,
      confidence: score,
    };
  }

  async validateSpatialRelationships(matches, content) {
    // Define expected spatial relationships
    const expectedLayouts = {
      loanAmount: { section: "summary", position: "top" },
      instalment: { section: "summary", position: "middle" },
      interestRate: { section: "summary", position: "middle" },
      insurance: { section: "summary", position: "bottom" },
      bankDetails: { section: "payment", position: "any" },
    };

    let validCount = 0;
    let totalChecked = 0;

    // Check each matched field's position
    for (const [field, match] of Object.entries(matches)) {
      const expected = expectedLayouts[field];
      if (!expected) continue;

      const isValid = await this.validateFieldPosition(
        match.bounds,
        expected,
        content
      );

      if (isValid) validCount++;
      totalChecked++;
    }

    return {
      valid: validCount > 0,
      confidence: totalChecked > 0 ? validCount / totalChecked : 0,
    };
  }

  normalizeCurrency(value) {
    if (typeof value === "number") return value;

    // Remove currency symbols, spaces, etc
    const normalized = String(value)
      .replace(/[R$]/g, "")
      .replace(/\s+/g, "")
      .replace(/,/g, ".");

    return parseFloat(normalized);
  }
}

export default HybridValidator;
