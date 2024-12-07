class ValueNormalizer {
  constructor() {
    this.patterns = {
      currency: [
        /^R?\s*[\d,\s]+\.?\d*$/i, // R 1,234.56 or 1,234.56
        /^R?\s*[\d\s]+,\d*$/i, // R 1 234,56 or 1 234,56
        /^R?\s*[\d']+\.?\d*$/i, // R1'234.56 or 1'234.56
        /^R?\s*[\d\s]*(?:\.|,)\d*$/, // R 1234.56 or 1234,56
      ],
      percentage: [
        /^[\d,\s]+\.?\d*\s*%$/, // 12.5% or 12,5%
        /^[\d\s]+,\d*\s*%$/, // 12 5,5%
        /^[\d,\s]*(?:\.|,)\d*\s*%$/, // 12.5 % or 12,5 %
      ],
      reference: [
        /^\d{10}$/, // Exactly 10 digits
        /^[A-Z0-9]{8,12}$/, // 8-12 alphanumeric chars
      ],
      accountNumber: [
        /^\d{6,12}$/, // 6-12 digits
        /^[0-9\s-]{8,14}$/, // Digits with spaces/dashes
      ],
      text: [
        /.+/, // Any non-empty string
      ],
    };

    // Value format specifications
    this.formats = {
      currency: {
        normalize: (value) => this.normalizeCurrency(value),
        validate: (value) => !isNaN(this.parseCurrency(value)),
      },
      percentage: {
        normalize: (value) => this.normalizePercentage(value),
        validate: (value) => !isNaN(this.parsePercentage(value)),
      },
      reference: {
        normalize: (value) => value.replace(/\s+/g, ""),
        validate: (value) => this.patterns.reference.some((p) => p.test(value)),
      },
      accountNumber: {
        normalize: (value) => value.replace(/[\s-]/g, ""),
        validate: (value) =>
          this.patterns.accountNumber.some((p) => p.test(value)),
      },
      text: {
        normalize: (value) => value.trim(),
        validate: (value) => value.length > 0,
      },
    };

    // Add OCR substitution patterns
    this.ocrSubstitutions = {
      numbers: {
        l: "1",
        I: "1",
        "|": "1",
        O: "0",
        Q: "0",
        D: "0",
        S: "5",
        B: "8",
        Z: "2",
      },
      symbols: {
        "·": ".",
        "•": ".",
        "'": ",",
        "`": ",",
        "´": ",",
        '"': ",",
        " ": "", // Remove spaces in numbers
      },
    };

    this.confidenceModifiers = {
      substitutions: 0.9, // Small penalty for character substitutions
      decimalShift: 0.8, // Larger penalty for decimal point issues
      digitGrouping: 0.95, // Minor penalty for grouping differences
    };
  }

  normalizeValue(value, type, isOCR = false) {
    if (!value) return { value: null, confidence: 0 };

    try {
      switch (type) {
        case "currency": {
          // Handle both found and expected values consistently
          const normalized = this.normalizeCurrency(value, isOCR);
          return {
            value: normalized.value,
            confidence: normalized.confidence,
            originalValue: value,
          };
        }

        case "percentage": {
          const normalized = this.normalizePercentage(value, isOCR);
          return {
            value: normalized.value,
            confidence: normalized.confidence,
            originalValue: value,
          };
        }

        default:
          return this.normalizeText(value, isOCR);
      }
    } catch (error) {
      console.error(`Normalization failed for ${type}:`, error);
      return { value: null, confidence: 0 };
    }
  }

  /**
   * Normalize text value with OCR considerations
   */
  normalizeText(value, isOCR = false) {
    if (!value) {
      return { value: null, confidence: 0 };
    }

    let confidence = 1.0;
    let processed = String(value);

    // Apply OCR corrections if needed
    if (isOCR) {
      processed = this.applyOCRSubstitutions(processed);
      confidence *= this.confidenceModifiers.substitutions;
    }

    // Basic text normalization
    processed = processed.trim().replace(/\s+/g, " "); // Normalize whitespace

    // Handle common OCR text artifacts
    if (isOCR) {
      // Remove common OCR artifacts
      processed = processed
        .replace(/[^\w\s\-.,()]/g, "") // Remove special characters except basic punctuation
        .replace(/\.{2,}/g, ".") // Replace multiple dots with single
        .replace(/\,{2,}/g, ","); // Replace multiple commas with single

      // Adjust confidence based on corrections made
      if (processed !== value.trim()) {
        confidence *= 0.9; // Slight penalty for corrections
      }
    }

    // Return early if empty after processing
    if (!processed) {
      return { value: null, confidence: 0 };
    }

    return {
      value: processed,
      confidence,
      originalValue: value,
    };
  }
  /**
   * Normalize text with type-specific handling
   */
  normalizeWithType(value, type, isOCR = false) {
    switch (type) {
      case "text":
        return this.normalizeText(value, isOCR);
      case "reference":
        return this.normalizeReference(value, isOCR);
      case "bankName":
        return this.normalizeBankName(value, isOCR);
      case "accountNumber":
        return this.normalizeAccountNumber(value, isOCR);
      default:
        return this.normalizeText(value, isOCR);
    }
  }
  /**
   * Normalize reference numbers (case IDs, etc.)
   */
  normalizeReference(value, isOCR = false) {
    if (!value) {
      return { value: null, confidence: 0 };
    }

    let confidence = 1.0;
    let processed = String(value);

    if (isOCR) {
      processed = this.applyOCRSubstitutions(processed);
      confidence *= this.confidenceModifiers.substitutions;
    }

    // Remove all non-digit characters
    processed = processed.replace(/[^\d]/g, "");

    // Check for expected length (e.g., 10 digits for case references)
    if (processed.length !== 10) {
      confidence *= 0.8;
    }

    return {
      value: processed,
      confidence,
      originalValue: value,
    };
  }

  /**
   * Normalize bank names
   */
  normalizeBankName(value, isOCR = false) {
    if (!value) {
      return { value: null, confidence: 0 };
    }

    let confidence = 1.0;
    let processed = String(value);

    if (isOCR) {
      processed = this.applyOCRSubstitutions(processed);
      confidence *= this.confidenceModifiers.substitutions;
    }

    // Basic bank name normalization
    processed = processed.trim().replace(/\s+/g, " ").toUpperCase();

    // Remove common bank name artifacts
    processed = processed
      .replace(/\bLTD\b|\bLIMITED\b/, "")
      .replace(/\bBANK\b/, "")
      .trim();

    return {
      value: processed,
      confidence,
      originalValue: value,
    };
  }

  /**
   * Normalize account numbers
   */
  normalizeAccountNumber(value, isOCR = false) {
    if (!value) {
      return { value: null, confidence: 0 };
    }

    let confidence = 1.0;
    let processed = String(value);

    if (isOCR) {
      processed = this.applyOCRSubstitutions(processed);
      confidence *= this.confidenceModifiers.substitutions;
    }

    // Remove all non-digit characters
    processed = processed.replace(/[^\d]/g, "");

    // Check reasonable account number length
    if (processed.length < 6 || processed.length > 12) {
      confidence *= 0.7;
    }

    return {
      value: processed,
      confidence,
      originalValue: value,
    };
  }
  /**
   * Clean input value
   */
  cleanValue(value) {
    return String(value).trim().replace(/\s+/g, " ");
  }

  /**
   * Match value against known patterns
   */
  matchPattern(value, type) {
    // Get patterns for the specified type
    const patterns = this.numberPatterns[type];
    if (!patterns) {
      console.warn(`No patterns defined for type: ${type}`);
      return { matched: false };
    }

    // Try exact pattern matching first
    for (const pattern of patterns) {
      if (pattern.test(value)) {
        return {
          matched: true,
          value: value,
          confidence: 1.0,
        };
      }
    }

    // Try fuzzy pattern matching if exact match fails
    return this.fuzzyPatternMatch(value, type);
  }

  /**
   * Fuzzy pattern matching for partially matched patterns
   */
  fuzzyPatternMatch(value, format) {
    // Split into potential components
    const components = {
      currency: value.match(/^R?\s*([\d\s,.']+)/i)?.[1],
      decimal: value.match(/[.,](\d+)$/)?.[1],
      symbol: value.match(/^R|\s*%$/i)?.[0],
    };

    if (!components.currency) {
      return { matched: false };
    }

    // Calculate confidence based on component validity
    let confidence = 0;
    let reconstructed = "";

    switch (format) {
      case "currency":
        confidence = this.calculateCurrencyConfidence(components);
        reconstructed = `R${components.currency}${
          components.decimal ? `.${components.decimal}` : ""
        }`;
        break;

      case "percentage":
        confidence = this.calculatePercentageConfidence(components);
        reconstructed = `${components.currency}${
          components.decimal ? `.${components.decimal}` : ""
        }%`;
        break;
    }

    return {
      matched: confidence > 0.5,
      value: reconstructed,
      confidence,
    };
  }

  /**
   * Apply OCR corrections to common mistakes
   */
  applyOCRSubstitutions(text) {
    let processed = text;

    // Apply number substitutions
    for (const [char, replacement] of Object.entries(
      this.ocrSubstitutions.numbers
    )) {
      processed = processed.replace(new RegExp(char, "g"), replacement);
    }

    // Apply symbol substitutions
    for (const [char, replacement] of Object.entries(
      this.ocrSubstitutions.symbols
    )) {
      processed = processed.replace(
        new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        replacement
      );
    }

    return processed;
  }

  /**
   * Convert matched value to standard number format
   */
  convertToNumber(value) {
    // Remove currency symbol and spaces
    let processed = value.replace(/^R\s*/, "").replace(/\s/g, "");

    // Handle different decimal separators
    if (processed.includes(",")) {
      // Check if comma is thousand separator or decimal point
      const afterComma = processed.split(",")[1];
      if (afterComma && afterComma.length <= 2) {
        // Comma is decimal separator
        processed = processed.replace(",", ".");
      } else {
        // Comma is thousand separator
        processed = processed.replace(/,/g, "");
      }
    }

    // Remove percentage sign
    processed = processed.replace(/%$/, "");

    const number = parseFloat(processed);
    return {
      value: number,
      confidence: isNaN(number) ? 0 : 1,
    };
  }

  /**
   * Compare normalized value with reference
   */
  compareValues(found, expected, type, isOCR = false) {
    const normalizedFound = this.normalizeValue(found, type, isOCR);
    const normalizedExpected = this.normalizeValue(expected, type, false);

    if (!normalizedFound.value || !normalizedExpected.value) {
      return {
        match: false,
        confidence: 0,
        reason: "normalization_failed",
      };
    }

    switch (type) {
      case "currency":
      case "percentage": {
        const tolerance = isOCR ? 0.05 : 0.001; // 5% tolerance for OCR, 0.1% for digital
        const diff = Math.abs(normalizedFound.value - normalizedExpected.value);
        const percentDiff = diff / normalizedExpected.value;

        return {
          match: percentDiff <= tolerance,
          confidence: Math.max(0, 1 - percentDiff / tolerance),
          normalizedFound: normalizedFound.value,
          normalizedExpected: normalizedExpected.value,
          originalFound: found,
          originalExpected: expected,
        };
      }

      default:
        return {
          match: normalizedFound.value === normalizedExpected.value,
          confidence:
            normalizedFound.confidence * normalizedExpected.confidence,
          normalizedFound: normalizedFound.value,
          normalizedExpected: normalizedExpected.value,
        };
    }
  }
  /**
   * Calculate confidence for currency format
   */
  calculateCurrencyConfidence(components) {
    let confidence = 0;

    // Check numeric part
    if (components.currency && /^\d[\d\s,.']*$/.test(components.currency)) {
      confidence += 0.6;
    }

    // Check decimal part
    if (components.decimal) {
      if (components.decimal.length === 2 && /^\d+$/.test(components.decimal)) {
        confidence += 0.3;
      } else {
        confidence += 0.1;
      }
    } else {
      confidence += 0.2; // Whole numbers are valid
    }

    // Check currency symbol
    if (components.symbol === "R") {
      confidence += 0.1;
    }

    return confidence;
  }

  normalizeCurrency(value, isOCR = false) {
    // Handle number input
    if (typeof value === "number") {
      return { value, confidence: 1.0 };
    }

    let confidence = 1.0;
    let processed = String(value).toLowerCase();

    // Apply OCR substitutions if needed
    if (isOCR) {
      processed = this.applyOCRSubstitutions(processed);
      confidence *= this.confidenceModifiers.substitutions;
    }

    // Remove currency symbols and clean
    processed = processed
      .replace(/[r$]/i, "")
      .replace(/\s+/g, "")
      .replace(/[,\'](?=\d{3})/g, ""); // Remove thousands separators

    // Handle decimal points
    if (processed.includes(",")) {
      const parts = processed.split(",");
      if (parts[1].length <= 2) {
        processed = parts[0] + "." + parts[1];
        if (isOCR) confidence *= this.confidenceModifiers.decimalShift;
      }
    }

    const number = parseFloat(processed);
    if (isNaN(number)) {
      return { value: null, confidence: 0 };
    }

    // Check if decimal places were likely missed
    if (number > 1000 && !processed.includes(".")) {
      const withDecimal = number / 100;
      return {
        value: withDecimal,
        confidence: confidence * this.confidenceModifiers.decimalShift,
      };
    }

    return { value: number, confidence };
  }

  normalizePercentage(value, isOCR = false) {
    if (typeof value === "number") {
      return { value, confidence: 1.0 };
    }

    let confidence = 1.0;
    let processed = String(value);

    if (isOCR) {
      processed = this.applyOCRSubstitutions(processed);
      confidence *= this.confidenceModifiers.substitutions;
    }

    processed = processed
      .replace(/\s+/g, "")
      .replace(/[%]/g, "")
      .replace(/,/g, ".");

    const number = parseFloat(processed);
    if (isNaN(number)) {
      return { value: null, confidence: 0 };
    }

    // Handle common OCR percentage mistakes
    if (number > 100 && !processed.includes(".")) {
      const withDecimal = number / 100;
      return {
        value: withDecimal,
        confidence: confidence * this.confidenceModifiers.decimalShift,
      };
    }

    return { value: number, confidence };
  }

  parseCurrency(value) {
    const normalized = this.normalizeCurrency(value);
    return parseFloat(normalized);
  }

  parsePercentage(value) {
    const normalized = this.normalizePercentage(value);
    return parseFloat(normalized);
  }

  compareValues(value, reference, type) {
    switch (type) {
      case "currency":
      case "percentage": {
        const val = parseFloat(value);
        const ref = parseFloat(reference);
        const percentDiff = Math.abs(((val - ref) / ref) * 100);

        if (percentDiff < 0.01) return { fuzzyMatch: true, confidence: 1.0 };
        if (percentDiff < 0.1) return { fuzzyMatch: true, confidence: 0.9 };
        if (percentDiff < 1.0) return { fuzzyMatch: true, confidence: 0.7 };
        return { fuzzyMatch: false, confidence: 0 };
      }

      case "reference":
      case "accountNumber": {
        const normalized1 = this.formats[type].normalize(value);
        const normalized2 = this.formats[type].normalize(reference);
        return {
          fuzzyMatch: normalized1 === normalized2,
          confidence: normalized1 === normalized2 ? 1.0 : 0,
        };
      }

      case "text":
      default: {
        const similarity = this.calculateTextSimilarity(value, reference);
        return {
          fuzzyMatch: similarity > 0.8,
          confidence: similarity,
        };
      }
    }
  }

  calculateTextSimilarity(str1, str2) {
    // Simple Levenshtein-based similarity
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;

    const distance = this.levenshteinDistance(str1, str2);
    return 1 - distance / maxLength;
  }

  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1)
      .fill()
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j - 1] + 1, // substitution
            dp[i - 1][j] + 1, // deletion
            dp[i][j - 1] + 1 // insertion
          );
        }
      }
    }

    return dp[m][n];
  }
}

export default ValueNormalizer;
