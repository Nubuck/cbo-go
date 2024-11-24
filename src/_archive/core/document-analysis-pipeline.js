import cv from '@techstark/opencv-js';
import { createOCREngine } from 'tesseract-wasm';
import { PDFExtract } from 'pdf.js-extract';
import DocumentProcessor from './document-processor.js';
import FieldExtractor from './field-extractor.js';
import CriticalFieldValidator from './critical-validator.js';
import ValueNormalizer from './value-normalizer.js';
import SignatureDetector from './signature-detector.js';

class DocumentAnalysisPipeline {
  constructor() {
    this.pdfExtract = new PDFExtract();
    this.documentProcessor = DocumentProcessor.createDefaultPipeline();
    this.fieldExtractor = new FieldExtractor();
    this.validator = new CriticalFieldValidator();
    this.valueNormalizer = new ValueNormalizer();
    this.signatureDetector = new SignatureDetector();
    
    // Document type specific processors
    this.processors = {
      digital: this.processDigitalDocument.bind(this),
      scanned: this.processScannedDocument.bind(this)
    };
  }

  /**
   * Main entry point for document analysis
   */
  async analyzePDF(pdfBuffer, caseModel) {
    try {
      // Extract PDF data
      const pdfData = await this.pdfExtract.extract(pdfBuffer);
      
      // Determine document type and state
      const documentState = await this.analyzeDocumentState(pdfData, pdfBuffer);
      
      // Process according to document type
      const processor = this.processors[documentState.type];
      if (!processor) {
        throw new Error(`Unsupported document type: ${documentState.type}`);
      }

      // Process document and validate against case model
      const results = await processor(pdfData, pdfBuffer, documentState, caseModel);
      
      return {
        isValid: results.isValid,
        confidenceScore: results.confidence,
        extractedFields: results.fields,
        validationDetails: results.validation,
        processingMetadata: {
          documentType: documentState.type,
          processingTime: results.processingTime,
          qualityMetrics: documentState.quality
        }
      };
    } catch (error) {
      console.error('Document analysis failed:', error);
      throw error;
    }
  }

  /**
   * Analyze document state to determine processing strategy
   */
  async analyzeDocumentState(pdfData, pdfBuffer) {
    // Start with basic metadata
    const state = {
      pageCount: pdfData.pages.length,
      quality: {
        resolution: null,
        noise: null,
        contrast: null
      }
    };

    try {
      // Check for digital text content
      const hasDigitalText = pdfData.pages.some(page => 
        page.content && page.content.length > 0
      );

      if (hasDigitalText) {
        // Analyze text box structure
        const textAnalysis = await this.analyzeTextBoxStructure(pdfData);
        state.type = 'digital';
        state.textStructure = textAnalysis;
      } else {
        // Analyze image quality for OCR
        const imageAnalysis = await this.analyzeImageQuality(pdfBuffer);
        state.type = 'scanned';
        state.quality = imageAnalysis;
      }

      return state;
    } catch (error) {
      console.error('Document state analysis failed:', error);
      throw error;
    }
  }

  /**
   * Process digital document with text extraction
   */
  async processDigitalDocument(pdfData, pdfBuffer, documentState, caseModel) {
    const startTime = Date.now();
    const extractionResults = {};

    try {
      // Extract text content and structure
      for (const page of pdfData.pages) {
        // Process each page's content
        const pageFields = await this.extractDigitalFields(
          page.content,
          documentState.textStructure
        );

        // Store extracted fields
        Object.assign(extractionResults, pageFields);
      }

      // Validate required signatures and initials
      const signatureResults = await this.validateSignatures(
        pdfBuffer,
        documentState
      );

      // Validate against case model
      const validationResults = await this.validator.validateCriticalFields(
        extractionResults,
        caseModel
      );

      return {
        isValid: validationResults.valid,
        confidence: validationResults.confidence,
        fields: extractionResults,
        validation: validationResults,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('Digital document processing failed:', error);
      throw error;
    }
  }

  /**
   * Process scanned document with OCR
   */
  async processScannedDocument(pdfData, pdfBuffer, documentState, caseModel) {
    const startTime = Date.now();
    const extractionResults = {};

    try {
      // Initialize OCR engine
      const engine = await createOCREngine();

      // Process each page
      for (let pageNum = 0; pageNum < pdfData.pages.length; pageNum++) {
        // Preprocess page image
        const pageImage = await this.documentProcessor.preprocess(
          pdfBuffer,
          pageNum,
          documentState.quality
        );

        // Perform OCR
        const ocrResults = await this.performOCR(engine, pageImage);

        // Extract fields from OCR results
        const pageFields = await this.extractScannedFields(
          ocrResults,
          documentState
        );

        // Store extracted fields
        Object.assign(extractionResults, pageFields);
      }

      // Validate signatures and initials
      const signatureResults = await this.validateSignatures(
        pdfBuffer,
        documentState
      );

      // Validate against case model
      const validationResults = await this.validator.validateCriticalFields(
        extractionResults,
        caseModel
      );

      return {
        isValid: validationResults.valid,
        confidence: validationResults.confidence,
        fields: extractionResults,
        validation: validationResults,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('Scanned document processing failed:', error);
      throw error;
    }
  }

  /**
   * Extract fields from digital document text
   */
  async extractDigitalFields(content, textStructure) {
    const fields = {};
    
    try {
      // Group text elements by proximity and structure
      const textGroups = this.groupTextElements(content, textStructure);

      // Extract fields using field extractor
      for (const group of textGroups) {
        const extractedFields = await this.fieldExtractor.extractFields(
          group,
          'digital'
        );
        
        // Normalize extracted values
        for (const [field, value] of Object.entries(extractedFields)) {
          fields[field] = await this.valueNormalizer.normalizeValue(
            value,
            field
          );
        }
      }

      return fields;
    } catch (error) {
      console.error('Field extraction failed:', error);
      throw error;
    }
  }

  /**
   * Extract fields from OCR results
   */
  async extractScannedFields(ocrResults, documentState) {
    const fields = {};
    
    try {
      // Extract fields using field extractor with OCR context
      const extractedFields = await this.fieldExtractor.extractFields(
        ocrResults,
        'scanned',
        documentState.quality
      );

      // Normalize extracted values
      for (const [field, value] of Object.entries(extractedFields)) {
        fields[field] = await this.valueNormalizer.normalizeValue(
          value,
          field
        );
      }

      return fields;
    } catch (error) {
      console.error('OCR field extraction failed:', error);
      throw error;
    }
  }

  /**
   * Validate signatures and initials
   */
  async validateSignatures(pdfBuffer, documentState) {
    try {
      // Define expected signature locations
      const expectedLocations = this.getSignatureLocations(documentState);

      // Detect and validate signatures
      const detectedMarks = await this.signatureDetector.detectMarks(
        pdfBuffer,
        expectedLocations
      );

      return {
        valid: detectedMarks.every(mark => mark.confidence > 0.8),
        signatures: detectedMarks
      };
    } catch (error) {
      console.error('Signature validation failed:', error);
      throw error;
    }
  }
}

export default DocumentAnalysisPipeline;
