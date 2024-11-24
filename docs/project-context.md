# Hybrid Document Validation System - Project Context

## Strategic Evolution
We've made a significant pivot in our validation approach, moving from traditional label-based extraction to a more robust "known-value hunting" strategy with spatial verification. This shift was driven by the need to handle poor quality documents and OCR variations while maintaining high accuracy.

### New Core Strategy
1. Hybrid Validation Approach
   - Primary: Known-value fuzzy search across document
   - Secondary: Spatial verification of found values
   - Tertiary: Label proximity validation

2. Validation Priorities
   - Loan amount fields (highest priority)
   - Monthly installments
   - Interest rates
   - Insurance premiums
   - Service & initiation fees (lower priority)

### Validation Tolerances
- Currency: 5c (0.05) variation allowed
- Percentages: Trailing zeros ignored (29.00 = 29)
- Bank names: Fuzzy matching with 0.6 threshold
- Account numbers:
  - Digital: Exact matching
  - OCR: Single digit tolerance

## Current Implementation State
### Core Components
1. `HybridValidator`
   - Fuzzy value matching engine
   - Configurable field type validation
   - Spatial verification system
   - Confidence scoring

2. `DocumentValidationCLI`
   - Integrated hybrid validation
   - Enhanced preprocessing
   - Section-based content organization
   - Improved reporting

3. Validation Profiles
   - Comprehensive section definitions
   - Field aliases and locations
   - Type-specific validation rules
   - Cross-validation configurations

### Progress Made
1. Successfully implemented:
   - Value-first validation approach
   - Flexible fuzzy matching
   - Priority-based validation
   - Enhanced confidence scoring

2. Initial testing shows:
   - Improved extraction accuracy
   - Better handling of variations
   - More meaningful confidence scores
   - Clearer validation reporting

## Technology Stack
- Node.js 20
- pdf-to-img
- pdf.js-extract 
- tesseract-wasm
- @techstark/opencv-js
- sharp
- fast-fuzzy

## Next Steps
### Immediate Priorities
1. Enhance field matching with expanded aliases
2. Fine-tune fuzzy matching thresholds
3. Test with diverse document samples
4. Optimize spatial verification

### Future Enhancements
1. Machine learning for pattern recognition
2. Adaptive confidence scoring
3. Enhanced error reporting
4. Performance optimization

## Critical Considerations
1. Value Matching
   - Prioritize finding known values
   - Use fuzzy matching for flexibility
   - Apply type-specific tolerances

2. Spatial Verification
   - Use as confirmation rather than primary strategy
   - Allow for document variations
   - Consider section-based validation

3. Error Handling
   - Clear issue reporting
   - Confidence-based decision making
   - Detailed validation feedback

## Dependencies
```json
{
  "pdf-to-img": "^4.2.0",
  "pdf.js-extract": "^0.2.1", 
  "tesseract-wasm": "^0.10.0",
  "@techstark/opencv-js": "^4.10.0-release.1",
  "sharp": "^0.33.5",
  "fast-fuzzy": "^1.12.0"
}
```

## Development Focus
The primary focus should be on:
1. Implementing the complete HybridValidator
2. Expanding validation profiles
3. Testing with diverse documents
4. Fine-tuning validation rules

This new approach provides a more robust foundation for handling document variations while maintaining high validation accuracy.