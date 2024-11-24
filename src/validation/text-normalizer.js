import cv from '@techstark/opencv-js';
import { distance } from 'fast-fuzzy';

class TextBoxNormalizer {
  constructor() {
    this.config = {
      // Spatial grouping thresholds
      grouping: {
        maxVerticalGap: 5,    // px between characters in same line
        maxHorizontalGap: 20, // px between words
        lineHeight: 12,       // baseline px height for text
        lineSpacing: 5        // px between lines
      },
      
      // Box merge criteria
      merging: {
        minOverlap: 0.3,     // % overlap to merge boxes
        maxSpacing: 10,      // px between mergeable boxes
        minCharWidth: 5      // minimum width for char box
      },
      
      // Layout analysis
      layout: {
        columnThreshold: 50,  // px gap to detect columns
        sectionGap: 30,      // px gap between sections
        marginSize: 40       // px size of margins
      }
    };
  }

  /**
   * Normalize and group text boxes from different sources
   */
  async normalizeTextBoxes(boxes, pageSize, source = 'pdf') {
    // Convert boxes to standard format
    const normalizedBoxes = this.standardizeBoxes(boxes, source);
    
    // Group characters into words
    const wordGroups = await this.groupCharacters(normalizedBoxes);
    
    // Merge overlapping boxes
    const mergedBoxes = this.mergeOverlapping(wordGroups);
    
    // Detect layout structure
    const layout = this.analyzeLayout(mergedBoxes, pageSize);
    
    // Group boxes into logical sections
    const sections = this.groupIntoSections(mergedBoxes, layout);
    
    return {
      boxes: mergedBoxes,
      layout,
      sections
    };
  }

