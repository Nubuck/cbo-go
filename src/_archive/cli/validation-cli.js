import { promises as fs } from 'node:fs';
import path from 'path';
import { pdf } from 'pdf-to-img';
import { PDFExtract } from 'pdf.js-extract';
import { createOCREngine } from 'tesseract-wasm';
import { distance } from 'fast-fuzzy';

import DocumentProcessor from './document-processor.js';
import FieldExtractor from './field-extractor.js';
import CriticalFieldValidator from './critical-validator.js';
import ValueNormalizer from './value-normalizer.js';

class DocumentValidationCLI {
  constructor() {
    this.processor = new DocumentProcessor();
    this.extractor = new FieldExtractor();
    this.validator = new CriticalFieldValidator();
    this.normalizer = new ValueNormalizer();

    // Define validation profiles
    this.validationProfiles = {
      paq: {
        criticalFields: {
          quoteRef: {
            pattern: /Quote ref number\s*:\s*(\d{10})/i,
            crossMatch: 'caseReference',
            required: true
          },
          payoutAmount: {
            pattern: /Payout amount\s*:?\s*R?\s*([\d,\.]+)/i,
            valueType: 'currency',
            required: true
          },
          monthlyInstalment: {
            pattern: /Monthly instalment.*?:?\s*R?\s*([\d,\.]+)/i,
            valueType: 'currency',
            required: true
          }
        },
        crossValidation: {
          references: ['quoteRef', 'caseReference'],
          financials: ['payoutAmount', 'creditAdvanced']
        }
      }
    };
  }

  /**
   * Process single document with validation
   */
  async processDocument(filePath, caseData) {
    console.log(`\nProcessing: ${path.basename(filePath)}`);
    const startTime = Date.now();

    try {
      // Extract document content
      const pdfExtract = new PDFExtract();
      const pdfData = await pdfExtract.extract(filePath);
      
      // Get document images for OCR/visual analysis
      const document = await pdf(filePath);
      const pages = [];
      for await (const image of document) {
        pages.push(image);
      }

      // Process with multiple strategies
      const results = await this.processWithStrategies(pdfData, pages, caseData);

      // Cross-validate results
      const validation = await this.validateResults(results, caseData);

      // Generate report
      const report = this.generateReport(results, validation, startTime);
      
      return {
        results,
        validation,
        report
      };
    } catch (error) {
      console.error('Document processing failed:', error);
      throw error;
    }
  }

  /**
   * Process document using multiple strategies
   */
  async processWithStrategies(pdfData, pages, caseData) {
    const results = {
      strategies: {},
      fields: {},
      confidence: {}
    };

    // Strategy 1: Digital PDF extraction
    if (pdfData.pages.length > 0) {
      const digitalResults = await this.extractDigitalContent(pdfData);
      results.strategies.digital = digitalResults;
      this.mergeResults(results, digitalResults, 'digital');
    }

    // Strategy 2: OCR-based extraction
    const ocrResults = await this.extractOCRContent(pages);
    results.strategies.ocr = ocrResults;
    this.mergeResults(results, ocrResults, 'ocr');

    // Strategy 3: Hybrid approach for uncertain fields
    const uncertainFields = this.findUncertainFields(results);
    if (uncertainFields.length > 0) {
      const hybridResults = await this.processUncertainFields(
        pages,
        uncertainFields,
        caseData
      );
      results.strategies.hybrid = hybridResults;
      this.mergeResults(results, hybridResults, 'hybrid');
    }

    return results;
  }

  /**
   * Extract content from digital PDF
   */
  async extractDigitalContent(pdfData) {
    const results = {
      fields: {},
      confidence: {},
      metadata: { strategy: 'digital' }
    };

    try {
      // Process each page
      for (const page of pdfData.pages) {
        // Extract fields using patterns
        for (const [fieldName, config] of Object.entries(this.validationProfiles.paq.criticalFields)) {
          const extracted = await this.extractFieldFromText(
            page.content,
            config.pattern,
            config.valueType
          );

          if (extracted) {
            results.fields[fieldName] = extracted.value;
            results.confidence[fieldName] = extracted.confidence;
          }
        }
      }

      return results;
    } catch (error) {
      console.error('Digital extraction failed:', error);
      throw error;
    }
  }

