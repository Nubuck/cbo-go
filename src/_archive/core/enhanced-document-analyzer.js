import cv from '@techstark/opencv-js';
import { createOCREngine } from 'tesseract-wasm';
import { PDFExtract } from 'pdf.js-extract';
import DocumentProcessor from './document-processor.js';
import LayoutDetector from './layout-detector.js';

class EnhancedDocumentAnalyzer {
  constructor() {
    this.processors = {
      layout: new LayoutDetector(),
      ocr: null, // Initialized on demand
      tables: new TableDetector()
    };

    this.models = {
      layout: {
        modelPath: '/models/layout-base-500k.onnx',
        labelMap: {
          0: 'text',
          1: 'table',
          2: 'figure',
          3: 'signature'
        }
      },
      text: {
        modelPath: '/models/crnn_lite_lstm.onnx',
        charList: 'charset.txt'
      }
    };

    // Region templates based on known document layouts
    this.templates = {
      paq: {
        headerRegion: { yRatio: [0, 0.15] },
        financialRegion: { yRatio: [0.15, 0.4] },
        keyFields: {
          quoteRef: {
            region: 'header',
            patterns: ['Quote ref number', 'Quote reference'],
            valueFormat: /^\d{10}$/
          },
          payoutAmount: {
            region: 'financial',
            patterns: ['Payout amount', 'Credit advanced'],
            valueFormat: /^R\s*[\d,\.]+$/
          }
          // Add other fields...
        }
      }
    };
  }

  /**
   * Initialize models and processors
   */
  async initialize() {
    try {
      // Initialize OCR engine with improved model
      const wasmBinary = await loadWasmBinary();
      this.processors.ocr = await createOCREngine({
        wasmBinary,
        config: {
          tessedit_pageseg_mode: 6, // Assume uniform text block
          preserve_interword_spaces: '1',
          tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz,.-()/ '
        }
      });

      // Load specialized models
      await this.loadModels();

      return true;
    } catch (error) {
      console.error('Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Process document with enhanced analysis
   */
  async analyzeDocument(document, caseModel) {
    const startTime = performance.now();
    const results = {
      fields: {},
      validation: {},
      confidence: {},
      metadata: {}
    };

    try {
      // Detect document layout
      const layout = await this.detectLayout(document);
      
      // Process each detected region
      for (const [regionName, region] of Object.entries(layout.regions)) {
        const regionResults = await this.processRegion(
          document,
          region,
          regionName
        );
        
        Object.assign(results.fields, regionResults.fields);
        Object.assign(results.confidence, regionResults.confidence);
      }

      // Validate against case model
      const validation = await this.validateResults(
        results.fields,
        caseModel
      );

      results.validation = validation;
      results.metadata = {
        processingTime: performance.now() - startTime,
        modelVersions: this.getModelVersions(),
        quality: await this.assessQuality(results)
      };

      return results;
    } catch (error) {
      console.error('Document analysis failed:', error);
      throw error;
    }
  }

  /**
   * Process specific document region
   */
  async processRegion(document, region, regionName) {
    const results = {
      fields: {},
      confidence: {}
    };

    try {
      // Get region template if available
      const template = this.templates.paq[regionName];
      
      // Extract text from region
      const textResults = await this.extractRegionText(
        document,
        region,
        template
      );

      // Find key fields based on template
      if (template?.keyFields) {
        for (const [fieldName, fieldConfig] of Object.entries(template.keyFields)) {
          const fieldResult = await this.findField(
            textResults,
            fieldConfig
          );
          
          if (fieldResult) {
            results.fields[fieldName] = fieldResult.value;
            results.confidence[fieldName] = fieldResult.confidence;
          }
        }
      }

      return results;
    } catch (error) {
      console.error(`Region processing failed for ${regionName}:`, error);
      throw error;
    }
  }

  /**
   * Extract text from document region using best available method
   */
  async extractRegionText(document, region, template) {
    try {
      let textResults;

      // Try PDF text extraction first
      if (document.type === 'pdf' && document.textBoxes) {
        textResults = await this.extractPDFText(
          document.textBoxes,
          region
        );
      }

      // Fall back to OCR if needed
      if (!textResults?.length) {
        textResults = await this.performOCR(
          document,
          region,
          template
        );
      }

      // Normalize and clean results
      return this.normalizeTextResults(textResults);
    } catch (error) {
      console.error('Text extraction failed:', error);
      throw error;
    }
  }

  /**
   * Find specific field in text results
   */
  async findField(textResults, fieldConfig) {
    try {
      // Find potential field labels
      const labelMatches = textResults.filter(result => 
        fieldConfig.patterns.some(pattern => 
          result.text.includes(pattern)
        )
      );

      if (!labelMatches.length) return null;

      // Find associated values
      const valueMatches = [];
      for (const label of labelMatches) {
        const value = await this.findAssociatedValue(
          label,
          textResults,
          fieldConfig
        );
        
        if (value) {
          valueMatches.push({
            value: value.text,
            confidence: (label.confidence + value.confidence) / 2,
            distance: value.distance
          });
        }
      }

      // Select best match
      const bestMatch = valueMatches.sort((a, b) => 
        b.confidence - a.confidence
      )[0];

      if (bestMatch) {
        return {
          value: bestMatch.value,
          confidence: bestMatch.confidence
        };
      }

      return null;
    } catch (error) {
      console.error('Field finding failed:', error);
      throw error;
    }
  }

  /**
   * Find value associated with a field label
   */
  async findAssociatedValue(label, textResults, fieldConfig) {
    // Define search regions based on common layouts
    const searchRegions = [
      { dx: [0, 300], dy: [-10, 10] },    // Same line
      { dx: [-50, 50], dy: [10, 30] },    // Below
      { dx: [100, 400], dy: [-10, 10] }   // Right aligned
    ];

    let bestMatch = null;
    let minDistance = Infinity;

    for (const result of textResults) {
      if (result === label) continue;

      // Check if result is in any search region
      for (const region of searchRegions) {
        const dx = result.bounds.x - label.bounds.x;
        const dy = result.bounds.y - label.bounds.y;

        if (dx >= region.dx[0] && dx <= region.dx[1] &&
            dy >= region.dy[0] && dy <= region.dy[1]) {
          
          // Validate value format if specified
          if (fieldConfig.valueFormat &&
              !fieldConfig.valueFormat.test(result.text)) {
            continue;
          }

          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < minDistance) {
            minDistance = distance;
            bestMatch = {
              text: result.text,
              confidence: result.confidence,
              distance
            };
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Validate extracted results against case model
   */
  async validateResults(fields, caseModel) {
    const validation = {
      isValid: true,
      details: {},
      confidence: {}
    };

    try {
      // Validate each field
      for (const [fieldName, value] of Object.entries(fields)) {
        const validationResult = await this.validateField(
          fieldName,
          value,
          caseModel
        );

        validation.details[fieldName] = validationResult;
        validation.confidence[fieldName] = validationResult.confidence;
        
        if (!validationResult.isValid) {
          validation.isValid = false;
        }
      }

      return validation;
    } catch (error) {
      console.error('Results validation failed:', error);
      throw error;
    }
  }
}

export default EnhancedDocumentAnalyzer;
