import cv from '@techstark/opencv-js';

class LayoutDetector {
  constructor() {
    this.regions = {
      financial: {
        markers: [
          'PERSONAL LOAN - PRE-AGREEMENT STATEMENT AND QUOTATION SUMMARY',
          'MONTHLY RESPONSIBILITIES',
          'Payout amount',
          'Credit advanced'
        ],
        expectedLocation: 'upper',
        heightRatio: 0.3  // Usually in top third of first page
      },
      signatures: {
        markers: [
          'Client Signature',
          'CSignatureTag',
          'IMPORTANT CONFIRMATION'
        ],
        expectedLocation: 'lower',
        heightRatio: 0.2  // Usually in bottom fifth of page
      },
      initials: {
        markers: [
          'Client initial',
          'CInitialTag',
          'Witness initial'
        ],
        expectedLocation: 'margin',
        widthRatio: 0.15  // Usually in right margin
      }
    };

    this.thresholds = {
      textDensity: 0.3,
      lineSpacing: 20,
      marginWidth: 100
    };
  }

  /**
   * Detect document layout regions from either text boxes or image
   */
  async detectLayout(page, options = {}) {
    const layout = {
      regions: {},
      confidence: {},
      metadata: {}
    };

    try {
      // Try text-based detection first
      if (page.textBoxes && page.textBoxes.length > 0) {
        const textLayout = await this.detectFromTextBoxes(page.textBoxes, options);
        Object.assign(layout.regions, textLayout.regions);
        Object.assign(layout.confidence, textLayout.confidence);
        layout.metadata.source = 'text';
      }

      // Fall back or complement with image-based detection
      if (page.image || !layout.regions.financial) {
        const imageLayout = await this.detectFromImage(page.image || page, options);
        
        // Merge results, preferring higher confidence detections
        for (const [region, bounds] of Object.entries(imageLayout.regions)) {
          if (!layout.regions[region] || 
              imageLayout.confidence[region] > layout.confidence[region]) {
            layout.regions[region] = bounds;
            layout.confidence[region] = imageLayout.confidence[region];
          }
        }
        layout.metadata.source = layout.metadata.source ? 'hybrid' : 'image';
      }

      // Add analysis metadata
      layout.metadata.analysis = await this.analyzeLayoutQuality(layout);
      
      return layout;
    } catch (error) {
      console.error('Layout detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect layout from text boxes (digital PDFs)
   */
  async detectFromTextBoxes(textBoxes, options) {
    const layout = {
      regions: {},
      confidence: {}
    };

    try {
      // Group text boxes by proximity and analyze sections
      const sections = this.groupTextBoxes(textBoxes);
      
      // Detect each region type
      for (const [regionType, config] of Object.entries(this.regions)) {
        const detection = await this.detectRegionFromText(
          sections,
          config,
          options
        );
        
        if (detection.confidence > 0.6) {
          layout.regions[regionType] = detection.bounds;
          layout.confidence[regionType] = detection.confidence;
        }
      }

      return layout;
    } catch (error) {
      console.error('Text-based layout detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect layout from image (scanned or rendered PDFs)
   */
  async detectFromImage(image, options) {
    const layout = {
      regions: {},
      confidence: {}
    };

    try {
      // Convert to OpenCV format
      const mat = await this.imageToMat(image);
      const gray = new cv.Mat();
      cv.cvtColor(mat, gray, cv.COLOR_BGR2GRAY);

      // Detect form structure
      const structure = await this.detectFormStructure(gray);
      
      // Analyze each region type
      for (const [regionType, config] of Object.entries(this.regions)) {
        const detection = await this.detectRegionFromImage(
          gray,
          structure,
          config,
          options
        );
        
        if (detection.confidence > 0.6) {
          layout.regions[regionType] = detection.bounds;
          layout.confidence[regionType] = detection.confidence;
        }
      }

      // Clean up
      mat.delete();
      gray.delete();

      return layout;
    } catch (error) {
      console.error('Image-based layout detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect form structure using image processing
   */
  async detectFormStructure(gray) {
    const structure = {
      lines: [],
      regions: [],
      text: []
    };

    try {
      // Edge detection
      const edges = new cv.Mat();
      cv.Canny(gray, edges, 50, 150, 3);

      // Line detection
      const lines = new cv.Mat();
      cv.HoughLinesP(edges, lines, 1, Math.PI/180, 50, 50, 10);

      // Extract line segments
      for (let i = 0; i < lines.rows; i++) {
        const [x1, y1, x2, y2] = lines.data32S.slice(i * 4);
        structure.lines.push({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          length: Math.sqrt(Math.pow(x2-x1, 2) + Math.pow(y2-y1, 2))
        });
      }

      // Detect text regions
      const regions = new cv.Mat();
      cv.adaptiveThreshold(gray, regions, 255, 
        cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(regions, contours, hierarchy, 
        cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Analyze potential text regions
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const rect = cv.boundingRect(contour);

        // Filter by size and aspect ratio
        if (area > 100 && rect.width/rect.height < 20) {
          structure.regions.push({
            bounds: rect,
            area: area,
            density: this.calculateDensity(regions, rect)
          });
        }
      }

      // Clean up
      edges.delete();
      lines.delete();
      regions.delete();
      contours.delete();
      hierarchy.delete();

      return structure;
    } catch (error) {
      console.error('Form structure detection failed:', error);
      throw error;
    }
  }

  /**
   * Calculate pixel density in region
   */
  calculateDensity(image, rect) {
    const roi = image.roi(rect);
    const pixelCount = cv.countNonZero(roi);
    roi.delete();
    return pixelCount / (rect.width * rect.height);
  }

  /**
   * Detect region from text boxes
   */
  async detectRegionFromText(sections, config, options) {
    const matches = [];

    // Find sections containing marker text
    for (const section of sections) {
      const text = section.boxes.map(box => box.text).join(' ');
      const markerMatches = config.markers.filter(marker => 
        text.includes(marker)
      );

      if (markerMatches.length > 0) {
        matches.push({
          section,
          matches: markerMatches,
          score: markerMatches.length / config.markers.length
        });
      }
    }

    // Find best matching region
    const bestMatch = matches.sort((a, b) => b.score - a.score)[0];
    
    if (bestMatch) {
      // Expand region based on configuration
      const bounds = this.expandRegion(
        bestMatch.section.bounds,
        config,
        options
      );

      return {
        bounds,
        confidence: bestMatch.score
      };
    }

    return {
      bounds: null,
      confidence: 0
    };
  }

  /**
   * Detect region from image analysis
   */
  async detectRegionFromImage(gray, structure, config, options) {
    const { expectedLocation, heightRatio, widthRatio } = config;
    let bounds = null;
    let confidence = 0;

    try {
      // Find candidate regions based on location and size
      const candidates = structure.regions.filter(region => {
        const { bounds: rect } = region;
        
        // Check location
        switch (expectedLocation) {
          case 'upper':
            return rect.y < gray.rows * heightRatio;
          case 'lower':
            return rect.y > gray.rows * (1 - heightRatio);
          case 'margin':
            return rect.x > gray.cols * (1 - widthRatio);
          default:
            return true;
        }
      });

      // Score candidates
      const scoredCandidates = candidates.map(candidate => {
        const score = this.scoreRegionCandidate(
          candidate,
          structure,
          config
        );
        return { ...candidate, score };
      });

      // Select best candidate
      const bestCandidate = scoredCandidates.sort(
        (a, b) => b.score - a.score
      )[0];

      if (bestCandidate && bestCandidate.score > 0.6) {
        bounds = this.expandRegion(
          bestCandidate.bounds,
          config,
          options
        );
        confidence = bestCandidate.score;
      }

      return { bounds, confidence };
    } catch (error) {
      console.error('Image region detection failed:', error);
      throw error;
    }
  }

  /**
   * Score region candidate based on characteristics
   */
  scoreRegionCandidate(candidate, structure, config) {
    const { bounds, density } = candidate;
    let score = 0;

    // Score based on text density
    if (density > this.thresholds.textDensity) {
      score += 0.4;
    }

    // Score based on line presence
    const regionLines = structure.lines.filter(line => 
      this.lineIntersectsRegion(line, bounds)
    );
    if (regionLines.length > 0) {
      score += 0.3;
    }

    // Score based on location
    const locationScore = this.scoreLocation(
      bounds,
      config.expectedLocation
    );
    score += locationScore * 0.3;

    return score;
  }

  /**
   * Expand detected region based on configuration
   */
  expandRegion(bounds, config, options) {
    const { padding = 20 } = options;
    
    return {
      x: Math.max(0, bounds.x - padding),
      y: Math.max(0, bounds.y - padding),
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2
    };
  }

  /**
   * Analyze quality and reliability of layout detection
   */
  async analyzeLayoutQuality(layout) {
    const analysis = {
      completeness: 0,
      reliability: 0,
      issues: []
    };

    // Check region coverage
    const expectedRegions = Object.keys(this.regions);
    const foundRegions = Object.keys(layout.regions);
    analysis.completeness = foundRegions.length / expectedRegions.length;

    // Calculate average confidence
    analysis.reliability = Object.values(layout.confidence)
      .reduce((sum, conf) => sum + conf, 0) / foundRegions.length;

    // Identify potential issues
    if (analysis.completeness < 1) {
      analysis.issues.push('Missing regions: ' + 
        expectedRegions.filter(r => !foundRegions.includes(r)).join(', '));
    }

    if (analysis.reliability < 0.8) {
      analysis.issues.push('Low confidence detection');
    }

    return analysis;
  }
}

export default LayoutDetector;
