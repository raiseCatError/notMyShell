import {CommandEditor} from '../input/CommandEditor.js';
import {OutputBuffer, serializeCopyPayload} from '../output/OutputBuffer.js';
import {HistoryViewport} from '../output/viewport.js';
import {buildPromptLine} from '../prompt/prompt.js';
import {resolvePromptContext, type PromptContext} from '../shell/ShellContext.js';
import {ShellSession} from '../shell/ShellSession.js';
import {completedStatus} from '../status/commandTiming.js';
import {TerminalRenderer} from '../terminal/TerminalRenderer.js';
import {KeyDecoder, type Key} from '../terminal/keys.js';
import {displayWidth, repeatToWidth, truncateAnsi, truncateText} from '../util/text.js';
import {parseSlashCommand, slashCommands, slashSuggestions, suggestionWindow} from '../commands/slashCommands.js';
import {copyFeedback, copyStats, writeClipboard} from '../clipboard/clipboard.js';
import {shouldPassthrough} from '../passthrough/PassthroughPolicy.js';
import {layoutInput, graphemes} from '../input/inputLayout.js';
import {shimmerText} from '../status/shimmer.js';
import {ActivitySelector, completedActivity, liveActivityParts, type ActivityVerbPair} from '../status/activity.js';
import {foreground, background, UI_COLORS} from '../ui/palette.js';
import {calculateScreenLayout} from './layout.js';
import {AppearanceState, handleAppearanceKey, renderAppearancePanel, BLUR_MODES} from '../appearance/AppearancePanel.js';
import {KeyboardState, handleKeyboardKey, renderKeyboardPanel} from '../keyboard/KeyboardPanel.js';
import {installGhosttyKeybinding} from '../keyboard/ghosttyKeyboard.js';
import {detectGhosttyConfigPath, readGhosttySettings, saveGhosttySettings} from '../appearance/ghostty.js';

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
  private readonly keyDecoder = new KeyDecoder();
  private readonly output = new OutputBuffer(() => {
    this.historyViewport.latest();
    if (this.running) this.running.cleared = true;
  });
  private readonly historyViewport = new HistoryViewport();
  private readonly activitySelector = new ActivitySelector();
  private readonly session: ShellSession;
  private context: PromptContext = {cwd: process.cwd(), project: '…'};
  private running?: {command: string; startedAt: number; interrupted: boolean; cleared: boolean; activity: ActivityVerbPair};
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
      this.render();
    }, STATUS_REFRESH_MS);
    this.render();
    return this.done;
  }

  private readonly onInput = (data: string): void => {
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
    if (key.kind === 'up' && suggestions.length > 0) {
      this.selectedSuggestion = (this.selectedSuggestion - 1 + suggestions.length) % suggestions.length;
    } else if (key.kind === 'down' && suggestions.length > 0) {
      this.selectedSuggestion = (this.selectedSuggestion + 1) % suggestions.length;
    } else if (key.kind === 'complete' && suggestions.length > 0) {
      this.applySuggestion(suggestions[this.selectedSuggestion] ?? suggestions[0]);
    } else if (key.kind === 'text') {
      this.editor.insert(key.value);
      this.selectedSuggestion = 0;
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
      else this.output.addFrontendInteraction(command, `Unknown NMSh command: ${slash.input}`, ERROR);
      this.render();
      return;
    }

    this.output.beginCommand(command);
    const startedAt = Date.now();
    this.running = {command, startedAt, interrupted: false, cleared: false, activity: this.activitySelector.next()};
    this.activityAnimationNow = startedAt;
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
    if (this.passthrough) process.stdout.write(data);
    else {
      this.lastOutputTime = Date.now();
      this.output.write(data);
      this.render();
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
    this.output.complete(exitCode);
    if (command.interrupted || exitCode === 130) {
      const parts = completedStatus('interrupted', elapsed, completedAt);
      this.output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
      this.output.addHistoryLine(`${STOPPED}${parts.main}${SECONDARY}${parts.detail}${RESET}`);
    } else if (exitCode !== 0) {
      const parts = completedStatus('failure', elapsed, completedAt, exitCode);
      this.output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
      this.output.addHistoryLine(`${ERROR}${parts.main}${SECONDARY}${parts.detail}${RESET}`);
    } else if (!command.cleared) {
      const parts = completedActivity(command.activity, elapsed, completedAt);
      this.output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
      this.output.addHistoryLine(`${SUCCESS}${parts.main}${SECONDARY}${parts.detail}${RESET}`);
    }
    this.running = undefined;
    if (this.passthrough) {
      this.passthrough = false;
      this.renderer.resumeAfterPassthrough();
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

  private render(): void {
    if (this.stopped || this.passthrough) return;
    const {columns, rows} = this.dimensions();
    const availableSuggestions = this.running ? [] : slashSuggestions(this.editor.text);
    const overlayRows = this.appearanceState ? 7 : (this.keyboardState ? 6 : availableSuggestions.length);
    const promptLine = buildPromptLine(this.context, columns);
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
    const visible = wrapped.slice(viewStart, viewStart + outputHeight).map(row => row.ansi);
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

    for (const row of input.rows) {
      const prefix = row.prefix.startsWith('❯') ? `${ACCENT}❯${RESET}${row.prefix.slice(1)}` : row.prefix;
      let textStyled: string;
      if (!sel) {
        // No selection — render plain.
        textStyled = `${PRIMARY}${row.text}${RESET}`;
      } else if (sel.start >= row.charEnd || sel.end <= row.charStart) {
        // Selection does not overlap this row.
        textStyled = `${PRIMARY}${row.text}${RESET}`;
      } else {
        // Partial or full overlap — split the row text into pre/sel/post segments.
        // row.text excludes the prefix and excludes newline characters.
        // We re-segment row.text to apply character-level highlighting.
        const glyphsInRow = graphemes(row.text);
        // Map grapheme positions within row to global char indices.
        // row.charStart is the global index of the first char in this row.
        const preEnd = Math.max(0, sel.start - row.charStart);
        const selEnd = Math.min(glyphsInRow.length, sel.end - row.charStart);
        const pre = glyphsInRow.slice(0, preEnd).join('');
        const selected = glyphsInRow.slice(preEnd, selEnd).join('');
        const post = glyphsInRow.slice(selEnd).join('');
        textStyled = `${PRIMARY}${pre}${SELECTION_BG}${PRIMARY}${selected}${RESET}${PRIMARY}${post}${RESET}`;
      }
      frameRows.push(`${prefix}${textStyled}`);
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
    const parts = liveActivityParts(this.running.activity, elapsed);
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
    this.finish(exitCode);
  }
}
