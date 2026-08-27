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

/** Thrown when no category was given and the title matches no known keyword. */
export class CategoryRequiredError extends Error {
  constructor(readonly title: string) {
    super(`Could not infer a category from "${title}"; pass one of sofa, coffee_table, ottoman, rug, side_table`);
    this.name = "CategoryRequiredError";
  }
}
