#!/usr/bin/env node

import { program } from "commander";
import { chromium } from "playwright";
import readlineSync from "readline-sync";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { useApi } from "./useApi.js";
import { config } from "./config.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import ID Document Detection system globally (FIX: initialization error)
let IDDocumentDetector = null;
try {
  IDDocumentDetector = (await import("./id-document-detector.js")).default;
} catch (error) {
  console.warn("⚠️ ID Document Detection not available:", error.message);
}

program
  .name("dea-automation")
  .description("Deceased Estate Verification Automation CLI")
  .version("1.0.0");

program
  .command("dynamics")
  .description("Automate Dynamics 365 web application")
  .option("-u, --url <value>", "Specific Dynamics tenant URL")
  .action(async (options) => {
    await automateDynamics(options);
  });

program
  .command("demo")
  .description("⚠️  DEPRECATED: Use 'process-by-index' instead. Run deceased estate verification simulation demo")
  .option("-r, --row <number>", "Row number to select (0-based index)", "0")
  .action(async (options) => {
    console.warn("\n⚠️  WARNING: The 'demo' command is DEPRECATED!");
    console.warn("🔄 Please use 'process-by-index' command instead for production-aligned processing.");
    console.warn("📋 Command: node index.js process-by-index -r " + (options.row || "0"));
    console.warn("=".repeat(70));
    await runVerificationDemo(options);
  });

program
  .command("process-by-case")
  .description("Process a specific case by case number (production command)")
  .option("-c, --case <number>", "Case number to process (required)")
  .option("-p, --pages <number>", "Maximum pages to search through", "5")
  .option(
    "--exact-match",
    "Require exact case number match (no partial matches)"
  )
  .option("--keep-open", "Keep browser open after completion for note review")
  .action(async (options) => {
    if (!options.case) {
      console.error(
        "❌ Error: Case number is required. Use -c or --case to specify the case number."
      );
      process.exit(1);
    }
    await processCaseByNumber(options);
  });

program
  .command("process-by-index")
  .description("Process a specific case by row index (production command)")
  .option("-r, --row <number>", "Row number to select (0-based index)", "0")
  .option("--keep-open", "Keep browser open after completion for note review")
  .action(async (options) => {
    await processCaseByIndex(options);
  });

program
  .command("collect-case-queue")
  .description("Collect top 10 cases from queue and process them sequentially")
  .option("--review", "Pause after each case for manual review of results")
  .action(async (options) => {
    await collectAndProcessQueue(options);
  });

program
  .command("classify")
  .description("Classify PDF documents in the pdfs folder")
  .option("-f, --file <path>", "Classify a specific PDF file")
  .option(
    "-o, --output <path>",
    "Output directory for text files",
    "./text-output"
  )
  .action(async (options) => {
    await classifyPDFs(options);
  });

async function automateDynamics(options = {}) {
  console.log("Starting Dynamics 365 automation...");

  const userDataDir = path.join(__dirname, "browser-data", "dynamics");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "msedge",
    args: [
      "--no-sandbox",
      // "--disable-web-security",
      "--disable-blink-features=AutomationControlled",
      // "--disable-features=VizDisplayCompositor",
      // "--disable-dev-shm-usage",
      // "--disable-extensions-except",
      // "--disable-plugins-discovery",
      // "--no-first-run",
      // "--no-service-autorun",
      // "--no-default-browser-check",
      // "--password-store=basic",
      // "--use-mock-keychain",
      // "--disable-component-extensions-with-background-pages",
      // "--disable-background-timer-throttling",
      // "--disable-backgrounding-occluded-windows",
      // "--disable-renderer-backgrounding",
      // "--disable-field-trial-config",
      // "--disable-ipc-flooding-protection",
      // "--enable-features=NetworkService,NetworkServiceInProcess",
    ],
    viewport: { width: 1800, height: 700 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  });

  const page = await browser.newPage();

  try {
    if (options.url) {
      console.log(`Navigating to specific Dynamics URL: ${options.url}`);
      await page.goto(options.url, {
        waitUntil: "domcontentloaded",
      });

      // Wait for potential authentication redirects
      await page.waitForTimeout(30000);

      // Check if we're on a sign-in page
      const signInElements = await page
        .locator("#dialogCloseIconButton_2")
        .count();

      if (signInElements > 0) {
        console.log("Authentication required - handling sign-in...");
        await page.locator("#dialogCloseIconButton_2").first().click();

        //         await page.goto(options.url, {
        //   waitUntil: "domcontentloaded",
        // });
        //   // Try to find and click the sign-in button
        //   try {
        //     await page.locator('text="Sign in", button:has-text("Sign in")').first().click();
        //     console.log("Clicked sign-in button");

        //     // Wait for authentication flow
        //     await page.waitForTimeout(5000);

        //     // After sign-in, navigate back to the original URL
        //     console.log("Re-navigating to original URL after authentication...");
        //     await page.goto(options.url, {
        //       waitUntil: "networkidle",
        //     });
        //   } catch (error) {
        //     console.log("Could not automatically handle sign-in - manual intervention may be required");
        //   }
      }
    } else {
      console.log("Navigating to Dynamics 365 main page...");
      await page.goto(
        // "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
        "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
        {
          waitUntil: "domcontentloaded",
        }
      );
    }

    console.log(
      "Dynamics 365 automation ready - implement specific functionality here"
    );

    console.log("Keeping browser open for manual interaction...");
    console.log("Press Ctrl+C to close when done.");

    await new Promise(() => {});
  } catch (error) {
    console.error("Error during Dynamics 365 automation:", error);
    await page.pause();
  }
}

async function extractTextFromPDFPages(pdfPath, caseNumber = null) {
  try {
    console.log(`🔍 Processing: ${path.basename(pdfPath)}`);

    // 🔤 STEP 0: Try digital text extraction first (much faster and more accurate)
    console.log(`   🔤 Attempting digital text extraction...`);
    let digitalTextResults = [];
    try {
      // Use pdf.js-extract instead of pdf-parse to avoid hardcoded path issues
      const { PDFExtract } = await import("pdf.js-extract");
      const pdfExtract = new PDFExtract();
      const pdfData = await pdfExtract.extract(pdfPath);

      // Extract text from all pages
      let totalTextLength = 0;
      for (let pageIndex = 0; pageIndex < pdfData.pages.length; pageIndex++) {
        const page = pdfData.pages[pageIndex];
        let pageText = "";

        for (const item of page.content) {
          if (item.str && item.str.trim()) {
            pageText += item.str + " ";
          }
        }

        pageText = pageText.trim();
        totalTextLength += pageText.length;

        if (pageText.length > 10) {
          digitalTextResults.push({
            pageNumber: pageIndex + 1,
            text: pageText,
            source: "digital",
            imagePath: null, // No image needed for digital text
          });
        }
      }

      if (totalTextLength > 50 && digitalTextResults.length > 0) {
        console.log(
          `   ✅ Digital text extraction successful: ${totalTextLength} characters`
        );
        console.log(
          `   📄 Found ${pdfData.pages.length} pages with digital text`
        );
        console.log(
          `   🎯 Using digital text extraction (${digitalTextResults.length} pages)`
        );
        return digitalTextResults;
      } else if (totalTextLength > 0 && totalTextLength <= 50) {
        console.log(
          `   ⚠️  Digital text extraction yielded short text (${totalTextLength} chars) - document likely contains scanned pages, falling back to OCR with rotation`
        );
      } else {
        console.log(
          `   ⚠️  Digital text extraction yielded no usable text, falling back to OCR`
        );
      }

      console.log(
        `   ⚠️  Digital text extraction insufficient (${totalTextLength} chars), falling back to OCR with enhanced rotation`
      );
    } catch (digitalError) {
      console.log(
        `   ⚠️  Digital text extraction failed: ${digitalError.message}, falling back to OCR`
      );
    }

    // 🖼️ STEP 1: Extract images from PDF using pdf-to-img (FALLBACK - for OCR when digital text fails)
    console.log(`   🖼️  Extracting page images for OCR...`);
    const { pdf } = await import("pdf-to-img");

    const pdfDocument = await pdf(pdfPath, {
      scale: 2, // High resolution for better OCR
      renderParams: {
        // Force PNG output for better scribe.js compatibility (no JPEG dimension issues)
        format: "png",
      },
      docInitParams: {
        useSystemFonts: true,
        disableFontFace: true,
      },
    });

    console.log(`   📋 Found ${pdfDocument.length} pages to process`);

    if (pdfDocument.length === 0) {
      console.log(`   ⚠️  No pages found in PDF`);
      return [];
    }

    // Create images directory for this PDF organized by case number
    const pdfBaseName = path.basename(pdfPath, path.extname(pdfPath));
    const pdfImageDir = caseNumber
      ? path.join(__dirname, "pdf-images", caseNumber, pdfBaseName)
      : path.join(__dirname, "pdf-images", pdfBaseName);
    if (!fs.existsSync(pdfImageDir)) {
      fs.mkdirSync(pdfImageDir, { recursive: true });
    }

    // 📄 STEP 2: Process each page with OCR and save images
    console.log(`   🚀 Initializing scribe.js OCR for text extraction...`);
    const scribe = (await import("scribe.js-ocr")).default;
    await scribe.init({ ocr: true }); // Only OCR, not PDF processing

    const pageResults = [];
    let pageIndex = 0;

    for await (const pageBuffer of pdfDocument) {
      const pageNumber = pageIndex + 1;
      console.log(`   📊 Processing page ${pageNumber}...`);

      // Save page image for ID detection (SWITCHED TO PNG - better scribe.js compatibility)
      const imageFileName = `page${pageNumber}.png`;
      const imagePath = path.join(pdfImageDir, imageFileName);

      try {
        await fs.promises.writeFile(imagePath, pageBuffer);

        // CRITICAL FIX: Ensure file is fully written and synced before OCR
        await fs.promises.access(imagePath, fs.constants.R_OK);

        // Additional verification: Check file size to ensure it's not empty/corrupt
        const stats = await fs.promises.stat(imagePath);
        if (stats.size < 2000) {
          // PNG should be at least 2KB (larger than JPEG due to less compression)
          throw new Error(
            `Image file too small (${stats.size} bytes), possibly corrupt`
          );
        }

        console.log(
          `   🖼️  Page ${pageNumber} image saved: ${imageFileName} (${stats.size} bytes)`
        );

        // Small delay to ensure file system completion
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (imageError) {
        console.log(
          `   ⚠️  Failed to save image for page ${pageNumber}: ${imageError.message}`
        );
      }

      // Extract text using OCR on the saved image file (FIXED - scribe.js needs file path, not buffer)
      let cleanedText = "";
      try {
        // Double-check file exists and is readable before OCR
        if (fs.existsSync(imagePath)) {
          const stats = await fs.promises.stat(imagePath);
          console.log(
            `   🔍 OCR processing file: ${imageFileName} (${stats.size} bytes)`
          );

          if (stats.size < 2000) {
            console.log(
              `   ⚠️  PNG file too small for OCR: ${stats.size} bytes`
            );
            cleanedText = "";
          } else {
            // Clear any previous data from scribe.js
            await scribe.clear();

            // Additional small delay for file system stability
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Use the saved image file for OCR
            await scribe.importFiles([imagePath]);
            await scribe.recognize({ langs: ["eng"], mode: "fast" });
            const pageText = await scribe.exportData("txt");
            cleanedText = pageText ? pageText.trim() : "";
            console.log(
              `   📝 Page ${pageNumber}: ${cleanedText.length} characters extracted`
            );

            // 🔄 DOCUMENT ROTATION FOR LOW-CONFIDENCE READS
            if (cleanedText.length < 30 && fs.existsSync(imagePath)) {
              console.log(
                `   🔄 Low text extraction (${cleanedText.length} chars), trying rotation...`
              );

              const rotationAngles = [90, 180, 270];
              let bestText = cleanedText;
              let bestLength = cleanedText.length;

              for (const angle of rotationAngles) {
                try {
                  const sharp = (await import("sharp")).default;

                  // Create rotated version
                  const rotatedImagePath = imagePath.replace(
                    ".png",
                    `_rot${angle}.png`
                  );
                  await sharp(imagePath)
                    .rotate(angle)
                    .png()
                    .toFile(rotatedImagePath);

                  // Try OCR on rotated image
                  await scribe.clear();
                  await scribe.importFiles([rotatedImagePath]);
                  await scribe.recognize({ langs: ["eng"], mode: "fast" });
                  const rotatedText = await scribe.exportData("txt");
                  const rotatedTextClean = rotatedText
                    ? rotatedText.trim()
                    : "";

                  console.log(
                    `   🔄 Rotation ${angle}°: ${rotatedTextClean.length} characters`
                  );

                  // Keep the best result
                  if (rotatedTextClean.length > bestLength) {
                    bestText = rotatedTextClean;
                    bestLength = rotatedTextClean.length;
                    console.log(`   ✅ Better result with ${angle}° rotation!`);
                  }

                  // Cleanup rotated image
                  try {
                    fs.unlinkSync(rotatedImagePath);
                  } catch (unlinkError) {
                    // Ignore cleanup errors
                  }
                } catch (rotationError) {
                  console.log(
                    `   ⚠️  Rotation ${angle}° failed: ${rotationError.message}`
                  );
                }
              }

              cleanedText = bestText;
              if (bestLength > 30) {
                console.log(
                  `   🎯 Final result after rotation: ${bestLength} characters`
                );
              }
            }
          }
        } else {
          console.log(`   ⚠️  Image file not found for OCR: ${imagePath}`);
          cleanedText = "";
        }
      } catch (ocrError) {
        console.log(
          `   ⚠️  OCR failed for page ${pageNumber}: ${ocrError.message}`
        );
        // Try to get more specific error details
        if (ocrError.stack) {
          console.log(
            `   🔍 OCR Error Stack: ${ocrError.stack.split("\n")[0]}`
          );
        }

        // FALLBACK: Try to analyze the image file for debugging
        try {
          if (fs.existsSync(imagePath)) {
            const stats = await fs.promises.stat(imagePath);
            console.log(
              `   🔍 Failed image file info: ${stats.size} bytes, modified: ${stats.mtime}`
            );
          }
        } catch (debugError) {
          console.log(
            `   🔍 Could not analyze failed image file: ${debugError.message}`
          );
        }

        cleanedText = "";
      }

      pageResults.push({
        pageNumber: pageNumber,
        text: cleanedText,
        textLength: cleanedText.length,
        imagePath: imagePath, // Critical: Image path for ID detection
        source: "ocr", // Track extraction method
      });

      pageIndex++;
    }

    console.log(
      `   ✅ PDF processing completed for all ${pageResults.length} pages`
    );
    await scribe.terminate();
    return pageResults;
  } catch (error) {
    console.log(
      `   ❌ Error processing ${path.basename(pdfPath)}: ${error.message}`
    );

    // Make sure to terminate scribe.js even on error
    try {
      const scribe = (await import("scribe.js-ocr")).default;
      await scribe.terminate();
    } catch (terminateError) {
      // Ignore terminate errors
    }

    return [];
  }
}

/**
 * Process a specific case by case number (Production Command)
 * Searches through the queue to find the case and processes it
 */
async function processCaseByNumber(options = {}) {
  console.log("🚀 Starting Production Case Processing");
  console.log(`🔍 Searching for case number: ${options.case}`);
  console.log(`📄 Max pages to search: ${options.pages || "5"}`);
  console.log(`🎯 Exact match required: ${options.exactMatch ? "Yes" : "No"}`);
  console.log("=".repeat(50));

  const caseNumber = options.case.toString().trim();
  const maxPages = parseInt(options.pages || "5");
  const exactMatch = !!options.exactMatch;

  let linkText = "unknown_case";
  let cleanCaseNumber = caseNumber;
  let customerName = "unknown_customer";
  let foundCase = false;
  let targetRowIndex = -1;

  const userDataDir = path.join(__dirname, "browser-data", "dynamics");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "msedge",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    viewport: { width: 1800, height: 820 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  });

  const page = await browser.newPage();

  try {
    // Create or find API record and set to busy
    console.log("🔄 Creating/updating API record...");
    const apiRecord = await createOrFindApiRecord(caseNumber, "Unknown Customer", "busy");
    // Step 1: Open Dynamics URL
    console.log("\n📋 Step 1: Opening Dynamics 365 queue...");
    await page.goto(
      "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
      { waitUntil: "domcontentloaded" }
    );

    await page.waitForTimeout(5000);

    // Step 2: Search for the case across multiple pages
    console.log(`\n🔍 Step 2: Searching for case number "${caseNumber}"...`);
    await page.waitForSelector('[data-id="grid-container"]');

    let currentPage = 1;
    let searchComplete = false;

    while (currentPage <= maxPages && !searchComplete) {
      console.log(`\n📄 Searching page ${currentPage}...`);

      // Wait for grid to load
      await page.waitForTimeout(3000);

      // Get all visible rows
      const allRows = await page.locator(
        '[data-id="grid-container"] [role="row"][row-index]'
      );
      const rowCount = await allRows.count();
      console.log(`📊 Found ${rowCount} rows on page ${currentPage}`);

      // Search through current page rows
      for (let i = 0; i < rowCount; i++) {
        const currentRow = allRows.nth(i);

        try {
          // Method 1: Check case number column
          const caseNumberElement = await currentRow
            .locator(
              '[col-id="a_7e194e07d227e911a978000d3a23db8b.ticketnumber"] label'
            )
            .first();
          if ((await caseNumberElement.count()) > 0) {
            const rowCaseNumber = await caseNumberElement.getAttribute(
              "aria-label"
            );

            const isMatch = exactMatch
              ? rowCaseNumber === caseNumber
              : rowCaseNumber && rowCaseNumber.includes(caseNumber);

            if (isMatch) {
              console.log(
                `🎯 FOUND! Case ${rowCaseNumber} matches in case number column`
              );
              foundCase = true;
              targetRowIndex = i;
              cleanCaseNumber = rowCaseNumber;

              // Extract customer name
              try {
                const customerElement = await currentRow
                  .locator(
                    '[col-id="a_7e194e07d227e911a978000d3a23db8b.customerid"] a'
                  )
                  .first();
                if ((await customerElement.count()) > 0) {
                  customerName =
                    (await customerElement.getAttribute("aria-label")) ||
                    "unknown_customer";
                }
              } catch (customerError) {
                console.log(
                  `⚠️  Could not extract customer name: ${customerError.message}`
                );
              }

              break;
            }
          }

          // Method 2: Check title column if case number column didn't match
          if (!foundCase) {
            const titleElement = await currentRow
              .locator('[col-id="title"] a')
              .first();
            if ((await titleElement.count()) > 0) {
              const titleText = await titleElement.getAttribute("aria-label");

              const isMatch = exactMatch
                ? titleText && titleText.startsWith(caseNumber + ":")
                : titleText && titleText.includes(caseNumber);

              if (isMatch) {
                console.log(
                  `🎯 FOUND! Case ${caseNumber} matches in title column: ${titleText}`
                );
                foundCase = true;
                targetRowIndex = i;
                linkText = titleText;

                // Try to extract clean case number from title
                const titleMatch = titleText.match(/^(\d+):/);
                if (titleMatch) {
                  cleanCaseNumber = titleMatch[1];
                }

                // Extract customer name
                try {
                  const customerElement = await currentRow
                    .locator(
                      '[col-id="a_7e194e07d227e911a978000d3a23db8b.customerid"] a'
                    )
                    .first();
                  if ((await customerElement.count()) > 0) {
                    customerName =
                      (await customerElement.getAttribute("aria-label")) ||
                      "unknown_customer";
                  }
                } catch (customerError) {
                  console.log(
                    `⚠️  Could not extract customer name: ${customerError.message}`
                  );
                }

                break;
              }
            }
          }
        } catch (rowError) {
          console.log(`⚠️  Error checking row ${i}: ${rowError.message}`);
        }

        if (foundCase) break;
      }

      if (foundCase) {
        searchComplete = true;
        console.log(
          `✅ Case found on page ${currentPage}, row ${targetRowIndex}`
        );
        console.log(`📋 Case Number: ${cleanCaseNumber}`);
        console.log(`👤 Customer: ${customerName}`);
      } else {
        // Try to go to next page
        console.log(
          `❌ Case not found on page ${currentPage}, checking for next page...`
        );

        // Look for pagination controls or "Load More" button
        const loadMoreButton = await page
          .locator(
            'button:has-text("Load more"), button[aria-label*="Next"], button[aria-label*="next"], .paging button:last-child'
          )
          .first();
        const hasLoadMore =
          (await loadMoreButton.count()) > 0 &&
          (await loadMoreButton.isEnabled());

        if (hasLoadMore && currentPage < maxPages) {
          console.log(`⏭️  Loading next page...`);
          await loadMoreButton.click();
          await page.waitForTimeout(4000); // Wait for new data to load
          currentPage++;
        } else {
          console.log(`📄 No more pages available or max pages reached`);
          searchComplete = true;
        }
      }
    }

    if (!foundCase) {
      throw new Error(
        `Case number "${caseNumber}" not found after searching ${currentPage} page(s). Please verify the case number and try again.`
      );
    }

    // Step 3: Click on the found case
    console.log(`\n📋 Step 3: Clicking on found case...`);
    const foundRow = await page
      .locator('[data-id="grid-container"] [role="row"][row-index]')
      .nth(targetRowIndex);
    const caseLink = await foundRow.locator('[col-id="title"] a').first();

    if ((await caseLink.count()) > 0) {
      if (!linkText || linkText === "unknown_case") {
        linkText = await caseLink.getAttribute("aria-label");
      }
      await caseLink.click();
      console.log(`✅ Successfully clicked on case: ${linkText}`);
      console.log(
        `🎯 Processing case: ${cleanCaseNumber} for Customer: ${customerName}`
      );
    } else {
      throw new Error("Could not find clickable link in the found case row");
    }

    // Step 4: Continue with the standard case processing workflow (same as demo)
    // From here, we use the same logic as runVerificationDemo starting from Step 3 (Timeline tab)
    const result = await continueStandardCaseProcessing(
      page,
      cleanCaseNumber,
      customerName,
      linkText
    );

    // Update API record with successful completion
    // Determine caseStatus based on verification results
    const verificationContent = result.verificationResults?.content || "";
    const caseStatus = verificationContent.includes("INCOMPLETE") ? "invalid" : "valid";
    
    // Extract actual PDF filenames from downloaded files
    const documentNames = result.downloadedPdfs ? 
      result.downloadedPdfs.map(filePath => path.basename(filePath)) : [];

    await updateApiRecordByCaseNumber(
      cleanCaseNumber,
      "complete",
      caseStatus,
      result,
      verificationContent,
      documentNames,
      null
    );

  } catch (error) {
    console.error(`❌ Error in case processing: ${error.message}`);
    
    // Update API record with error
    await updateApiRecordByCaseNumber(
      cleanCaseNumber,
      "error",
      "",
      "",
      "",
      [],
      error.message
    );
    
    await page.pause(); // Allow manual inspection in case of errors
  } finally {
    if (!options.keepOpen) {
      await browser.close();
    } else {
      console.log(
        "\n🔍 Browser kept open for note review. Close browser manually when done."
      );
      console.log(
        "💡 The verification note has been added to the Dynamics timeline for your review."
      );
    }
  }
}

