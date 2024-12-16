import { pdf as pdfImageExtract } from "pdf-to-img";
import { PDFExtract } from "pdf.js-extract";
import { createOCREngine } from "tesseract-wasm";
import { loadWasmBinary } from "tesseract-wasm/node";
import cv from "@techstark/opencv-js";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "path";

class DocumentProcessor {
  constructor(options = {}) {
    this.pdfExtract = new PDFExtract();
    this.ocrEngine = null;
    this.preprocessors = [];
    this.postprocessors = [];

    // Configuration for image processing
    this.imageConfig = {
      scale: 3,
      minBrightness: 0.3,
      maxBrightness: 0.8,
      orientationThreshold: 1.0,
      minResolution: 300,
      maxSkewAngle: 5,
    };

    // Box normalization schema
    this.boxSchema = {
      text: String,
      confidence: Number,
      bounds: {
        x: Number,
        y: Number,
        width: Number,
        height: Number,
      },
      page: Number,
      source: String, // 'digital' | 'ocr'
      metadata: Object,
    };

    // Store model path from options or use default paths
    this.modelPath = options.modelPath || this.findModelPath();

    // Add debug options
    this.debugOptions = {
      outputPath: options.debugPath || path.join(process.cwd(), "debug_output"),
      saveImages: options.saveDebugImages || false,
    };
  }

  /**
   * Initialize OCR engine
   */
  async initialize() {
    if (!this.ocrEngine) {
      try {
        const wasmBinary = await loadWasmBinary();
        this.ocrEngine = await createOCREngine({ wasmBinary });
        if (!existsSync(this.modelPath)) {
          throw new Error(`Tesseract model not found at: ${this.modelPath}`);
        }

        const model = readFileSync(this.modelPath);
        this.ocrEngine.loadModel(model);

        console.log("OCR engine initialized successfully");
      } catch (error) {
        console.error("OCR initialization failed:", error);
        console.warn("Falling back to digital-only document processing");
        this.ocrEngine = null;
      }
    }
  }

  /**
   * Find tesseract model using various common locations
   */
  findModelPath() {
    const possiblePaths = [
      // Project root
      path.join(process.cwd(), "eng.traineddata"),
      // Project root models directory
      path.join(process.cwd(), "models", "eng.traineddata"),
      // Up one level (in case running from src)
      path.join(process.cwd(), "..", "eng.traineddata"),
      // Current directory
      path.join(__dirname, "eng.traineddata"),
    ];

    for (const modelPath of possiblePaths) {
      if (existsSync(modelPath)) {
        console.log(`Found tesseract model at: ${modelPath}`);
        return modelPath;
      }
    }

    // Default to project root if not found
    return path.join(process.cwd(), "eng.traineddata");
  }

  /**
   * Process document with combined digital and OCR approach
   */
  async processDocument(filePath) {
    try {
      // Create debug directory if needed
      if (this.debugOptions.saveImages) {
        await fs.mkdir(this.debugOptions.outputPath, { recursive: true });
      }

      // Extract digital content first
      const pdfData = await this.pdfExtract.extract(filePath);
      const isDigital = this.hasValidDigitalContent(pdfData);

      // Extract images regardless of digital content (for signature verification)
      const pages = await this.extractPages(filePath);

      // Process each page
      const results = [];
      for (const [index, pageBuffer] of pages.entries()) {
        // Save debug image if enabled
        if (this.debugOptions.saveImages) {
          const imagePath = path.join(
            this.debugOptions.outputPath,
            `page_${index + 1}.png`
          );
          await fs.writeFile(imagePath, pageBuffer);
          console.log(`Saved debug image: ${imagePath}`);
        }

        // Convert buffer to mat
        const processedPage = await this.processPage(
          pageBuffer,
          index,
          pdfData.pages[index]
        );
        results.push(processedPage);
      }

      return {
        pages: results,
        isDigital,
        metadata: {
          pageCount: pages.length,
          processedAt: new Date(),
          hasSignatures: results.some((p) => p.signatures?.length > 0),
        },
      };
    } catch (error) {
      console.error("Document processing failed:", error);
      throw error;
    }
  }

