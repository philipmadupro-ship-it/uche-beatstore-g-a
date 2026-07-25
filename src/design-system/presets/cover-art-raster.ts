import type { CoverArtExportPreset } from './cover-art-presets';

const rasterExtensions: Record<CoverArtExportPreset['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function getCoverArtRasterFilename(svgFilename: string, preset: Pick<CoverArtExportPreset, 'mimeType'>) {
  const extension = rasterExtensions[preset.mimeType];
  return svgFilename.replace(/\.svg$/i, `.${extension}`);
}

export async function svgToRasterBlob(svg: string, preset: Pick<CoverArtExportPreset, 'width' | 'height' | 'mimeType' | 'quality'>) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to load rendered cover SVG for raster export.'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering is not available in this browser.');
    }

    context.drawImage(image, 0, 0, preset.width, preset.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((rasterBlob) => {
        if (!rasterBlob) {
          reject(new Error('Unable to rasterize cover artwork.'));
          return;
        }
        resolve(rasterBlob);
      }, preset.mimeType, preset.quality);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