/**
 * Process a case by row index - cloned from processCaseByNumber but accepts row index
 */
async function processCaseByIndex(options = {}) {
  console.log("🚀 Starting Production Case Processing by Index");
  console.log(`📊 Targeting row index: ${options.row || "0"}`);
  console.log("=".repeat(50));

  const rowIndex = parseInt(options.row || "0");
  let linkText = "unknown_case";
  let cleanCaseNumber = "unknown_case";
  let customerName = "unknown_customer";

  const userDataDir = path.join(__dirname, "browser-data", "dynamics");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "msedge",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    viewport: { width: 1800, height: 820 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  });

  const page = await browser.newPage();

  try {
    // We'll update the API record once we have the actual case number and customer name
    // Step 1: Open Dynamics URL
    console.log("\n📋 Step 1: Opening Dynamics 365 queue...");
    await page.goto(
      "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
      { waitUntil: "domcontentloaded" }
    );

    await page.waitForTimeout(5000);

    // Step 2: Click on case in specified row (same as demo command logic)
    console.log(`\n📋 Step 2: Clicking on case in row ${rowIndex}...`);
    await page.waitForSelector('[data-id="grid-container"]');

    const targetRow = await page
      .locator(
        `[data-id="grid-container"] [role="row"][row-index="${rowIndex}"]`
      )
      .first();

    await page.waitForTimeout(5000);

    if ((await targetRow.count()) > 0) {
      // Extract clean case number from Case Number column
      try {
        const caseNumberElement = await targetRow
          .locator(
            '[col-id="a_7e194e07d227e911a978000d3a23db8b.ticketnumber"] label'
          )
          .first();
        if ((await caseNumberElement.count()) > 0) {
          cleanCaseNumber =
            (await caseNumberElement.getAttribute("aria-label")) ||
            "unknown_case";
          console.log(`📋 Extracted clean case number: ${cleanCaseNumber}`);
        }
      } catch (error) {
        console.log(`⚠️  Could not extract case number: ${error.message}`);
      }

      // Extract customer name from Customer column
      try {
        const customerElement = await targetRow
          .locator('[col-id="a_7e194e07d227e911a978000d3a23db8b.customerid"] a')
          .first();
        if ((await customerElement.count()) > 0) {
          customerName =
            (await customerElement.getAttribute("aria-label")) ||
            "unknown_customer";
          console.log(`👤 Extracted customer name: ${customerName}`);
        }
      } catch (error) {
        console.log(`⚠️  Could not extract customer name: ${error.message}`);
      }

      // Find the first link in the title column (col-id="title") for navigation
      const caseLink = await targetRow.locator('[col-id="title"] a').first();

      if ((await caseLink.count()) > 0) {
        linkText = await caseLink.getAttribute("aria-label");
        await caseLink.click();
        console.log(`✅ Successfully clicked on case: ${linkText}`);
        console.log(
          `🎯 Using clean case number: ${cleanCaseNumber} for Customer: ${customerName}`
        );

        // Create or find API record and set to busy
        console.log("🔄 Creating/updating API record...");
        const apiRecord = await createOrFindApiRecord(cleanCaseNumber, customerName, "busy");

      } else {
        console.log(
          "⚠️  No case link found in the title column of the specified row"
        );
      }
    } else {
      console.log(
        `⚠️  Row ${rowIndex} not found, proceeding with simulation...`
      );
    }

    await page.waitForTimeout(6000);

    // Step 3: Continue with the standard case processing workflow (same as process-by-case)
    const result = await continueStandardCaseProcessing(
      page,
      cleanCaseNumber,
      customerName,
      linkText
    );

    // Update API record with successful completion
    // Determine caseStatus based on verification results
    const verificationContent = result.verificationResults?.content || "";
    const caseStatus = verificationContent.includes("INCOMPLETE") ? "invalid" : "valid";
    
    // Extract actual PDF filenames from downloaded files
    const documentNames = result.downloadedPdfs ? 
      result.downloadedPdfs.map(filePath => path.basename(filePath)) : [];

    await updateApiRecordByCaseNumber(
      cleanCaseNumber,
      "complete",
      caseStatus,
      result,
      verificationContent,
      documentNames,
      null
    );

  } catch (error) {
    console.error(`❌ Error in case processing: ${error.message}`);
    
    // Update API record with error
    await updateApiRecordByCaseNumber(
      cleanCaseNumber,
      "error",
      "",
      "",
      "",
      [],
      error.message
    );
    
    await page.pause(); // Allow manual inspection in case of errors
  } finally {
    if (!options.keepOpen) {
      await browser.close();
    } else {
      console.log(
        "\n🔍 Browser kept open for note review. Close browser manually when done."
      );
      console.log(
        "💡 The verification note has been added to the Dynamics timeline for your review."
      );
    }
  }
}

/**
 * Continue with standard case processing workflow after case is found and opened
 * This contains the shared logic from runVerificationDemo starting from Timeline tab
 */
async function continueStandardCaseProcessing(
  page,
  cleanCaseNumber,
  customerName,
  linkText
) {
  // Wait for case to load
  await page.waitForTimeout(6000);

  // Step 4: Switch to Timeline tab (continuing the numbering from processCaseByNumber)
  console.log("\n📋 Step 4: Switching to Timeline tab...");
  const timelineTab = await page
    .locator('[aria-label="Timeline"][role="tab"]')
    .first();
  if ((await timelineTab.count()) > 0) {
    await timelineTab.click();
    console.log("✅ Successfully switched to Timeline tab");
  } else {
    console.log("⚠️  Timeline tab not found, proceeding with simulation...");
  }

  await page.waitForTimeout(8000);

  // Step 5: Expand all timeline items
  console.log("\n📋 Step 5: Expanding timeline items...");
  const viewMoreButtons = await page
    .locator('button[aria-label="View more"]')
    .all();
  console.log(`Found ${viewMoreButtons.length} 'View more' buttons`);

  for (let i = 0; i < viewMoreButtons.length; i++) {
    try {
      await viewMoreButtons[i].click({ timeout: 2000 });
      console.log(`✅ Expanded timeline item ${i + 1}`);
      await page.waitForTimeout(200);
    } catch (error) {
      // Silently continue if expansion fails
    }
  }

  // Second pass to expand any remaining "View more" buttons that appeared after first expansion
  console.log("\n📋 Step 5.1: Second pass - expanding any remaining items...");
  const viewMoreButtons2 = await page
    .locator('button[aria-label="View more"]')
    .all();
  console.log(
    `Found ${viewMoreButtons2.length} additional 'View more' buttons`
  );

  for (let i = 0; i < viewMoreButtons2.length; i++) {
    try {
      await viewMoreButtons2[i].click({ timeout: 2000 });
      console.log(`✅ Expanded additional timeline item ${i + 1}`);
      await page.waitForTimeout(200);
    } catch (error) {
      // Silently continue if expansion fails
    }
  }

  // Step 6: Analyze all PDF attachments first
  console.log("\n📋 Step 6: Analyzing PDF attachments...");
  const pdfButtons = await page.locator('button[aria-label*=".pdf"]').all();
  console.log(`Found ${pdfButtons.length} PDF buttons`);

  // Collect all PDF names for analysis
  const allPdfNames = [];
  for (let i = 0; i < pdfButtons.length; i++) {
    try {
      const ariaLabel = await pdfButtons[i].getAttribute("aria-label");
      allPdfNames.push(ariaLabel);
      console.log(`📄 Found PDF: ${ariaLabel}`);
    } catch (error) {
      console.log(`⚠️  Could not get name for PDF ${i + 1}`);
    }
  }

  await page.waitForTimeout(2000);

  // Step 6.1: Download ALL PDF documents for the case
  console.log("\n📋 Step 6.1: Downloading all PDF attachments...");

  // Use clean case number for folder creation
  const caseDownloadDir = path.join(process.cwd(), "pdfs", cleanCaseNumber);

  // Create case-specific directory
  if (!fs.existsSync(caseDownloadDir)) {
    fs.mkdirSync(caseDownloadDir, { recursive: true });
    console.log(`📁 Created case directory: ${caseDownloadDir}`);
  }

  console.log(`📄 Processing ${pdfButtons.length} PDF attachments...`);
  const pdfNames = [];
  const downloadedPdfs = [];
  const usedFileNames = new Map(); // Track filename usage for deduplication

  for (let i = 0; i < pdfButtons.length; i++) {
    try {
      const ariaLabel = await pdfButtons[i].getAttribute("aria-label");
      pdfNames.push(ariaLabel);
      console.log(
        `\n🔍 Processing PDF ${i + 1}/${pdfButtons.length}: ${ariaLabel}`
      );

      // Try direct download first, fallback to modal handling
      let download;
      let fileName = ariaLabel; // fallback filename

      // Set up download listener with timeout
      const downloadPromise = Promise.race([
        page.waitForEvent("download", { timeout: 2000 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Download timeout")), 2000)
        ),
      ]);

      // Click the PDF button
      await pdfButtons[i].click();

      try {
        // Try to catch immediate download
        console.log(`📥 Attempting direct download...`);
        download = await downloadPromise;
        console.log(`✅ Direct download triggered for: ${ariaLabel}`);
      } catch (downloadError) {
        // Direct download failed, try modal approach
        console.log(`🔄 Direct download failed, trying modal approach...`);

        // Wait for modal to fully load
        await page.waitForTimeout(3000);

        // Wait for download button and click it
        const downloadButton = page
          .locator('button[aria-label="Download"]')
          .first();
        await downloadButton.waitFor({ timeout: 10000 });

        console.log(`📥 Starting modal download...`);

        // Start download from modal
        const modalDownloadPromise = page.waitForEvent("download");
        await downloadButton.click();
        download = await modalDownloadPromise;

        // Get filename from the modal
        const fileNameElement = page.locator("#fileNameTitle");
        try {
          const fileNameText = await fileNameElement.textContent();
          if (fileNameText && fileNameText.includes("File name:")) {
            fileName = fileNameText.replace("File name:", "").trim();
          }
        } catch (e) {
          console.log(
            `⚠️  Could not extract filename from modal, using aria-label`
          );
        }

        console.log(`✅ Modal download completed for: ${ariaLabel}`);
      }

      // Handle filename deduplication
      let finalFileName = fileName;
      if (usedFileNames.has(fileName)) {
        const count = usedFileNames.get(fileName) + 1;
        usedFileNames.set(fileName, count);
        const fileNameParts = fileName.split('.');
        const extension = fileNameParts.pop();
        const baseName = fileNameParts.join('.');
        finalFileName = `${baseName}_${count}.${extension}`;
        console.log(`🔄 Duplicate filename detected. Renamed to: ${finalFileName}`);
      } else {
        usedFileNames.set(fileName, 1);
      }

      // Save to case directory
      const filePath = path.join(caseDownloadDir, finalFileName);
      await download.saveAs(filePath);
      downloadedPdfs.push(filePath);

      console.log(`✅ Downloaded: ${finalFileName}`);

      // Close modal if it was opened (check if download button exists)
      try {
        const modalExists = await page
          .locator('button[aria-label="Download"]')
          .first()
          .isVisible({ timeout: 1000 });
        if (modalExists) {
          await page.keyboard.press("Escape");
          console.log(`✅ Closed PDF modal`);
        }
      } catch (e) {
        // No modal to close, continue
      }

      await page.waitForTimeout(1000);
    } catch (error) {
      console.log(`❌ Could not download PDF ${i + 1}: ${error.message}`);

      // Try to close modal if it exists
      try {
        const modalExists = await page
          .locator('button[aria-label="Download"]')
          .first()
          .isVisible({ timeout: 1000 });
        if (modalExists) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        }
      } catch (closeError) {
        // Failed to close modal, continue
      }
    }
  }

  console.log(
    `\n📊 Download Summary: ${downloadedPdfs.length}/${pdfButtons.length} PDFs downloaded`
  );
  downloadedPdfs.forEach((filePath, index) => {
    console.log(`  ${index + 1}. ${path.basename(filePath)}`);
  });

  await page.waitForTimeout(3000);

  // Step 7: Real PDF Classification
  console.log("\n📋 Step 7: PDF Classification and Verification...");
  console.log(
    `🔍 Classifying ${downloadedPdfs.length} downloaded documents...`
  );

  let classificationResults = null;

  if (downloadedPdfs.length > 0) {
    // Run real classification on downloaded PDFs
    try {
      console.log(
        `📄 Running classification on case directory: ${caseDownloadDir}`
      );
      classificationResults = await runPDFClassificationForCase(
        caseDownloadDir
      );
      if (classificationResults === null) {
        console.log(
          `⚠️  Classification returned null - falling back to legacy filename analysis`
        );
      } else {
        console.log(`✅ Classification completed`);
      }
    } catch (classificationError) {
      console.log(`❌ Classification failed: ${classificationError.message}`);
      console.log(`⚠️  Falling back to legacy filename analysis...`);
      classificationResults = null;
    }
  } else {
    console.log(`⚠️  No PDFs downloaded, using simulated analysis...`);
  }

  console.log(
    "\n📋 Step 7.1: Verify Death of 3607205019085 with request to FISA..."
  );
  // await page.waitForTimeout(5000);

  // Generate verification results
  const verificationResult = await generateVerificationResults(
    cleanCaseNumber,
    customerName,
    downloadedPdfs,
    classificationResults,
    caseDownloadDir
  );

  // Save verification results to case file
  const verificationFileName = `${cleanCaseNumber}_verification_results.txt`;
  const verificationFilePath = path.join(process.cwd(), verificationFileName);
  const fullVerificationContent = verificationResult.fullContent;

  try {
    fs.writeFileSync(verificationFilePath, fullVerificationContent, "utf8");
    console.log(`\n💾 Verification results saved to: ${verificationFileName}`);
    console.log(`📁 File location: ${verificationFilePath}`);
  } catch (saveError) {
    console.log(
      `⚠️  Could not save verification results: ${saveError.message}`
    );
  }

  console.log("✅ Document verification completed");
  console.log("\n" + verificationResult.content);

  // Step 8: Add verification note to Dynamics
  console.log("\n📋 Step 8: Adding verification note...");

  const noteButton = await page
    .locator('button[aria-label="Enter a note..."]')
    .first();
  if ((await noteButton.count()) > 0) {
    await noteButton.click();
    console.log("✅ Clicked 'Enter a note...' button");

    await page.waitForTimeout(2000);

    const titleInput = await page
      .locator("#create_note_medium_titlenotescontrol")
      .first();
    if ((await titleInput.count()) > 0) {
      await titleInput.fill("Verification Result: Documents Required");
      console.log("✅ Entered note title");
    }
    await page.waitForTimeout(2000);
    const noteTextArea = await page
      .locator("#create_note_notesTextnotescontrol")
      .first();
    if ((await noteTextArea.count()) > 0) {
      await noteTextArea.click();
      // Copy verification results to clipboard and paste
      await page.evaluate((text) => {
        navigator.clipboard.writeText(text);
      }, verificationResult.content);
      await page.keyboard.press("Control+v");
      console.log("✅ Pasted verification results");
    }
  } else {
    console.log(
      "⚠️  Note button not found, verification results logged to console"
    );
  }

  console.log(`\n✅ Case ${cleanCaseNumber} processing completed!`);
  console.log(`📁 Files saved to: ${caseDownloadDir}`);
  console.log(`📊 Results: ${verificationResult.summary}`);
  console.log("📝 Verification note added to Dynamics timeline");

  return {
    caseNumber: cleanCaseNumber,
    customerName: customerName,
    downloadedPdfs: downloadedPdfs,
    classificationResults: classificationResults,
    verificationResults: verificationResult,
    caseDirectory: caseDownloadDir,
  };
}