  /**
   * Process individual page with preprocessing and OCR
   */
  async processPage(pageImage, pageIndex, digitalData) {
    const result = {
      boxes: [],
      signatures: [],
      metadata: {},
    };

    try {
      // Convert page image to Mat format
      const imageMat = await this.imageToMat(pageImage);

      // Get initial quality assessment
      const initialQuality = await this.analyzeImageQuality(imageMat);
      result.metadata.initialQuality = initialQuality;

      // Determine if we need OCR based on digital content
      const needsOCR =
        !digitalData || !this.hasValidDigitalContent({ pages: [digitalData] });

      if (needsOCR) {
        // Apply preprocessing based on quality assessment
        const processed = await this.applyPreprocessing(
          imageMat,
          initialQuality
        );
        result.metadata.preprocessing = processed.metadata;

        console.log("processPage -> processed", processed);
        // Perform initial OCR
        const ocrResults = await this.performOCR(processed.image);
        const boxes = this.normalizeOCRBoxes(ocrResults, pageIndex);

        // Check OCR quality and retry with enhanced processing if needed
        if (this.needsEnhancedOCR(boxes, ocrResults.orientation)) {
          const enhancedResults = await this.performPostOCR(
            processed.image,
            pageIndex
          );
          boxes.push(...enhancedResults.boxes);
          result.metadata.enhancedOCR = enhancedResults.metadata;
        }

        result.boxes.push(...boxes);
        processed.image.delete();
      } else {
        // Use digital content but still process image for signatures
        result.boxes.push(
          ...this.normalizeDigitalBoxes(digitalData, pageIndex)
        );
      }

      // Always check for signatures regardless of content type
      const signatureResults = await this.detectSignatures(imageMat, pageIndex);
      result.signatures = signatureResults.marks;
      result.metadata.signatureDetection = signatureResults.metadata;

      // Clean up
      imageMat.delete();

      return result;
    } catch (error) {
      console.error(`Page ${pageIndex} processing failed:`, error);
      throw error;
    }
  }

  /**
   * Perform OCR on image with retries for low confidence
   */
  async performOCR(image) {
    try {
      if (!this.ocrEngine) {
        throw new Error("OCR engine not initialized");
      }

      // Convert image data for OCR
      const imageData = await this.prepareImageForOCR(image);
      console.log("OCR Image Data:", {
        width: imageData.width,
        height: imageData.height,
        hasData: !!imageData.data,
      });

      // Load image into OCR engine
      this.ocrEngine.loadImage(imageData);

      // Get initial orientation
      const orientation = this.ocrEngine.getOrientation();
      console.log("OCR Orientation:", orientation);

      let results = {
        boxes: [],
        orientation,
        confidence: 0,
        metadata: {
          retries: 0,
          enhancements: [],
        },
      };

      // Get initial text boxes
      results.boxes = this.ocrEngine.getTextBoxes("word");
      console.log("OCR Initial Boxes:", results.boxes.length);
      // Log a few sample boxes
      results.boxes.slice(0, 5).forEach((box) => {
        console.log("Sample Box:", {
          text: box.text,
          confidence: box.confidence,
          bbox: box.bbox,
        });
      });

      results.confidence = this.calculateOverallConfidence(results.boxes);
      console.log("OCR Initial Confidence:", results.confidence);

      // If low confidence or few results, try enhancement
      if (this.needsEnhancedOCR(results)) {
        console.log("Attempting Enhanced OCR...");
        const enhanced = await this.performEnhancedOCR(image, results);
        Object.assign(results, enhanced);
        console.log("Enhanced OCR Results:", {
          boxes: results.boxes.length,
          confidence: results.confidence,
        });
      }

      return results;
    } catch (error) {
      console.error("OCR processing failed:", error);
      throw error;
    }
  }

