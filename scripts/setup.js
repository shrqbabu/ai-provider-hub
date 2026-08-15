import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env");
const envExamplePath = path.join(rootDir, ".env.example");
const dataDir = path.join(rootDir, "data");

console.log("\n⚡ ==========================================");
console.log("🚀 Initializing AI Provider Hub Setup...");
console.log("⚡ ==========================================\n");

// 1. Ensure .env exists
if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log("✔ Created .env configuration file from template.");
  } else {
    fs.writeFileSync(
      envPath,
      "PORT=3000\nHOST=0.0.0.0\nNODE_ENV=production\n",
      "utf-8"
    );
    console.log("✔ Generated default .env file.");
  }
} else {
  console.log("✔ Existing .env file found.");
}

// 2. Ensure data directory exists for SQLite/JSON persistence
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("✔ Created persistent database directory (./data).");
} else {
  console.log("✔ Persistent database directory (./data) ready.");
}

console.log("\n✨ Setup initialization complete! Ready for build.\n");
