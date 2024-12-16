import { pdf as pdfImageExtract } from "pdf-to-img";
import { PDFExtract } from "pdf.js-extract";
import { createOCREngine } from "tesseract-wasm";
import { loadWasmBinary } from "tesseract-wasm/node";
import cv from "@techstark/opencv-js";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "path";
import sharp from "sharp";

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
    // Debug logging configuration
    this.debug = {
      enabled: true,
      logPath: options.debugPath || path.join(process.cwd(), "debug_output"),
      imagePath:
        options.debugPath || path.join(process.cwd(), "debug_output", "images"),
      logFile: "processing.log",
    };

    this.log(
      "MODEL PATH contructor value - constructor:",
      "INFO",
      this.modelPath
    );
  }

  /**
   * Initialize OCR engine
   */
  async initialize() {
    try {
      await this.initDebugDirectory();
      this.log("Initializing DocumentProcessor - initialize");

      if (!this.ocrEngine) {
        const wasmBinary = await loadWasmBinary();
        this.log("WASM binary loaded successfully - initialize");

        this.ocrEngine = await createOCREngine({ wasmBinary });
        this.log("OCR engine created successfully - initialize");

        if (!existsSync(this.modelPath)) {
          throw new Error(`Tesseract model not found at: ${this.modelPath}`);
        }

        const model = readFileSync(this.modelPath);
        this.ocrEngine.loadModel(model);
        this.log("Tesseract model loaded successfully - initialize");
      }
    } catch (error) {
      this.log(
        `Initialization failed - initialize:`,
        "ERROR",
        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  /**
   * Process document with combined digital and OCR approach
   */
  async processDocument(filePath) {
    try {
      this.log(`Starting document processing - processDocument: ${filePath}`);

      // Extract digital content first
      const pdfData = await this.pdfExtract.extract(filePath);
      const isDigital = this.hasValidDigitalContent(pdfData);
      this.log(
        `Document type detected - processDocument: ${
          isDigital ? "Digital" : "Scanned"
        }`
      );

      if (isDigital) {
        this.log(
          "Digital content structure - processDocument:",
          "INFO",
          JSON.stringify(pdfData.pages[0].content.slice(0, 2))
        );
      }

      // Extract images
      this.log("Extracting page images - processDocument");
      const pages = await this.extractPages(filePath);
      this.log(`Extracted ${pages.length} pages - processDocument`);

      // Process each page
      const results = [];
      for (const [index, pageBuffer] of pages.entries()) {
        this.log(
          `Processing page ${index + 1}/${pages.length} - processDocument`
        );

        try {
          // Save debug image
          await this.saveDebugImage(
            pageBuffer,
            `page_${index + 1}_original.png`
          );

          // Convert buffer to mat
          const processedPage = await this.processPage(
            pageBuffer,
            index,
            pdfData.pages[index]
          );

          this.log(
            `Page ${index + 1} processing results - processDocument:`,
            "INFO",
            {
              boxes: processedPage.boxes.length,
              signatures: processedPage.signatures.length,
              metadata: processedPage.metadata,
            }
          );

          results.push(processedPage);
        } catch (error) {
          this.log(
            `Error processing page ${index + 1} - processDocument:`,
            "ERROR",
            error?.stack || error.toString?.()
          );
          throw error;
        }
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
      this.log(
        `Document processing failed - processDocument:`,
        "ERROR",
        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  /**
   * Process individual page with preprocessing and OCR
   */
  async processPage(pageImage, pageIndex, digitalData) {
    this.log(`Starting page ${pageIndex + 1} processing - processPage`);

    const result = {
      boxes: [],
      signatures: [],
      metadata: {},
    };

    try {
      // Convert page image to Mat format
      const imageMat = await this.imageToMat(pageImage);
      this.log("Converted page to Mat format - processPage", "INFO", {
        rows: imageMat.rows,
        cols: imageMat.cols,
        channels: imageMat.channels(),
      });

      // Get initial quality assessment
      const initialQuality = await this.analyzeImageQuality(imageMat);
      this.log(
        "Initial image quality assessment - processPage:",
        "INFO",
        initialQuality
      );
      result.metadata.initialQuality = initialQuality;

      // Determine if we need OCR based on digital content
      const needsOCR =
        !digitalData || !this.hasValidDigitalContent({ pages: [digitalData] });
      this.log(`OCR needed - processPage: ${needsOCR}`, "INFO", {
        hasDigitalData: !!digitalData,
        contentValid: this.hasValidDigitalContent({ pages: [digitalData] }),
      });

      if (needsOCR) {
        // Apply preprocessing
        const processed = await this.applyPreprocessing(
          imageMat,
          initialQuality
        );
        this.log("Preprocessing applied - processPage:", "INFO", processed);
        result.metadata.preprocessing = processed.metadata;

        await this.saveDebugImage(
          processed.image,
          `page_${pageIndex + 1}_preprocessed.png`
        );

        // Perform OCR
        const ocrResults = await this.performOCR(processed.image);
        this.log("Initial OCR results - processPage:", "INFO", {
          boxes: ocrResults.boxes.length,
          orientation: ocrResults.orientation,
          confidence: ocrResults.confidence,
        });

        const boxes = this.normalizeOCRBoxes(ocrResults, pageIndex);
        this.log("Normalized OCR boxes - processPage:", "INFO", {
          count: boxes.length,
          sample: boxes.slice(0, 2),
        });

        // Check OCR quality and retry if needed
        if (this.needsEnhancedOCR(boxes, ocrResults.orientation)) {
          this.log("Enhanced OCR processing required - processPage");
          const enhancedResults = await this.performEnhancedOCR(
            processed.image,
            pageIndex
          );
          boxes.push(...enhancedResults.boxes);
          result.metadata.enhancedOCR = enhancedResults.metadata;
          this.log("Enhanced OCR completed - processPage:", "INFO", {
            additionalBoxes: enhancedResults.boxes.length,
            metadata: enhancedResults.metadata,
          });
        }

        result.boxes.push(...boxes);
        processed.image.delete();
      } else {
        // Use digital content
        const digitalBoxes = this.normalizeDigitalBoxes(digitalData, pageIndex);
        this.log("Using digital content - processPage:", "INFO", {
          boxes: digitalBoxes.length,
          sample: digitalBoxes.slice(0, 2),
        });
        result.boxes.push(...digitalBoxes);
      }

      // Check for signatures
      const signatureResults = await this.detectSignatures(imageMat, pageIndex);
      result.signatures = signatureResults.marks;
      result.metadata.signatureDetection = signatureResults.metadata;
      this.log("Signature detection results - processPage:", "INFO", {
        count: signatureResults.marks.length,
        metadata: signatureResults.metadata,
      });

      imageMat.delete();
      return result;
    } catch (error) {
      this.log(
        `Page ${pageIndex + 1} processing failed - processPage:`,
        "ERROR",
        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  // Logging utilities
  async initDebugDirectory() {
    if (this.debug.enabled) {
      await fs.mkdir(this.debug.logPath, { recursive: true });
      await fs.mkdir(this.debug.imagePath, { recursive: true });
    }
  }

  log(message, level = "INFO", data = null) {
    if (!this.debug.enabled) return;

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level}: ${message}${
      data ? "\nData: " + JSON.stringify(data, null, 2) : ""
    }\n`;

    // Console output
    console.log(logMessage);

    // File output
    fs.appendFile(
      path.join(this.debug.logPath, this.debug.logFile),
      logMessage
    ).catch(console.error);
  }

  async saveDebugImage(image, filename) {
    if (!this.debug.enabled) return;

    try {
      const imagePath = path.join(this.debug.imagePath, filename);

      if (image instanceof cv.Mat) {
        this.log("Image is Mat - saveDebugImage", "INFO");

        // Convert Mat to raw pixel data
        const channels = image.channels();
        const buffer = Buffer.from(image.data);

        // Log buffer details for debugging
        this.log("Created buffer from Mat - saveDebugImage", "INFO", {
          bufferLength: buffer.length,
          matRows: image.rows,
          matCols: image.cols,
          channels,
        });

        // Use Sharp with raw pixel data
        await sharp(buffer, {
          raw: {
            width: image.cols,
            height: image.rows,
            channels: channels,
          },
        })
          .png()
          .toFile(imagePath);
      } else if (Buffer.isBuffer(image)) {
        this.log("Image is Buffer - saveDebugImage");
        await sharp(image).png().toFile(imagePath);
      } else if (image instanceof Uint8Array) {
        this.log("Image is Uint8Array - saveDebugImage");
        const buffer = Buffer.from(image);
        await sharp(buffer).png().toFile(imagePath);
      }

      this.log(`Saved debug image - saveDebugImage: ${filename}`, "INFO", {
        type:
          image instanceof cv.Mat
            ? "cv.Mat"
            : Buffer.isBuffer(image)
            ? "Buffer"
            : image instanceof Uint8Array
            ? "Uint8Array"
            : typeof image,
      });
    } catch (error) {
      this.log(
        `Failed to save debug image - saveDebugImage:`,
        "ERROR",
        error?.stack || error.toString()
      );
      throw error; // Rethrow to see error in processing
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
   * Perform OCR on image with retries for low confidence
   */
  async performOCR(image) {
    try {
      if (!this.ocrEngine) {
        throw new Error("OCR engine not initialized");
      }

      // Convert image data for OCR
      const imageData = await this.prepareImageForOCR(image);
      this.log("OCR Image Data - performOCR:", "INFO", {
        width: imageData.width,
        height: imageData.height,
        hasData: !!imageData.data,
      });

      // Load image into OCR engine
      this.ocrEngine.loadImage(imageData);

      // Get initial orientation
      const orientation = this.ocrEngine.getOrientation();
      this.log("OCR Orientation - performOCR:", "INFO", orientation);

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
      this.log("OCR Initial Boxes - performOCR:", "INFO", results.boxes.length);
      // Log a few sample boxes
      results.boxes.slice(0, 5).forEach((box) => {
        this.log("Sample Box - performOCR:", "INFO", {
          text: box.text,
          confidence: box.confidence,
          bbox: box.bbox,
        });
      });

      results.confidence = this.calculateOverallConfidence(results.boxes);
      this.log(
        "OCR Initial Confidence - performOCR:",
        "INFO",
        results.confidence
      );

      // If low confidence or few results, try enhancement
      if (this.needsEnhancedOCR(results)) {
        this.log("Attempting Enhanced OCR - performOCR");
        const enhanced = await this.performEnhancedOCR(image, results);
        Object.assign(results, enhanced);
        this.log("Enhanced OCR Results - performOCR:", "INFO", {
          boxes: results.boxes.length,
          confidence: results.confidence,
        });
      }

      return results;
    } catch (error) {
      this.log(
        "OCR processing failed - performOCR:",
        "ERROR",
        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  /**
   * Prepare image data for OCR processing
   */
  async prepareImageForOCR(image) {
    let processed = null;
    try {
      processed = await this.imageToMat(image);
      this.log("Initial Mat - prepareImageForOCR", "INFO", {
        rows: processed.rows,
        cols: processed.cols,
        channels: processed.channels()
      });
  
      // Keep dimensions consistent
      const finalWidth = processed.cols;
      const finalHeight = processed.rows;
  
      // Convert to grayscale first for enhancement
      const gray = new cv.Mat();
      cv.cvtColor(processed, gray, cv.COLOR_RGBA2GRAY);
      processed.delete();
      processed = gray;
  
      // Increase contrast and darken text
      const enhanced = new cv.Mat();
      cv.adaptiveThreshold(
        processed,
        enhanced,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15,  // Increased block size
        12   // Higher constant for darker text
      );
      processed.delete();
      processed = enhanced;
  
      // Convert back to RGBA for Tesseract
      const rgba = new cv.Mat();
      cv.cvtColor(enhanced, rgba, cv.COLOR_GRAY2RGBA);
      enhanced.delete();
      
      // Create 4-channel buffer for Tesseract
      const buffer = new Uint8Array(finalWidth * finalHeight * 4);
      buffer.set(new Uint8Array(rgba.data));
      rgba.delete();
  
      const imageData = {
        data: buffer,
        width: finalWidth,
        height: finalHeight
      };
  
      // Verify dimensions and data length match Tesseract requirements
      const expectedLength = finalWidth * finalHeight * 4; // 4 channels
      if (buffer.length !== expectedLength) {
        throw new Error(`Buffer size mismatch - expected ${expectedLength}, got ${buffer.length}`);
      }
  
      this.log("Prepared image for OCR - prepareImageForOCR", "INFO", {
        width: imageData.width,
        height: imageData.height,
        dataLength: imageData.data.length,
        expectedLength,
        channels: 4
      });
  
      return imageData;
    } catch (error) {
      this.log("OCR preparation failed - prepareImageForOCR", "ERROR", error);
      if (processed) processed.delete();
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
      this.log(
        "Region OCR failed - performRegionOCR:",
        "ERROR",
        error?.stack || error.toString?.()
      );
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
        this.log(
          `Enhancement ${enhancement.name} failed - performEnhancedOCR:`,
          "ERROR",
          error
        );
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
      this.log(
        "Difficult region OCR failed:",
        "ERROR",
        error?.stack || error.toString?.()
      );
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
      this.log(
        "Enhanced OCR failed:",
        "ERROR",
        error?.stack || error.toString?.()
      );
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
      this.log(
        "Region identification failed:",
        "ERROR",
        error?.stack || error.toString?.()
      );
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
      this.log(
        "Region enhancement failed:",
        "ERROR",
        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  /**
   * Check if region needs enhanced OCR processing
   */
  needsEnhancedOCR(results) {
    // Check box confidence and density
    const lowConfidenceBoxes = results.boxes.filter((box) => box.confidence < 0.8);

    return (
      lowConfidenceBoxes.length > results.boxes.length * 0.2 || // More than 20% low confidence
      Math.abs(results.orientation.angle) > 2 || // Significant skew
      results.boxes.length < 10 // Too few boxes found
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
    try {
      this.log("Starting PDF page extraction - extractPages", "INFO", {
        scale: this.imageConfig.scale,
        filePath,
      });

      const pdfDocument = await pdfImageExtract(filePath, {
        scale: this.imageConfig.scale || 3,
        docInitParams: {
          useSystemFonts: true,
          disableFontFace: true,
        },
        imageType: "png",
        density: 300,
      });

      const processedPages = [];

      for await (const pageBuffer of pdfDocument) {
        try {
          // Save raw buffer for debugging
          if (this.debug.enabled) {
            await this.saveDebugImage(
              pageBuffer,
              `page_${processedPages.length + 1}_raw.png`
            );
          }

          // First normalize using sharp
          const normalizedBuffer = await sharp(pageBuffer)
            .raw()
            .ensureAlpha()
            .toBuffer({ resolveWithObject: true });

          this.log("Normalized image buffer - extractPages", "INFO", {
            width: normalizedBuffer.info.width,
            height: normalizedBuffer.info.height,
            channels: normalizedBuffer.info.channels,
            size: normalizedBuffer.data.length,
          });

          // Create mat from normalized data for further processing
          const mat = new cv.Mat(
            normalizedBuffer.info.height,
            normalizedBuffer.info.width,
            cv.CV_8UC4
          );
          mat.data.set(normalizedBuffer.data);

          // Store original buffer which is what processDocument expects
          processedPages.push(pageBuffer);

          // Clean up
          mat.delete();
        } catch (error) {
          this.log("Failed to process page buffer - extractPages", "ERROR", {
            pageIndex: processedPages.length,
            error: error?.stack || error.toString(),
          });
          throw error;
        }
      }

      this.log(
        `Successfully extracted ${processedPages.length} pages - extractPages`
      );
      return processedPages; // Return array of buffers as expected by processDocument
    } catch (error) {
      this.log("PDF page extraction failed", "ERROR", error);
      throw error;
    }
  }

  // Helper method to determine image shape from buffer
  getImageShape(buffer) {
    // PNG header starts with these bytes
    const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    // Verify PNG header
    const isPNG = PNG_HEADER.every((byte, i) => buffer[i] === byte);
    if (!isPNG) {
      throw new Error("Invalid PNG format");
    }

    // PNG dimensions are stored at bytes 16-23
    const width =
      (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
    const height =
      (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];

    // PNG color type is at byte 25
    const colorType = buffer[25];

    // Determine number of channels based on PNG color type
    let channels;
    switch (colorType) {
      case 0:
        channels = 1;
        break; // Grayscale
      case 2:
        channels = 3;
        break; // RGB
      case 3:
        channels = 1;
        break; // Palette
      case 4:
        channels = 2;
        break; // Grayscale + Alpha
      case 6:
        channels = 4;
        break; // RGBA
      default:
        channels = 3;
    }

    return { width, height, channels };
  }

  /**
   * Apply preprocessing pipeline to image
   */
  async applyPreprocessing(imageMat) {
    let gray = null; // Initialize outside try block
    let enhanced = null;
    const metadata = {};

    try {
      // Convert to grayscale for initial analysis
      gray = new cv.Mat();
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
        enhanced = imageMat.clone();

        // Apply contrast enhancement if needed
        if (quality.contrast < 0.4) {
          // Use bilateral filter instead of adaptive histogram
          const contrast = new cv.Mat();
          cv.bilateralFilter(enhanced, contrast, 9, 75, 75);
          enhanced.delete();
          enhanced = contrast;
          metadata.enhancement = { ...metadata.enhancement, contrast: true };
        }

        // Denoise using median blur instead of fastNlMeansDenoising
        if (quality.noise > 0.1) {
          const denoised = new cv.Mat();
          cv.medianBlur(enhanced, denoised, 5);
          enhanced.delete();
          enhanced = denoised;
          metadata.enhancement = { ...metadata.enhancement, denoised: true };
        }

        // Sharpen using unsharp masking technique
        if (quality.sharpness < 0.3) {
          const blurred = new cv.Mat();
          const mask = new cv.Mat();
          const sharpened = new cv.Mat();

          // Create unsharp mask
          cv.GaussianBlur(enhanced, blurred, new cv.Size(5, 5), 0);
          cv.subtract(enhanced, blurred, mask);
          cv.addWeighted(enhanced, 1.5, mask, 0.5, 0, sharpened);

          enhanced.delete();
          blurred.delete();
          mask.delete();
          enhanced = sharpened;
          metadata.enhancement = { ...metadata.enhancement, sharpened: true };
        }

        // Ensure result is in proper format
        const result = new cv.Mat();
        enhanced.convertTo(result, cv.CV_8U);
        enhanced.delete();
        imageMat.delete();
        imageMat = result;
      }

      gray.delete();

      return {
        image: imageMat,
        metadata,
      };
    } catch (error) {
      // Clean up on error
      if (gray) gray.delete();
      if (enhanced && enhanced !== imageMat) enhanced.delete();

      this.log(
        "Preprocessing failed - applyPreprocessing:",
        "ERROR",
        error?.stack || error.toString()
      );
      throw error;
    }
  }
  /**
   * Detect image orientation using OpenCV
   */
  async detectOrientation(gray) {
    try {
      // Use line detection to find dominant angles
      const edges = new cv.Mat();
      const lines = new cv.Mat();

      // Apply Canny edge detection
      cv.Canny(gray, edges, 50, 150, 3);

      // Apply Hough transform
      cv.HoughLines(edges, lines, 1, Math.PI / 180, 100);

      let angle = 0;

      if (lines.rows > 0) {
        // Calculate angles from detected lines
        const angles = [];
        for (let i = 0; i < lines.rows; i++) {
          // We get rho and theta values
          const theta = lines.data32F[i * 2 + 1];
          // Convert to degrees
          let degrees = (theta * 180) / Math.PI - 90;
          // Normalize to [-45, 45] range
          if (degrees < -45) degrees += 90;
          if (degrees > 45) degrees -= 90;
          angles.push(degrees);
        }

        // Get median angle
        angles.sort((a, b) => a - b);
        angle = angles[Math.floor(angles.length / 2)];

        this.log("Detected angles - detectOrientation:", "INFO", {
          angleCount: angles.length,
          medianAngle: angle,
          sampleAngles: angles.slice(0, 3),
        });
      }

      // Clean up
      edges.delete();
      lines.delete();

      return {
        angle,
        confidence: angle !== 0 ? 0.8 : 1.0,
      };
    } catch (error) {
      this.log(
        "Orientation detection failed - detectOrientation:",
        "ERROR",
        error?.stack || error.toString()
      );
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

      // More conservative thresholds for enhancement
      analysis.needsEnhancement =
        analysis.brightness < 0.2 || // Much darker
        analysis.brightness > 0.9 || // Much lighter
        analysis.contrast < 0.3 || // Really low contrast
        analysis.sharpness < 0.2 || // Very blurry
        analysis.noise > 0.2; // Very noisy

      // Clean up
      mean.delete();
      stddev.delete();
      laplacian.delete();
      blur.delete();
      diff.delete();

      return analysis;
    } catch (error) {
      this.log(
        "Quality analysis failed - analyzeImageQuality:",
        "ERROR",
        error?.stack || error.toString()
      );
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
      this.log(
        "Image enhancement failed - enhanceImage:",
        "ERROR",
        error?.stack || error.toString?.()
      );
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
      // If already a Mat, return clone
      if (imageData instanceof cv.Mat) {
        return imageData.clone();
      }

      // If Buffer or raw data
      if (Buffer.isBuffer(imageData) || imageData instanceof Uint8Array) {
        const normalized = await sharp(imageData)
          .raw()
          .ensureAlpha()
          .toBuffer({ resolveWithObject: true });

        const mat = new cv.Mat(
          normalized.info.height,
          normalized.info.width,
          cv.CV_8UC4
        );
        mat.data.set(normalized.data);

        return mat;
      }

      // Handle image data object with dimensions
      if (imageData.data && imageData.width && imageData.height) {
        const mat = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
        mat.data.set(new Uint8Array(imageData.data));
        return mat;
      }

      throw new Error("Unsupported image data format");
    } catch (error) {
      this.log("Mat conversion failed - imageToMat", "ERROR", error);
      throw error;
    }
  }

  /**
   * Detect signatures and initials in image
   */
  async detectSignatures(imageMat, pageIndex) {
    this.log("Starting signature detection for page " + pageIndex);

    const results = {
      marks: [],
      metadata: {
        processedArea: 0,
        signatureCandidates: 0,
        rejectedCandidates: 0,
        processingTime: 0,
      },
    };

    try {
      const startTime = Date.now();

      // Convert to grayscale if not already
      let gray;
      if (imageMat.channels() === 1) {
        gray = imageMat.clone();
      } else {
        gray = new cv.Mat();
        cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);
      }

      // Convert to binary image with adaptive threshold for better mark detection
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

      // Save debug image if enabled
      await this.saveDebugImage(binary, `page_${pageIndex + 1}_binary.png`);

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

      this.log(`Found ${contours.size()} initial contours`);
      results.metadata.signatureCandidates = contours.size();

      // Analyze each contour
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);

        // Get basic contour properties
        const area = cv.contourArea(contour);
        const perimeter = cv.arcLength(contour, true);

        // Skip very small or very large contours
        if (area < 100 || area > imageMat.rows * imageMat.cols * 0.1) {
          results.metadata.rejectedCandidates++;
          continue;
        }

        // Calculate contour complexity metrics
        const complexity = (perimeter * perimeter) / area;
        const hull = new cv.Mat();
        cv.convexHull(contour, hull);
        const hullArea = cv.contourArea(hull);
        const solidity = area / hullArea;

        // Signature characteristics:
        // - High complexity (non-uniform shape)
        // - Medium solidity (not too solid, not too sparse)
        // - Reasonable aspect ratio
        const rect = cv.boundingRect(contour);
        const aspectRatio = rect.width / rect.height;

        const isSignatureCandidate =
          complexity > 50 && // Complex enough to be handwriting
          solidity > 0.2 &&
          solidity < 0.9 && // Not too solid/sparse
          aspectRatio > 0.2 &&
          aspectRatio < 5.0; // Reasonable shape

        if (isSignatureCandidate) {
          results.marks.push({
            type: this.classifyMark(area, complexity, solidity),
            bounds: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            confidence: this.calculateSignatureConfidence(complexity, solidity),
            page: pageIndex,
            metadata: {
              area,
              complexity,
              solidity,
            },
          });
        } else {
          results.metadata.rejectedCandidates++;
        }

        hull.delete();
      }

      // Clean up
      gray.delete();
      binary.delete();
      contours.delete();
      hierarchy.delete();

      results.metadata.processedArea = imageMat.rows * imageMat.cols;
      results.metadata.processingTime = Date.now() - startTime;

      this.log("Signature detection completed", "INFO", {
        found: results.marks.length,
        ...results.metadata,
      });

      return results;
    } catch (error) {
      this.log(
        "Signature detection failed:",
        "ERROR",
        error?.stack || error.toString?.()
      );

      // Return empty results with error metadata
      return {
        marks: [],
        metadata: {
          error: error.message,
          errorType: error.name,
          processingTime: 0,
        },
      };
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
  classifyMark(area, complexity, solidity) {
    // Signatures tend to be larger and more complex
    if (complexity > 100 && area > 1000) {
      return "signature";
    }
    // Initials are smaller and simpler
    if (complexity > 30 && complexity <= 100) {
      return "initial";
    }
    return "mark";
  }

  /**
   * Calculate confidence score for signature detection
   */
  calculateSignatureConfidence(complexity, solidity) {
    // Normalize metrics
    const complexityScore = Math.min(complexity / 200, 1);
    const solidityScore = 1 - Math.abs(solidity - 0.5) * 2; // Best around 0.5

    // Weight and combine scores
    return complexityScore * 0.7 + solidityScore * 0.3;
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
  async rotateImage(mat, angle) {
    if (Math.abs(angle) < 0.1) return mat.clone();

    try {
      // Get image center
      const center = new cv.Point(mat.cols / 2, mat.rows / 2);

      // Get rotation matrix
      const rotMat = cv.getRotationMatrix2D(center, angle, 1.0);

      // Calculate new dimensions
      const cos = Math.abs(rotMat.data64F[0]);
      const sin = Math.abs(rotMat.data64F[1]);

      const newWidth = Math.round(mat.rows * sin + mat.cols * cos);
      const newHeight = Math.round(mat.rows * cos + mat.cols * sin);

      // Adjust rotation matrix for new dimensions
      rotMat.data64F[2] += newWidth / 2 - center.x;
      rotMat.data64F[5] += newHeight / 2 - center.y;

      // Create output Mat
      const rotated = new cv.Mat();

      // Perform rotation
      cv.warpAffine(
        mat,
        rotated,
        rotMat,
        new cv.Size(newWidth, newHeight),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255)
      );

      this.log("Image rotation:", "INFO", {
        originalSize: `${mat.cols}x${mat.rows}`,
        newSize: `${newWidth}x${newHeight}`,
        angle: angle,
        center: `${center.x},${center.y}`,
      });

      // Clean up
      rotMat.delete();

      return rotated;
    } catch (error) {
      this.log("Image rotation failed:", "ERROR", error);
      return mat.clone(); // Return original on error
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
      this.log(
        "Mat to buffer conversion failed:",
        "ERROR",
        error?.stack || error.toString?.()
      );
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
