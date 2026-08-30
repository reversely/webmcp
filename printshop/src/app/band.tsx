import Link from "next/link";
import { shop } from "../domain/store";
import { WebMcpProvider } from "./webmcp-provider";

/** The night band over every page: the shop's name on the left and the tools' status on the right (design language). */
export function Band() {
  return (
    <header className="band">
      <Link href="/" className="brand">{shop().name}</Link>
      <div className="right"><WebMcpProvider /></div>
    </header>
  );
}
