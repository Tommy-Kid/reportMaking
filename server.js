const express = require("express");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const readline = require("readline");

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

    const totalFiles = files.length;
    let report = { passed: [], failed: [] };

    const spinnerFrames = ['|', '/', '-', '\\'];
    let spinnerIndex = 0;

    function updateSpinner(progress) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`${spinnerFrames[spinnerIndex++ % spinnerFrames.length]} Processing ${progress}`);
    }

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const filePath = path.join(folderPath, file);
        const xmlContent = fs.readFileSync(filePath, "utf-8");

        try {
            const result = await parser.parseStringPromise(xmlContent);
            const rootKey = Object.keys(result)[0];
            const parsedData = result[rootKey];
            const fileReport = { file, errors: [], passed: [], failed: [] };

            let tagFound = false;
            validationRules.checkTags.forEach(tag => {
                if (findTag(parsedData, tag)) {
                    fileReport.passed.push(`✅ Tag found: ${tag}`);
                    tagFound = true;
                }
            });

            let attributeMatched = checkAttributes(parsedData, validationRules, fileReport);

            // Only include in report if it has either a tag found or attribute match
            if (tagFound || attributeMatched) {
                if (fileReport.failed.length > 0) {
                    report.failed.push(fileReport);
                } else {
                    report.passed.push(fileReport);
                }

                // Write to report
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
            }
        } catch (error) {
            const errorMsg = `File: ${file}\n❌ Error parsing XML\n----------------------\n`;
            fs.appendFileSync(reportFile, errorMsg, "utf-8");
            report.failed.push({ file, errors: ["Invalid XML format"] });
        }

        updateSpinner(`${i + 1}/${totalFiles}`);
    }

    // Finalize
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log("🎉 Összes fájl feldolgozva!");

    fs.appendFileSync(reportFile, `🎉 Összes fájl feldolgozva!\n`, "utf-8");

    res.json({ passed: report.passed.length, failed: report.failed.length, reportFile: "report.txt" });
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

// Attribute checker
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