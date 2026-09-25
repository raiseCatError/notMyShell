import {homedir} from 'node:os';
import {GLYPHS, setIconStyle} from '../ui/glyphs.js';
import {framePanel} from '../ui/PanelShell.js';
import {
  adjustSettingsRow, isInlineEditable, renderSettingsPanel, selectedSettingsRow, settingsItemCount, settingsRowDestination,
  settingsView, statusLineCount, switchSettingsView, toggleSettingsRow, type SettingsDestination, type SettingsPanelState,
  type SettingsView, type StatusSections,
} from '../ui/SettingsPanel.js';
import {appendFileSync, existsSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {CompletionService, type CompletionCandidate} from '../shell/CompletionService.js';
import {HistoryService} from '../shell/HistoryService.js';
import {CommandEditor} from '../input/CommandEditor.js';
import {OutputBuffer, serializeCopyPayload, type HistoricalContextSnapshot} from '../output/OutputBuffer.js';
import {createWelcomeSnapshot, WELCOME_BLINK_CLOSED_MS, welcomeBlinkDelay} from '../output/Welcome.js';
import {TapActivityObserver} from '../output/TapActivityObserver.js';
import {HistoryViewport, stickyHeaderFor, type StickyHeader, type WrappedRow} from '../output/viewport.js';
import {buildContextLine, buildInlineContextPrefix, isOnCommandRelevant, buildRichGitShowcaseLine, buildThemePreviewLine, RICH_GIT_SHOWCASE, nativePromptSnapshot, themePreviewContext} from '../prompt/prompt.js';
import {handleTranscriptPanelKey, renderTranscriptPanel, type TranscriptPanelState} from '../output/TranscriptPanel.js';
import {tabCompletionAction} from '../input/tabBehavior.js';
import {formatBuildIdentity, readBuildIdentity} from '../buildInfo.js';
import {hasVisibleContextModule, loadPromptConfiguration, NATIVE_PALETTE_IDS, savePromptConfiguration, type PromptConfiguration, type PromptProviderId} from '../prompt/configuration.js';
import {detectStarship, renderStarshipPrompt, type StarshipPromptResult, type StarshipStatus} from '../prompt/starship.js';
import {STARSHIP_MODULES, StarshipConfigAdapter} from '../prompt/StarshipConfigAdapter.js';
import {detectPowerlevel10k, renderPowerlevel10kPrompt, type Powerlevel10kStatus} from '../prompt/powerlevel10k.js';
import {configuratorFileChanged, launchPowerlevel10kConfigurator, preparePowerlevel10kConfigurator} from '../prompt/Powerlevel10kConfigurator.js';
import {APPEARANCE_MODULES_ROW, applyLayoutChoice, onModulesRow, layoutLabel, describePromptConfiguration, PROVIDER_ORDER, providerLabel, handlePromptPanelKey, layoutChoiceIndex, renderPromptPanel, type PromptPanelState} from '../prompt/PromptPanel.js';
import type {PromptSnapshot} from '../prompt/snapshot.js';
import {CommandContextCache, commandWords, type CommandContextId} from '../prompt/commandContext.js';
import {resolvePathAbbreviations} from '../prompt/pathDisplay.js';
import {resolvePromptContext, type PromptContext} from '../shell/ShellContext.js';
import {ShellSession} from '../shell/ShellSession.js';
import {TerminalRenderer} from '../terminal/TerminalRenderer.js';
import {KeyDecoder, type Key} from '../terminal/keys.js';
import {promptConfigurationPath} from '../configuration/paths.js';
import {displayWidth, repeatToWidth, truncateAnsi, truncateText} from '../util/text.js';
import {parseSlashCommand, slashCommands, slashSuggestions, suggestionWindow} from '../commands/slashCommands.js';
import {copyFeedback, copyStats, writeClipboard} from '../clipboard/clipboard.js';
import {shouldPassthrough} from '../passthrough/PassthroughPolicy.js';
import {layoutInput, graphemes} from '../input/inputLayout.js';
import {shimmerText, shimmerTextWithColors} from '../status/shimmer.js';
import {TaskProgress} from '../status/TaskProgress.js';
import {completedActivity, liveActivityParts} from '../status/activity.js';
import {extractFacts} from '../status/adapters.js';
import {foreground, background, UI_COLORS} from '../ui/palette.js';
import {calculateScreenLayout} from './layout.js';
import {AppearanceState, handleAppearanceKey, renderAppearancePanel, BLUR_MODES} from '../appearance/AppearancePanel.js';
import {KeyboardState, handleKeyboardKey, renderKeyboardPanel} from '../keyboard/KeyboardPanel.js';
import {installGhosttyKeybinding} from '../keyboard/ghosttyKeyboard.js';
import {detectGhosttyConfigPath, readGhosttySettings, saveGhosttySettings} from '../appearance/ghostty.js';
import {Highlighter} from '../input/Highlighter.js';
import {handleSyntaxPanelKey, renderSyntaxPanel, type SyntaxPanelState} from '../input/SyntaxPanel.js';
import {syntaxCharStyles, syntaxSgrForConfiguration, type SyntaxSgr} from '../input/syntaxTheme.js';
import {SemanticService} from '../shell/SemanticService.js';
import {chooseShellHandoff, type ShellHandoffDecision} from '../shell/ShellHandoff.js';
import {TranscriptStore, type TranscriptSession} from '../sessions/TranscriptStore.js';
import {SessionJournal} from '../sessions/SessionJournal.js';
import {createResumeBrowser, navigateResume, resumeDayLabel, visibleResumeSessions, type ResumeBrowserState} from '../sessions/ResumeBrowser.js';

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
const PASTE_ATOM_BACKGROUND = '\u001B[48;2;63;65;82m';
const STATUS_REFRESH_MS = 100;

export class TerminalApp {
  private readonly buildIdentity = readBuildIdentity();
  private readonly initialCwd = process.cwd();
  private shellCwd = this.initialCwd;
  private readonly renderer = new TerminalRenderer();
  private readonly editor = new CommandEditor();
  private readonly highlighter = new Highlighter();
  private readonly semanticService: SemanticService;
  private readonly keyDecoder = new KeyDecoder();
  private readonly output = new OutputBuffer(() => {
    this.historyViewport.latest();
    if (this.running) this.running.cleared = true;
  });
  private readonly tapActivityObserver = new TapActivityObserver();
  private readonly historyViewport = new HistoryViewport();
  private readonly session: ShellSession;
  private readonly historyService = new HistoryService();
  private readonly transcriptStore = new TranscriptStore();
  private readonly completionService = new CompletionService();
  private shellSuggestions: CompletionCandidate[] = [];
  private lastSuggestionInput = "";
  private context: PromptContext = {cwd: process.cwd(), project: '…', exitStatus: 0};
  private readonly commandContexts = new CommandContextCache(() => this.render());
  private promptConfiguration: PromptConfiguration = loadPromptConfiguration();
  private effectivePromptProvider: PromptProviderId = this.promptConfiguration.provider;
  private starshipStatus?: StarshipStatus;
  /** Live Starship/Powerlevel10k rendering for the effective provider. */
  private externalPrompt?: StarshipPromptResult;
  private externalPromptError?: string;
  /** /prompt preview rendering; never shown as the live prompt. */
  private panelExternalPrompt?: {provider: PromptProviderId; result: StarshipPromptResult};
  private p10kStatus?: Powerlevel10kStatus;
  private promptPanelState?: PromptPanelState;
  private transcriptPanelState?: TranscriptPanelState;
  private syntaxPanelState?: SyntaxPanelState;
  private settingsPanelState?: SettingsPanelState;
  private running?: {command: string; startedAt: number; interrupted: boolean; cleared: boolean; startId: number};
  private hoveredLineIndex?: number;
  private focusedLineIndex?: number;
  private focusedActivityId?: string;
  private focusedCommandIndex?: number;
  private passthrough = false;
  private externalPassthrough = false;
  private lastOutputTime = 0;
  private selectedSuggestion = 0;
  private activityTimer?: NodeJS.Timeout;
  private activityAnimationNow = Date.now();
  /** One pending timeout at a time drives the welcome cat's occasional blink. */
  private welcomeBlinkTimer?: NodeJS.Timeout;
  private welcomeBlinkCount = 0;
  private contextGeneration = 0;
  private appearanceState?: AppearanceState;
  private keyboardState?: KeyboardState;
  /**
   * Where the currently-open top-level panel (prompt/transcript/appearance/
   * keyboard) was opened from. Esc at that panel's own root uses this to
   * decide whether to return to the /settings root or close to the
   * composer, instead of every panel guessing independently.
   */
  private panelOrigin?: 'settings';
  private panelOriginView: SettingsView = 'settings';
  private panelOriginRow = 0;
  /** Whether continuous session journaling is persisting; shown in Status. */
  private journalActive = false;
  private lastPtyRows = 0;
  private lastPtyColumns = 0;
  private stopped = false;
  private originalRawMode = false;
  private shellHandoffCwd?: string;
  private shellHandoffRequested = false;
  private presentationStartCwd = process.cwd();
  private resumeBrowser?: ResumeBrowserState;
  private journal?: SessionJournal;
  private preparingCommand = false;
  private readonly done: Promise<number>;
  private finish!: (exitCode: number) => void;

  constructor() {
    setIconStyle(this.promptConfiguration.glyphStyle);
    this.output.setWelcome(createWelcomeSnapshot(this.buildIdentity, this.initialCwd));
    this.output.setTranscriptAppearance(this.promptConfiguration.transcript);
    const dimensions = this.dimensions();
    this.session = new ShellSession(this.initialCwd, dimensions.columns, Math.max(2, dimensions.rows - 4));
    this.semanticService = new SemanticService(this.initialCwd);
    this.done = new Promise(resolve => {
      this.finish = resolve;
    });
    this.session.on('data', data => this.onShellData(data));
    this.session.on('prompt', marker => this.onShellPrompt(marker.exitCode, marker.cwd));
    this.session.on('exit', event => this.stop(event.exitCode));
  }

  async run(): Promise<number> {
    this.journal = new SessionJournal(this.transcriptStore, this.promptConfiguration.sessionRetention,
      () => ({startCwd: this.presentationStartCwd, finalCwd: this.shellCwd, transcript: this.output.transcript()}),
      () => this.output.addFrontendInteraction('/resume', 'Could not persist the current session; check local storage.', ERROR));
    try { await this.journal.start(); this.journalActive = true; } catch {
      this.output.addFrontendInteraction('/resume', 'Continuous session journaling could not start; check local storage.', ERROR);
    }
    if (!this.promptConfiguration.glyphChoiceComplete) {
      this.settingsPanelState = {section: 'appearance', selectedIndex: this.promptConfiguration.glyphStyle === 'nerd' ? 0 : 1,
        glyphStyle: this.promptConfiguration.glyphStyle, onboarding: true};
    } else if (!this.promptConfiguration.onboardingComplete) {
      this.promptPanelState = {onboarding: true, step: 'provider', selectedIndex: PROVIDER_ORDER.indexOf(this.promptConfiguration.provider),
        draft: structuredClone(this.promptConfiguration), saved: structuredClone(this.promptConfiguration)};
    }
    this.renderer.enter();
    if (process.stdin.isTTY) {
      this.originalRawMode = process.stdin.isRaw;
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', this.onInput);
    process.stdout.on('resize', this.onResize);
    process.once('SIGTERM', this.onTerminate);
    process.once('SIGHUP', this.onTerminate);
    process.on('exit', () => {
      if (!this.stopped) {
        if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
        this.renderer.leave();
      }
    });
    this.activityTimer = setInterval(() => {
      if (!this.running) return;
      this.activityAnimationNow = Date.now();
      this.output.tickActiveCommand();
      this.render();
    }, STATUS_REFRESH_MS);
    this.scheduleWelcomeBlink();
    this.render();
    const exitCode = await this.done;
    try { await this.journal.close(); } catch {
      process.stderr.write('NMSh could not finish persisting the current presentation session.\n');
    }
    return exitCode;
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
    const keys = this.keyDecoder.push(data);
    for (const key of keys) this.handleKey(key);
    // Passive motion renders only when hover changes; skip the generic frame.
    if (keys.length === 0 || keys.some(key => key.kind !== 'mouseMove')) this.render();
  };

  private readonly onResize = (): void => {
    if (this.externalPassthrough) return;
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
    if (this.settingsPanelState) {
      this.handleSettingsKey(key, this.settingsPanelState);
      this.render();
      return;
    }
    if (this.syntaxPanelState) {
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.syntaxPanelState = undefined;
        this.returnFromPanel();
        this.render();
      } else if (key.kind === 'enter') {
        this.saveSyntaxSettings();
      } else if (handleSyntaxPanelKey(key, this.syntaxPanelState)) this.render();
      return;
    }
    if (this.transcriptPanelState) {
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.transcriptPanelState = undefined;
        this.returnFromPanel();
        this.render();
      } else if (key.kind === 'enter') {
        this.saveTranscriptSettings();
      } else if (handleTranscriptPanelKey(key, this.transcriptPanelState)) this.render();
      return;
    }
    if (this.promptPanelState) {
      if (this.promptPanelState.step === 'installProgress') return;
      if (this.promptPanelState.step === 'p10kResult') {
        if (key.kind === 'enter' || key.kind === 'escape') {
          this.promptPanelState.step = 'powerlevel10k';
          this.promptPanelState.selectedIndex = 1;
          this.render();
        }
        return;
      }
      if ((this.promptPanelState.step === 'p10kConfirm' || this.promptPanelState.step === 'p10kReady')
        && (key.kind === 'escape' || key.kind === 'interrupt')) {
        this.promptPanelState.step = 'powerlevel10k';
        this.promptPanelState.selectedIndex = 1;
        this.render();
        return;
      }
      if (this.promptPanelState.step === 'starshipModules' && (key.kind === 'escape' || key.kind === 'interrupt')) {
        this.promptPanelState.step = 'starship';
        this.promptPanelState.selectedIndex = 1;
        this.render();
        return;
      }
      if (this.promptPanelState.step === 'starshipConfirm' && (key.kind === 'escape' || key.kind === 'interrupt')) {
        this.promptPanelState.step = 'starshipModules';
        this.promptPanelState.starshipProposal = undefined;
        this.render();
        return;
      }
      if (this.promptPanelState.step === 'installResult' || this.promptPanelState.step === 'installDetails') {
        if (this.promptPanelState.step === 'installDetails') {
          if (key.kind === 'enter' || key.kind === 'escape') this.promptPanelState.step = 'installResult';
        } else if (key.kind === 'text' && key.value.toLowerCase() === 'd') {
          this.promptPanelState.step = 'installDetails';
        } else if (key.kind === 'escape' || key.kind === 'interrupt') {
          this.promptPanelState.step = 'starship';
        } else if (key.kind === 'enter') {
          this.promptPanelState.step = this.promptPanelState.task?.state.status === 'failed' ? 'installDetails' : 'starship';
        }
        this.render();
        return;
      }
      if (key.kind === 'escape' && this.promptPanelState.step === 'modules') {
        // Esc leaves the module manager, keeping its draft edits for the final save.
        this.promptPanelState.step = 'appearance';
        this.promptPanelState.selectedIndex = APPEARANCE_MODULES_ROW;
        this.render();
      } else if (key.kind === 'escape' || key.kind === 'interrupt') {
        if (this.promptPanelState.onboarding) void this.savePromptSettings();
        else { this.promptPanelState = undefined; this.returnFromPanel(); this.render(); }
      } else if (key.kind === 'enter') {
        void this.advancePromptPanel();
      } else if (handlePromptPanelKey(key, this.promptPanelState)) this.render();
      return;
    }
    if (this.resumeBrowser) {
      const browser = this.resumeBrowser;
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.resumeBrowser = undefined;
      } else if (key.kind === 'up') {
        browser.selectedIndex = Math.max(0, browser.selectedIndex - 1);
      } else if (key.kind === 'down') {
        browser.selectedIndex = Math.max(0, Math.min(visibleResumeSessions(browser).length - 1, browser.selectedIndex + 1));
      } else if (key.kind === 'left' || key.kind === 'right') {
        navigateResume(browser, 'week', key.kind === 'left' ? -1 : 1);
      } else if (key.kind === 'selectLeft' || key.kind === 'selectRight') {
        navigateResume(browser, 'month', key.kind === 'selectLeft' ? -1 : 1);
      } else if (key.kind === 'text') {
        browser.query += key.value;
        browser.selectedIndex = 0;
      } else if (key.kind === 'backspace') {
        browser.query = browser.query.slice(0, -1);
        browser.selectedIndex = 0;
      } else if (key.kind === 'enter') {
        void this.resumeSelectedSession();
      }
      this.render();
      return;
    }
    if (key.kind === 'mouseMove' || key.kind === 'mouseClick') {
      const {columns, rows} = this.dimensions();
      const fullInput = this.layoutEditorInput(columns);
      const overlayRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : this.appearanceState ? 3 : this.keyboardState ? 6 : (this.editor.hasPasteAtoms ? 0 : this.shellSuggestions.length);
      const layout = calculateScreenLayout(rows, fullInput.allRows.length, overlayRows, Boolean(this.running), this.historyViewport.detached, this.output.wrapped(columns).length > 0, this.promptConfiguration.placement, this.hasVisibleProviderPrompt(), this.promptConfiguration.composerLayout);
      if (key.y && key.y <= layout.outputHeight) {
        const wrapped = this.output.wrapped(columns);
        const viewStart = this.historyViewport.resolve(wrapped.length, layout.outputHeight);

        // Exact same top-aligned calculation as render().
        const topPadding = 0;

        const localVisibleIndex = key.y - 1 - topPadding;

        const sticky = localVisibleIndex === 0 ? this.stickyHeader(wrapped, viewStart) : undefined;
        if (sticky) {
          // The sticky overlay owns the top row: a click jumps to the block's real header.
          if (key.kind === 'mouseClick') {
            this.historyViewport.scrollLines(wrapped.length, layout.outputHeight, sticky.targetIndex - viewStart);
            this.hoveredLineIndex = undefined;
            this.render();
          } else if (this.hoveredLineIndex !== undefined) {
            this.hoveredLineIndex = undefined;
            this.render();
          }
        } else if (localVisibleIndex >= 0) {
          const row = wrapped[viewStart + localVisibleIndex];
          if (row) {
            if (key.kind === 'mouseClick' && row.isFoldHint && row.commandIndex !== undefined) {
              this.output.toggleExpanded(row.commandIndex);
              this.render();
            }
            if (key.kind === 'mouseClick' && row.isFoldHint && row.activityId) {
              this.output.toggleActivityExpanded(row.activityId);
              this.render();
            }
            // Re-render only when the hovered logical row changes; rows without a line clear hover.
            if (row.lineIndex !== this.hoveredLineIndex) {
              this.hoveredLineIndex = row.lineIndex;
              this.render();
            }
          } else if (this.hoveredLineIndex !== undefined) {
            this.hoveredLineIndex = undefined;
            this.render();
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
        this.returnFromPanel();
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
        this.returnFromPanel();
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
      if (!this.running && this.editor.unwrapAdjacentPasteAtom()) {
        this.render();
        return;
      }
      if (this.focusedActivityId) this.output.toggleActivityExpanded(this.focusedActivityId);
      else if (this.focusedCommandIndex !== undefined) this.output.toggleExpanded(this.focusedCommandIndex);
      else this.output.toggleMostRelevant(this.focusedLineIndex);
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

    const suggestions = this.editor.hasPasteAtoms ? [] : slashSuggestions(this.editor.text);
    const isSlash = !this.editor.hasPasteAtoms && this.editor.text.startsWith('/');
    if (key.kind === 'up' && suggestions.length > 0) {
      this.selectedSuggestion = (this.selectedSuggestion - 1 + suggestions.length) % suggestions.length;
    } else if (key.kind === 'down' && suggestions.length > 0) {
      this.selectedSuggestion = (this.selectedSuggestion + 1) % suggestions.length;
    } else if (key.kind === 'complete') {
      const action = tabCompletionAction(this.shellSuggestions.length, isSlash ? suggestions.length : 0);
      if (action === 'shell-suggestion') {
        const suggestion = this.shellSuggestions[Math.min(this.selectedSuggestion, this.shellSuggestions.length - 1)];
        if (suggestion) this.applySuggestion(suggestion);
      } else if (action === 'slash-suggestion') {
        const slash = suggestions[Math.min(this.selectedSuggestion, suggestions.length - 1)];
        if (slash) this.applySuggestion({insertion: slash.name});
      }
      return;
    } else if (key.kind === 'text') {
      this.editor.insert(key.value);
      this.selectedSuggestion = 0;
    } else if (key.kind === 'paste') {
      this.editor.insertPaste(key.value);
      this.selectedSuggestion = 0;
    } else if (key.kind === 'focusNext' || key.kind === 'focusPrevious') {
      const dir = key.kind === 'focusNext' ? 1 : -1;
      const {columns} = this.dimensions();
      const metadataRows: Array<{lineIndex: number; activityId?: string; commandIndex?: number}> = Array.from(this.output.lineTypes.entries())
        .filter(([, type]) => type === 'metadata')
        .map(([lineIndex]) => ({lineIndex}));

      const foldHintRows: Array<{lineIndex: number; activityId?: string; commandIndex?: number}> = this.output.wrapped(columns)
        .filter(r => r.isFoldHint && r.lineIndex !== undefined)
        .map(r => ({lineIndex: r.lineIndex as number, activityId: r.activityId, commandIndex: r.commandIndex}));

      const seenTargets = new Set<string>();
      const focusableRows = [...metadataRows, ...foldHintRows]
        .filter(target => {
          const key = target.activityId ? `activity:${target.activityId}`
            : target.commandIndex !== undefined ? `command:${target.commandIndex}` : `line:${target.lineIndex}`;
          if (seenTargets.has(key)) return false;
          seenTargets.add(key);
          return true;
        })
        .sort((a, b) => a.lineIndex - b.lineIndex);

      if (focusableRows.length > 0) {
        const matchesFocus = (target: typeof focusableRows[number]) => target.activityId
          ? target.activityId === this.focusedActivityId
          : target.commandIndex !== undefined
            ? target.commandIndex === this.focusedCommandIndex
            : target.lineIndex === this.focusedLineIndex && this.focusedActivityId === undefined && this.focusedCommandIndex === undefined;
        const currentIndex = focusableRows.findIndex(matchesFocus);
        if (currentIndex === -1) {
          const target = dir === 1 ? focusableRows[0] : focusableRows[focusableRows.length - 1];
          this.focusedLineIndex = target?.lineIndex;
          this.focusedActivityId = target?.activityId;
          this.focusedCommandIndex = target?.commandIndex;
        } else {
          const nextIndex = (currentIndex + dir + focusableRows.length) % focusableRows.length;
          const target = focusableRows[nextIndex];
          this.focusedLineIndex = target?.lineIndex;
          this.focusedActivityId = target?.activityId;
          this.focusedCommandIndex = target?.commandIndex;
        }

        const {columns, rows} = this.dimensions();
        const fullInput = this.layoutEditorInput(columns);
        const overlayRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : this.appearanceState ? 3 : this.keyboardState ? 6 : (this.editor.hasPasteAtoms ? 0 : this.shellSuggestions.length);
        const layout = calculateScreenLayout(rows, fullInput.allRows.length, overlayRows, Boolean(this.running), this.historyViewport.detached, this.output.wrapped(columns).length > 0, this.promptConfiguration.placement, this.hasVisibleProviderPrompt(), this.promptConfiguration.composerLayout);

        const wrapped = this.output.wrapped(columns);
        const wrappedIndex = wrapped.findIndex(r => this.focusedActivityId
          ? r.activityId === this.focusedActivityId && r.isFoldHint
          : this.focusedCommandIndex !== undefined
            ? r.commandIndex === this.focusedCommandIndex && r.isFoldHint
            : r.lineIndex === this.focusedLineIndex);
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
    else if (key.kind === 'up') {
      const {columns} = this.dimensions();
      this.editor.moveUp(columns, this.inputFirstLinePrefix(columns));
    } else if (key.kind === 'selectUp') {
      const {columns} = this.dimensions();
      this.editor.selectUp(columns, this.inputFirstLinePrefix(columns));
    } else if (key.kind === 'down') {
      const {columns} = this.dimensions();
      this.editor.moveDown(columns, this.inputFirstLinePrefix(columns));
    } else if (key.kind === 'selectDown') {
      const {columns} = this.dimensions();
      this.editor.selectDown(columns, this.inputFirstLinePrefix(columns));
    }
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
        if (this.editor.text.trim() === '/zsh') {
          this.editor.clear();
          this.output.addFrontendInteraction('/zsh', 'Wait for the foreground command to finish or interrupt it, then run /zsh.', INFO);
        } else if (this.editor.text.trim() === '/clear') {
          this.editor.clear();
          this.output.addFrontendInteraction('/clear', 'Wait for the foreground command to finish before archiving this transcript.', INFO);
        } else if (this.editor.text.trim() === '/resume') {
          this.editor.clear();
          this.output.addFrontendInteraction('/resume', 'Wait for the foreground command to finish before switching transcripts.', INFO);
        } else {
          this.session.write(`${this.editor.text}\r`);
        }
        this.editor.clear();
      } else {
        if (this.preparingCommand) return;
        void this.submit();
      }
    }
  }


  private async fetchSuggestions(): Promise<void> {
    if (this.running || this.editor.hasPasteAtoms || this.editor.text.startsWith('/')) {
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
      else if (slash.kind === 'appearance') { this.panelOrigin = undefined; await this.startAppearance(); }
      else if (slash.kind === 'prompt') { this.panelOrigin = undefined; await this.startPromptSettings(false); }
      else if (slash.kind === 'settings') this.openSettingsPanel(slash.view);
      else if (slash.kind === 'transcript') { this.panelOrigin = undefined; this.startTranscriptSettings(); }
      else if (slash.kind === 'syntax') { this.panelOrigin = undefined; this.startSyntaxSettings(); }
      else if (slash.kind === 'keyboard') { this.panelOrigin = undefined; await this.startKeyboard(); }
      else if (slash.kind === 'zsh') this.leaveForOrdinaryZsh();
      else if (slash.kind === 'version') this.output.addFrontendInteraction(command, formatBuildIdentity(this.buildIdentity), INFO);
      else if (slash.kind === 'clear') await this.startFreshPresentation();
      else if (slash.kind === 'resume') await this.openResumePicker();
      else if (slash.kind === 'help') this.showHelp(command);
      else this.output.addFrontendInteraction(command, `Unknown NMSh command: ${(slash as any).input || command}`, ERROR);
      this.render();
      return;
    }

    const contextAtSubmission = this.context;
    const startId = this.output.beginCommand(command, this.formatCommandAnsi(command, null), (mode) => {
      if (mode === 'PASSTHROUGH' && !this.passthrough) {
        this.passthrough = true;
        this.renderer.suspendForPassthrough();
        const dimensions = this.dimensions();
        this.session.resize(dimensions.columns, dimensions.rows);
      }
      this.render();
    }, {cwd: this.shellCwd, project: contextAtSubmission.project, branch: contextAtSubmission.branch,
      prompt: this.currentPromptSnapshot(command)});
    this.tapActivityObserver.reset(this.output.activeOutputStartId ?? startId);
    this.output.setActiveActivities([]);
    this.formatCommandAnsi(command, startId);
    const startedAt = Date.now();
    this.running = {command, startedAt, interrupted: false, cleared: false, startId};
    void this.journal?.flush().catch(() => {
      this.output.addFrontendInteraction('/resume', 'Could not persist the submitted command.', ERROR);
    });
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
       this.returnFromPanel();
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

  private async archiveCurrentPresentation(): Promise<void> {
    if (this.journal) {
      await this.journal.finish();
      return;
    }
    const transcript = this.output.transcript();
    await this.transcriptStore.archive({
      startCwd: this.presentationStartCwd,
      finalCwd: this.shellCwd,
      transcript,
    });
  }

  private async startFreshPresentation(): Promise<void> {
    if (this.running) {
      this.output.addFrontendInteraction('/clear', 'Wait for the foreground command to finish before clearing the transcript.', INFO);
      return;
    }
    try { await this.archiveCurrentPresentation(); } catch {
      this.output.addFrontendInteraction('/clear', 'Could not archive this transcript; the current view was kept.', ERROR);
      return;
    }
    this.output.clearPresentation();
    this.presentationStartCwd = this.shellCwd;
    this.output.setWelcome(createWelcomeSnapshot(this.buildIdentity, this.presentationStartCwd));
    this.historyViewport.latest();
    try { await this.journal?.start(); this.journalActive = Boolean(this.journal); } catch {
      this.journalActive = false;
      this.output.addFrontendInteraction('/clear', 'A fresh view started, but its journal could not be persisted yet.', ERROR);
    }
  }

  private async openResumePicker(): Promise<void> {
    try {
      const sessions = (await this.transcriptStore.listSummaries()).filter(session => session.id !== this.journal?.id);
      if (sessions.length === 0) {
        this.output.addFrontendInteraction('/resume', 'No archived NMSh transcript sessions were found.', INFO);
        return;
      }
      const browser = createResumeBrowser(sessions);
      this.resumeBrowser = browser;
      void this.indexResumeCommands(browser);
    } catch {
      this.output.addFrontendInteraction('/resume', 'Could not read local transcript archives.', ERROR);
    }
  }

  private async resumeSelectedSession(): Promise<void> {
    const browser = this.resumeBrowser;
    if (!browser) return;
    const selected = visibleResumeSessions(browser)[browser.selectedIndex];
    if (!selected) return;
    let restored: TranscriptSession;
    try {
      restored = await this.transcriptStore.load(selected.id);
      const current = this.output.transcript();
      if (current.welcome || current.records.length > 0 || current.lines.length > 0) await this.archiveCurrentPresentation();
    } catch {
      this.output.addFrontendInteraction('/resume', 'Could not restore the selected transcript; the current view was kept.', ERROR);
      this.resumeBrowser = undefined;
      return;
    }
    this.output.restoreTranscript(restored.transcript);
    this.presentationStartCwd = selected.startCwd;
    this.resumeBrowser = undefined;
    this.historyViewport.latest();
    try { await this.journal?.start(); this.journalActive = Boolean(this.journal); } catch {
      this.journalActive = false;
      this.output.addFrontendInteraction('/resume', 'The transcript was restored, but its new journal could not be persisted yet.', ERROR);
    }
    this.render();
  }

  /** Build command search data in memory, yielding regularly to keep the UI responsive. */
  private async indexResumeCommands(browser: ResumeBrowserState): Promise<void> {
    for (const [index, item] of browser.sessions.entries()) {
      if (this.resumeBrowser !== browser || this.stopped) return;
      try {
        const session = await this.transcriptStore.load(item.id);
        browser.commandText.set(item.id, session.transcript.records.map(record => record.command).join('\n'));
      } catch { /* Keep invalid archives out of command search. */ }
      if (index % 16 === 15) {
        if (browser.query) this.render();
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
    browser.indexing = false;
    if (this.resumeBrowser === browser) this.render();
  }


  private showHelp(command: string): void {
    const summary = slashCommands.map(item => `${item.name} — ${item.description}`).join(' · ');
    const helpText = `${summary}\n\n${INFO}✻ Large multiline paste is one editable atom; Enter submits its original text. Press Ctrl+O beside it to inspect or unwrap.\n✻ Portable Select-All: Alt+A\n✻ VS Code Cmd+A Keybinding JSON:\n  { "key": "cmd+a", "command": "workbench.action.terminal.sendSequence", "args": { "text": "\\u001b[97;9u" }, "when": "terminalFocus" }${RESET}`;
    this.output.addFrontendInteraction(command, helpText, ACCENT);
  }

  private onShellData(data: string): void {
    if (this.passthrough) {
      process.stdout.write(data);
    } else {
      this.lastOutputTime = Date.now();
      const wasPassthrough = this.passthrough;
      this.output.write(data);
      this.journal?.schedule();
      this.output.setActiveActivities(this.tapActivityObserver.push(data, Date.now()));
      if (!wasPassthrough && this.passthrough) {
        process.stdout.write(data);
      } else {
        this.render();
      }
    }
  }

  private onShellPrompt(exitCode: number, cwd: string): void {
    this.shellCwd = cwd;
    this.context.exitStatus = exitCode;
    if (!this.running) {
      void this.refreshContext(cwd);
      this.render();
      return;
    }

    const command = this.running;
    const completedAt = new Date();
    const elapsed = completedAt.getTime() - command.startedAt;
    this.output.setActiveActivities(this.tapActivityObserver.finish(completedAt.getTime()));
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
    void this.journal?.flush().catch(() => {
      this.output.addFrontendInteraction('/resume', 'Could not persist the completed command.', ERROR);
    });
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
    const [context, pathAbbreviations] = await Promise.all([
      resolvePromptContext(cwd, undefined, undefined, {status: this.promptConfiguration.nmsh.gitEnabled}),
      resolvePathAbbreviations(cwd, homedir()),
    ]);
    if (generation !== this.contextGeneration || this.stopped) return;
    this.context = {...context, pathAbbreviations, exitStatus: this.context.exitStatus ?? 0};
    await this.refreshProviderPrompt();
    this.render();
  }

  /**
   * Prompt context plus show-on-command state from the editor buffer. The
   * text is only tokenized; lookups are cached reads that never block typing.
   */
  private promptContext(command = this.editor.text): PromptContext {
    const words = commandWords(command);
    const wanted = (id: CommandContextId) => this.promptConfiguration.modules.some(module => module.id === id && module.visible
      && (module.condition !== 'onCommand' || isOnCommandRelevant(id, words)));
    const kubeContext = wanted('kubeContext') ? this.commandContexts.get('kubeContext') : undefined;
    const dockerContext = wanted('dockerContext') ? this.commandContexts.get('dockerContext') : undefined;
    return {...this.context, commandWords: words, ...(kubeContext ? {kubeContext} : {}), ...(dockerContext ? {dockerContext} : {})};
  }

  private currentPromptSnapshot(command?: string): PromptSnapshot {
    if (this.effectivePromptProvider !== 'nmsh' && this.externalPrompt) {
      return {provider: this.effectivePromptProvider, layout: this.promptConfiguration.composerLayout,
        segments: structuredClone(this.externalPrompt.segments), cwd: this.context.cwd,
        ...(this.context.branch ? {branch: this.context.branch} : {})};
    }
    return nativePromptSnapshot(this.promptContext(command), this.promptConfiguration);
  }

  private starshipEnvironment(configuration: PromptConfiguration): NodeJS.ProcessEnv {
    return configuration.starship.configPath ? {...process.env, STARSHIP_CONFIG: configuration.starship.configPath} : process.env;
  }

  private detectPowerlevel10k(configuration: PromptConfiguration): Powerlevel10kStatus {
    const env = configuration.powerlevel10k.configPath
      ? {...process.env, POWERLEVEL9K_CONFIG_FILE: configuration.powerlevel10k.configPath}
      : process.env;
    const themePath = configuration.powerlevel10k.themePath;
    return detectPowerlevel10k(env, undefined, themePath ? [themePath] : undefined);
  }

  /** Render an external provider for the current context; throws when it is unavailable. */
  private async renderExternalPrompt(configuration: PromptConfiguration): Promise<StarshipPromptResult> {
    if (configuration.provider === 'powerlevel10k') {
      this.p10kStatus = this.detectPowerlevel10k(configuration);
      return renderPowerlevel10kPrompt(this.context, this.p10kStatus);
    }
    const env = this.starshipEnvironment(configuration);
    this.starshipStatus ??= await detectStarship(env);
    if (!this.starshipStatus.installed) throw new Error('Starship is not installed or not available on PATH.');
    return renderStarshipPrompt(this.context, this.starshipStatus, env);
  }

  private async refreshProviderPrompt(): Promise<void> {
    if (this.promptConfiguration.provider === 'nmsh') {
      this.effectivePromptProvider = 'nmsh';
      this.externalPrompt = undefined;
      this.externalPromptError = undefined;
      return;
    }
    try {
      this.externalPrompt = await this.renderExternalPrompt(this.promptConfiguration);
      this.externalPromptError = undefined;
      this.effectivePromptProvider = this.promptConfiguration.provider;
    } catch (error) {
      // Fall back truthfully: NMSh Native is active and the saved provider says so.
      this.externalPromptError = error instanceof Error ? error.message : String(error);
      this.externalPrompt = undefined;
      this.effectivePromptProvider = 'nmsh';
      this.promptConfiguration.provider = 'nmsh';
      try { savePromptConfiguration(this.promptConfiguration); } catch { /* Runtime fallback remains in effect. */ }
    }
  }

  /** Render the selected external provider for the /prompt preview only. */
  private async refreshPanelPreview(state: PromptPanelState): Promise<void> {
    try {
      this.panelExternalPrompt = {provider: state.draft.provider, result: await this.renderExternalPrompt(state.draft)};
    } catch (error) {
      this.panelExternalPrompt = undefined;
      state.message = `${providerLabel(state.draft.provider)} preview failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async startPromptSettings(onboarding: boolean): Promise<void> {
    this.promptPanelState = {onboarding, step: 'provider', selectedIndex: PROVIDER_ORDER.indexOf(this.promptConfiguration.provider),
      draft: structuredClone(this.promptConfiguration), saved: structuredClone(this.promptConfiguration)};
    this.panelExternalPrompt = undefined;
    if (this.promptConfiguration.provider === 'starship') {
      this.starshipStatus = await detectStarship(this.starshipEnvironment(this.promptConfiguration));
      this.promptPanelState.starshipStatus = this.starshipStatus;
    } else if (this.promptConfiguration.provider === 'powerlevel10k') {
      this.promptPanelState.p10kStatus = this.detectPowerlevel10k(this.promptConfiguration);
    }
    if (this.promptConfiguration.provider !== 'nmsh') await this.refreshPanelPreview(this.promptPanelState);
    this.render();
  }

  private async runPowerlevel10kWizard(status: Powerlevel10kStatus): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The Powerlevel10k wizard requires a real terminal.');
    if (this.running || this.passthrough || this.externalPassthrough) throw new Error('The terminal is busy.');
    const ignoreInterrupt = (): void => { /* The foreground wizard handles Ctrl+C. */ };
    this.externalPassthrough = true;
    let inputDetached = false;
    let rawModeReleased = false;
    let rendererLeft = false;
    let interruptAttached = false;
    try {
      process.stdin.off('data', this.onInput);
      process.stdin.pause();
      inputDetached = true;
      process.stdin.setRawMode(false);
      rawModeReleased = true;
      this.renderer.leave();
      rendererLeft = true;
      process.on('SIGINT', ignoreInterrupt);
      interruptAttached = true;
      return await launchPowerlevel10kConfigurator(status);
    } finally {
      if (interruptAttached) process.off('SIGINT', ignoreInterrupt);
      if (!this.stopped) {
        if (rendererLeft) this.renderer.enter();
        if (rawModeReleased) process.stdin.setRawMode(true);
        this.keyDecoder.reset();
        if (inputDetached) {
          process.stdin.on('data', this.onInput);
          process.stdin.resume();
        }
        this.renderer.invalidate();
      }
      this.externalPassthrough = false;
      this.render();
    }
  }

  private async advancePromptPanel(): Promise<void> {
    const state = this.promptPanelState;
    if (!state) return;
    if (state.step === 'provider') {
      state.draft.provider = PROVIDER_ORDER[state.selectedIndex] ?? 'nmsh';
      state.message = undefined;
      if (state.draft.provider === 'starship') {
        state.starshipStatus = await detectStarship(this.starshipEnvironment(state.draft));
        this.starshipStatus = state.starshipStatus;
        state.step = 'starship';
        state.selectedIndex = 0;
        if (state.starshipStatus.installed) await this.refreshPanelPreview(state);
      } else if (state.draft.provider === 'powerlevel10k') {
        state.p10kStatus = this.detectPowerlevel10k(state.draft);
        state.step = 'powerlevel10k';
        state.selectedIndex = 0;
        if (state.p10kStatus.installed) await this.refreshPanelPreview(state);
      } else {
        state.step = 'layout';
        state.selectedIndex = layoutChoiceIndex(state.draft);
      }
    } else if (state.step === 'powerlevel10k') {
      const installed = Boolean(state.p10kStatus?.installed);
      const choice = installed ? ['use', 'configure', 'native', 'back'][state.selectedIndex] : ['native', 'back'][state.selectedIndex];
      if (choice === 'use') {
        state.step = 'layout';
        state.selectedIndex = layoutChoiceIndex(state.draft);
      } else if (choice === 'configure') {
        state.step = 'p10kConfirm';
        state.selectedIndex = 0;
      } else if (choice === 'native') {
        state.draft.provider = 'nmsh';
        state.step = 'layout';
        state.selectedIndex = layoutChoiceIndex(state.draft);
      } else {
        state.step = 'provider'; state.selectedIndex = PROVIDER_ORDER.indexOf('powerlevel10k');
      }
    } else if (state.step === 'p10kConfirm') {
      if (state.selectedIndex === 1) {
        state.step = 'powerlevel10k'; state.selectedIndex = 1;
      } else if (state.p10kStatus) {
        try {
          state.p10kPreparation = await preparePowerlevel10kConfigurator(state.p10kStatus);
          state.step = 'p10kReady';
          state.selectedIndex = 0;
          state.message = undefined;
        } catch (error) {
          state.message = `Could not back up Powerlevel10k config: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } else if (state.step === 'p10kReady') {
      if (state.selectedIndex === 1) {
        state.step = 'powerlevel10k'; state.selectedIndex = 1;
      } else if (state.p10kStatus && state.p10kPreparation) {
        const status = state.p10kStatus;
        const preparation = state.p10kPreparation;
        try {
          const exitCode = await this.runPowerlevel10kWizard(status);
          const configChanged = await configuratorFileChanged(preparation.config);
          const zshrcChanged = await configuratorFileChanged(preparation.zshrc);
          state.p10kStatus = this.detectPowerlevel10k(state.draft);
          state.p10kResult = [
            `Wizard exit: ${exitCode}`,
            `${preparation.config.path}: ${configChanged ? 'changed' : 'unchanged'}`,
            `${preparation.zshrc.path}: ${zshrcChanged ? 'changed' : 'unchanged'}`,
          ];
          if (state.p10kStatus.installed) await this.refreshPanelPreview(state);
          if (this.promptConfiguration.provider === 'powerlevel10k') await this.refreshProviderPrompt();
        } catch (error) {
          state.p10kResult = [`Wizard could not run: ${error instanceof Error ? error.message : String(error)}`];
        }
        state.step = 'p10kResult';
        state.selectedIndex = 0;
      }
    } else if (state.step === 'starship') {
      if (state.starshipStatus?.installed) {
        if (state.selectedIndex === 0) {
          state.draft.provider = 'starship';
          state.step = 'layout';
          state.selectedIndex = layoutChoiceIndex(state.draft);
          await this.refreshPanelPreview(state);
        } else if (state.selectedIndex === 1) {
          try {
            const adapter = new StarshipConfigAdapter(state.starshipStatus);
            state.starshipModules = await Promise.all(STARSHIP_MODULES.map(module => adapter.disabled(module)));
            state.step = 'starshipModules';
            state.selectedIndex = 0;
            state.message = undefined;
          } catch (error) {
            state.message = `Could not read Starship config: ${error instanceof Error ? error.message : String(error)}`;
          }
        } else if (state.selectedIndex === 2) {
          state.message = 'Starship presets use `starship preset <name> -o <new-path>`. Choose a new path to preserve existing files, then use STARSHIP_CONFIG or configure it in NMSh.';
        } else if (state.selectedIndex === 3) {
          state.draft.provider = 'nmsh';
          state.step = 'layout';
          state.selectedIndex = layoutChoiceIndex(state.draft);
        } else {
          state.step = 'provider'; state.selectedIndex = PROVIDER_ORDER.indexOf('starship');
        }
      } else if (state.selectedIndex === 0) {
        const hasHomebrew = (process.env.PATH ?? '').split(delimiter).some(directory => existsSync(join(directory, 'brew')));
        if (process.platform !== 'darwin' || !hasHomebrew) {
          state.message = 'Homebrew was not found. Install Starship using the official guide, then reopen /prompt.';
        } else {
          state.step = 'installConfirm'; state.selectedIndex = 0;
        }
      } else if (state.selectedIndex === 1) {
        state.draft.provider = 'nmsh';
        state.step = 'layout';
        state.selectedIndex = layoutChoiceIndex(state.draft);
      } else {
        state.step = 'provider'; state.selectedIndex = PROVIDER_ORDER.indexOf('starship');
      }
    } else if (state.step === 'starshipModules') {
      const module = STARSHIP_MODULES[state.selectedIndex];
      if (!module || !state.starshipStatus) return;
      try {
        state.starshipProposal = await new StarshipConfigAdapter(state.starshipStatus)
          .propose(module, !state.starshipModules?.[state.selectedIndex]);
        state.step = 'starshipConfirm';
        state.selectedIndex = 0;
        state.message = undefined;
      } catch (error) {
        state.message = `Could not prepare change: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else if (state.step === 'starshipConfirm') {
      if (state.selectedIndex === 1) {
        state.step = 'starshipModules';
        state.selectedIndex = STARSHIP_MODULES.indexOf(state.starshipProposal?.module ?? 'directory');
        state.starshipProposal = undefined;
      } else if (state.starshipProposal && state.starshipStatus) {
        try {
          const proposal = state.starshipProposal;
          const adapter = new StarshipConfigAdapter(state.starshipStatus);
          const backup = await adapter.apply(proposal);
          state.starshipModules = await Promise.all(STARSHIP_MODULES.map(module => adapter.disabled(module)));
          state.starshipStatus.configExists = true;
          state.step = 'starshipModules';
          state.selectedIndex = STARSHIP_MODULES.indexOf(proposal.module);
          state.starshipProposal = undefined;
          state.message = backup ? `Saved. Backup: ${backup}` : 'Saved Starship configuration.';
          await this.refreshPanelPreview(state);
          if (this.promptConfiguration.provider === 'starship') await this.refreshProviderPrompt();
        } catch (error) {
          state.message = `Could not save change: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } else if (state.step === 'installConfirm') {
      if (state.selectedIndex === 1) {
        state.step = 'starship'; state.selectedIndex = 0;
      } else {
        state.step = 'installProgress';
        state.task = new TaskProgress('Installing Starship with Homebrew', () => this.render(), Date.now(), 'Starship');
        this.render();
        const outcome = await state.task.run('brew', ['install', 'starship']);
        if (this.stopped) return;
        if (outcome.status === 'succeeded') {
          this.starshipStatus = await detectStarship(process.env);
          state.starshipStatus = this.starshipStatus;
          if (!this.starshipStatus.installed) state.task.markFailure('Homebrew completed, but starship was not found on PATH.');
        }
        state.step = 'installResult';
        state.selectedIndex = 0;
      }
    } else if (state.step === 'layout') {
      applyLayoutChoice(state.draft, state.selectedIndex);
      if (state.draft.provider === 'nmsh') { state.step = 'appearance'; state.selectedIndex = 0; }
      else await this.savePromptSettings();
    } else if (onModulesRow(state)) {
      state.step = 'modules';
      state.selectedIndex = 0;
    } else if (state.step === 'modules') {
      state.step = 'appearance';
      state.selectedIndex = APPEARANCE_MODULES_ROW;
    } else {
      await this.savePromptSettings();
    }
    this.render();
  }

  private async savePromptSettings(): Promise<void> {
    const state = this.promptPanelState;
    if (!state) return;
    state.draft.onboardingComplete = true;
    try {
      savePromptConfiguration(state.draft);
      this.promptConfiguration = structuredClone(state.draft);
      this.promptPanelState = undefined;
      this.panelExternalPrompt = undefined;
      // Turning Rich Git on needs a status probe the last refresh may have skipped.
      if (state.saved?.nmsh.gitEnabled !== state.draft.nmsh.gitEnabled) void this.refreshContext(this.shellCwd);
      await this.refreshProviderPrompt();
      // refreshProviderPrompt already fell back to NMSh and saved that truthfully.
      if (this.externalPromptError && state.draft.provider !== 'nmsh') {
        this.output.addHistoryLine(`${ERROR}${providerLabel(state.draft.provider)} prompt failed; NMSh is active. ${this.externalPromptError}${RESET}`);
      } else {
        this.output.addHistoryLine(`${SUCCESS}Prompt settings saved · ${describePromptConfiguration(this.promptConfiguration)}${RESET}`);
      }
    } catch (error) {
      state.message = `Could not save prompt settings: ${error instanceof Error ? error.message : String(error)}`;
      if (state.onboarding) state.draft.onboardingComplete = false;
    }
    this.render();
  }

  private promptPanelPreview(columns: number): string[] {
    const state = this.promptPanelState;
    if (!state) return [];
    const width = Math.max(1, columns - 4);
    const previewConfig = structuredClone(state.draft);
    if (state.step === 'provider') previewConfig.provider = PROVIDER_ORDER[state.selectedIndex] ?? 'nmsh';
    if (state.step === 'starship') previewConfig.provider = 'starship';
    if (state.step === 'powerlevel10k') previewConfig.provider = 'powerlevel10k';
    if (state.step === 'layout') applyLayoutChoice(previewConfig, state.selectedIndex);
    const boundary = `${SEPARATOR}${repeatToWidth(GLYPHS.separator, width)}${RESET}`;
    let providerRow: string;
    if (previewConfig.provider !== 'nmsh') {
      const preview = this.panelExternalPrompt?.provider === previewConfig.provider ? this.panelExternalPrompt.result : undefined;
      if (!preview) return [this.externalPanelStatusText(state, previewConfig.provider, width)];
      providerRow = this.externalPromptRow(preview, width, previewConfig.composerLayout === 'oneLine' ? 'composer' : previewConfig.placement);
    } else if (previewConfig.composerLayout === 'oneLine') {
      const prefix = buildInlineContextPrefix(this.promptContext(), width, previewConfig);
      return [boundary, `${prefix}command`, boundary];
    } else {
      providerRow = buildContextLine(this.promptContext(), width, previewConfig, previewConfig.placement);
    }
    if (previewConfig.composerLayout === 'oneLine') {
      const prefix = previewConfig.provider !== 'nmsh'
        ? `${providerRow}${RESET} `
        : buildInlineContextPrefix(this.context, width, previewConfig);
      return [boundary, `${prefix}command`, boundary];
    }
    const input = `${ACCENT}${GLYPHS.prompt}${RESET} command`;
    return previewConfig.placement === 'composer'
      ? [boundary, providerRow, input, boundary]
      : [providerRow, input, boundary];
  }

  /**
   * Presentation-only sticky command header for the current viewport. Panels
   * and passthrough own the screen, so they suppress it.
   */
  private stickyHeader(wrapped: WrappedRow[], viewStart: number): StickyHeader | undefined {
    if (this.settingsPanelActive || this.passthrough || this.externalPassthrough) return undefined;
    return stickyHeaderFor(wrapped, viewStart);
  }

  /** Current editor syntax style; cached per setting combination, never read from disk while typing. */
  private get syntaxSgr(): SyntaxSgr {
    return syntaxSgrForConfiguration(this.promptConfiguration);
  }

  private get settingsPanelActive(): boolean {
    return Boolean(this.promptPanelState || this.transcriptPanelState || this.syntaxPanelState || this.settingsPanelState
      || this.resumeBrowser || this.appearanceState || this.keyboardState);
  }

  private settingsPanelRows(columns: number): string[] {
    if (this.settingsPanelState) {
      return renderSettingsPanel(this.settingsPanelState, columns, this.dimensions().rows, {configuration: this.promptConfiguration,
        status: settingsView(this.settingsPanelState) === 'status' ? this.statusSections() : undefined});
    }
    if (this.syntaxPanelState) {
      return framePanel(renderSyntaxPanel(this.syntaxPanelState, columns, this.promptConfiguration.nmsh.palette, this.dimensions().rows - 4), columns);
    }
    if (this.transcriptPanelState) {
      return framePanel(renderTranscriptPanel(this.transcriptPanelState, columns, this.transcriptPreviewSample(), this.dimensions().rows - 4), columns);
    }
    if (this.resumeBrowser) {
      const browser = this.resumeBrowser;
      const sessions = visibleResumeSessions(browser);
      const canMove = (unit: 'week' | 'month', direction: -1 | 1) =>
        navigateResume({...browser}, unit, direction);
      const week = new Date(browser.week).toLocaleDateString();
      const rows = [`${PRIMARY}  Resume session${RESET}`,
        `${SECONDARY}  Search: ${browser.query || '_'}${browser.indexing ? `  ${SUBTLE}(indexing commands…)${SECONDARY}` : ''}${RESET}`,
        `${SUBTLE}  Week of ${week} · ← ${canMove('week', -1) ? 'previous week' : '—'} · → ${canMove('week', 1) ? 'next week' : '—'}${RESET}`, ''];
      const budget = Math.max(1, this.dimensions().rows - 7);
      const start = Math.max(0, browser.selectedIndex - 2);
      let lastDay = '';
      for (let index = start; index < sessions.length && rows.length < budget + 4; index++) {
        const session = sessions[index]!;
        const day = resumeDayLabel(session.createdAt);
        if (day !== lastDay && rows.length + 1 < budget + 4) rows.push(`${SUBTLE}  ${day}${RESET}`);
        if (rows.length >= budget + 4) break;
        lastDay = day;
        const selected = index === browser.selectedIndex;
        const time = new Date(session.createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        const interrupted = session.journaled && !session.endedAt ? ' · interrupted' : '';
        rows.push(truncateAnsi(`${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${time}  ${session.project || 'notMyShell'} · ${session.finalCwd} · ${session.commandCount} commands${interrupted}${RESET}`, columns));
      }
      if (sessions.length === 0) rows.push(`${SUBTLE}  No matching sessions${RESET}`);
      rows.push('', `${SUBTLE}  ↑↓ move · ←→ week · Shift+←→ month · Enter restore · Esc close${RESET}`);
      return framePanel(rows, columns);
    }
    if (this.appearanceState) return framePanel(renderAppearancePanel(this.appearanceState, columns), columns);
    if (this.keyboardState) return framePanel(renderKeyboardPanel(this.keyboardState, columns), columns);
    return framePanel(this.renderedPromptPanel(columns), columns);
  }

  /**
   * Closes whatever top-level panel is currently open and, if it was opened
   * from /settings, reopens the settings root at the row it was launched
   * from instead of dropping straight to the composer. Callers clear their
   * own panel state field first, then call this.
   */
  private returnFromPanel(): void {
    if (this.panelOrigin === 'settings') {
      this.settingsPanelState = {section: 'root', view: this.panelOriginView, selectedIndex: 0, contentIndex: this.panelOriginRow,
        glyphStyle: this.promptConfiguration.glyphStyle, onboarding: false};
    }
    this.panelOrigin = undefined;
  }

  private saveGlyphChoice(style: PromptConfiguration['glyphStyle']): void {
    const next = {...this.promptConfiguration, glyphStyle: style, glyphChoiceComplete: true};
    try {
      savePromptConfiguration(next);
      this.promptConfiguration = next;
      setIconStyle(style);
      const onboarding = this.settingsPanelState?.onboarding;
      this.settingsPanelState = undefined;
      if (!onboarding) this.settingsPanelState = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: 1,
        glyphStyle: style, onboarding: false};
      if (onboarding && !next.onboardingComplete) {
        this.promptPanelState = {onboarding: true, step: 'provider', selectedIndex: PROVIDER_ORDER.indexOf(next.provider),
          draft: structuredClone(next), saved: structuredClone(next)};
      }
    } catch {
      // Keep the chooser visible so the user can retry without losing their choice.
      if (this.settingsPanelState) this.settingsPanelState.glyphStyle = style;
    }
  }

  private openSettingsPanel(view: SettingsView): void {
    this.settingsPanelState = {section: 'root', view, selectedIndex: 0, contentIndex: 0,
      glyphStyle: this.promptConfiguration.glyphStyle, onboarding: false};
  }

  /**
   * Keys for the shared Settings / Status / Config panel:
   * - ←/→ switch views, except on an inline-editable Config row where they
   *   change its value (↑ from the first row moves focus to the view bar).
   * - ↑/↓ move rows (scroll in Status); Enter/Space change a value or open a panel.
   * - `/` focuses Config search; only then does typing edit the query.
   * - Esc clears search first, then closes (or returns from the glyph preview).
   */
  private handleSettingsKey(key: Key, state: SettingsPanelState): void {
    if (key.kind === 'escape' || key.kind === 'interrupt') {
      if (state.onboarding) this.saveGlyphChoice(state.glyphStyle);
      else if (state.section === 'appearance') { state.section = 'root'; state.view = 'settings'; state.contentIndex = 1; }
      else if (state.searchQuery || state.searchFocused) { state.searchQuery = ''; state.searchFocused = false; state.contentIndex = 0; }
      else this.settingsPanelState = undefined;
      return;
    }
    if (state.section === 'appearance') {
      if (key.kind === 'up' || key.kind === 'down' || key.kind === 'left' || key.kind === 'right') state.selectedIndex = state.selectedIndex === 0 ? 1 : 0;
      else if (key.kind === 'enter') this.saveGlyphChoice(state.selectedIndex === 0 ? 'nerd' : 'safe');
      return;
    }
    const view = settingsView(state);
    const row = selectedSettingsRow(state);
    if (state.searchFocused && key.kind === 'text') {
      state.searchQuery = (state.searchQuery ?? '') + key.value;
      state.contentIndex = 0;
    } else if (state.searchFocused && key.kind === 'backspace') {
      state.searchQuery = (state.searchQuery ?? '').slice(0, -1);
      state.contentIndex = 0;
    } else if (key.kind === 'text' && key.value === '/' && view === 'config') {
      state.searchFocused = true;
      state.focus = 'rows';
      state.searchQuery ??= '';
    } else if (key.kind === 'left' || key.kind === 'right') {
      const delta = key.kind === 'left' ? -1 : 1;
      if (view === 'config' && state.focus !== 'tabs' && isInlineEditable(row)) {
        this.applySettingsConfiguration(adjustSettingsRow(row!, this.promptConfiguration, delta));
      } else switchSettingsView(state, delta);
    } else if (view === 'status') {
      if (key.kind === 'up' || key.kind === 'down') {
        const max = Math.max(0, statusLineCount(this.statusSections()) - 1);
        state.contentIndex = Math.max(0, Math.min(max, (state.contentIndex ?? 0) + (key.kind === 'up' ? -1 : 1)));
      }
    } else if (state.focus === 'tabs') {
      if (key.kind === 'down' || key.kind === 'enter') { state.focus = 'rows'; state.contentIndex = 0; }
    } else if (key.kind === 'up' || key.kind === 'down') {
      const count = settingsItemCount(state);
      const index = state.contentIndex ?? 0;
      if (key.kind === 'up' && index === 0 && !state.searchFocused) state.focus = 'tabs';
      else if (count > 0) state.contentIndex = Math.max(0, Math.min(count - 1, index + (key.kind === 'up' ? -1 : 1)));
    } else if ((key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) && row) {
      if (isInlineEditable(row)) this.applySettingsConfiguration(toggleSettingsRow(row, this.promptConfiguration));
      else if (key.kind === 'enter') {
        const destination = settingsRowDestination(row);
        if (destination) this.openSettingsDestination(destination, view, state.contentIndex ?? 0, state);
      }
    }
  }

  private openSettingsDestination(destination: SettingsDestination, view: SettingsView, rowIndex: number, state: SettingsPanelState): void {
    if (destination === 'glyph') {
      state.section = 'appearance';
      state.selectedIndex = this.promptConfiguration.glyphStyle === 'nerd' ? 0 : 1;
      return;
    }
    this.panelOrigin = 'settings';
    this.panelOriginView = view;
    this.panelOriginRow = rowIndex;
    this.settingsPanelState = undefined;
    if (destination === 'appearance') void this.startAppearance();
    else if (destination === 'prompt') void this.startPromptSettings(false);
    else if (destination === 'transcript') this.startTranscriptSettings();
    else if (destination === 'syntax') this.startSyntaxSettings();
    else void this.startKeyboard();
  }

  /**
   * Read-only facts for the Status view, from in-memory state only: no
   * subprocesses, no environment values beyond the terminal's self-reported
   * TERM_PROGRAM, nothing that could carry credentials.
   */
  private statusSections(): StatusSections {
    const config = this.promptConfiguration;
    const build = this.buildIdentity;
    const {columns, rows} = this.dimensions();
    const home = homedir();
    const tilde = (path: string) => path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
    const terminal = process.env.TERM_PROGRAM
      ? `${process.env.TERM_PROGRAM}${process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ''}`
      : undefined;
    const active = this.effectivePromptProvider;
    return [
      [
        {label: 'Version', value: build.version},
        {label: 'Build', value: `${build.commit}${build.branch ? ` (${build.branch}${build.dirty ? ', dirty' : ''})` : ''}`, tone: build.commit === 'unknown' ? 'muted' : undefined},
        {label: 'Shell', value: 'zsh (/bin/zsh)'},
        {label: 'Working directory', value: tilde(this.shellCwd)},
        ...(terminal ? [{label: 'Terminal', value: terminal}] : []),
        {label: 'Terminal size', value: `${columns}×${rows}`},
      ],
      [
        {label: 'Prompt provider', value: providerLabel(config.provider)},
        ...(active !== config.provider ? [{label: 'Active prompt', value: `${providerLabel(active)} (fallback)`, tone: 'warning' as const}] : []),
        {label: 'Composer', value: layoutLabel(config)},
        {label: 'Glyph style', value: config.glyphStyle === 'nerd' ? 'Nerd Font' : 'Safe / ASCII'},
        {label: 'Syntax', value: !config.syntax.highlighting ? 'Off' : config.syntax.colors === 'followPrompt' ? 'Follow prompt theme' : config.syntax.colors === 'theme' ? 'Choose theme' : 'Grayscale'},
        {label: 'History colors', value: config.transcript.historyColors === 'followPrompt' ? 'Follow prompt' : config.transcript.historyColors === 'theme' ? 'Theme' : 'Grayscale'},
      ],
      [
        {label: 'Session journal', value: this.journalActive ? 'active' : 'inactive', tone: this.journalActive ? 'success' : 'warning'},
        {label: 'Session retention', value: config.sessionRetention === null ? 'unlimited' : `${config.sessionRetention} sessions`},
        {label: 'Config file', value: tilde(promptConfigurationPath()), tone: 'muted'},
      ],
    ];
  }

  /** Persists an inline Settings edit and applies it live; on failure the old value stays. */
  private applySettingsConfiguration(next: PromptConfiguration | undefined): void {
    if (!next) return;
    try {
      savePromptConfiguration(next);
    } catch {
      return;
    }
    this.promptConfiguration = next;
    setIconStyle(next.glyphStyle);
    this.output.setTranscriptAppearance(next.transcript);
    if (this.settingsPanelState) this.settingsPanelState.glyphStyle = next.glyphStyle;
  }

  private startTranscriptSettings(): void {
    const saved = structuredClone(this.promptConfiguration.transcript);
    this.transcriptPanelState = {selectedIndex: 0, draft: structuredClone(saved), saved};
  }

  /** A representative history header: the live provider's identity over preview-only modules. */
  private transcriptPreviewSample(): HistoricalContextSnapshot {
    const context = themePreviewContext();
    const prompt = this.effectivePromptProvider !== 'nmsh' && this.externalPrompt
      ? this.currentPromptSnapshot()
      : nativePromptSnapshot(context, this.promptConfiguration);
    return {cwd: context.cwd, project: context.project, branch: context.branch, prompt};
  }

  private saveTranscriptSettings(): void {
    const state = this.transcriptPanelState;
    if (!state) return;
    const next = {...structuredClone(this.promptConfiguration), transcript: structuredClone(state.draft)};
    try {
      savePromptConfiguration(next);
      this.promptConfiguration = next;
      this.output.setTranscriptAppearance(next.transcript);
      this.transcriptPanelState = undefined;
      this.output.addHistoryLine(`${SUCCESS}Transcript settings saved.${RESET}`);
    } catch (error) {
      state.message = `Could not save transcript settings: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.render();
  }

  private startSyntaxSettings(): void {
    const saved = structuredClone(this.promptConfiguration.syntax);
    this.syntaxPanelState = {selectedIndex: 0, draft: structuredClone(saved), saved};
  }

  /** New input and new commands use the saved style; submitted history keeps its captured ANSI. */
  private saveSyntaxSettings(): void {
    const state = this.syntaxPanelState;
    if (!state) return;
    const next = {...structuredClone(this.promptConfiguration), syntax: structuredClone(state.draft)};
    try {
      savePromptConfiguration(next);
      this.promptConfiguration = next;
      this.syntaxPanelState = undefined;
      this.returnFromPanel();
      this.output.addHistoryLine(`${SUCCESS}Syntax settings saved.${RESET}`);
    } catch (error) {
      state.message = `Could not save syntax settings: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.render();
  }

  private renderedPromptPanel(columns: number): string[] {
    if (!this.promptPanelState) return [];
    const preview = this.promptPanelState.step.startsWith('install') ? [] : this.promptPanelPreview(columns);
    const full = renderPromptPanel(this.promptPanelState, columns, preview, this.promptThemePreviews(columns), this.dimensions().rows - 1,
      this.promptGitShowcase(columns));
    // Short terminals keep the editable rows and live preview; the theme gallery goes first.
    return full.length <= this.dimensions().rows - 3 ? full : renderPromptPanel(this.promptPanelState, columns, preview, [], this.dimensions().rows - 1);
  }

  /** Rich Git view rows: the draft's colors and geometry over synthetic states; never runs Git. */
  private promptGitShowcase(columns: number): string[] {
    const state = this.promptPanelState;
    if (!state || state.step !== 'appearance' || state.view !== 'git') return [];
    const width = Math.max(1, columns - 15);
    // Disabled Rich Git still shows what it would add, dimmed by the panel.
    const draft = {...state.draft, nmsh: {...state.draft.nmsh, gitEnabled: true}};
    return RICH_GIT_SHOWCASE.map(entry => buildRichGitShowcaseLine(draft, entry.git, width));
  }

  /** One preview row per theme: the draft's geometry over synthetic preview-only modules. */
  private promptThemePreviews(columns: number): string[] {
    const state = this.promptPanelState;
    if (!state || state.step !== 'appearance' || state.view === 'git') return [];
    const width = Math.max(1, columns - 22);
    return NATIVE_PALETTE_IDS.map(palette => buildThemePreviewLine(state.draft, palette, width));
  }

  private externalPanelStatusText(state: PromptPanelState, provider: PromptProviderId, width: number): string {
    const installed = provider === 'starship' ? state.starshipStatus?.installed : state.p10kStatus?.installed;
    if (installed) return truncateText(state.message ?? `${providerLabel(provider)} preview is unavailable.`, width);
    return truncateText(`${providerLabel(provider)} is not installed; see the options above.`, width);
  }


  private hasVisibleProviderPrompt(): boolean {
    if (this.effectivePromptProvider !== 'nmsh') return Boolean(this.externalPrompt?.text.trim());
    return hasVisibleContextModule(this.promptConfiguration, this.promptContext(), isOnCommandRelevant);
  }

  private currentPromptLine(width: number): string {
    if (this.effectivePromptProvider !== 'nmsh' && this.externalPrompt) {
      return this.externalPromptRow(this.externalPrompt, width, this.promptConfiguration.placement);
    }
    return buildContextLine(this.promptContext(), width, this.promptConfiguration);
  }

  /**
   * Blink the welcome cat occasionally. The frame lives on OutputBuffer as
   * presentation state, so transcript contents, row count, and width never
   * change. Blinks are skipped (not queued) while no welcome is present.
   */
  private scheduleWelcomeBlink(): void {
    if (this.stopped) return;
    this.welcomeBlinkTimer = setTimeout(() => {
      if (this.stopped) return;
      if (!this.output.hasWelcome || this.passthrough) {
        this.welcomeBlinkCount += 1;
        this.scheduleWelcomeBlink();
        return;
      }
      this.output.setWelcomeFrame('blink');
      this.render();
      this.welcomeBlinkTimer = setTimeout(() => {
        this.output.setWelcomeFrame('open');
        if (this.stopped) return;
        this.render();
        this.welcomeBlinkCount += 1;
        this.scheduleWelcomeBlink();
      }, WELCOME_BLINK_CLOSED_MS);
    }, welcomeBlinkDelay(this.welcomeBlinkCount));
  }

  /** External provider content follows the native placement rule: the divider fill only in header placement. */
  private externalPromptRow(prompt: StarshipPromptResult, width: number, placement: PromptConfiguration['placement']): string {
    const content = truncateAnsi(prompt.ansi, Math.max(0, width - 1));
    if (placement === 'composer') return `${content}${RESET}`;
    return `${content}${RESET}${SEPARATOR}${repeatToWidth(GLYPHS.separator, Math.max(0, width - displayWidth(content)))}${RESET}`;
  }

  private scroll(direction: -1 | 1): void {
    const {columns, rows} = this.dimensions();
    const input = this.layoutEditorInput(columns);
    const overlayRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : this.appearanceState ? 7 : (this.keyboardState ? 6 : (this.editor.hasPasteAtoms ? 0 : slashSuggestions(this.editor.text).length));
    const outputHeight = Math.max(1, calculateScreenLayout(
      rows,
      input.allRows.length,
      overlayRows,
      Boolean(this.running),
      this.historyViewport.detached,
      this.output.wrapped(columns).length > 0,
      this.promptConfiguration.placement,
      this.hasVisibleProviderPrompt(),
      this.promptConfiguration.composerLayout,
    ).outputHeight);
    const total = this.output.wrapped(columns).length;
    this.historyViewport.resolve(total, outputHeight);
    this.historyViewport.page(total, outputHeight, direction);
  }

  private scrollLines(amount: number): void {
    const {columns, rows} = this.dimensions();
    const input = this.layoutEditorInput(columns);
    const overlayRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : this.appearanceState ? 7 : (this.keyboardState ? 6 : (this.editor.hasPasteAtoms ? 0 : slashSuggestions(this.editor.text).length));
    const outputHeight = Math.max(1, calculateScreenLayout(
      rows,
      input.allRows.length,
      overlayRows,
      Boolean(this.running),
      this.historyViewport.detached,
      this.output.wrapped(columns).length > 0,
      this.promptConfiguration.placement,
      this.hasVisibleProviderPrompt(),
      this.promptConfiguration.composerLayout,
    ).outputHeight);
    const total = this.output.wrapped(columns).length;
    this.historyViewport.resolve(total, outputHeight);
    this.historyViewport.scrollLines(total, outputHeight, amount);
  }


  private formatCommandAnsi(command: string, startId: number | null, sgr = this.syntaxSgr): string[] {
    const inputChars = graphemes(command);
    const tokens = this.highlighter.tokenize(inputChars, this.semanticService.cache);
    const charColors = syntaxCharStyles(tokens, inputChars.length, sgr);

    for (const token of tokens) {
      if (token.type === 'Command' && startId !== null) {
        // Resolution re-renders with the style captured at submission, so
        // later syntax setting changes never recolor this history entry.
        void this.semanticService.classifyCommand(token.text).then(() => {
          const newFormatted = this.formatCommandAnsi(command, null, sgr);
          this.output.updateCommandHighlight(startId, newFormatted);
          this.render();
        });
      }
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
    if (this.stopped || this.passthrough || this.externalPassthrough) return;
    void this.fetchSuggestions();
    const {columns, rows} = this.dimensions();
    const isSlash = !this.editor.hasPasteAtoms && this.editor.text.startsWith('/');

    let availableSuggestions: any[] = [];
    if (!this.running) {
      if (!this.editor.hasPasteAtoms && this.editor.text.startsWith('/history ')) {
        const q = this.editor.text.substring(9).toLowerCase();
        const matches = this.historyService.getAll().filter(h => h.toLowerCase().includes(q));
        availableSuggestions = matches.slice(0, 100).map(m => ({name: m, insertion: m, description: 'History'}));
      } else if (isSlash) {
        availableSuggestions = this.editor.hasPasteAtoms ? [] : slashSuggestions(this.editor.text);
      } else {
        availableSuggestions = this.shellSuggestions;
      }
    }

    if (this.settingsPanelActive) availableSuggestions = [];
    const promptPanelRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : 0;
    const overlayRows = this.settingsPanelActive ? promptPanelRows : this.appearanceState ? 7 : (this.keyboardState ? 6 : availableSuggestions.length);
    const promptLine = this.currentPromptLine(columns);
    this.editor.ghost = this.editor.hasPasteAtoms ? undefined : this.historyService.suggest(this.editor.text);
    const fullInput = this.layoutEditorInput(columns);
    const calculatedLayout = calculateScreenLayout(
      rows,
      fullInput.allRows.length,
      overlayRows,
      Boolean(this.running),
      this.historyViewport.detached,
      this.output.wrapped(columns).length > 0,
      this.promptConfiguration.placement,
      this.hasVisibleProviderPrompt(),
      this.promptConfiguration.composerLayout,
    );
    const layout = this.settingsPanelActive ? {
      ...calculatedLayout,
      outputHeight: Math.max(0, rows - promptPanelRows),
      inputHeight: 0,
      suggestionCount: 0,
      showJump: false,
      showLiveActivity: false,
      showPrompt: false,
      showComposerTopBorder: false,
      showSeparator: false,
      showGap: false,
    } : calculatedLayout;
    const input = this.settingsPanelActive
      ? {...fullInput, rows: [], caretRow: 0, caretColumn: 0}
      : this.layoutEditorInput(columns, layout.inputHeight);
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
      if (row.isLiveActivity && row.activityStartedAt !== undefined) {
        finalAnsi = `${shimmerTextWithColors(row.plain, Date.now() - row.activityStartedAt, false,
          {red: 148, green: 155, blue: 166}, {red: 248, green: 250, blue: 252})}${RESET}`;
      }
      const applyBg = (bg: string) => {
        return `${bg}${finalAnsi.replaceAll('\u001B[0m', '\u001B[0m' + bg)}${bg}\u001B[K${RESET}`;
      };

      if (row.isFoldHint) {
        const isHovered = this.hoveredLineIndex === row.lineIndex;
        const isFocused = row.activityId
          ? this.focusedActivityId === row.activityId
          : row.commandIndex !== undefined
            ? this.focusedCommandIndex === row.commandIndex
            : this.focusedLineIndex === row.lineIndex;
        if (isHovered || isFocused) {
          const bg = isFocused ? `\u001B[48;2;60;60;80m` : `\u001B[48;2;45;45;55m`;
          if (!row.isLiveActivity) {
            finalAnsi = row.ansi.replaceAll(SECONDARY, PRIMARY).replaceAll(SUBTLE, SECONDARY);
          }
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
    const sticky = this.stickyHeader(wrapped, viewStart);
    const stickyRow = sticky && this.output.stickyHeaderRow(sticky.startId, columns);
    if (stickyRow && visible.length > 0) visible[0] = `\u001B[48;2;38;38;48m${stickyRow.replaceAll(RESET, `${RESET}\u001B[48;2;38;38;48m`)}\u001B[K${RESET}`;
    const frameRows = [...visible];
    while (frameRows.length < outputHeight) frameRows.push('');
    if (layout.showGap) frameRows.push('');

    if (layout.showJump) frameRows.push(this.jumpAffordance(columns));
    if (this.settingsPanelActive) {
      frameRows.push(...this.settingsPanelRows(columns));
    } else if (this.appearanceState) {
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
    if (layout.showComposerTopBorder) frameRows.push(`${SEPARATOR}${repeatToWidth(GLYPHS.separator, columns)}${RESET}`);
    if (layout.showPrompt) frameRows.push(promptLine);
    const SELECTION_BG = background(UI_COLORS.selection);
    const sel = this.editor.displaySelection;

    const inputChars = graphemes(this.editor.displayText);
    const pasteAtoms = this.editor.displayPasteAtoms;
    const tokens = this.highlighter.tokenize(inputChars, this.semanticService.cache);
    const charColors = syntaxCharStyles(tokens, inputChars.length, this.syntaxSgr);

    for (const token of tokens) {
      if (token.type === 'Command') {
        void this.semanticService.classifyCommand(token.text).then(() => this.render());
      }
    }

    for (const row of input.rows) {
      const prefix = row.prefix.startsWith(GLYPHS.prompt) ? `${ACCENT}${GLYPHS.prompt}${RESET}${row.prefix.slice(GLYPHS.prompt.length)}` : row.prefix;
      let textStyled = '';
      const glyphsInRow = graphemes(row.text);
      for (let i = 0; i < glyphsInRow.length; i++) {
        const globalIndex = row.charStart + i;
        const isSelected = sel && globalIndex >= sel.start && globalIndex < sel.end;
        const isPasteAtom = pasteAtoms.some(atom => globalIndex >= atom.start && globalIndex < atom.end);
        const color = charColors[globalIndex] ?? PRIMARY;
        if (isSelected) {
          textStyled += `${SELECTION_BG}${color}${glyphsInRow[i]}${RESET}`;
        } else if (isPasteAtom) {
          textStyled += `${PASTE_ATOM_BACKGROUND}${SECONDARY}${glyphsInRow[i]}${RESET}`;
        } else {
          textStyled += `${color}${glyphsInRow[i]}${RESET}`;
        }
      }
      let suffix = '';
      if (this.editor.ghost && !this.editor.hasPasteAtoms && this.editor.cursorIndex === graphemes(this.editor.text).length && row === input.rows[input.rows.length - 1]) {
        suffix = `${SECONDARY}${this.editor.ghost.substring(this.editor.text.length)}${RESET}`;
      }
      frameRows.push(truncateAnsi(`${prefix}${textStyled}${suffix}`, columns));
    }
    if (layout.showSeparator) frameRows.push(`${SEPARATOR}${repeatToWidth(GLYPHS.separator, columns)}${RESET}`);

    this.renderer.render({
      rows: frameRows.slice(0, rows),
      cursorRow: Math.min(
        rows,
        outputHeight
          + Number(layout.showGap)
          + Number(layout.showJump)
          + (this.appearanceState ? 7 : (this.keyboardState ? 6 : suggestionView.items.length))
          + (layout.showLiveActivity ? 2 : 0)
          + Number(layout.showComposerTopBorder)
          + Number(layout.showPrompt)
          + input.caretRow
          + 1,
      ),
      cursorColumn: Math.max(1, Math.min(columns, input.caretColumn + 1)),
      cursorVisible: !this.settingsPanelActive,
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

  private inputFirstLinePrefix(columns: number): string | undefined {
    if (this.promptConfiguration.composerLayout !== 'oneLine') return undefined;
    if (this.effectivePromptProvider !== 'nmsh' && this.externalPrompt) {
      const maxWidth = Math.max(0, columns - 1);
      return `${truncateAnsi(this.externalPrompt.ansi, maxWidth)}${RESET} `;
    }
    return buildInlineContextPrefix(this.promptContext(), columns, this.promptConfiguration);
  }

  private layoutEditorInput(columns: number, maxVisibleRows = Number.POSITIVE_INFINITY) {
    return layoutInput(
      this.editor.displayText,
      this.editor.displayCursorIndex,
      columns,
      maxVisibleRows,
      this.inputFirstLinePrefix(columns),
    );
  }

  private dimensions(): {columns: number; rows: number} {
    return {
      columns: Math.max(1, process.stdout.columns || 80),
      rows: Math.max(1, process.stdout.rows || 24),
    };
  }

  get ordinaryZshHandoffCwd(): string | undefined {
    return this.shellHandoffCwd;
  }

  get isOrdinaryZshHandoffRequested(): boolean {
    return this.shellHandoffRequested;
  }

  private leaveForOrdinaryZsh(): void {
    const decision: ShellHandoffDecision = chooseShellHandoff(Boolean(this.running), this.shellCwd, this.initialCwd);
    if (decision.kind === 'busy') {
      this.output.addFrontendInteraction('/zsh', 'Wait for the foreground command to finish or interrupt it, then run /zsh.', INFO);
      this.render();
      return;
    }

    this.shellHandoffCwd = decision.cwd;
    this.shellHandoffRequested = true;
    this.session.kill();
    this.stop(0);
  }

  private stop(exitCode: number): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.activityTimer) clearInterval(this.activityTimer);
    this.promptPanelState?.task?.dispose();
    if (this.welcomeBlinkTimer) clearTimeout(this.welcomeBlinkTimer);
    this.welcomeBlinkTimer = undefined;
    process.stdin.off('data', this.onInput);
    process.stdout.off('resize', this.onResize);
    process.off('SIGTERM', this.onTerminate);
    process.off('SIGHUP', this.onTerminate);
    if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
    process.stdin.pause();
    this.renderer.leave();
    this.semanticService.kill();
    this.finish(exitCode);
  }
}
