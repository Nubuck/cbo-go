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
        options.imagePath || path.join(process.cwd(), "debug_output", "images"),
      logFile: "processing.log",
    };

    this.info(
      "MODEL PATH contructor value - constructor:",

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
      this.err(
        `Initialization failed - initialize:`,

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
        this.info(
          "Digital content structure - processDocument:",

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

          this.info(
            `Page ${index + 1} processing results - processDocument:`,

            {
              boxes: processedPage.boxes.length,
              signatures: processedPage.signatures.length,
              metadata: processedPage.metadata,
            }
          );

          results.push(processedPage);
        } catch (error) {
          this.err(
            `Error processing page ${index + 1} - processDocument:`,

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
      this.err(
        `Document processing failed - processDocument:`,

        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  /**
   * Process individual page with preprocessing and OCR
   */
  async processPage(pageImage, pageIndex, digitalData = null) {
    const result = {
      boxes: [],
      signatures: [],
      metadata: {},
    };

    let currentMat = null;

    try {
      // Convert page image to Mat format
      currentMat = await this.imageToMat(pageImage);

      // Get initial quality assessment
      const initialQuality = await this.analyzeImageQuality(currentMat);
      this.info(
        "Initial image quality assessment - processPage:",
        initialQuality
      );
      result.metadata.initialQuality = initialQuality;

      // Determine if we need OCR
      const needsOCR =
        !digitalData || !this.hasValidDigitalContent({ pages: [digitalData] });
      this.info("OCR needed - processPage:", {
        hasDigitalData: !!digitalData,
        contentValid: this.hasValidDigitalContent({ pages: [digitalData] }),
      });

      if (needsOCR) {
        // Apply preprocessing
        const processed = await this.applyPreprocessing(
          currentMat,
          initialQuality
        );
        result.metadata.preprocessing = processed.metadata;

        // Save preprocessed debug image
        await this.saveDebugImage(
          processed.image,
          `page_${pageIndex + 1}_preprocessed.png`
        );

        // Store new Mat and cleanup old one
        const oldMat = currentMat;
        currentMat = processed.image;
        oldMat.delete();

        // Detect key regions
        const regions = await this.detectDocumentRegions(currentMat);
        result.metadata.regions = regions;

        // Process each region
        const regionResults = [];

        // Financial section with enhanced OCR
        if (regions.financials) {
          const financialResults = await this.performRegionOCR(
            currentMat,
            regions.financials,
            "financial"
          );
          regionResults.push(financialResults);

          // Save debug image of financial region
          if (this.debug.enabled) {
            const debugMat = currentMat.clone();
            cv.rectangle(
              debugMat,
              new cv.Point(regions.financials.x, regions.financials.y),
              new cv.Point(
                regions.financials.x + regions.financials.width,
                regions.financials.y + regions.financials.height
              ),
              new cv.Scalar(0, 255, 0, 255),
              2
            );
            await this.saveDebugImage(
              debugMat,
              `page_${pageIndex + 1}_financials.png`
            );
            debugMat.delete();
          }
        }

        // Header reference numbers
        if (regions.header) {
          const headerResults = await this.performRegionOCR(
            currentMat,
            regions.header,
            "reference"
          );
          regionResults.push(headerResults);
        }

        // Process full page for remaining content
        const fullPageResults = await this.performOCR(currentMat, pageIndex);

        // Merge all OCR results, prioritizing region-specific results
        const boxes = this.mergeOCRResults(regionResults, fullPageResults);
        result.boxes = this.normalizeOCRBoxes(boxes, pageIndex);

        // Save OCR debug visualization
        if (this.debug.enabled) {
          const debugMat = currentMat.clone();
          this.visualizeOCRResults(debugMat, result.boxes);
          await this.saveDebugImage(debugMat, `ocr_boxes_${pageIndex + 1}.png`);
          debugMat.delete();
        }
      } else {
        // Use digital content
        const digitalBoxes = this.normalizeDigitalBoxes(digitalData, pageIndex);
        this.info("Using digital content - processPage:", {
          boxes: digitalBoxes.length,
          sample: digitalBoxes.slice(0, 2),
        });
        result.boxes.push(...digitalBoxes);
      }

      // Detect signatures using the current Mat
      const signatureResults = await this.detectSignatures(
        currentMat,
        pageIndex
      );
      result.signatures = signatureResults.marks;
      result.metadata.signatureDetection = signatureResults.metadata;

      // Save binary image used for signature detection
      if (this.debug.enabled) {
        await this.saveDebugImage(
          signatureResults.binaryImage,
          `page_${pageIndex + 1}_binary.png`
        );
      }

      return result;
    } catch (error) {
      this.err(
        `Page ${pageIndex + 1} processing failed - processPage:`,
        error?.stack || error.toString()
      );
      throw error;
    } finally {
      // Ensure cleanup
      if (currentMat) currentMat.delete();
    }
  }

  // Helper function to merge OCR results from different sources
  mergeOCRResults(regionResults, fullPageResults) {
    const mergedBoxes = [];
    const usedAreas = new Set();

    // Add region-specific results first
    for (const region of regionResults) {
      for (const box of region.boxes) {
        mergedBoxes.push({
          ...box,
          source: region.type,
          confidence: box.confidence * 1.2, // Boost confidence for region-specific results
        });
        // Mark area as processed
        usedAreas.add(
          `${box.bounds.x},${box.bounds.y},${box.bounds.width},${box.bounds.height}`
        );
      }
    }

    // Add full page results that don't overlap with region results
    for (const box of fullPageResults.boxes) {
      const boxKey = `${box.bounds.x},${box.bounds.y},${box.bounds.width},${box.bounds.height}`;
      if (!this.isBoxOverlapping(box, usedAreas)) {
        mergedBoxes.push(box);
      }
    }

    return mergedBoxes;
  }

  // Helper function to check box overlap
  isBoxOverlapping(box, usedAreas) {
    for (const areaKey of usedAreas) {
      const [x, y, w, h] = areaKey.split(",").map(Number);
      if (
        box.bounds.x < x + w &&
        box.bounds.x + box.bounds.width > x &&
        box.bounds.y < y + h &&
        box.bounds.y + box.bounds.height > y
      ) {
        return true;
      }
    }
    return false;
  }

  // Helper function to visualize OCR results
  visualizeOCRResults(debugMat, boxes) {
    boxes.forEach((box) => {
      const confidence = box.confidence || 0;
      const color =
        box.source === "financial"
          ? new cv.Scalar(0, 255, 0, 255) // Green for financial
          : box.source === "reference"
          ? new cv.Scalar(255, 0, 0, 255) // Red for reference
          : new cv.Scalar(0, 0, 255, 255); // Blue for general

      cv.rectangle(
        debugMat,
        new cv.Point(box.bounds.x, box.bounds.y),
        new cv.Point(
          box.bounds.x + box.bounds.width,
          box.bounds.y + box.bounds.height
        ),
        color,
        2
      );

      // Add confidence score
      cv.putText(
        debugMat,
        `${(confidence * 100).toFixed(0)}%`,
        new cv.Point(box.bounds.x, box.bounds.y - 5),
        cv.FONT_HERSHEY_SIMPLEX,
        0.5,
        color,
        1
      );
    });
  }

  // Logging utilities
  async initDebugDirectory() {
    if (this.debug.enabled) {
      await fs.mkdir(this.debug.logPath, { recursive: true });
      await fs.mkdir(this.debug.imagePath, { recursive: true });
    }
  }

  info(message, data = null) {
    this.log(message, "INFO", data);
  }
  warn(message, data = null) {
    this.log(message, "WARN", data);
  }
  err(message, data = null) {
    console.error(message, data);
    this.log(message, "ERROR", data);
  }

  log(message, level = "INFO", data = null) {
    if (!this.debug.enabled) return;

    const timestamp = new Date().toISOString();
    const logMessage = `DocumentProcessor: [${timestamp}] ${level}: ${message}${
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
        // this.info("Image is Mat - saveDebugImage");

        // Convert Mat to raw pixel data
        const channels = image.channels();
        const buffer = Buffer.from(image.data);

        // Log buffer details for debugging
        // this.info("Created buffer from Mat - saveDebugImage", {
        //   bufferLength: buffer.length,
        //   matRows: image.rows,
        //   matCols: image.cols,
        //   channels,
        // });

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
        // this.log("Image is Buffer - saveDebugImage");
        await sharp(image).png().toFile(imagePath);
      } else if (image instanceof Uint8Array) {
        // this.log("Image is Uint8Array - saveDebugImage");
        const buffer = Buffer.from(image);
        await sharp(buffer).png().toFile(imagePath);
      }

      this.info(`Saved debug image - saveDebugImage: ${filename}`, {
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
      this.err(
        `Failed to save debug image - saveDebugImage:`,

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
  async performOCR(image, pageIndex = 0) {
    try {
      if (!this.ocrEngine) {
        throw new Error("OCR engine not initialized");
      }

      // Convert image data for OCR
      const imageData = await this.prepareImageForOCR(image);

      // Verify image data before loading
      const expectedLength = imageData.width * imageData.height * 4;
      if (imageData.data.length !== expectedLength) {
        throw new Error(
          `Invalid image data length. Expected ${expectedLength}, got ${imageData.data.length}`
        );
      }

      this.info("OCR Image Data - performOCR:", {
        width: imageData.width,
        height: imageData.height,
        dataLength: imageData.data.length,
        hasData: true,
      });

      // Load image into OCR engine
      this.ocrEngine.loadImage(imageData);
      // this.ocrEngine.setVariable("tessedit_pageseg_mode", "6"); // Assume uniform text block
      this.ocrEngine.setVariable("tessedit_pageseg_mode", "12"); // Assume sparse text
      this.ocrEngine.setVariable(
        "tessedit_char_whitelist",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,R$%()-/ "
      ); // Restrict characters
      this.ocrEngine.setVariable("textord_tabfind_find_tables", "1"); // Enable table detection

      // Get initial orientation
      const orientation = this.ocrEngine.getOrientation();
      this.info("OCR Orientation - performOCR:", orientation);

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
      this.info("OCR Boxes - performOCR:", {
        count: results.boxes.length,
        samples: results.boxes.slice(0, 10).map((box) => ({
          text: box.text,
          confidence: box.confidence,
          bounds: box.rect || box.bbox,
        })),
      });

      results.confidence = this.calculateOverallConfidence(results.boxes);
      this.info("OCR Initial Confidence - performOCR:", results.confidence);

      // Save debug visualization
      if (this.debug.enabled) {
        const debugMat = image.clone();
        results.boxes.forEach((box) => {
          // Get box coordinates
          const x = box.rect
            ? box.rect.left
            : box.bbox
            ? box.bbox.x0
            : box.left;
          const y = box.rect ? box.rect.top : box.bbox ? box.bbox.y0 : box.top;
          const width = box.rect
            ? box.rect.right - box.rect.left
            : box.bbox
            ? box.bbox.x1 - box.bbox.x0
            : box.right - box.left;
          const height = box.rect
            ? box.rect.bottom - box.rect.top
            : box.bbox
            ? box.bbox.y1 - box.bbox.y0
            : box.bottom - box.top;

          // Draw rectangle with confidence-based color
          const confidence = box.confidence || 0;
          const color = new cv.Scalar(
            0, // Red
            255 * confidence, // Green varies with confidence
            0, // Blue
            255 // Alpha
          );

          cv.rectangle(
            debugMat,
            new cv.Point(x, y),
            new cv.Point(x + width, y + height),
            color,
            2 // Line thickness
          );

          // Optionally add text confidence value
          cv.putText(
            debugMat,
            `${(confidence * 100).toFixed(0)}%`,
            new cv.Point(x, y - 5),
            cv.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            1
          );
        });

        await this.saveDebugImage(debugMat, `ocr_boxes_${pageIndex + 1}.png`);
        // debugMat.delete();

        // Generate detailed results file
        const detailedResults = results.boxes.map((box) => ({
          text: box.text,
          confidence: box.confidence,
          bounds: {
            left: box.left || box.rect?.left || box.bbox?.x0,
            top: box.top || box.rect?.top || box.bbox?.y0,
            right: box.right || box.rect?.right || box.bbox?.x1,
            bottom: box.bottom || box.rect?.bottom || box.bbox?.y1,
          },
          metrics: {
            aspectRatio: (box.right - box.left) / (box.bottom - box.top),
            area: (box.right - box.left) * (box.bottom - box.top),
            hasNumbers: /\d/.test(box.text),
            hasCurrency: /R\s*\d/.test(box.text),
          },
        }));

        await fs.writeFile(
          path.join(this.debug.logPath, `ocr_results_${pageIndex + 1}.json`),
          JSON.stringify(detailedResults, null, 2)
        );
      }

      // If low confidence or few results, try enhancement
      if (this.needsEnhancedOCR(results.boxes, results.orientation)) {
        this.log("Attempting Enhanced OCR - performOCR");
        const enhanced = await this.performEnhancedOCR(image, results);
        Object.assign(results, enhanced);
        this.info("Enhanced OCR Results - performOCR:", {
          boxes: results.boxes.length,
          confidence: results.confidence,
        });
      }

      return results;
    } catch (error) {
      this.err(
        "OCR processing failed - performOCR:",

        error?.stack || error.toString?.()
      );
      throw error;
    }
  }

  /**
   * Prepare image data for OCR processing
   */
  async prepareImageForOCR(image) {
    this.log('prepareImageForOCR 1')
    let processed = await this.imageToMat(image);

    try {
      this.log('prepareImageForOCR 2')
      // Convert to grayscale
      const gray = new cv.Mat();
      cv.cvtColor(processed, gray, cv.COLOR_RGBA2GRAY);
      processed.delete();
      this.log('prepareImageForOCR 3')
      // Apply more aggressive thresholding for form documents
      const binary = new cv.Mat();
      cv.adaptiveThreshold(
        gray,
        binary,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15, // Increased block size
        12 // Higher constant for darker text
      );
      gray.delete();
      this.log('prepareImageForOCR 4')
      // Remove noise
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
      const denoised = new cv.Mat();
      cv.morphologyEx(binary, denoised, cv.MORPH_OPEN, kernel);
      binary.delete();
      kernel.delete();
      this.log('prepareImageForOCR 5')
      // Convert back to RGBA
      const rgba = new cv.Mat();
      cv.cvtColor(denoised, rgba, cv.COLOR_GRAY2RGBA);
      denoised.delete();
      this.log('prepareImageForOCR 6')
      const imageData = {
        width: rgba.cols,
        height: rgba.rows,
        data: new Uint8ClampedArray(rgba.data),
      };
      this.log('prepareImageForOCR 7')
      rgba.delete();
      return imageData;
    } catch (error) {
      console.error("Failed to prepare image for OCR:", error);
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

  async detectDocumentRegions(imageMat) {
    const regions = {
      header: null,
      financials: null,
      accountDetails: null,
      signatures: null,
    };

    try {
      // Get page dimensions
      const pageHeight = imageMat.rows;
      const pageWidth = imageMat.cols;

      // Convert to grayscale
      const gray = new cv.Mat();
      cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);

      // Apply adaptive threshold to get text regions
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

      // Find contours to identify text blocks
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        binary,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE
      );

      // Analyze contours to identify key regions
      const boxes = [];
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const rect = cv.boundingRect(contour);

        // Filter small noise
        if (rect.width < 50 || rect.height < 20) continue;

        // Calculate relative position
        const relY = rect.y / pageHeight;

        // Classify region based on position and size
        if (relY < 0.2) {
          // Header region (quote ref, case numbers)
          if (!regions.header) {
            regions.header = {
              x: Math.max(0, rect.x - 20),
              y: Math.max(0, rect.y - 20),
              width: Math.min(rect.width + 40, pageWidth),
              height: Math.min(rect.height + 40, pageHeight / 4),
            };
          }
        } else if (relY > 0.3 && relY < 0.7) {
          // Financial details section
          if (!regions.financials) {
            regions.financials = {
              x: Math.max(0, rect.x - 40),
              y: Math.max(0, rect.y - 40),
              width: Math.min(rect.width + 80, pageWidth),
              height: Math.min(rect.height + 80, pageHeight / 2),
            };
          }
        } else if (relY > 0.7) {
          // Account details and signatures
          if (!regions.signatures) {
            regions.signatures = {
              x: Math.max(0, rect.x - 20),
              y: Math.max(0, rect.y - 20),
              width: Math.min(rect.width + 40, pageWidth),
              height: Math.min(rect.height + 40, pageHeight / 4),
            };
          }
        }
      }

      // Clean up
      gray.delete();
      binary.delete();
      contours.delete();
      hierarchy.delete();

      return regions;
    } catch (error) {
      this.err("Region detection failed:", error);
      throw error;
    }
  }

  /**
   * Perform focused OCR on specific region
   */
  async performRegionOCR(imageMat, region, type) {
    try {
      this.log('performRegionOCR 1')
      // Enhance region
      const enhanced = await this.enhanceRegion(imageMat, region, type);
      this.log('performRegionOCR 2')
      // Prepare for OCR
      const imageData = await this.prepareImageForOCR(enhanced);
      enhanced.delete();
      this.log('performRegionOCR 3')
      // Load enhanced image
      this.ocrEngine.loadImage(imageData);
      this.log('performRegionOCR 4')
      // Set OCR parameters based on region type
      if (type === "financial") {
        this.ocrEngine.setVariable("tessedit_char_whitelist", "0123456789.,R");
      } else if (type === "reference") {
        this.ocrEngine.setVariable("tessedit_char_whitelist", "0123456789");
      }
      this.log('performRegionOCR 5')
      // Get text boxes
      const boxes = this.ocrEngine.getTextBoxes("word");
      this.log('performRegionOCR 6')
      // Post-process boxes
      const processedBoxes = this.postProcessRegionBoxes(boxes, type);
      this.log('performRegionOCR 7')
      return {
        boxes: processedBoxes,
        type,
        region,
      };
    } catch (error) {
      this.err("Region OCR failed:", error);
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
  async performEnhancedOCR(image, pageIndex) {
    const MAX_BUFFER_SIZE = 100 * 1024 * 1024; // 100MB max buffer
    const MAX_IMAGE_DIMENSION = 4096; // Max width or height

    try {
      // Create results structure
      const results = {
        boxes: [],
        metadata: {
          enhancements: [],
          retries: 0,
          scaling: null,
        },
      };

      // Check and scale image if needed
      const imageSize = image.rows * image.cols * image.channels();
      if (
        imageSize > MAX_BUFFER_SIZE ||
        image.rows > MAX_IMAGE_DIMENSION ||
        image.cols > MAX_IMAGE_DIMENSION
      ) {
        const scale = Math.min(
          Math.sqrt(MAX_BUFFER_SIZE / imageSize),
          MAX_IMAGE_DIMENSION / Math.max(image.rows, image.cols)
        );

        const newSize = new cv.Size(
          Math.round(image.cols * scale),
          Math.round(image.rows * scale)
        );

        const scaled = new cv.Mat();
        cv.resize(image, scaled, newSize, 0, 0, cv.INTER_AREA);

        results.metadata.scaling = {
          originalSize: { width: image.cols, height: image.rows },
          newSize: { width: newSize.width, height: newSize.height },
          scale,
        };

        image = scaled; // Use scaled image for processing
      }

      // Define enhancement stages
      const enhancements = [
        {
          name: "contrast",
          apply: async (img) => {
            const mat = img.clone();
            const enhanced = new cv.Mat();
            mat.convertTo(enhanced, -1, 1.5, 20);
            mat.delete();
            return enhanced;
          },
        },
        {
          name: "denoise",
          apply: async (img) => {
            const mat = img.clone();
            const denoised = new cv.Mat();
            cv.medianBlur(mat, denoised, 3);
            mat.delete();
            return denoised;
          },
        },
        {
          name: "threshold",
          apply: async (img) => {
            const mat = img.clone();
            const binary = new cv.Mat();
            cv.threshold(
              mat,
              binary,
              0,
              255,
              cv.THRESH_BINARY + cv.THRESH_OTSU
            );
            mat.delete();
            return binary;
          },
        },
      ];

      // Try each enhancement
      for (const enhancement of enhancements) {
        try {
          const enhanced = await enhancement.apply(image);
          const imageData = await this.prepareImageForOCR(enhanced);
          enhanced.delete();

          this.ocrEngine.loadImage(imageData);
          const boxes = this.ocrEngine.getTextBoxes("word");

          if (boxes && boxes.length > 0) {
            results.boxes.push(...boxes);
            results.metadata.enhancements.push(enhancement.name);

            this.info(
              `Enhancement ${enhancement.name} successful - found ${boxes.length} boxes`
            );
          }

          results.metadata.retries++;
        } catch (error) {
          this.err(
            `Enhancement ${enhancement.name} failed - performEnhancedOCR:`,

            error
          );
          continue;
        }
      }

      return results;
    } catch (error) {
      this.err("Enhanced OCR failed:", error);
      return {
        boxes: [],
        metadata: {
          error: error.message,
          enhancements: [],
        },
      };
    }
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
      this.err(
        "Difficult region OCR failed:",

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
      this.err(
        "Enhanced OCR failed:",

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
      this.err(
        "Region identification failed:",

        error?.stack || error.toString?.()
      );
      return [];
    }
  }

  /**
   * Enhance specific region for better OCR
   */
  async enhanceRegion(imageMat, region, type) {
    try {
      // Extract region with padding
      const roi = imageMat.roi(
        new cv.Rect(region.x, region.y, region.width, region.height)
      );

      // Debug region info
      this.info("Enhancing region:", {
        type,
        dims: `${roi.rows}x${roi.cols}`,
        channels: roi.channels(),
        depth: roi.depth(),
        region,
      });

      // Scale up region
      const scale = type === "financial" ? 3.0 : 2.0;
      const scaled = new cv.Mat();
      cv.resize(roi, scaled, new cv.Size(0, 0), scale, scale, cv.INTER_CUBIC);

      // Apply region-specific enhancements
      switch (type) {
        case "financial": {
          // Convert to 8-bit if needed
          const gray = new cv.Mat();
          if (scaled.channels() > 1) {
            cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
          } else {
            scaled.copyTo(gray);
          }

          // Ensure 8-bit depth
          const gray8bit = new cv.Mat();
          gray.convertTo(gray8bit, cv.CV_8U);

          // Debug pre-filter state
          this.info("Pre-filter image state:", {
            dims: `${gray8bit.rows}x${gray8bit.cols}`,
            channels: gray8bit.channels(),
            depth: gray8bit.depth(),
          });

          // Use median blur for denoising
          const denoised = new cv.Mat();
          cv.medianBlur(gray8bit, denoised, 3);

          // Enhance contrast
          const enhanced = new cv.Mat();
          denoised.convertTo(enhanced, -1, 1.5, 10);

          // Debug post-processing
          this.info("Post-processing state:", {
            dims: `${enhanced.rows}x${enhanced.cols}`,
            channels: enhanced.channels(),
            depth: enhanced.depth(),
          });

          // Clean up
          gray.delete();
          gray8bit.delete();
          denoised.delete();

          return enhanced;
        }

        case "reference": {
          // For reference numbers, use adaptive thresholding with preprocessing
          const gray = new cv.Mat();
          if (scaled.channels() > 1) {
            cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
          } else {
            scaled.copyTo(gray);
          }

          const blurred = new cv.Mat();
          cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

          const binary = new cv.Mat();
          cv.adaptiveThreshold(
            blurred,
            binary,
            255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY,
            11,
            2
          );

          // Clean up
          gray.delete();
          blurred.delete();
          return binary;
        }

        default:
          return scaled;
      }
    } catch (error) {
      this.err("Region enhancement failed:", {
        error: error?.stack || error.toString(),
        type,
        region,
        errorCode: typeof error === "number" ? error : undefined,
      });

      // Return original region on error
      return imageMat.roi(
        new cv.Rect(region.x, region.y, region.width, region.height)
      );
    }
  }
  /**
   * Check if region needs enhanced OCR processing
   */
  needsEnhancedOCR(boxes, orientation) {
    // Count low confidence financial values
    const financialBoxes = boxes.filter((box) => {
      const { isFinancial, adjustedConfidence } = this.isFinancialValue(
        box.text,
        box.confidence
      );
      return isFinancial && adjustedConfidence < 0.8;
    });

    return (
      financialBoxes.length > 0 || // Any low confidence financial values
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

    // mean.delete();
    // stddev.delete();

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
      this.info("Starting PDF page extraction - extractPages", {
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

          this.info("Normalized image buffer - extractPages", {
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
          this.err("Failed to process page buffer - extractPages", {
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
      this.err("PDF page extraction failed", error);
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
  async applyPreprocessing(imageMat, initialQuality) {
    let processedMat = imageMat.clone();
    let lastMat = null;
    const metadata = {};

    try {
      // Convert to grayscale for initial analysis
      const gray = new cv.Mat();
      cv.cvtColor(processedMat, gray, cv.COLOR_RGBA2GRAY);

      // Detect and correct skew
      const orientation = await this.detectOrientation(gray);
      if (Math.abs(orientation.angle) > this.imageConfig.orientationThreshold) {
        lastMat = processedMat;
        processedMat = await this.rotateImage(processedMat, -orientation.angle);
        metadata.orientation = orientation;
        if (lastMat) lastMat.delete();
      }

      metadata.quality = initialQuality;

      // Apply image enhancements if needed
      if (initialQuality.needsEnhancement) {
        lastMat = processedMat;
        const enhanced = await this.enhanceImage(processedMat);
        processedMat = enhanced.image;
        metadata.enhancement = enhanced.metadata;
        if (lastMat) lastMat.delete();
      }

      // gray.delete();

      return {
        image: processedMat,
        metadata,
      };
    } catch (error) {
      if (lastMat && lastMat !== processedMat) lastMat.delete();
      if (processedMat && processedMat !== imageMat) processedMat.delete();
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
        angle = Math.ceil(angles[Math.floor(angles.length / 2)]);

        this.info("Detected angles - detectOrientation:", {
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
      this.err(
        "Orientation detection failed - detectOrientation:",

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
        analysis.brightness < 0.2 || // Much darker threshold
        analysis.brightness > 0.96 || // Only brightest images
        analysis.contrast < 0.3 || // Lower contrast threshold
        analysis.sharpness < 0 || // Only really blurry
        analysis.noise > 0.15; // Higher noise tolerance

      // Clean up
      mean.delete();
      stddev.delete();
      laplacian.delete();
      blur.delete();
      diff.delete();

      return analysis;
    } catch (error) {
      this.err(
        "Quality analysis failed - analyzeImageQuality:",

        error?.stack || error.toString()
      );
      return { ...analysis, error: true };
    }
  }

  /**
   * Enhance image based on quality analysis
   */
  async enhanceImage(imageMat, quality = null) {
    const metadata = {};
    let enhanced = imageMat.clone();

    try {
      // If no quality assessment provided, perform one
      const imageQuality =
        quality || (await this.analyzeImageQuality(enhanced));

      // Store initial quality metrics
      metadata.initialQuality = {
        brightness: imageQuality.brightness,
        contrast: imageQuality.contrast,
        sharpness: imageQuality.sharpness,
      };

      // Check if image appears inverted initially
      const isInverted = imageQuality.brightness < 0.4;
      if (isInverted) {
        this.info("Initial image appears inverted - correcting");
        const fixed = new cv.Mat();
        cv.bitwise_not(enhanced, fixed);
        enhanced.delete();
        enhanced = fixed;

        // Reassess quality after inversion
        const fixedQuality = await this.analyzeImageQuality(enhanced);
        metadata.inversionApplied = true;
        metadata.postInversionQuality = {
          brightness: fixedQuality.brightness,
          contrast: fixedQuality.contrast,
        };
      }

      // Apply conservative brightness adjustment
      const targetBrightness = 0.94;
      if (Math.abs(imageQuality.brightness - targetBrightness) > 0.2) {
        const alpha = targetBrightness / Math.max(0.1, imageQuality.brightness);
        const beta = 0;

        const adjusted = new cv.Mat();
        enhanced.convertTo(adjusted, -1, alpha, beta);
        enhanced.delete();
        enhanced = adjusted;

        metadata.brightnessAdjusted = {
          from: imageQuality.brightness,
          to: targetBrightness,
          alpha,
        };
      }

      // Apply contrast enhancement if needed
      if (imageQuality.contrast < 0.3) {
        const contrastEnhanced = new cv.Mat();

        if (enhanced.channels() === 1) {
          // For grayscale, use histogram equalization
          cv.equalizeHist(enhanced, contrastEnhanced);
        } else {
          // For color, convert to LAB, enhance L channel, convert back
          const lab = new cv.Mat();
          cv.cvtColor(enhanced, lab, cv.COLOR_BGR2Lab);

          // Split channels
          const channels = new cv.MatVector();
          cv.split(lab, channels);

          // Enhance luminance channel
          const enhancedL = new cv.Mat();
          cv.equalizeHist(channels.get(0), enhancedL);
          channels.set(0, enhancedL);

          // Merge channels
          cv.merge(channels, lab);
          cv.cvtColor(lab, contrastEnhanced, cv.COLOR_Lab2BGR);

          // Cleanup
          lab.delete();
          channels.delete();
          enhancedL.delete();
        }

        enhanced.delete();
        enhanced = contrastEnhanced;
        metadata.contrastEnhanced = true;
      }

      // Apply sharpening if needed
      if (imageQuality.sharpness < 0) {
        const kernel = cv.Mat.ones(3, 3, cv.CV_8S);
        kernel.data[4] = -8; // Center pixel

        const sharpened = new cv.Mat();
        cv.filter2D(
          enhanced,
          sharpened,
          -1,
          kernel,
          new cv.Point(-1, -1),
          0,
          cv.BORDER_DEFAULT
        );

        enhanced.delete();
        enhanced = sharpened;
        kernel.delete();

        metadata.sharpened = true;
      }

      // Final quality check
      const finalQuality = await this.analyzeImageQuality(enhanced);
      metadata.finalQuality = {
        brightness: finalQuality.brightness,
        contrast: finalQuality.contrast,
        sharpness: finalQuality.sharpness,
      };

      // Verify image isn't inverted after processing
      if (finalQuality.brightness < 0.4) {
        this.info("Image appears inverted after processing - correcting");
        const fixed = new cv.Mat();
        cv.bitwise_not(enhanced, fixed);
        enhanced.delete();
        enhanced = fixed;
        metadata.postProcessInversionApplied = true;
      }

      return {
        image: enhanced,
        metadata,
      };
    } catch (error) {
      this.err("Image enhancement failed - enhanceImage:", error);
      if (enhanced && enhanced !== imageMat) enhanced.delete();
      throw error;
    }
  }

  /**
   * Normalize OCR text boxes to common format
   */
  normalizeOCRBoxes(ocrResults, pageIndex) {
    return ocrResults.boxes.map((box) => {
      const { isFinancial, adjustedConfidence } = this.isFinancialValue(
        box.text,
        box.confidence
      );

      return {
        text: box.text.trim(),
        confidence: isFinancial ? adjustedConfidence : box.confidence,
        bounds: {
          x: box.rect ? box.rect.left : box.bbox ? box.bbox.x0 : box.left,
          y: box.rect ? box.rect.top : box.bbox ? box.bbox.y0 : box.top,
          width: box.rect
            ? box.rect.right - box.rect.left
            : box.bbox
            ? box.bbox.x1 - box.bbox.x0
            : box.right - box.left,
          height: box.rect
            ? box.rect.bottom - box.rect.top
            : box.bbox
            ? box.bbox.y1 - box.bbox.y0
            : box.bottom - box.top,
        },
        page: pageIndex,
        source: "ocr",
        type: isFinancial ? "financial" : "text",
        metadata: {
          baseline: box.baseline,
          orientation: box.orientation,
        },
      };
    });
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
      this.err("Mat conversion failed - imageToMat", error);
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
      const gray = new cv.Mat();
      if (imageMat.channels() === 1) {
        imageMat.copyTo(gray);
      } else {
        cv.cvtColor(imageMat, gray, cv.COLOR_RGBA2GRAY);
      }

      // Convert to binary image
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

      // Save debug image
      await this.saveDebugImage(binary, `page_${pageIndex + 1}_binary.png`);

      // Find contours
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        binary.clone(),
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
        const area = cv.contourArea(contour);
        const perimeter = cv.arcLength(contour, true);

        if (area < 100 || area > imageMat.rows * imageMat.cols * 0.1) {
          results.metadata.rejectedCandidates++;
          continue;
        }

        const complexity = (perimeter * perimeter) / area;
        const hull = new cv.Mat();
        cv.convexHull(contour, hull);
        const hullArea = cv.contourArea(hull);
        const solidity = area / hullArea;

        const rect = cv.boundingRect(contour);
        const aspectRatio = rect.width / rect.height;

        const isSignatureCandidate =
          complexity > 50 &&
          solidity > 0.2 &&
          solidity < 0.9 &&
          aspectRatio > 0.2 &&
          aspectRatio < 5.0;

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

      this.info("Signature detection completed", {
        found: results.marks.length,
        ...results.metadata,
      });

      return results;
    } catch (error) {
      this.err(
        "Signature detection failed:",

        error?.stack || error.toString()
      );
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

  isFinancialValue(text, confidence) {
    // Match currency patterns
    const currencyPattern = /^R?\s*\d{1,3}(,\d{3})*(\.\d{2})?$/;
    const numberPattern = /^[\d,\.]+$/;

    // Boost confidence for well-structured financial values
    if (currencyPattern.test(text)) {
      return {
        isFinancial: true,
        adjustedConfidence: confidence * 1.2, // Boost confidence
      };
    }

    // Handle split currency values
    if (numberPattern.test(text) && text.length >= 4) {
      return {
        isFinancial: true,
        adjustedConfidence: confidence * 0.9, // Slightly reduce confidence for incomplete format
      };
    }

    return {
      isFinancial: false,
      adjustedConfidence: confidence,
    };
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
    this.info("rotateImage", angle);
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

      this.info("Image rotation:", {
        originalSize: `${mat.cols}x${mat.rows}`,
        newSize: `${newWidth}x${newHeight}`,
        angle: angle,
        center: `${center.x},${center.y}`,
      });

      // Clean up
      // rotMat.delete();

      return rotated;
    } catch (error) {
      this.err("Image rotation failed:", error);
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
        // rgba.delete();
      }

      return buffer;
    } catch (error) {
      this.err(
        "Mat to buffer conversion failed:",

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
