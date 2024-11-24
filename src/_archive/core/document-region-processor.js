import cv from '@techstark/opencv-js';
import sharp from 'sharp';

class DocumentRegionProcessor {
  constructor() {
    this.processingProfiles = {
      financial: {
        scaling: 2.0,           // Upscale factor for OCR
        denoise: true,          // Apply denoising
        contrastStretch: true,  // Enhance contrast
        morphology: true        // Clean up characters
      },
      signature: {
        binarization: true,     // Convert to binary
        removeLines: true,      // Remove form lines
        boxDetection: true      // Detect bounding boxes
      },
      text: {
        dewarping: true,        // Fix page skew
        sharpening: true,       // Enhance edges
        binarization: false     // Keep grayscale
      }
    };
  }

  /**
   * Process identified regions with appropriate enhancements
   */
  async processRegions(image, layout) {
    const results = {
      regions: {},
      metadata: {}
    };

    try {
      // Convert image to OpenCV format
      const mat = await this.imageToMat(image);
      
      // Process each detected region
      for (const [regionType, bounds] of Object.entries(layout.regions)) {
        const profile = this.processingProfiles[regionType] || this.processingProfiles.text;
        
        // Extract and enhance region
        const enhancedRegion = await this.enhanceRegion(mat, bounds, profile);
        
        results.regions[regionType] = {
          image: enhancedRegion.image,
          bounds: bounds,
          metadata: enhancedRegion.metadata
        };
      }

      // Clean up
      mat.delete();

      return results;
    } catch (error) {
      console.error('Region processing failed:', error);
      throw error;
    }
  }

  /**
   * Enhance specific region based on profile
   */
  async enhanceRegion(mat, bounds, profile) {
    try {
      // Extract region
      const roi = mat.roi(new cv.Rect(
        bounds.x, bounds.y, bounds.width, bounds.height
      ));

      // Create processing pipeline based on profile
      const pipeline = [];

      // Basic preprocessing
      if (profile.dewarping) {
        pipeline.push(async (img) => this.dewarpImage(img));
      }

      // Scaling
      if (profile.scaling && profile.scaling !== 1.0) {
        pipeline.push(async (img) => {
          const scaled = new cv.Mat();
          cv.resize(img, scaled, new cv.Size(0, 0), 
            profile.scaling, profile.scaling, cv.INTER_CUBIC);
          return scaled;
        });
      }

      // Enhancement steps
      if (profile.denoise) {
        pipeline.push(async (img) => {
          const denoised = new cv.Mat();
          cv.fastNlMeansDenoising(img, denoised);
          return denoised;
        });
      }

      if (profile.contrastStretch) {
        pipeline.push(async (img) => this.enhanceContrast(img));
      }

      if (profile.sharpening) {
        pipeline.push(async (img) => this.sharpenImage(img));
      }

      if (profile.binarization) {
        pipeline.push(async (img) => {
          const binary = new cv.Mat();
          cv.adaptiveThreshold(img, binary, 255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY,
            11, 2);
          return binary;
        });
      }

      if (profile.morphology) {
        pipeline.push(async (img) => this.cleanupMorphology(img));
      }

      // Apply pipeline
      let processedImage = roi;
      const metadata = {
        steps: [],
        quality: {}
      };

      for (const step of pipeline) {
        const result = await step(processedImage);
        if (processedImage !== roi) {
          processedImage.delete();
        }
        processedImage = result;
        metadata.steps.push(step.name);
      }

      // Analyze final quality
      metadata.quality = await this.analyzeImageQuality(processedImage);

      return {
        image: processedImage,
        metadata
      };
    } catch (error) {
      console.error('Region enhancement failed:', error);
      throw error;
    }
  }

