// Prints the fulfillment part of one shop's create_checkout reply, to see where the delivery option sits.
import { probeCheckout } from "@webmcp/shopify-ucp";
const [host, variant] = process.argv.slice(2);
const p = await probeCheckout(host, { variantId: variant, destination: { address_locality: "Toronto", address_region: "ON", postal_code: "M6H 2A8", address_country: "CA", street_address: "Geary Avenue" } });
console.log("status:", p.payload?.status, "error:", p.error);
console.log("fulfillment:", JSON.stringify(p.payload?.fulfillment, null, 1).slice(0, 1500));
console.log("messages:", JSON.stringify(p.payload?.messages).slice(0, 300));
