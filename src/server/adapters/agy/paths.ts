import { join } from "node:path";

export const agyTranscriptPath = (home: string, id: string) =>
  join(home, "brain", id, ".system_generated", "logs", "transcript_full.jsonl");
