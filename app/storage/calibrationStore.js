// calibrationStore.js
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function getDataPath() {
  return path.join(__dirname, "../data/calibration.json");
}

function loadCalibration() {
    const file = getDataPath();

    try {
        if (!fs.existsSync(file)) {
            return { calibrationFactor: 1 };
        }

        const raw = fs.readFileSync(file);
        return JSON.parse(raw);
    } catch (err) {
        console.error("Errore lettura calibrazione:", err);
        return { calibrationFactor: 1 };
    }
}

function saveCalibration(data) {
    const file = getDataPath();

    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Errore salvataggio calibrazione:", err);
    }
}

module.exports = {
    loadCalibration,
    saveCalibration
};
