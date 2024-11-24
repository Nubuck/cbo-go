import cv from '@techstark/opencv-js';
import { createOCREngine } from 'tesseract-wasm';

class EnhancedDocumentProcessor {
  constructor() {
    this.processingProfiles = {
      financial: {
        // Specialized processing for financial sections
        preprocessing: [
          'deskew',
          'denoise',
          'contrast_enhancement',
          'selective_scaling'
        ],
        regionDetection: {
          method: 'hybrid',
          tableFinder: true,
          valueAlignment: true
        }
      },
      signature: {
        // Optimized for mark detection
        preprocessing: [
          'binarization',
          'noise_removal',
          'morphological_cleanup'
        ],
        markDetection: {
          method: 'adaptive',
          acceptableTypes: ['signature', 'initial', 'stamp', 'mark']
        }
      }
    };

    // Known document layouts
    this.layoutTemplates = {
      paq: {
        anchorPoints: [
          'PRE-AGREEMENT STATEMENT',
          'QUOTATION SUMMARY',
          'MONTHLY RESPONSIBILITIES'
        ],
        keyRegions: {
          financial: {
            relativeBounds: { top: 0.2, bottom: 0.4, left: 0.1, right: 0.9 },
            keyFields: ['Payout amount', 'Monthly instalment', 'Annual interest rate']
          },
          signatures: {
            relativeBounds: { top: 0.8, bottom: 0.95, left: 0.1, right: 0.9 }
          }
        }
      }
    };
  }

  /**
   * Process document with enhanced analysis
   */
  async processDocument(document, options = {}) {
    try {
      // Initial layout analysis
      const layout = await this.analyzeLayout(document);

      // Process each detected region
      const regions = {};
      for (const [regionType, bounds] of Object.entries(layout.regions)) {
        const profile = this.processingProfiles[regionType];
        if (profile) {
          regions[regionType] = await this.processRegion(
            document, 
            bounds, 
            profile
          );
        }
      }

      // Cross-validate extracted information
      const validation = await this.validateResults(regions, layout);

      return {
        layout,
        regions,
        validation,
        confidence: this.calculateConfidence(validation)
      };
    } catch (error) {
      console.error('Document processing failed:', error);
      throw error;
    }
  }

  /**
   * Analyze document layout using combined approach
   */
  async analyzeLayout(document) {
    try {
      const layout = {
        regions: {},
        confidence: {},
        metadata: {}
      };

      // 1. Try template matching first
      const templateMatch = await this.matchTemplate(document);
      if (templateMatch.confidence > 0.8) {
        Object.assign(layout, templateMatch);
      }

      // 2. Use anchor point detection
      const anchors = await this.detectAnchors(document);
      if (anchors.length > 0) {
        this.refineLayoutWithAnchors(layout, anchors);
      }

      // 3. Content-based region detection
      const contentRegions = await this.detectContentRegions(document);
      this.mergeRegionDetections(layout, contentRegions);

      return layout;
    } catch (error) {
      console.error('Layout analysis failed:', error);
      throw error;
    }
  }

  /**
   * Process specific region with enhanced techniques
   */
  async processRegion(document, bounds, profile) {
    try {
      // Extract region
      const region = await this.extractRegion(document, bounds);

      // Apply preprocessing chain
      const enhanced = await this.applyPreprocessing(
        region,
        profile.preprocessing
      );

      // Process based on region type
      if (profile.regionDetection) {
        return await this.processStructuredRegion(enhanced, profile);
      } else if (profile.markDetection) {
        return await this.processMarkRegion(enhanced, profile);
      }

      return null;
    } catch (error) {
      console.error('Region processing failed:', error);
      throw error;
    }
  }

