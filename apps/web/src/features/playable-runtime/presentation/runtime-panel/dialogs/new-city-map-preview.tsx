import { useEffect, useRef } from 'react';

import { Tile } from '../../../../../../../../packages/sim-core/src/core/constants.ts';
import { getTileDebugColor, toDrawTileId } from '../../../../../presentation/map/tile-renderer.ts';

const NEW_CITY_PREVIEW_DIRT_HEX_COLOR = '#cdbb8a';

interface NewCityMapPreviewProps {
  width: number;
  height: number;
  tileWords: Uint16Array;
}

/**
 * Compact New City terrain preview raster for the dialog surface.
 * Mirrors C map tile-word visualization inputs from `ref/micropolis/src/sim/g_map.c`.
 * Difference: this renders a browser canvas mini-map using debug terrain colors
 * instead of the full Micropolis map-view sprite pipeline.
 */
export function NewCityMapPreview(props: NewCityMapPreviewProps) {
  const { width, height, tileWords } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    const imageData = context.createImageData(width, height);
    const colorCache = new Map<string, readonly [number, number, number]>();
    const pixelData = imageData.data;
    const tileCount = width * height;

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const tileWord = tileWords[tileIndex] ?? 0;
      const hexColor =
        toDrawTileId(tileWord) === Tile.DIRT
          ? NEW_CITY_PREVIEW_DIRT_HEX_COLOR
          : getTileDebugColor(tileWord);
      let rgb = colorCache.get(hexColor);
      if (rgb === undefined) {
        rgb = parseHexColor(hexColor);
        colorCache.set(hexColor, rgb);
      }

      const pixelIndex = tileIndex * 4;
      pixelData[pixelIndex] = rgb[0];
      pixelData[pixelIndex + 1] = rgb[1];
      pixelData[pixelIndex + 2] = rgb[2];
      pixelData[pixelIndex + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
  }, [height, tileWords, width]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto h-auto w-full max-w-60 rounded border border-(--color-window-frame) bg-black [image-rendering:pixelated]"
      height={height}
      width={width}
      aria-label="New city terrain preview"
    />
  );
}

/**
 * Parses one `#rrggbb` CSS color string.
 * Mirrors fixed tile color table usage in Micropolis map rendering (`g_map.c`),
 * adapted to browser canvas pixel buffers.
 */
function parseHexColor(color: string): readonly [number, number, number] {
  const normalized = color.startsWith('#') ? color.slice(1) : color;
  if (normalized.length !== 6) {
    return [0, 0, 0] as const;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return [0, 0, 0] as const;
  }
  return [r, g, b] as const;
}
