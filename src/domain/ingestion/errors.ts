export class InvalidProductUrlError extends Error {
  constructor(readonly url: string) {
    super(`${url} is not a Shopify product URL (expected https://{shop}/products/{handle})`);
    this.name = "InvalidProductUrlError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(
    readonly url: string,
    readonly endpoints: string[]
  ) {
    super(`${url} was not found in the catalog (tried ${endpoints.join(", ")})`);
    this.name = "ProductNotFoundError";
  }
}