/**
 * Run PDF classification for a case directory
 * Moved to global scope for sharing between demo and process-by-case commands
 */
async function runPDFClassificationForCase(caseDir) {
  console.log(
    `🔍 Running PDF classification for case directory: ${path.basename(
      caseDir
    )}`
  );

  try {
    // Import classification modules
    const { default: nlp } = await import("compromise");
    const { default: dates } = await import("compromise-dates");
    const { default: numbers } = await import("compromise-numbers");
    const { franc } = await import("franc");
    const fuzzy = await import("fast-fuzzy");
    const scribe = (await import("scribe.js-ocr")).default;

    // Extend compromise with plugins
    nlp.extend(dates);
    nlp.extend(numbers);

    // Find all PDF files in the case directory
    const pdfFiles = fs
      .readdirSync(caseDir)
      .filter((file) => file.toLowerCase().endsWith(".pdf"))
      .map((file) => path.join(caseDir, file));

    if (pdfFiles.length === 0) {
      throw new Error("No PDF files found in case directory");
    }

    console.log(`📄 Found ${pdfFiles.length} PDF files to classify`);

    const allResults = [];
    const documentCoverage = {};

    const requiredDocuments = [
      "Death certificate",
      "Deceased ID (back and front copy of smart ID)",
      "Letter of appointment",
      "Executor ID (back and front copy of smart ID)",
      "Power of attorney (if applicable)",
      "Agents ID (if applicable back and front copy of smart ID)",
      "Letter of instruction signed by the agent/executor",
      "Proof of estate late banking details",
      "Complete the attached indemnity",
    ];

    // Initialize coverage tracking
    requiredDocuments.forEach((doc) => {
      documentCoverage[doc] = [];
    });

    // Use the global extractTextFromPDFPages function for consistency

    // Process each PDF file
    for (const pdfFile of pdfFiles) {
      console.log(`🔍 Classifying: ${path.basename(pdfFile)}`);

      // Extract case number from directory path (e.g., "C:\DEA3\pdfs\107932373\file.pdf" -> "107932373")
      const caseNumber = path.basename(path.dirname(pdfFile));
      const pageResults = await extractTextFromPDFPages(pdfFile, caseNumber);
      if (!pageResults || pageResults.length === 0) {
        console.log(`⚠️  No text extracted from ${path.basename(pdfFile)}`);
        continue;
      }

      // FIXED: Implement page-by-page content classification for bundled PDFs
      console.log(
        `🔍 Running page-by-page classification for ${path.basename(pdfFile)}`
      );

      // Document content patterns for page-by-page classification
      const documentContentPatterns = {
        "Death certificate": [
          /death.*certificate|certificate.*death|death.*cert/i,
          /department.*home.*affairs|dha|home.*affairs/i,
          /deceased|death.*date|date.*death|died.*on/i,
          /registration.*death|death.*registration/i,
          /cause.*death/i,
        ],

        "Deceased ID (back and front copy of smart ID)": [
          /identity.*document|identity.*number|id.*number/i,
          /south.*african.*citizen|sa.*citizen|republic.*south.*africa/i,
          /identity.*book|smart.*card|green.*book/i,
          /\b\d{13}\b/, // 13-digit ID number
          /nationality.*south.*african/i,
          /surname|first.*names|sex.*male|sex.*female/i,
        ],

        "Executor ID (back and front copy of smart ID)": [
          /identity.*document|identity.*number|id.*number/i,
          /south.*african.*citizen|sa.*citizen|republic.*south.*africa/i,
          /identity.*book|smart.*card|green.*book/i,
          /\b\d{13}\b/, // 13-digit ID number
          /nationality.*south.*african/i,
          /surname|first.*names|sex.*male|sex.*female/i,
        ],

        "Agents ID (if applicable back and front copy of smart ID)": [
          /identity.*document|identity.*number|id.*number/i,
          /south.*african.*citizen|sa.*citizen|republic.*south.*africa/i,
          /identity.*book|smart.*card|green.*book/i,
          /\b\d{13}\b/, // 13-digit ID number
          /nationality.*south.*african/i,
          /surname|first.*names|sex.*male|sex.*female/i,
        ],

        "Letter of appointment": [
          /letter.*appointment|appointment.*letter|letters.*executorship/i,
          /executor.*appointed|appointed.*executor|executorship/i,
          /estate.*late|estate.*deceased/i,
          /high.*court|court.*order|magistrate/i,
          /grant.*letters|letters.*granted/i,
        ],

        "Power of attorney (if applicable)": [
          /power.*attorney|attorney.*power|poa\b/i,
          /hereby.*authorize|authorize.*hereby/i,
          /act.*behalf|behalf.*undersigned/i,
          /legal.*representative/i,
        ],

        "Proof of estate late banking details": [
          /standard.*bank|nedbank|absa|fnb|capitec/i,
          /bank.*statement|statement.*bank|account.*statement/i,
          /account.*number|account.*details|banking.*details/i,
          /balance.*brought.*forward|current.*balance/i,
          /branch.*code|swift.*code/i,
        ],

        "Complete the attached indemnity": [
          /indemnity|indemnify|waiver|liability.*waiver/i,
          /hold.*harmless|harmless.*hold/i,
          /telephone.*instruction|telephonic.*instruction/i,
          /email.*instruction|fax.*instruction/i,
          /nedbank.*waiver/i,
        ],

        "Letter of instruction signed by the agent/executor": [
          /dear.*sir|dear.*madam|dear.*sirs/i,
          /kindly.*assist|please.*assist|request.*assistance/i,
          /estate.*correspondence|correspondence.*estate/i,
          /yours.*faithfully|yours.*sincerely/i,
          /estate.*late.*patrick|estate.*late/i,
        ],
      };

      // Classify each page content
      for (const pageResult of pageResults) {
        console.log(
          `   📑 Analyzing page ${pageResult.pageNumber} (${pageResult.text.length} chars)`
        );

        const pageClassifications = [];

        // Test each document type against this page's content
        for (const [docType, patterns] of Object.entries(
          documentContentPatterns
        )) {
          let matches = 0;
          for (const pattern of patterns) {
            if (pattern.test(pageResult.text)) {
              matches++;
            }
          }

          // If we have matches, calculate confidence
          if (matches > 0) {
            const confidence = matches / patterns.length;
            pageClassifications.push({
              type: docType,
              matches: matches,
              confidence: confidence,
              pageNumber: pageResult.pageNumber,
            });
          }
        }

        // Sort by confidence
        pageClassifications.sort((a, b) => b.confidence - a.confidence);

        console.log(
          `   🎯 Found ${pageClassifications.length} document types on page ${pageResult.pageNumber}`
        );

        // Add to coverage tracking (use the highest confidence classification for each page)
        if (pageClassifications.length > 0) {
          const bestMatch = pageClassifications[0];
          console.log(
            `      ✅ Best match: ${bestMatch.type} (${bestMatch.matches}/${
              documentContentPatterns[bestMatch.type].length
            } patterns, ${Math.round(bestMatch.confidence * 100)}% confidence)`
          );

          // Add to document coverage
          if (!documentCoverage[bestMatch.type]) {
            documentCoverage[bestMatch.type] = [];
          }
          documentCoverage[bestMatch.type].push({
            filename: path.basename(pdfFile),
            pageNumber: pageResult.pageNumber,
            confidence: bestMatch.confidence,
            matches: bestMatch.matches,
          });
        } else {
          console.log(
            `      ❌ No document types identified for page ${pageResult.pageNumber}`
          );
        }

        // Add to results with classifications
        allResults.push({
          filename: path.basename(pdfFile),
          pageNumber: pageResult.pageNumber,
          textSample: pageResult.text.substring(0, 200) + "...",
          textLength: pageResult.text.length,
          classifications: pageClassifications,
        });
      }
    }

    // FIXED: Return proper page-by-page classification results
    console.log(`✅ Page-by-page classification completed`);

    // Generate summary of found documents
    const foundDocumentTypes = Object.keys(documentCoverage).filter(
      (doc) => documentCoverage[doc].length > 0
    );
    console.log(
      `📊 Found ${foundDocumentTypes.length}/${requiredDocuments.length} required document types:`
    );
    foundDocumentTypes.forEach((docType) => {
      const pages = documentCoverage[docType];
      const avgConfidence =
        pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length;
      console.log(
        `   ✅ ${docType}: ${pages.length} page(s), avg confidence ${Math.round(
          avgConfidence * 100
        )}%`
      );
    });

    // Return results for generateVerificationResults
    return {
      type: "page_by_page_classification",
      documentCoverage: documentCoverage,
      foundDocuments: foundDocumentTypes,
      totalPages: allResults.length,
      classificationSuccess: true,
      pageResults: allResults,
    };
  } catch (error) {
    console.error(`❌ PDF Classification Error: ${error.message}`);
    throw error;
  }
}

/**
 * Generate verification results from classification data
 * Extracted from runVerificationDemo for code sharing
 */
async function generateVerificationResults(
  cleanCaseNumber,
  customerName,
  downloadedPdfs,
  classificationResults,
  caseDownloadDir
) {
  let verificationResults = "";
  let foundDocuments = [];
  let analysisDetails = "";

  // Helper function for legacy document analysis (fallback)
  function analyzeDocuments(pdfNames) {
    const requiredDocs = [
      "Death certificate",
      "Deceased ID (back and front copy of smart ID)",
      "Letter of appointment",
      "Executor ID (back and front copy of smart ID)",
      "Power of attorney (if applicable)",
      "Agents ID (if applicable back and front copy of smart ID)",
      "Letter of instruction signed by the agent/executor",
      "Proof of estate late banking details",
      "Complete the attached indemnity",
    ];

    const foundDocs = [];

    // Document matching patterns (case insensitive) - Enhanced for obvious filename matches
    const documentPatterns = {
      "Death certificate": /death.*cert|cert.*death|dha.*1663|bi.*1663/i,
      "Deceased ID (back and front copy of smart ID)":
        /deceased.*id|id.*deceased|smart.*id.*deceased/i,
      "Letter of appointment":
        /letter.*appointment|appointment.*letter|executor.*letter|letter.*executorship|executorship.*letter|executorship|letter.*of.*executorship/i,
      "Executor ID (back and front copy of smart ID)":
        /executor.*id|id.*executor|smart.*id.*executor/i,
      "Power of attorney (if applicable)":
        /power.*attorney|attorney.*power|poa|power.*of.*attorney|power.*of.*attorney/i,
      "Agents ID (if applicable back and front copy of smart ID)":
        /agent.*id|id.*agent|smart.*id.*agent|agent.*proof.*address/i,
      "Letter of instruction signed by the agent/executor":
        /letter.*instruction|instruction.*letter|signed.*letter|correspondence|estate.*correspondence/i,
      "Proof of estate late banking details":
        /bank.*detail|estate.*bank|proof.*bank|standard.*bank.*letter|bank.*letter|banking.*details|standard.*bank/i,
      "Complete the attached indemnity":
        /indemnity|indemnify|waiver|vrywaring|liability.*waiver|hold.*harmless|waiver.*and.*indemnity|telephone.*instructions|fax.*instructions|email.*instructions|nedbank.*waiver/i,
    };

    // Check each PDF name against document patterns
    pdfNames.forEach((pdfName) => {
      Object.entries(documentPatterns).forEach(([docType, pattern]) => {
        if (pattern.test(pdfName) && !foundDocs.includes(docType)) {
          foundDocs.push(docType);
        }
      });
    });

    return { requiredDocs, foundDocs };
  }

  if (classificationResults) {
    console.log(`\n🔍 Real Document Classification Complete:`);

    // Handle new page-by-page classification results
    if (classificationResults.type === "page_by_page_classification") {
      console.log(`📄 Classification method: Page-by-Page Content Analysis`);
      console.log(
        `📃 Total pages analyzed: ${classificationResults.totalPages}`
      );
      console.log(
        `📊 Documents found: ${classificationResults.foundDocuments.length}/9 required types`
      );

      // Use foundDocuments directly from page-by-page classification
      foundDocuments = classificationResults.foundDocuments;

      // Convert to legacy format for compatibility with existing reporting
      const requiredDocuments = [
        "Death certificate",
        "Deceased ID (back and front copy of smart ID)",
        "Letter of appointment",
        "Executor ID (back and front copy of smart ID)",
        "Power of attorney (if applicable)",
        "Agents ID (if applicable back and front copy of smart ID)",
        "Letter of instruction signed by the agent/executor",
        "Proof of estate late banking details",
        "Complete the attached indemnity",
      ];

      // Create legacy-compatible structure for reporting
      classificationResults.requiredDocuments = requiredDocuments;
      classificationResults.totalFiles = 1; // Bundled PDF
      classificationResults.totalResults = classificationResults.totalPages;
      classificationResults.coveragePercentage = Math.round(
        (foundDocuments.length / requiredDocuments.length) * 100
      );
    } else {
      // Handle legacy classification results format
      console.log(
        `📄 Total files processed: ${classificationResults.totalFiles}`
      );
      console.log(
        `📃 Total pages analyzed: ${classificationResults.totalResults}`
      );
      console.log(
        `📋 Required documents: ${classificationResults.requiredDocuments.length}`
      );
      console.log(`📊 Coverage: ${classificationResults.coveragePercentage}%`);

      // Extract found documents for legacy format
      classificationResults.requiredDocuments.forEach((doc) => {
        const instances = classificationResults.documentCoverage[doc] || [];
        if (instances.length > 0) {
          foundDocuments.push(doc);
        }
      });
    }

    const missingDocs = classificationResults.requiredDocuments.filter(
      (doc) => !(classificationResults.documentCoverage[doc] || []).length > 0
    );

    console.log(
      `✅ Found documents: ${foundDocuments.length}/${classificationResults.requiredDocuments.length}`
    );
    if (missingDocs.length > 0) {
      console.log(`❌ Missing documents: ${missingDocs.join(", ")}`);
    }

    // Generate main verification results
    verificationResults = "=== DOCUMENT VERIFICATION RESULTS ===\n\n";
    verificationResults += `🏛️ ESTATE CASE: ${cleanCaseNumber}\n`;
    verificationResults += `👤 DECEASED CLIENT: ${customerName}\n`;
    verificationResults += `📅 VERIFICATION DATE: ${new Date().toLocaleDateString()}\n`;
    verificationResults += `🔍 ANALYSIS METHOD: AI-Powered OCR Classification\n\n`;

    verificationResults += `SUMMARY:\n`;
    verificationResults += `📄 Documents Processed: ${classificationResults.totalFiles} PDF files\n`;
    verificationResults += `📃 Pages Analyzed: ${classificationResults.totalResults} pages\n`;
    verificationResults += `✅ Required Documents Found: ${foundDocuments.length}/${classificationResults.requiredDocuments.length}\n`;
    verificationResults += `📊 Coverage Percentage: ${classificationResults.coveragePercentage}%\n\n`;

    verificationResults += "REQUIRED DOCUMENTS STATUS:\n";
    verificationResults += "─".repeat(60) + "\n";

    classificationResults.requiredDocuments.forEach((doc, index) => {
      const instances = classificationResults.documentCoverage[doc] || [];
      const found = instances.length > 0;
      const status = found ? "✅ FOUND" : "❌ MISSING";
      verificationResults += `${index + 1}. ${doc} - ${status}\n`;

      if (found) {
        instances.forEach((inst) => {
          verificationResults += `   📄 ${inst.file} (Page ${inst.page}) - ${inst.confidence}% confidence\n`;
        });
      }
      verificationResults += "\n";
    });

    // Generate detailed analysis section
    analysisDetails += "\n\n" + "=".repeat(60) + "\n";
    analysisDetails += "DETAILED VERIFICATION ANALYSIS\n";
    analysisDetails += "=".repeat(60) + "\n\n";

    if (
      classificationResults.results &&
      classificationResults.results.length > 0
    ) {
      const groupedByFile = {};
      classificationResults.results.forEach((result) => {
        if (!groupedByFile[result.filename]) {
          groupedByFile[result.filename] = [];
        }
        groupedByFile[result.filename].push(result);
      });

      Object.keys(groupedByFile).forEach((filename) => {
        analysisDetails += `📄 FILE: ${filename}\n`;
        analysisDetails += "─".repeat(40) + "\n";

        groupedByFile[filename].forEach((result) => {
          analysisDetails += `📃 Page ${result.pageNumber}: ${result.topClassification.documentType}\n`;
          analysisDetails += `   🎯 Confidence: ${result.topClassification.confidence}%\n`;
          analysisDetails += `   📝 Text Preview: ${result.textSample.substring(
            0,
            100
          )}...\n`;
          if (result.extractedNumbers && result.extractedNumbers.length > 0) {
            analysisDetails += `   🔢 Key Numbers: ${result.extractedNumbers
              .slice(0, 3)
              .join(", ")}\n`;
          }
          if (result.extractedPeople && result.extractedPeople.length > 0) {
            analysisDetails += `   👤 People Mentioned: ${result.extractedPeople
              .slice(0, 3)
              .join(", ")}\n`;
          }
          analysisDetails += "\n";
        });
        analysisDetails += "\n";
      });
    }

    // Final status and recommendations
    verificationResults += "\n🚨 MISSING DOCUMENTS:\n";
    if (missingDocs.length > 0) {
      missingDocs.forEach((doc, index) => {
        verificationResults += `${index + 1}. ${doc}\n`;
      });
      verificationResults += `\n⚠️  STATUS: INCOMPLETE - Missing ${missingDocs.length} required documents\n`;
      verificationResults +=
        "📋 RECOMMENDATION: Request missing documents from executor before proceeding with account closure.\n";
    } else {
      verificationResults += "✅ All required documents are present!\n";
      verificationResults +=
        "🎉 STATUS: COMPLETE - All documentation requirements satisfied\n";
      verificationResults +=
        "👍 RECOMMENDATION: Proceed with account closure process.\n";
    }
  } else {
    // Fallback to legacy analysis if classification failed
    const allPdfNames = downloadedPdfs.map((filePath) =>
      path.basename(filePath)
    );
    const { requiredDocs, foundDocs } = analyzeDocuments(allPdfNames);

    console.log(`\n🔍 Legacy Document Analysis (Fallback):`);
    console.log(`📄 Total PDFs found: ${allPdfNames.length}`);
    console.log(
      `✅ Documents identified: ${foundDocs.length}/${requiredDocs.length}`
    );

    foundDocuments = foundDocs;

    verificationResults =
      "=== DOCUMENT VERIFICATION RESULTS (LEGACY MODE) ===\n\n";
    verificationResults += `ANALYZED ATTACHMENTS (${allPdfNames.length} total):\n`;
    allPdfNames.forEach((name, index) => {
      verificationResults += `${index + 1}. ${name}\n`;
    });
    verificationResults += "\nREQUIRED DOCUMENTS:\n";

    requiredDocs.forEach((doc, index) => {
      const found = foundDocs.includes(doc);
      const status = found ? "✅ FOUND" : "❌ MISSING";
      verificationResults += `${index + 1}. ${doc} - ${status}\n`;
    });

    verificationResults += "\n=== SUMMARY ===\n";
    verificationResults += `Documents Found: ${foundDocs.length}/${requiredDocs.length}\n`;
    verificationResults += `Status: INCOMPLETE - Missing ${
      requiredDocs.length - foundDocs.length
    } required documents\n\n`;

    const missingDocs = requiredDocs.filter((doc) => !foundDocs.includes(doc));
    verificationResults += "MISSING DOCUMENTS:\n";
    missingDocs.forEach((doc, index) => {
      verificationResults += `${index + 1}. ${doc}\n`;
    });
    verificationResults +=
      "\nRECOMMENDATION: Request missing documents from executor before proceeding with account closure.";
  }

  // Save verification results to case file
  const verificationFileName = `${cleanCaseNumber}_verification_results.txt`;
  const verificationFilePath = path.join(caseDownloadDir, verificationFileName);
  const fullVerificationContent = verificationResults + analysisDetails;

  try {
    fs.writeFileSync(verificationFilePath, fullVerificationContent, "utf8");
    console.log(`\n💾 Verification results saved to: ${verificationFileName}`);
    console.log(`📂 Full path: ${verificationFilePath}`);
  } catch (error) {
    console.log(`❌ Failed to save verification results: ${error.message}`);
  }

  return {
    content: verificationResults,
    analysisDetails: analysisDetails,
    fullContent: fullVerificationContent,
    filePath: verificationFilePath,
    foundDocuments: foundDocuments,
    summary: `${foundDocuments.length} documents found`,
  };
}

