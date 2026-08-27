"use client";
import { useEffect, useState } from "react";

import type { Kind } from "../../domain/types";
import { KIND_COLOURS, fallbackColour, productColourFromImage } from "./colour";

/**
 * Loads a product image (CORS anonymous) only to sample its colour; the image is never kept as a
 * texture. The kind default shows until the sample lands, and stays when the image cannot
 * load or the canvas is tainted.
 */
export function useProductColour(imageUrl: string | null, kind: Kind): string {
  const [colour, setColour] = useState(KIND_COLOURS[kind]);

  useEffect(() => {
    setColour(KIND_COLOURS[kind]);
    if (!imageUrl) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!cancelled) setColour(fallbackColour(productColourFromImage(image), kind));
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.src = "";
    };
  }, [imageUrl, kind]);

  return colour;
}
