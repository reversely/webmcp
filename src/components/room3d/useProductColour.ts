"use client";
import { useEffect, useState } from "react";

import type { Category } from "../../domain/types";
import { CATEGORY_COLOURS, fallbackColour, productColourFromImage } from "./colour";

/**
 * Loads a product image (CORS anonymous) only to sample its colour; the image is never kept as a
 * texture. The category default shows until the sample lands, and stays when the image cannot
 * load or the canvas is tainted.
 */
export function useProductColour(imageUrl: string | null, category: Category): string {
  const [colour, setColour] = useState(CATEGORY_COLOURS[category]);

  useEffect(() => {
    setColour(CATEGORY_COLOURS[category]);
    if (!imageUrl) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!cancelled) setColour(fallbackColour(productColourFromImage(image), category));
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.src = "";
    };
  }, [imageUrl, category]);

  return colour;
}