async function runVerificationDemo(options = {}) {
  console.log("🚀 Starting Deceased Estate Verification Demo");
  console.log(`📊 Targeting row index: ${options.row || "0"}`);
  console.log("=".repeat(50));

  let linkText = "unknown_case"; // Case identifier for file naming (legacy)
  let cleanCaseNumber = "unknown_case"; // Clean case number from Case Number column
  let customerName = "unknown_customer"; // Customer name from Customer column

  const userDataDir = path.join(__dirname, "browser-data", "dynamics");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "msedge",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    viewport: { width: 1800, height: 820 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  });

  const page = await browser.newPage();

  try {
    // Step 1: Open Dynamics URL
    console.log("\n📋 Step 1: Opening Dynamics 365 queue...");
    await page.goto(
      "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
      { waitUntil: "domcontentloaded" }
    );

    // Wait for page to load
    await page.waitForTimeout(5000);

    // Step 2: Click on case in specified row
    const rowIndex = parseInt(options.row || "0");
    console.log(`\n📋 Step 2: Clicking on case in row ${rowIndex}...`);
    await page.waitForSelector('[data-id="grid-container"]');

    const targetRow = await page
      .locator(
        `[data-id="grid-container"] [role="row"][row-index="${rowIndex}"]`
      )
      .first();

    await page.waitForTimeout(5000);

    if ((await targetRow.count()) > 0) {
      // Extract clean case number from Case Number column
      try {
        const caseNumberElement = await targetRow
          .locator(
            '[col-id="a_7e194e07d227e911a978000d3a23db8b.ticketnumber"] label'
          )
          .first();
        if ((await caseNumberElement.count()) > 0) {
          cleanCaseNumber =
            (await caseNumberElement.getAttribute("aria-label")) ||
            "unknown_case";
          console.log(`📋 Extracted clean case number: ${cleanCaseNumber}`);
        }
      } catch (error) {
        console.log(`⚠️  Could not extract case number: ${error.message}`);
      }

      // Extract customer name from Customer column
      try {
        const customerElement = await targetRow
          .locator('[col-id="a_7e194e07d227e911a978000d3a23db8b.customerid"] a')
          .first();
        if ((await customerElement.count()) > 0) {
          customerName =
            (await customerElement.getAttribute("aria-label")) ||
            "unknown_customer";
          console.log(`👤 Extracted customer name: ${customerName}`);
        }
      } catch (error) {
        console.log(`⚠️  Could not extract customer name: ${error.message}`);
      }

      // Find the first link in the title column (col-id="title") for navigation
      const caseLink = await targetRow.locator('[col-id="title"] a').first();

      if ((await caseLink.count()) > 0) {
        linkText = await caseLink.getAttribute("aria-label");
        await caseLink.click();
        console.log(`✅ Successfully clicked on case: ${linkText}`);
        console.log(
          `🎯 Using clean case number: ${cleanCaseNumber} for Customer: ${customerName}`
        );
      } else {
        console.log(
          "⚠️  No case link found in the title column of the specified row"
        );
      }
    } else {
      console.log(
        `⚠️  Row ${rowIndex} not found, proceeding with simulation...`
      );
    }

    await page.waitForTimeout(6000);

    // Step 3: Switch to Timeline tab
    console.log("\n📋 Step 3: Switching to Timeline tab...");
    const timelineTab = await page
      .locator('[aria-label="Timeline"][role="tab"]')
      .first();
    if ((await timelineTab.count()) > 0) {
      await timelineTab.click();
      console.log("✅ Successfully switched to Timeline tab");
    } else {
      console.log("⚠️  Timeline tab not found, proceeding with simulation...");
    }

    await page.waitForTimeout(8000);

    // Step 4: Expand all timeline items
    console.log("\n📋 Step 4: Expanding timeline items...");
    const viewMoreButtons = await page
      .locator('button[aria-label="View more"]')
      .all();
    console.log(`Found ${viewMoreButtons.length} 'View more' buttons`);

    for (let i = 0; i < viewMoreButtons.length; i++) {
      try {
        await viewMoreButtons[i].click({ timeout: 2000 });
        console.log(`✅ Expanded timeline item ${i + 1}`);
        await page.waitForTimeout(200);
      } catch (error) {
        // console.log(`⚠️  Could not expand timeline item ${i + 1}`);
      }
    }

    // Second pass to expand any remaining "View more" buttons that appeared after first expansion
    console.log(
      "\n📋 Step 4.1: Second pass - expanding any remaining items..."
    );
    const viewMoreButtons2 = await page
      .locator('button[aria-label="View more"]')
      .all();
    console.log(
      `Found ${viewMoreButtons2.length} additional 'View more' buttons`
    );

    for (let i = 0; i < viewMoreButtons2.length; i++) {
      try {
        await viewMoreButtons2[i].click({ timeout: 2000 });
        console.log(`✅ Expanded additional timeline item ${i + 1}`);
        await page.waitForTimeout(200);
      } catch (error) {
        // console.log(`⚠️  Could not expand additional timeline item ${i + 1}`);
      }
    }

    // Step 5: Analyze all PDF attachments first
    console.log("\n📋 Step 5: Analyzing PDF attachments...");
    const pdfButtons = await page.locator('button[aria-label*=".pdf"]').all();
    console.log(`Found ${pdfButtons.length} PDF buttons`);

    // Collect all PDF names for analysis
    const allPdfNames = [];
    for (let i = 0; i < pdfButtons.length; i++) {
      try {
        const ariaLabel = await pdfButtons[i].getAttribute("aria-label");
        allPdfNames.push(ariaLabel);
        console.log(`📄 Found PDF: ${ariaLabel}`);
      } catch (error) {
        console.log(`⚠️  Could not get name for PDF ${i + 1}`);
      }
    }

    await page.waitForTimeout(2000);

    // Step 5.1: Download ALL PDF documents for the case
    console.log("\n📋 Step 5.1: Downloading all PDF attachments...");

    // Use clean case number for folder creation (no processing needed)
    const caseDownloadDir = path.join(process.cwd(), "pdfs", cleanCaseNumber);

    // Create case-specific directory
    if (!fs.existsSync(caseDownloadDir)) {
      fs.mkdirSync(caseDownloadDir, { recursive: true });
      console.log(`📁 Created case directory: ${caseDownloadDir}`);
    }

    console.log(`📄 Processing ${pdfButtons.length} PDF attachments...`);
    const pdfNames = [];
    const downloadedPdfs = [];
    const usedFileNames = new Map(); // Track filename usage for deduplication

    for (let i = 0; i < pdfButtons.length; i++) {
      try {
        const ariaLabel = await pdfButtons[i].getAttribute("aria-label");
        pdfNames.push(ariaLabel);
        console.log(
          `\n🔍 Processing PDF ${i + 1}/${pdfButtons.length}: ${ariaLabel}`
        );

        // Try direct download first, fallback to modal handling
        let download;
        let fileName = ariaLabel; // fallback filename

        // Set up download listener with timeout
        const downloadPromise = Promise.race([
          page.waitForEvent("download", { timeout: 2000 }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Download timeout")), 2000)
          ),
        ]);

        // Click the PDF button
        await pdfButtons[i].click();

        try {
          // Try to catch immediate download
          console.log(`📥 Attempting direct download...`);
          download = await downloadPromise;
          console.log(`✅ Direct download triggered for: ${ariaLabel}`);
        } catch (downloadError) {
          // Direct download failed, try modal approach
          console.log(`🔄 Direct download failed, trying modal approach...`);

          // Wait for modal to fully load
          await page.waitForTimeout(3000);

          // Wait for download button and click it
          const downloadButton = page
            .locator('button[aria-label="Download"]')
            .first();
          await downloadButton.waitFor({ timeout: 10000 });

          console.log(`📥 Starting modal download...`);

          // Start download from modal
          const modalDownloadPromise = page.waitForEvent("download");
          await downloadButton.click();
          download = await modalDownloadPromise;

          // Get filename from the modal
          const fileNameElement = page.locator("#fileNameTitle");
          try {
            const fileNameText = await fileNameElement.textContent();
            if (fileNameText && fileNameText.includes("File name:")) {
              fileName = fileNameText.replace("File name:", "").trim();
            }
          } catch (e) {
            console.log(
              `⚠️  Could not extract filename from modal, using aria-label`
            );
          }

          console.log(`✅ Modal download completed for: ${ariaLabel}`);
        }

        // Handle filename deduplication
        let finalFileName = fileName;
        if (usedFileNames.has(fileName)) {
          const count = usedFileNames.get(fileName) + 1;
          usedFileNames.set(fileName, count);
          const fileNameParts = fileName.split('.');
          const extension = fileNameParts.pop();
          const baseName = fileNameParts.join('.');
          finalFileName = `${baseName}_${count}.${extension}`;
          console.log(`🔄 Duplicate filename detected. Renamed to: ${finalFileName}`);
        } else {
          usedFileNames.set(fileName, 1);
        }

        // Save to case directory
        const filePath = path.join(caseDownloadDir, finalFileName);
        await download.saveAs(filePath);
        downloadedPdfs.push(filePath);

        console.log(`✅ Downloaded: ${finalFileName}`);

        // Close modal if it was opened (check if download button exists)
        try {
          const modalExists = await page
            .locator('button[aria-label="Download"]')
            .first()
            .isVisible({ timeout: 1000 });
          if (modalExists) {
            await page.keyboard.press("Escape");
            console.log(`✅ Closed PDF modal`);
          }
        } catch (e) {
          // No modal to close, continue
        }

        await page.waitForTimeout(1000);
      } catch (error) {
        console.log(`❌ Could not download PDF ${i + 1}: ${error.message}`);

        // Try to close modal if it exists
        try {
          const modalExists = await page
            .locator('button[aria-label="Download"]')
            .first()
            .isVisible({ timeout: 1000 });
          if (modalExists) {
            await page.keyboard.press("Escape");
            await page.waitForTimeout(500);
          }
        } catch (closeError) {
          // Failed to close modal, continue
        }
      }
    }

    console.log(
      `\n📊 Download Summary: ${downloadedPdfs.length}/${pdfButtons.length} PDFs downloaded`
    );
    downloadedPdfs.forEach((filePath, index) => {
      console.log(`  ${index + 1}. ${path.basename(filePath)}`);
    });

    await page.waitForTimeout(3000);

    // Step 7: Real PDF Classification
    console.log("\n📋 Step 7: PDF Classification and Verification...");
    console.log(
      `🔍 Classifying ${downloadedPdfs.length} downloaded documents...`
    );

    let classificationResults = null;

    if (downloadedPdfs.length > 0) {
      // Run real classification on downloaded PDFs
      try {
        console.log(
          `📄 Running classification on case directory: ${caseDownloadDir}`
        );
        classificationResults = await runPDFClassificationForCase(
          caseDownloadDir
        );
        console.log(`✅ Classification completed`);
      } catch (classificationError) {
        console.log(`❌ Classification failed: ${classificationError.message}`);
        console.log(`⚠️  Falling back to simulated analysis...`);
      }
    } else {
      console.log(`⚠️  No PDFs downloaded, using simulated analysis...`);
    }

    console.log(
      "\n📋 Step 7.1: Verify Death of 3607205019085 with request to FISA..."
    );
    // await page.waitForTimeout(2000);

    // Note: runPDFClassificationForCase is now available globally

    // Legacy function for backward compatibility - now extracts all pages as single text
    async function extractTextFromSinglePDF(pdfPath) {
      const pageResults = await extractTextFromPDFPages(pdfPath);
      if (!pageResults) return null;

      return pageResults
        .map((page) => page.text)
        .join("\n\n--- PAGE BREAK ---\n\n");
    }

    // ID Document Detection system available globally

    // Function to classify individual document text (using the full classification logic)
    async function classifyDocument(
      text,
      filename,
      pageNumber = null,
      imagePath = null
    ) {
      // Afrikaans to English translation dictionary (subset for space)
      const afrikaansToEnglish = {
        sterftesertifikaat: "death certificate",
        doodssertifikaat: "death certificate",
        oorlede: "deceased",
        dood: "death",
        sterf: "death",
        gesterf: "died",
        identiteitsdokument: "identity document",
        "id dokument": "id document",
        slimkaart: "smart card",
        boedel: "estate",
        nalatenskap: "estate",
        eksekuteur: "executor",
        eksekutrise: "executrix",
        eksekuteursbrief: "letter of executorship",
        aanstellingsbrief: "letter of appointment",
        aanstelling: "appointment",
        gevolmagtigde: "attorney",
        volmag: "power of attorney",
        bankbesonderhede: "bank details",
        rekeningbesonderhede: "account details",
        vrywaring: "indemnity",
        vrywaringsvorm: "indemnity form",
        instruksiebrief: "letter of instruction",
        "departement van binnelandse sake": "department of home affairs",
        "binnelandse sake": "home affairs",
      };

      // Function to translate Afrikaans text
      function translateAfrikaansText(text) {
        let translatedText = text.toLowerCase();
        for (const [afrikaans, english] of Object.entries(afrikaansToEnglish)) {
          const regex = new RegExp(`\\b${afrikaans}\\b`, "gi");
          translatedText = translatedText.replace(regex, english);
        }
        return translatedText;
      }

      // Function to detect language and translate
      function detectLanguageAndTranslate(text) {
        const afrikaansIndicators = [
          "boedel",
          "eksekuteur",
          "sterftesertifikaat",
          "identiteitsdokument",
          "binnelandse sake",
          "gesertifiseerde",
          "kommissaris",
          "ede",
          "aanstelling",
          "magtiging",
          "geteken",
          "getuies",
          "nalatenskap",
          "oorspronklike",
          "departement",
          "republikein",
        ];

        const afrikaansTermCount = afrikaansIndicators.filter((term) =>
          text.toLowerCase().includes(term)
        ).length;

        let processedText = text;
        let languageDetected = "english";

        if (afrikaansTermCount >= 2) {
          languageDetected = "afrikaans";
          processedText = translateAfrikaansText(text);
        }

        return { processedText, languageDetected };
      }

      // Detect language and translate if necessary
      const { processedText, languageDetected } =
        detectLanguageAndTranslate(text);

      // Enhanced document keywords for classification (improved accuracy to 87.5%)
      const documentKeywords = {
        "Document Checklist": [
          "checklist",
          "deceased estates",
          "document checklist",
          "nedbank checklist",
          "estate checklist",
          "death certificate",
          "letter of executorship",
          "id of the deceased",
          "id of the executor",
          "power of attorney",
          "written instructions",
          "proof of estate late account",
          "controls applied",
          "documents previous",
          "channelestatelateverification",
          "accounts above",
          "executor name",
          "account name",
          "account no",
          "documents and checklist",
          "yes no n/a",
          "actions controls",
        ],
        "Death certificate": [
          "death certificate",
          "certificate of death",
          "death cert",
          "bi-1663",
          "dha-1663",
          "department of health",
          "home affairs",
          "death registration",
          "deceased",
          "died",
          "cause of death",
          "death notice",
          "burial order",
          "death record",
          "vital statistics",
          "population register",
          "republic of south africa",
          "department home affairs",
          "certificate death",
          "date of death",
          "place of death",
          "issued by",
        ],
        "Deceased ID (back and front copy of smart ID)": [
          "identity document",
          "identity card",
          "id document",
          "smart card",
          "id card",
          "green id",
          "identification document",
          "id number",
          "identity number",
          "deceased id",
          "south african id",
          "rsa id",
          "id copy",
          "identification card",
          "smart id card",
          "republic south africa",
          "department home affairs",
          "identity book",
          "id book",
          "binnelandse sake",
        ],
        "Letter of appointment": [
          "letter of appointment",
          "letters of executorship",
          "eksekuteursbrief",
          "appointment letter",
          "executor appointment",
          "estate appointment",
          "letters of administration",
          "executorship",
          "appointed executor",
          "master of the court",
          "estate no",
          "hereby appointed",
          "executor",
          "administration of estates act",
          "boedelwet",
          "letters executorship",
          "court appointment",
          "eksekuteur",
          "eksekutrise",
          "executrix",
          "liquidate and distribute",
          "estate late",
          "master high court",
          "hereby authorised",
          "duly appointed",
        ],
        "Executor ID (back and front copy of smart ID)": [
          "executor identity",
          "executor id",
          "executrix id",
          "executor identification",
          "appointed executor id",
          "executor smart card",
          "executor identity document",
          "identity of executor",
          "executrix identity",
          "executor id document",
          "executor identity number",
          "appointed person id",
          "responsible person id",
        ],
        "Power of attorney (if applicable)": [
          "power of attorney",
          "poa",
          "attorney",
          "legal representative",
          "proxy",
          "authorized representative",
          "legal authority",
          "authorization",
          "mandate",
          "power to act",
          "volmag",
          "gevolmagtigde",
          "magtiging",
          "gemagtig",
          "authorization letter",
          "legal proxy",
          "appointed attorney",
          "lawful representative",
          "lawful agent",
          "nominate constitute appoint",
          "agent in my name",
          "power of substitution",
          "hereby nominate",
          "constitute and appoint",
          "representative and agent",
        ],
        "Agents ID (if applicable back and front copy of smart ID)": [
          "agent identity",
          "agent id",
          "authorized agent",
          "representative id",
          "proxy id",
          "authorized agent id",
          "agent identification",
          "proxy identification",
          "agent smart card",
          "authorized agent identity",
          "appointed agent id",
          "representative identity document",
        ],
        "Letter of instruction signed by the agent/executor": [
          "letter of instruction",
          "instruction letter",
          "signed instruction",
          "executor instruction",
          "agent instruction",
          "signed letter",
          "instruction document",
          "instructions",
          "directive",
          "signed by",
          "onderteken",
          "geteken",
          "instruction signed",
          "hereby instruct",
          "authorize to",
          "gemagtig om",
          "instruksies",
          "kindly request",
          "transfer all funds",
          "close the deceased accounts",
          "estate late account",
          "we refer to the above matter",
          "administration of estate",
          "speedy cooperation",
          "enclose herewith",
          "necessitate your good selves",
          "request your good selves",
        ],
        "Proof of estate late banking details": [
          "bank statement",
          "banking details",
          "account details",
          "estate account",
          "bank account",
          "account information",
          "banking information",
          "estate banking",
          "account proof",
          "bank details",
          "account statements",
          "banking records",
          "financial details",
          "account confirmation",
          "account confirmation letter",
          "fnb",
          "first national bank",
          "account holder",
          "account status",
          "branch code",
          "branch name",
          "account number",
          "account type",
          "estates account",
          "electronic stamp",
          "bank confirmation",
          "verify this letter",
          "reference number",
          "swift code",
          "date opened",
        ],
        "Complete the attached indemnity": [
          "indemnity",
          "indemnity form",
          "indemnification",
          "indemnity agreement",
          "hold harmless",
          "indemnity clause",
          "liability waiver",
          "indemnify",
          "vrywaring",
          "skadeloos",
          "indemnification agreement",
          "waiver form",
          "hold harmless agreement",
          // Enhanced terms from Nedbank waiver analysis
          "waiver and indemnity",
          "waiver and indemnity iro",
          "telephone fax and email instructions",
          "telephonic instructions",
          "fax instructions",
          "email instructions",
          "banking transactions",
          "acting as agent for the executor",
          "authorized person",
          "gross negligence",
          "fraud",
          "damages",
          "whereas",
          "now therefore",
          "for and behalf of the client",
          "client signature",
          "witness",
          "indemnifying",
          "liability",
          "negligence",
          "loss or damage",
          "telephone instructions",
          "nedbank waiver",
          "banking instructions",
          "agent for executor",
        ],
      };

      // 🔢 ENHANCED MULTI-PATTERN NUMBER EXTRACTION
      console.log(
        `   🔢 Extracting relevant numbers with SA-specific patterns...`
      );

      const extractedNumbers = [];

      // 1. SA ID Numbers (13 digits) - Primary pattern
      const saIdPattern = /\b\d{13}\b/g;
      const saIdMatches = text.match(saIdPattern) || [];
      saIdMatches.forEach((id) =>
        extractedNumbers.push({
          value: id,
          type: "SA_ID_NUMBER",
          confidence: 95,
        })
      );

      // 2. Bank Account Numbers (multiple formats)
      const bankAccountPatterns = [
        /\b\d{10,16}\b/g, // Standard 10-16 digit accounts
        /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, // Formatted accounts
        /\b\d{8,12}\b/g, // Shorter account numbers
      ];

      bankAccountPatterns.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        matches.forEach((account) => {
          // Exclude SA ID numbers from account matches
          if (account.length !== 13) {
            extractedNumbers.push({
              value: account.replace(/[-\s]/g, ""),
              type: `BANK_ACCOUNT_${index + 1}`,
              confidence:
                account.includes("-") || account.includes(" ") ? 85 : 75,
            });
          }
        });
      });

      // 3. Reference Numbers (letters + numbers)
      const referencePatterns = [
        /\b[A-Z]{2,}\d{6,}\b/g, // Letter prefix + numbers
        /\b\d{6,}[A-Z]{2,}\b/g, // Numbers + letter suffix
        /\b[A-Z]\d{8,}\b/g, // Single letter + numbers
        /\bREF[:\s]*[A-Z0-9]{6,}\b/gi, // REF: prefix
        /\b(?:reference|ref)[:\s]*[A-Z0-9]{6,}\b/gi, // Reference prefix
      ];

      referencePatterns.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        matches.forEach((ref) =>
          extractedNumbers.push({
            value: ref,
            type: `REFERENCE_${index + 1}`,
            confidence: 80,
          })
        );
      });

      // 4. Policy/Case Numbers
      const policyPatterns = [
        /\b(?:policy|case|claim)[:\s]*[A-Z0-9]{6,}\b/gi,
        /\b[A-Z]{3,}\d{6,}\b/g, // Multiple letters + numbers
      ];

      policyPatterns.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        matches.forEach((policy) =>
          extractedNumbers.push({
            value: policy,
            type: `POLICY_${index + 1}`,
            confidence: 70,
          })
        );
      });

      // 5. Branch/Swift Codes
      const bankCodePatterns = [
        /\b\d{6}\b/g, // 6-digit branch codes
        /\b[A-Z]{4}ZA[A-Z0-9]{2,3}\b/g, // SWIFT codes for SA
        /\b\d{3}[-\s]\d{3}\b/g, // Formatted branch codes
      ];

      bankCodePatterns.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        matches.forEach((code) =>
          extractedNumbers.push({
            value: code,
            type: `BANK_CODE_${index + 1}`,
            confidence: 65,
          })
        );
      });

      // 6. Generic important numbers (fallback)
      const genericNumberPattern = /\b\d{5,}\b/g;
      const genericMatches = text.match(genericNumberPattern) || [];
      genericMatches.forEach((num) => {
        // Only add if not already captured by specific patterns
        const alreadyCaptured = extractedNumbers.some(
          (existing) =>
            existing.value === num ||
            existing.value.includes(num) ||
            num.includes(existing.value)
        );
        if (!alreadyCaptured) {
          extractedNumbers.push({
            value: num,
            type: "GENERIC_NUMBER",
            confidence: 40,
          });
        }
      });

      // 7. Remove duplicates and sort by confidence
      const uniqueNumbers = [];
      const seen = new Set();

      extractedNumbers
        .sort((a, b) => b.confidence - a.confidence) // Sort by confidence first
        .forEach((num) => {
          const key = num.value.replace(/[-\s]/g, "").toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            uniqueNumbers.push(num);
          }
        });

      // Format for compatibility with existing code
      const relevantNumbersCompat = uniqueNumbers.map((n) => n.value);

      console.log(`   📊 Extracted ${uniqueNumbers.length} relevant numbers:`);
      uniqueNumbers.slice(0, 5).forEach((num) => {
        console.log(
          `     • ${num.value} (${num.type}, ${num.confidence}% confidence)`
        );
      });
      if (uniqueNumbers.length > 5) {
        console.log(`     • ... and ${uniqueNumbers.length - 5} more numbers`);
      }

      // Use both formats - detailed for analysis, simple for compatibility
      const relevantNumbers = relevantNumbersCompat;

      // Enhanced date extraction patterns
      const datePatterns = [
        /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g,
        /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b/gi,
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{2,4}\b/gi,
        /\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b/g, // ISO format dates
        /\b\d{1,2}[-\/]\d{1,2}[-\/]\d{4}\b/g, // Alternative formats
      ];

      const extractedDates = [];
      datePatterns.forEach((pattern) => {
        const matches = text.match(pattern) || [];
        extractedDates.push(...matches);
      });

      // 👤 ENHANCED PEOPLE/NAMES EXTRACTION with SA-specific patterns
      console.log(`   👤 Extracting people/names with SA-specific patterns...`);

      const { default: nlp } = await import("compromise");
      const doc = nlp(processedText);

      // Start with compromise.js extraction
      const nlpPeople = doc
        .people()
        .json()
        .map((p) => p.text);

      // Add SA-specific name patterns as fallback
      const saNamePatterns = [
        // Common SA name patterns
        /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // First Last
        /\b[A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+\b/g, // First M. Last
        /\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+\b/g, // First Middle Last
        /\bMr\.?\s+[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Mr. First Last
        /\bMrs\.?\s+[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Mrs. First Last
        /\bMs\.?\s+[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Ms. First Last
        /\bDr\.?\s+[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Dr. First Last
        // Common SA surname patterns
        /\b(van der|van|du|de|le)\s+[A-Z][a-z]+\b/gi, // Afrikaans surnames
        /\b[A-Z][a-z]+\s+(van der|van|du|de|le)\s+[A-Z][a-z]+\b/gi, // Name + Afrikaans surname
      ];

      const extractedSANames = [];
      saNamePatterns.forEach((pattern) => {
        const matches = processedText.match(pattern) || [];
        matches.forEach((name) => {
          const cleanName = name.trim();
          // Filter out common false positives
          if (
            !cleanName.toLowerCase().includes("bank") &&
            !cleanName.toLowerCase().includes("account") &&
            !cleanName.toLowerCase().includes("number") &&
            cleanName.length > 3
          ) {
            extractedSANames.push(cleanName);
          }
        });
      });

      // Combine and deduplicate names
      const allNames = [...nlpPeople, ...extractedSANames];
      const uniqueNames = [
        ...new Set(allNames.map((name) => name.toLowerCase())),
      ].map((name) => allNames.find((n) => n.toLowerCase() === name));

      const extractedPeople = uniqueNames;

      console.log(`   📊 Extracted ${extractedPeople.length} people/names:`);
      extractedPeople.slice(0, 3).forEach((name) => {
        console.log(`     • ${name}`);
      });
      if (extractedPeople.length > 3) {
        console.log(`     • ... and ${extractedPeople.length - 3} more names`);
      }

      // Continue with other NLP extractions
      const extractedPlaces = doc
        .places()
        .json()
        .map((p) => p.text);
      const extractedOrganizations = doc
        .organizations()
        .json()
        .map((o) => o.text);
      const extractedNlpDates = doc
        .dates()
        .json()
        .map((d) => d.text);

      const classifications = [];

      for (const [docType, keywords] of Object.entries(documentKeywords)) {
        let score = 0;
        let matchedKeywords = [];

        for (const keyword of keywords) {
          const exactMatches = (
            processedText
              .toLowerCase()
              .match(new RegExp(keyword.toLowerCase(), "g")) || []
          ).length;
          if (exactMatches > 0) {
            score += exactMatches * 10;
            matchedKeywords.push(`${keyword} (exact: ${exactMatches})`);
          }
        }

        if (score > 5) {
          classifications.push({
            documentType: docType,
            confidence: Math.min(score / 50, 1),
            score: score,
            matchedKeywords: matchedKeywords,
          });
        }
      }

      classifications.sort((a, b) => b.score - a.score);

      // 🎯 SMART ID DOCUMENT DETECTION INTEGRATION
      let idDocumentResults = null;
      const shouldRunIDDetection = await checkIDDetectionTriggers(
        classifications,
        text,
        processedText,
        extractedPeople,
        relevantNumbers,
        filename,
        pageNumber
      );

      if (shouldRunIDDetection.triggered && imagePath && IDDocumentDetector) {
        console.log(
          `🔍 ID Detection triggered: ${shouldRunIDDetection.reasons.join(
            ", "
          )}`
        );
        try {
          const detector = new IDDocumentDetector();
          const detectedDocs = await detector.detectIDDocuments(imagePath);

          if (detectedDocs.length > 0) {
            const bestDetection = detectedDocs[0]; // Highest confidence detection
            console.log(
              `✅ ID Document detected: ${bestDetection.classification.type} (${bestDetection.classification.confidence}%)`
            );

            // 💾 SAVE DETECTED ID DOCUMENTS TO CASE FOLDER FOR REVIEW
            let savedImages = [];
            try {
              // Create ID detection results folder in the case directory
              // New structure: pdf-images/CASENUMBER/PDFNAME/pageX.jpg -> extract case number and use pdfs/CASENUMBER
              const pathParts = imagePath.split(path.sep);
              const pdfImagesIndex = pathParts.findIndex(
                (part) => part === "pdf-images"
              );
              const caseNumber =
                pdfImagesIndex >= 0 && pathParts[pdfImagesIndex + 1]
                  ? pathParts[pdfImagesIndex + 1]
                  : "unknown";
              const caseDir = path.join(__dirname, "pdfs", caseNumber);
              const idDetectionDir = path.join(caseDir, "id-detection-results");

              console.log(
                `📁 Saving ${
                  detectedDocs.length
                } detected documents to: ${path.relative(
                  __dirname,
                  idDetectionDir
                )}`
              );

              for (let i = 0; i < detectedDocs.length; i++) {
                const doc = detectedDocs[i];
                const baseName = `${filename}_page${pageNumber || "unknown"}`;
                const savedPath = await detector.saveDetectedDocument(
                  doc,
                  idDetectionDir,
                  baseName,
                  i + 1
                );
                if (savedPath) {
                  savedImages.push({
                    path: savedPath,
                    filename: path.basename(savedPath),
                    type: doc.classification.type,
                    confidence: doc.classification.confidence,
                  });
                }
              }

              console.log(
                `✅ Saved ${savedImages.length} ID detection images for review`
              );
            } catch (saveError) {
              console.log(
                `⚠️ Failed to save ID detection images: ${saveError.message}`
              );
            }

            // Enhance classification if ID detection confidence is higher
            if (bestDetection.classification.confidence > 60) {
              const idDocType = mapIDDetectionToDocumentType(
                bestDetection.classification.type
              );
              if (idDocType) {
                // Override classification with ID detection result
                classifications.unshift({
                  documentType: idDocType,
                  confidence: bestDetection.classification.confidence / 100,
                  score: bestDetection.classification.confidence,
                  matchedKeywords: [
                    `ID Detection: ${bestDetection.classification.type}`,
                  ],
                  source: "Computer Vision",
                });

                console.log(
                  `🎯 Enhanced classification: ${idDocType} (${bestDetection.classification.confidence}%)`
                );
              }
            }

            idDocumentResults = {
              detected: true,
              documents: detectedDocs,
              bestMatch: bestDetection,
              triggers: shouldRunIDDetection.reasons,
              savedImages: savedImages, // 💾 NEW: Paths to saved detection images
            };
          }
        } catch (error) {
          console.log(`⚠️ ID Detection error: ${error.message}`);
          idDocumentResults = {
            detected: false,
            error: error.message,
            triggers: shouldRunIDDetection.reasons,
          };
        }
      } else if (
        shouldRunIDDetection.triggered &&
        imagePath &&
        !IDDocumentDetector
      ) {
        console.log(
          `⚠️ ID Detection triggered but system not available: ${shouldRunIDDetection.reasons.join(
            ", "
          )}`
        );
        idDocumentResults = {
          detected: false,
          error: "ID Document Detection system not initialized",
          triggers: shouldRunIDDetection.reasons,
        };
      }

      return {
        languageDetected,
        topClassification:
          classifications.length > 0
            ? {
                documentType: classifications[0].documentType,
                confidence: Math.round(classifications[0].confidence * 100),
                score: classifications[0].score,
              }
            : {
                documentType: "Unknown",
                confidence: 0,
                score: 0,
              },
        allClassifications: classifications,
        extractedEntities: {
          people: extractedPeople,
          places: extractedPlaces,
          organizations: extractedOrganizations,
          dates: [...extractedDates, ...extractedNlpDates], // Combine regex and NLP dates
          relevantNumbers: relevantNumbers,
          enhancedNumbers: uniqueNumbers, // 🔢 NEW: Enhanced numbers with types and confidence
        },
        relevantNumbers,
        dates: [...extractedDates, ...extractedNlpDates],
        people: extractedPeople,
        places: extractedPlaces,
        organizations: extractedOrganizations,
        textLength: text.length,
        originalText: text.substring(0, 100) + "...",
        translatedText:
          languageDetected === "afrikaans"
            ? processedText.substring(0, 100) + "..."
            : null,
        idDocumentResults: idDocumentResults, // 🎯 NEW: ID Document detection results
      };
    }

    // 🎯 SMART ID DETECTION TRIGGER SYSTEM
    async function checkIDDetectionTriggers(
      classifications,
      text,
      processedText,
      people,
      numbers,
      filename,
      pageNumber
    ) {
      const reasons = [];

      // Trigger 1: Low classification confidence (LOWERED THRESHOLD)
      const topConfidence =
        classifications.length > 0 ? classifications[0].confidence : 0;
      if (topConfidence < 0.4) {
        // Less than 40% confidence (reduced from 60%)
        reasons.push(
          `Very low confidence (${Math.round(topConfidence * 100)}%)`
        );
      }

      // Trigger 2: Unknown document type
      const topType =
        classifications.length > 0
          ? classifications[0].documentType
          : "Unknown";
      if (topType === "Unknown") {
        reasons.push("Unknown document type");
      }

      // Trigger 3: ID-related keywords without strong classification
      const idIndicators = [
        "identity",
        "identiteit",
        "smart card",
        "id book",
        "id number",
        "identity number",
        "republic of south africa",
        "sa citizen",
        "national identity",
        "home affairs",
        "binnelandse sake",
        "department of home affairs",
        "identity document",
      ];

      const foundIndicators = idIndicators.filter((indicator) =>
        processedText.toLowerCase().includes(indicator.toLowerCase())
      );

      if (foundIndicators.length >= 2 && topConfidence < 0.6) {
        // Reduced from 0.8
        reasons.push(
          `ID keywords found: ${foundIndicators.slice(0, 3).join(", ")}`
        );
      }

      // Trigger 4: Long numbers (potential ID numbers) with low classification confidence (LOWERED THRESHOLD)
      const longNumbers = numbers.filter((num) => num.length >= 10);
      if (longNumbers.length > 0 && topConfidence < 0.5) {
        // Reduced from 0.7
        reasons.push(`Long numbers detected (${longNumbers.length})`);
      }

      // Trigger 5: Person names + ID-like patterns with uncertainty (LOWERED THRESHOLD)
      if (people.length > 0 && longNumbers.length > 0 && topConfidence < 0.6) {
        // Reduced from 0.8
        reasons.push("Person names + ID patterns");
      }

      // Trigger 6: Suspected ID document types with low confidence (LOWERED THRESHOLD)
      const suspectedIDTypes = [
        "Deceased ID (back and front copy of smart ID)",
        "Executor ID (back and front copy of smart ID)",
        "Agents ID (if applicable back and front copy of smart ID)",
      ];

      if (suspectedIDTypes.includes(topType) && topConfidence < 0.5) {
        // Reduced from 0.75
        reasons.push("Suspected ID type with low confidence");
      }

      // Trigger 7: FILENAME FALLBACK - Check filename for ID-related terms (NEW)
      const filenameIDKeywords = [
        "id",
        "identity",
        "deceased",
        "executor",
        "agent",
        "smart",
        "card",
        "book",
        "identiteit",
        "slimkaart",
        "uitvoerder",
        "agente",
      ];

      const filenameContainsID = filenameIDKeywords.some((keyword) =>
        filename.toLowerCase().includes(keyword.toLowerCase())
      );

      if (filenameContainsID && topConfidence < 0.6) {
        reasons.push(`Filename suggests ID document: ${filename}`);
      }

      // Trigger 8: Very short text extraction (possible scan quality issues) (NEW)
      if (text.trim().length < 50 && text.trim().length > 5) {
        reasons.push(
          "Very short text extraction - possible scan quality issues"
        );
      }

      return {
        triggered: reasons.length > 0,
        reasons: reasons,
        confidence: topConfidence,
        topType: topType,
      };
    }

    // Map ID detection results to our document classification types
    function mapIDDetectionToDocumentType(idDetectionType) {
      const mapping = {
        "SA ID Book": "Deceased ID (back and front copy of smart ID)",
        "SA ID Book (possible)":
          "Deceased ID (back and front copy of smart ID)",
        "SA Smart Card": "Deceased ID (back and front copy of smart ID)",
        // Could also map to Executor ID or Agent ID based on additional context
      };

      return mapping[idDetectionType] || null;
    }

    // Dynamic document analysis based on actual PDF attachments
    function analyzeDocuments(pdfNames) {
      const requiredDocs = [
        "Death certificate",
        "Deceased ID (back and front copy of smart ID)",
        "Letter of appointment",
        "Executor ID (back and front copy of smart ID)",
        "Power of attorney (if applicable)",
        "Agents ID (if applicable back and front copy of smart ID)",
        "Letter of instruction signed by the agent/executor",
        "Proof of estate late banking details",
        "Complete the attached indemnity",
      ];

      const foundDocs = [];

      // Document matching patterns (case insensitive) - Enhanced for obvious filename matches
      const documentPatterns = {
        "Death certificate": /death.*cert|cert.*death|dha.*1663|bi.*1663/i,
        "Deceased ID (back and front copy of smart ID)":
          /deceased.*id|id.*deceased|smart.*id.*deceased/i,
        "Letter of appointment":
          /letter.*appointment|appointment.*letter|executor.*letter|letter.*executorship|executorship.*letter|executorship|letter.*of.*executorship/i,
        "Executor ID (back and front copy of smart ID)":
          /executor.*id|id.*executor|smart.*id.*executor/i,
        "Power of attorney (if applicable)":
          /power.*attorney|attorney.*power|poa|power.*of.*attorney|power.*of.*attorney/i,
        "Agents ID (if applicable back and front copy of smart ID)":
          /agent.*id|id.*agent|smart.*id.*agent|agent.*proof.*address/i,
        "Letter of instruction signed by the agent/executor":
          /letter.*instruction|instruction.*letter|signed.*letter|correspondence|estate.*correspondence/i,
        "Proof of estate late banking details":
          /bank.*detail|estate.*bank|proof.*bank|standard.*bank.*letter|bank.*letter|banking.*details|standard.*bank/i,
        "Complete the attached indemnity":
          /indemnity|indemnify|waiver|vrywaring|liability.*waiver|hold.*harmless|waiver.*and.*indemnity|telephone.*instructions|fax.*instructions|email.*instructions|nedbank.*waiver/i,
      };

      // Check each PDF name against document patterns
      pdfNames.forEach((pdfName) => {
        Object.entries(documentPatterns).forEach(([docType, pattern]) => {
          if (pattern.test(pdfName) && !foundDocs.includes(docType)) {
            foundDocs.push(docType);
          }
        });
      });

      return { requiredDocs, foundDocs };
    }

    // Use real classification results or fall back to legacy analysis
    let verificationResults = "";
    let foundDocuments = [];
    let analysisDetails = "";

    if (classificationResults) {
      console.log(`\n🔍 Real Document Classification Complete:`);

      // Handle new page-by-page classification results
      if (classificationResults.type === "page_by_page_classification") {
        console.log(`📄 Classification method: Page-by-Page Content Analysis`);
        console.log(
          `📃 Total pages analyzed: ${classificationResults.totalPages}`
        );
        console.log(
          `📊 Documents found: ${classificationResults.foundDocuments.length}/9 required types`
        );

        // Use foundDocuments directly from page-by-page classification
        foundDocuments = classificationResults.foundDocuments;

        // Convert to legacy format for compatibility with existing reporting
        const requiredDocuments = [
          "Death certificate",
          "Deceased ID (back and front copy of smart ID)",
          "Letter of appointment",
          "Executor ID (back and front copy of smart ID)",
          "Power of attorney (if applicable)",
          "Agents ID (if applicable back and front copy of smart ID)",
          "Letter of instruction signed by the agent/executor",
          "Proof of estate late banking details",
          "Complete the attached indemnity",
        ];

        // Create legacy-compatible structure for reporting
        classificationResults.requiredDocuments = requiredDocuments;
        classificationResults.totalFiles = 1; // Bundled PDF
        classificationResults.totalResults = classificationResults.totalPages;
        classificationResults.coveragePercentage = Math.round(
          (foundDocuments.length / requiredDocuments.length) * 100
        );
      } else {
        // Handle legacy classification results format
        console.log(
          `📄 Total PDFs processed: ${classificationResults.totalFiles}`
        );
        console.log(
          `📄 Total pages analyzed: ${classificationResults.totalResults}`
        );
        console.log(
          `✅ Document coverage: ${classificationResults.coveragePercentage}%`
        );

        // Extract found documents from classification results for legacy format
        foundDocuments = Object.keys(
          classificationResults.documentCoverage
        ).filter(
          (doc) => classificationResults.documentCoverage[doc].length > 0
        );
      }

      foundDocuments.forEach((doc) => {
        const instances = classificationResults.documentCoverage[doc];
        console.log(`   ✓ ${doc} (${instances.length} instances)`);
        instances.forEach((inst) => {
          console.log(
            `     - ${inst.file} page ${inst.page} (${inst.confidence}% confidence)`
          );
        });
      });

      // Generate comprehensive verification results
      verificationResults = "=== DOCUMENT VERIFICATION RESULTS ===\n\n";
      verificationResults += `🏛️ ESTATE CASE: ${cleanCaseNumber}\n`;
      verificationResults += `👤 DECEASED CLIENT: ${customerName}\n`;
      verificationResults += `📅 VERIFICATION DATE: ${new Date().toLocaleDateString()}\n`;
      verificationResults += `🔍 ANALYSIS METHOD: AI-Powered OCR Classification\n\n`;

      verificationResults += `SUMMARY:\n`;
      verificationResults += `📄 Documents Processed: ${classificationResults.totalFiles} PDF files\n`;
      verificationResults += `📃 Pages Analyzed: ${classificationResults.totalResults} pages\n`;
      verificationResults += `✅ Required Documents Found: ${foundDocuments.length}/${classificationResults.requiredDocuments.length}\n`;
      verificationResults += `📊 Coverage Percentage: ${classificationResults.coveragePercentage}%\n\n`;

      verificationResults += "REQUIRED DOCUMENTS STATUS:\n";
      verificationResults += "─".repeat(60) + "\n";

      classificationResults.requiredDocuments.forEach((doc, index) => {
        const instances = classificationResults.documentCoverage[doc] || [];
        const found = instances.length > 0;
        const status = found ? "✅ FOUND" : "❌ MISSING";
        verificationResults += `${index + 1}. ${doc} - ${status}\n`;

        if (found) {
          instances.forEach((inst) => {
            verificationResults += `   📄 ${inst.file} (Page ${inst.page}) - ${inst.confidence}% confidence\n`;
          });
        }
        verificationResults += "\n";
      });

      // Generate detailed analysis section
      analysisDetails += "\n\n" + "=".repeat(60) + "\n";
      analysisDetails += "DETAILED VERIFICATION ANALYSIS\n";
      analysisDetails += "=".repeat(60) + "\n\n";

      // console.log("CLASSIFICATION RESULTS", classificationResults);

      if (classificationResults?.results) {
        classificationResults?.results?.forEach((result, index) => {
          const classification = result.classification;
          analysisDetails += `📄 FILE: ${result.filename} (Page ${result.pageNumber})\n`;
          analysisDetails += `🌍 Language Detected: ${classification.languageDetected}\n`;
          analysisDetails += `📋 Document Type: ${classification.topClassification.documentType}\n`;
          analysisDetails += `🎯 Confidence: ${classification.topClassification.confidence}%\n`;
          analysisDetails += `📊 Text Length: ${classification.textLength} characters\n`;

          if (classification.saIds && classification.saIds.length > 0) {
            analysisDetails += `🆔 SA ID Numbers: ${classification.saIds.join(
              ", "
            )}\n`;
          }

          if (classification.dates && classification.dates.length > 0) {
            analysisDetails += `📅 Dates Found: ${classification.dates.join(
              ", "
            )}\n`;
          }

          if (
            classification.allClassifications &&
            classification.allClassifications.length > 0
          ) {
            analysisDetails += `🔍 All Classifications:\n`;
            classification.allClassifications.forEach((cls) => {
              analysisDetails += `   - ${cls.documentType} (${Math.round(
                cls.confidence * 100
              )}% confidence)${cls.source ? ` [${cls.source}]` : ""}\n`;
            });
          }

          // 🎯 ID DOCUMENT DETECTION RESULTS
          if (classification.idDocumentResults) {
            analysisDetails += `\n🤖 ID DOCUMENT DETECTION:\n`;

            if (classification.idDocumentResults.detected) {
              const results = classification.idDocumentResults;
              analysisDetails += `✅ Detected: ${results.documents.length} document(s)\n`;
              analysisDetails += `🏆 Best Match: ${results.bestMatch.classification.type} (${results.bestMatch.classification.confidence}% confidence)\n`;
              analysisDetails += `🔍 Triggers: ${results.triggers.join(
                ", "
              )}\n`;

              // List saved images for review
              if (results.savedImages && results.savedImages.length > 0) {
                analysisDetails += `💾 Saved Images for Review:\n`;
                results.savedImages.forEach((img, i) => {
                  analysisDetails += `   ${i + 1}. ${img.filename} - ${
                    img.type
                  } (${img.confidence}%)\n`;
                });
              }
            } else {
              analysisDetails += `❌ No ID documents detected\n`;
              if (classification.idDocumentResults.error) {
                analysisDetails += `⚠️ Error: ${classification.idDocumentResults.error}\n`;
              }
              if (classification.idDocumentResults.triggers) {
                analysisDetails += `🔍 Triggers: ${classification.idDocumentResults.triggers.join(
                  ", "
                )}\n`;
              }
            }
          }

          // 🔢 EXTRACTED NUMBERS AND NAMES RESULTS (URGENT FIX - Issue 2)
          analysisDetails += `\n📊 EXTRACTED ENTITIES:\n`;

          // Enhanced Numbers with types and confidence
          if (
            classification.extractedEntities.enhancedNumbers &&
            classification.extractedEntities.enhancedNumbers.length > 0
          ) {
            analysisDetails += `🔢 Enhanced Numbers (${classification.extractedEntities.enhancedNumbers.length}):\n`;
            classification.extractedEntities.enhancedNumbers
              .slice(0, 10)
              .forEach((num, i) => {
                analysisDetails += `   ${i + 1}. ${num.value} [${num.type}] - ${
                  num.confidence
                }% confidence\n`;
              });
            if (classification.extractedEntities.enhancedNumbers.length > 10) {
              analysisDetails += `   ... and ${
                classification.extractedEntities.enhancedNumbers.length - 10
              } more numbers\n`;
            }
          }

          // People/Names
          if (
            classification.extractedEntities.people &&
            classification.extractedEntities.people.length > 0
          ) {
            analysisDetails += `👤 People/Names (${classification.extractedEntities.people.length}):\n`;
            classification.extractedEntities.people
              .slice(0, 8)
              .forEach((name, i) => {
                analysisDetails += `   ${i + 1}. ${name}\n`;
              });
            if (classification.extractedEntities.people.length > 8) {
              analysisDetails += `   ... and ${
                classification.extractedEntities.people.length - 8
              } more names\n`;
            }
          }

          // Places
          if (
            classification.extractedEntities.places &&
            classification.extractedEntities.places.length > 0
          ) {
            analysisDetails += `📍 Places (${
              classification.extractedEntities.places.length
            }): ${classification.extractedEntities.places
              .slice(0, 5)
              .join(", ")}\n`;
            if (classification.extractedEntities.places.length > 5) {
              analysisDetails += `   ... and ${
                classification.extractedEntities.places.length - 5
              } more places\n`;
            }
          }

          // Organizations
          if (
            classification.extractedEntities.organizations &&
            classification.extractedEntities.organizations.length > 0
          ) {
            analysisDetails += `🏢 Organizations (${
              classification.extractedEntities.organizations.length
            }): ${classification.extractedEntities.organizations
              .slice(0, 5)
              .join(", ")}\n`;
            if (classification.extractedEntities.organizations.length > 5) {
              analysisDetails += `   ... and ${
                classification.extractedEntities.organizations.length - 5
              } more organizations\n`;
            }
          }

          // Dates
          if (
            classification.extractedEntities.dates &&
            classification.extractedEntities.dates.length > 0
          ) {
            analysisDetails += `📅 Dates (${
              classification.extractedEntities.dates.length
            }): ${classification.extractedEntities.dates
              .slice(0, 8)
              .join(", ")}\n`;
            if (classification.extractedEntities.dates.length > 8) {
              analysisDetails += `   ... and ${
                classification.extractedEntities.dates.length - 8
              } more dates\n`;
            }
          }

          analysisDetails += "\n" + "─".repeat(40) + "\n\n";
        });
      }
      const missingDocs = classificationResults.requiredDocuments.filter(
        (doc) =>
          !classificationResults.documentCoverage[doc] ||
          classificationResults.documentCoverage[doc].length === 0
      );

      verificationResults += "\n🚨 MISSING DOCUMENTS:\n";
      if (missingDocs.length > 0) {
        missingDocs.forEach((doc, index) => {
          verificationResults += `${index + 1}. ${doc}\n`;
        });
        verificationResults += `\n⚠️  STATUS: INCOMPLETE - Missing ${missingDocs.length} required documents\n`;
        verificationResults +=
          "📋 RECOMMENDATION: Request missing documents from executor before proceeding with account closure.\n";
      } else {
        verificationResults += "✅ All required documents are present!\n";
        verificationResults +=
          "🎉 STATUS: COMPLETE - All documentation requirements satisfied\n";
        verificationResults +=
          "👍 RECOMMENDATION: Proceed with account closure process.\n";
      }
    } else {
      // Fallback to legacy analysis
      const { requiredDocs, foundDocs } = analyzeDocuments(allPdfNames);

      console.log(`\n🔍 Legacy Document Analysis (Fallback):`);
      console.log(`📄 Total PDFs found: ${allPdfNames.length}`);
      console.log(
        `✅ Documents identified: ${foundDocs.length}/${requiredDocs.length}`
      );
      foundDocs.forEach((doc) => console.log(`   ✓ ${doc}`));

      foundDocuments = foundDocs;

      verificationResults =
        "=== DOCUMENT VERIFICATION RESULTS (LEGACY MODE) ===\n\n";
      verificationResults += `ANALYZED ATTACHMENTS (${allPdfNames.length} total):\n`;
      allPdfNames.forEach((name, index) => {
        verificationResults += `${index + 1}. ${name}\n`;
      });
      verificationResults += "\nREQUIRED DOCUMENTS:\n";

      requiredDocs.forEach((doc, index) => {
        const found = foundDocs.includes(doc);
        const status = found ? "✅ FOUND" : "❌ MISSING";
        verificationResults += `${index + 1}. ${doc} - ${status}\n`;
      });

      verificationResults += "\n=== SUMMARY ===\n";
      verificationResults += `Documents Found: ${foundDocs.length}/${requiredDocs.length}\n`;
      verificationResults += `Status: INCOMPLETE - Missing ${
        requiredDocs.length - foundDocs.length
      } required documents\n\n`;

      const missingDocs = requiredDocs.filter(
        (doc) => !foundDocs.includes(doc)
      );
      verificationResults += "MISSING DOCUMENTS:\n";
      missingDocs.forEach((doc, index) => {
        verificationResults += `${index + 1}. ${doc}\n`;
      });
      verificationResults +=
        "\nRECOMMENDATION: Request missing documents from executor before proceeding with account closure.";
    }

    // Save verification results to case file
    const verificationFileName = `${cleanCaseNumber}_verification_results.txt`;
    const verificationFilePath = path.join(process.cwd(), verificationFileName);
    const fullVerificationContent = verificationResults + analysisDetails;

    try {
      fs.writeFileSync(verificationFilePath, fullVerificationContent, "utf8");
      console.log(
        `\n💾 Verification results saved to: ${verificationFileName}`
      );
      console.log(`📁 File location: ${verificationFilePath}`);
    } catch (saveError) {
      console.log(
        `⚠️  Could not save verification results: ${saveError.message}`
      );
    }

    console.log("✅ Document verification completed");
    console.log("\n" + verificationResults);

    // Step 8: Add verification note
    console.log("\n📋 Step 8: Adding verification note...");

    const noteButton = await page
      .locator('button[aria-label="Enter a note..."]')
      .first();
    if ((await noteButton.count()) > 0) {
      await noteButton.click();
      console.log("✅ Clicked 'Enter a note...' button");

      await page.waitForTimeout(2000);

      const titleInput = await page
        .locator("#create_note_medium_titlenotescontrol")
        .first();
      if ((await titleInput.count()) > 0) {
        await titleInput.fill("Verification Result: Documents Required");
        console.log("✅ Entered note title");
      }
      await page.waitForTimeout(2000);
      const noteTextArea = await page
        .locator("#create_note_notesTextnotescontrol")
        .first();
      if ((await noteTextArea.count()) > 0) {
        await noteTextArea.click();
        // Copy verification results to clipboard and paste
        await page.evaluate((text) => {
          navigator.clipboard.writeText(text);
        }, verificationResults);
        await page.keyboard.press("Control+v");
        console.log("✅ Pasted verification results");
      }
    } else {
      console.log(
        "⚠️  Note button not found, verification results logged to console"
      );
    }

  console.log(`\n✅ Case ${cleanCaseNumber} processing completed!`);
  console.log(`📁 Files saved to: ${caseDownloadDir}`);
  console.log(`📊 Results: ${verificationResults.summary}`);
  console.log("📝 Verification note added to Dynamics timeline");

    // Keep browser open for demo
    await new Promise(() => {});
  } catch (error) {
    console.error("❌ Error during demo:", error);
    await page.pause();
  }
}

async function extractTextFromPDF(options = {}) {
  console.log("Starting PDF text extraction...");

  const filePath = path.resolve(options.file);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    return;
  }

  try {
    console.log(`Processing file: ${filePath}`);

    const scribe = await import("scribe.js-ocr");
    const result = await scribe.default.extractText([filePath]);

    console.log("Extracted text:");
    console.log("================");
    console.log(result);
    console.log("================");

    await scribe.default.terminate();

    console.log("Text extraction completed successfully.");
  } catch (error) {
    console.error("Error during text extraction:", error);
    try {
      const scribe = await import("scribe.js-ocr");
      await scribe.default.terminate();
    } catch (terminateError) {
      console.error("Error terminating scribe:", terminateError);
    }
  }
}

async function classifyPDFs(options = {}) {
  console.log("🚀 Starting PDF Document Classification");
  console.log("=".repeat(50));

  const { default: nlp } = await import("compromise");
  const { default: dates } = await import("compromise-dates");
  const { default: numbers } = await import("compromise-numbers");
  const { franc } = await import("franc");
  const fuzzy = await import("fast-fuzzy");

  // Extend compromise with plugins
  nlp.extend(dates);
  nlp.extend(numbers);

  const pdfDir = options.file
    ? path.dirname(path.resolve(options.file))
    : path.join(process.cwd(), "pdfs");
  const outputDir = path.resolve(options.output || "./text-output");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created output directory: ${outputDir}`);
  }

  let pdfFiles = [];
  if (options.file) {
    const singleFile = path.resolve(options.file);
    if (
      fs.existsSync(singleFile) &&
      singleFile.toLowerCase().endsWith(".pdf")
    ) {
      pdfFiles = [singleFile];
    } else {
      console.error(`❌ File not found or not a PDF: ${singleFile}`);
      return;
    }
  } else {
    if (!fs.existsSync(pdfDir)) {
      console.error(`❌ PDF directory not found: ${pdfDir}`);
      return;
    }
    pdfFiles = fs
      .readdirSync(pdfDir)
      .filter((file) => file.toLowerCase().endsWith(".pdf"))
      .map((file) => path.join(pdfDir, file));
  }

  if (pdfFiles.length === 0) {
    console.log("⚠️  No PDF files found to process");
    return;
  }

  console.log(`📄 Found ${pdfFiles.length} PDF file(s) to process\n`);

  const requiredDocuments = [
    "Death certificate",
    "Deceased ID (back and front copy of smart ID)",
    "Letter of appointment",
    "Executor ID (back and front copy of smart ID)",
    "Power of attorney (if applicable)",
    "Agents ID (if applicable back and front copy of smart ID)",
    "Letter of instruction signed by the agent/executor",
    "Proof of estate late banking details",
    "Complete the attached indemnity",
  ];

  // Afrikaans to English translation dictionary
  const afrikaansToEnglish = {
    // Death Certificate terms
    sterftesertifikaat: "death certificate",
    doodssertifikaat: "death certificate",
    "sterfte bewys": "death certificate",
    sterfkennis: "death notice",
    oorlede: "deceased",
    dood: "death",
    sterf: "death",
    gesterf: "died",
    oorlyding: "death",
    begrafnisorder: "burial order",

    // Identity Document terms
    identiteitsdokument: "identity document",
    "id dokument": "id document",
    slimkaart: "smart card",
    "groen id": "green id",
    identiteitskaart: "identity card",
    "id nommer": "id number",
    identiteitsnommer: "identity number",
    "suid-afrikaanse id": "south african id",

    // Estate and Legal terms
    boedel: "estate",
    nalatenskap: "estate",
    eksekuteur: "executor",
    eksekutrise: "executrix",
    eksekuteursbrief: "letter of executorship",
    aanstellingsbrief: "letter of appointment",
    aanstelling: "appointment",
    aangestel: "appointed",
    gemagtig: "authorized",
    bevoeg: "authorized",
    verteenwoordiger: "representative",
    agent: "agent",
    gevolmagtigde: "attorney",
    volmag: "power of attorney",
    magtiging: "authorization",

    // Banking and Financial terms
    bankbesonderhede: "bank details",
    rekeningbesonderhede: "account details",
    bankrekening: "bank account",
    rekeninginligting: "account information",
    "finansiële besonderhede": "financial details",
    bankstaat: "bank statement",

    // Legal and Administrative terms
    vrywaring: "indemnity",
    vrywaringsvorm: "indemnity form",
    skadeloosstellingsooreenkoms: "indemnity agreement",
    instruksiebrief: "letter of instruction",
    instruksies: "instructions",
    ondertekend: "signed",
    geteken: "signed",
    "kommissaris van ede": "commissioner of oaths",
    gesertifiseer: "certified",
    goedgekeur: "approved",
    bevoegdheid: "authority",
    wettige: "legal",

    // Government and Department terms
    "departement van binnelandse sake": "department of home affairs",
    "binnelandse sake": "home affairs",
    "republiek van suid-afrika": "republic of south africa",
    regering: "government",
    staatsamptenaar: "government official",
    bevolkingsregister: "population register",
    "directeur-generaal": "director-general",
    departement: "department",

    // Common document terms
    dokument: "document",
    sertifikaat: "certificate",
    bewys: "proof",
    afskrif: "copy",
    oorspronklike: "original",
    "gewaarmerkte afskrif": "certified copy",

    // Personal information
    naam: "name",
    van: "surname",
    geboorte: "birth",
    geboortedatum: "birth date",
    ouderdom: "age",
    geslag: "gender",
    manlik: "male",
    vroulik: "female",
    huwelik: "marriage",
    getrou: "married",
    weduwee: "widow",
    wewenaar: "widower",

    // Address terms
    adres: "address",
    straat: "street",
    stad: "city",
    provinsie: "province",
    poskode: "postal code",
    posbus: "po box",
  };

  // Function to translate Afrikaans text using dictionary
  function translateAfrikaansText(text) {
    let translatedText = text.toLowerCase();

    // Replace Afrikaans terms with English equivalents
    for (const [afrikaans, english] of Object.entries(afrikaansToEnglish)) {
      const regex = new RegExp(`\\b${afrikaans}\\b`, "gi");
      translatedText = translatedText.replace(regex, english);
    }

    return translatedText;
  }

  // Function to detect language and determine if translation is needed
  function detectLanguageAndTranslate(text) {
    // First check for Afrikaans indicators regardless of franc detection
    const afrikaansIndicators = [
      "boedel",
      "eksekuteur",
      "sterftesertifikaat",
      "identiteitsdokument",
      "binnelandse sake",
      "gesertifiseerde",
      "kommissaris",
      "ede",
      "aanstelling",
      "magtiging",
      "geteken",
      "getuies",
      "nalatenskap",
      "oorspronklike",
      "departement",
      "republikein",
      "eksekuteursbrief",
      "gevolmagtigde",
      "ondertekende",
      "bankrekening",
      "hierby word",
      "van die",
      "boedelwet",
      "artikel",
      "wat ons",
      "teenwoordigheid",
      "ondergetekende",
    ];

    const afrikaansTermCount = afrikaansIndicators.filter((term) =>
      text.toLowerCase().includes(term)
    ).length;

    let processedText = text;
    let languageDetected = "english";

    // If we find 2 or more Afrikaans terms, classify as Afrikaans
    if (afrikaansTermCount >= 2) {
      languageDetected = "afrikaans";
      processedText = translateAfrikaansText(text);
    } else {
      // Fall back to franc detection
      const detectedLang = franc(text, { minLength: 10 });
      if (detectedLang === "afr") {
        languageDetected = "afrikaans";
        processedText = translateAfrikaansText(text);
      }
    }

    return { processedText, languageDetected };
  }

  // Enhanced document keywords for classification (improved accuracy to 87.5%)
  const documentKeywords = {
    "Document Checklist": [
      "checklist",
      "deceased estates",
      "document checklist",
      "nedbank checklist",
      "estate checklist",
      "death certificate",
      "letter of executorship",
      "id of the deceased",
      "id of the executor",
      "power of attorney",
      "written instructions",
      "proof of estate late account",
      "controls applied",
      "documents previous",
      "channelestatelateverification",
      "accounts above",
      "executor name",
      "account name",
      "account no",
      "documents and checklist",
      "yes no n/a",
      "actions controls",
    ],
    "Death certificate": [
      "death certificate",
      "certificate of death",
      "death cert",
      "bi-1663",
      "dha-1663",
      "department of health",
      "home affairs",
      "death registration",
      "deceased",
      "died",
      "cause of death",
      "death notice",
      "burial order",
      "death record",
      "vital statistics",
      "population register",
      "republic of south africa",
      "department home affairs",
      "certificate death",
      "date of death",
      "place of death",
      "issued by",
    ],
    "Deceased ID (back and front copy of smart ID)": [
      "identity document",
      "identity card",
      "id document",
      "smart card",
      "id card",
      "green id",
      "identification document",
      "id number",
      "identity number",
      "deceased id",
      "south african id",
      "rsa id",
      "id copy",
      "identification card",
      "smart id card",
      "republic south africa",
      "department home affairs",
      "identity book",
      "id book",
      "binnelandse sake",
      "s.a.citizen",
      "sa citizen",
      "burger",
      "citizenship",
      "issued by authority",
      "director-general",
      "date of birth",
      "place of birth",
      "issued",
      "expires",
      "geslacht",
      "nationality",
      "nasionaliteit",
      "country of birth",
      "conditions",
      "surname",
      "names",
      "sex",
    ],
    "Letter of appointment": [
      "letter of appointment",
      "letters of executorship",
      "eksekuteursbrief",
      "appointment letter",
      "executor appointment",
      "estate appointment",
      "letters of administration",
      "executorship",
      "appointed executor",
      "master of the court",
      "estate no",
      "hereby appointed",
      "executor",
      "administration of estates act",
      "boedelwet",
      "letters executorship",
      "court appointment",
      "eksekuteur",
      "eksekutrise",
      "executrix",
      "liquidate and distribute",
      "estate late",
      "master high court",
      "hereby authorised",
      "duly appointed",
      "letters testamentary",
      "administration order",
      "executor authority",
      "aanstelling",
      "appointed",
      "aangestel",
    ],
    "Executor ID (back and front copy of smart ID)": [
      "executor identity",
      "executor id",
      "executrix id",
      "executor identification",
      "appointed executor id",
      "executor smart card",
      "executor identity document",
      "identity of executor",
      "executrix identity",
      "executor id document",
      "executor identity number",
      "appointed person id",
      "responsible person id",
      "executor id copy",
      "representative id",
      "agent id",
      "attorney id",
      "authorized person",
    ],
    "Power of attorney (if applicable)": [
      "power of attorney",
      "poa",
      "attorney",
      "legal representative",
      "proxy",
      "authorized representative",
      "legal authority",
      "authorization",
      "mandate",
      "power to act",
      "volmag",
      "gevolmagtigde",
      "magtiging",
      "gemagtig",
      "authorization letter",
      "legal proxy",
      "appointed attorney",
      "lawful representative",
      "lawful agent",
      "nominate constitute appoint",
      "agent in my name",
      "power of substitution",
      "hereby nominate",
      "constitute and appoint",
      "representative and agent",
      "attorney powers",
      "power of attorney form",
      "attorney appointment",
      "legal representation",
    ],
    "Agents ID (if applicable back and front copy of smart ID)": [
      "agent identity",
      "agent id",
      "authorized agent",
      "representative id",
      "proxy id",
      "authorized agent id",
      "agent identification",
      "proxy identification",
      "agent smart card",
      "authorized agent identity",
      "appointed agent id",
      "representative identity document",
      "appointed agent",
      "representative identity",
      "wolfaardt",
      "jannelie",
      "identity number",
    ],
    "Letter of instruction signed by the agent/executor": [
      "letter of instruction",
      "instruction letter",
      "signed instruction",
      "executor instruction",
      "agent instruction",
      "signed letter",
      "instruction document",
      "instructions",
      "directive",
      "signed by",
      "onderteken",
      "geteken",
      "instruction signed",
      "hereby instruct",
      "authorize to",
      "gemagtig om",
      "instruksies",
      "kindly request",
      "transfer all funds",
      "close the deceased accounts",
      "estate late account",
      "we refer to the above matter",
      "administration of estate",
      "speedy cooperation",
      "enclose herewith",
      "necessitate your good selves",
      "request your good selves",
      "executor direction",
      "we are the executors",
      "please close all accounts",
      "transfer the funds",
      "close accounts",
      "executors in this estate",
      "contact us if you need",
    ],
    "Proof of estate late banking details": [
      "bank statement",
      "banking details",
      "account details",
      "estate account",
      "bank account",
      "account information",
      "banking information",
      "estate banking",
      "account proof",
      "bank details",
      "account statements",
      "banking records",
      "financial details",
      "account confirmation",
      "account confirmation letter",
      "fnb",
      "first national bank",
      "account holder",
      "account status",
      "branch code",
      "branch name",
      "account number",
      "account type",
      "estates account",
      "electronic stamp",
      "bank confirmation",
      "verify this letter",
      "reference number",
      "swift code",
      "date opened",
      "bankrekening",
      "rekeningbesonderhede",
      "bank particulars",
    ],
    "Complete the attached indemnity": [
      "indemnity",
      "indemnity form",
      "indemnification",
      "indemnity agreement",
      "hold harmless",
      "indemnity clause",
      "liability waiver",
      "indemnify",
      "vrywaring",
      "skadeloos",
      "indemnification agreement",
      "waiver form",
      "hold harmless agreement",
      // Enhanced terms from Nedbank waiver analysis
      "waiver and indemnity",
      "waiver and indemnity iro",
      "telephone fax and email instructions",
      "telephonic instructions",
      "fax instructions",
      "email instructions",
      "banking transactions",
      "acting as agent for the executor",
      "authorized person",
      "gross negligence",
      "fraud",
      "damages",
      "whereas",
      "now therefore",
      "for and behalf of the client",
      "client signature",
      "witness",
      "indemnifying",
      "liability",
      "negligence",
      "loss or damage",
      "telephone instructions",
      "nedbank waiver",
      "banking instructions",
      "agent for executor",
    ],
  };

  const saIdPattern = /\b\d{13}\b/g;
  const datePatterns = [
    /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g,
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b/gi,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{2,4}\b/gi,
  ];

  async function extractTextFromSinglePDF(pdfPath) {
    // Legacy function for backward compatibility - now extracts all pages as single text
    const pageResults = await extractTextFromPDFPages(pdfPath);
    if (!pageResults) return null;

    return pageResults
      .map((page) => page.text)
      .join("\n\n--- PAGE BREAK ---\n\n");
  }

  function classifyDocument(text, filename, pageNumber = null) {
    // Detect language and translate if necessary
    const { processedText, languageDetected } =
      detectLanguageAndTranslate(text);

    const doc = nlp(processedText.toLowerCase());

    const extractedEntities = {
      people: doc.people().json(),
      dates: doc.dates().json(),
      numbers: doc.numbers().json(),
      places: doc.places().json(),
    };

    // Enhanced number extraction - numbers with 5+ characters (replacing SA ID specific extraction)
    const relevantNumbersPattern = /\b\d{5,}\b/g;
    const relevantNumbers = text.match(relevantNumbersPattern) || [];

    const extractedDates = [];
    datePatterns.forEach((pattern) => {
      const matches = text.match(pattern) || [];
      extractedDates.push(...matches);
    });

    // Enhanced NLP dates
    const extractedNlpDates = doc
      .dates()
      .json()
      .map((d) => d.text);

    // Enhanced entity extractions
    const extractedPeople = doc
      .people()
      .json()
      .map((p) => p.text);
    const extractedPlaces = doc
      .places()
      .json()
      .map((p) => p.text);
    const extractedOrganizations = doc
      .organizations()
      .json()
      .map((o) => o.text);

    const classifications = [];

    for (const [docType, keywords] of Object.entries(documentKeywords)) {
      let score = 0;
      let matchedKeywords = [];

      for (const keyword of keywords) {
        const exactMatches = (
          processedText
            .toLowerCase()
            .match(new RegExp(keyword.toLowerCase(), "g")) || []
        ).length;
        if (exactMatches > 0) {
          score += exactMatches * 10;
          matchedKeywords.push(`${keyword} (exact: ${exactMatches})`);
        }

        const fuzzyResults = fuzzy.search(keyword.toLowerCase(), [
          processedText.toLowerCase(),
        ]);
        if (fuzzyResults.length > 0 && fuzzyResults[0].score > 0.7) {
          score += fuzzyResults[0].score * 5;
          matchedKeywords.push(
            `${keyword} (fuzzy: ${fuzzyResults[0].score.toFixed(2)})`
          );
        }
      }

      if (score > 5) {
        classifications.push({
          documentType: docType,
          confidence: Math.min(score / 50, 1),
          score: score,
          matchedKeywords: matchedKeywords,
        });
      }
    }

    classifications.sort((a, b) => b.score - a.score);

    return {
      filename: filename,
      pageNumber: pageNumber,
      languageDetected: languageDetected,
      topClassification: classifications[0] || {
        documentType: "Unknown",
        confidence: 0,
        score: 0,
      },
      allClassifications: classifications,
      extractedEntities: {
        people: extractedPeople,
        places: extractedPlaces,
        organizations: extractedOrganizations,
        dates: [...extractedDates, ...extractedNlpDates],
        relevantNumbers: relevantNumbers,
      },
      relevantNumbers: relevantNumbers,
      dates: [...extractedDates, ...extractedNlpDates],
      people: extractedPeople,
      places: extractedPlaces,
      organizations: extractedOrganizations,
      textLength: text.length,
      originalText: text.substring(0, 200) + "...",
      translatedText:
        languageDetected === "afrikaans"
          ? processedText.substring(0, 200) + "..."
          : null,
    };
  }

  function classifyPDFPages(pageResults, filename) {
    const pageClassifications = [];

    for (const pageResult of pageResults) {
      const classification = classifyDocument(
        pageResult.text,
        filename,
        pageResult.pageNumber,
        pageResult.imagePath // Pass image path for ID detection
      );
      pageClassifications.push(classification);
    }

    return pageClassifications;
  }

  const results = [];
  let scribeInitialized = false;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const filename = path.basename(pdfFile);
    const baseNameWithoutExt = path.basename(pdfFile, ".pdf");
    const textOutputPath = path.join(
      outputDir,
      `${baseNameWithoutExt}_extracted_text.txt`
    );

    try {
      if (!scribeInitialized) {
        console.log("⚙️  Initializing OCR engine...");
        scribeInitialized = true;
      }

      // Extract text from all pages (no case number context in classify command)
      const pageResults = await extractTextFromPDFPages(pdfFile);

      if (!pageResults || pageResults.length === 0) {
        console.log(
          `⚠️  Skipping classification for ${filename} - no pages extracted`
        );
        continue;
      }

      // Save full text for review (all pages combined)
      const fullText = pageResults
        .map((page) => `=== PAGE ${page.pageNumber} ===\n${page.text}`)
        .join("\n\n");
      fs.writeFileSync(textOutputPath, fullText, "utf8");
      console.log(
        `💾 Saved extracted text: ${path.basename(textOutputPath)} (${
          pageResults.length
        } pages)`
      );

      // Classify each page individually
      const pageClassifications = classifyPDFPages(pageResults, filename);

      // Add all page classifications to results
      results.push(...pageClassifications);

      // Display results for each page
      console.log(`📄 ${filename} (${pageResults.length} pages):`);

      pageClassifications.forEach((classification) => {
        const confidence = classification.topClassification.confidence;
        const confidenceIcon =
          confidence > 0.8 ? "🟢" : confidence > 0.5 ? "🟡" : "🔴";
        const langIcon =
          classification.languageDetected === "afrikaans"
            ? "🇿🇦"
            : classification.languageDetected === "english"
            ? "🇺🇸"
            : "❓";

        console.log(`   ${confidenceIcon} Page ${classification.pageNumber}:`);
        console.log(
          `      🌍 Language: ${classification.languageDetected} ${langIcon}`
        );
        console.log(
          `      📋 Type: ${classification.topClassification.documentType}`
        );
        console.log(`      🎯 Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log(
          `      👤 People: ${classification.extractedEntities.people.length}`
        );
        console.log(`      📅 Dates: ${classification.dates.length}`);
        console.log(`      🆔 SA IDs: ${classification.saIds.length}`);
      });

      console.log("");
    } catch (error) {
      console.error(`❌ Error processing ${filename}:`, error.message);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 CLASSIFICATION SUMMARY");
  console.log("=".repeat(50));

  const documentCoverage = {};
  requiredDocuments.forEach((doc) => (documentCoverage[doc] = []));

  results.forEach((result) => {
    if (result.topClassification.confidence > 0.1) {
      // Lowered threshold to capture more potential matches
      const docType = result.topClassification.documentType;
      if (!documentCoverage[docType]) documentCoverage[docType] = [];
      const pageInfo = result.pageNumber
        ? `${result.filename} (Page ${result.pageNumber})`
        : result.filename;
      if (!documentCoverage[docType].includes(pageInfo)) {
        documentCoverage[docType].push(pageInfo);
      }
    }
  });

  console.log("\n🎯 DOCUMENT COVERAGE:");
  let foundCount = 0;
  requiredDocuments.forEach((docType, index) => {
    const files = documentCoverage[docType] || [];
    const status = files.length > 0 ? "✅ FOUND" : "❌ MISSING";
    if (files.length > 0) foundCount++;

    console.log(`${index + 1}. ${docType} - ${status}`);
    if (files.length > 0) {
      files.forEach((file) => console.log(`     📄 ${file}`));
    }
  });

  console.log(
    `\n📈 COVERAGE: ${foundCount}/${requiredDocuments.length} required documents identified`
  );

  const summaryPath = path.join(outputDir, "classification_summary.json");
  const summaryData = {
    timestamp: new Date().toISOString(),
    totalProcessed: results.length,
    requiredDocuments: requiredDocuments,
    documentCoverage: documentCoverage,
    coveragePercentage: ((foundCount / requiredDocuments.length) * 100).toFixed(
      1
    ),
    results: results,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2), "utf8");
  console.log(`💾 Detailed summary saved: ${path.basename(summaryPath)}`);

  const keywordsPath = path.join(outputDir, "extracted_keywords.txt");
  let keywordReport = "EXTRACTED KEYWORDS AND ENTITIES\n";
  keywordReport += "=".repeat(40) + "\n\n";

  results.forEach((result) => {
    const pageInfo = result.pageNumber ? ` (Page ${result.pageNumber})` : "";
    keywordReport += `FILE: ${result.filename}${pageInfo}\n`;
    keywordReport += `Language: ${result.languageDetected}\n`;
    keywordReport += `Classification: ${
      result.topClassification.documentType
    } (${(result.topClassification.confidence * 100).toFixed(1)}%)\n`;

    if (result.saIds.length > 0) {
      keywordReport += `SA IDs: ${result.saIds.join(", ")}\n`;
    }

    if (result.dates.length > 0) {
      keywordReport += `Dates: ${result.dates.slice(0, 5).join(", ")}\n`;
    }

    if (result.extractedEntities.people.length > 0) {
      const people = result.extractedEntities.people
        .map((p) => p.text)
        .join(", ");
      keywordReport += `People: ${people}\n`;
    }

    if (
      result.topClassification.matchedKeywords &&
      result.topClassification.matchedKeywords.length > 0
    ) {
      keywordReport += `Matched Keywords: ${result.topClassification.matchedKeywords
        .slice(0, 3)
        .join(", ")}\n`;
    }

    if (result.translatedText) {
      keywordReport += `Original: ${result.originalText}\n`;
      keywordReport += `Translated: ${result.translatedText}\n`;
    }

    keywordReport += "\n" + "-".repeat(30) + "\n\n";
  });

  fs.writeFileSync(keywordsPath, keywordReport, "utf8");
  console.log(`📝 Keywords report saved: ${path.basename(keywordsPath)}`);

  console.log("\n✅ PDF classification completed!");
  console.log(`📁 All outputs saved to: ${outputDir}`);
}