  /**
   * Dewarp and correct skew
   */
  async dewarpImage(mat) {
    try {
      // Detect lines for skew correction
      const edges = new cv.Mat();
      cv.Canny(mat, edges, 50, 150, 3);

      const lines = new cv.Mat();
      cv.HoughLines(edges, lines, 1, Math.PI / 180, 100);

      // Calculate skew angle
      let angle = 0;
      if (lines.rows > 0) {
        const angles = [];
        for (let i = 0; i < lines.rows; i++) {
          angles.push(lines.data32F[i * 2 + 1] * 180 / Math.PI);
        }
        angle = this.getMedianAngle(angles);
      }

      // Rotate if necessary
      if (Math.abs(angle) > 0.5) {
        const center = new cv.Point(mat.cols / 2, mat.rows / 2);
        const rotMatrix = cv.getRotationMatrix2D(center, angle, 1.0);
        const rotated = new cv.Mat();
        cv.warpAffine(mat, rotated, rotMatrix, mat.size());
        
        edges.delete();
        lines.delete();
        rotMatrix.delete();
        
        return rotated;
      }

      edges.delete();
      lines.delete();
      return mat;
    } catch (error) {
      console.error('Dewarping failed:', error);
      throw error;
    }
  }

  /**
   * Enhance contrast using adaptive methods
   */
  async enhanceContrast(mat) {
    try {
      const enhanced = new cv.Mat();
      
      // Calculate histogram
      const hist = new cv.Mat();
      const channels = [0];
      const histSize = [256];
      const ranges = [0, 256];
      cv.calcHist([mat], channels, new cv.Mat(), hist, histSize, ranges);

      // Find significant bounds
      const total = mat.rows * mat.cols;
      let lower = 0, upper = 255;
      let sum = 0;
      
      // Find lower bound (1%)
      for (let i = 0; i < 256; i++) {
        sum += hist.data32F[i];
        if (sum / total > 0.01) {
          lower = i;
          break;
        }
      }

      // Find upper bound (99%)
      sum = 0;
      for (let i = 255; i >= 0; i--) {
        sum += hist.data32F[i];
        if (sum / total > 0.01) {
          upper = i;
          break;
        }
      }

      // Apply contrast stretching
      const alpha = 255 / (upper - lower);
      mat.convertTo(enhanced, -1, alpha, -lower * alpha);

      hist.delete();
      return enhanced;
    } catch (error) {
      console.error('Contrast enhancement failed:', error);
      throw error;
    }
  }

  /**
   * Sharpen image for better OCR
   */
  async sharpenImage(mat) {
    try {
      const sharpened = new cv.Mat();
      const kernel = cv.Mat.ones(3, 3, cv.CV_8S);
      kernel.data[4] = -8;  // Center pixel
      cv.filter2D(mat, sharpened, -1, kernel);
      kernel.delete();
      return sharpened;
    } catch (error) {
      console.error('Sharpening failed:', error);
      throw error;
    }
  }

  /**
   * Clean up text using morphological operations
   */
  async cleanupMorphology(mat) {
    try {
      const cleaned = new cv.Mat();
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
      
      // Close small gaps
      cv.morphologyEx(mat, cleaned, cv.MORPH_CLOSE, kernel);
      
      // Optional: Remove small noise
      const opened = new cv.Mat();
      cv.morphologyEx(cleaned, opened, cv.MORPH_OPEN, kernel);
      
      kernel.delete();
      cleaned.delete();
      return opened;
    } catch (error) {
      console.error('Morphological cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Analyze quality metrics of processed image
   */
  async analyzeImageQuality(mat) {
    const metrics = {
      contrast: 0,
      sharpness: 0,
      noise: 0
    };

    try {
      // Calculate contrast
      const mean = new cv.Mat();
      const stddev = new cv.Mat();
      cv.meanStdDev(mat, mean, stddev);
      metrics.contrast = stddev.data64F[0] / mean.data64F[0];

      // Estimate sharpness using Laplacian
      const laplacian = new cv.Mat();
      cv.Laplacian(mat, laplacian, cv.CV_64F);
      metrics.sharpness = cv.mean(laplacian)[0];

      // Estimate noise using local variance
      const blur = new cv.Mat();
      cv.GaussianBlur(mat, blur, new cv.Size(5, 5), 0);
      const diff = new cv.Mat();
      cv.absdiff(mat, blur, diff);
      metrics.noise = cv.mean(diff)[0];

      mean.delete();
      stddev.delete();
      laplacian.delete();
      blur.delete();
      diff.delete();

      return metrics;
    } catch (error) {
      console.error('Quality analysis failed:', error);
      throw error;
    }
  }
}

export default DocumentRegionProcessor;
