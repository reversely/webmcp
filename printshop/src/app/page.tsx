import { designs, shop } from "../domain/store";
import { WebMcpProvider } from "./webmcp-provider";

/** The design list (PRD Section 7); the full page lands with the pages ticket. */
export default function Page() {
  return (
    <main className="page">
      <header className="topbar"><span className="brand">{shop().name}</span><WebMcpProvider /></header>
      <section className="card">
        <ul className="notes" data-testid="designs">
          {designs().map((d) => (
            <li key={d.id} data-testid="design">{d.title} from {(d.price_bands[d.price_bands.length - 1].unit_cents / 100).toFixed(2)} {shop().currency}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
