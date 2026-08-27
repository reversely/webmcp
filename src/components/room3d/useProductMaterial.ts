"use client";
import { useEffect, useState } from "react";
import { SRGBColorSpace, Texture, TextureLoader } from "three";

import type { Category } from "../../domain/types";
import { CATEGORY_COLOURS, averageColourFromImage, fallbackColour } from "./colour";

export type ProductMaterial = { map: Texture | null; colour: string };

/**
 * Loads a product image as a texture (CORS anonymous) and derives the flat colour used on the
 * plain faces and as the fallback when the image cannot load. The texture is disposed when the
 * URL changes or the component unmounts.
 */
export function useProductMaterial(imageUrl: string | null, category: Category): ProductMaterial {
  const [state, setState] = useState<ProductMaterial>({ map: null, colour: CATEGORY_COLOURS[category] });

  useEffect(() => {
    setState({ map: null, colour: CATEGORY_COLOURS[category] });
    if (!imageUrl) return;
    let cancelled = false;
    let loaded: Texture | null = null;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      imageUrl,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        loaded = texture;
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        setState({ map: texture, colour: fallbackColour(averageColourFromImage(texture.image), category) });
      },
      undefined,
      () => {
        if (!cancelled) setState({ map: null, colour: CATEGORY_COLOURS[category] });
      }
    );
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [imageUrl, category]);

  return state;
}
