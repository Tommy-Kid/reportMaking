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

const validationRules = {
    checkTags: [
        "GetAircraftTypes",
        "GetSectors",
        "GetDelayReasonCodes",
        "GetAircraftsByDateRange",
        "CrewBase",
        "CrewChangedRQ"
    ],
    checkValues: {
        "staffNumber": ["2950", "26368", "6936"]
    }
};

app.get("/:libraryRoot", async (req, res) => {
    const libraryRoot = req.params.libraryRoot;
    const folderPath = path.join(__dirname, libraryRoot);
    const reportFile = path.join(__dirname, "report.txt");

    // Report törlés indításkor
    if (fs.existsSync(reportFile)) {
        fs.unlinkSync(reportFile);
    }

    if (!fs.existsSync(folderPath)) {
        return res.status(404).json({ error: "Directory not found" });
    }

    const files = fs.readdirSync(folderPath).filter(file => file.endsWith(".xml"));

    if (files.length === 0) {
        return res.status(404).json({ error: "No XML files found!" });
    }

    let report = { passed: [], failed: [] };

    for (const file of files) {
        const filePath = path.join(folderPath, file);
        const xmlContent = fs.readFileSync(filePath, "utf-8");

        try {
            const result = await parser.parseStringPromise(xmlContent);
            const rootKey = Object.keys(result)[0];

            const parsedData = result[rootKey];
            const fileReport = { file, errors: [], passed: [], failed: [] };

            // ---- TAG CHECK ----
            validationRules.checkTags.forEach(tag => {
                const tagExists = findTag(parsedData, tag);
                if (tagExists) {
                    fileReport.passed.push(`✅ Tag found: ${tag}`);
                } else {
                    fileReport.failed.push(`❌ Missing tag: ${tag}`);
                }
            });

            // ---- ATTRIBUTES CHECK ----
            let attributeMatched = false;
            for (const [attribute, expectedValues] of Object.entries(validationRules.checkValues)) {
                if (checkAttributes(parsedData, validationRules, fileReport)) {
                    attributeMatched = true;
                }
            }

            if (fileReport.passed.length > 0 || attributeMatched) {
                report.passed.push(fileReport);
            } else {
                report.failed.push(fileReport);
            }

            // ---- Write to report.txt ----
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

            console.log(`✔️ Finished processing: ${file}`);

        } catch (error) {
            const errorMsg = `File: ${file}\n❌ Error parsing XML\n----------------------\n`;
            fs.appendFileSync(reportFile, errorMsg, "utf-8");
            report.failed.push({ file, errors: ["Invalid XML format"] });
        }
    }

    // 🟢 Itt tesszük a report végére a záró sort:
    fs.appendFileSync(reportFile, `🎉 Összes fájl feldolgozva!\n`, "utf-8");
    console.log("🎉 Összes fájl feldolgozva!");

    res.json({ passed: report.passed.length, failed: report.failed.length, reportFile: "report.txt" });
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

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
    if (obj.hasOwnProperty(tag)) {
        return true;
    }
    for (const key in obj) {
        if (findTag(obj[key], tag)) {
            return true;
        }
    }
    return false;
}