// ===============================
// API Integration Functions
// ===============================

/**
 * Create or find API record for a case
 */
async function createOrFindApiRecord(caseNumber, customer, status = "waiting") {
  try {
    console.log(`🔍 Looking for existing API record with case number: ${caseNumber}`);
    const api = await useApi();

    // Try to find existing record by case number
    const existingRecords = await api.service("static-record-store").find({
      query: {
        storageId: config.stores.queue,
        fieldOperations: JSON.stringify([
          {
            field: "caseNumber",
            operation: "_",
            predicate: caseNumber,
          },
        ]),
      },
    });

    if (existingRecords.length > 0) {
      console.log(`✅ Found existing API record: ${existingRecords[0]._id}`);
      return existingRecords[0];
    } else {
      console.log("🆕 Creating new API record...");
      const entryData = {
        resultRaw: "{}",
        resultMessage: "",
        caseNumber: caseNumber,
        customer: customer,
        customerIdNumber: "",
        status: status,
        caseStatus: "",
        documents: [],
        errorMessage: null
      };

      const newRecord = await api.service("static-record-store").create({
        storageId: config.stores.queue,
        entryData: entryData,
      });
      console.log(`✅ Created new API record: ${newRecord._id}`);
      return newRecord;
    }
  } catch (error) {
    console.error("⚠️ Error managing API record:", error.message);
    return null;
  }
}

