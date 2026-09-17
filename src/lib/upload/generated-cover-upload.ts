import type { CoverArtExportPreset } from '@/design-system/presets/cover-art-presets';
import { getCoverArtRasterFilename, svgToRasterBlob } from '@/design-system/presets/cover-art-raster';
import { uploadImageFile } from './image-upload-client';

export function createGeneratedCoverFile(blob: Blob, filename: string, mimeType: CoverArtExportPreset['mimeType']) {
  return new File([blob], filename, { type: mimeType });
}

/**
 * Rasterise and upload the artwork.
 *
 * Takes the structural subset it actually reads rather than a whole named
 * preset, so a caller with custom export settings can use it without having to
 * invent an id, a display name and a safe-area inset it has no opinion about.
 * `svgToRasterBlob` already takes the same shape.
 */
export async function uploadGeneratedCoverArt(
  svg: string,
  svgFilename: string,
  preset: Pick<CoverArtExportPreset, 'width' | 'height' | 'mimeType' | 'quality'>,
) {
  const rasterBlob = await svgToRasterBlob(svg, preset);
  const rasterFilename = getCoverArtRasterFilename(svgFilename, preset);
  return uploadImageFile(createGeneratedCoverFile(rasterBlob, rasterFilename, preset.mimeType));
}
