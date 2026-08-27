import fixture from "../../../commerce/fixtures/global-search-three-seat-sofa.json";
import { Room3DPreview } from "../../../components/room3d";

type FixtureProduct = { media?: { url: string }[] };

/** Development check for the R3F room: the demo layout textured with real product images. */
export default function Room3DDevPage() {
  const products = (fixture as { result: { structuredContent: { products: FixtureProduct[] } } }).result.structuredContent.products;
  const imageUrls = [...new Set(products.flatMap((p) => (p.media ?? []).map((m) => m.url)))];
  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <Room3DPreview imageUrls={imageUrls} />
    </main>
  );
}
