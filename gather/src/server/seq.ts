import { currentSeq } from "../domain/store";

/** The latest change-log sequence number, returned with every MCP result so a caller can poll get_changes from it. */
export function readLatestSeq(): number {
  return currentSeq();
}
