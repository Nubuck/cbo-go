import cv from '@techstark/opencv-js';
import { createOCREngine } from 'tesseract-wasm';

class HybridDocumentAnalyzer {
  constructor() {
    this.analysisStrategies = {
      layout: {
        priority: ['digital', 'vision', 'hybrid'],
        confidence: 0.8
      },
      text: {
        priority: ['digital', 'enhanced-ocr', 'standard-ocr'],
        confidence: 0.9
      },
      validation: {
        requireMultipleStrategies: true,
        minimumConfidence: 0.85
      }
    };

    // Known document patterns
    this.patterns = {
      financial: {
        sections: [
          {
            name: 'monthly-summary',
            markers: ['MONTHLY RESPONSIBILITIES', 'QUOTATION SUMMARY'],
            keyFields: ['Payout amount', 'Monthly instalment', 'Credit advanced']
          },
          {
            name: 'payment-details',
            markers: ['PAYMENT OF INSTALMENTS', 'DEBIT YOUR ACCOUNT'],
            keyFields: ['Account number', 'Branch code', 'Amount of each payment']
          }
        ],
        relationships: [
          {
            primary: 'Payout amount',
            related: ['Credit advanced', 'Monthly instalment'],
            validation: 'financial'
          }
        ]
      },
      reference: {
        patterns: [
          /Quote ref number\s*:\s*(\d{10})/i,
          /Case reference no\s*(\d{10})/i
        ],
        crossValidation: true
      }
    };
  }

  /**
   * Analyze document using multiple strategies
   */
  async analyzeDocument(document, options = {}) {
    const startTime = Date.now();
    const results = {
      layout: {},
      fields: {},
      confidence: {},
      metadata: {
        strategies: {},
        timing: {}
      }
    };

    try {
      // Start with layout analysis
      const layoutAnalysis = await this.analyzeLayout(document);
      results.layout = layoutAnalysis.layout;
      results.metadata.strategies.layout = layoutAnalysis.strategy;
      results.metadata.timing.layout = Date.now() - startTime;

      // Extract and validate fields
      const fieldResults = await this.extractFields(
        document,
        layoutAnalysis.layout
      );
      results.fields = fieldResults.fields;
      results.confidence = fieldResults.confidence;
      results.metadata.strategies.extraction = fieldResults.strategies;
      results.metadata.timing.extraction = Date.now() - results.metadata.timing.layout;

      // Cross-validate results
      const validation = await this.validateResults(results, document);
      results.validation = validation.results;
      results.metadata.validation = validation.metadata;
      results.metadata.timing.total = Date.now() - startTime;

      return results;
    } catch (error) {
      console.error('Document analysis failed:', error);
      throw error;
    }
  }

  /**
   * Analyze document layout using multiple strategies
   */
  async analyzeLayout(document) {
    const results = [];

    // Try digital analysis first
    if (document.textBoxes) {
      const digitalResult = await this.analyzeDigitalLayout(document);
      if (digitalResult.confidence >= this.analysisStrategies.layout.confidence) {
        return {
          layout: digitalResult.layout,
          confidence: digitalResult.confidence,
          strategy: 'digital'
        };
      }
      results.push(digitalResult);
    }

    // Try vision-based analysis
    const visionResult = await this.analyzeVisualLayout(document);
    results.push(visionResult);

    // Use hybrid approach if needed
    if (!results.some(r => r.confidence >= this.analysisStrategies.layout.confidence)) {
      const hybridResult = await this.hybridLayoutAnalysis(document, results);
      results.push(hybridResult);
    }

    // Select best result
    const bestResult = results.sort((a, b) => b.confidence - a.confidence)[0];
    return {
      layout: bestResult.layout,
      confidence: bestResult.confidence,
      strategy: bestResult.strategy
    };
  }

