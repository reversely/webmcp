/**
 * Steps that follow ingestion but are owned by other pipelines. Each is a no-op until its
 * pipeline lands; `ingestProductUrl` calls them after the store commits so the product card
 * exists before either starts.
 */
import type { Candidate, Product } from "../types";

export function startModelGeneration(_product: Product): void {}

export function startVisualEvaluation(_candidate: Candidate): void {}
