import * as playwright from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { fileURLToPath } from 'url';
import express from 'express';
import moment from 'moment';
import { Eta } from "eta";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '../public', 'screenshots');
const DIFF_DIR = path.join(__dirname, '../public', 'screenshots');
const STATE_FILE = path.join(__dirname, '../state.json');
const INTERVAL = 10000;
const PORT = 3000;

const URLS = [
  'https://www.legal500.com/',
  'https://www.legal500.com/rankings',
  'https://www.legal500.com/c/north',
  'https://www.legal500.com/c/north',
  'https://www.legal500.com/c/north/corporate-and-commercial/corporate-and-commercial-newcastle',
  'https://www.legal500.com/rankings/ranking/c-north/corporate-and-commercial/corporate-and-commercial-newcastle/3465-ward-hadaway-llp',
  'https://www.legal500.com/firms/3465-ward-hadaway-llp/c-north/rankings',
  'https://www.legal500.com/firms/3465-ward-hadaway-llp/c-north/lawyers',
  'http://localhost:8003/test.html'
];

const eta = new Eta({ views: path.join(__dirname, "../public") });

let checks = {};
let lastScreenshots = {};

async function ensureDirectoryExists(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function takeScreenshot(url) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  await new Promise(resolve => setTimeout(resolve, 5000));
  const screenshot = await page.screenshot({ fullPage: true });
  await browser.close();
  return screenshot;
}

async function compareImages(img1, img2) {
  const [image1, image2] = await Promise.all([
    PNG.sync.read(img1),
    PNG.sync.read(img2)
  ]);

  const { width, height } = image1;
  const diff = new PNG({ width, height });
  const numDiffPixels = pixelmatch(image1.data, image2.data, diff.data, width, height, { threshold: 0.1 });

  return {
    isDifferent: numDiffPixels > 0,
    diffImage: PNG.sync.write(diff)
  };
}

async function saveImage(image, directory, filename) {
  await ensureDirectoryExists(directory);
  const filePath = path.join(directory, filename);
  await fs.writeFile(filePath, image);
  return path.relative(path.join(__dirname, '../public'), filePath);
}

async function performCheck(url) {
  const currentTime = new Date();
  const filename = `screenshot_${url.replace(/[^a-zA-Z0-9]/g, '_')}_${currentTime.toISOString().replace(/[:.]/g, '-')}.png`;

  const newScreenshot = await takeScreenshot(url);

  let checkResult = {
    time: currentTime,
    wasDifferent: false,
    filePath: '',
    diffFilePath: null
  };

  if (lastScreenshots[url]) {
    const { isDifferent, diffImage } = await compareImages(lastScreenshots[url], newScreenshot);

    if (isDifferent) {
      checkResult.wasDifferent = true;
      checkResult.filePath = await saveImage(newScreenshot, SCREENSHOT_DIR, filename);
      checkResult.diffFilePath = await saveImage(diffImage, DIFF_DIR, `diff_${filename}`);
    } else {
      checkResult.filePath = checks[url][checks[url].length - 1].filePath;
    }
  } else {
    checkResult.filePath = await saveImage(newScreenshot, SCREENSHOT_DIR, filename);
  }

  if (!checks[url]) {
    checks[url] = [];
  }
  checks[url].push(checkResult);
  console.log('Check completed for', url, ':', checkResult);

  lastScreenshots[url] = newScreenshot;

  // Save state after each check
  await saveState();
}

async function saveState() {
  const state = {
    checks: checks,
    lastScreenshotPaths: Object.fromEntries(
      Object.entries(checks).map(([url, urlChecks]) => [url, urlChecks[urlChecks.length - 1].filePath])
    )
  };
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function loadState() {
  try {
    const stateData = await fs.readFile(STATE_FILE, 'utf8');
    const state = JSON.parse(stateData);
    checks = state.checks;
    for (const [url, screenshotPath] of Object.entries(state.lastScreenshotPaths)) {
      lastScreenshots[url] = await fs.readFile(path.join(__dirname, '../public', screenshotPath));
    }
    console.log('Resumed from previous state');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading state:', error);
    }
    console.log('Starting fresh');
  }
}

async function setupServer() {
  const app = express();

  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/', async (req, res) => {
    const sites = URLS.map(url => {
      const urlChecks = checks[url] || [];
      const timelineItems = [];
      const timeTicks = [];
      let lastTime = null;
      let unchangedCount = 0;
      let unchangedBuffer = [];

      for (let i = urlChecks.length - 1; i >= 0; i--) {
        const check = urlChecks[i];
        const checkTime = moment(check.time);

        // Add time tick for each hour
        if (!lastTime || !checkTime.isSame(lastTime, 'hour')) {
          timeTicks.push({
            time: checkTime.format('MMM DD hh:mm'),
            position: timelineItems.length * 110
          });
        }

        if (check.wasDifferent || i === 0 || i === urlChecks.length - 1) {
          // If there were unchanged checks before this, add a rollup
          if (unchangedCount > 2) {
            timelineItems.push(unchangedBuffer[0]); // Add the first unchanged check
            timelineItems.push({
              type: 'rollup',
              count: unchangedCount - 2,
              duration: moment.duration(checkTime.diff(lastTime)).humanize()
            });
            timelineItems.push(unchangedBuffer[unchangedBuffer.length - 1]); // Add the last unchanged check
          } else {
            // If there were 2 or fewer unchanged checks, add them all
            timelineItems.push(...unchangedBuffer);
          }

          // Add the changed check
          timelineItems.push({
            type: 'check',
            status: check.wasDifferent ? 'changed' : 'unchanged',
            timestamp: checkTime.format('MMM D, HH:mm'),
            screenshotPath: check.filePath,
            diffPath: check.diffFilePath
          });

          unchangedCount = 0;
          unchangedBuffer = [];
          lastTime = checkTime;
        } else {
          unchangedCount++;
          unchangedBuffer.push({
            type: 'check',
            status: 'unchanged',
            timestamp: checkTime.format('MMM D, HH:mm'),
            screenshotPath: check.filePath
          });
        }
      }

      return {
        url,
        timelineItems,
        timeTicks
      };
    });

    const html = await eta.render("./index", { sites });
    res.send(html);
  });

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

async function main() {
  await ensureDirectoryExists(SCREENSHOT_DIR);
  await ensureDirectoryExists(DIFF_DIR);

  console.log('Starting screenshot checks...');

  // Load previous state if it exists
  await loadState();

  // Setup the HTTP server
  await setupServer();

  // Perform initial checks
  for (const url of URLS) {
    await performCheck(url);
  }

  // Schedule subsequent checks
  setInterval(async () => {
    for (const url of URLS) {
      await performCheck(url);
    }
  }, INTERVAL);
}

main().catch(console.error);