  /**
   * Extract content using OCR
   */
  async extractOCRContent(pages) {
    const results = {
      fields: {},
      confidence: {},
      metadata: { strategy: 'ocr' }
    };

    try {
      // Initialize OCR engine
      const engine = await createOCREngine();

      // Process each page
      for (const page of pages) {
        // Enhance image for OCR
        const enhanced = await this.processor.preprocess(page);
        
        // Perform OCR
        const ocrResult = await this.performOCR(enhanced, engine);

        // Extract fields from OCR text
        for (const [fieldName, config] of Object.entries(this.validationProfiles.paq.criticalFields)) {
          const extracted = await this.extractFieldFromText(
            ocrResult.text,
            config.pattern,
            config.valueType
          );

          if (extracted && (!results.fields[fieldName] || 
              extracted.confidence > results.confidence[fieldName])) {
            results.fields[fieldName] = extracted.value;
            results.confidence[fieldName] = extracted.confidence;
          }
        }
      }

      return results;
    } catch (error) {
      console.error('OCR extraction failed:', error);
      throw error;
    }
  }

  /**
   * Process uncertain fields using hybrid approach
   */
  async processUncertainFields(pages, uncertainFields, caseData) {
    const results = {
      fields: {},
      confidence: {},
      metadata: { strategy: 'hybrid' }
    };

    try {
      for (const field of uncertainFields) {
        const config = this.validationProfiles.paq.criticalFields[field];
        
        // Enhanced processing for uncertain fields
        const enhanced = await this.enhanceFieldDetection(
          pages,
          field,
          config,
          caseData
        );

        if (enhanced.value !== null) {
          results.fields[field] = enhanced.value;
          results.confidence[field] = enhanced.confidence;
        }
      }

      return results;
    } catch (error) {
      console.error('Hybrid processing failed:', error);
      throw error;
    }
  }

  /**
   * Validate extracted results
   */
  async validateResults(results, caseData) {
    const validation = {
      valid: true,
      confidence: 1.0,
      issues: [],
      details: {}
    };

    try {
      // Validate critical fields
      for (const [fieldName, config] of Object.entries(this.validationProfiles.paq.criticalFields)) {
        const fieldValidation = await this.validateField(
          fieldName,
          results.fields[fieldName],
          config,
          caseData
        );

        validation.details[fieldName] = fieldValidation;
        
        if (!fieldValidation.valid) {
          validation.valid = false;
          validation.issues.push(fieldValidation.issue);
        }
        
        validation.confidence *= fieldValidation.confidence;
      }

      // Perform cross-validation
      const crossValidation = await this.performCrossValidation(
        results.fields,
        this.validationProfiles.paq.crossValidation,
        caseData
      );

      validation.details.crossValidation = crossValidation;
      if (!crossValidation.valid) {
        validation.valid = false;
        validation.issues.push(...crossValidation.issues);
        validation.confidence *= crossValidation.confidence;
      }

      return validation;
    } catch (error) {
      console.error('Validation failed:', error);
      throw error;
    }
  }

  /**
   * Generate validation report
   */
  generateReport(results, validation, startTime) {
    const report = {
      summary: {
        status: validation.valid ? 'VALID' : 'INVALID',
        confidence: validation.confidence,
        processingTime: Date.now() - startTime,
        issueCount: validation.issues.length
      },
      fields: {},
      issues: validation.issues,
      recommendations: []
    };

    // Add field details
    for (const [fieldName, value] of Object.entries(results.fields)) {
      report.fields[fieldName] = {
        value,
        confidence: results.confidence[fieldName],
        strategy: this.determineWinningStrategy(fieldName, results.strategies),
        validation: validation.details[fieldName]
      };
    }

    // Add recommendations
    if (!validation.valid) {
      report.recommendations = this.generateRecommendations(
        validation,
        results
      );
    }

    return report;
  }

  /**
   * Print validation report
   */
  printReport(report) {
    console.log('\n=== Document Validation Report ===');
    console.log(`Status: ${report.summary.status}`);
    console.log(`Confidence: ${(report.summary.confidence * 100).toFixed(2)}%`);
    console.log(`Processing Time: ${report.summary.processingTime}ms`);
    
    console.log('\nField Results:');
    for (const [fieldName, details] of Object.entries(report.fields)) {
      console.log(`\n${fieldName}:`);
      console.log(`  Value: ${details.value}`);
      console.log(`  Confidence: ${(details.confidence * 100).toFixed(2)}%`);
      console.log(`  Strategy: ${details.strategy}`);
      
      if (details.validation && !details.validation.valid) {
        console.log(`  Issue: ${details.validation.issue}`);
      }
    }

    if (report.issues.length > 0) {
      console.log('\nValidation Issues:');
      report.issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
      });
    }

    if (report.recommendations.length > 0) {
      console.log('\nRecommendations:');
      report.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec}`);
      });
    }
  }
}

export default DocumentValidationCLI;
