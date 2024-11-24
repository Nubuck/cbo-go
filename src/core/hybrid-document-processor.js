import cv from '@techstark/opencv-js';
import { distance } from 'fast-fuzzy';
import { createOCREngine } from 'tesseract-wasm';

class HybridDocumentProcessor {
  constructor() {
    this.processingProfiles = {
      financial: {
        // Configurations for financial sections
        extraction: {
          useTableDetection: true,
          enhanceResolution: true,
          validateWithTemplate: true
        },
        validation: {
          fuzzyMatch: 0.9,
          crossValidate: true,
          requireStructure: true
        }
      },
      signature: {
        // Configurations for signature/initial detection
        detection: {
          useMarkDetection: true,
          acceptStamps: true,
          validatePosition: true
        },
        validation: {
          proximityCheck: true,
          sizeConstraints: false,
          requireExactMatch: false
        }
      }
    };

    // Pre-trained model configurations
    this.models = {
      layout: {
        type: 'doctr',
        modelPath: '/models/doctr-layout',
        confidence: 0.7
      },
      table: {
        type: 'paddleocr',
        modelPath: '/models/ppstructure',
        confidence: 0.8
      },
      text: {
        type: 'tesseract',
        modelPath: '/models/tessdata',
        confidence: 0.6
      }
    };
  }

  /**
   * Process document with combined approaches
   */
  async processDocument(document, options = {}) {
    const results = {
      layout: {},
      fields: {},
      validation: {},
      confidence: {}
    };

    try {
      // 1. Layout Analysis
      const layout = await this.analyzeLayout(document);
      results.layout = layout;

      // 2. Process each detected region
      for (const [regionType, region] of Object.entries(layout.regions)) {
        const profile = this.processingProfiles[regionType];
        if (!profile) continue;

        const processed = await this.processRegion(
          document,
          region,
          profile,
          options
        );

        results.fields[regionType] = processed.fields;
        results.validation[regionType] = processed.validation;
        results.confidence[regionType] = processed.confidence;
      }

      // 3. Cross-validate results
      const validation = await this.crossValidateResults(results);
      results.validation.cross = validation;

      return results;
    } catch (error) {
      console.error('Document processing failed:', error);
      throw error;
    }
  }

  /**
   * Analyze document layout using pre-trained models
   */
  async analyzeLayout(document) {
    try {
      // Use DocTR for initial layout analysis
      const layoutAnalysis = await this.detectLayout(document);

      // Enhance with PaddleOCR for table structures
      const tableAnalysis = await this.detectTables(document);

      // Combine and refine results
      const refinedLayout = await this.refineLayout(
        layoutAnalysis,
        tableAnalysis
      );

      return refinedLayout;
    } catch (error) {
      console.error('Layout analysis failed:', error);
      throw error;
    }
  }

  /**
   * Process specific region with appropriate strategy
   */
  async processRegion(document, region, profile, options) {
    try {
      let extractedFields = {};
      let confidence = 0;

      // Choose extraction strategy based on region type
      if (profile.extraction?.useTableDetection) {
        // Use PaddleOCR for structured data
        const tableResults = await this.extractTableData(
          document,
          region,
          profile
        );
        extractedFields = tableResults.fields;
        confidence = tableResults.confidence;
      } else {
        // Use Tesseract for general text
        const textResults = await this.extractTextData(
          document,
          region,
          profile
        );
        extractedFields = textResults.fields;
        confidence = textResults.confidence;
      }

      // Validate extracted data
      const validation = await this.validateExtraction(
        extractedFields,
        profile.validation
      );

      return {
        fields: extractedFields,
        validation,
        confidence
      };
    } catch (error) {
      console.error('Region processing failed:', error);
      throw error;
    }
  }

  /**
   * Extract data from table structures
   */
  async extractTableData(document, region, profile) {
    try {
      // Enhance region if needed
      const enhancedRegion = profile.extraction.enhanceResolution
        ? await this.enhanceRegion(document, region)
        : region;

      // Detect and extract table structure
      const tableStructure = await this.detectTableStructure(
        enhancedRegion,
        profile
      );

      // Extract and normalize cell contents
      const cells = await this.extractTableCells(
        tableStructure,
        profile
      );

      // Match cells to expected fields
      const fields = await this.matchTableFields(
        cells,
        profile
      );

      return {
        fields,
        confidence: this.calculateTableConfidence(fields, cells)
      };
    } catch (error) {
      console.error('Table extraction failed:', error);
      throw error;
    }
  }

  /**
   * Extract text data from region
   */
  async extractTextData(document, region, profile) {
    try {
      // Initialize OCR engine
      const engine = await createOCREngine();
      
      // Process region
      const textData = await this.performOCR(
        document,
        region,
        engine,
        profile
      );

      // Extract fields from text
      const fields = await this.extractFieldsFromText(
        textData,
        profile
      );

      return {
        fields,
        confidence: this.calculateTextConfidence(fields, textData)
      };
    } catch (error) {
      console.error('Text extraction failed:', error);
      throw error;
    }
  }

  /**
   * Validate extracted fields
   */
  async validateExtraction(fields, validationConfig) {
    const validation = {
      valid: true,
      issues: [],
      confidence: 1.0
    };

    try {
      // Validate required fields
      if (validationConfig.requireStructure) {
        const structureValid = await this.validateStructure(
          fields,
          validationConfig
        );
        if (!structureValid.valid) {
          validation.valid = false;
          validation.issues.push(...structureValid.issues);
          validation.confidence *= structureValid.confidence;
        }
      }

      // Perform fuzzy matching if configured
      if (validationConfig.fuzzyMatch) {
        const fuzzyValid = await this.validateFuzzyMatch(
          fields,
          validationConfig.fuzzyMatch
        );
        if (!fuzzyValid.valid) {
          validation.valid = false;
          validation.issues.push(...fuzzyValid.issues);
          validation.confidence *= fuzzyValid.confidence;
        }
      }

      // Cross-validate if required
      if (validationConfig.crossValidate) {
        const crossValid = await this.performCrossValidation(
          fields,
          validationConfig
        );
        if (!crossValid.valid) {
          validation.valid = false;
          validation.issues.push(...crossValid.issues);
          validation.confidence *= crossValid.confidence;
        }
      }

      return validation;
    } catch (error) {
      console.error('Validation failed:', error);
      throw error;
    }
  }

  /**
   * Cross-validate results across regions
   */
  async crossValidateResults(results) {
    const validation = {
      valid: true,
      confidence: 1.0,
      issues: []
    };

    try {
      // Validate consistency across regions
      const consistency = await this.validateConsistency(results);
      if (!consistency.valid) {
        validation.valid = false;
        validation.issues.push(...consistency.issues);
        validation.confidence *= consistency.confidence;
      }

      // Validate completeness
      const completeness = await this.validateCompleteness(results);
      if (!completeness.valid) {
        validation.valid = false;
        validation.issues.push(...completeness.issues);
        validation.confidence *= completeness.confidence;
      }

      return validation;
    } catch (error) {
      console.error('Cross-validation failed:', error);
      throw error;
    }
  }
}

export default HybridDocumentProcessor;
