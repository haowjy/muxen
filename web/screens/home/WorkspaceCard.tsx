// One workspace on Home (browser-behaviors.md "Home"): its server's name, the server's status in its status
// colour, and how many tabs are open; a tap opens it. What is wrong with the server sits under the row, with
// Retry where it helps. A view over props, so the harness can draw every state; `Home` derives them.
import type { ComponentChildren } from "preact";
import { BellDot } from "../../ui/primitives/BellDot";
import { Button } from "../../ui/primitives/Button";
import { Row } from "../../ui/primitives/Row";
import { ago } from "../../sessions/groups";
import { STATUS, type CardBody, type CardStatus } from "./card";
import styles from "./WorkspaceCard.module.css";

const STATUS_WORDS: Record<CardStatus, string> = { live: "connected", checking: "checking", offline: "offline", attention: "needs attention" };

export interface WorkspaceCardProps {
  name: string;
  /** Tabs open in the workspace. */
  tabs: number;
  /** A bell rang in one of them since this device last showed it. */
  bell: boolean;
  body: CardBody;
  /** What is wrong with the server, when something is: its host banner. */
  notice: ComponentChildren;
  /** The daemon can't read tmux's bell state on this server: said in words, never a silent dot-free tab. */
  bellsUnavailable: boolean;
  /** Looks at the server again: admission when it can't be reached, the sessions otherwise. */
  onRetry: () => void;
  /** Opens the workspace on its last tab, or its overview when it has none; absent while the server has no workspace to open yet. */
  onOpen: (() => void) | undefined;
}

function Note({ children }: { children: ComponentChildren }) {
  return <p class={styles.note}>{children}</p>;
}

function Body({ name, body, onRetry }: Pick<WorkspaceCardProps, "name" | "body" | "onRetry">) {
  const retry = <Button variant="secondary" icon="refresh" onClick={onRetry}>Retry</Button>;
  switch (body.kind) {
    case "offline":
      return (
        <>
          <Note>{body.reachedAt ? `Last reached ${ago(body.reachedAt)}.` : "Not reached since this page opened."} Check that it is on and on your tailnet.</Note>
          {retry}
        </>
      );
    case "attention":
      return <Note>muxen can't use {name} yet.</Note>;
    case "failed":
      return (
        <>
          <Note>Couldn't load the sessions on {name}.</Note>
          {retry}
        </>
      );
    case "noTmux":
      return (
        <>
          <Note>tmux isn't running on {name}. muxen never starts it: start tmux there, then retry.</Note>
          {retry}
        </>
      );
    case "checking":
    case "ok":
      return null;
  }
}

export function WorkspaceCard({ name, tabs, bell, body, notice, bellsUnavailable, onRetry, onOpen }: WorkspaceCardProps) {
  const status = STATUS[body.kind];
  return (
    <section class={styles.card} aria-label={name}>
      <Row
        icon="sessions"
        trailing="chevron"
        disabled={onOpen === undefined}
        mark={bell ? <BellDot /> : undefined}
        label={
          <span class={styles.text}>
            <span class={styles.name}>{name}</span>
            <span class={styles.line}>
              <span class={styles.status} data-status={status}>{STATUS_WORDS[status]}</span>
              <span>{tabs === 0 ? "no tabs" : `${String(tabs)} ${tabs === 1 ? "tab" : "tabs"}`}</span>
            </span>
          </span>
        }
        onClick={onOpen}
      />
      {notice}
      {bellsUnavailable && <Note>Bell tracking unavailable on this host</Note>}
      <Body name={name} body={body} onRetry={onRetry} />
    </section>
  );
}
