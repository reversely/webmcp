"use client";
import type { Product } from "../../../../domain/types";
import { QuestionArtifact } from "./question-artifact";
import { RankingArtifact } from "./ranking-artifact";
import { SourcingArtifact } from "./sourcing-artifact";
import type { Artifact } from "./types";

export { latestArtifact, type Artifact, type ArtifactMessage } from "./types";

/**
 * Renders one chat artifact in the stream. Spec and room-estimate artifacts have no chat card:
 * the board and room stages read them directly, so the message's text alone shows here.
 */
export function ArtifactView({ artifact, title, products, onSend, sending }: { artifact: Artifact; title?: string; products: Product[]; onSend: (text: string) => void; sending?: boolean }) {
  switch (artifact.kind) {
    case "sourcing":
      return <SourcingArtifact data={artifact.data} products={products} title={title || undefined} />;
    case "ranking":
      return <RankingArtifact data={artifact.data} title={title || undefined} onApprove={() => onSend("approve")} approving={sending} />;
    case "question":
      return <QuestionArtifact data={artifact.data} />;
    default:
      return null;
  }
}
