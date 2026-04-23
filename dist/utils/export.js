"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveExportResult = saveExportResult;
exports.displayExportSummary = displayExportSummary;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
function saveExportResult(result) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${result.provider}-export-${timestamp}.json`;
    const filepath = path_1.default.join(process.cwd(), filename);
    fs_1.default.writeFileSync(filepath, JSON.stringify(result, null, 2));
    console.log(chalk_1.default.green(`\n✅ Export completed successfully!`));
    console.log(chalk_1.default.blue(`📁 Report saved to: ${filepath}`));
    console.log(chalk_1.default.gray(`\n📊 Summary:`));
    Object.entries(result.summary).forEach(([entityType, count]) => {
        console.log(chalk_1.default.gray(`   • ${entityType}: ${count}`));
    });
    return filepath;
}
function displayExportSummary(result) {
    console.log(chalk_1.default.green(`\n✅ Export completed successfully!`));
    console.log(chalk_1.default.gray(`\n📊 Summary:`));
    Object.entries(result.summary).forEach(([entityType, count]) => {
        console.log(chalk_1.default.gray(`   • ${entityType}: ${count}`));
    });
}
