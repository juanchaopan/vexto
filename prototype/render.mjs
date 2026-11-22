// Renders every state of the phone prototype to a PNG with Playwright's Chromium.
//
//   node prototype/render.mjs                    all states into prototype/screens/
//   node prototype/render.mjs --only reader,lookup
//
// The states, their order and their names come from window.vexto.presets in vexto-phone.html.
// Each state is loaded fresh at 390x844 CSS px (device scale 2); the page is then grown to its
// full height so the image shows the whole page with bottom-anchored parts at the bottom.
// The script also fails when a visible touch target is smaller than 44x44 CSS px.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.join(here, 'vexto-phone.html')).href;
const outDir = path.join(here, 'screens');
const VIEWPORT = { width: 390, height: 844 };
const MIN_TARGET = 44;

// Playwright is resolved from PLAYWRIGHT_DIR when set, otherwise from this repository.
function loadPlaywright() {
  const bases = [process.env.PLAYWRIGHT_DIR, path.join(here, '..'), process.cwd()].filter(Boolean);
  for (const base of bases) {
    try {
      return createRequire(path.join(path.resolve(base), 'noop.js'))('playwright');
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error(
    'Playwright was not found. Run `task setup`, or set PLAYWRIGHT_DIR to a directory whose node_modules contains playwright.',
  );
}

function parseOnly(argv) {
  const index = argv.indexOf('--only');
  return index === -1 ? null : new Set((argv[index + 1] || '').split(',').filter(Boolean));
}

// Runs in the page: lists visible interactive elements smaller than the minimum touch target.
// Card titles are covered by their tappable card, checkboxes and radios by their 44 px labels,
// and the progress slider spans the player's width.
function smallTargets(min) {
  const selector =
    'button, a, select, input, label.selection-check, .filter-options label, .sort-options label';
  const skip =
    '[data-target="card"], input[type="checkbox"], input[type="radio"], input[type="range"]';
  return [...document.querySelectorAll(selector)]
    .filter((el) => !el.matches(skip) && !el.closest('[inert], [aria-hidden="true"]'))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .filter(({ rect }) => rect.width < min - 0.5 || rect.height < min - 0.5)
    .map(({ el, rect }) => {
      const name = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30);
      return `${el.tagName.toLowerCase()} "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    });
}

const { chromium } = loadPlaywright();
const only = parseOnly(process.argv.slice(2));
mkdirSync(outDir, { recursive: true });
if (!only) {
  for (const file of readdirSync(outDir))
    if (file.endsWith('.png')) rmSync(path.join(outDir, file));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(pageUrl);
const presets = await page.evaluate(() => window.vexto.presets);
const problems = [];

for (const [index, preset] of presets.entries()) {
  const file = `${String(index + 1).padStart(2, '0')}-${preset.name}.png`;
  if (only && !only.has(preset.name)) continue;
  await page.setViewportSize(VIEWPORT);
  await page.goto('about:blank');
  await page.goto(`${pageUrl}#${preset.name}`);
  await page.waitForFunction(
    (name) => document.documentElement.dataset.state === name,
    preset.name,
  );
  await page.evaluate(() => document.fonts.ready);
  const small = await page.evaluate(smallTargets, MIN_TARGET);
  if (small.length)
    problems.push(`${file}: touch targets under ${MIN_TARGET}px: ${small.join('; ')}`);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: VIEWPORT.width, height: Math.max(VIEWPORT.height, height) });
  await page.evaluate(() => window.vexto.relayout());
  await page.screenshot({
    path: path.join(outDir, file),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
  console.log(`${file}  ${preset.title}`);
}

await browser.close();
problems.push(...errors.map((error) => `page error: ${error}`));
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
