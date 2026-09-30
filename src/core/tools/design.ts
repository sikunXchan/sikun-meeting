import * as fs from 'fs';
import * as path from 'path';
import { resolveReadable } from './data';
import { importEsm } from './esm';
import type { Scope } from './docs';

/**
 * デザイン系ツール。色のコントラスト（WCAG 2.2）、配色の生成と比較、画像の情報と差分、SVGの最適化。
 * 色の変換と色差は culori、画像は image-size・pngjs・jpeg-js・pixelmatch、SVGは svgo を使う。
 */

type Rgb = { r: number; g: number; b: number; alpha?: number };

async function color(value: unknown, label: string): Promise<Rgb> {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} に色を指定してください（例: #1a73e8, rgb(0 0 0 / 50%), hsl(210 80% 40%), oklch(0.6 0.15 250), navy）`);
  const culori = await importEsm('culori');
  const parsed = culori.parse(value.trim());
  if (!parsed) throw new Error(`${label} を色として読めません: ${value}`);
  const rgb = culori.converter('rgb')(parsed);
  return { r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b), alpha: rgb.alpha };
}
const clamp = (value: number) => Math.min(1, Math.max(0, value ?? 0));
const hex = (value: Rgb) => `#${[value.r, value.g, value.b].map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;

/** 半透明の前景色を背景に重ねた色（WCAGのコントラストは合成後の色で測る）。 */
function over(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.alpha ?? 1;
  return { r: foreground.r * alpha + background.r * (1 - alpha), g: foreground.g * alpha + background.g * (1 - alpha), b: foreground.b * alpha + background.b * (1 - alpha) };
}

/** WCAG 2.x の相対輝度とコントラスト比。 */
function luminance(value: Rgb): number {
  const linear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(value.r) + 0.7152 * linear(value.g) + 0.0722 * linear(value.b);
}
function ratio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
function grade(value: number) {
  return {
    ratio: Number(value.toFixed(2)),
    normalTextAA: value >= 4.5, normalTextAAA: value >= 7,
    largeTextAA: value >= 3, largeTextAAA: value >= 4.5,
    uiComponentsAA: value >= 3,
  };
}

export async function colorContrast(foregroundInput: unknown, backgroundInput: unknown) {
  const background = await color(backgroundInput, 'background');
  if ((background.alpha ?? 1) < 1) throw new Error('背景色は不透明にしてください（重なる下地の色が分からないため）');
  const foreground = over(await color(foregroundInput, 'foreground'), background);
  return {
    foreground: hex(foreground), background: hex(background), ...grade(ratio(foreground, background)),
    note: '基準: WCAG 2.2 のコントラスト比（通常文字 AA 4.5:1 / AAA 7:1、大きい文字（18pt以上または太字14pt以上）AA 3:1、UI部品 3:1）。半透明の前景は背景と合成して測定',
  };
}

/** 基準色から OKLCH の明度を段階的に変えた配色を作り、白・黒の文字とのコントラストを添える。 */
export async function colorPalette(baseInput: unknown, stepsInput: unknown = 9) {
  const steps = Number(stepsInput);
  if (!Number.isInteger(steps) || steps < 3 || steps > 15) throw new Error('steps は3〜15にしてください');
  const culori = await importEsm('culori');
  const base = await color(baseInput, 'base');
  const oklch = culori.converter('oklch')({ mode: 'rgb', ...base });
  const white = { r: 1, g: 1, b: 1 }, black = { r: 0, g: 0, b: 0 };
  const colors = Array.from({ length: steps }, (_, i) => {
    const lightness = 0.97 - (0.97 - 0.2) * (i / (steps - 1));
    const rgb = culori.converter('rgb')(culori.clampChroma({ mode: 'oklch', l: lightness, c: oklch.c ?? 0, h: oklch.h }, 'oklch'));
    const value = { r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) };
    const onWhite = ratio(value, white), onBlack = ratio(value, black);
    return { step: (i + 1) * 100, hex: hex(value), lightness: Number(lightness.toFixed(3)), contrastWithWhiteText: Number(onWhite.toFixed(2)), contrastWithBlackText: Number(onBlack.toFixed(2)), readableText: onWhite >= onBlack ? '#ffffff' : '#000000' };
  });
  return { base: hex(base), colors, note: 'OKLCH の明度を 0.97〜0.2 で等分し、彩度は表示できる範囲に収めた。readableText はコントラストが高い方の文字色' };
}

/** 複数の色の全組み合わせについて、コントラスト比と色差（CIEDE2000）を返す。似すぎた色・読めない組み合わせの発見に使う。 */
export async function compareColors(colorsInput: unknown) {
  if (!Array.isArray(colorsInput) || colorsInput.length < 2 || colorsInput.length > 30) throw new Error('colors は2〜30色の配列にしてください');
  const culori = await importEsm('culori');
  const difference = culori.differenceCiede2000();
  const entries = await Promise.all(colorsInput.map(async (value, i) => {
    const name = typeof value === 'object' && value ? String((value as { name?: unknown }).name ?? `color${i + 1}`) : String(value);
    const raw = typeof value === 'object' && value ? (value as { color?: unknown }).color : value;
    return { name, rgb: await color(raw, name) };
  }));
  const pairs = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i], b = entries[j];
    const deltaE = difference({ mode: 'rgb', ...a.rgb }, { mode: 'rgb', ...b.rgb });
    const contrast = ratio(a.rgb, b.rgb);
    pairs.push({ a: a.name, b: b.name, contrast: Number(contrast.toFixed(2)), deltaE2000: Number(deltaE.toFixed(2)), nearlyIdentical: deltaE < 5, textAA: contrast >= 4.5 });
  }
  return { colors: entries.map((entry) => ({ name: entry.name, hex: hex(entry.rgb) })), pairs, note: 'ΔE2000 がおよそ5未満だと見分けにくい。textAA は通常文字の WCAG AA（4.5:1）を満たすか' };
}

type Decoded = { width: number; height: number; data: Buffer | Uint8Array };

function decode(file: string): Decoded | undefined {
  const extension = path.extname(file).toLowerCase();
  const buffer = fs.readFileSync(file);
  if (extension === '.png') { const { PNG } = require('pngjs') as typeof import('pngjs'); return PNG.sync.read(buffer); }
  if (extension === '.jpg' || extension === '.jpeg') { const jpeg = require('jpeg-js') as typeof import('jpeg-js'); return jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 512, formatAsRGBA: true }); }
  return undefined;
}

/** 画像の形式・大きさ・透過の有無と、PNG / JPEG の主要な色（上位8色）・平均色を返す。 */
export async function imageInfo(file: string, scope: Scope) {
  const target = resolveReadable(file, scope.workingDirectory, scope.readableDirectories);
  const { imageSize } = require('image-size') as typeof import('image-size');
  const size = imageSize(fs.readFileSync(target));
  const result: Record<string, unknown> = {
    file: path.relative(scope.workingDirectory, target) || path.basename(target), format: size.type,
    width: size.width, height: size.height, bytes: fs.statSync(target).size,
    aspectRatio: size.width && size.height ? Number((size.width / size.height).toFixed(4)) : undefined,
  };
  const decoded = decode(target);
  if (decoded) {
    const buckets = new Map<string, number>();
    let transparent = 0, sampled = 0, sum = [0, 0, 0];
    const step = Math.max(1, Math.floor((decoded.width * decoded.height) / 250_000));
    for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += step) {
      const offset = pixel * 4, alpha = decoded.data[offset + 3];
      sampled++;
      if (alpha < 128) { transparent++; continue; }
      const [r, g, b] = [decoded.data[offset], decoded.data[offset + 1], decoded.data[offset + 2]];
      sum = [sum[0] + r, sum[1] + g, sum[2] + b];
      const key = [r, g, b].map((channel) => (channel >> 4) * 17).join(',');
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const opaque = sampled - transparent;
    result.hasTransparency = transparent > 0;
    result.transparentRatio = Number((transparent / sampled).toFixed(3));
    if (opaque) result.averageColor = hex({ r: sum[0] / opaque / 255, g: sum[1] / opaque / 255, b: sum[2] / opaque / 255 });
    result.dominantColors = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { hex: hex({ r: r / 255, g: g / 255, b: b / 255 }), share: Number((count / opaque).toFixed(3)) };
    });
  } else result.note = '主要な色の解析は PNG / JPEG のみ';
  return result;
}

/** 2枚の画像（PNG / JPEG、同じ大きさ）の差分。違うピクセルの数と割合、差分を赤で示した画像を返す。修正前後の見た目の変化の確認に使う。 */
export async function compareImages(beforeFile: string, afterFile: string, scope: Scope, thresholdInput: unknown = 0.1) {
  const threshold = Number(thresholdInput);
  if (!(threshold >= 0 && threshold <= 1)) throw new Error('threshold は0〜1にしてください（小さいほど厳しい）');
  const [a, b] = [beforeFile, afterFile].map((file) => resolveReadable(file, scope.workingDirectory, scope.readableDirectories));
  const [imageA, imageB] = [decode(a), decode(b)];
  if (!imageA || !imageB) throw new Error('比較できるのは PNG / JPEG です');
  if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
    return { sameSize: false, before: { width: imageA.width, height: imageA.height }, after: { width: imageB.width, height: imageB.height }, note: '大きさが違うため比較していない。同じ画面幅で撮り直す' };
  }
  const { PNG } = require('pngjs') as typeof import('pngjs');
  const pixelmatch = (await importEsm('pixelmatch')).default;
  const output = new PNG({ width: imageA.width, height: imageA.height });
  const changed: number = pixelmatch(imageA.data, imageB.data, output.data, imageA.width, imageA.height, { threshold });
  const total = imageA.width * imageA.height;
  const summary = { sameSize: true, width: imageA.width, height: imageA.height, changedPixels: changed, changedRatio: Number((changed / total).toFixed(5)), identical: changed === 0 };
  if (!changed) return summary;
  const png = PNG.sync.write(output);
  if (png.length > 4 * 1024 * 1024) return { ...summary, note: '差分画像が大きいため省略' };
  return { mcpContent: [
    { type: 'text', text: JSON.stringify({ ...summary, note: '画像は差分（変化したピクセルを赤で表示）' }, null, 2) },
    { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
  ] };
}

/** SVG を svgo で最適化した結果（サイズの変化と最適化後のコード）と、よくある問題（viewBox なし・title なし・script・外部参照・埋め込みラスター画像）を返す。ファイルは変更しない。 */
export async function optimizeSvg(file: string, scope: Scope) {
  const target = resolveReadable(file, scope.workingDirectory, scope.readableDirectories);
  if (path.extname(target).toLowerCase() !== '.svg') throw new Error('SVG ファイルを指定してください');
  const source = fs.readFileSync(target, 'utf8');
  const { optimize } = await importEsm('svgo');
  const result = optimize(source, { multipass: true, path: target });
  const root = /<svg\b[^>]*>/i.exec(source)?.[0] ?? '';
  const issues: string[] = [];
  if (!/\bviewBox=/i.test(root)) issues.push('viewBox がないため、拡大縮小で崩れる可能性がある');
  if (/\b(width|height)=["']\d/.test(root)) issues.push('ルートに固定の width / height がある（CSS で大きさを決める場合は外す）');
  if (!/<title\b/i.test(source) && !/aria-label=/i.test(root)) issues.push('<title> も aria-label もない（意味のある画像なら代替テキストが必要）');
  if (/<script\b/i.test(source) || /\son\w+\s*=/i.test(source)) issues.push('script またはイベント属性がある（安全のため除く）');
  if (/(?:xlink:)?href=["']https?:/i.test(source)) issues.push('外部URLを参照している');
  if (/<image\b[^>]*href=["']data:image\/(png|jpe?g)/i.test(source)) issues.push('ラスター画像を埋め込んでいる（拡大すると粗くなる）');
  const output: string = result.data;
  return {
    file: path.relative(scope.workingDirectory, target) || path.basename(target),
    bytesBefore: Buffer.byteLength(source), bytesAfter: Buffer.byteLength(output),
    reduction: Number((1 - Buffer.byteLength(output) / Math.max(1, Buffer.byteLength(source))).toFixed(3)),
    issues, optimized: output.length > 50_000 ? `${output.slice(0, 50_000)}…（省略）` : output,
  };
}
