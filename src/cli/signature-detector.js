import cv from '@techstark/opencv-js';
import sharp from 'sharp';

/**
 * Advanced Signature Detection using OpenCV.js
 * Detects ANY visual mark in signature/initial areas using edge detection and texture analysis
 */
export default class SignatureDetector {
  constructor() {
    this.isOpenCVReady = false;
    this.debugMode = true;
  }

  /**
   * Initialize OpenCV - ensure it's loaded before use
   */
  async initialize() {
    if (typeof cv === 'undefined') {
      throw new Error('OpenCV.js not loaded. Please ensure @techstark/opencv-js is imported.');
    }

    // Wait for OpenCV to be ready
    if (!cv.Mat) {
      await new Promise(resolve => {
        cv.onRuntimeInitialized = resolve;
      });
    }

    this.isOpenCVReady = true;
    console.log('🎯 SignatureDetector initialized with OpenCV.js');
  }

  /**
   * Detect signature marks in specified zones
   */
  async detectSignatureMarks(imageBuffer, signatureZones, scaleFactor = 1) {
    if (!this.isOpenCVReady) {
      await this.initialize();
    }

    const results = [];
    
    for (const zone of signatureZones) {
      try {
        console.log(`🔍 Analyzing signature zone: ${zone.name}`);
        
        // Extract signature region with expanded bounds for positioning tolerance
        const roiBuffer = await this.extractSignatureRegion(imageBuffer, zone, scaleFactor);
        
        // Save debug image
        if (this.debugMode) {
          const debugPath = `debug_signature_${zone.name}_roi.png`;
          await sharp(roiBuffer).png().toFile(debugPath);
          console.log(`💾 Debug ROI saved: ${debugPath}`);
        }
        
        // Convert to OpenCV Mat
        const mat = await this.bufferToMat(roiBuffer);
        
        // Basic edge detection analysis
        const edgeAnalysis = this.analyzeEdgeContent(mat);
        
        // Simple texture analysis using Laplacian
        const textureAnalysis = this.analyzeBasicTexture(mat);
        
        // Combine methods for confidence
        const confidence = this.combineAnalysis(edgeAnalysis, textureAnalysis);
        
        results.push({
          field: zone.name,
          hasVisualMark: confidence > 0.15, // Low threshold for ANY mark
          confidence: Math.round(confidence * 100) / 100,
          edgeAnalysis,
          textureAnalysis,
          zone: zone.bounds
        });
        
        // Cleanup
        mat.delete();
        
      } catch (error) {
        console.error(`❌ Signature detection failed for ${zone.name}:`, error);
        results.push({
          field: zone.name,
          hasVisualMark: false,
          confidence: 0,
          error: error.message,
          zone: zone.bounds
        });
      }
    }
    
    return results;
  }

  /**
   * Extract signature region from image with expanded bounds for positioning tolerance
   */
  async extractSignatureRegion(imageBuffer, zone, scaleFactor = 1) {
    // Apply scale factor to coordinates (PDF coordinates → image coordinates)
    const scaledBounds = {
      x: Math.round(zone.bounds.x * scaleFactor),
      y: Math.round(zone.bounds.y * scaleFactor),
      width: Math.round(zone.bounds.width * scaleFactor),
      height: Math.round(zone.bounds.height * scaleFactor)
    };
    
    // Add padding to handle signatures slightly outside bounds
    const padding = Math.round(20 * scaleFactor);
    const expandedBounds = {
      left: Math.max(0, scaledBounds.x - padding),
      top: Math.max(0, scaledBounds.y - padding),
      width: scaledBounds.width + (padding * 2),
      height: scaledBounds.height + (padding * 2)
    };
    
    console.log(`📏 Scale factor: ${scaleFactor}`);
    console.log(`📐 Original bounds: (${zone.bounds.x}, ${zone.bounds.y}) ${zone.bounds.width}x${zone.bounds.height}`);
    console.log(`📐 Scaled bounds: (${scaledBounds.x}, ${scaledBounds.y}) ${scaledBounds.width}x${scaledBounds.height}`);
    
    try {
      const roiBuffer = await sharp(imageBuffer)
        .extract(expandedBounds)
        .toBuffer();
      
      console.log(`📏 Extracted ${zone.name} region: ${expandedBounds.width}x${expandedBounds.height} at (${expandedBounds.left}, ${expandedBounds.top})`);
      return roiBuffer;
      
    } catch (error) {
      // Fallback to scaled bounds if expanded bounds fail
      console.warn(`⚠️  Expanded bounds failed for ${zone.name}, using scaled bounds`);
      const originalBounds = {
        left: scaledBounds.x,
        top: scaledBounds.y,
        width: scaledBounds.width,
        height: scaledBounds.height
      };
      return await sharp(imageBuffer)
        .extract(originalBounds)
        .toBuffer();
    }
  }