  /**
   * Prepare image data for OCR processing
   */
  async prepareImageForOCR(image) {
    try {
      // If input is already Mat, start with a clone
      const srcMat =
        image instanceof cv.Mat ? image.clone() : this.imageToMat(image);
      let processed = srcMat;

      // Convert to RGBA if needed (tesseract expects 4 channels)
      if (processed.channels() === 1) {
        const rgba = new cv.Mat();
        cv.cvtColor(processed, rgba, cv.COLOR_GRAY2RGBA);
        processed.delete();
        processed = rgba;
      } else if (processed.channels() === 3) {
        const rgba = new cv.Mat();
        cv.cvtColor(processed, rgba, cv.COLOR_BGR2RGBA);
        processed.delete();
        processed = rgba;
      }

      // Ensure proper resolution for OCR (300+ DPI equivalent)
      const minDim = Math.min(processed.rows, processed.cols);
      if (minDim < 1000) {
        // Arbitrary threshold for "low resolution"
        const scale = 1200 / minDim;
        const scaled = new cv.Mat();
        cv.resize(
          processed,
          scaled,
          new cv.Size(0, 0),
          scale,
          scale,
          cv.INTER_CUBIC
        );
        processed.delete();
        processed = scaled;
      }

      // Return in format Tesseract expects
      return {
        data: Buffer.from(processed.data),
        width: processed.cols,
        height: processed.rows,
      };
    } catch (error) {
      console.error("Image preparation failed:", error);
      if (image instanceof cv.Mat) {
        image.delete();
      }
      throw error;
    }
  }

  /**
   * Calculate overall confidence from OCR results
   */
  calculateOverallConfidence(boxes) {
    if (!boxes || boxes.length === 0) return 0;

    // Calculate weighted average confidence
    const totalConfidence = boxes.reduce((sum, box) => {
      // Weight longer text boxes more heavily
      const weight = Math.min(box.text.length / 5, 2);
      return sum + box.confidence * weight;
    }, 0);

    const totalWeight = boxes.reduce((sum, box) => {
      return sum + Math.min(box.text.length / 5, 2);
    }, 0);

    return totalWeight > 0 ? totalConfidence / totalWeight : 0;
  }

  /**
   * Perform focused OCR on specific region
   */
  async performRegionOCR(image, region, options = {}) {
    try {
      // Extract and enhance region
      const regionImage = await this.extractRegion(image, region);
      const enhanced = await this.enhanceRegion(regionImage);

      // Prepare image data
      const imageData = await this.prepareImageForOCR(enhanced.image);

      // Load image into OCR engine
      this.ocrEngine.loadImage(imageData);

      // Get text boxes
      const boxes = this.ocrEngine.getTextBoxes("word");
      const confidence = this.calculateOverallConfidence(boxes);

      // Clean up
      regionImage.delete();
      enhanced.image.delete();

      return {
        boxes,
        confidence,
        orientation: this.ocrEngine.getOrientation(),
        metadata: {
          region,
          enhancements: enhanced.metadata,
        },
      };
    } catch (error) {
      console.error("Region OCR failed:", error);
      throw error;
    }
  }

  /**
   * Extract region from image for focused OCR
   */
  async extractRegion(image, region) {
    const mat = await this.imageToMat(image);

    // Create region of interest
    const roi = mat.roi(
      new cv.Rect(region.x, region.y, region.width, region.height)
    );

    // Convert back to image format
    const buffer = await this.matToImageBuffer(roi);

    // Clean up
    mat.delete();
    roi.delete();

    return buffer;
  }

  /**
   * Perform enhanced OCR with multiple preprocessing attempts
   */
  async performEnhancedOCR(image, initialResults) {
    const results = {
      ...initialResults,
      metadata: {
        ...initialResults.metadata,
        retries: 0,
        enhancements: [],
      },
    };

    // Try different enhancement strategies
    const enhancements = [
      { name: "contrast", fn: async (img) => this.enhanceContrast(img) },
      { name: "sharpen", fn: async (img) => this.sharpenImage(img) },
      { name: "denoise", fn: async (img) => this.denoiseImage(img) },
      { name: "threshold", fn: async (img) => this.adaptiveThreshold(img) },
    ];

    for (const enhancement of enhancements) {
      try {
        // Apply enhancement
        const enhanced = await enhancement.fn(image);
        const imageData = await this.prepareImageForOCR(enhanced);

        // Perform OCR on enhanced image
        this.ocrEngine.loadImage(imageData);
        const boxes = this.ocrEngine.getTextBoxes("word");
        const confidence = this.calculateOverallConfidence(boxes);

        // Keep best results
        if (confidence > results.confidence) {
          results.boxes = boxes;
          results.confidence = confidence;
          results.metadata.enhancements.push(enhancement.name);
        }

        results.metadata.retries++;

        // Clean up
        enhanced.delete();

        // Stop if we achieve good confidence
        if (confidence > 0.8) break;
      } catch (error) {
        console.warn(`Enhancement ${enhancement.name} failed:`, error);
        continue;
      }
    }

    return results;
  }

