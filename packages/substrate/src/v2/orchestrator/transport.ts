/**
 * Substrate v2 — Orchestration transport interface.
 *
 * The transport is the seam between substrate's step engine and an
 * attached AI surface (Claude Code, Cursor, MCP, plain stdout). When a
 * transport is attached, AI-step handlers (`prompt`,
 * `prompt-and-action`, `gate` with `must-confirm: true`) round-trip
 * prompts and confirmations through it. When no transport is attached,
 * substrate runs in "no-transport" mode — prompts emit as session-log
 * events with `null` responses, gates default to approved, and the
 * step engine remains fully deterministic for testing + CI.
 *
 * v2.0 intentionally underspecifies the transport contract. We ship
 * ONE built-in transport (the no-op / stdout transport) and document
 * the shape; downstream integrators write their own. v2.1 will
 * harden the contract once Claude Code / Cursor adapters exist as
 * separate packages.
 *
 * Layer: orchestration. The transport interface is a public extension
 * point.
 */

export interface EmitPromptArgs {
  /** Step id the prompt originates from. */
  stepId: string;
  /** Fully-rendered prompt body (template substitution applied). */
  prompt: string;
  /** When true, the caller is expected to follow up with `confirm`. */
  mustConfirm: boolean;
}

export interface ConfirmArgs {
  stepId: string;
  prompt: string;
  /** The response the AI gave (may be null for gates with no prompt). */
  response: string | null;
}

export interface PresentDiffArgs {
  stepId: string;
  /** Response from the AI describing the action it wants to apply. */
  response: string;
}

/**
 * Transport contract — implement to attach an AI surface. All methods
 * are optional except `emitPrompt`; substrate degrades gracefully when
 * methods are absent.
 */
export interface OrchestrationTransport {
  /** Send a prompt; return the AI's response (string) or null. */
  emitPrompt(args: EmitPromptArgs): Promise<string | null>;
  /** Ask the user (or AI) to approve / reject. */
  confirm(args: ConfirmArgs): Promise<boolean>;
  /** Optionally render a diff for the user. Advisory; failures are
   *  ignored. */
  presentDiff?(args: PresentDiffArgs): Promise<string>;
}

/**
 * Built-in no-op transport. Logs prompts to nothing (the session log
 * captures them already); auto-approves confirms; returns the original
 * response from `presentDiff`. Used by `--dry-run` and tests.
 */
export const NO_OP_TRANSPORT: OrchestrationTransport = {
  async emitPrompt(): Promise<string | null> {
    return null;
  },
  async confirm(): Promise<boolean> {
    return true;
  },
  async presentDiff(args): Promise<string> {
    return args.response;
  },
};