  /**
   * Convert image buffer to OpenCV Mat
   */
  async bufferToMat(buffer) {
    // Use Sharp to get image info and convert to raw pixel data
    const image = sharp(buffer);
    const { width, height, channels } = await image.metadata();
    
    // Get raw pixel data
    const rawData = await image.raw().toBuffer();
    
    // Create OpenCV Mat from raw data
    const mat = new cv.Mat(height, width, cv.CV_8UC3);
    mat.data.set(rawData);
    
    return mat;
  }

  /**
   * Analyze edge content using multi-scale edge detection
   */
  analyzeEdgeContent(mat) {
    // Convert to grayscale
    const gray = new cv.Mat();
    if (mat.channels() === 3) {
      cv.cvtColor(mat, gray, cv.COLOR_BGR2GRAY);
    } else {
      mat.copyTo(gray);
    }
    
    const totalPixels = gray.rows * gray.cols;
    
    // Multi-scale edge detection for different signature types
    
    // 1. Fine edges (digital text, small signatures)
    const fineEdges = new cv.Mat();
    cv.Canny(gray, fineEdges, 20, 60, 3);
    const fineEdgePixels = cv.countNonZero(fineEdges);
    const fineEdgeDensity = fineEdgePixels / totalPixels;
    
    // 2. Medium edges (normal signatures)
    const mediumEdges = new cv.Mat();
    cv.Canny(gray, mediumEdges, 50, 120, 3);
    const mediumEdgePixels = cv.countNonZero(mediumEdges);
    const mediumEdgeDensity = mediumEdgePixels / totalPixels;
    
    // 3. Coarse edges (stamps, thick marks)
    const coarseEdges = new cv.Mat();
    cv.Canny(gray, coarseEdges, 80, 160, 3);
    const coarseEdgePixels = cv.countNonZero(coarseEdges);
    const coarseEdgeDensity = coarseEdgePixels / totalPixels;
    
    // Calculate edge-based confidence
    // Weight fine edges higher to catch small marks
    const edgeConfidence = Math.min(
      (fineEdgeDensity * 25) +      // High weight for fine edges (digital signatures)
      (mediumEdgeDensity * 15) +    // Medium weight for normal signatures
      (coarseEdgeDensity * 10),     // Lower weight for thick marks
      1.0
    );
    
    // Cleanup
    gray.delete();
    fineEdges.delete();
    mediumEdges.delete();
    coarseEdges.delete();
    
    return {
      fineEdgeDensity: Math.round(fineEdgeDensity * 10000) / 10000,
      mediumEdgeDensity: Math.round(mediumEdgeDensity * 10000) / 10000,
      coarseEdgeDensity: Math.round(coarseEdgeDensity * 10000) / 10000,
      totalEdgePixels: fineEdgePixels + mediumEdgePixels + coarseEdgePixels,
      hasSignificantEdges: edgeConfidence > 0.05,
      confidence: Math.round(edgeConfidence * 1000) / 1000
    };
  }

  /**
   * Basic texture analysis using Laplacian variance
   */
  analyzeBasicTexture(mat) {
    const gray = new cv.Mat();
    if (mat.channels() === 3) {
      cv.cvtColor(mat, gray, cv.COLOR_BGR2GRAY);
    } else {
      mat.copyTo(gray);
    }
    
    // Laplacian for texture detection
    const laplacian = new cv.Mat();
    cv.Laplacian(gray, laplacian, cv.CV_64F, 1);
    
    // Calculate variance of Laplacian (measure of texture)
    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    cv.meanStdDev(laplacian, mean, stddev);
    const laplacianVariance = stddev.data64F[0] * stddev.data64F[0];
    
    // Convert to confidence score
    const textureConfidence = Math.min(laplacianVariance / 2000, 1.0);
    
    // Cleanup
    gray.delete();
    laplacian.delete();
    mean.delete();
    stddev.delete();
    
    return {
      laplacianVariance: Math.round(laplacianVariance * 100) / 100,
      hasTextureContent: textureConfidence > 0.1,
      confidence: Math.round(textureConfidence * 1000) / 1000
    };
  }

  /**
   * Combine edge and texture analysis for final confidence
   */
  combineAnalysis(edgeAnalysis, textureAnalysis) {
    // Weight edge detection higher as primary method
    const weights = {
      edge: 0.7,
      texture: 0.3
    };
    
    const combinedScore = 
      (edgeAnalysis.confidence * weights.edge) +
      (textureAnalysis.confidence * weights.texture);
    
    // Bonus if both methods detect content
    const agreementBonus = 
      (edgeAnalysis.hasSignificantEdges && textureAnalysis.hasTextureContent) ? 0.1 : 0;
    
    return Math.min(combinedScore + agreementBonus, 1.0);
  }

  /**
   * Define signature zones for testing
   */
  getTestSignatureZones() {
    return [
      {
        name: 'clientSignature',
        bounds: { x: 100, y: 2800, width: 400, height: 100 },
        type: 'signature',
        required: true
      },
      {
        name: 'clientInitial',
        bounds: { x: 500, y: 1500, width: 100, height: 50 },
        type: 'initial', 
        required: true
      },
      {
        name: 'witnessSignature',
        bounds: { x: 100, y: 2900, width: 400, height: 100 },
        type: 'signature',
        required: false
      }
    ];
  }
}