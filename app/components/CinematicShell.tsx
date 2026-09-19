import type { ReactNode } from "react";

export function CinematicShell({ conversation, stage }: { conversation: ReactNode; stage: ReactNode }) {
  return (
    <main className="cinematic-shell">
      <section className="conversation-panel">{conversation}</section>
      <section className="media-stage-shell">{stage}</section>
    </main>
  );
}