  /**
   * Standardize box format from different sources
   */
  standardizeBoxes(boxes, source) {
    switch(source) {
      case 'pdf':
        return boxes.map(box => ({
          text: box.text,
          bounds: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          },
          confidence: 1.0,
          source: 'pdf'
        }));
        
      case 'ocr':
        return boxes.map(box => ({
          text: box.text,
          bounds: {
            x: box.bbox.x0,
            y: box.bbox.y0,
            width: box.bbox.x1 - box.bbox.x0,
            height: box.bbox.y1 - box.bbox.y0
          },
          confidence: box.confidence,
          source: 'ocr'
        }));
        
      default:
        throw new Error(`Unknown source type: ${source}`);
    }
  }

  /**
   * Group individual characters into words based on spacing
   */
  async groupCharacters(boxes) {
    const { maxHorizontalGap, maxVerticalGap } = this.config.grouping;
    const groups = [];
    let currentGroup = [];
    
    // Sort boxes by position
    const sortedBoxes = [...boxes].sort((a, b) => {
      const yDiff = Math.abs(a.bounds.y - b.bounds.y);
      if (yDiff <= maxVerticalGap) {
        return a.bounds.x - b.bounds.x;
      }
      return a.bounds.y - b.bounds.y;
    });

    // Group characters
    for (const box of sortedBoxes) {
      if (currentGroup.length === 0) {
        currentGroup.push(box);
        continue;
      }

      const lastBox = currentGroup[currentGroup.length - 1];
      const horizontalGap = box.bounds.x - (lastBox.bounds.x + lastBox.bounds.width);
      const verticalGap = Math.abs(box.bounds.y - lastBox.bounds.y);

      if (horizontalGap <= maxHorizontalGap && verticalGap <= maxVerticalGap) {
        currentGroup.push(box);
      } else {
        if (currentGroup.length > 0) {
          groups.push(this.mergeGroup(currentGroup));
        }
        currentGroup = [box];
      }
    }

    // Add final group
    if (currentGroup.length > 0) {
      groups.push(this.mergeGroup(currentGroup));
    }

    return groups;
  }

  /**
   * Merge a group of character boxes into a word box
   */
  mergeGroup(group) {
    if (group.length === 0) return null;
    if (group.length === 1) return group[0];

    const text = group.map(box => box.text).join('');
    const minX = Math.min(...group.map(box => box.bounds.x));
    const minY = Math.min(...group.map(box => box.bounds.y));
    const maxX = Math.max(...group.map(box => box.bounds.x + box.bounds.width));
    const maxY = Math.max(...group.map(box => box.bounds.y + box.bounds.height));
    
    // Average confidence for OCR results
    const confidence = group.reduce((sum, box) => sum + (box.confidence || 1), 0) / group.length;

    return {
      text,
      bounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      },
      confidence,
      source: group[0].source,
      merged: true,
      components: group
    };
  }

  /**
   * Merge overlapping or nearly overlapping boxes
   */
  mergeOverlapping(boxes) {
    const { minOverlap, maxSpacing } = this.config.merging;
    const merged = [...boxes];
    let madeChanges;

    do {
      madeChanges = false;
      
      for (let i = 0; i < merged.length; i++) {
        for (let j = i + 1; j < merged.length; j++) {
          const box1 = merged[i];
          const box2 = merged[j];
          
          if (!box1 || !box2) continue;

          const overlap = this.calculateOverlap(box1.bounds, box2.bounds);
          const spacing = this.calculateSpacing(box1.bounds, box2.bounds);

          if (overlap >= minOverlap || spacing <= maxSpacing) {
            merged[i] = this.mergeBoxes(box1, box2);
            merged[j] = null;
            madeChanges = true;
          }
        }
      }

      // Remove nulls
      if (madeChanges) {
        for (let i = merged.length - 1; i >= 0; i--) {
          if (!merged[i]) merged.splice(i, 1);
        }
      }

    } while (madeChanges);

    return merged;
  }

  /**
   * Calculate overlap percentage between two boxes
   */
  calculateOverlap(bounds1, bounds2) {
    const xOverlap = Math.max(0, Math.min(
      bounds1.x + bounds1.width,
      bounds2.x + bounds2.width
    ) - Math.max(bounds1.x, bounds2.x));

    const yOverlap = Math.max(0, Math.min(
      bounds1.y + bounds1.height,
      bounds2.y + bounds2.height
    ) - Math.max(bounds1.y, bounds2.y));

    const overlapArea = xOverlap * yOverlap;
    const area1 = bounds1.width * bounds1.height;
    const area2 = bounds2.width * bounds2.height;

    return overlapArea / Math.min(area1, area2);
  }

  /**
   * Calculate minimum spacing between two boxes
   */
  calculateSpacing(bounds1, bounds2) {
    const xSpacing = Math.max(
      bounds1.x - (bounds2.x + bounds2.width),
      bounds2.x - (bounds1.x + bounds1.width)
    );

    const ySpacing = Math.max(
      bounds1.y - (bounds2.y + bounds2.height),
      bounds2.y - (bounds1.y + bounds1.height)
    );

    return Math.max(0, Math.min(xSpacing, ySpacing));
  }

  /**
   * Merge two text boxes
   */
  mergeBoxes(box1, box2) {
    const bounds1 = box1.bounds;
    const bounds2 = box2.bounds;

    // Determine if horizontal or vertical merge
    const isHorizontal = Math.abs(bounds1.y - bounds2.y) < this.config.grouping.maxVerticalGap;

    const text = isHorizontal 
      ? (bounds1.x < bounds2.x ? `${box1.text} ${box2.text}` : `${box2.text} ${box1.text}`)
      : (bounds1.y < bounds2.y ? `${box1.text}\n${box2.text}` : `${box2.text}\n${box1.text}`);

    const minX = Math.min(bounds1.x, bounds2.x);
    const minY = Math.min(bounds1.y, bounds2.y);
    const maxX = Math.max(bounds1.x + bounds1.width, bounds2.x + bounds2.width);
    const maxY = Math.max(bounds1.y + bounds1.height, bounds2.y + bounds2.height);

    return {
      text: text.trim(),
      bounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      },
      confidence: Math.min(box1.confidence || 1, box2.confidence || 1),
      source: box1.source,
      merged: true,
      components: [
        ...(box1.components || [box1]),
        ...(box2.components || [box2])
      ]
    };
  }

  /**
   * Analyze document layout structure
   */
  analyzeLayout(boxes, pageSize) {
    const { columnThreshold, marginSize } = this.config.layout;
    
    // Find text boundaries
    const bounds = {
      left: Math.min(...boxes.map(b => b.bounds.x)),
      right: Math.max(...boxes.map(b => b.bounds.x + b.bounds.width)),
      top: Math.min(...boxes.map(b => b.bounds.y)),
      bottom: Math.max(...boxes.map(b => b.bounds.y + b.bounds.height))
    };

    // Detect columns
    const xCoords = boxes.map(b => b.bounds.x).sort((a, b) => a - b);
    const gaps = [];
    
    for (let i = 1; i < xCoords.length; i++) {
      const gap = xCoords[i] - xCoords[i-1];
      if (gap > columnThreshold) {
        gaps.push({
          start: xCoords[i-1],
          end: xCoords[i],
          size: gap
        });
      }
    }

    // Identify margins
    const margins = {
      left: bounds.left > marginSize,
      right: (pageSize.width - bounds.right) > marginSize,
      top: bounds.top > marginSize,
      bottom: (pageSize.height - bounds.bottom) > marginSize
    };

    return {
      bounds,
      columns: gaps.length + 1,
      columnGaps: gaps,
      margins,
      pageSize
    };
  }

  /**
   * Group boxes into logical sections based on layout
   */
  groupIntoSections(boxes, layout) {
    const { sectionGap } = this.config.layout;
    const sections = [];
    let currentSection = [];

    // Sort boxes by vertical position
    const sortedBoxes = [...boxes].sort((a, b) => a.bounds.y - b.bounds.y);

    for (const box of sortedBoxes) {
      if (currentSection.length === 0) {
        currentSection.push(box);
        continue;
      }

      const lastBox = currentSection[currentSection.length - 1];
      const gap = box.bounds.y - (lastBox.bounds.y + lastBox.bounds.height);

      if (gap <= sectionGap) {
        currentSection.push(box);
      } else {
        sections.push(this.analyzeSection(currentSection));
        currentSection = [box];
      }
    }

    if (currentSection.length > 0) {
      sections.push(this.analyzeSection(currentSection));
    }

    return sections;
  }

  /**
   * Analyze content and structure of a section
   */
  analyzeSection(boxes) {
    const bounds = {
      left: Math.min(...boxes.map(b => b.bounds.x)),
      right: Math.max(...boxes.map(b => b.bounds.x + b.bounds.width)),
      top: Math.min(...boxes.map(b => b.bounds.y)),
      bottom: Math.max(...boxes.map(b => b.bounds.y + b.bounds.height))
    };

    // Analyze section characteristics
    const characteristics = {
      averageLineHeight: this.calculateAverageLineHeight(boxes),
      textDensity: this.calculateTextDensity(boxes, bounds),
      alignment: this.detectAlignment(boxes, bounds)
    };

    return {
      boxes,
      bounds,
      characteristics,
      type: this.classifySection(characteristics)
    };
  }

  /**
   * Calculate average line height in a section
   */
  calculateAverageLineHeight(boxes) {
    const lineHeights = [];
    const sortedBoxes = [...boxes].sort((a, b) => a.bounds.y - b.bounds.y);

    for (let i = 1; i < sortedBoxes.length; i++) {
      const gap = sortedBoxes[i].bounds.y - sortedBoxes[i-1].bounds.y;
      if (gap > 0 && gap < this.config.grouping.lineHeight * 2) {
        lineHeights.push(gap);
      }
    }

    return lineHeights.length > 0
      ? lineHeights.reduce((a, b) => a + b) / lineHeights.length
      : this.config.grouping.lineHeight;
  }

  /**
   * Calculate text density in a section
   */
  calculateTextDensity(boxes, bounds) {
    const totalArea = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
    const textArea = boxes.reduce((sum, box) => 
      sum + (box.bounds.width * box.bounds.height), 0);
    
    return textArea / totalArea;
  }

  /**
   * Detect text alignment in a section
   */
  detectAlignment(boxes, bounds) {
    const leftAligned = boxes.filter(b => 
      Math.abs(b.bounds