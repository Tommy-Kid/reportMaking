const express = require("express");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const app = express();
const PORT = 3000;
const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [(name) => name.replace(/^.*:/, '')]
});

// Serve static files (CSS & JS)
app.use(express.static(path.join(__dirname, "public")));

let shouldStop = false; // control flag

// Validation rules
const validationRules = {
    global: {
        checkTags: [
            "GetAircraftTypes",
            "GetSectors",
            "GetDelayReasonCodes",
            "GetAircraftsByDateRange",
            "CrewBase",
            "CrewChangedRQ",
            // ... 5 more global tags
        ],
        checkValues: {
            "staffNumber": ["2950", "26368", "6936"]
        }
    },
    staticData: {
        checkTags: [
            "City",
            "Airport",
            "Country",
            // ... 150+ more tags only for static data files
        ],
        checkValues: {
            // add any static-data-specific attributes if needed
        }
    }
};

// Render UI
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API to start processing
app.get("/start/:libraryRoot", async (req, res) => {
    shouldStop = false;
    const libraryRoot = req.params.libraryRoot;
    const folderPath = path.join(__dirname, libraryRoot);

    if (!fs.existsSync(folderPath)) {
        return res.json({ error: "Directory not found" });
    }

    const files = fs.readdirSync(folderPath).filter(file => file.endsWith(".xml"));
    if (files.length === 0) {
        return res.json({ error: "No XML files found!" });
    }

    // Create timestamped report file (e.g., report-2025-03-17-15-30-12.txt)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportFileName = `report-${timestamp}.txt`;
    const reportFile = path.join(__dirname, reportFileName);

    let report = { passed: [], failed: [] };
    let logs = [];

    for (const file of files) {
        if (shouldStop) {
            logs.push(`⏹️ Processing stopped by user!`);
            break;
        }

        const filePath = path.join(folderPath, file);
        const xmlContent = fs.readFileSync(filePath, "utf-8");

        try {
            const result = await parser.parseStringPromise(xmlContent);
            const rootKey = Object.keys(result)[0];
            const parsedData = result[rootKey];
            const fileReport = { file, errors: [], passed: [], failed: [] };

            const isStatic = isStaticDataFile(xmlContent);

            //  ---- GLOBAL TAG CHECK ----
            validationRules.global.checkTags.forEach(tag => {
                const tagExists = findTag(parsedData, tag);
                if (tagExists) {
                    fileReport.passed.push(`✅ Tag found (global): ${tag}`);
                } else {
                    fileReport.failed.push(`❌ Missing tag (global): ${tag}`);
                }
            });

            // ---- STATIC TAG CHECK ----
            if (isStatic) {
                validationRules.staticData.checkTags.forEach(tag => {
                    const tagExists = findTag(parsedData, tag);
                    if (tagExists) {
                        fileReport.passed.push(`✅ Tag found (static): ${tag}`);
                    } else {
                        fileReport.failed.push(`❌ Missing tag (static): ${tag}`);
                    }
                });
            }

            // ---- ATTRIBUTE CHECK (global only or per group) ----
            let attributeMatched = false;
            for (const [attribute, expectedValues] of Object.entries(validationRules.global.checkValues)) {
                if (checkAttributes(parsedData, validationRules.global, fileReport)) {
                    attributeMatched = true;
                }
            }

            if (fileReport.passed.length > 0 || attributeMatched) {
                report.passed.push(fileReport);
            } else {
                report.failed.push(fileReport);
            }

            // ---- Write to report file ----
            let txtBlock = `\n🗂️ File: ${file}\n`;
            if (fileReport.passed.length > 0) {
                txtBlock += `✔️ PASSED:\n`;
                fileReport.passed.forEach(line => txtBlock += `  - ${line}\n`);
            }
            if (fileReport.failed.length > 0) {
                txtBlock += `❌ FAILED:\n`;
                fileReport.failed.forEach(line => txtBlock += `  - ${line}\n`);
            }
            txtBlock += `----------------------\n`;
            fs.appendFileSync(reportFile, txtBlock, "utf-8");

            logs.push(`✔️ Processed: ${file}`);

        } catch (error) {
            const errorMsg = `File: ${file}\n❌ Error parsing XML\n----------------------\n`;
            fs.appendFileSync(reportFile, errorMsg, "utf-8");
            logs.push(`❌ Error processing: ${file}`);
        }
    }

    if (!shouldStop) {
        fs.appendFileSync(reportFile, `🎉 Összes fájl feldolgozva!\n`, "utf-8");
        logs.push("🎉 Összes fájl feldolgozva!");
    }

    res.json({ logs, passed: report.passed.length, failed: report.failed.length, reportFile: reportFileName });
});

// API to stop processing
app.post("/stop", (req, res) => {
    shouldStop = true;
    res.json({ status: "stopping" });
});

// Utility functions
function checkAttributes(obj, validationRules, fileReport, matchedAttributes = new Set()) {
    let matched = false;
    for (const key in obj) {
        if (typeof obj[key] === "object" && obj[key] !== null) {
            if (obj[key].hasOwnProperty("$")) {
                for (const [attribute, expectedValues] of Object.entries(validationRules.checkValues)) {
                    if (obj[key].$.hasOwnProperty(attribute)) {
                        if (expectedValues.includes(obj[key].$[attribute])) {
                            if (!matchedAttributes.has(`${attribute}=${obj[key].$[attribute]}`)) {
                                fileReport.passed.push(`✅ Attribute match: ${attribute} = ${obj[key].$[attribute]}`);
                                matchedAttributes.add(`${attribute}=${obj[key].$[attribute]}`);
                            }
                            matched = true;
                        } else {
                            fileReport.failed.push(`❌ Attribute mismatch: ${attribute} found ${obj[key].$[attribute]}, expected one of ${expectedValues.join(", ")}`);
                        }
                    }
                }
            }
            if (checkAttributes(obj[key], validationRules, fileReport, matchedAttributes)) {
                matched = true;
            }
        }
    }
    return matched;
}

function findTag(obj, tag) {
    if (typeof obj !== "object" || obj === null) return false;
    if (obj.hasOwnProperty(tag)) return true;
    for (const key in obj) {
        if (findTag(obj[key], tag)) return true;
    }
    return false;
}

function isStaticDataFile(xmlContent) {
    return xmlContent.includes('GetStaticDataRS') || xmlContent.includes('<wsdl:message name="GetStaticDataRS"');
}

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});