  /**
   * Perform OCR on difficult regions
   */
  async performDifficultRegionOCR(image, region) {
    try {
      // Extract and scale region
      const roi = await this.extractRegion(image, region);
      const scaled = await this.scaleImage(roi, 2.0); // Double size

      // Apply focused enhancements
      const enhanced = await this.enhanceRegion(scaled, {
        denoise: true,
        contrast: true,
        sharpen: true,
      });

      // Perform OCR
      const imageData = await this.prepareImageForOCR(enhanced.image);
      this.ocrEngine.loadImage(imageData);

      const results = {
        boxes: this.ocrEngine.getTextBoxes("word"),
        confidence: 0,
        metadata: {
          region,
          scale: 2.0,
          enhancements: enhanced.metadata,
        },
      };

      results.confidence = this.calculateOverallConfidence(results.boxes);

      // Clean up
      roi.delete();
      scaled.delete();
      enhanced.image.delete();

      return results;
    } catch (error) {
      console.error("Difficult region OCR failed:", error);
      throw error;
    }
  }

  /**
   * Perform enhanced OCR on difficult regions
   */
  async performPostOCR(imageMat, pageIndex) {
    const results = {
      boxes: [],
      metadata: {
        regions: [],
        enhancements: [],
      },
    };

    try {
      // Identify difficult regions based on text density and contrast
      const regions = await this.identifyDifficultRegions(imageMat);

      for (const region of regions) {
        // Scale and enhance region
        const enhanced = await this.enhanceRegion(imageMat, region);
        results.metadata.enhancements.push(enhanced.metadata);

        // Perform focused OCR
        const ocrResult = await this.performRegionOCR(enhanced.image, region);

        // Normalize and adjust coordinates back to original scale
        const normalizedBoxes = this.normalizeOCRBoxes(
          ocrResult,
          pageIndex
        ).map((box) =>
          this.adjustBoxCoordinates(box, region, enhanced.metadata.scale)
        );

        results.boxes.push(...normalizedBoxes);
        results.metadata.regions.push({
          bounds: region,
          confidence: ocrResult.confidence,
        });

        enhanced.image.delete();
      }

      return results;
    } catch (error) {
      console.error("Enhanced OCR failed:", error);
      return { boxes: [], metadata: { error } };
    }
  }

  /**
   * Identify regions that need enhanced processing
   */
  async identifyDifficultRegions(imageMat) {
    const regions = [];

    try {
      // Convert to grayscale
      const gray = new cv.Mat();
      cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);

      // Apply adaptive thresholding
      const binary = new cv.Mat();
      cv.adaptiveThreshold(
        gray,
        binary,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY_INV,
        11,
        2
      );

      // Find contours
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        binary,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE
      );

