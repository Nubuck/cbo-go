import { fuzzy } from "fast-fuzzy";

class HybridValidator {
  constructor() {
    this.fuzzyConfig = {
      currency: {
        tolerance: 0.05, // 5 cents
        ignoreFormatting: true,
      },
      percentage: {
        tolerance: 0.001, // Allow 29 to match 29.00
        ignoreFormatting: true,
      },
      bankName: {
        threshold: 0.6, // Very forgiving fuzzy match
        caseInsensitive: true,
      },
      accountNumber: {
        digital: { tolerance: 0 }, // Must match exactly for digital
        ocr: { tolerance: 1 }, // Allow 1 digit difference for OCR
      },
    };

    // Field type definitions
    this.fieldTypes = {
      loanAmount: "currency",
      initiationFee: "currency",
      serviceFee: "currency",
      instalment: "currency",
      interestRate: "percentage",
      insurancePremium: "currency",
      collectionBank: "bankName",
      collectionAccountNo: "accountNumber",
      caseId: "reference",
      clientIdNo: "reference",
    };

    // Define value indicators for hunting
    this.valueIndicators = {
      currency: ["R", "$", ".00", ",00", "amount", "fee", "payment"],
      percentage: ["%", "percent", "rate", "interest"],
      reference: ["ref", "reference", "number", "no"],
      accountNumber: ["account", "acc no", "acc number"],
      bankName: ["bank", "institution", "branch"],
    };

    // Define validation priority and weights
    this.fieldPriorities = {
      loanAmount: { weight: 1.0, required: true },
      instalment: { weight: 0.8, required: true },
      interestRate: { weight: 0.7, required: true },
      insurancePremium: { weight: 0.6, required: true },
      serviceFee: { weight: 0.4, required: false },
      initiationFee: { weight: 0.4, required: false },
    };
  }

  async validateDocument(extractedContent, caseModel, isDigital = true) {
    const results = {
      valid: true,
      confidence: 1.0,
      fields: {},
      matches: {},
    };

    try {
      // First pass: Find known values using fuzzy search
      for (const [field, value] of Object.entries(caseModel)) {
        const match = await this.findKnownValue(
          extractedContent,
          field,
          value,
          isDigital
        );

        if (match) {
          results.fields[field] = match.value;
          results.matches[field] = match;
          results.confidence *= match.confidence;
        } else if (this.fieldPriorities[field]?.required) {
          results.valid = false;
        }
      }

      // Second pass: Verify spatial relationships
      const spatialValidation = await this.validateSpatialRelationships(
        results.matches,
        extractedContent
      );

      results.valid = results.valid && spatialValidation.valid;
      results.confidence *= spatialValidation.confidence;

      return results;
    } catch (error) {
      console.error("Validation failed:", error);
      throw error;
    }
  }

  determineFieldType(fieldName, value) {
    // Check predefined field type first
    if (this.fieldTypes[fieldName]) {
      return this.fieldTypes[fieldName];
    }

    // Analyze value and surrounding context
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

    // Perform pattern-based detection
    if (/^R?\s*[\d.,]+/.test(valueStr)) return "currency";
    if (/[\d.,]+\s*%/.test(valueStr)) return "percentage";
    if (/^\d{10}$/.test(valueStr)) return "reference";
    if (/^\d{6,12}$/.test(valueStr)) return "accountNumber";

    return "text";
  }

  async findKnownValue(content, field, expectedValue, isDigital) {
    const fieldType = this.determineFieldType(field, expectedValue);
    const config = this.fuzzyConfig[fieldType];

    if (!config) {
      console.warn(`No fuzzy config for field type: ${fieldType}`);
      return null;
    }

    let bestMatch = null;
    let highestScore = 0;

    // Search through all content
    for (const page of content.pages) {
      for (const item of page) {
        try {
          const matchScore = this.compareValues(
            item.text,
            expectedValue,
            fieldType,
            isDigital
          );

          if (
            matchScore.score > highestScore &&
            matchScore.score >= (isDigital ? 0.8 : 0.6)
          ) {
            bestMatch = {
              value: item.text,
              confidence: matchScore.score,
              bounds: item.bounds,
              page: content.pages.indexOf(page),
            };
            highestScore = matchScore.score;
          }
        } catch (error) {
          console.warn(`Error comparing values: ${error}`);
          continue;
        }
      }
    }

    return bestMatch;
  }

  compareValues(found, expected, fieldType, isDigital) {
    const config = this.fuzzyConfig[fieldType];
    let score = 0;

    try {
      switch (fieldType) {
        case "currency":
        case "percentage": {
          const foundNum = this.parseNumber(found, fieldType);
          const expectedNum = this.parseNumber(expected, fieldType);

          if (isNaN(foundNum) || isNaN(expectedNum)) {
            return { score: 0, reason: "invalid_number" };
          }

          const percentDiff = Math.abs((foundNum - expectedNum) / expectedNum);
          const tolerance = isDigital ? config.tolerance : config.tolerance * 2;

          score = percentDiff <= tolerance ? 1 - percentDiff / tolerance : 0;

          break;
        }

        case "bankName": {
          // Use fast-fuzzy for bank name comparison
          const normalizedFound = config.caseInsensitive
            ? found.toLowerCase()
            : found;
          const normalizedExpected = config.caseInsensitive
            ? expected.toLowerCase()
            : expected;

          score = fuzzy(normalizedFound, normalizedExpected);
          break;
        }

        case "accountNumber": {
          const tolerance = isDigital
            ? config.digital.tolerance
            : config.ocr.tolerance;

          const normalizedFound = found.replace(/[\s-]/g, "");
          const normalizedExpected = expected.replace(/[\s-]/g, "");

          if (tolerance === 0) {
            score = normalizedFound === normalizedExpected ? 1 : 0;
          } else {
            // Allow for OCR digit errors
            const differences = this.countDigitDifferences(
              normalizedFound,
              normalizedExpected
            );
            score =
              differences <= tolerance ? 1 - differences / (tolerance + 1) : 0;
          }
          break;
        }

        default: {
          // Use basic fuzzy match for other types
          score = fuzzy(String(found), String(expected));
        }
      }

      return {
        score,
        reason: score > 0 ? "match" : "no_match",
      };
    } catch (error) {
      console.error(`Comparison failed for ${fieldType}:`, error);
      return { score: 0, reason: "error" };
    }
  }

  parseNumber(value, type) {
    // Remove currency symbols, spaces and normalize separators
    let processed = String(value)
      .replace(/[R$]/g, "")
      .replace(/\s/g, "")
      .replace(/,/g, ".");

    // Remove percentage sign for percentage values
    if (type === "percentage") {
      processed = processed.replace(/%/g, "");
    }

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
