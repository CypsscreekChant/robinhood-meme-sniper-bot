import fs from 'node:fs';
import path from 'node:path';
export interface Candidate { pair: string; token: string; block: number; hash: string; created: number; next: number }
export interface Position { pair: string; token: string; amount: string; cost: string; opened: number }
export interface State { version: 1; identity: string; cursor: number; candidates: Candidate[]; seen: string[]; positions: Position[]; day: string; spent: string; pending?: { kind: string; hash?: string; time: number } }
export class Store {
  state: State; file: string;
  constructor(dir: string, mode: string, identity: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, `${mode}.json`);
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, identity, cursor: -1, candidates: [], seen: [], positions: [], day: '', spent: '0' };
    if (this.state.version !== 1 || this.state.identity !== identity) throw new Error('State identity mismatch; use a separate DATA_DIR');
  }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2), {mode: 0o600}); fs.renameSync(this.file + '.tmp', this.file); }
  daily() { const day = new Date().toISOString().slice(0, 10); if (this.state.day !== day) { this.state.day = day; this.state.spent = '0'; this.save(); } }
}
export class LockError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'LockError'; }
}
function isMissingProcess(pid: number) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}
export function acquireLock(dir: string, mode: string) {
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const file = path.join(dir, `${mode}.lock`);
  const create = () => {
    const fd = fs.openSync(file, 'wx', 0o600);
    const owned = fs.fstatSync(fd);
    try { fs.writeSync(fd, String(process.pid)); }
    catch (error) { fs.closeSync(fd); fs.unlinkSync(file); throw error; }
    return () => {
      fs.closeSync(fd);
      try {
        const current = fs.statSync(file);
        if (current.dev === owned.dev && current.ino === owned.ino && fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    };
  };
  try { return create(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  // Serialize stale-lock recovery so two starters cannot remove each other's lock.
  const guard = `${file}.recovery`;
  let recovery: number;
  try { recovery = fs.openSync(guard, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new LockError('LOCK_RECOVERY_BUSY', 'Another process is recovering the run lock. Retry shortly; see README if the recovery guard persists.');
  }
  try {
    if (!fs.existsSync(file)) return create();
    const raw = fs.readFileSync(file, 'utf8').trim();
    const pid = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) {
      throw new LockError('INVALID_LOCK_FILE', 'Run lock contains no valid PID. Verify that no bot process is running before removing it.');
    }
    if (!isMissingProcess(pid)) {
      throw new LockError('BOT_ALREADY_RUNNING', `Run lock belongs to active or inaccessible process ${pid}. Stop the existing process before starting another instance.`);
    }
    fs.unlinkSync(file);
    return create();
  } finally { fs.closeSync(recovery); fs.unlinkSync(guard); }
}
