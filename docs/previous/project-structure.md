# Project Structure

## Core Classes to Keep
1. `HybridDocumentProcessor` - Main processing engine
2. `DocumentValidationCLI` - Command line interface
3. `ValueNormalizer` - Still useful for value standardization
4. `SignatureDetector` - Will be enhanced with ML

## Supporting Classes
1. `DocumentProcessor` - Keep as base class for preprocessing
2. `LayoutDetector` - Will be integrated with pre-trained models

## Classes to Archive/Remove
1. `FieldExtractor` - Functionality now in HybridDocumentProcessor
2. `CriticalFieldValidator` - Merged into validation system
3. `DocumentClassifier` - Being replaced with ML-based approach

## Recommended Project Structure
```
project/
├── src/
│   ├── core/
│   │   ├── HybridDocumentProcessor.js
│   │   ├── DocumentProcessor.js
│   │   └── LayoutDetector.js
│   ├── validation/
│   │   ├── ValueNormalizer.js
│   │   └── SignatureDetector.js
│   ├── cli/
│   │   └── DocumentValidationCLI.js
│   └── utils/
│       └── preprocessing.js
├── models/
│   └── pretrained/
├── test/
│   └── samples/
└── docs/
    └── project-context.md
```

## Project Knowledge Files to Keep
1. `hybrid-validation-context.md` - Current project state
2. `project-structure.md` - This file
3. Sample PDFs for testing
4. Original project requirements

## Files to Archive
1. Old implementation classes
2. Initial testing outputs
3. Preliminary markdown summaries
4. Outdated context documents

The goal is to maintain a clean, focused project state while preserving the key functionality we've developed.