  /**
   * Extract fields using pattern matching and OCR
   */
  async extractFields(document, layout) {
    const results = {
      fields: {},
      confidence: {},
      strategies: {}
    };

    // Process each section
    for (const section of this.patterns.financial.sections) {
      const sectionRegion = layout[section.name];
      if (!sectionRegion) continue;

      // Try different extraction strategies
      const extractionResults = await Promise.all([
        this.extractDigitalFields(document, sectionRegion, section),
        this.extractOCRFields(document, sectionRegion, section),
        this.extractHybridFields(document, sectionRegion, section)
      ]);

      // Combine and validate results
      for (const field of section.keyFields) {
        const fieldResults = extractionResults.map(r => ({
          value: r.fields[field],
          confidence: r.confidence[field],
          strategy: r.strategy
        })).filter(r => r.value != null);

        if (fieldResults.length > 0) {
          // Select best result
          const bestResult = fieldResults.sort((a, b) => b.confidence - a.confidence)[0];
          results.fields[field] = bestResult.value;
          results.confidence[field] = bestResult.confidence;
          results.strategies[field] = bestResult.strategy;
        }
      }
    }

    return results;
  }

  /**
   * Validate results using multiple strategies
   */
  async validateResults(results, document) {
    const validation = {
      results: {
        status: 'unknown',
        confidence: 0,
        issues: []
      },
      metadata: {
        checks: [],
        timing: {}
      }
    };

    try {
      // Validate field relationships
      const relationshipChecks = await this.validateRelationships(
        results.fields,
        this.patterns.financial.relationships
      );
      validation.results.issues.push(...relationshipChecks.issues);

      // Validate reference numbers
      const referenceChecks = await this.validateReferences(
        results.fields,
        document
      );
      validation.results.issues.push(...referenceChecks.issues);

      // Calculate overall confidence
      validation.results.confidence = this.calculateValidationConfidence(
        relationshipChecks,
        referenceChecks
      );

      // Determine final status
      validation.results.status = this.determineValidationStatus(
        validation.results
      );

      return validation;
    } catch (error) {
      console.error('Validation failed:', error);
      throw error;
    }
  }

  /**
   * Validate field relationships
   */
  async validateRelationships(fields, relationships) {
    const results = {
      valid: true,
      confidence: 0,
      issues: []
    };

    for (const relation of relationships) {
      const primaryValue = fields[relation.primary];
      if (!primaryValue) {
        results.issues.push(`Missing primary field: ${relation.primary}`);
        continue;
      }

      // Check related fields
      for (const relatedField of relation.related) {
        const relatedValue = fields[relatedField];
        if (!relatedValue) {
          results.issues.push(`Missing related field: ${relatedField}`);
          continue;
        }

        // Validate based on relationship type
        const validationResult = await this.validateFieldRelationship(
          primaryValue,
          relatedValue,
          relation.validation
        );

        if (!validationResult.valid) {
          results.issues.push(validationResult.issue);
        }
      }
    }

    return results;
  }

  /**
   * Validate specific field relationship
   */
  async validateFieldRelationship(primaryValue, relatedValue, type) {
    switch (type) {
      case 'financial':
        return this.validateFinancialRelationship(primaryValue, relatedValue);
      case 'reference':
        return this.validateReferenceRelationship(primaryValue, relatedValue);
      default:
        return { valid: false, issue: `Unknown validation type: ${type}` };
    }
  }

  /**
   * Calculate validation confidence
   */
  calculateValidationConfidence(relationshipChecks, referenceChecks) {
    const weights = {
      relationships: 0.6,
      references: 0.4
    };

    return (
      relationshipChecks.confidence * weights.relationships +
      referenceChecks.confidence * weights.references
    );
  }

  /**
   * Determine final validation status
   */
  determineValidationStatus(validation) {
    if (validation.confidence >= this.analysisStrategies.validation.minimumConfidence &&
        validation.issues.length === 0) {
      return 'valid';
    }

    if (validation.confidence < 0.5 || validation.issues.length > 3) {
      return 'invalid';
    }

    return 'review';
  }
}

export default HybridDocumentAnalyzer;
