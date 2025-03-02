const cron = require("node-cron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// مسیر فایل اسکریپت اصلی
const scriptPath = path.join(__dirname, "main.js");

// بررسی وجود فایل اسکریپت
if (!fs.existsSync(scriptPath)) {
  console.error(`Error: Script file not found at ${scriptPath}`);
  process.exit(1);
}

// تنظیم زمان‌بندی برای اجرای هر 15 دقیقه
// "*/15 * * * *" یعنی در دقیقه‌های 0، 15، 30 و 45 هر ساعت
cron.schedule("*/15 * * * *", () => {
  console.log(
    `\n[${new Date().toISOString()}] Starting scheduled execution...`
  );

  // اجرای اسکریپت به عنوان یک پروسه جداگانه
  const process = spawn("node", [scriptPath]);

  // نمایش خروجی اسکریپت
  process.stdout.on("data", (data) => {
    console.log(`${data}`);
  });

  process.stderr.on("data", (data) => {
    console.error(`${data}`);
  });

  process.on("close", (code) => {
    console.log(
      `[${new Date().toISOString()}] Script execution completed with code ${code}`
    );
  });
});

console.log(`Scheduler started. Script will run every 15 minutes.`);
console.log(`First execution will be at the next 15-minute mark.`);
console.log(`Press Ctrl+C to stop the scheduler.`);

// اجرای یک بار اسکریپت در شروع کار
console.log(`\n[${new Date().toISOString()}] Running initial execution...`);
const initialProcess = spawn("node", [scriptPath]);

initialProcess.stdout.on("data", (data) => {
  console.log(`${data}`);
});

initialProcess.stderr.on("data", (data) => {
  console.error(`${data}`);
});

initialProcess.on("close", (code) => {
  console.log(
    `[${new Date().toISOString()}] Initial execution completed with code ${code}`
  );
});
