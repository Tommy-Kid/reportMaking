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

app.use(express.static(path.join(__dirname, "public")));

let shouldStop = false;

// Validation rules
const validationRules = {
    global: {
        checkTags: [
            "GetAircraftTypes",
            "GetSectors",
            "GetDelayReasonCodes",
            "GetAircraftsByDateRange",
            "CrewChangedRQ"
        ],
        checkValues: {
            "staffNumber": ["2950", "26368", "6936"]
        }
    },
    staticData: {
        checkTags: [
            "city", "base", "serviceTypeCode","functionCode","baseCode","aircraftCode",
            // ... add the remaining 150+ here
        ],
        checkValues: {
            "baseCode": ["EPR"],
            "serviceTypeCode": ["W"],
            "city": ["GYO"],
            "aircraftCode":["HA-EPR"],
        }
    }
};

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/start/:libraryRoot", async (req, res) => {
    shouldStop = false;
    const libraryRoot = req.params.libraryRoot;
    const folderPath = path.join(__dirname, libraryRoot);

    if (!fs.existsSync(folderPath)) return res.json({ error: "Directory not found" });

    const files = fs.readdirSync(folderPath).filter(file => file.endsWith(".xml"));
    if (files.length === 0) return res.json({ error: "No XML files found!" });

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

            const isStatic = isStaticDataFile(parsedData);

            // Global tag checks
            validationRules.global.checkTags.forEach(tag => {
                const tagExists = findTag(parsedData, tag);
                tagExists
                    ? fileReport.passed.push(`✅ Tag found (global): ${tag}`)
                    : fileReport.failed.push(`❌ Missing tag (global): ${tag}`);
            });

            // Static data tag checks
            if (isStatic) {
                logs.push(`🟢 Detected as Static Data file: ${file}`);
                validationRules.staticData.checkTags.forEach(tag => {
                    const tagExists = findTag(parsedData, tag);
                    tagExists
                        ? fileReport.passed.push(`✅ Tag found (static): ${tag}`)
                        : fileReport.failed.push(`❌ Missing tag (static): ${tag}`);
                });
            }

            // Attribute checks (global only for now)
            let attributeMatched = false;
            const matchedAttributes = new Set();

            for (const [attribute, expectedValues] of Object.entries(validationRules.global.checkValues)) {
                if (checkAttributes(parsedData, attribute, expectedValues, fileReport, matchedAttributes)) {
                    attributeMatched = true;
                }
            }

            if (isStatic) {
                for (const [attribute, expectedValues] of Object.entries(validationRules.staticData.checkValues)) {
                    if (checkAttributes(parsedData, attribute, expectedValues, fileReport, matchedAttributes)) {
                        attributeMatched = true;
                    }
                }
            }

            if (fileReport.passed.length > 0 || attributeMatched) {
                report.passed.push(fileReport);
            } else {
                report.failed.push(fileReport);
            }

            // Write result to report file
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
        fs.appendFileSync(reportFile, `🎉 All files processed!\n`, "utf-8");
        logs.push("🎉 All files processed!");
    }

    res.json({ logs, passed: report.passed.length, failed: report.failed.length, reportFile: reportFileName });
});

app.post("/stop", (req, res) => {
    shouldStop = true;
    res.json({ status: "stopping" });
});

// UTILITIES

function isStaticDataFile(parsedData) {
    let found = false;

    function search(obj) {
        if (typeof obj !== 'object' || obj === null || found) return;

        for (const key in obj) {
            if (validationRules.staticData.checkTags.includes(key)) {
                found = true;
                break;
            }
            search(obj[key]);
        }
    }

    search(parsedData);
    return found;
}

function search(obj) {
    if (typeof obj !== 'object' || obj === null || found) return;

    for (const key in obj) {
        console.log("Checking key:", key); // <- Add this to debug
        if (key.toLowerCase().includes('static') || key.toLowerCase().includes('cmxsd')) {
            found = true;
            break;
        }

        search(obj[key]);
    }
}

function findTag(obj, tag) {
    if (typeof obj !== "object" || obj === null) return false;
    if (obj.hasOwnProperty(tag)) return true;
    for (const key in obj) {
        if (findTag(obj[key], tag)) return true;
    }
    return false;
}

function checkAttributes(obj, attribute, expectedValues, fileReport, matchedSet) {
    let matched = false;
    for (const key in obj) {
        const value = obj[key];
        if (typeof value === "object" && value !== null) {
            if (value.$ && value.$[attribute]) {
                const attrValue = value.$[attribute];
                const matchKey = `${attribute}=${attrValue}`;

                if (expectedValues.includes(attrValue)) {
                    if (!matchedSet.has(matchKey)) {
                        fileReport.passed.push(`✅ Attribute match: ${attribute} = ${attrValue}`);
                        matchedSet.add(matchKey);
                    }
                    matched = true;
                } else if (!matchedSet.has(matchKey)) {
                    fileReport.failed.push(`❌ Attribute mismatch: ${attribute} found ${attrValue}, expected one of ${expectedValues.join(", ")}`);
                    matchedSet.add(matchKey);
                }
            }
            if (checkAttributes(value, attribute, expectedValues, fileReport, matchedSet)) {
                matched = true;
            }
        }
    }
    return matched;
}

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});