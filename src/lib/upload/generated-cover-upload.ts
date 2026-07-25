import type { CoverArtExportPreset } from '@/design-system/presets/cover-art-presets';
import { getCoverArtRasterFilename, svgToRasterBlob } from '@/design-system/presets/cover-art-raster';
import { uploadImageFile } from './image-upload-client';

export function createGeneratedCoverFile(blob: Blob, filename: string, mimeType: CoverArtExportPreset['mimeType']) {
  return new File([blob], filename, { type: mimeType });
}

export async function uploadGeneratedCoverArt(
  svg: string,
  svgFilename: string,
  preset: CoverArtExportPreset,
) {
  const rasterBlob = await svgToRasterBlob(svg, preset);
  const rasterFilename = getCoverArtRasterFilename(svgFilename, preset);
  return uploadImageFile(createGeneratedCoverFile(rasterBlob, rasterFilename, preset.mimeType));
}