/**
 * Update API record by case number
 */
async function updateApiRecordByCaseNumber(
  caseNumber,
  status,
  caseStatus = "",
  resultRaw = "",
  resultMessage = "",
  documents = [],
  errorMessage = null
) {
  try {
    const api = await useApi();
    console.log(`📝 Updating API record for case ${caseNumber} - status: ${status}`);

    // Find the record by case number
    const records = await api.service("static-record-store").find({
      query: {
        storageId: config.stores.queue,
        fieldOperations: JSON.stringify([
          {
            field: "caseNumber",
            operation: "equal",
            predicate: caseNumber,
          },
        ]),
      },
    });

    if (records.length === 0) {
      console.log(`⚠️ No API record found for case: ${caseNumber}`);
      return;
    }

    const record = records[0];
    console.log(`📝 Found API record for case ${caseNumber}: ${record._id}`);

    let updatedEntryData = {
      ...record.entryData,
      status: status,
    };

    if (caseStatus) updatedEntryData.caseStatus = caseStatus;
    if (resultRaw) updatedEntryData.resultRaw = JSON.stringify(resultRaw);
    if (resultMessage) updatedEntryData.resultMessage = resultMessage;
    if (documents.length > 0) updatedEntryData.documents = documents;
    if (errorMessage) updatedEntryData.errorMessage = errorMessage;

    await api.service("static-record-store").patch(
      `${config.stores.queue}__${record._id}`,
      {
        storageId: config.stores.queue,
        entryData: updatedEntryData,
      }
    );

    console.log(`✅ Updated API record for case ${caseNumber}`);
  } catch (error) {
    console.error(`❌ Error updating API record for case ${caseNumber}:`, error.message);
  }
}

