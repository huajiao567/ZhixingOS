#!/usr/bin/env python3
from pathlib import Path

path = Path('e2e/avatar-research-candidate.spec.ts')
text = path.read_text(encoding='utf-8')

old = "import { expect, test, type Page } from '@playwright/test';"
new = "import { expect, test, type Locator, type Page } from '@playwright/test';"
if text.count(old) != 1:
    raise SystemExit('unexpected Playwright import anchor')
text = text.replace(old, new, 1)

old = """async function capture(page: Page, name: string) {
  const dir = resolve('e2e', 'candidate-screenshots', test.info().project.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

"""
new = old + """async function clickAdjustableTrackEnd(page: Page, slider: Locator) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box || box.width < 8 || box.height < 8) {
    throw new Error(`adjustable slider has no usable bounding box: ${JSON.stringify(box)}`);
  }
  // Genuine pointer input through the rendered control. Do not mutate React state,
  // DOM values, or runtime probes directly from the test.
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
}

"""
if text.count(old) != 1:
    raise SystemExit('unexpected capture helper anchor')
text = text.replace(old, new, 1)

old = """    await eyeSizeSlider.scrollIntoViewIfNeeded();
    await eyeSizeSlider.press('End');
    await mouthWidthSlider.scrollIntoViewIfNeeded();
    await mouthWidthSlider.press('End');

"""
new = """    await clickAdjustableTrackEnd(page, eyeSizeSlider);
    await expect(page.getByLabel(/眼睛大小，当前仅保存，当前值 1\\.00/)).toBeVisible({ timeout: 10_000 });
    await clickAdjustableTrackEnd(page, mouthWidthSlider);
    await expect(page.getByLabel(/嘴宽，当前仅保存，当前值 1\\.00/)).toBeVisible({ timeout: 10_000 });

"""
if text.count(old) != 1:
    raise SystemExit('unexpected slider interaction anchor')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Replaced unsupported End-key interaction with real pointer track-end clicks.')
