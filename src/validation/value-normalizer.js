import { distance } from 'fast-fuzzy';

class ValueNormalizer {
  constructor() {
    this.numberPatterns = {
      currency: [
        /^R?\s*[\d,\s]+\.?\d*$/i,  // R 1,234.56 or 1,234.56
        /^R?\s*[\d\s]+,\d*$/i,     // R 1 234,56 or 1 234,56
        /^R?\s*[\d']+\.?\d*$/i,    // R1'234.56 or 1'234.56
        /^R?\s*[\d\s]*(?:\.|,)\d*$/ // R 1234.56 or 1234,56
      ],
      percentage: [
        /^[\d,\s]+\.?\d*\s*%$/,    // 12.5% or 12,5%
        /^[\d\s]+,\d*\s*%$/,       // 12 5,5%
        /^[\d,\s]*(?:\.|,)\d*\s*%$/ // 12.5 % or 12,5 %
      ]
    };

    // Define common OCR mistakes and corrections
    this.ocrCorrections = {
      characters: {
        'O': '0',
        'l': '1',
        'I': '1',
        'S': '5',
        'B': '8',
        'Z': '2',
        '?': '7'
      },
      symbols: {
        '·': '.',
        '•': '.',
        '\'': ',',
        '`': ',',
        '´': ',',
        '"': ','
      }
    };
  }

  /**
   * Normalize numeric value with fuzzy matching
   */
  normalizeValue(value, expectedFormat = 'currency', referenceValue = null) {
    if (!value) return { value: null, confidence: 0 };

    // Clean and standardize input
    const cleaned = this.cleanValue(value);
    
    // Attempt pattern matching
    const patternMatch = this.matchPattern(cleaned, expectedFormat);
    if (!patternMatch.matched) {
      // Try OCR corrections if pattern matching fails
      const corrected = this.applyOCRCorrections(cleaned);
      const correctedMatch = this.matchPattern(corrected, expectedFormat);
      if (!correctedMatch.matched) {
        return { value: null, confidence: 0 };
      }
      patternMatch.value = correctedMatch.value;
      patternMatch.confidence *= 0.8; // Reduce confidence for OCR corrections
    }

    // Convert to standardized number
    const normalized = this.convertToNumber(patternMatch.value);
    
    // Compare with reference value if provided
    if (referenceValue !== null) {
      const comparison = this.compareValues(normalized.value, referenceValue);
      return {
        value: normalized.value,
        confidence: Math.min(normalized.confidence, comparison.confidence),
        fuzzyMatch: comparison.fuzzyMatch
      };
    }

    return normalized;
  }

  /**
   * Clean input value
   */
  cleanValue(value) {
    return String(value)
      .trim()
      .replace(/\s+/g, ' ')     // Normalize spaces
      .replace(/[^\w\s.,%-R]/g, ''); // Remove invalid characters
  }

  /**
   * Match value against known patterns
   */
  matchPattern(value, format) {
    const patterns = this.numberPatterns[format];
    
    for (const pattern of patterns) {
      if (pattern.test(value)) {
        return {
          matched: true,
          value: value,
          confidence: 1.0
        };
      }
    }

    // Try fuzzy pattern matching
    return this.fuzzyPatternMatch(value, format);
  }

  /**
   * Fuzzy pattern matching for partially matched patterns
   */
  fuzzyPatternMatch(value, format) {
    // Split into potential components
    const components = {
      currency: value.match(/^R?\s*([\d\s,.']+)/i)?.[1],
      decimal: value.match(/[.,](\d+)$/)?.[1],
      symbol: value.match(/^R|\s*%$/i)?.[0]
    };

    if (!components.currency) {
      return { matched: false };
    }

    // Calculate confidence based on component validity
    let confidence = 0;
    let reconstructed = '';

    switch (format) {
      case 'currency':
        confidence = this.calculateCurrencyConfidence(components);
        reconstructed = `R${components.currency}${
          components.decimal ? `.${components.decimal}` : ''
        }`;
        break;

      case 'percentage':
        confidence = this.calculatePercentageConfidence(components);
        reconstructed = `${components.currency}${
          components.decimal ? `.${components.decimal}` : ''
        }%`;
        break;
    }

    return {
      matched: confidence > 0.5,
      value: reconstructed,
      confidence
    };
  }

  /**
   * Apply common OCR corrections
   */
  applyOCRCorrections(value) {
    let corrected = value;
    
    // Replace commonly misrecognized characters
    for (const [wrong, right] of Object.entries(this.ocrCorrections.characters)) {
      corrected = corrected.replace(new RegExp(wrong, 'g'), right);
    }
    
    // Fix symbol recognition issues
    for (const [wrong, right] of Object.entries(this.ocrCorrections.symbols)) {
      corrected = corrected.replace(new RegExp(wrong, 'g'), right);
    }

    return corrected;
  }

  /**
   * Convert matched value to standard number format
   */
  convertToNumber(value) {
    // Remove currency symbol and spaces
    let processed = value.replace(/^R\s*/, '').replace(/\s/g, '');
    
    // Handle different decimal separators
    if (processed.includes(',')) {
      // Check if comma is thousand separator or decimal point
      const afterComma = processed.split(',')[1];
      if (afterComma && afterComma.length <= 2) {
        // Comma is decimal separator
        processed = processed.replace(',', '.');
      } else {
        // Comma is thousand separator
        processed = processed.replace(/,/g, '');
      }
    }

    // Remove percentage sign
    processed = processed.replace(/%$/, '');

    const number = parseFloat(processed);
    return {
      value: number,
      confidence: isNaN(number) ? 0 : 1
    };
  }

  /**
   * Compare normalized value with reference
   */
  compareValues(value, reference) {
    if (typeof value !== 'number' || typeof reference !== 'number') {
      return { fuzzyMatch: false, confidence: 0 };
    }

    // Calculate percentage difference
    const difference = Math.abs(value - reference);
    const percentDiff = (difference / reference) * 100;

    // Define confidence thresholds
    const thresholds = {
      exact: { maxDiff: 0.01, confidence: 1.0 },    // 0.01% difference
      close: { maxDiff: 0.1, confidence: 0.9 },     // 0.1% difference
      similar: { maxDiff: 1, confidence: 0.7 },     // 1% difference
      fuzzy: { maxDiff: 5, confidence: 0.5 }        // 5% difference
    };

    // Find matching threshold
    for (const [level, threshold] of Object.entries(thresholds)) {
      if (percentDiff <= threshold.maxDiff) {
        return {
          fuzzyMatch: true,
          confidence: threshold.confidence,
          difference: percentDiff,
          matchLevel: level
        };
      }
    }

    return {
      fuzzyMatch: false,
      confidence: 0,
      difference: percentDiff,
      matchLevel: 'none'
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
    if (components.symbol === 'R') {
      confidence += 0.1;
    }

    return confidence;
  }
}

export default ValueNormalizer;
