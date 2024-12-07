import {
  promises as fs,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "path";

import { pdf as pdfImageExtract } from "pdf-to-img";
import { PDFExtract as pdfDataExtract } from "pdf.js-extract";

import fetch from "node-fetch";
import { createOCREngine } from "tesseract-wasm";
import { loadWasmBinary } from "tesseract-wasm/node";
import sharp from "sharp";

// tesseract helper
async function loadImage(path) {
  const image = await sharp(path).ensureAlpha();
  const { width, height } = await image.metadata();
  return {
    data: await image.raw().toBuffer(),
    width,
    height,
  };
}

async function main() {
  // setup tesseract
  const wasmBinary = await loadWasmBinary();
  const engine = await createOCREngine({ wasmBinary });
  const modelPath = path.join(process.cwd(), "eng.traineddata");

  // download tesseract model if haven't already
  if (!existsSync(modelPath)) {
    process.stderr.write("Downloading text recognition model...\n");
    const modelURL =
      "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata";
    const response = await fetch(modelURL);
    if (!response.ok) {
      process.stderr.write(`Failed to download model from ${modelURL}`);
      process.exit(1);
    }
    const data = await response.arrayBuffer();
    writeFileSync(modelPath, new Uint8Array(data));
  }

  // tesseract engine ready
  const model = readFileSync(modelPath);
  engine.loadModel(model);

  // iterate over test documents
  const documents = ["digital-application.pdf", "scanned-application.pdf"];

  const outPath = path.join(process.cwd(), "output");
  if (!existsSync(outPath)) {
    mkdirSync(outPath);
  }

  for (let doc of documents) {
    const srcPath = path.join(process.cwd(), doc);
    const docPath = doc.replace(".pdf", "");
    const outputPath = path.join(process.cwd(), "output", docPath);
    if (!existsSync(outputPath)) {
      mkdirSync(outputPath);
    }
    const docName = docPath.replace("-application", "");
    // extract text boxes from pdf digital data
    const pdfExtract = new pdfDataExtract();
    const pdfData = await pdfExtract.extract(srcPath, {});
    await fs.writeFile(
      path.join(process.cwd(), "output", docPath, `${docName}_data.json`),
      JSON.stringify(pdfData)
    );

    // convert each page of PDF into png image

    let counter = 1;
    const pdfDocument = await pdfImageExtract(srcPath, {
      scale: 3,
      docInitParams: {
        standardFontDataUrl: undefined,
        cMapUrl: undefined,
        cMapPacked: false,
        useSystemFonts: true,
        disableFontFace: true,
      },
    });
    for await (const image of pdfDocument) {
      await fs.writeFile(
        path.join(
          process.cwd(),
          "output",
          docPath,
          `${docName}-page-${counter}.png`
        ),
        image
      );
      counter++;
    }

    // Load the image and perform tesseract OCR synchronously on first image.
    const ocrPath = path.join(
      process.cwd(),
      "output",
      docPath,
      `${docName}-page-1.png`
    );

    const image = await loadImage(ocrPath);
    engine.loadImage(image);

    const boxes = engine.getTextBoxes("word");
    await fs.writeFile(
      path.join(
        process.cwd(),
        "output",
        docPath,
        `${docName}-page1_boxes.json`
      ),
      JSON.stringify(boxes)
    );

    const orientation = engine.getOrientation();
    await fs.writeFile(
      path.join(
        process.cwd(),
        "output",
        docPath,
        `${docName}-page1_orientation.json`
      ),
      JSON.stringify(orientation)
    );

    const hocr = engine.getHOCR();
    await fs.writeFile(
      path.join(process.cwd(), "output", docPath, `${docName}-page1_hocr.txt`),
      hocr
    );

    const text = engine.getText();
    await fs.writeFile(
      path.join(process.cwd(), "output", docPath, `${docName}-page1_text.txt`),
      text
    );
  }

  engine.destroy();
}
main();