  /**
   * Process structured region (e.g., financial information)
   */
  async processStructuredRegion(region, profile) {
    const results = {
      fields: {},
      structure: {},
      confidence: {}
    };

    try {
      // Detect tables and structured content
      if (profile.regionDetection.tableFinder) {
        const tableStructure = await this.findTableStructure(region);
        results.structure = tableStructure;
      }

      // Find aligned values
      if (profile.regionDetection.valueAlignment) {
        const alignedValues = await this.findAlignedValues(region);
        Object.assign(results.fields, alignedValues);
      }

      // Extract and normalize values
      for (const [field, value] of Object.entries(results.fields)) {
        results.fields[field] = await this.normalizeValue(value, field);
      }

      return results;
    } catch (error) {
      console.error('Structured region processing failed:', error);
      throw error;
    }
  }

  /**
   * Process mark region (signatures, initials)
   */
  async processMarkRegion(region, profile) {
    const results = {
      marks: [],
      confidence: {}
    };

    try {
      // Detect potential marks
      const marks = await this.detectMarks(region, profile.markDetection);

      // Analyze each detected mark
      for (const mark of marks) {
        const analysis = await this.analyzeMark(mark, profile);
        if (analysis.confidence > 0.6) {
          results.marks.push({
            type: analysis.type,
            bounds: mark.bounds,
            confidence: analysis.confidence
          });
        }
      }

      // Calculate overall confidence
      results.confidence = this.calculateMarkConfidence(results.marks);

      return results;
    } catch (error) {
      console.error('Mark region processing failed:', error);
      throw error;
    }
  }

  /**
   * Analyze detected mark characteristics
   */
  async analyzeMark(mark, profile) {
    try {
      // Extract mark features
      const features = await this.extractMarkFeatures(mark);

      // Classify mark type
      const classification = await this.classifyMark(
        features,
        profile.markDetection.acceptableTypes
      );

      // Validate mark characteristics
      const validation = await this.validateMark(
        features,
        classification.type
      );

      return {
        type: classification.type,
        confidence: Math.min(classification.confidence, validation.confidence),
        characteristics: features
      };
    } catch (error) {
      console.error('Mark analysis failed:', error);
      throw error;
    }
  }

  /**
   * Extract features from mark region
   */
  async extractMarkFeatures(mark) {
    try {
      const features = {
        size: this.calculateMarkSize(mark),
        density: await this.calculateMarkDensity(mark),
        complexity: await this.calculateMarkComplexity(mark),
        orientation: await this.detectMarkOrientation(mark)
      };

      // Add stroke analysis if possible
      const strokes = await this.analyzeStrokes(mark);
      if (strokes) {
        features.strokes = strokes;
      }

      return features;
    } catch (error) {
      console.error('Feature extraction failed:', error);
      throw error;
    }
  }

  /**
   * Calculate mark density and distribution
   */
  async calculateMarkDensity(mark) {
    try {
      const mat = await this.imageToMat(mark.image);
      const binary = new cv.Mat();
      
      // Convert to binary
      cv.threshold(mat, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

      // Calculate density
      const pixels = cv.countNonZero(binary);
      const total = binary.rows * binary.cols;
      const density = pixels / total;

      // Calculate distribution
      const distribution = await this.analyzePixelDistribution(binary);

      // Clean up
      mat.delete();
      binary.delete();

      return {
        overall: density,
        distribution: distribution
      };
    } catch (error) {
      console.error('Density calculation failed:', error);
      throw error;
    }
  }

  /**
   * Analyze stroke characteristics
   */
  async analyzeStrokes(mark) {
    try {
      const mat = await this.imageToMat(mark.image);
      const edges = new cv.Mat();
      
      // Get edges
      cv.Canny(mat, edges, 50, 150);

      // Find contours
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, 
        cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Analyze strokes
      const strokes = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const stroke = {
          length: cv.arcLength(contour, false),
          curvature: this.calculateCurvature(contour),
          thickness: this.estimateStrokeThickness(contour)
        };
        strokes.push(stroke);
      }

      // Clean up
      mat.delete();
      edges.delete();
      contours.delete();
      hierarchy.delete();

      return strokes;
    } catch (error) {
      console.error('Stroke analysis failed:', error);
      throw error;
    }
  }
}

export default EnhancedDocumentProcessor;