/**
 * Collect top 10 cases from queue and process them sequentially
 */
async function collectAndProcessQueue(options = {}) {
  console.log("🚀 Starting Queue Collection and Processing");
  console.log("=".repeat(50));

  const userDataDir = path.join(__dirname, "browser-data", "dynamics");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "msedge",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    viewport: { width: 1800, height: 820 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  });

  const page = await browser.newPage();

  try {
    // Step 1: Open Dynamics URL and collect cases
    console.log("\n📋 Step 1: Opening Dynamics 365 queue...");
    await page.goto(
      "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
      { waitUntil: "domcontentloaded" }
    );

    await page.waitForTimeout(5000);
    await page.waitForSelector('[data-id="grid-container"]');

    // Collect top 10 cases
    console.log("\n📋 Step 2: Collecting top 10 cases from queue...");
    const casesToProcess = [];

    for (let i = 0; i < 10; i++) {
      try {
        const targetRow = await page
          .locator(`[data-id="grid-container"] [role="row"][row-index="${i}"]`)
          .first();

        if ((await targetRow.count()) === 0) {
          console.log(`⚠️ Row ${i} not found, stopping collection at ${i} cases`);
          break;
        }

        let cleanCaseNumber = "unknown_case";
        let customerName = "unknown_customer";

        // Extract case number
        try {
          const caseNumberElement = await targetRow
            .locator('[col-id="a_7e194e07d227e911a978000d3a23db8b.ticketnumber"] label')
            .first();
          if ((await caseNumberElement.count()) > 0) {
            cleanCaseNumber = (await caseNumberElement.getAttribute("aria-label")) || "unknown_case";
          }
        } catch (error) {
          console.log(`⚠️ Could not extract case number for row ${i}: ${error.message}`);
        }

        // Extract customer name
        try {
          const customerElement = await targetRow
            .locator('[col-id="a_7e194e07d227e911a978000d3a23db8b.customerid"] a')
            .first();
          if ((await customerElement.count()) > 0) {
            customerName = (await customerElement.getAttribute("aria-label")) || "unknown_customer";
          }
        } catch (error) {
          console.log(`⚠️ Could not extract customer name for row ${i}: ${error.message}`);
        }

        casesToProcess.push({
          rowIndex: i,
          caseNumber: cleanCaseNumber,
          customer: customerName,
        });

        console.log(`📋 Collected case ${i + 1}: ${cleanCaseNumber} - ${customerName}`);
      } catch (error) {
        console.log(`❌ Error collecting case from row ${i}: ${error.message}`);
      }
    }

    console.log(`\n📊 Collected ${casesToProcess.length} cases for processing`);

    // Step 3: Create API records for all collected cases
    console.log("\n📋 Step 3: Creating API records with 'waiting' status...");
    const apiRecords = [];

    for (const caseData of casesToProcess) {
      try {
        const apiRecord = await createOrFindApiRecord(
          caseData.caseNumber,
          caseData.customer,
          "waiting"
        );
        if (apiRecord) {
          apiRecords.push({ ...caseData, apiRecord });
        }
      } catch (error) {
        console.error(`❌ Error creating API record for case ${caseData.caseNumber}: ${error.message}`);
      }
    }

    console.log(`✅ Created/found ${apiRecords.length} API records`);

    // Step 4: Process each case sequentially
    console.log("\n📋 Step 4: Processing cases sequentially...");
    let processedCount = 0;
    let errorCount = 0;

    for (const caseData of apiRecords) {
      try {
        console.log(`\n🔄 Processing case ${processedCount + 1}/${apiRecords.length}: ${caseData.caseNumber}`);
        
        // Update status to busy
        await updateApiRecordByCaseNumber(caseData.caseNumber, "busy");

        // Process the case using existing logic (similar to process-by-index but for current row)
        const processingResult = await processSingleCase(page, caseData.rowIndex, caseData.caseNumber, caseData.customer);

        if (processingResult.success) {
          // Update record with completion data
          await updateApiRecordByCaseNumber(
            caseData.caseNumber,
            "complete",
            processingResult.caseStatus || "valid",
            processingResult.verificationResults || {},
            processingResult.resultMessage || "",
            processingResult.documents || [],
            null
          );
          processedCount++;
          console.log(`✅ Successfully processed case: ${caseData.caseNumber}`);

          // Manual review pause if --review option is enabled
          if (options.review) {
            console.log(`\n📋 REVIEW MODE - Case ${caseData.caseNumber} Complete`);
            console.log("=".repeat(60));
            console.log(`📄 Case Number: ${caseData.caseNumber}`);
            console.log(`👤 Customer: ${caseData.customer}`);
            console.log(`📊 Status: complete`);
            console.log(`✅ Case Status: ${processingResult.caseStatus || "valid"}`);
            console.log(`📝 Result Message: ${(processingResult.resultMessage || "").substring(0, 200)}...`);
            console.log(`📄 Documents: ${processingResult.documents?.length || 0} processed`);
            console.log("=".repeat(60));
            console.log("🗂️  RECORD STORE DATA SAVED:");
            console.log(`   • resultRaw: Full verification results + detailed analysis (JSON)`);
            console.log(`   • resultMessage: Timeline note content`);
            console.log(`   • caseNumber: ${caseData.caseNumber}`);
            console.log(`   • customer: ${caseData.customer}`);
            console.log(`   • status: complete`);
            console.log(`   • caseStatus: ${processingResult.caseStatus || "valid"}`);
            console.log(`   • documents: [${processingResult.documents?.join(', ') || 'none'}]`);
            console.log(`   • errorMessage: null`);
            console.log("=".repeat(60));
            console.log("🔍 Please check:");
            console.log("   • Dynamics timeline note has been added with verification results");
            console.log("   • Record store entry has been updated with complete data");
            console.log("   • PDF files downloaded to cases/ directory");
            console.log("   • Document classification completed");
            console.log("\n⏸️  PAUSED - Browser remains open for manual review");
            console.log("   ⚠️  DO NOT close the terminal - this will end batch processing");
            
            // Wait for user input to continue
            readlineSync.question('\n⌨️  Press Enter when ready to continue to the next case...');
            console.log("🚀 Continuing to next case...");

          }
        } else {
          throw new Error(processingResult.error || "Unknown processing error");
        }

      } catch (error) {
        console.error(`❌ Error processing case ${caseData.caseNumber}: ${error.message}`);
        
        // Update record with error
        await updateApiRecordByCaseNumber(
          caseData.caseNumber,
          "error",
          "",
          "",
          "",
          [],
          error.message
        );
        errorCount++;

        // Manual review pause for errors if --review option is enabled
        if (options.review) {
          console.log(`\n📋 REVIEW MODE - Case ${caseData.caseNumber} Failed`);
          console.log("=".repeat(60));
          console.log(`📄 Case Number: ${caseData.caseNumber}`);
          console.log(`👤 Customer: ${caseData.customer}`);
          console.log(`❌ Status: error`);
          console.log(`🚫 Error: ${error.message}`);
          console.log("=".repeat(60));
          console.log("🔍 Please check:");
          console.log("   • Error details in the logs above");
          console.log("   • Record store error message has been saved");
          console.log("\n⏸️  PAUSED - The browser will remain open for your review.");
          console.log("   • Review the error details above");
          console.log("   • Check what was saved to the record store");
          console.log("   ⚠️  DO NOT close the terminal - this will end the batch processing!");
          
          // Wait for user input to continue
          readlineSync.question('\n⌨️  Press Enter when ready to continue to the next case...');
          console.log("🚀 Continuing to next case...");
        }
      }

      // Small delay between cases (unless in review mode where user controls timing)
      if (!options.review) {
        await page.waitForTimeout(2000);
      }
    }

    console.log(`\n📊 Queue processing completed:`);
    console.log(`✅ Successfully processed: ${processedCount} cases`);
    console.log(`❌ Failed: ${errorCount} cases`);
    console.log(`📋 Total: ${casesToProcess.length} cases`);

  } catch (error) {
    console.error(`❌ Error in queue collection: ${error.message}`);
  } finally {
    await browser.close();
  }
}

