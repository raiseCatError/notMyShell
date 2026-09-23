import {GLYPHS} from '../ui/glyphs.js';
import {appendFileSync} from 'node:fs';
import {CompletionService, type CompletionCandidate} from '../shell/CompletionService.js';
import {HistoryService} from '../shell/HistoryService.js';
import {CommandEditor} from '../input/CommandEditor.js';
import {OutputBuffer, serializeCopyPayload} from '../output/OutputBuffer.js';
import {HistoryViewport} from '../output/viewport.js';
import {buildPromptLine} from '../prompt/prompt.js';
import {resolvePromptContext, type PromptContext} from '../shell/ShellContext.js';
import {ShellSession} from '../shell/ShellSession.js';
import {TerminalRenderer} from '../terminal/TerminalRenderer.js';
import {KeyDecoder, type Key} from '../terminal/keys.js';
import {displayWidth, repeatToWidth, truncateAnsi, truncateText} from '../util/text.js';
import {parseSlashCommand, slashCommands, slashSuggestions, suggestionWindow} from '../commands/slashCommands.js';
import {copyFeedback, copyStats, writeClipboard} from '../clipboard/clipboard.js';
import {shouldPassthrough} from '../passthrough/PassthroughPolicy.js';
import {layoutInput, graphemes} from '../input/inputLayout.js';
import {shimmerText} from '../status/shimmer.js';
import {completedActivity, liveActivityParts} from '../status/activity.js';
import {extractFacts} from '../status/adapters.js';
import {foreground, background, UI_COLORS} from '../ui/palette.js';
import {calculateScreenLayout} from './layout.js';
import {AppearanceState, handleAppearanceKey, renderAppearancePanel, BLUR_MODES} from '../appearance/AppearancePanel.js';
import {KeyboardState, handleKeyboardKey, renderKeyboardPanel} from '../keyboard/KeyboardPanel.js';
import {installGhosttyKeybinding} from '../keyboard/ghosttyKeyboard.js';
import {detectGhosttyConfigPath, readGhosttySettings, saveGhosttySettings} from '../appearance/ghostty.js';
import {Highlighter, type TokenType} from '../input/Highlighter.js';
import {SemanticService} from '../shell/SemanticService.js';

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const SUBTLE = foreground(UI_COLORS.subtle);
const SEPARATOR = foreground(UI_COLORS.separator);
const ACCENT = foreground(UI_COLORS.accent);
const SUCCESS = foreground(UI_COLORS.success);
const ERROR = foreground(UI_COLORS.failure);
const STOPPED = foreground({red: 198, green: 156, blue: 109});
const INFO = SECONDARY;
const RESET = '\u001B[0m';
const STATUS_REFRESH_MS = 100;

export class TerminalApp {
  private readonly renderer = new TerminalRenderer();
  private readonly editor = new CommandEditor();
  private readonly highlighter = new Highlighter();
  private readonly semanticService: SemanticService;
  private readonly keyDecoder = new KeyDecoder();
  private readonly output = new OutputBuffer(() => {
    this.historyViewport.latest();
    if (this.running) this.running.cleared = true;
  });
  private readonly historyViewport = new HistoryViewport();
  private readonly session: ShellSession;
  private readonly historyService = new HistoryService();
  private readonly completionService = new CompletionService();
  private shellSuggestions: CompletionCandidate[] = [];
  private lastSuggestionInput = "";
  private context: PromptContext = {cwd: process.cwd(), project: '…'};
  private running?: {command: string; startedAt: number; interrupted: boolean; cleared: boolean; startId: number};
  private hoveredLineIndex?: number;
  private focusedLineIndex?: number;
  private passthrough = false;
  private lastOutputTime = 0;
  private selectedSuggestion = 0;
  private activityTimer?: NodeJS.Timeout;
  private activityAnimationNow = Date.now();
  private contextGeneration = 0;
  private appearanceState?: AppearanceState;
  private keyboardState?: KeyboardState;
  private lastPtyRows = 0;
  private lastPtyColumns = 0;
  private stopped = false;
  private readonly done: Promise<number>;
  private finish!: (exitCode: number) => void;

  constructor() {
    const dimensions = this.dimensions();
    this.session = new ShellSession(process.cwd(), dimensions.columns, Math.max(2, dimensions.rows - 4));
    this.semanticService = new SemanticService(process.cwd());
    this.done = new Promise(resolve => {
      this.finish = resolve;
    });
    this.session.on('data', data => this.onShellData(data));
    this.session.on('prompt', marker => this.onShellPrompt(marker.exitCode, marker.cwd));
    this.session.on('exit', event => this.stop(event.exitCode));
  }

