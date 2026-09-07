import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SessionStartJob {
  reservation_id: string;
  account_id: string;
  ends_at: string;
  claim_token: string;
  enabled_models: string[];
}
export interface SessionStartDatabase {
  claimSessionStarts(): Promise<SessionStartJob[]>;
  updateSessionStart(id: string, token: string, status: string, detail: string | null): Promise<boolean>;
}
interface StartupWorker {
  ready: boolean;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  refreshSnapshot(): Promise<unknown>;
}

/** Runs on the host independently of user activation. Database claims prevent
 * multiple hosts/restarts from submitting the same startup turn twice.
 * Ambiguous submissions remain visible for investigation; they are not resent.
 */
export class SessionStarter {
  private running = false;
  constructor(private db: SessionStartDatabase, private workerFor: (accountId: string) => Promise<StartupWorker>,
    private log: (message: string, error: unknown) => void) {}

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.db.claimSessionStarts();
      await Promise.all(jobs.map(job => this.start(job)));
    } finally { this.running = false; }
  }

  private async start(job: SessionStartJob): Promise<void> {
    let submitted = false;
    let cwd: string | undefined;
    let threadId: string | undefined;
    try {
      if (Date.parse(job.ends_at) <= Date.now()) throw new Error("Reservation ended before startup.");
      const worker = await this.workerFor(job.account_id);
      if (!worker.ready) throw new Error("Account is not ready.");
      const catalog = await worker.request("model/list") as { data?: Array<{id?: string; model?: string}> };
      const available = catalog.data ?? [];
      const model = job.enabled_models.find(id => available.some(item => item.id === id || item.model === id));
      if (!model) throw new Error("No enabled model is available for startup.");
      cwd = await fs.mkdtemp(path.join(os.tmpdir(), "fecart-session-start-"));
      const result = await worker.request("thread/start", {
        model, cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
        baseInstructions: "Reply only OK. Do not inspect files, run commands, browse, or call tools.",
      }) as { thread?: { id?: string } };
      threadId = result.thread?.id;
      if (!threadId) throw new Error("Startup thread was not created.");
      if (Date.parse(job.ends_at) <= Date.now()) throw new Error("Reservation ended before message submission.");
      if (!await this.db.updateSessionStart(job.reservation_id, job.claim_token, "submitting", threadId)) return;
      submitted = true;
      const turn = await worker.request("turn/start", {
        threadId, input: [{ type: "text", text: "Session started. Reply only OK.", text_elements: [] }],
      }) as { turn?: { id?: string; status?: string } };
      if (!turn.turn?.id) throw new Error("Startup message acknowledgement missing.");
      if (turn.turn.status === "failed" || turn.turn.status === "interrupted") throw new Error("Startup turn was not accepted.");
      await this.db.updateSessionStart(job.reservation_id, job.claim_token, "submitted", threadId);
      // Refresh provider telemetry after acknowledgement; never alter reservation expiry.
      const deadline = Math.min(Date.now() + 60_000, Date.parse(job.ends_at));
      let completed = false;
      while (Date.now() < deadline) {
        const state = await worker.request("thread/read", { threadId, includeTurns: true }) as {
          thread?: { turns?: Array<{ id: string; status: string }> }
        };
        const current = state.thread?.turns?.find(item => item.id === turn.turn?.id);
        if (current?.status === "completed") { completed = true; break; }
        if (current?.status === "failed" || current?.status === "interrupted") throw new Error("Startup turn failed after acknowledgement.");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!completed) {
        await worker.request("turn/interrupt", { threadId, turnId: turn.turn.id }).catch(() => undefined);
        throw new Error("Startup completion could not be verified before deadline.");
      }
      await this.db.updateSessionStart(job.reservation_id, job.claim_token, "completed", threadId);
      await worker.refreshSnapshot().catch(error => this.log("session.start.telemetry", error));
    } catch (error) {
      this.log("session.start", error);
      await this.db.updateSessionStart(job.reservation_id, job.claim_token,
        submitted ? "uncertain" : "retry", submitted ? (threadId ?? "Submission outcome unknown") : "Startup preparation failed; check host log.")
        .catch(e => this.log("session.start.persist", e));
    } finally {
      if (cwd) await fs.rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
