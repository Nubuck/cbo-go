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

    // Define common OCR mistakes and corrections
    this.ocrCorrections = {
      characters: {
        O: "0",
        l: "1",
        I: "1",
        S: "5",
        B: "8",
        Z: "2",
        "?": "7",
      },
      symbols: {
        "·": ".",
        "•": ".",
        "'": ",",
        "`": ",",
        "´": ",",
        '"': ",",
      },
    };
  }

  async normalizeValue(value, type = "text", referenceValue = null) {
    if (!value) return { value: null, confidence: 0 };

    // Get format specification
    const format = this.formats[type];
    if (!format) {
      console.warn(`Unsupported value type: ${type}`);
      return { value: null, confidence: 0 };
    }

    try {
      // Clean and normalize
      const cleaned = this.cleanValue(value);
      const normalized = format.normalize(cleaned);

      // Validate format
      if (!format.validate(normalized)) {
        // Try OCR corrections if validation fails
        const corrected = this.applyOCRCorrections(cleaned);
        const normalizedCorrected = format.normalize(corrected);

        if (!format.validate(normalizedCorrected)) {
          return { value: null, confidence: 0 };
        }

        return {
          value: normalizedCorrected,
          confidence: 0.8, // Lower confidence for OCR corrections
        };
      }

      // Compare with reference if provided
      if (referenceValue !== null) {
        const comparison = this.compareValues(normalized, referenceValue, type);
        return {
          value: normalized,
          confidence: comparison.confidence,
          fuzzyMatch: comparison.fuzzyMatch,
        };
      }

      return {
        value: normalized,
        confidence: 1.0,
      };
    } catch (error) {
      console.error(`Normalization failed for type ${type}:`, error);
      return { value: null, confidence: 0 };
    }
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
  applyOCRCorrections(value) {
    // Common OCR misreads
    const corrections = {
      O: "0",
      l: "1",
      I: "1",
      S: "5",
      B: "8",
      Z: "2",
      "?": "7",
      "·": ".",
      "•": ".",
      "'": ",",
      "`": ",",
      "´": ",",
      '"': ",",
    };

    let corrected = value;
    for (const [wrong, right] of Object.entries(corrections)) {
      corrected = corrected.replace(new RegExp(wrong, "g"), right);
    }

    return corrected;
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
  compareValues(value, reference) {
    if (typeof value !== "number" || typeof reference !== "number") {
      return { fuzzyMatch: false, confidence: 0 };
    }

    // Calculate percentage difference
    const difference = Math.abs(value - reference);
    const percentDiff = (difference / reference) * 100;

    // Define confidence thresholds
    const thresholds = {
      exact: { maxDiff: 0.01, confidence: 1.0 }, // 0.01% difference
      close: { maxDiff: 0.1, confidence: 0.9 }, // 0.1% difference
      similar: { maxDiff: 1, confidence: 0.7 }, // 1% difference
      fuzzy: { maxDiff: 5, confidence: 0.5 }, // 5% difference
    };

    // Find matching threshold
    for (const [level, threshold] of Object.entries(thresholds)) {
      if (percentDiff <= threshold.maxDiff) {
        return {
          fuzzyMatch: true,
          confidence: threshold.confidence,
          difference: percentDiff,
          matchLevel: level,
        };
      }
    }

    return {
      fuzzyMatch: false,
      confidence: 0,
      difference: percentDiff,
      matchLevel: "none",
    };
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

  normalizeCurrency(value) {
    // Remove currency symbol and spaces
    let processed = value.replace(/^R\s*/, "").replace(/\s/g, "");

    // Handle different decimal separators
    if (processed.includes(",")) {
      const afterComma = processed.split(",")[1];
      if (afterComma && afterComma.length <= 2) {
        processed = processed.replace(",", ".");
      } else {
        processed = processed.replace(/,/g, "");
      }
    }

    return processed;
  }

  normalizePercentage(value) {
    return value.replace(/\s*%\s*$/, "").trim();
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