  async run(): Promise<number> {
    this.renderer.enter();
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', this.onInput);
    process.stdout.on('resize', this.onResize);
    process.once('SIGTERM', this.onTerminate);
    process.once('SIGHUP', this.onTerminate);
    process.on('exit', () => {
      if (!this.stopped) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        this.renderer.leave();
      }
    });
    this.activityTimer = setInterval(() => {
      if (!this.running) return;
      this.activityAnimationNow = Date.now();
      this.output.tickActiveCommand();
      this.render();
    }, STATUS_REFRESH_MS);
    this.render();
    return this.done;
  }

  private readonly onInput = (data: string): void => {
    if (process.env.NMSH_DEBUG_KEYS === '1') {
      const hex = Array.from(Buffer.from(data)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const escaped = JSON.stringify(data);
      appendFileSync('/tmp/nmsh-key-debug.log', `RAW hex=${hex} escaped=${escaped}\n`);
    }
    if (this.passthrough) {
      this.session.write(data);
      return;
    }
    for (const key of this.keyDecoder.push(data)) this.handleKey(key);
    this.render();
  };

  private readonly onResize = (): void => {
    this.renderer.invalidate();
    this.lastPtyRows = 0;
    this.lastPtyColumns = 0;
    if (this.passthrough) {
      const dimensions = this.dimensions();
      this.session.resize(dimensions.columns, dimensions.rows);
      return;
    }
    this.render();
  };

  private readonly onTerminate = (): void => {
    this.session.kill();
    this.stop(0);
  };

  private handleKey(key: Key): void {
    if (key.kind === 'mouseMove' || key.kind === 'mouseClick') {
      const {columns, rows} = this.dimensions();
      const fullInput = layoutInput(this.editor.text, this.editor.cursorIndex, columns);
      const overlayRows = this.appearanceState ? 3 : this.keyboardState ? 6 : this.shellSuggestions.length;
      const layout = calculateScreenLayout(rows, fullInput.allRows.length, overlayRows, Boolean(this.running), this.historyViewport.detached, this.output.wrapped(columns).length > 0);
      if (key.y && key.y <= layout.outputHeight) {
        const wrapped = this.output.wrapped(columns);
        const viewStart = this.historyViewport.resolve(wrapped.length, layout.outputHeight);

        // Exact same calculation as render()
        const visibleLength = Math.min(wrapped.length - viewStart, layout.outputHeight);
        const topPadding = this.historyViewport.detached ? 0 : Math.max(0, layout.outputHeight - visibleLength);

        const localVisibleIndex = key.y - 1 - topPadding;

        if (localVisibleIndex >= 0) {
          const row = wrapped[viewStart + localVisibleIndex];
          if (row) {
            if (key.kind === 'mouseClick' && row.commandIndex !== undefined) {
              // Only toggle if we click specifically on a fold hint
              if (row.isFoldHint) {
                this.output.toggleExpanded(row.commandIndex);
                this.render();
              }
            }
            if (row.lineIndex !== undefined && row.lineIndex !== this.hoveredLineIndex) {
              this.hoveredLineIndex = row.lineIndex;
              this.render();
            }
          }
        } else if (this.hoveredLineIndex !== undefined) {
          this.hoveredLineIndex = undefined;
          this.render();
        }
      } else if (this.hoveredLineIndex !== undefined) {
        this.hoveredLineIndex = undefined;
        this.render();
      }
      return;
    }
    if (this.appearanceState) {
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.appearanceState = undefined;
        this.output.addHistoryLine(`${STOPPED}✻ Appearance configuration cancelled${RESET}`);
        this.render();
        return;
      }
      if (key.kind === 'enter') {
        void this.saveAppearance();
        return;
      }
      if (handleAppearanceKey(key, this.appearanceState)) {
        this.render();
      }
      return;
    }
    if (this.keyboardState) {
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.keyboardState = undefined;
        this.output.addHistoryLine(`${STOPPED}✻ Keyboard configuration cancelled${RESET}`);
        this.render();
        return;
      }
      if (key.kind === 'enter') {
        void this.saveKeyboard();
        return;
      }
      if (handleKeyboardKey(key, this.keyboardState)) {
        this.render();
      }
      return;
    }

    if (key.kind === 'pageUp') {
      this.scroll(-1);
      return;
    }
    if (key.kind === 'wheelUp') {
      this.scrollLines(-3);
      return;
    }
    if (key.kind === 'pageDown') {
      this.scroll(1);
      return;
    }
    if (key.kind === 'wheelDown') {
      this.scrollLines(3);
      return;
    }
    if (key.kind === 'latest') {
      this.historyViewport.latest();
      return;
    }

    if (key.kind === 'historySearch') {
      if (!this.running) {
        this.editor.clear();
        this.editor.insert('/history ');
      }
      return;
    }
    if (key.kind === 'toggleDetails') {
      this.output.toggleMostRelevant(this.focusedLineIndex);
      this.render();
      return;
    }
    if (key.kind === 'interrupt') {
      if (this.running) {
        this.running.interrupted = true;
        this.editor.clear();
        this.session.interrupt();
      } else {
        this.editor.clear();
        this.selectedSuggestion = 0;
      }
      return;
    }
    if (key.kind === 'selectAll') {
      if (!this.running) this.editor.selectAll();
      return;
    }
    if (key.kind === 'eof') {
      if (this.running || this.editor.text.length === 0) this.session.endInput();
      else if (!this.running) this.editor.delete();
      return;
    }

    const suggestions = slashSuggestions(this.editor.text);
    const isSlash = this.editor.text.startsWith('/');
    if (key.kind === 'up' && suggestions.length > 0) {
      this.selectedSuggestion = (this.selectedSuggestion - 1 + suggestions.length) % suggestions.length;
    } else if (key.kind === 'down' && suggestions.length > 0) {
      this.selectedSuggestion = (this.selectedSuggestion + 1) % suggestions.length;
    } else if (key.kind === 'complete') {
      if (this.shellSuggestions.length > 0) this.applySuggestion(this.shellSuggestions[this.selectedSuggestion]);
      else if (isSlash) this.applySuggestion({insertion: slashCommands[this.selectedSuggestion].name});
      else this.handleKey({kind: 'focusNext'} as Key);
      return;
    } else if (key.kind === 'text') {
      this.editor.insert(key.value);
      this.selectedSuggestion = 0;
    } else if (key.kind === 'focusNext' || key.kind === 'focusPrevious') {
      const dir = key.kind === 'focusNext' ? 1 : -1;
      const {columns} = this.dimensions();
      const metadataRows = Array.from(this.output.lineTypes.entries())
        .filter(([, type]) => type === 'metadata')
        .map(([index]) => index);

      const foldHintRows = this.output.wrapped(columns)
        .filter(r => r.isFoldHint && r.lineIndex !== undefined)
        .map(r => r.lineIndex as number);

      const focusableRows = Array.from(new Set([...metadataRows, ...foldHintRows]))
        .sort((a, b) => a - b);

      if (focusableRows.length > 0) {
        if (this.focusedLineIndex === undefined) {
          this.focusedLineIndex = dir === 1 ? focusableRows[0] : focusableRows[focusableRows.length - 1];
        } else {
          const currentIndex = focusableRows.indexOf(this.focusedLineIndex);
          if (currentIndex !== -1) {
            const nextIndex = (currentIndex + dir + focusableRows.length) % focusableRows.length;
            this.focusedLineIndex = focusableRows[nextIndex];
          } else {
            this.focusedLineIndex = focusableRows[0];
          }
        }

        const {columns, rows} = this.dimensions();
        const fullInput = layoutInput(this.editor.text, this.editor.cursorIndex, columns);
        const overlayRows = this.appearanceState ? 3 : this.keyboardState ? 6 : this.shellSuggestions.length;
        const layout = calculateScreenLayout(rows, fullInput.allRows.length, overlayRows, Boolean(this.running), this.historyViewport.detached, this.output.wrapped(columns).length > 0);

        const wrapped = this.output.wrapped(columns);
        const wrappedIndex = wrapped.findIndex(r => r.lineIndex === this.focusedLineIndex);
        if (wrappedIndex !== -1) {
          this.historyViewport.resolve(wrapped.length, layout.outputHeight);
          if (wrappedIndex < this.historyViewport.start || wrappedIndex >= this.historyViewport.start + layout.outputHeight) {
             this.historyViewport.scrollLines(wrapped.length, layout.outputHeight, wrappedIndex - this.historyViewport.start - Math.floor(layout.outputHeight / 2));
          }
        }

        this.render();
      }
      return;
    }
    else if (key.kind === 'left') this.editor.moveLeft();
    else if (key.kind === 'right') this.editor.moveRight();
    else if (key.kind === 'selectLeft') this.editor.selectLeft();
    else if (key.kind === 'selectRight') this.editor.selectRight();
    else if (key.kind === 'wordLeft') this.editor.wordLeft();
    else if (key.kind === 'wordRight') this.editor.wordRight();
    else if (key.kind === 'selectWordLeft') this.editor.selectWordLeft();
    else if (key.kind === 'selectWordRight') this.editor.selectWordRight();
    else if (key.kind === 'up') this.editor.moveUp(this.dimensions().columns);
    else if (key.kind === 'selectUp') this.editor.selectUp(this.dimensions().columns);
    else if (key.kind === 'down') this.editor.moveDown(this.dimensions().columns);
    else if (key.kind === 'selectDown') this.editor.selectDown(this.dimensions().columns);
    else if (key.kind === 'lineHome') this.editor.lineHome();
    else if (key.kind === 'selectLineHome') this.editor.selectLineHome();
    else if (key.kind === 'lineEnd') this.editor.lineEnd();
    else if (key.kind === 'selectLineEnd') this.editor.selectLineEnd();
    else if (key.kind === 'bufferHome') this.editor.moveBufferHome();
    else if (key.kind === 'bufferEnd') this.editor.moveBufferEnd();
    else if (key.kind === 'selectBufferHome') this.editor.selectBufferHome();
    else if (key.kind === 'selectBufferEnd') this.editor.selectBufferEnd();
    else if (key.kind === 'backspace') this.editor.backspace();
    else if (key.kind === 'deleteWord') this.editor.deleteWord();
    else if (key.kind === 'deleteLineBefore') this.editor.deleteLineBefore();
    else if (key.kind === 'deleteLineAfter') this.editor.deleteLineAfter();
    else if (key.kind === 'delete') this.editor.delete();
    else if (key.kind === 'newline') this.editor.insert('\n');
    else if (key.kind === 'enter') {
      if (this.running) {
        this.session.write(`${this.editor.text}\r`);
        this.editor.clear();
      } else {
        void this.submit();
      }
    }
  }


  private async fetchSuggestions(): Promise<void> {
    if (this.running || this.editor.text.startsWith('/')) {
      this.shellSuggestions = [];
      return;
    }
    const input = this.editor.text;
    if (input === this.lastSuggestionInput) return;
    this.lastSuggestionInput = input;

    if (input.trim().length === 0) {
      this.shellSuggestions = [];
      this.render();
      return;
    }

    const comps = await this.completionService.suggest(input, this.context.cwd);
    if (this.editor.text === input) {
      this.shellSuggestions = comps;
      this.selectedSuggestion = 0;
      this.render();
    }
  }

  private applySuggestion(suggestion: {insertion: string}): void {
    this.editor.clear();
    this.editor.insert(suggestion.insertion);
    this.selectedSuggestion = 0;
  }

  private async submit(): Promise<void> {
    const command = this.editor.text;
    this.editor.clear();
    if (!command.trim()) return;

    const slash = parseSlashCommand(command);
    if (slash) {
      if (slash.kind === 'copy') await this.copyRecent(slash.index);
      else if (slash.kind === 'appearance') await this.startAppearance();
      else if (slash.kind === 'keyboard') await this.startKeyboard();
      else if (slash.kind === 'help') this.showHelp(command);
      else this.output.addFrontendInteraction(command, `Unknown NMSh command: ${(slash as any).input || command}`, ERROR);
      this.render();
      return;
    }

    const startId = this.output.beginCommand(command, this.formatCommandAnsi(command, null), (mode) => {
      if (mode === 'PASSTHROUGH' && !this.passthrough) {
        this.passthrough = true;
        this.renderer.suspendForPassthrough();
        const dimensions = this.dimensions();
        this.session.resize(dimensions.columns, dimensions.rows);
      }
      this.render();
    });
    this.formatCommandAnsi(command, startId);
    const startedAt = Date.now();
    this.running = {command, startedAt, interrupted: false, cleared: false, startId};
    this.activityAnimationNow = startedAt;

    // Initial static heuristic, but dynamic can override
    this.passthrough = shouldPassthrough(command);
    if (this.passthrough) {
      this.renderer.suspendForPassthrough();
      const dimensions = this.dimensions();
      this.session.resize(dimensions.columns, dimensions.rows);
    }
    if (command.includes('\n')) {
      this.session.submit(`{ ${command}\n}`);
    } else {
      this.session.submit(command);
    }
    this.render();
  }

  private async saveAppearance(): Promise<void> {
    if (!this.appearanceState) return;
    const state = this.appearanceState;
    this.appearanceState = undefined;

    this.output.addHistoryLine(`${INFO}✻ Saving appearance settings...${RESET}`);
    this.render();

    const result = await saveGhosttySettings({
      opacity: state.opacity,
      blurMode: BLUR_MODES[state.blurModeIndex],
      blurStrength: state.blurStrength
    });

    if (result.success) {
      this.output.addHistoryLine(`${SUCCESS}✻ Saved to ${result.fragmentPath}${RESET}`);
      this.output.addHistoryLine(`${INFO}✻ Host config updated: ${result.hostPath}${RESET}`);
      if (state.opacity < 1) {
        this.output.addHistoryLine(`${INFO}✻ Note: opacity changes require Ghostty restart${RESET}`);
      }
    } else {
      this.output.addHistoryLine(`${ERROR}✻ Failed to save appearance${RESET}`);
      this.output.addHistoryLine(`  ⎿ ${result.error}`);
    }
    this.render();
  }

  private async startKeyboard(): Promise<void> {
    const isGhostty = process.env.TERM_PROGRAM === 'ghostty';
    const isVSCode = process.env.TERM_PROGRAM === 'vscode';
    if (isVSCode) {
      // VS Code sends identical bytes for Enter and Shift+Enter (both \r at PTY level).
      // NMSh cannot distinguish them without an explicit VS Code keybinding.
      // The binding below sends the Kitty Shift+Enter sequence \u001B[13;2u which
      // NMSh already maps to insertNewline.
      const vscodeNote = [
        `VS Code sends identical bytes for Enter and Shift+Enter.`,
        `To enable Shift+Enter → insert newline, add this to your VS Code keybindings.json:`,
        ``,
        `  { "key": "shift+enter",`,
        `    "command": "workbench.action.terminal.sendSequence",`,
        `    "args": { "text": "\\u001b[13;2u" },`,
        `    "when": "terminalFocus" }`,
        ``,
        `Ctrl+J always inserts a newline without any config (portable fallback).`,
      ].join('\n');
      this.output.addFrontendInteraction('/keyboard', vscodeNote, INFO);
      this.render();
      return;
    }
    if (!isGhostty && !await detectGhosttyConfigPath()) {
       this.output.addFrontendInteraction('/keyboard', `Host is not Ghostty. Keyboard integration is specific to Ghostty currently.`, INFO);
       this.render();
       return;
    }
    this.keyboardState = { selectedIndex: 0 };
    this.render();
  }


  private async saveKeyboard(): Promise<void> {
    if (!this.keyboardState) return;
    this.keyboardState = undefined;

    this.output.addHistoryLine(`${INFO}✻ Installing Ghostty Cmd+A binding...${RESET}`);
    this.render();

    const result = await installGhosttyKeybinding();

    if (result.success) {
      this.output.addHistoryLine(`${SUCCESS}✻ Installed Cmd+A binding in Ghostty config${RESET}`);
      this.output.addHistoryLine(`${INFO}✻ Reload Ghostty config (Cmd+Shift+,) for changes to take effect${RESET}`);
    } else {
      this.output.addHistoryLine(`${ERROR}✻ Failed to install binding${RESET}`);
      this.output.addHistoryLine(`  ⎿ ${result.error}`);
    }
    this.render();
  }

  private async startAppearance(): Promise<void> {
    const isGhostty = process.env.TERM_PROGRAM === 'ghostty';
    const isVSCode = process.env.TERM_PROGRAM === 'vscode';

    if (isVSCode || (!isGhostty && !await detectGhosttyConfigPath())) {
       this.output.addFrontendInteraction('/appearance', `Host: ${isVSCode ? 'VS Code Integrated Terminal' : 'Unsupported Host'}\nWindow opacity and blur are controlled by the host.`, INFO);
       this.render();
       return;
    }

    const settings = await readGhosttySettings();
    this.appearanceState = {
      opacity: settings.opacity,
      blurModeIndex: Math.max(0, BLUR_MODES.indexOf(settings.blurMode)),
      blurStrength: settings.blurStrength,
      selectedIndex: 0
    };
    this.render();
  }

  private async copyRecent(index: number): Promise<void> {
    const command = index === 1 ? '/copy' : `/copy ${index}`;
    const record = this.output.recent(index);
    if (!record) {
      this.output.addFrontendInteraction(command, `No completed command output at /copy ${index}`, ERROR);
      return;
    }
    try {
      const payload = serializeCopyPayload(record);
      await writeClipboard(payload);
      this.output.addFrontendInteraction(command, copyFeedback(copyStats(payload), index), INFO);
    } catch {
      this.output.addFrontendInteraction(command, 'Clipboard copy failed', ERROR);
    }
  }


  private showHelp(command: string): void {
    const summary = slashCommands.map(item => `${item.name} — ${item.description}`).join(' · ');
    const helpText = `${summary}\n\n${INFO}✻ Portable Select-All: Alt+A\n✻ VS Code Cmd+A Keybinding JSON:\n  { "key": "cmd+a", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[97;9u" }, "when": "terminalFocus" }${RESET}`;
    this.output.addFrontendInteraction(command, helpText, ACCENT);
  }

  private onShellData(data: string): void {
    if (this.passthrough) {
      process.stdout.write(data);
    } else {
      this.lastOutputTime = Date.now();
      const wasPassthrough = this.passthrough;
      this.output.write(data);
      if (!wasPassthrough && this.passthrough) {
        process.stdout.write(data);
      } else {
        this.render();
      }
    }
  }

  private onShellPrompt(exitCode: number, cwd: string): void {
    if (!this.running) {
      void this.refreshContext(cwd);
      this.render();
      return;
    }

    const command = this.running;
    const completedAt = new Date();
    const elapsed = completedAt.getTime() - command.startedAt;
    const completedRecord = this.output.complete(exitCode);
    if (!command.cleared) {
      const outputText = completedRecord?.output ?? '';
      const facts = extractFacts(command.command, outputText);
      const isInterrupted = command.interrupted || exitCode === 130;
      const parts = completedActivity(command.command, elapsed, completedAt, isInterrupted ? 0 : exitCode, isInterrupted, facts);
      this.output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
      const rowStyle = isInterrupted ? STOPPED : (exitCode !== 0 ? ERROR : SUCCESS);
      this.output.addHistoryLine(`${rowStyle}${parts.main}${SECONDARY}${parts.detail}${RESET}`);
    }
    this.running = undefined;
    if (this.passthrough) {
      this.passthrough = false;
      this.renderer.resumeAfterPassthrough();
      this.keyDecoder.reset();
      this.lastPtyRows = 0;
      this.lastPtyColumns = 0;
    }
    void this.refreshContext(cwd);
    this.render();
  }


  private async refreshContext(cwd: string): Promise<void> {
    const generation = ++this.contextGeneration;
    const context = await resolvePromptContext(cwd);
    if (generation !== this.contextGeneration || this.stopped) return;
    this.context = context;
    this.render();
  }

  private scroll(direction: -1 | 1): void {
    const {columns, rows} = this.dimensions();
    const input = layoutInput(this.editor.text, this.editor.cursorIndex, columns);
    const overlayRows = this.appearanceState ? 7 : (this.keyboardState ? 6 : slashSuggestions(this.editor.text).length);
    const outputHeight = Math.max(1, calculateScreenLayout(
      rows,
      input.allRows.length,
      overlayRows,
      Boolean(this.running),
      this.historyViewport.detached,
      this.output.wrapped(columns).length > 0,
    ).outputHeight);
    const total = this.output.wrapped(columns).length;
    this.historyViewport.resolve(total, outputHeight);
    this.historyViewport.page(total, outputHeight, direction);
  }

  private scrollLines(amount: number): void {
    const {columns, rows} = this.dimensions();
    const input = layoutInput(this.editor.text, this.editor.cursorIndex, columns);
    const overlayRows = this.appearanceState ? 7 : (this.keyboardState ? 6 : slashSuggestions(this.editor.text).length);
    const outputHeight = Math.max(1, calculateScreenLayout(
      rows,
      input.allRows.length,
      overlayRows,
      Boolean(this.running),
      this.historyViewport.detached,
      this.output.wrapped(columns).length > 0,
    ).outputHeight);
    const total = this.output.wrapped(columns).length;
    this.historyViewport.resolve(total, outputHeight);
    this.historyViewport.scrollLines(total, outputHeight, amount);
  }


  private formatCommandAnsi(command: string, startId: number | null): string[] {
    const inputChars = graphemes(command);
    const tokens = this.highlighter.tokenize(inputChars, this.semanticService.cache);
    const charColors = new Array(inputChars.length).fill(PRIMARY);

    for (const token of tokens) {
      if (token.type === 'Command' && startId !== null) {
        void this.semanticService.classifyCommand(token.text).then(() => {
          const newFormatted = this.formatCommandAnsi(command, null);
          this.output.updateCommandHighlight(startId, newFormatted);
          this.render();
        });
      }
      let color = PRIMARY;
      switch (token.type) {
        case 'Command': color = PRIMARY; break;
        case 'KnownCommand': color = ACCENT; break;
        case 'Builtin': color = ACCENT; break;
        case 'Alias': color = ACCENT; break;
        case 'Function': color = ACCENT; break;
        case 'UnknownCommand': color = ERROR; break;
        case 'Argument': color = PRIMARY; break;
        case 'String': color = STOPPED; break;
        case 'Variable': color = ACCENT; break;
        case 'Operator': color = SUBTLE; break;
        case 'Path': color = SECONDARY; break;
        case 'Flag': color = SECONDARY; break;
        case 'Comment': color = SUBTLE; break;
        case 'Normal': color = PRIMARY; break;
      }
      for (let i = token.start; i < token.end; i++) charColors[i] = color;
    }

    const lines: string[] = [];
    let currentLine = '';
    let isFirstLine = true;
    let currentColor = '';

    const pushLine = () => {
      lines.push(`${currentLine}${RESET}`);
    };

    for (let i = 0; i < inputChars.length; i++) {
      const char = inputChars[i];
      if (char === '\n') {
        pushLine();
        currentLine = '';
        isFirstLine = false;
        currentColor = '';
        continue;
      }
      if (currentLine === '') {
         const prefix = isFirstLine ? `${GLYPHS.prompt} ` : '  ';
         currentLine += `${foreground(UI_COLORS.command)}${prefix}`;
         currentColor = foreground(UI_COLORS.command);
      }
      const color = charColors[i] ?? PRIMARY;
      if (color !== currentColor) {
         currentLine += `${RESET}${color}`;
         currentColor = color;
      }
      currentLine += char;
    }
    pushLine();
    return lines;
  }

  private render(): void {
    void this.fetchSuggestions();
    if (this.stopped || this.passthrough) return;
    const {columns, rows} = this.dimensions();
    const isSlash = this.editor.text.startsWith('/');

    let availableSuggestions: any[] = [];
    if (!this.running) {
      if (this.editor.text.startsWith('/history ')) {
        const q = this.editor.text.substring(9).toLowerCase();
        const matches = this.historyService.getAll().filter(h => h.toLowerCase().includes(q));
        availableSuggestions = matches.slice(0, 100).map(m => ({name: m, insertion: m, description: 'History'}));
      } else if (isSlash) {
        availableSuggestions = slashSuggestions(this.editor.text);
      } else {
        availableSuggestions = this.shellSuggestions;
      }
    }

    const overlayRows = this.appearanceState ? 7 : (this.keyboardState ? 6 : availableSuggestions.length);
    const promptLine = buildPromptLine(this.context, columns);
    this.editor.ghost = this.historyService.suggest(this.editor.text);
    const fullInput = layoutInput(this.editor.text, this.editor.cursorIndex, columns);
    const layout = calculateScreenLayout(
      rows,
      fullInput.allRows.length,
      overlayRows,
      Boolean(this.running),
      this.historyViewport.detached,
      this.output.wrapped(columns).length > 0,
    );
    const input = layoutInput(this.editor.text, this.editor.cursorIndex, columns, layout.inputHeight);
    const effectiveSelection = Math.max(0, Math.min(availableSuggestions.length - 1, this.selectedSuggestion));
    const suggestionView = suggestionWindow(availableSuggestions, effectiveSelection, layout.suggestionCount);
    const outputHeight = layout.outputHeight;
    if (this.lastPtyRows !== outputHeight || this.lastPtyColumns !== columns) {
      this.lastPtyRows = outputHeight;
      this.lastPtyColumns = columns;
      this.session.resize(columns, outputHeight);
    }

    const wrapped = this.output.wrapped(columns);
    const viewStart = this.historyViewport.resolve(wrapped.length, outputHeight);
    const visible = wrapped.slice(viewStart, viewStart + outputHeight).map(row => {
      let finalAnsi = row.ansi;
      const applyBg = (bg: string) => {
        return `${bg}${finalAnsi.replaceAll('\u001B[0m', '\u001B[0m' + bg)}${bg}\u001B[K${RESET}`;
      };

      if (row.isFoldHint) {
        const isHovered = this.hoveredLineIndex === row.lineIndex;
        const isFocused = this.focusedLineIndex === row.lineIndex;
        if (isHovered || isFocused) {
          finalAnsi = row.ansi.replaceAll(SECONDARY, PRIMARY).replaceAll(SUBTLE, SECONDARY);
          const bg = isFocused ? `\u001B[48;2;60;60;80m` : `\u001B[48;2;45;45;55m`;
          finalAnsi = applyBg(bg);
        }
      } else if (row.lineIndex !== undefined) {
        const type = this.output.lineTypes.get(row.lineIndex);
        if (type === 'command') {
          // Subtle background for command
          finalAnsi = applyBg(`\u001B[48;2;38;38;48m`);
        } else if (type === 'metadata') {
          const isHovered = this.hoveredLineIndex === row.lineIndex;
          const isFocused = this.focusedLineIndex === row.lineIndex;
          if (isHovered || isFocused) {
            // Brighten on hover/focus
            finalAnsi = row.ansi.replaceAll(SECONDARY, PRIMARY).replaceAll(SUBTLE, SECONDARY);
            const bg = isFocused ? `\u001B[48;2;60;60;80m` : `\u001B[48;2;45;45;55m`;
            finalAnsi = applyBg(bg);
          }
        }
      }
      return finalAnsi;
    });
    const topPadding = this.historyViewport.detached ? 0 : Math.max(0, outputHeight - visible.length);
    const frameRows = [...Array<string>(topPadding).fill(''), ...visible];
    while (frameRows.length < outputHeight) frameRows.push('');
    if (layout.showGap) frameRows.push('');

    if (layout.showJump) frameRows.push(this.jumpAffordance(columns));
    if (this.appearanceState) {
      for (const row of renderAppearancePanel(this.appearanceState, columns)) {
        frameRows.push(row);
      }
    } else if (this.keyboardState) {
      for (const row of renderKeyboardPanel(this.keyboardState, columns)) {
        frameRows.push(row);
      }
    } else {
      for (const [visibleIndex, suggestion] of suggestionView.items.entries()) {
        const selected = suggestionView.start + visibleIndex === effectiveSelection;
        frameRows.push(truncateAnsi(
          `${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${suggestion.name.padEnd(10)}${RESET}${SECONDARY} ${suggestion.description}${RESET}`,
          columns,
        ));
      }
    }
    if (layout.showLiveActivity && this.running) {
      frameRows.push(truncateAnsi(this.currentActivity(), columns));
      frameRows.push('');
    }
    if (layout.showPrompt) frameRows.push(promptLine);
    const SELECTION_BG = background(UI_COLORS.selection);
    const sel = this.editor.selection;

    const inputChars = graphemes(this.editor.text);
    const tokens = this.highlighter.tokenize(inputChars, this.semanticService.cache);
    const charColors = new Array(inputChars.length).fill(PRIMARY);

    for (const token of tokens) {
      if (token.type === 'Command') {
        void this.semanticService.classifyCommand(token.text).then(() => this.render());
      }
      let color = PRIMARY;
      switch (token.type) {
        case 'Command': color = PRIMARY; break;
        case 'KnownCommand': color = ACCENT; break;
        case 'Builtin': color = ACCENT; break;
        case 'Alias': color = ACCENT; break;
        case 'Function': color = ACCENT; break;
        case 'UnknownCommand': color = ERROR; break;
        case 'Argument': color = PRIMARY; break;
        case 'String': color = STOPPED; break;
        case 'Variable': color = ACCENT; break;
        case 'Operator': color = SUBTLE; break;
        case 'Path': color = SECONDARY; break;
        case 'Flag': color = SECONDARY; break;
        case 'Comment': color = SUBTLE; break;
        case 'Normal': color = PRIMARY; break;
      }
      for (let i = token.start; i < token.end; i++) charColors[i] = color;
    }

    for (const row of input.rows) {
      const prefix = row.prefix.startsWith('❯') ? `${ACCENT}❯${RESET}${row.prefix.slice(1)}` : row.prefix;
      let textStyled = '';
      const glyphsInRow = graphemes(row.text);
      for (let i = 0; i < glyphsInRow.length; i++) {
        const globalIndex = row.charStart + i;
        const isSelected = sel && globalIndex >= sel.start && globalIndex < sel.end;
        const color = charColors[globalIndex] ?? PRIMARY;
        if (isSelected) {
          textStyled += `${SELECTION_BG}${color}${glyphsInRow[i]}${RESET}`;
        } else {
          textStyled += `${color}${glyphsInRow[i]}${RESET}`;
        }
      }
      let suffix = '';
      if (this.editor.ghost && this.editor.cursorIndex === this.editor.text.length && row === input.rows[input.rows.length - 1]) {
        suffix = `${SECONDARY}${this.editor.ghost.substring(this.editor.text.length)}${RESET}`;
      }
      frameRows.push(truncateAnsi(`${prefix}${textStyled}${suffix}`, columns));
    }
    if (layout.showSeparator) frameRows.push(`${SEPARATOR}${repeatToWidth('─', columns)}${RESET}`);

    this.renderer.render({
      rows: frameRows.slice(0, rows),
      cursorRow: Math.min(
        rows,
        outputHeight
          + Number(layout.showGap)
          + Number(layout.showJump)
          + (this.appearanceState ? 7 : (this.keyboardState ? 6 : suggestionView.items.length))
          + (layout.showLiveActivity ? 2 : 0)
          + Number(layout.showPrompt)
          + input.caretRow
          + 1,
      ),
      cursorColumn: Math.max(1, Math.min(columns, input.caretColumn + 1)),
      cursorVisible: true,
    });
  }

  private currentActivity(): string {
    if (!this.running) return '';
    const elapsed = this.activityAnimationNow - this.running.startedAt;
    const isActive = (Date.now() - this.lastOutputTime) < 750;
    const parts = liveActivityParts(this.running.command, elapsed);
    return `${shimmerText(parts.phrase, elapsed, isActive)}${SECONDARY}${parts.duration}${RESET}`;
  }

  private jumpAffordance(columns: number): string {
    const main = '↓ Jump to bottom';
    const detail = ' · Ctrl+End';
    const totalLength = displayWidth(main) + displayWidth(detail);
    if (columns < totalLength) {
      const visible = truncateText(main, columns);
      return `${' '.repeat(Math.max(0, columns - displayWidth(visible)))}${ACCENT}${visible}${RESET}`;
    }
    return `${' '.repeat(columns - totalLength)}${ACCENT}${main}${SECONDARY}${detail}${RESET}`;
  }

  private dimensions(): {columns: number; rows: number} {
    return {
      columns: Math.max(1, process.stdout.columns || 80),
      rows: Math.max(1, process.stdout.rows || 24),
    };
  }

  private stop(exitCode: number): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.activityTimer) clearInterval(this.activityTimer);
    process.stdin.off('data', this.onInput);
    process.stdout.off('resize', this.onResize);
    process.off('SIGTERM', this.onTerminate);
    process.off('SIGHUP', this.onTerminate);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    this.renderer.leave();
    this.semanticService.kill();
    this.finish(exitCode);
  }
}
