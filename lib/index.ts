import * as playwright from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { fileURLToPath } from 'url';
import express from 'express';
import moment from 'moment';
import { Eta } from "eta";
import sendNotification from './sendNotification';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '../public', 'screenshots');
const DIFF_DIR = path.join(__dirname, '../public', 'screenshots');
const STATE_FILE = path.join(__dirname, '../state.json');
const PORT = 3000;
const BATCH_SIZE = 4;
const LOOP_DELAY = 10000; // 10 seconds

const URLS = [
  'https://www.legal500.com/',
  'https://www.legal500.com/rankings',
  'https://www.legal500.com/c/north',
  'https://www.legal500.com/c/london',
  'https://www.legal500.com/c/north/corporate-and-commercial/corporate-and-commercial-newcastle',
  'https://www.legal500.com/rankings/ranking/c-north/corporate-and-commercial/corporate-and-commercial-newcastle/3465-ward-hadaway-llp',
  'https://www.legal500.com/firms/3465-ward-hadaway-llp/c-north/rankings',
  'https://www.legal500.com/firms/3465-ward-hadaway-llp/c-north/lawyers'
];

const eta = new Eta({
  views: path.join(__dirname, "../public")
});

let checks = {};
let lastScreenshots = {};
let browser: playwright.Browser;

setTimeout(() => {
  sendNotification({
    message: 'Change detection started',
    title: 'Change Detection',
  });
}, 2000);

async function ensureDirectoryExists(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function takeScreenshot(url) {
  const page = await browser.newPage();

  for (const context of browser.contexts()) {
    context.addCookies([{
      name: 'cookieyes-consent',
      value: 'consentid:M2RBd1dzT2xmenFUVmRGVW5aNTVvWFNXREdVbFpGdzg,consent:no,action:yes,necessary:yes,functional:no,analytics:no,performance:no,advertisement:no,other:no,lastRenewedDate:1707128849000',
      domain: new URL(url).hostname,
      path: '/',
    }]);
  }

  try {
    await page.goto(url, { timeout: 30000 }); // 30 seconds timeout
    await new Promise(resolve => setTimeout(resolve, 5000));
    const screenshot = await page.screenshot({ fullPage: true });
    await page.close();
    return { success: true, screenshot };
  } catch (error) {
    console.error(`Failed to take screenshot for ${url}:`, error);
    await page.close();
    return { success: false, error: error.message };
  }
}

async function compareImages(img1, img2) {
  const [image1, image2] = await Promise.all([
    PNG.sync.read(img1),
    PNG.sync.read(img2)
  ]);

  const { width, height } = image1;
  const diff = new PNG({ width, height });
  try {
    const numDiffPixels = pixelmatch(image1.data, image2.data, diff.data, width, height, { threshold: 0.1 });

    return {
      isDifferent: numDiffPixels > 0,
      diffImage: PNG.sync.write(diff)
    };
  } catch (error) {
    console.error(error);
    return {
      isDifferent: true,
      diffImage: null
    }
  }
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

  const screenshotResult = await takeScreenshot(url);

  let checkResult = {
    time: currentTime,
    wasDifferent: false,
    filePath: '',
    diffFilePath: null,
    failed: !screenshotResult.success,
    errorMessage: screenshotResult.error
  };

  if (screenshotResult.success) {
    if (lastScreenshots[url]) {
      const { isDifferent, diffImage } = await compareImages(lastScreenshots[url], screenshotResult.screenshot);

      if (isDifferent) {
        checkResult.wasDifferent = true;
        checkResult.filePath = await saveImage(screenshotResult.screenshot, SCREENSHOT_DIR, filename);
        checkResult.diffFilePath = diffImage && await saveImage(diffImage, DIFF_DIR, `diff_${filename}`);

        sendNotification({
          title: 'Change Detected',
          message: `A change was detected on ${url}`
        });
      } else {
        checkResult.filePath = checks[url][checks[url].length - 1].filePath;
      }
    } else {
      checkResult.filePath = await saveImage(screenshotResult.screenshot, SCREENSHOT_DIR, filename);
    }

    lastScreenshots[url] = screenshotResult.screenshot;
  } else {
    // If the check failed (e.g., due to timeout), find the last working screenshot
    const lastWorkingCheck = [...checks[url]].reverse().find(check => !check.failed);
    if (lastWorkingCheck) {
      checkResult.filePath = lastWorkingCheck.filePath;
    }

    // Send a Mac notification for check failure
    sendNotification({
      title: 'Check Failed',
      message: `Failed to check ${url}: ${checkResult.errorMessage}`
    });
  }

  if (!checks[url]) {
    checks[url] = [];
  }
  checks[url].push(checkResult);
  console.log('Check completed for', url, ':', checkResult);

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
      if (screenshotPath) {
        lastScreenshots[url] = await fs.readFile(path.join(__dirname, '../public', screenshotPath));
      }
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
      let lastChange = null;

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

        if (check.wasDifferent || check.failed || i === 0 || i === urlChecks.length - 1) {
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

          // Add the changed or failed check
          timelineItems.push({
            type: 'check',
            status: check.failed ? 'failed' : (check.wasDifferent ? 'changed' : 'unchanged'),
            timestamp: checkTime,
            screenshotPath: check.filePath,
            diffPath: check.diffFilePath,
            errorMessage: check.errorMessage
          });

          // Update lastChange if this check was different
          if (check.wasDifferent) {
            lastChange = checkTime;
          }

          unchangedCount = 0;
          unchangedBuffer = [];
          lastTime = checkTime;
        } else {
          unchangedCount++;
          unchangedBuffer.push({
            type: 'check',
            status: 'unchanged',
            timestamp: checkTime,
            screenshotPath: check.filePath
          });
        }
      }

      return {
        url,
        lastChange: lastChange ? lastChange.toDate() : new Date(0), // Use Date object instead of formatted string
        timelineItems,
        timeTicks
      };
    });

    const html = await eta.render("./index", { sites, moment });
    res.send(html);
  });

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

async function processUrlBatch(urlBatch) {
  const promises = urlBatch.map(url => performCheck(url));
  await Promise.all(promises);
}

async function main() {
  await ensureDirectoryExists(SCREENSHOT_DIR);
  await ensureDirectoryExists(DIFF_DIR);

  console.log('Starting screenshot checks...');

  // Load previous state if it exists
  await loadState();

  // Launch a single browser instance
  browser = await playwright.chromium.launch();

  // Setup the HTTP server
  await setupServer();

  while (true) {
    for (let i = 0; i < URLS.length; i += BATCH_SIZE) {
      const urlBatch = URLS.slice(i, i + BATCH_SIZE);
      await processUrlBatch(urlBatch);
    }

    console.log(`Completed a full check cycle. Waiting for ${LOOP_DELAY / 1000} seconds before the next cycle.`);
    await new Promise(resolve => setTimeout(resolve, LOOP_DELAY));
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

main().catch(console.error);
