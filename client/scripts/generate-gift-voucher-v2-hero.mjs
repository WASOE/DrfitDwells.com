import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(scriptDir, '../../package.json'));
const sharp = require('sharp');
const publicDir = path.resolve(scriptDir, '../public/media/gift-vouchers');
const source = path.join(publicDir, 'gift-voucher-hero.jpg');
const reference = path.join(publicDir, 'gift-voucher-v2-hero.jpg');
const widths = [480, 800, 1200, 1600, 2400];

async function main() {
  if (!fs.existsSync(source) || !fs.existsSync(reference)) {
    throw new Error('Both the authorized hero original and V2 crop reference are required.');
  }

  const [sourceMetadata, referenceMetadata] = await Promise.all([
    sharp(source).rotate().metadata(),
    sharp(reference).metadata()
  ]);
  if (!sourceMetadata.width || !sourceMetadata.height || !referenceMetadata.width || !referenceMetadata.height) {
    throw new Error('Unable to read hero image dimensions.');
  }

  const cropWidth = sourceMetadata.width;
  const targetRatio = referenceMetadata.width / referenceMetadata.height;
  const cropHeight = Math.round(cropWidth / targetRatio);
  if (cropHeight > sourceMetadata.height) {
    throw new Error('The original hero is too small to preserve the V2 crop.');
  }
  const top = Math.floor((sourceMetadata.height - cropHeight) / 2);
  const formats = {
    avif: (image) => image.avif({ quality: 48, effort: 6 }),
    webp: (image) => image.webp({ quality: 78, effort: 5 }),
    jpg: (image) => image.jpeg({ quality: 84, mozjpeg: true })
  };

  for (const width of widths) {
    const height = Math.round(width / targetRatio);
    for (const [extension, encode] of Object.entries(formats)) {
      const output = path.join(publicDir, `gift-voucher-v2-hero-${width}w.${extension}`);
      await encode(
        sharp(source)
          .rotate()
          .extract({ left: 0, top, width: cropWidth, height: cropHeight })
          .resize(width, height, { fit: 'fill' })
      ).toFile(output);
    }
  }
}

main().catch((error) => {
  console.error('[generate-gift-voucher-v2-hero]', error);
  process.exitCode = 1;
});
