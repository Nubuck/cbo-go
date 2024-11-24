import { fuzzy } from "fast-fuzzy";

class HybridValidator {
  constructor() {
    this.fuzzyConfig = {
      currency: {
        tolerance: 0.05, // 5 cents
        ignoreFormatting: true,
        patterns: [/^R?\s*[\d,\s]+\.?\d*$/i],
      },
      percentage: {
        tolerance: 0.001, // Allow 29 to match 29.00
        ignoreFormatting: true,
        patterns: [/^[\d,\.]+\s*%$/],
      },
      text: {
        threshold: 0.8, // Standard text matching threshold
        caseInsensitive: true,
        patterns: [/.+/],
      },
      reference: {
        threshold: 0.9, // High threshold for references
        exactMatch: true,
        patterns: [/^\d{10}$/, /^[A-Z0-9]{8,12}$/],
      },
      bankName: {
        threshold: 0.6, // More forgiving for bank names
        caseInsensitive: true,
        minLength: 3, // Avoid single characters/punctuation
        patterns: [/^[A-Za-z\s]{2,20}$/],
      },
      accountNumber: {
        digital: { tolerance: 0 },
        ocr: { tolerance: 1 },
        patterns: [/^\d{6,12}$/, /^[\d\s-]{8,14}$/],
      },
    };

    // Enhanced field type definitions with validation rules
    this.fieldTypes = {
      loanAmount: { type: "currency", required: true, priority: 1.0 },
      initiationFee: { type: "currency", required: true, priority: 0.8 },
      serviceFee: { type: "currency", required: true, priority: 0.8 },
      instalment: { type: "currency", required: true, priority: 0.9 },
      interestRate: { type: "percentage", required: true, priority: 0.9 },
      insurancePremium: { type: "currency", required: true, priority: 0.8 },
      collectionBank: { type: "bankName", required: true, priority: 0.7 },
      collectionAccountNo: {
        type: "accountNumber",
        required: true,
        priority: 0.9,
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
    // Early return if no expected value
    if (expectedValue == null) {
      console.warn(`No expected value provided for field: ${field}`);
      return null;
    }

    const fieldConfig = this.fieldTypes[field];
    const fieldType =
      fieldConfig?.type || this.determineFieldType(field, expectedValue);
    const config = this.fuzzyConfig[fieldType];

    if (!config) {
      console.warn(`No fuzzy config for field type: ${fieldType}`);
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
          console.warn(`Error comparing values for ${field}:`, error);
          continue;
        }
      }
    }

    return bestMatch;
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

  normalizeValue(value, fieldType) {
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
          const foundNum = this.parseNumber(found);
          const expectedNum = this.parseNumber(expected);

          if (isNaN(foundNum) || isNaN(expectedNum)) {
            return { score: 0, reason: "invalid_number" };
          }

          const percentDiff = Math.abs((foundNum - expectedNum) / expectedNum);
          return {
            score:
              percentDiff <= config.tolerance
                ? 1 - percentDiff / config.tolerance
                : 0,
            reason: "match",
          };
        }

        case "percentage": {
          const foundNum = this.parsePercentage(found);
          const expectedNum = this.parsePercentage(expected);

          if (isNaN(foundNum) || isNaN(expectedNum)) {
            return { score: 0, reason: "invalid_number" };
          }

          const diff = Math.abs(foundNum - expectedNum);
          return {
            score: diff <= config.tolerance ? 1 : 0,
            reason: "match",
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
      console.error(`Comparison failed for ${fieldType}:`, error);
      return { score: 0, reason: "error" };
    }
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