      // Analyze text-like regions
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        // Filter based on size and shape
        if (this.isTextRegion(contour, area)) {
          const rect = cv.boundingRect(contour);
          const roi = gray.roi(rect);

          // Check contrast and density
          const stats = this.calculateRegionStats(roi);
          if (stats.needsEnhancement) {
            regions.push({
              ...rect,
              stats,
            });
          }

          roi.delete();
        }
      }

      // Clean up
      gray.delete();
      binary.delete();
      contours.delete();
      hierarchy.delete();

      // Merge overlapping regions
      return this.mergeOverlappingRegions(regions);
    } catch (error) {
      console.error("Region identification failed:", error);
      return [];
    }
  }

  /**
   * Enhance specific region for better OCR
   */
  async enhanceRegion(imageMat, region) {
    try {
      // Extract region
      const roi = imageMat.roi(
        new cv.Rect(region.x, region.y, region.width, region.height)
      );

      // Scale up for better OCR
      const scale = Math.min(4.0, 1200 / Math.max(roi.cols, roi.rows));
      const scaled = new cv.Mat();
      cv.resize(roi, scaled, new cv.Size(0, 0), scale, scale, cv.INTER_CUBIC);

      // Enhance based on region stats
      const enhanced = await this.enhanceImage(scaled, region.stats);

      roi.delete();
      scaled.delete();

      return {
        image: enhanced.image,
        metadata: {
          scale,
          ...enhanced.metadata,
        },
      };
    } catch (error) {
      console.error("Region enhancement failed:", error);
      throw error;
    }
  }

  /**
   * Check if region needs enhanced OCR processing
   */
  needsEnhancedOCR(boxes, orientation) {
    // Check box confidence and density
    const lowConfidenceBoxes = boxes.filter((box) => box.confidence < 0.8);

    return (
      lowConfidenceBoxes.length > boxes.length * 0.2 || // More than 20% low confidence
      Math.abs(orientation.angle) > 2 || // Significant skew
      boxes.length < 10 // Too few boxes found
    );
  }

  /**
   * Adjust box coordinates back to original scale
   */
  adjustBoxCoordinates(box, region, scale) {
    const adjusted = {
      ...box,
      bounds: {
        x: region.x + box.bounds.x / scale,
        y: region.y + box.bounds.y / scale,
        width: box.bounds.width / scale,
        height: box.bounds.height / scale,
      },
    };

    // Adjust confidence based on enhancement success
    adjusted.confidence *= region.stats?.enhancementSuccess || 0.8;

    return adjusted;
  }

  /**
   * Calculate region statistics for enhancement
   */
  calculateRegionStats(roi) {
    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    cv.meanStdDev(roi, mean, stddev);

    const stats = {
      contrast: stddev.data64F[0] / mean.data64F[0],
      brightness: mean.data64F[0] / 255,
      needsEnhancement: false,
    };

    stats.needsEnhancement =
      stats.contrast < 0.4 || stats.brightness < 0.3 || stats.brightness > 0.8;

    mean.delete();
    stddev.delete();

    return stats;
  }

  /**
   * Merge overlapping regions
   */
  mergeOverlappingRegions(regions) {
    if (regions.length < 2) return regions;

    const merged = [];
    regions.sort((a, b) => a.y - b.y);

    let current = regions[0];
    for (let i = 1; i < regions.length; i++) {
      const next = regions[i];

      // Check for overlap
      if (
        current.y + current.height >= next.y - 10 &&
        Math.max(current.x, next.x) <
          Math.min(current.x + current.width, next.x + next.width)
      ) {
        // Merge regions
        current = {
          x: Math.min(current.x, next.x),
          y: Math.min(current.y, next.y),
          width:
            Math.max(current.x + current.width, next.x + next.width) -
            Math.min(current.x, next.x),
          height:
            Math.max(current.y + current.height, next.y + next.height) -
            Math.min(current.y, next.y),
          stats: {
            needsEnhancement: true,
            ...current.stats,
          },
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Extract pages as images from PDF
   */
  async extractPages(filePath) {
    const pages = [];
    const pdfDocument = await pdfImageExtract(filePath, {
      scale: this.imageConfig.scale,
      docInitParams: {
        useSystemFonts: true,
        disableFontFace: true,
      },
    });

    for await (const image of pdfDocument) {
      pages.push(image);
    }

    return pages;
  }

  /**
   * Apply preprocessing pipeline to image
   */
  async applyPreprocessing(imageMat) {
    const metadata = {};

    // Convert to grayscale for initial analysis
    const gray = new cv.Mat();
    cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);

    // Detect and correct skew
    const orientation = await this.detectOrientation(gray);
    if (Math.abs(orientation.angle) > this.imageConfig.orientationThreshold) {
      const rotated = await this.rotateImage(imageMat, -orientation.angle);
      metadata.orientation = orientation;
      imageMat.delete();
      imageMat = rotated;
    }

    // Analyze and enhance image quality
    const quality = await this.analyzeImageQuality(gray);
    metadata.quality = quality;

    if (quality.needsEnhancement) {
      // Create enhanced copy
      const enhanced = new cv.Mat();
      imageMat.copyTo(enhanced);

      // Apply adaptive histogram equalization for better contrast
      if (quality.contrast < 0.4) {
        const clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
        clahe.apply(enhanced, enhanced);
        metadata.enhancement = { ...metadata.enhancement, contrast: true };
      }

      // Denoise if needed
      if (quality.noise > 0.1) {
        cv.fastNlMeansDenoisingColored(enhanced, enhanced);
        metadata.enhancement = { ...metadata.enhancement, denoised: true };
      }

      // Sharpen for better OCR if text is blurry
      if (quality.sharpness < 0.3) {
        const kernel = cv.Mat.ones(3, 3, cv.CV_8S);
        kernel.data[4] = -8;
        cv.filter2D(enhanced, enhanced, -1, kernel);
        kernel.delete();
        metadata.enhancement = { ...metadata.enhancement, sharpened: true };
      }

      imageMat.delete();
      imageMat = enhanced;
    }

    gray.delete();

    return {
      image: imageMat,
      metadata,
    };
  }

  /**
   * Detect image orientation using OpenCV
   */
  async detectOrientation(gray) {
    try {
      // Use line detection to find dominant angles
      const edges = new cv.Mat();
      cv.Canny(gray, edges, 50, 150, 3);

      const lines = new cv.Mat();
      cv.HoughLines(edges, lines, 1, Math.PI / 180, 100);

      // Calculate dominant angle
      let angle = 0;
      if (lines.rows > 0) {
        const angles = [];
        for (let i = 0; i < lines.rows; i++) {
          angles.push((lines.data32F[i * 2 + 1] * 180) / Math.PI);
        }
        angle = this.calculateDominantAngle(angles);
      }

      edges.delete();
      lines.delete();

      return {
        angle,
        confidence: angle !== 0 ? 0.8 : 1.0,
      };
    } catch (error) {
      console.error("Orientation detection failed:", error);
      return { angle: 0, confidence: 0 };
    }
  }

  /**
   * Analyze image quality for potential enhancement
   */
  async analyzeImageQuality(gray) {
    const analysis = {
      brightness: 0,
      contrast: 0,
      sharpness: 0,
      noise: 0,
      needsEnhancement: false,
    };

    try {
      // Calculate average brightness
      const mean = new cv.Mat();
      const stddev = new cv.Mat();
      cv.meanStdDev(gray, mean, stddev);
      analysis.brightness = mean.data64F[0] / 255;
      analysis.contrast = stddev.data64F[0] / 128;

      // Estimate sharpness using Laplacian
      const laplacian = new cv.Mat();
      cv.Laplacian(gray, laplacian, cv.CV_64F);
      analysis.sharpness = cv.mean(laplacian)[0] / 255;

      // Estimate noise
      const blur = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      const diff = new cv.Mat();
      cv.absdiff(gray, blur, diff);
      analysis.noise = cv.mean(diff)[0] / 255;

      // Determine if enhancement needed
      analysis.needsEnhancement =
        analysis.brightness < this.imageConfig.minBrightness ||
        analysis.brightness > this.imageConfig.maxBrightness ||
        analysis.contrast < 0.4 ||
        analysis.sharpness < 0.3;

      // Clean up
      mean.delete();
      stddev.delete();
      laplacian.delete();
      blur.delete();
      diff.delete();

      return analysis;
    } catch (error) {
      console.error("Quality analysis failed:", error);
      return { ...analysis, error: true };
    }
  }

  /**
   * Enhance image based on quality analysis
   */
  async enhanceImage(imageMat, quality) {
    const metadata = {};
    let enhanced = imageMat.clone();

    try {
      // Adjust brightness and contrast if needed
      if (quality.brightness < this.imageConfig.minBrightness) {
        const alpha = 1.5;
        const beta = 50;
        enhanced.convertTo(enhanced, -1, alpha, beta);
        metadata.brightnessAdjusted = true;
      }

      // Enhance contrast using adaptive histogram equalization
      if (quality.contrast < 0.4) {
        const clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
        clahe.apply(enhanced, enhanced);
        metadata.contrastEnhanced = true;
      }

      // Sharpen if needed
      if (quality.sharpness < 0.3) {
        const kernel = cv.Mat.ones(3, 3, cv.CV_8S);
        kernel.data[4] = -8;
        cv.filter2D(enhanced, enhanced, -1, kernel);
        kernel.delete();
        metadata.sharpened = true;
      }

      return {
        image: enhanced,
        metadata,
      };
    } catch (error) {
      console.error("Image enhancement failed:", error);
      enhanced.delete();
      return {
        image: imageMat.clone(),
        metadata: { error: true },
      };
    }
  }

  /**
   * Normalize OCR text boxes to common format
   */
  normalizeOCRBoxes(ocrResults, pageIndex) {
    return ocrResults.boxes.map((box) => ({
      text: box.text.trim(),
      confidence: box.confidence,
      bounds: {
        x: box.bbox.x0,
        y: box.bbox.y0,
        width: box.bbox.x1 - box.bbox.x0,
        height: box.bbox.y1 - box.bbox.y0,
      },
      page: pageIndex,
      source: "ocr",
      metadata: {
        baseline: box.baseline,
        orientation: box.orientation,
      },
    }));
  }

  /**
   * Normalize digital PDF text boxes to common format
   */
  normalizeDigitalBoxes(pageData, pageIndex) {
    return pageData.content.map((item) => ({
      text: item.str.trim(),
      confidence: 1.0,
      bounds: {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      },
      page: pageIndex,
      source: "digital",
      metadata: {
        font: item.fontName,
        direction: item.dir,
      },
    }));
  }

  /**
   * Check if PDF has valid digital content
   */
  hasValidDigitalContent(pdfData) {
    return pdfData.pages.some(
      (page) =>
        page.content &&
        page.content.length > 0 &&
        page.content.some(
          (item) =>
            item.str && item.str.trim().length > 0 && !this.isWatermark(item)
        )
    );
  }

  /**
   * Convert image buffer/data to OpenCV matrix
   */
  async imageToMat(imageData) {
    try {
      // Handle different input types
      if (imageData instanceof cv.Mat) {
        return imageData.clone();
      }

      // Convert Buffer to Mat
      if (Buffer.isBuffer(imageData) || imageData instanceof Uint8Array) {
        // Create array from buffer
        const data = new Uint8Array(imageData);

        // Create Mat directly from array
        // Try to determine dimensions - we might need to adjust this based on actual image size
        // Assuming RGBA format initially
        const width = Math.sqrt(data.length / 4);
        const height = width;
        const channels = 4;

        if (!isNaN(width) && width % 1 === 0) {
          // If dimensions work out evenly
          const mat = new cv.Mat(height, width, cv.CV_8UC4);
          mat.data.set(data);
          return mat;
        } else {
          // If dimensions aren't even, try single channel
          const mat = new cv.Mat(data.length, 1, cv.CV_8UC1);
          mat.data.set(data);
          return mat;
        }
      }

      // Handle raw pixel data with dimensions
      if (imageData.data && imageData.width && imageData.height) {
        const channels =
          imageData.data.length / (imageData.width * imageData.height);
        let mat = new cv.Mat(
          imageData.height,
          imageData.width,
          cv.CV_8UC(channels)
        );
        mat.data.set(imageData.data);
        return mat;
      }

      throw new Error("Unsupported image data format");
    } catch (error) {
      console.error("Mat conversion failed:", error);
      throw error;
    }
  }

  /**
   * Detect signatures and initials in image
   */
  async detectSignatures(imageMat, pageIndex) {
    const signatures = [];

    try {
      // Convert to binary image
      const binary = new cv.Mat();
      cv.threshold(imageMat, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

      // Find contours
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        binary,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE
      );

      // Analyze each contour
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const perimeter = cv.arcLength(contour, true);

        // Filter potential signatures based on characteristics
        if (this.isSignatureCandidate(area, perimeter)) {
          const rect = cv.boundingRect(contour);
          signatures.push({
            type: this.classifyMark(area, perimeter),
            bounds: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            confidence: this.calculateSignatureConfidence(area, perimeter),
            page: pageIndex,
          });
        }
      }

      // Clean up
      binary.delete();
      contours.delete();
      hierarchy.delete();

      return signatures;
    } catch (error) {
      console.error("Signature detection failed:", error);
      return [];
    }
  }

  /**
   * Check if contour could be a signature or initial
   */
  isSignatureCandidate(area, perimeter) {
    if (area < 100 || area > 50000) return false;

    const complexity = (perimeter * perimeter) / area;
    return complexity > 50; // Signatures tend to be complex
  }

  /**
   * Classify mark as signature or initial
   */
  classifyMark(area, perimeter) {
    const complexity = (perimeter * perimeter) / area;
    return complexity > 100 ? "signature" : "initial";
  }

  /**
   * Calculate confidence score for signature detection
   */
  calculateSignatureConfidence(area, perimeter) {
    const complexity = (perimeter * perimeter) / area;
    const normalizedComplexity = Math.min(complexity / 200, 1);
    return 0.5 + normalizedComplexity * 0.5;
  }

  /**
   * Check if text item is likely a watermark
   */
  isWatermark(item) {
    return (
      item.str.includes("WATERMARK") ||
      item.str.includes("DRAFT") ||
      item.str.includes("COPY")
    );
  }

  /**
   * Calculate dominant angle from detected lines
   */
  calculateDominantAngle(angles) {
    // Group similar angles
    const groups = {};
    angles.forEach((angle) => {
      const normalized = Math.round(angle / 5) * 5;
      groups[normalized] = (groups[normalized] || 0) + 1;
    });

    // Find most common angle
    let dominantAngle = 0;
    let maxCount = 0;
    for (const [angle, count] of Object.entries(groups)) {
      if (count > maxCount) {
        maxCount = count;
        dominantAngle = parseInt(angle);
      }
    }

    // Return smallest correction angle
    if (Math.abs(dominantAngle) > 45) {
      return dominantAngle > 0 ? dominantAngle - 90 : dominantAngle + 90;
    }
    return dominantAngle;
  }

  /**
   * Rotate image by given angle
   */
  async rotateImage(imageMat, angle) {
    // Get image center
    const center = new cv.Point(imageMat.cols / 2, imageMat.rows / 2);

    // Calculate rotation matrix
    const rotMatrix = cv.getRotationMatrix2D(center, angle, 1.0);

    // Determine new image bounds
    const rads = Math.abs((angle * Math.PI) / 180);
    const newWidth = Math.ceil(
      imageMat.rows * Math.abs(Math.sin(rads)) +
        imageMat.cols * Math.abs(Math.cos(rads))
    );
    const newHeight = Math.ceil(
      imageMat.rows * Math.abs(Math.cos(rads)) +
        imageMat.cols * Math.abs(Math.sin(rads))
    );

    // Adjust transformation matrix
    rotMatrix.data64F[2] += (newWidth - imageMat.cols) / 2;
    rotMatrix.data64F[5] += (newHeight - imageMat.rows) / 2;

    // Perform rotation
    const rotated = new cv.Mat();
    cv.warpAffine(
      imageMat,
      rotated,
      rotMatrix,
      new cv.Size(newWidth, newHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255)
    );

    // Clean up
    rotMatrix.delete();

    return rotated;
  }

  /**
   * Perform focused OCR on specific region
   */
  async performRegionOCR(imageMat, region) {
    try {
      // Extract region of interest
      const roi = imageMat.roi(
        new cv.Rect(region.x, region.y, region.width, region.height)
      );

      // Scale up for better OCR
      const scaled = new cv.Mat();
      cv.resize(roi, scaled, new cv.Size(0, 0), 2.0, 2.0, cv.INTER_CUBIC);

      // Convert to proper format for OCR
      const buffer = await this.matToImageBuffer(scaled);

      // Perform OCR
      this.ocrEngine.loadImage({
        data: buffer,
        width: scaled.cols,
        height: scaled.rows,
      });

      const results = {
        boxes: this.ocrEngine.getTextBoxes("word"),
        orientation: this.ocrEngine.getOrientation(),
      };

      // Clean up
      roi.delete();
      scaled.delete();

      return results;
    } catch (error) {
      console.error("Region OCR failed:", error);
      throw error;
    }
  }

  /**
   * Convert OpenCV Mat to image buffer
   */
  async matToImageBuffer(mat) {
    try {
      // Convert to RGBA if needed
      let rgba;
      if (mat.channels() === 1) {
        rgba = new cv.Mat();
        cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
      } else if (mat.channels() === 3) {
        rgba = new cv.Mat();
        cv.cvtColor(mat, rgba, cv.COLOR_BGR2RGBA);
      } else {
        rgba = mat.clone();
      }

      // Create buffer from mat data
      const buffer = Buffer.from(rgba.data);

      // Clean up
      if (rgba !== mat) {
        rgba.delete();
      }

      return buffer;
    } catch (error) {
      console.error("Mat to buffer conversion failed:", error);
      throw error;
    }
  }

  /**
   * Add preprocessing step
   */
  addPreprocessor(fn) {
    this.preprocessors.push(fn);
  }

  /**
   * Add postprocessing step
   */
  addPostprocessor(fn) {
    this.postprocessors.push(fn);
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.ocrEngine) {
      this.ocrEngine.destroy();
      this.ocrEngine = null;
    }
  }
}

export default DocumentProcessor;
