/**
 * Enhanced OCR pipeline with adaptive processing strategies
 */
class AdaptiveOCRProcessor {
  constructor() {
    this.enhancementProfiles = {
      financial: {
        initial: {
          scale: 2.0,
          preprocessing: ['deskew', 'normalize'],
          confidence: 0.85
        },
        retry1: {
          scale: 3.0,
          preprocessing: ['deskew', 'contrast', 'sharpen'],
          cropMargin: 20,
          confidence: 0.75
        },
        retry2: {
          scale: 3.0,
          preprocessing: ['deskew', 'contrast'],
          cropMargin: 20,
          confidence: 0.65
        }
      },
      text: {
        initial: {
          scale: 1.5,
          preprocessing: ['deskew', 'normalize'],
          confidence: 0.8
        },
        retry1: {
          scale: 2.0,
          preprocessing: ['deskew', 'contrast'],
          confidence: 0.7
        }
      }
    };

    // Criteria for determining if OCR needs enhancement
    this.enhancementTriggers = {
      missingFinancials: (results) => {
        const hasNumbers = results.some(box => /\d/.test(box.text));
        const hasExpectedFormat = results.some(box => 
          /^R?\s*\d{1,3}(,\d{3})*(\.\d{2})?$/.test(box.text.trim())
        );
        return !hasNumbers || !hasExpectedFormat;
      },
      poorQuality: (results) => {
        const avgConfidence = results.reduce((sum, box) => sum + box.confidence, 0) / results.length;
        return avgConfidence < 0.75;
      },
      mixedCharacters: (results) => {
        return results.some(box => {
          const text = box.text.trim();
          return /^\d/.test(text) && /[A-Za-z]/.test(text);
        });
      }
    };
  }

  /**
   * Process document section with adaptive enhancement
   */
  async processSection(image, section, type = 'text') {
    const profile = this.enhancementProfiles[type];
    if (!profile) {
      throw new Error(`Unknown section type: ${type}`);
    }

    let results = null;
    let metadata = {
      attempts: 0,
      enhancements: [],
      confidence: 0
    };

    // Initial attempt
    results = await this.attemptOCR(image, profile.initial);
    metadata.attempts++;
    metadata.enhancements.push('initial');

    // Check if results need enhancement
    if (this.needsEnhancement(results, type)) {
      console.log(`${type} section needs enhancement, attempting retry1...`);
      
      // First retry with cropping and enhancement
      const cropped = await this.cropSection(image, section, profile.retry1.cropMargin);
      const retry1Results = await this.attemptOCR(cropped, profile.retry1);
      metadata.attempts++;
      metadata.enhancements.push('retry1');

      if (this.isBetterResult(retry1Results, results, type)) {
        results = retry1Results;
      }

      // If still not good enough, try without sharpening
      if (this.needsEnhancement(results, type)) {
        console.log(`${type} section still needs improvement, attempting retry2...`);
        const retry2Results = await this.attemptOCR(cropped, profile.retry2);
        metadata.attempts++;
        metadata.enhancements.push('retry2');

        if (this.isBetterResult(retry2Results, results, type)) {
          results = retry2Results;
        }
      }
    }

    metadata.confidence = this.calculateConfidence(results, type);
    return { results, metadata };
  }

  /**
   * Attempt OCR with specific profile
   */
  async attemptOCR(image, profile) {
    const processed = await this.preprocess(image, profile);
    return await this.performOCR(processed);
  }

  /**
   * Preprocess image according to profile
   */
  async preprocess(image, profile) {
    let processed = image;

    for (const step of profile.preprocessing) {
      switch (step) {
        case 'deskew':
          processed = await this.deskewImage(processed);
          break;
        case 'normalize':
          processed = await this.normalizeImage(processed);
          break;
        case 'contrast':
          processed = await this.enhanceContrast(processed);
          break;
        case 'sharpen':
          processed = await this.sharpenImage(processed);
          break;
      }
    }

    if (profile.scale !== 1.0) {
      processed = await this.scaleImage(processed, profile.scale);
    }

    return processed;
  }

  /**
   * Determine if results need enhancement
   */
  needsEnhancement(results, type) {
    if (!results || results.length === 0) return true;

    const triggers = this.enhancementTriggers;
    switch (type) {
      case 'financial':
        return triggers.missingFinancials(results) || 
               triggers.poorQuality(results) ||
               triggers.mixedCharacters(results);
      
      case 'text':
        return triggers.poorQuality(results);
      
      default:
        return false;
    }
  }

  /**
   * Compare results to determine if new is better than old
   */
  isBetterResult(newResults, oldResults, type) {
    if (!oldResults || oldResults.length === 0) return true;
    if (!newResults || newResults.length === 0) return false;

    switch (type) {
      case 'financial': {
        // For financials, prefer results with cleaner number formats
        const newValidNumbers = newResults.filter(r => 
          /^R?\s*\d{1,3}(,\d{3})*(\.\d{2})?$/.test(r.text.trim())
        ).length;
        const oldValidNumbers = oldResults.filter(r => 
          /^R?\s*\d{1,3}(,\d{3})*(\.\d{2})?$/.test(r.text.trim())
        ).length;

        if (newValidNumbers !== oldValidNumbers) {
          return newValidNumbers > oldValidNumbers;
        }
        // Fall through to confidence check
      }

      default: {
        // Compare average confidence scores
        const newConfidence = newResults.reduce((sum, r) => sum + r.confidence, 0) / newResults.length;
        const oldConfidence = oldResults.reduce((sum, r) => sum + r.confidence, 0) / oldResults.length;
        return newConfidence > oldConfidence;
      }
    }
  }

  /**
   * Calculate confidence score for results
   */
  calculateConfidence(results, type) {
    if (!results || results.length === 0) return 0;

    const profile = this.enhancementProfiles[type];
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    switch (type) {
      case 'financial': {
        // Additional checks for financial data
        const validNumbers = results.filter(r => 
          /^R?\s*\d{1,3}(,\d{3})*(\.\d{2})?$/.test(r.text.trim())
        ).length;
        const validRatio = validNumbers / results.length;
        return Math.min(avgConfidence, validRatio);
      }

      default:
        return avgConfidence;
    }
  }

  /**
   * Crop section with margin
   */
  async cropSection(image, section, margin = 0) {
    const mat = await this.imageToMat(image);
    
    // Add margin to section bounds
    const bounds = {
      x: Math.max(0, section.x - margin),
      y: Math.max(0, section.y - margin),
      width: Math.min(mat.cols - section.x + margin, section.width + margin * 2),
      height: Math.min(mat.rows - section.y + margin, section.height + margin * 2)
    };

    const roi = mat.roi(bounds);
    const result = roi.clone();
    
    mat.delete();
    roi.delete();

    return result;
  }
}