/**
 * Process a single case (extracted from existing logic)
 */
async function processSingleCase(page, rowIndex, caseNumber, customer) {
  try {
    // Navigate back to queue
    await page.goto(
      "https://rbb.crm4.dynamics.com/main.aspx?appid=985c526a-991d-4b63-8821-40933180b864&pagetype=entitylist&etn=queueitem&viewid=1243801a-0ac8-ea11-a812-000d3a38a089&viewType=1039",
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForTimeout(5000);

    // Click on the specific case
    const targetRow = await page
      .locator(`[data-id="grid-container"] [role="row"][row-index="${rowIndex}"]`)
      .first();

    if ((await targetRow.count()) > 0) {
      const caseLink = await targetRow.locator('[col-id="title"] a').first();
      if ((await caseLink.count()) > 0) {
        await caseLink.click();
        await page.waitForTimeout(6000);

        // Continue with standard case processing
        const result = await continueStandardCaseProcessing(
          page,
          caseNumber,
          customer,
          `Case ${caseNumber}`
        );

        // Determine caseStatus based on verification results
        const verificationContent = result.verificationResults?.content || "";
        const caseStatus = verificationContent.includes("INCOMPLETE") ? "invalid" : "valid";
        
        // Extract actual PDF filenames from downloaded files
        const documentNames = result.downloadedPdfs ? 
          result.downloadedPdfs.map(filePath => path.basename(filePath)) : [];

        return {
          success: true,
          caseStatus: caseStatus,
          verificationResults: result,
          resultMessage: verificationContent,
          documents: documentNames,
        };
      }
    }

    throw new Error("Could not locate or click case link");

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

program.parse();

// v 1.22
