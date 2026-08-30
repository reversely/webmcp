import Link from "next/link";
import { designs, shop } from "../domain/store";
import { Band } from "./band";
import { fromPrice, money } from "./format";

/** Designs (PRD Section 7): one card per design row with its format and paper and the lowest band price and the lead time. */
export default function Page() {
  const s = shop();
  return (
    <>
      <Band />
      <main className="sheet">
        <div className="wrap">
          <div>
            <h1 className="title">Designs</h1>
            <div className="cards" data-testid="designs">
              {designs().map((d) => (
                <Link key={d.id} href={`/designs/${d.id}`} className="card" data-testid="design">
                  <h2>{d.title}</h2>
                  <span className="meta" data-testid="design-format">{d.format} {d.size}</span>
                  <span className="meta" data-testid="design-paper">{d.paper} {d.print_method}</span>
                  <span className="price" data-testid="design-price">from {money(fromPrice(d.price_bands), s.currency)} a unit</span>
                  <span className="meta" data-testid="design-lead">{d.lead_time_business_days} business days from order</span>
                </Link>
              ))}
            </div>
          </div>
          <aside className="side">
            <div className="dark-card" data-testid="shop">
              <div className="in">
                <h2>{s.name}</h2>
                <div className="kv"><span>Address</span><span>{s.address.line1} {s.address.city} {s.address.region} {s.address.postal_code}</span></div>
                <div className="kv"><span>Currency</span><span>{s.currency}</span></div>
                <div className="kv"><span>Delivers to</span><span>{s.ships_to_countries.join(" and ")}</span></div>
                <div className="kv"><span>Tax</span><span>{Math.round(s.tax_rate * 100)} percent</span></div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
