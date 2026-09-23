import {AnsiOutputParser} from './AnsiOutputParser.js';
import type {SecondaryActivity} from './OutputBuffer.js';

/**
 * Observes Node's actual TAP v13 output protocol. This reports a test stream,
 * not a guessed child process: arbitrary subprocesses are not visible through
 * NMSh's aggregate PTY and are intentionally not inferred here.
 */
export class TapActivityObserver {
  private invalidated = false;
  private readonly parser = new AnsiOutputParser(() => {
    this.invalidated = true;
    this.activities = [];
  });
  private baseLineId = 0;
  private scannedLines = 0;
  private ordinal = 0;
  private activeFailures = 0;
  private activeSummaryEndId?: number;
  private activities: SecondaryActivity[] = [];

  reset(baseLineId: number): void {
    this.parser.restore([]);
    this.invalidated = false;
    this.baseLineId = baseLineId;
    this.scannedLines = 0;
    this.ordinal = 0;
    this.activeFailures = 0;
    this.activeSummaryEndId = undefined;
    this.activities = [];
  }

  push(chunk: string, now: number): SecondaryActivity[] {
    this.parser.write(chunk);
    if (this.invalidated) return [];
    while (this.scannedLines < this.parser.completedCount()) {
      const line = this.parser.plainLineAt(this.scannedLines) ?? '';
      this.observeLine(line, this.scannedLines, now);
      this.scannedLines += 1;
    }
    this.refreshActiveEnd();
    return this.snapshot();
  }

  finish(now: number): SecondaryActivity[] {
    if (this.invalidated) return [];
    if (this.parser.hasCurrentContent()) {
      this.observeLine(this.parser.plainCurrentLine(), this.scannedLines, now);
    }
    const active = this.activities.find(activity => activity.status === 'running');
    if (active) {
      if (this.activeSummaryEndId !== undefined) {
        active.outputEndId = this.activeSummaryEndId;
        active.status = this.activeFailures > 0 ? 'failed' : 'completed';
        active.completedAt = now;
        active.expanded = false;
      } else {
        // An incomplete TAP stream has no safe end boundary. Leave its raw
        // output in the parent record but do not persist a guessed child range.
        this.activities = this.activities.filter(activity => activity !== active);
      }
    }
    return this.snapshot();
  }

  private observeLine(line: string, lineOffset: number, now: number): void {
    if (/^TAP version 13$/u.test(line.trim())) {
      const previous = this.activities.find(activity => activity.status === 'running');
      if (previous) {
        if (this.activeSummaryEndId !== undefined) {
          previous.outputEndId = this.activeSummaryEndId;
          previous.status = this.activeFailures > 0 ? 'failed' : 'completed';
          previous.completedAt = now;
          previous.expanded = false;
        } else {
          this.activities = this.activities.filter(activity => activity !== previous);
        }
      }
      this.ordinal += 1;
      this.activeFailures = 0;
      this.activeSummaryEndId = undefined;
      this.activities.push({
        id: `tap-${this.baseLineId}-${this.ordinal}`,
        kind: 'tap-stream',
        label: 'TAP test stream',
        startedAt: now,
        status: 'running',
        outputStartId: this.baseLineId + lineOffset,
        outputEndId: this.baseLineId + lineOffset + 1,
        expanded: true,
      });
      return;
    }

    const active = this.activities.find(activity => activity.status === 'running');
    if (!active) return;
    if (this.activeSummaryEndId !== undefined) {
      if (/^# (?:cancelled|skipped|todo) \d+$/u.test(line)) {
        this.activeSummaryEndId = this.baseLineId + lineOffset + 1;
        return;
      }
      if (/^# duration_ms [\d.]+$/u.test(line)) {
        active.status = this.activeFailures > 0 ? 'failed' : 'completed';
        active.completedAt = now;
        active.outputEndId = this.baseLineId + lineOffset + 1;
        active.expanded = false;
        this.activeSummaryEndId = undefined;
        return;
      }
      // Do not claim ordinary output following the protocol summary.
      active.status = this.activeFailures > 0 ? 'failed' : 'completed';
      active.completedAt = now;
      active.outputEndId = this.activeSummaryEndId;
      active.expanded = false;
      this.activeSummaryEndId = undefined;
      return;
    }
    const summary = /^# tests (\d+)$/u.exec(line);
    if (summary) active.label = `TAP test stream · ${summary[1]} tests`;
    const failures = /^# fail (\d+)$/u.exec(line);
    if (failures) {
      this.activeFailures = Number(failures[1]);
      this.activeSummaryEndId = this.baseLineId + lineOffset + 1;
    }
  }

  private refreshActiveEnd(): void {
    const active = this.activities.find(activity => activity.status === 'running');
    if (!active) return;
    const currentLine = this.parser.hasCurrentContent() ? 1 : 0;
    active.outputEndId = this.baseLineId + this.parser.completedCount() + currentLine;
  }

  private snapshot(): SecondaryActivity[] {
    return this.activities.map(activity => ({...activity}));
  }
}
