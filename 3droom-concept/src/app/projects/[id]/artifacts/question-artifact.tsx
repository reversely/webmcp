"use client";
import type { QuestionData } from "./types";

/** PRD 5.2: the agent's one blocking question, shown as an agent message. Focusing the input is the chat's job. */
export function QuestionArtifact({ data }: { data: QuestionData }) {
  return (
    <div className="msg agent" data-testid="artifact-question" data-field={data.field} data-run-id={data.run_id}>
      {data.question}
    </div>
  );
}
