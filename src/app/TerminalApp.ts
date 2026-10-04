import {presentationClock} from '../motion/PresentationClock.js';
import {EffectState, applyEffect, effectRegion} from '../motion/effects.js';
import {dividerAnimated, MIN_CUSTOM_STOPS, TREATMENT_MOTION_LABELS, treatmentFor, treatmentText, paintDivider, PRESET_STOPS, setActiveThemeStops, TREATMENT_PRESETS, TREATMENT_PRESET_LABELS, treatmentAnimated, treatmentSwatch} from '../chroma/treatment.js';
import {colorLevel} from '../presentation/capabilities.js';
import type {TerminalFrame} from '../terminal/TerminalRenderer.js';
import {detectTerminalHost} from '../host/terminalHost.js';
import {probeHost} from '../host/probe.js';
import {SessionPresetStore, PresetStartup, presetNeedsAcknowledgement, type SessionPreset} from '../session/SessionPresets.js';
import {createPresetPanel, presetPanelKey, renderPresetPanel, type PresetPanel} from '../session/PresetPanel.js';
import {MiseProjectService, detectMiseProject} from '../tools/MiseProject.js';
import {misePanelKey, renderMisePanel, type MisePanel} from '../tools/MisePanel.js';
import {homedir} from 'node:os';
import {createNotificationService, formatCommandNotification, shouldNotify, type TerminalFocus} from '../notifications/commandNotifications.js';
import {blockAffordance, blockCopyPayload, blockPaletteItems, type BlockActionId} from '../ui/BlockActions.js';
import {paletteItems} from '../ui/CommandPalette.js';
import {createConfigurationPanel, configurationKey, renderConfigurationPanel, type ConfigurationPanel} from '../tools/ConfigurationPanel.js';
import {openSupportedConfiguration} from '../tools/SupportedConfiguration.js';
import {confirmToolInstall, createToolsPanel, refreshTools, renderTools, toolsKey, type ToolsPanel} from '../tools/ToolsPanel.js';
import {describeCommandSource, describeSlashCommand, inspectCommand, renderInspector} from '../shell/CommandInspector.js';
import {CHROMA_PREVIEW_NOTE, createSetup, NATIVE_ONLY_NOTE, renderSetup, SETUP_MIN_SIZE, SETUP_SECTIONS, setupIsIdempotent, setupKey, type SetupState} from '../setup/SetupCat.js';
import {glyphDiagnosticRows} from '../setup/glyphDiagnostic.js';
import {fits, renderTooSmall, type MinimumSize} from '../ui/Modal.js';
import {CellGrid} from '../idle/CellGrid.js';
import {IDLE_FRAME_MS, type IdleMode} from '../idle/scenes.js';
import {createScreensaverPanel, effectiveMode, idleFrameRows, idleMotion, idlePaletteFor, previewSize, renderScreensaverPanel, sceneTime,
  SCREENSAVER_MIN_SIZE, screensaverKey, type ScreensaverPanelState} from '../idle/IdleVisuals.js';
import {createThemeStudio, renderThemeStudio, STUDIO_MIN_SIZE, studioKey, writeThemeExport, type ThemeStudioState} from '../appearance/ThemeStudio.js';
import {createInstallPrompt, ignoreInstallSuggestion, installCandidate, installPromptKey, renderInstallPrompt, shouldOfferInstall,
  type InstallPromptState} from '../tools/InstallSuggestion.js';
import {toolInstall, TOOLS} from '../tools/catalog.js';
import {loadToolUpdateState, runToolUpdateCheck, toolUpdateCheckDue, type ToolUpdateState} from '../tools/ToolUpdates.js';
import type {CommandSource} from '../shell/SemanticService.js';
import {GLYPHS, setIconStyle, getCurrentGlyphMode, setPromptSymbol} from '../ui/glyphs.js';
import {applyUiTheme, uiColorsFor} from '../appearance/uiTheme.js';
import {chromeColorsFrom, resolveChrome} from '../appearance/uiChrome.js';
import {CHROME_EDITOR_MIN_SIZE, chromeEditorKey, createChromeEditor, renderChromeEditor, type ChromeEditorState} from '../appearance/ChromeEditor.js';
import {promptSymbolGlyph} from '../prompt/glyphChoices.js';
import {framePanel, renderTabStrip} from '../ui/PanelShell.js';
import {providerExplanation} from '../setup/providerExplanations.js';
import {liveActivityPaint} from '../status/liveActivityColors.js';
import {renderControls} from '../ui/controls.js';
import {gradientEditorControls, gradientEditorKey, renderGradientEditorRows, type GradientEditorState} from '../ui/GradientEditor.js';
import {
  adjustSettingsRow, isInlineEditable, resetSettingsRow, settingsRowChanged, renderSettingsPanel, selectedSettingsRow, settingsItemCount, settingsRowDestination,
  settingsView, statusLineCount, visibleSettingsRows, switchSettingsView, toggleSettingsRow, type SettingsDestination, type SettingsPanelState,
  type SettingsView, type StatusSections,
  SETTINGS_ENTRIES,
  SETTINGS_ROWS,
} from '../ui/SettingsPanel.js';
import {OUTPUT_FOLDING_MODES} from '../output/FoldPolicy.js';
import {appendFileSync, existsSync, readFileSync, realpathSync, rmSync, statSync} from 'node:fs';
import {shouldProbeGraphics} from '../host/capabilities.js';
import {basename, delimiter, join, resolve as resolvePath} from 'node:path';
import {spawn} from 'node:child_process';
import {completionMenuRows, renderCompletion, renderCompletionMore, COMPLETION_ACTIONS} from '../shell/CompletionMenu.js';
import {CommandDescriptions, identityDescription} from '../shell/CommandDescriptions.js';
import {localKnowledge} from '../shell/CommandKnowledge.js';
import {ComposerHistory, recallSource, SESSION_SUBMISSION_LIMIT, type SessionSubmission} from '../input/ComposerHistory.js';
import {resolveAction} from '../ui/actions.js';
import {CompletionService, defaultCompletionSources, type CompletionCandidate} from '../shell/CompletionService.js';
import {classifyShellFailure, parseShellKnowledge} from '../shell/ShellKnowledge.js';
import {HistoryService} from '../shell/HistoryService.js';
import {SuggestionController} from '../suggestions/SuggestionController.js';
import {createPalette, handlePaletteKey, renderPalette, type PaletteItem, type PaletteState} from '../ui/CommandPalette.js';
import {NativeSuggestions} from '../suggestions/NativeSuggestions.js';
import {DejaSuggestions} from '../suggestions/DejaSuggestions.js';
import {CommandCorrectionService, CORRECTION_ACTIONS, renderCorrection, type CommandCorrection} from '../shell/CommandCorrection.js';
import {DirectoryService, directoryCommand, NAVIGATION_PROVIDERS, type DirectoryCandidate} from '../shell/DirectoryService.js';
import {openPicker, PICKER_PROVIDERS, type PickerHandoff} from '../pickers/Picker.js';
import {HISTORY_PROVIDERS} from '../shell/historyProviders.js';
import type {HistoryEntry} from '../shell/HistoryIndex.js';
import {isPrivateCommand, ignorePatternFromEnv, SUGGESTION_PROVIDERS} from '../suggestions/types.js';
import {CommandEditor} from '../input/CommandEditor.js';
import {OutputBuffer, renderHistoricalContext, serializeCopyPayload, type CompletedCommand, type HistoricalContextSnapshot} from '../output/OutputBuffer.js';
import {createWelcomeSnapshot, renderWelcome, vespyrSprite, WELCOME_BLINK_CLOSED_MS, welcomeBlinkDelay} from '../output/Welcome.js';
import {captureWelcome, WELCOME_PROVIDERS, welcomeProvider} from '../output/WelcomeProviders.js';
import {clearProviderDetection, detectProvider, installUnavailableReason, providerInstall, resolveCommand, resolveProvider, type ProviderStatus} from '../providers/providers.js';
import {createProviderPanel, handleProviderPanelKey, providerPanelEnterAction, providerPanelSelection, renderProviderPanel,
  type ProviderPanelState} from '../providers/ProviderPanel.js';
import {TapActivityObserver} from '../output/TapActivityObserver.js';
import {HistoryViewport, stickyHeaderFor, type StickyHeader, type WrappedRow} from '../output/viewport.js';
import {NATIVE_PROMPT_THEMES, setThemeContext, themeContext, themeChromaStops, buildContextLine, buildInlineContextPrefix, buildRightContext, isOnCommandRelevant, buildRichGitShowcaseLine, buildThemePreviewLine, RICH_GIT_SHOWCASE, moduleShowcaseContext, nativePromptSnapshot, themePreviewContext} from '../prompt/prompt.js';
import {foldingPreview, handleTranscriptPanelKey, renderTranscriptPanel, type TranscriptPanelState} from '../output/TranscriptPanel.js';
import {tabCompletionAction} from '../input/tabBehavior.js';
import {formatBuildIdentity, readBuildIdentity} from '../buildInfo.js';
import {hasVisibleContextModule, loadPromptConfiguration, NATIVE_PALETTE_IDS, savePromptConfiguration, type PromptConfiguration, type PromptProviderId} from '../prompt/configuration.js';
import {detectStarship, renderStarshipPrompt, type StarshipPromptResult, type StarshipStatus} from '../prompt/starship.js';
import {STARSHIP_MODULES, StarshipConfigAdapter} from '../prompt/StarshipConfigAdapter.js';
import {detectPowerlevel10k, renderPowerlevel10kPrompt, type Powerlevel10kStatus} from '../prompt/powerlevel10k.js';
import {configuratorFileChanged, launchPowerlevel10kConfigurator, preparePowerlevel10kConfigurator} from '../prompt/Powerlevel10kConfigurator.js';
import {galleryPalettes, promptPanelOwnsKey, appearanceModulesRow, closeGradientEditor, onGradientRow, openGradientEditor, applyLayoutChoice, onModulesRow, layoutLabel, describePromptConfiguration, PROVIDER_ORDER, providerLabel, handlePromptPanelKey, layoutChoiceIndex, renderPromptPanel, type PromptPanelState} from '../prompt/PromptPanel.js';
import type {PromptSnapshot} from '../prompt/snapshot.js';
import {CommandContextCache, commandWords, type CommandContextId} from '../prompt/commandContext.js';
import {applyUpdate, backgroundUpdateCheck, compareVersions, detectInstall, fetchLatestRelease, installRoot, planUpdate, systemRunner, type ReleaseInfo} from '../update/update.js';
import {resolvePathAbbreviations} from '../prompt/pathDisplay.js';
import {resolvePromptContext, type PromptContext} from '../shell/ShellContext.js';
import type {AttachedSession, SessionClient, SessionConnection, StreamStamp} from '../session/SessionClient.js';
import {InProcessSessionClient} from '../session/InProcessSessionClient.js';
import {cursorStyleSequence, TerminalRenderer} from '../terminal/TerminalRenderer.js';
import {KeyDecoder, type Key} from '../terminal/keys.js';
import {promptConfigurationPath} from '../configuration/paths.js';
import {displayWidth, repeatToWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {parseSlashCommand, slashCommands, slashSuggestions, suggestionWindow} from '../commands/slashCommands.js';
import {ClipboardUnavailableError, copyFeedback, copyStats, writeClipboard} from '../clipboard/clipboard.js';
import {beginSelection, extendSelection, isRowSelected, selectedText, type TranscriptSelection} from '../output/TranscriptSelection.js';
import {shouldPassthrough} from '../passthrough/PassthroughPolicy.js';
import {layoutInput, graphemes} from '../input/inputLayout.js';
import {editText} from '../ui/formControls.js';
import {helpMarkdown} from '../help/helpContent.js';
import {renderMarkdownText} from '../help/markdown.js';
import {sweepAnimates, sweepAnsiRow, sweepCells, sweepOnce} from '../motion/lightSweep.js';
import {sweepStill, sweepStyleFor} from '../motion/sweepStyle.js';
import {mixRgb} from '../chroma/chroma.js';
import type {Rgb} from '../chroma/escape.js';
import {isDeterministicPresentation, isReducedMotion, presentationAnimationElapsed, presentationCompletionTime, presentationNow} from '../presentation/environment.js';
import {TaskProgress} from '../status/TaskProgress.js';
import {LocalStats, renderStatusStrip, STRIP_REFRESH_MS, stripVisible, type StatsSource, type SystemStats} from '../status/StatusStrip.js';
import {completedActivity, liveActivityParts} from '../status/activity.js';
import {extractFacts} from '../status/adapters.js';
import {foreground, background, UI_COLORS, lazyForeground} from '../ui/palette.js';
import {AgentActivityStore} from '../agents/AgentActivityStore.js';
import {isShellId, knowledgeJobCount, type ShellId} from '../shell/adapters/ShellAdapter.js';
import {findSourceReferences, parseOpenArgument, resolveHostActions, resolveLocation, runHostAction, type HostAction, type HostActionAdapter} from '../host/HostActions.js';
import {openPanelKey, renderOpenPanel, type OpenPanelState} from '../host/OpenPanel.js';
import {fishQuote, posixQuote} from '../shell/adapters/ShellAdapter.js';
import {compileQuery, createFind, findCount, parseSearchCommand, refreshFind, revealStart, stepFind, type FindState} from '../output/TranscriptSearch.js';
import {searchChromeRows} from '../output/SearchChrome.js';

/** A row's plain text with spans marked: the active result strongly, others underlined. */
function markSpans(plain: string, spans: ReadonlyArray<{start: number; end: number}>, strong: string, base: string, weak: string): string {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let output = base;
  let index = 0;
  for (const span of ordered) {
    if (span.start < index) continue;
    output += `${plain.slice(index, span.start)}\u001b[0m${weak || strong}${plain.slice(span.start, span.end)}\u001b[0m${base}`;
    index = span.end;
  }
  return `${output}${plain.slice(index)}\u001b[0m`;
}
import {shellAdapter, shellAvailability, shellInstall} from '../shell/adapters/registry.js';
import {commandReference} from '../shell/CommandReference.js';
import {gitNextSteps, gitRunAllowed, gitSummary, renderCommand} from '../ask/gitAssist.js';
import {readGitFacts} from '../ask/git.js';
import {configTargets, systemConfigEnvironment} from '../ask/configTargets.js';
import {systemFileAssistEnvironment, validateAfterWrite} from '../ask/configAssist.js';
import {formatterAllowed} from '../ask/repair.js';
import {packageIntent, packageQueries, type BrewFacts, type PackageIntent} from '../ask/packages.js';
import {brewMutationAllowed, homebrewAdapter} from '../packages/homebrew.js';
import {toolOwner} from '../tools/ToolUpdates.js';
import {tldrExamples} from '../shell/tldr.js';
import {normalizeRequest} from '../ask/resolver.js';
import {applyPlan, sha256} from '../ask/fileEdit.js';
import type {CommandEnvironment} from '../ask/commands.js';
import type {AskOption} from '../ask/types.js';
import {askStarters} from '../ask/guide.js';
import {applyAskCompletion, pushTurn, ASK_GREETING, askKey, askTranscriptText, createAskState, receiveOutcome, renderAsk, type AskEvent, type AskState} from '../ask/AskPanel.js';
import {readArgv, resolveRequest} from '../ask/resolver.js';
import {completePath, listProjectFiles} from '../ask/files.js';
import {recipeRunAllowed} from '../ask/recipes.js';
import {openableUrl, projectRunAllowed, readProjectFacts} from '../ask/project.js';
import {ManagedTasks} from '../tasks/ManagedTasks.js';
import {CursorPresenter} from '../cursor/CursorPresenter.js';
import {chooseBackend, hostCursorFacts, nativeBackendFor, type BackendChoice, type HostCursorFacts} from '../cursor/backends.js';
import {includeLine, nativeCursorIntegrated, nativeHostLabel, setupPlan, writeManagedFiles} from '../cursor/native.js';
import {createCursorPanel, cursorPanelKey, renderCursorPanel, type CursorPanelState} from '../cursor/CursorPanel.js';
import {liveLine} from '../status/liveLine.js';
import {browseOutcome} from '../ask/fileAssist.js';
import {gitWorktrees} from '../ask/git.js';
import type {AskAction, AskContext, AskOutcome} from '../ask/types.js';
import {askProviderFacts, PROVIDER_FAMILIES, selectProvider} from '../providers/families.js';
import {LocalUnderstanding, understandingStatusRows, understandingWelcomeText} from '../understanding/LocalUnderstanding.js';
import {stateLabel, createUnderstandingPanel, renderUnderstandingPanel, understandingKey, type UnderstandingFacts, type UnderstandingPanelState} from '../understanding/UnderstandingPanel.js';
import {downloadPinned, loadRecommendedModel} from '../understanding/recommended.js';
import {modelChoice, nmshModelDirectory} from '../understanding/discovery.js';
import {foldExcerpt} from '../understanding/tasks.js';
import {applyFoldHint, hintEligible} from '../output/FoldPolicy.js';
import {CAPABILITIES, modelInventory, resolveModelIntent, resolveWithInterpretation} from '../ask/resolver.js';
import {createProvidersOverview, providersOverviewKey, renderProvidersOverview, type ProvidersOverviewState} from '../providers/ProvidersOverview.js';
import {InstallProvenance} from '../tools/InstallProvenance.js';
import {PathClassifier, type CommandClassifier} from '../shell/PathClassifier.js';
import {createShellPanel, renderShellPanel, shellPanelKey, type ShellPanelState} from '../shell/ShellPanel.js';
import {detectPlatform, type PlatformInfo} from '../host/platform.js';
import {createImageOverlay, fitCells, pngSize, selectImageProtocol, type ImageOverlay, type ImageProtocol, type ImageSize} from '../presentation/ImageSurface.js';
import {detectShellEnvironment, shellEnvironmentRows, type ShellEnvironmentReport} from '../shell/ShellEnvironment.js';
import {agentColor, agentCompletionText, renderAgentStats} from '../agents/AgentStatsView.js';
import {detectAgentCommand} from '../agents/agents.js';
import {describeNotice, noticeKey, selectNotices, sessionLabel, type NoticeView, type SessionNotice} from '../session/SessionNotices.js';
import {cursorScreenRow, planScreen, regionAt, withNoticeRows, withStatusRow, screenRowFromTerminal, terminalRowFromScreen, type Region, type ScreenPlan} from './screenPlan.js';
import {AppearanceState, handleAppearanceKey, renderAppearancePanel, BLUR_MODES} from '../appearance/AppearancePanel.js';
import {KeyboardState, handleKeyboardKey, renderKeyboardPanel} from '../keyboard/KeyboardPanel.js';
import {Highlighter} from '../input/Highlighter.js';
import {handleSyntaxPanelKey, renderSyntaxPanel, renderSyntaxPreviewLine, type SyntaxPanelState} from '../input/SyntaxPanel.js';
import {AlternateScreenTracker} from '../session/TerminalModes.js';
import {renderStartupPanel} from '../ui/StartupPanel.js';
import {createLayoutPanel, handleLayoutPanelKey, renderLayoutPanel, type LayoutPanelState} from '../ui/LayoutPanel.js';
import {syntaxCharStyles, syntaxSgrForConfiguration, type SyntaxSgr} from '../input/syntaxTheme.js';
import {SemanticService} from '../shell/SemanticService.js';
import {chooseShellHandoff, type ShellHandoffDecision} from '../shell/ShellHandoff.js';
import {TranscriptStore, type LiveLink, type TranscriptSession} from '../sessions/TranscriptStore.js';
import {formatBytes} from '../session/sessionList.js';
import type {PresentationMode} from '../output/PresentationMode.js';
import type {SessionInfo} from '../session/SessionProtocol.js';
import {SessionJournal} from '../sessions/SessionJournal.js';
import {createSessionsView} from '../sessions/ResumeBrowser.js';
import {liveSessionRows} from '../sessions/LiveSessionView.js';
import {createResumeBrowser, describeArchivedRow, describeLiveRow, LIVE_ROW_LABELS, liveRowAgent, liveRowState, navigateResume, resumeDayLabel, resumeRowCount, resumeSelection,
  visibleLiveSessions, visibleResumeSessions, type ResumeBrowserState} from '../sessions/ResumeBrowser.js';
import {dismissSessionNotice, listLiveSessions, listSessionNotices} from '../session/connectSession.js';
import {OLDER_SERVICE_SWITCH} from '../session/SocketSessionClient.js';
import {killAndArchive} from '../session/liveSessions.js';
import {recoverEndedSessions} from '../session/recovery.js';
import {AgentSessions} from '../agents/sessions/manager.js';
import type {AgentSession} from '../agents/sessions/model.js';
import {agentBlocks, agentPanelRows, renderAgentPanel, renderAgentView, renderShelf, shelfOrder, type AgentPanelState, type AgentViewState} from '../agents/sessions/AgentViews.js';
import {harness} from '../agents/harnesses.js';
import {defaultRuntimeDir} from '../session/runtimeDir.js';

/** Editor text that marks interactive history search. */
const HISTORY_SEARCH = '/history ';
const DIRECTORY_SEARCH = '/dirs ';
const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const SEPARATOR = lazyForeground(UI_COLORS.separator);
const ACCENT = lazyForeground(UI_COLORS.accent);
/** NMSh ran this install with the user's confirmation; record it so an uninstall can be offered honestly. */
function recordInstall(toolId: string, install: {label: string; command: string; args: readonly string[]}): void {
  try { new InstallProvenance().record({id: toolId, package: install.args.at(-1) ?? toolId}, {...install, args: [...install.args]}); } catch { /* best effort */ }
}
/** Session notices change on human timescales; a slow poll keeps the service quiet. */
const NOTICE_REFRESH_MS = 4000;
/** Agent process discovery cadence while NMSh owns the screen. */
const AGENT_DISCOVERY_MS = 15_000;
/** The shelf hides after this long when nothing needs attention. */
const SHELF_IDLE_MS = 6000;
const SUCCESS = lazyForeground(UI_COLORS.success);
const ERROR = lazyForeground(UI_COLORS.failure);
const clipboardFailure = (error: unknown): string => error instanceof ClipboardUnavailableError ? error.message : 'Clipboard copy failed';
/** Keys that edit or submit the composer; in Flow they bring a scrolled-back view back to it. */
const FLOW_EDIT_KEYS: ReadonlySet<Key['kind']> = new Set(['text', 'paste', 'backspace', 'delete', 'deleteWord',
  'deleteLineBefore', 'deleteLineAfter', 'enter', 'newline', 'complete', 'historySearch']);
const STOPPED = foreground({red: 198, green: 156, blue: 109});
const INFO = SECONDARY;
const RESET = '\u001B[0m';
const PASTE_ATOM_BACKGROUND = background({red: 63, green: 65, blue: 82});
const INVERSE = '\u001B[7m';
/** The Settings row the glyph preview returns to. */
const GLYPH_ENTRY_INDEX = (): number => Math.max(0, SETTINGS_ENTRIES.findIndex(entry => entry.id === 'glyphPreview'));
export class TerminalApp {
  private readonly buildIdentity = readBuildIdentity();
  private updateInProgress = false;
  /** The release version the last `/update` offered; `/update apply` installs only that. */
  private offeredUpdate?: string;
  private readonly initialCwd = process.cwd();
  private shellCwd = this.initialCwd;
  private terminalFocus: TerminalFocus = 'unknown';
  private readonly notificationService = createNotificationService();
  private readonly host = detectTerminalHost();
  private readonly renderer = new TerminalRenderer(undefined, this.host.capabilities);
  private readonly editor = new CommandEditor();
  private readonly highlighter = new Highlighter();
  private semanticService: CommandClassifier;
  private readonly keyDecoder = new KeyDecoder();
  private readonly output = new OutputBuffer(() => {
    this.historyViewport.latest();
    if (this.running) this.running.cleared = true;
  });
  private readonly tapActivityObserver = new TapActivityObserver();
  private readonly historyViewport = new HistoryViewport();
  private readonly session: SessionClient;
  private readonly historyService = new HistoryService();
  /** Shell-style Up/Down recall in the ordinary composer. Frontend-local; never persisted. */
  private readonly composerHistory = new ComposerHistory();
  /**
   * What was submitted in this NMSh session, for recall only. NMSh slash
   * commands live here and nowhere else: never zsh, Atuin or other history.
   */
  private readonly sessionSubmissions: SessionSubmission[] = [];
  /** Unsubscribes the Chroma panel preview from the presentation clock. */
  private panelAnimation?: () => void;
  /** A milestone effect waiting for the owning panel to close. */
  private pendingMilestone = false;
  private readonly commandDescriptions = new CommandDescriptions();
  private commandUsageVersion = -1;
  private readonly nativeSuggestions = new NativeSuggestions(ignorePatternFromEnv());
  private readonly suggestions = new SuggestionController(() => this.render(),
    reason => this.output.addHistoryLine(`${SUBTLE}Suggestion provider unavailable (${reason}); using NMSh Native.${RESET}`));
  /** Commands submitted this session, most recent first: the sequence context for suggestions. */
  private readonly submittedCommands: string[] = [];
  private readonly transcriptStore = new TranscriptStore();
  private completionService = new CompletionService();
  private inspectorVisible = false;
  private shellSuggestions: CompletionCandidate[] = [];
  private lastSuggestionInput = "";
  private completionGeneration = 0;
  private readonly correctionService = new CommandCorrectionService();
  private correction?: CommandCorrection;
  private correctionAbort?: AbortController;
  private readonly directoryService = new DirectoryService();
  private directoryQuery?: string;
  private directoryQueryAbort?: AbortController;
  private directoryResults: DirectoryCandidate[] = [];
  private pickerOpening = false;
  private pickerAbort?: AbortController;
  private historyQuery?: string;
  private historyQueryAbort?: AbortController;
  private historyResults: HistoryEntry[] = [];
  private context: PromptContext = {cwd: process.cwd(), project: '…', exitStatus: 0};
  private readonly commandContexts = new CommandContextCache(() => this.render());
  private configuration: PromptConfiguration = loadPromptConfiguration();
  /** Decorative surfaces without prompt context follow the active Native theme for Current Theme Chroma. */
  private themeStopsKey = '';
  private get promptConfiguration(): PromptConfiguration {
    const config = this.configuration;
    const key = `${config.nmsh.palette}:${config.nmsh.vibrance}:${config.nmsh.accent}:${config.promptSymbol}:${config.promptSymbolCustom ?? ''}:${
      config.nmsh.palette === 'custom' ? JSON.stringify(config.customTheme ?? null) : ''}:${JSON.stringify(config.uiChrome)}`;
    if (key !== this.themeStopsKey) {
      this.themeStopsKey = key;
      // Theme context first: Current Theme stops and the chrome both read it.
      setThemeContext(config.nmsh.accent, config.customTheme);
      applyUiTheme(uiColorsFor(resolveChrome(config.uiChrome, config.nmsh.palette, config.nmsh.accent, config.customTheme)));
      setActiveThemeStops(themeChromaStops(config.nmsh.palette, config.nmsh.vibrance));
      setPromptSymbol(promptSymbolGlyph(config.promptSymbol, config.promptSymbolCustom, true),
        promptSymbolGlyph(config.promptSymbol, config.promptSymbolCustom, false));
    }
    return config;
  }
  private set promptConfiguration(next: PromptConfiguration) {
    const turnedOff = next.localUnderstanding.mode === 'off' && this.configuration.localUnderstanding.mode !== 'off';
    this.configuration = next;
    // Off: no model use from this window, and the shared service is told to unload.
    if (turnedOff) this.understanding?.modeChanged();
  }
  /** Optional local understanding; creates nothing until a feature is eligible to use it. */
  private readonly understanding = new LocalUnderstanding(() => this.configuration.localUnderstanding);
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
  /** The shared provider gallery for families without a bespoke panel (Welcome, Suggestions). */
  private providerPanelState?: ProviderPanelState;
  private toolConfiguration?: ConfigurationPanel;
  private presetPanel?: PresetPanel;
  private readonly presetStore = new SessionPresetStore();
  private presetStartup?: PresetStartup;
  private presetShellReady = false;
  private presetFrontendReady = false;
  switchPreset?: SessionPreset;
  private toolsPanel?: ToolsPanel;
  /** Idle visuals: one inactivity timer while armed, one frame subscription while showing; neither exists otherwise. */
  private idleTimer?: NodeJS.Timeout;
  private idle?: {mode: IdleMode; startedAt: number; frame: number; interval: number; preview: boolean; paused: boolean; still: boolean};
  private idleSubscription?: () => void;
  private readonly idleGrid = new CellGrid();
  private lastActivity = Date.now();
  private idleArmedFor = -1;
  private screensaverPanel?: ScreensaverPanelState;
  private screensaverAnimation?: () => void;
  private readonly screensaverGrid = new CellGrid();
  /** Custom UI chrome colors draft. */
  private chromeEditor?: ChromeEditorState;
  /** Custom colors for idle visuals or Live activity, in the shared gradient stop editor. */
  private stopsEditor?: {target: 'idle' | 'activity'; gradient: GradientEditorState};
  /** Theme Studio: a custom theme draft; nothing persists until Save. */
  private themeStudio?: ThemeStudioState;
  /** Setup Cat: one draft over the saved configuration; nothing persists until Apply. */
  private setupState?: SetupState;
  /** A missing curated command's install offer; the submitted text is kept until the user decides. */
  private installPrompt?: InstallPromptState;
  /** The last optional tool update check (bookkeeping file, read once). */
  private toolUpdates: ToolUpdateState = loadToolUpdateState();
  private toolUpdateCheckRunning = false;
  /** What command words resolve to in the configured zsh, filled off the keypress path for the inspector. */
  private readonly commandSources = new Map<string, CommandSource | null>();
  /** Status strip data: sampled from local OS counters on its own modest timer, only while enabled. */
  private statsSource: StatsSource = new LocalStats();
  private stripStats: SystemStats = {};
  private stripTimer?: () => void;
  /** Cross-session notices from the session service; frontend chrome only. */
  private noticeView: NoticeView = {notices: [], hidden: 0};
  private noticeLabels = new Map<string, string>();
  private noticeTimer?: () => void;
  private noticePolling = false;
  /** Notices this window cleared while an older service could not clear them for everyone. */
  private readonly dismissedNotices = new Set<string>();
  private readonly agentActivity = new AgentActivityStore();
  /** The shell backend under this session (zsh, Fish or Bash). */
  private shellId: ShellId = 'zsh';
  private shellPanel?: ShellPanelState;
  private shellSwitching = false;
  /** The slash text whose suggestion menu Down entered; Up from its first row leaves it. */
  private slashMenuFor?: string;

  private leaveSlashMenu(): true {
    this.slashMenuFor = undefined;
    this.selectedSuggestion = 0;
    return true;
  }
  /** The transcript find bar, while open. */
  private findState?: FindState;
  /** Facts about the machine and shell setup; read once, never per frame. */
  private get platformInfo(): PlatformInfo { return this.cachedPlatform ??= detectPlatform(); }
  private cachedPlatform?: PlatformInfo;
  private get shellEnvironment(): ShellEnvironmentReport { return this.cachedEnvironment ??= detectShellEnvironment(); }
  private cachedEnvironment?: ShellEnvironmentReport;
  private stripSampling = false;
  /** Frontend PATH and recipe lookups for install offers; replaceable in tests. */
  private installProbe = {onPath: (name: string) => resolveCommand(name) !== undefined, recipe: toolInstall};
  private misePanel?: MisePanel;
  private readonly miseService = new MiseProjectService();
  private toolConfigurationLoading = false;
  private toolConfigurationGeneration = 0;
  private paletteState?: PaletteState;
  /** Palette entry ids used this session, most recent first. */
  private paletteRecent: string[] = [];
  /** Captured previews per external welcome provider, fetched once per panel. */
  private welcomePreviews = new Map<string, string[]>();
  /** Bumped by every new or restored presentation so a late capture never lands in the wrong one. */
  private welcomeGeneration = 0;
  private syntaxPanelState?: SyntaxPanelState;
  private layoutPanelState?: LayoutPanelState;
  /** Terminal modes the running command has set, for handing the terminal to it mid-command. */
  private readonly commandModes = new AlternateScreenTracker();
  private settingsPanelState?: SettingsPanelState;
  private running?: {command: string; startedAt: number; interrupted: boolean; cleared: boolean; startId: number; cwd: string; historyAllowed?: number; awaitingExec?: boolean};
  private hoveredLineIndex?: number;
  /** NMSh-owned transcript selection (plain drag); presentation only. */
  private selection?: TranscriptSelection;
  private focusedLineIndex?: number;
  private focusedActivityId?: string;
  private focusedCommandIndex?: number;
  private passthrough = false;
  private externalPassthrough = false;
  private lastOutputTime = 0;
  private selectedSuggestion = 0;
  private presentationStarted = false;
  private presentationSubscription?: () => void;
  private readonly effects = new EffectState();
  private presentationFrame?: {frame: TerminalFrame; plan: ScreenPlan};
  private activityAnimationNow = Date.now();
  /** One pending timeout at a time drives the welcome cat's occasional blink. */
  private welcomeBlinkTimer?: () => void;
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

  constructor(connection?: SessionConnection, preset?: SessionPreset) {
    if (preset) {
      if (!connection || connection.mode !== 'service' || connection.attached) throw new Error('Presets require a new live session.');
      this.presetStartup = new PresetStartup(preset);
    }
    setIconStyle(this.promptConfiguration.glyphStyle);
    // The backend this frontend manages, known before the first welcome is drawn.
    this.shellId = isShellId(connection?.shell) ? connection.shell : isShellId(connection?.attached?.shell) ? connection.attached.shell as ShellId : 'zsh';
    this.startWelcome(this.initialCwd);
    this.applySuggestionProvider();
    this.output.setTranscriptAppearance(this.promptConfiguration.transcript);
    this.output.presenter.setTreatment(this.promptConfiguration.presentation);
    this.output.setOutputFolding(this.promptConfiguration.outputFolding);
    this.output.presenter.setLayout(this.promptConfiguration.transcriptPresentation);
    this.output.presenter.setHyperlinks(this.host.capabilities.hyperlinks);
    this.renderer.setCursorStyle(cursorStyleSequence(this.promptConfiguration.cursor.shape, this.promptConfiguration.cursor.blink));
    const dimensions = this.dimensions();
    this.session = connection?.client
      ?? new InProcessSessionClient({cwd: this.initialCwd, columns: dimensions.columns, rows: Math.max(2, dimensions.rows - 4)});
    this.semanticService = this.shellId === 'zsh' ? new SemanticService(this.initialCwd) : new PathClassifier(shellAdapter(this.shellId));
    if (this.shellId !== 'zsh') this.bindShellServices(this.shellId, false);
    this.done = new Promise(resolve => {
      this.finish = resolve;
    });
    this.session.on('data', (data, stamp) => { if (this.inStream(stamp)) this.onShellData(data); });
    this.session.on('prompt', (marker, stamp) => {
      if (this.inStream(stamp)) {
        if (marker.knowledge !== undefined) {
          this.shellJobs = knowledgeJobCount(marker.knowledge) ?? 0;
          this.semanticService.applyShellKnowledge(marker.knowledge);
          this.commandSources.clear();
          this.completionService.setShellKnowledge(parseShellKnowledge(marker.knowledge));
        }
        this.onShellPrompt(marker.exitCode, marker.cwd, stamp.at);
      }
    });
    this.session.on('exec', (command, stamp) => { if (this.inStream(stamp)) this.onShellExec(command, stamp.at, stamp.historyAllowed); });
    this.session.on('replayed', summary => this.finishReplay(summary));
    this.session.on('inputRejected', (data, submission) => this.onInputRejected(data, submission));
    this.session.on('startup', tail => {
      this.startupTail = tail;
      if (this.startupPanel) { this.startupPanel.tail = tail; this.render(); }
    });
    this.session.on('exit', event => {
      this.shellEnded = true;
      if (event.lost) {
        // Recorded in the journal before it closes; nothing claims the shell survived.
        this.lostServiceConnection = true;
        this.output.addFrontendInteraction('session', 'Lost the connection to the NMSh session service; this live session has ended.', ERROR);
      }
      this.stop(event.exitCode);
    });
    this.sessionMode = connection?.mode ?? 'in-process';
    this.sessionId = connection?.sessionId;
    if (connection?.attached) this.beginReattach(connection.attached, connection.journal);
    // After any restored transcript, or reattaching would erase the launch notice.
    if (connection?.notice) this.output.addFrontendInteraction('session', connection.notice, ERROR);
    this.beginStartupWatch(connection?.attached);
    this.session.start();
  }

  /** The shell has not reached its first prompt; set for a new session, or a reattached one still starting. */
  private startupPending = false;
  private startupTail = '';
  private startupTimer?: NodeJS.Timeout;
  private startupPanel?: {since: number; tail: string};

  /**
   * Normal startup finishes before this fires and shows nothing. A shell that is still not at its first prompt
   * (slow, or blocked on a startup file waiting for input) gets an explicit state instead of a composer that
   * looks ready; commands stay held by the shell until it is.
   */
  private beginStartupWatch(attached: AttachedSession | undefined): void {
    this.startupPending = attached ? attached.startup !== undefined : true;
    this.startupTail = attached?.startup ?? '';
    if (!this.startupPending) return;
    const configured = Number(process.env.NMSH_STARTUP_NOTICE_MS);
    const delay = Number.isFinite(configured) && configured >= 50 ? Math.min(60_000, configured) : 1500;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      if (!this.startupPending || this.stopped) return;
      this.startupPanel = {since: Date.now() - delay, tail: this.startupTail};
      this.render();
    }, delay);
    this.startupTimer.unref?.();
  }

  /** Explicit recovery from a blocked startup: end the shell and this session; nothing is left detached. */
  private abortStartup(): void {
    this.shellEnded = true;
    this.detaching = false;
    try { this.session.kill(); } catch { /* the shell may already be gone */ }
    this.stop(130);
    process.stderr.write('NMSh: shell startup aborted; the session was ended.\n');
  }

  private endStartupWatch(): void {
    this.startupPending = false;
    this.startupTail = '';
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = undefined; }
    this.startupPanel = undefined;
  }

  /** Last shell stream event reflected in the transcript (service sessions). */
  private streamSeq = 0;
  /** Between reattach and the end of the backlog: rebuild the transcript quietly. */
  private replaying = false;
  /** The shell itself ended; the journal is no longer linked to a live session. */
  private shellEnded = false;
  /** Set when the service vanished under an attached session; reported after the screen is restored. */
  lostServiceConnection = false;
  /** Commands the replay completed, for the reattach summary. */
  private replayedCompletions = 0;
  private attachedSession?: AttachedSession;
  private continuedJournal?: TranscriptSession;
  private rendererEntered = false;

  /** Drop stream events the transcript already has (exactly-once replay). */
  private inStream(stamp: StreamStamp): boolean {
    if (stamp.seq === undefined) return true;
    if (stamp.seq <= this.streamSeq) return false;
    this.streamSeq = stamp.seq;
    return true;
  }

  private readonly sessionMode: 'service' | 'in-process';
  private readonly sessionId?: string;

  /**
   * A reattached shell is already running: never re-run startup against it.
   * The previous frontend's journal is the transcript; the service then
   * replays only the stream events that journal lacks, through the same
   * handlers live output uses, and finishReplay() settles the final state.
   */
  private beginReattach(attached: AttachedSession, journal: TranscriptSession | undefined): void {
    this.noteActivity();
    this.attachedSession = attached;
    this.replaying = true;
    this.shellCwd = attached.cwd;
    this.streamSeq = attached.ackedSeq;
    if (attached.knowledge !== undefined) {
      this.shellJobs = knowledgeJobCount(attached.knowledge) ?? 0;
      this.semanticService.applyShellKnowledge(attached.knowledge);
      this.completionService.setShellKnowledge(parseShellKnowledge(attached.knowledge));
    }
    if (!journal) return;
    this.continuedJournal = journal;
    this.welcomeGeneration += 1;
    this.output.restoreTranscript(journal.transcript);
    this.presentationStartCwd = journal.startCwd;
    if (journal.live) {
      this.streamSeq = Math.max(this.streamSeq, journal.live.seq);
      const running = journal.live.running;
      if (running) {
        this.output.resumeActive(running.command, running.startId, running.outputStartId, mode => this.onActiveModeChange(mode));
        this.running = {command: running.command, startedAt: running.startedAt, interrupted: false, cleared: false,
          startId: running.startId, cwd: running.cwd, historyAllowed: running.historyAllowed,
          // A submission checkpoint can precede the very first shell event.
          // Its replayed readiness prompt must not complete the queued command.
          awaitingExec: this.streamSeq === 0};
      }
    }
  }

  private finishReplay(summary: {truncatedBytes: number}): void {
    const attached = this.attachedSession;
    if (!this.replaying || !attached) return;
    this.replaying = false;
    const parts = [`Reattached live session ${attached.sessionId.slice(0, 8)} (zsh pid ${attached.pid})`];
    const completed = this.replayedCompletions;
    if (completed > 0) parts.push(`${completed} command${completed === 1 ? '' : 's'} completed while detached`);
    this.output.addFrontendInteraction('session', `${parts.join(' · ')}.`, INFO);
    if (summary.truncatedBytes > 0) {
      this.output.addFrontendInteraction('session',
        `${formatBytes(summary.truncatedBytes)} of output produced while detached exceeded the retention limit and was not kept.`, ERROR);
    }
    // Without a journal the running command is known only from the service.
    if (!this.running && attached.running) this.onShellExec(attached.running, attached.runningSince);
    if (!this.startupPending && this.running && (attached.fullscreen !== 0 || shouldPassthrough(this.running.command))) {
      this.cancelPresentation();
      this.passthrough = true;
      this.attachedModes = attached.modes ?? '';
      if (this.rendererEntered) this.enterAttachedPassthrough();
    }
    this.scheduleJournal();
    this.render();
  }

  /** The reattached fullscreen app's own terminal modes, which this terminal never received. */
  private attachedModes = '';

  private enterAttachedPassthrough(): void {
    // Reattached into a fullscreen app: hand it the whole terminal again,
    // including the mouse/paste/cursor-key modes it set before the detach.
    this.terminalFocus = 'unknown';
    this.renderer.suspendForPassthrough(this.attachedModes);
    this.attachedModes = '';
    const dimensions = this.dimensions();
    this.session.resize(dimensions.columns, dimensions.rows);
  }

  private onActiveModeChange(mode: PresentationMode): void {
    if (this.idle) this.dismissIdle(false);
    if (this.replaying) return;
    if (mode === 'PASSTHROUGH' && !this.passthrough && !this.startupPending) {
      this.cancelPresentation();
      this.passthrough = true;
      // Modes the program set in earlier output never reached the terminal; hand them over with it.
      this.terminalFocus = 'unknown';
      this.renderer.suspendForPassthrough(this.commandModes.restoreSequence());
      const dimensions = this.dimensions();
      this.session.resize(dimensions.columns, dimensions.rows);
    }
    this.render();
  }

  /**
   * zsh started a command line this frontend did not submit (it began while
   * detached, or came from type-ahead): give it its own transcript block.
   */
  private onShellExec(command: string, at = Date.now(), historyAllowed?: number): void {
    this.effects.cancel();
    if (this.running) {
      this.running.awaitingExec = false;
      this.running.historyAllowed = historyAllowed;
      if (!this.startupPending && !this.passthrough && shouldPassthrough(command)) {
        this.cancelPresentation();
        this.terminalFocus = 'unknown';
        this.passthrough = true;
        this.renderer.suspendForPassthrough();
        const dimensions = this.dimensions();
        this.session.resize(dimensions.columns, dimensions.rows);
      }
      return;
    }
    this.commandModes.reset();
    const startId = this.output.beginCommand(command, this.formatCommandAnsi(command, null), mode => this.onActiveModeChange(mode),
      {cwd: this.shellCwd, project: this.context.project, branch: this.context.branch, prompt: this.currentPromptSnapshot(command)});
    this.tapActivityObserver.reset(this.output.activeOutputStartId ?? startId);
    this.running = {command, startedAt: at, interrupted: false, cleared: false, startId, cwd: this.shellCwd, historyAllowed};
    this.scheduleJournal();
    if (!this.replaying) this.render();
  }

  private scheduleJournal(): void {
    void this.journal?.flush().catch(() => {
      this.output.addFrontendInteraction('/resume', 'Could not persist the current session.', ERROR);
    });
  }

  private liveLink(): LiveLink | undefined {
    if (!this.sessionId || this.shellEnded) return undefined;
    const running = this.running;
    const outputStartId = this.output.activeOutputStartId;
    return {sessionId: this.sessionId, seq: this.streamSeq,
      ...(running && outputStartId !== undefined ? {running: {command: running.command, startedAt: running.startedAt,
        cwd: running.cwd, startId: running.startId, outputStartId, historyAllowed: running.historyAllowed}} : {})};
  }

  async run(): Promise<number> {
    let earlyInput = '';
    // A reattached interactive program owns terminal queries and replies.
    if (!this.passthrough && process.stdin.isTTY && process.stdout.isTTY) {
      this.originalRawMode = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.setEncoding('utf8');
      const resolved = await probeHost(this.host.capabilities, {
        write: data => process.stdout.write(data),
        listen: receive => {
          process.stdin.on('data', receive);
          process.stdin.resume();
          return () => { process.stdin.off('data', receive); process.stdin.pause(); };
        },
      }, undefined, {graphics: shouldProbeGraphics(process.env)});
      process.stdin.setRawMode(this.originalRawMode);
      this.host.capabilities = resolved.capabilities;
      this.renderer.setCapabilities(resolved.capabilities);
      earlyInput = resolved.input;
    }
    this.journal = new SessionJournal(this.transcriptStore, this.promptConfiguration.sessionRetention,
      () => ({startCwd: this.presentationStartCwd, finalCwd: this.shellCwd, transcript: this.output.transcript(), live: this.liveLink()}),
      () => this.output.addFrontendInteraction('/resume', 'Could not persist the current session; check local storage.', ERROR),
      // Durable now: the service may forget these stream events.
      saved => { if (saved.live) this.session.ack(saved.live.seq, saved.id); });
    try {
      if (this.continuedJournal) await this.journal.continue(this.continuedJournal);
      else await this.journal.start();
      this.journalActive = true;
    } catch {
      this.output.addFrontendInteraction('/resume', 'Continuous session journaling could not start; check local storage.', ERROR);
    }
    if (!this.presetStartup && !this.promptConfiguration.glyphChoiceComplete) {
      this.settingsPanelState = {section: 'appearance', selectedIndex: this.promptConfiguration.glyphStyle === 'nerd' ? 0 : 1,
        glyphStyle: this.promptConfiguration.glyphStyle, onboarding: true};
    } else if (!this.presetStartup && !this.promptConfiguration.onboardingComplete) {
      this.promptPanelState = {onboarding: true, step: 'provider', selectedIndex: PROVIDER_ORDER.indexOf(this.promptConfiguration.provider),
        draft: structuredClone(this.promptConfiguration), saved: structuredClone(this.promptConfiguration)};
    } else if (!this.presetStartup && !this.promptConfiguration.toolsSetupComplete) {
      this.startTools(true);
    }
    // Restored terminal modes are a visible handoff: keys can arrive at once.
    // Install raw input first so the host cannot echo or translate those keys.
    if (process.stdin.isTTY) {
      this.originalRawMode = process.stdin.isRaw;
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', this.onInput);
    this.renderer.enter();
    this.rendererEntered = true;
    if (this.passthrough) this.enterAttachedPassthrough();
    if (earlyInput) this.onInput(earlyInput);
    process.stdout.on('resize', this.onResize);
    process.on('SIGTSTP', this.onSuspend);
    process.on('SIGCONT', this.onContinue);
    process.once('SIGTERM', this.onTerminate);
    process.once('SIGHUP', this.onTerminate);
    process.on('exit', () => {
      if (!this.stopped) {
        if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
        this.terminalFocus = 'unknown';
        this.renderer.leave();
      }
    });
    this.presentationStarted = true;
    this.scheduleWelcomeBlink();
    void this.loadHistory();
    this.render();
    void this.quietUpdateCheck();
    void this.quietToolUpdateCheck();
    this.armIdle();
    this.presetFrontendReady = true;
    if (this.presetShellReady) this.advancePresetStartup(0, this.shellCwd);
    const exitCode = await this.done;
    try { await this.journal.close(!this.detaching || this.shellEnded); } catch {
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
    if (this.passthrough && !this.startupPending) {
      this.session.write(data);
      return;
    }
    const keys = this.keyDecoder.push(data);
    this.scheduleEscapeFlush();
    this.handleDecodedKeys(keys);
  };

  /** The Escape key flush timer (see KeyDecoder.pendingEscape); at most one, cleared by the next input. */
  private escapeFlushTimer?: NodeJS.Timeout;
  private static readonly ESCAPE_FLUSH_MS = 35;

  private scheduleEscapeFlush(): void {
    if (this.escapeFlushTimer) { clearTimeout(this.escapeFlushTimer); this.escapeFlushTimer = undefined; }
    if (!this.keyDecoder.pendingEscape) return;
    this.escapeFlushTimer = setTimeout(() => {
      this.escapeFlushTimer = undefined;
      if (this.stopped) return;
      const keys = this.keyDecoder.flush();
      if (keys.length) this.handleDecodedKeys(keys);
    }, TerminalApp.ESCAPE_FLUSH_MS);
    this.escapeFlushTimer.unref?.();
  }

  private handleDecodedKeys(keys: Key[]): void {
    if (this.idle) {
      // The idle overlay owns input and passes nothing on. Losing focus keeps it running
      // (the terminal may still be visible); focus returning or any real input dismisses it.
      if (keys.some(key => key.kind === 'focusIn' || key.kind === 'focusOut')) this.terminalFocus = [...keys].reverse().find(key => key.kind === 'focusIn' || key.kind === 'focusOut')!.kind === 'focusOut' ? 'blurred' : 'focused';
      if (keys.some(key => key.kind !== 'focusOut')) this.dismissIdle();
      return;
    }
    // Focus reports alone are not user activity (a terminal can report them on its own).
    if (keys.some(key => key.kind !== 'focusIn' && key.kind !== 'focusOut')) this.noteActivity();
    for (const key of keys) this.handleKey(key);
    // Passive motion renders only when hover changes; skip the generic frame.
    if (keys.length === 0 || keys.some(key => key.kind !== 'mouseMove')) this.render();
  }

  private readonly onResize = (): void => {
    this.effects.cancel();
    if (this.idle) this.dismissIdle(false);
    this.noteActivity();
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

  // The frontend is going away (window closed, SIGHUP/SIGTERM); the shell was
  // not asked to end, so a service-backed session stays alive, detached.
  private readonly onTerminate = (): void => {
    this.detaching = this.sessionMode === 'service';
    this.session.detach();
    this.stop(0);
  };

  private frontendSuspended = false;
  private readonly onSuspend = (): void => {
    if (this.stopped || this.externalPassthrough) return;
    this.cancelPresentation();
    this.frontendSuspended = true;
    this.terminalFocus = 'unknown';
    this.renderer.leave();
    if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
    process.stdin.pause();
    process.kill(process.pid, 'SIGSTOP');
  };

  private readonly onContinue = (): void => {
    if (!this.frontendSuspended || this.stopped) return;
    this.frontendSuspended = false;
    this.terminalFocus = 'unknown';
    this.renderer.enter();
    if (this.passthrough) this.renderer.suspendForPassthrough(this.commandModes.restoreSequence());
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    this.keyDecoder.reset();
    this.onResize();
  };

  private handleKey(key: Key): void {
    // Adjacent typing barely animates the caret; every other movement travels (cursor effects only).
    this.caretCause = key.kind === 'text' || key.kind === 'backspace' || key.kind === 'delete' || key.kind === 'paste' ? 'typing' : 'jump';
    if (this.effects.active && (key.kind === 'escape' || (key.kind === 'interrupt' && !this.running))) {
      this.effects.cancel(); this.render(); return;
    }
    if (key.kind === 'focusIn' || key.kind === 'focusOut') {
      this.terminalFocus = key.kind === 'focusIn' ? 'focused' : 'blurred';
      return;
    }
    if (this.startupPending && key.kind === 'interrupt') { this.abortStartup(); return; }
    if (this.startupPanel) {
      // The shell is not ready; it may be waiting on a startup file. Abort is explicit, and nothing the
      // composer produces is submitted until the shell reaches its first prompt (typed text is kept).
      if (key.kind === 'interrupt') { this.abortStartup(); return; }
      if (key.kind === 'enter' || key.kind === 'newline') return;
    }
    if (this.presetStartup?.active) {
      if (key.kind === 'interrupt') {
        this.presetStartup.cancel(); this.session.interrupt();
        this.output.addFrontendInteraction('/presets', 'Preset startup cancelled; remaining commands were not run.', INFO);
      }
      return;
    }
    if (this.presetPanel) {
      this.handlePresetKey(key, this.presetPanel);
      return;
    }
    if (this.toolConfigurationLoading) {
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.toolConfigurationGeneration++;
        this.toolConfigurationLoading = false;
        this.returnFromPanel();
        this.render();
      }
      return;
    }
    if (this.toolConfiguration) {
      const state = this.toolConfiguration;
      void configurationKey(state, key).then(close => {
        if (close && this.toolConfiguration === state) {
          this.toolConfiguration = undefined;
          if (!this.toolsPanel) this.returnFromPanel();
        }
        this.render();
      });
      return;
    }
    if (this.misePanel) {
      void this.handleMiseKey(key, this.misePanel);
      return;
    }
    if (this.installPrompt) {
      void this.handleInstallPromptKey(key, this.installPrompt);
      return;
    }
    if (this.setupState) {
      this.handleSetupKey(key, this.setupState);
      return;
    }
    if (this.themeStudio) {
      this.handleThemeStudioKey(key, this.themeStudio);
      return;
    }
    if (this.screensaverPanel) {
      this.handleScreensaverKey(key, this.screensaverPanel);
      return;
    }
    if (this.stopsEditor) {
      this.handleStopsEditorKey(key, this.stopsEditor);
      return;
    }
    if (this.chromeEditor) {
      const result = chromeEditorKey(this.chromeEditor, key, colorLevel());
      if (result?.kind === 'cancel') { this.chromeEditor = undefined; this.returnFromPanel(); }
      else if (result?.kind === 'save' && this.applySettingsConfiguration({...this.promptConfiguration,
        uiChrome: {source: 'custom', preset: 'custom', colors: result.colors}})) { this.chromeEditor = undefined; this.returnFromPanel(); }
      return;
    }
    if (this.toolsPanel) {
      void this.handleToolsKey(key, this.toolsPanel);
      return;
    }
    if (this.paletteState) {
      const state = this.paletteState;
      if (key.kind === 'escape' || key.kind === 'interrupt' || key.kind === 'palette') this.paletteState = undefined;
      else {
        const result = handlePaletteKey(key, state, this.paletteRecent);
        if (result && result !== 'changed') {
          this.paletteState = undefined;
          void this.runPaletteItem(result).then(() => this.render());
        }
      }
      this.render();
      return;
    }
    if (key.kind === 'palette') {
      if (!this.running) this.openPalette();
      this.render();
      return;
    }
    if (this.settingsPanelState) {
      const settingsState = this.settingsPanelState;
      this.handleSettingsKey(key, settingsState);
      if (settingsState.section === 'root' && settingsView(settingsState) === 'config') {
        this.settingsMemory = {contentIndex: settingsState.contentIndex ?? 0, searchQuery: settingsState.searchQuery ?? '', showAdvanced: Boolean(settingsState.showAdvanced)};
      }
      this.render();
      return;
    }
    if (this.layoutPanelState) {
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.layoutPanelState = undefined;
        this.returnFromPanel();
        this.render();
      } else if (key.kind === 'enter') {
        this.saveLayoutSettings();
      } else if (handleLayoutPanelKey(key, this.layoutPanelState)) this.render();
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
    if (this.providerPanelState) {
      void this.handleProviderPanelKey(key, this.providerPanelState);
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
        this.promptPanelState.selectedIndex = appearanceModulesRow(this.promptPanelState.draft);
        this.render();
      } else if (this.promptPanelState.step === 'gradient' && (key.kind === 'escape' || key.kind === 'enter' || key.kind === 'interrupt')) {
        // The stop editor owns Enter (edit/apply) and Esc (cancel an edit, else return with its stops).
        const editing = this.promptPanelState.gradient?.editing !== undefined;
        if (key.kind === 'enter' || editing) handlePromptPanelKey(key.kind === 'interrupt' ? {kind: 'escape'} : key, this.promptPanelState);
        else closeGradientEditor(this.promptPanelState);
        this.render();
      } else if (promptPanelOwnsKey(this.promptPanelState, key)) {
        // Typing a custom glyph owns Enter and Esc until it is set or cancelled.
        handlePromptPanelKey(key, this.promptPanelState);
        this.render();
      } else if (key.kind === 'escape' || key.kind === 'interrupt') {
        if (this.promptPanelState.onboarding) void this.savePromptSettings();
        else { this.promptPanelState = undefined; this.returnFromPanel(); this.render(); }
      } else if (key.kind === 'enter') {
        void this.advancePromptPanel();
      } else if (handlePromptPanelKey(key, this.promptPanelState)) this.render();
      return;
    }
    if (this.findState?.editing && !this.settingsPanelActive && this.handleFindKey(key)) return;
    if (this.openPanel) {
      const panel = this.openPanel;
      const action = openPanelKey(panel, key);
      if (action === 'close') { this.openPanel = undefined; this.returnFromPanel(); }
      else if (action === 'open') {
        const reference = panel.references[panel.selected]!;
        this.openPanel = undefined;
        void this.openLocation(`/open ${reference.text}`, `${reference.path}:${reference.line ?? ''}${reference.column ? `:${reference.column}` : ''}`.replace(/:$/u, ''), reference.cwd);
      }
      this.render();
      return;
    }
    if (this.cursorPanel) { this.handleCursorPanelKey(key, this.cursorPanel); this.render(); return; }
    if (this.understandingPanel) {
      const action = understandingKey(this.understandingPanel, key, this.understandingFacts());
      if (action) void this.handleUnderstandingAction(action);
      this.render();
      return;
    }
    if (this.providersOverview) {
      const action = providersOverviewKey(this.providersOverview, key);
      if (action?.kind === 'close') { this.providersOverview = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'detect') void this.refreshProvidersOverview(true);
      else if (action?.kind === 'open') this.openProviderFamily(action.row);
      this.render();
      return;
    }
    if (this.agentView) { this.handleAgentViewKey(key); return; }
    if (this.shelf.focused && this.handleShelfKey(key)) return;
    if (this.agentPanel) { this.handleAgentPanelKey(key); return; }
    if (this.askState) {
      const event = askKey(this.askState, key, this.dimensions().columns);
      if (event) void this.handleAskEvent(event);
      this.render();
      return;
    }
    if (this.shellPanel) {
      const action = shellPanelKey(this.shellPanel, key);
      if (action?.kind === 'close') { this.shellPanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'switch') { this.shellPanel = undefined; void this.switchShell(action.shell, '/shell'); }
      else if (action?.kind === 'install') void this.installShell(action.shell, action.install);
      else if (action?.kind === 'default') {
        this.updateConfiguration(configuration => { configuration.shellBackend = action.shell; });
        this.shellPanel.defaultShell = action.shell;
        this.shellPanel.message = `${shellAdapter(action.shell).label} is now the default for new sessions. This session is unchanged.`;
      }
      this.render();
      return;
    }
    if (this.aboutPanel) {
      // Read-only panel: any key closes it, and its image goes with it.
      this.aboutPanel = undefined;
      this.renderer.setImageOverlay(undefined);
      this.returnFromPanel();
      this.render();
      return;
    }
    if (this.resumeBrowser) {
      const browser = this.resumeBrowser;
      if (browser.confirmKill) {
        if (key.kind === 'enter') void this.killSelectedLiveSession();
        else if (key.kind === 'escape' || key.kind === 'interrupt') browser.confirmKill = undefined;
        this.render();
        return;
      }
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.resumeBrowser = undefined;
      } else if (key.kind === 'complete' && browser.liveOnly) {
        this.resumeBrowser = undefined;
        this.agentPanel = {selected: 0};
      } else if (key.kind === 'deleteLineAfter') {
        const selection = resumeSelection(browser);
        if (selection?.kind === 'live' && selection.session.state === 'detached' && selection.session.id !== browser.currentId) browser.confirmKill = selection.session.id;
      } else if (key.kind === 'up') {
        browser.selectedIndex = Math.max(0, browser.selectedIndex - 1);
      } else if (key.kind === 'down') {
        browser.selectedIndex = Math.max(0, Math.min(resumeRowCount(browser) - 1, browser.selectedIndex + 1));
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
        const selection = resumeSelection(browser);
        if (selection?.kind === 'live' && selection.session.id === browser.currentId) {
          this.resumeBrowser = undefined;
          this.output.addFrontendInteraction('/sessions', 'That is this window\'s session; nothing to switch.', INFO);
        } else if (selection?.kind === 'live') this.switchToLiveSession(selection.session.id, selection.session.state);
        else void this.resumeSelectedSession();
      }
      this.render();
      return;
    }
    if (key.kind === 'mouseDrag' || key.kind === 'mouseRelease') { this.handleSelectionPointer(key.kind, key.y); return; }
    // Any other key or click ends a finished selection (its text is already on the clipboard).
    if (this.selection && !this.selection.dragging && key.kind !== 'wheelUp' && key.kind !== 'wheelDown' && key.kind !== 'mouseMove') {
      this.selection = undefined;
      this.render();
    }
    if (key.kind === 'mouseMove' || key.kind === 'mouseClick') {
      const {columns, rows} = this.dimensions();
      // Hit-test against the same plan render paints; Shift+mouse never reaches here (native selection).
      const plan = this.planFrame(columns, rows);
      const hit = key.y ? regionAt(plan, screenRowFromTerminal(key.y)) : undefined;
      if (hit?.region.kind === 'transcript') {
        const outputHeight = plan.viewportRows;
        const wrapped = this.output.wrapped(columns);
        const viewStart = this.historyViewport.resolve(wrapped.length, outputHeight);
        const localVisibleIndex = hit.localRow;

        // The sticky header paints over the transcript region's first row.
        const sticky = localVisibleIndex === 0 ? this.stickyHeader(wrapped, viewStart) : undefined;
        if (sticky) {
          // The sticky overlay owns the top row: a click jumps to the block's real header.
          if (key.kind === 'mouseClick') {
            this.historyViewport.scrollLines(wrapped.length, outputHeight, sticky.targetIndex - viewStart);
            this.hoveredLineIndex = undefined;
            this.render();
          } else if (this.hoveredLineIndex !== undefined) {
            this.hoveredLineIndex = undefined;
            this.render();
          }
        } else if (localVisibleIndex >= 0) {
          const row = wrapped[viewStart + localVisibleIndex];
          // A press may start a drag selection; a plain click still acts exactly as before.
          if (key.kind === 'mouseClick' && row && key.y) this.selection = beginSelection(viewStart + localVisibleIndex, key.y);
          if (row) {
            const affordance = blockAffordance(row, columns);
            if (!this.running && key.kind === 'mouseClick' && row.lineIndex === this.hoveredLineIndex
              && affordance && (key.x ?? 0) >= affordance.column && row.blockStartId !== undefined) {
              this.openBlockPalette(row.blockStartId);
              this.render();
              return;
            }
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
      this.followSelectionPointer();
      return;
    }
    if (key.kind === 'pageDown') {
      this.scroll(1);
      return;
    }
    if (key.kind === 'wheelDown') {
      this.scrollLines(3);
      this.followSelectionPointer();
      return;
    }
    if (key.kind === 'latest') {
      this.historyViewport.latest();
      return;
    }
    // Flow keeps the composer in the document: editing while scrolled back
    // returns to it first. Scrolling and mouse navigation alone never do.
    if (this.promptConfiguration.composerPosition === 'flow' && this.historyViewport.detached && FLOW_EDIT_KEYS.has(key.kind)) {
      this.historyViewport.latest();
    }

    if (!this.running && key.kind === 'enter' && this.focusedCommandIndex !== undefined) {
      const record = this.output.recent(this.focusedCommandIndex + 1);
      if (record) this.openBlockPalette(record.startId);
      return;
    }
    if (key.kind === 'escape') this.clearBlockFocus();
    if (FLOW_EDIT_KEYS.has(key.kind) && key.kind !== 'enter') this.clearBlockFocus();

    if (key.kind === 'historyDelete' && this.historySearchActive) {
      const entry = this.historyQuery === this.editor.text.substring(HISTORY_SEARCH.length) ? this.historyResults[this.selectedSuggestion] : undefined;
      if (entry) void this.historyService.index.delete(entry.id).then(() => {
        this.historyQuery = undefined;
        this.historyResults = [];
        this.render();
      }).catch(() => { this.output.addFrontendInteraction('/history', 'Could not persist history deletion.', ERROR); this.render(); });
      return;
    }
    if (key.kind === 'historySearch') {
      if (!this.running) {
        void this.openHistoryPicker('');
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
      this.clearCorrection();
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
    if (key.kind === 'find') {
      // Transcript find while NMSh owns the idle composer; a running command
      // still receives the byte, exactly as it would without NMSh.
      if (this.running) this.session.write('\u0006');
      else { this.openFindEditor(); this.render(); }
      return;
    }
    if (key.kind === 'suspend') {
      // Job control belongs to zsh: forward ^Z so it stops the foreground job.
      // With no foreground command there is nothing to suspend, so the idle
      // composer ignores it rather than treating it as text, undo, or exit.
      if (this.running) this.session.write('\u001A');
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

    if (this.correction && !this.running && this.editor.text.length === 0) {
      const action = resolveAction(CORRECTION_ACTIONS, key);
      if (action?.id === 'insert') {
        this.applySuggestion(this.correction);
        this.clearCorrection();
        return;
      }
      if (action?.id === 'dismiss') { this.clearCorrection(); return; }
    }
    if (key.kind === 'text' || key.kind === 'paste' || key.kind === 'enter') this.clearCorrection();
    // Input can contain several decoded keys before the next render; guard stale candidates here too.
    if (this.shellSuggestions.some(candidate => candidate.context && (candidate.context.buffer !== this.editor.text || candidate.context.cwd !== this.context.cwd
      || candidate.context.cursor !== undefined && candidate.context.cursor !== this.completionCursor
      || candidate.context.expiresAt !== undefined && Date.now() >= candidate.context.expiresAt))) {
      this.shellSuggestions = []; this.completionGeneration += 1; this.completionService.cancel();
      this.lastSuggestionInput = '';
    }

    if (!this.running && !this.historySearchActive && !this.directorySearchActive && !this.editor.text.startsWith('/') && this.shellSuggestions.length > 0
      && !this.suggestions.alternativesOpen) {
      const action = resolveAction(COMPLETION_ACTIONS, key);
      // Up from the first candidate leaves the menu for shell history, as Up
      // from an editor's first line does; Down still enters the menu.
      if (action?.id === 'move' && !(key.kind === 'up' && this.selectedSuggestion === 0)) {
        this.selectedSuggestion = (this.selectedSuggestion + (key.kind === 'down' ? 1 : -1) + this.shellSuggestions.length) % this.shellSuggestions.length;
        return;
      }
      if (action?.id === 'insert') {
        const candidate = this.shellSuggestions[this.selectedSuggestion] ?? this.shellSuggestions[0];
        if (candidate) {
          if (this.promptConfiguration.picker !== 'native' && this.shellSuggestions.length > 1) void this.openCompletionPicker();
          else this.applySuggestion(candidate);
        }
        return;
      }
      if (action?.id === 'cancel') {
        this.completionGeneration += 1;
        this.completionService.cancel();
        this.shellSuggestions = [];
        return;
      }
    }

    if (!this.running && this.handleSuggestionKey(key)) {
      this.selectedSuggestion = 0;
      return;
    }

    // History search navigates its own matches; other slash text navigates slash commands.
    const suggestions = this.directorySearchActive ? this.directoryMatches(this.editor.text.substring(DIRECTORY_SEARCH.length)) : this.historySearchActive
      ? this.historyMatches(this.editor.text.substring(HISTORY_SEARCH.length))
      : this.editor.hasPasteAtoms ? [] : slashSuggestions(this.editor.text);
    const isSlash = !this.editor.hasPasteAtoms && this.editor.text.startsWith('/');
    // /history and /dirs own Up/Down. Slash suggestions behave like the shell
    // completion menu: Down enters it, Up from its first row (or before
    // entering it) leaves it for command history.
    const searchSurface = this.historySearchActive || this.directorySearchActive;
    const inSlashMenu = this.slashMenuFor === this.editor.text;
    if (key.kind === 'up' && suggestions.length > 0 && (searchSurface || (inSlashMenu && this.selectedSuggestion > 0))) {
      this.selectedSuggestion = (this.selectedSuggestion - 1 + suggestions.length) % suggestions.length;
    } else if (key.kind === 'down' && suggestions.length > 0 && (searchSurface || isSlash)) {
      if (!searchSurface && !inSlashMenu) { this.slashMenuFor = this.editor.text; this.selectedSuggestion = 0; }
      else this.selectedSuggestion = (this.selectedSuggestion + 1) % suggestions.length;
    } else if (key.kind === 'up' && isSlash && !searchSurface && suggestions.length > 0 && this.leaveSlashMenu()) {
      // Left the slash menu; fall through to history recall below.
      const {columns} = this.dimensions();
      if (!this.editor.moveUp(columns, this.inputFirstLinePrefix(columns)) && !this.running) this.recallHistory('previous');
    } else if (key.kind === 'complete') {
      const action = tabCompletionAction(this.shellSuggestions.length, isSlash ? suggestions.length : 0);
      if (action === 'shell-suggestion') {
        const suggestion = this.shellSuggestions[Math.min(this.selectedSuggestion, this.shellSuggestions.length - 1)];
        if (suggestion) this.applySuggestion(suggestion);
      } else if (action === 'slash-suggestion') {
        const slash = suggestions[Math.min(this.selectedSuggestion, suggestions.length - 1)];
        if (slash) this.applySuggestion({insertion: this.historySearchActive || this.directorySearchActive ? slash.insertion : slash.name});
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

      const commandRows: Array<{lineIndex: number; activityId?: string; commandIndex?: number}> = this.output.view().completed.map((record, commandIndex) => ({lineIndex: record.startId, commandIndex}));
      const seenTargets = new Set<string>();
      const focusableRows = [...commandRows, ...metadataRows, ...foldHintRows]
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
        const outputHeight = this.planFrame(columns, rows).viewportRows;

        const wrapped = this.output.wrapped(columns);
        const wrappedIndex = wrapped.findIndex(r => this.focusedActivityId
          ? r.activityId === this.focusedActivityId && r.isFoldHint
          : this.focusedCommandIndex !== undefined
            ? r.blockStartId === this.output.recent(this.focusedCommandIndex + 1)?.startId
            : r.lineIndex === this.focusedLineIndex);
        if (wrappedIndex !== -1) {
          this.historyViewport.resolve(wrapped.length, outputHeight);
          if (wrappedIndex < this.historyViewport.start || wrappedIndex >= this.historyViewport.start + outputHeight) {
             this.historyViewport.scrollLines(wrapped.length, outputHeight, wrappedIndex - this.historyViewport.start - Math.floor(outputHeight / 2));
          }
        }

        this.render();
      }
      return;
    }
    else if (key.kind === 'left' && this.composerIdle()) { void this.openSessionsView(); return; }
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
      if (!this.editor.moveUp(columns, this.inputFirstLinePrefix(columns)) && !this.running) this.recallHistory('previous');
    } else if (key.kind === 'selectUp') {
      const {columns} = this.dimensions();
      this.editor.selectUp(columns, this.inputFirstLinePrefix(columns));
    } else if (key.kind === 'down') {
      const {columns} = this.dimensions();
      // At the newest, empty composer ↓ has nothing to do: it reveals the agent shelf (and a second ↓ focuses it).
      if (!this.editor.text && !this.composerHistory.active && this.agents.sessions.length && !this.running) { this.revealShelf(); this.render(); return; }
      if (!this.editor.moveDown(columns, this.inputFirstLinePrefix(columns)) && !this.running) this.recallHistory('next');
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
          const input = this.editor.text;
          this.editor.clear();
          this.session.write(`${input}\r`);
          return;
        }
        this.editor.clear();
      } else {
        if (this.preparingCommand) return;
        void this.submit();
      }
    }
  }


  /**
   * The highlighted candidate's description: structured completion text,
   * local knowledge, the session-identity fallback (alias/function bodies are
   * never shown), or a local man-page summary looked up off the keypress path.
   */
  private completionDescription(candidate: CompletionCandidate): string {
    if (candidate.description) return candidate.description;
    if (candidate.kind !== 'command') return '';
    const known = localKnowledge(candidate.value, candidate.value, true)?.description ?? identityDescription(candidate);
    if (known) return known;
    const cached = this.commandDescriptions.cached(candidate.value);
    if (cached !== undefined) return cached;
    void this.commandDescriptions.request(candidate.value).then(description => {
      // Every visible row shows its description, so any candidate still listed repaints.
      if (description && !this.stopped && this.shellSuggestions.some(item => item.value === candidate.value)) this.render();
    });
    return '';
  }

  /** Command-name use from the eligible history index, recomputed only when it changed. */
  private refreshCommandUsage(): void {
    const index = this.historyService.index;
    if (index.version === this.commandUsageVersion) return;
    this.commandUsageVersion = index.version;
    const usage = new Map<string, {count: number; last: number}>();
    const entries = index.all();
    for (let position = 0; position < Math.min(entries.length, 5000); position += 1) {
      const entry = entries[position]!;
      const name = /^\s*([^\s=;|&()<>]+)(?=\s|$)/u.exec(entry.command)?.[1];
      if (!name) continue;
      const known = usage.get(name);
      if (known) known.count += 1;
      else usage.set(name, {count: 1, last: entry.at ?? 0});
    }
    this.completionService.setCommandUsage(usage);
  }

  /**
   * Up past the editor's first row recalls older commands; Down past its last
   * row walks newer ones and finally restores the unsent draft. Only text is
   * placed in the composer: nothing runs until Enter.
   */
  private recallHistory(direction: 'previous' | 'next'): void {
    if (this.editor.hasPasteAtoms) return;
    const current = this.editor.text;
    const text = direction === 'previous'
      ? this.composerHistory.previous(current, () => recallSource(this.sessionSubmissions, [...historyCommands(this.historyService.index.all())]))
      : this.composerHistory.next(current);
    if (text === undefined) return;
    this.editor.replaceText(text);
    this.selectedSuggestion = 0;
    this.shellSuggestions = [];
  }

  private async fetchSuggestions(): Promise<void> {
    const input = this.editor.text;
    if (!this.directorySearchActive && this.directoryQuery !== undefined) {
      this.directoryQueryAbort?.abort(); this.directoryQuery = undefined; this.directoryResults = [];
    }
    if (!this.historySearchActive && this.historyQuery !== undefined) {
      this.historyQueryAbort?.abort();
      this.historyQuery = undefined;
      this.historyResults = [];
    }
    const cwd = this.context.cwd;
    const cursor = this.completionCursor;
    // A recalled command is not being typed: no completion menu claims Up/Down until it is edited.
    const eligible = !this.running && !this.settingsPanelActive && !this.editor.hasPasteAtoms && !input.startsWith('/') && Boolean(input.trim())
      && !this.composerHistory.showing(input);
    const key = eligible ? JSON.stringify([input, cursor, cwd]) : '';
    if (key === this.lastSuggestionInput) return;
    this.lastSuggestionInput = key;
    const generation = ++this.completionGeneration;
    this.completionService.cancel();
    // Clear before the next frame: results for another buffer must never flash.
    this.shellSuggestions = [];
    this.selectedSuggestion = 0;
    if (!eligible) return;
    this.refreshCommandUsage();
    const comps = await this.completionService.suggest(input, cwd, cursor);
    if (!this.stopped && generation === this.completionGeneration && this.editor.text === input && this.context.cwd === cwd
      && this.completionCursor === cursor && !this.running && !this.settingsPanelActive && !this.editor.hasPasteAtoms) {
      this.shellSuggestions = comps;
      this.render();
    }
  }

  private get completionCursor(): number {
    return graphemes(this.editor.text).slice(0, this.editor.cursorIndex).join('').length;
  }

  private async openCompletionPicker(): Promise<void> {
    if (this.running || this.externalPassthrough || this.pickerOpening) return;
    const candidates = [...this.shellSuggestions];
    const original = this.editor.text;
    const cursor = this.completionCursor;
    const cwd = this.context.cwd;
    this.pickerOpening = true;
    try {
      const native = () => { /* Keep the existing native menu on fallback. */ };
      const result = await openPicker(this.promptConfiguration.picker, candidates.map((candidate, index) => ({
        id: String(index), label: candidate.display, description: candidate.description, value: candidate.insertion,
      })), native, this.pickerHandoff);
      if (!this.stopped && !this.running && this.editor.text === original && this.completionCursor === cursor && this.context.cwd === cwd
        && result?.kind === 'selected') {
        const selected = candidates[Number(result.candidate.id)];
        if (selected && selected.insertion === result.candidate.value) this.applySuggestion(selected);
      }
    } finally { this.pickerOpening = false; }
  }

  /**
   * Enter in history search: bare `/history` opens the search; otherwise the
   * selected match is restored into the editor (not run). With no match the
   * search stays open unchanged. Nothing is written to zsh or the transcript.
   */
  private submitHistorySearch(query: string, searching: boolean): void {
    const selected = searching ? this.historyMatches(query)[this.selectedSuggestion] ?? this.historyMatches(query)[0] : undefined;
    if (selected) this.applySuggestion(selected);
    else {
      this.editor.insert(`${HISTORY_SEARCH}${query}`);
      this.selectedSuggestion = 0;
    }
  }

  private async openHistoryPicker(query: string): Promise<void> {
    if (this.running || this.externalPassthrough || this.pickerOpening) return;
    this.pickerOpening = true;
    try {
      const original = this.editor.text;
      const native = () => this.applySuggestion({insertion: `${HISTORY_SEARCH}${query}`});
      const candidates = this.promptConfiguration.picker === 'native' ? [] : (await this.historyService.search(query)).map(entry => ({
        id: entry.id, label: entry.command, value: entry.command, description: entry.cwd,
      }));
      if (this.stopped || this.running || this.editor.text !== original) return;
      const result = await openPicker(this.promptConfiguration.picker, candidates, native, this.pickerHandoff);
      if (this.stopped) return;
      if (result?.kind === 'selected') this.applySuggestion({insertion: result.candidate.value});
      if (result?.kind === 'fallback') this.output.addFrontendInteraction('/history', result.reason, INFO);
      this.render();
    } finally { this.pickerOpening = false; }
  }

  private async openDirectoryPicker(query: string): Promise<void> {
    if (this.running || this.externalPassthrough || this.pickerOpening) return;
    this.pickerOpening = true;
    try {
      const original = this.editor.text;
      const native = () => this.applySuggestion({insertion: `${DIRECTORY_SEARCH}${query}`});
      const directories = this.promptConfiguration.picker === 'native' ? [] : await this.directoryService.query(
        this.historyService.index.all(), query, this.promptConfiguration.navigation);
      if (this.stopped || this.running || this.editor.text !== original) return;
      const result = await openPicker(this.promptConfiguration.picker, directories.map(item => ({
        id: item.path, label: item.path, description: item.project, value: directoryCommand(item.path),
      })), native, this.pickerHandoff);
      if (this.stopped) return;
      if (result?.kind === 'selected') this.applySuggestion({insertion: result.candidate.value});
      if (result?.kind === 'fallback') this.output.addFrontendInteraction('/dirs', result.reason, INFO);
      this.render();
    } finally { this.pickerOpening = false; }
  }

  /** External pickers temporarily own the host terminal, never the managed shell PTY. */
  private readonly pickerHandoff: PickerHandoff = async run => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || this.running || this.passthrough || this.externalPassthrough)
      return {kind: 'fallback', reason: 'A free interactive terminal is required; using Native'};
    const controller = new AbortController();
    const abort = () => controller.abort();
    const ignoreInterrupt = () => { /* The foreground picker handles Ctrl+C. */ };
    this.cancelPresentation();
    this.externalPassthrough = true;
    let detached = false;
    let released = false;
    let left = false;
    try {
      process.stdin.off('data', this.onInput); process.stdin.pause(); detached = true;
      process.stdin.setRawMode(false); released = true;
      this.terminalFocus = 'unknown';
      this.renderer.leave(); left = true;
      process.on('SIGINT', ignoreInterrupt);
      process.on('SIGWINCH', abort);
      this.pickerAbort = controller;
      return await run(controller.signal);
    } catch (error) { return {kind: 'fallback', reason: `Picker failed: ${String(error)}; using Native`}; }
    finally {
      process.off('SIGINT', ignoreInterrupt); process.off('SIGWINCH', abort);
      this.pickerAbort = undefined;
      if (!this.stopped) {
        if (left) this.renderer.enter();
        if (released) process.stdin.setRawMode(true);
        this.keyDecoder.reset();
        if (detached) { process.stdin.on('data', this.onInput); process.stdin.resume(); }
        this.renderer.invalidate();
      }
      this.externalPassthrough = false;
      this.render();
    }
  };

  private applySuggestion(suggestion: {insertion: string; insertionCursor?: number}): void {
    this.editor.clear();
    this.editor.insert(suggestion.insertion);
    if (suggestion.insertionCursor !== undefined) {
      const trailing = graphemes(suggestion.insertion.slice(suggestion.insertionCursor)).length;
      for (let i = 0; i < trailing; i++) this.editor.moveLeft();
    }
    this.selectedSuggestion = 0;
  }

  /** Runs one NMSh slash command; the palette and the composer share this dispatch. */
  private async runSlash(command: string, slash: NonNullable<ReturnType<typeof parseSlashCommand>>): Promise<void> {
    if (slash.kind === 'effects') {
      if (slash.effect === 'help') this.output.addFrontendInteraction(command, '/effects sparkles|rain|confetti [top|bottom] · /effects stop · Escape cancels. Owned gaps/rules only; Reduced Motion and Decorative effects Off suppress previews.', INFO);
      else if (slash.effect === 'stop') this.effects.cancel();
      else if (!this.running && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended) {
        this.effects.trigger(slash.effect, slash.placement, Date.now(), 0x4e4d5348, {...this.promptConfiguration.presentation,
          reducedMotion: this.promptConfiguration.presentation.reducedMotion || isReducedMotion()});
      }
      this.render();
    }
    else if (slash.kind === 'copy') await this.copyRecent(slash.index);
    else if (slash.kind === 'appearance') { this.panelOrigin = undefined; await this.startAppearance(); }
    else if (slash.kind === 'prompt') { this.panelOrigin = undefined; await this.startPromptSettings(false); }
    else if (slash.kind === 'chroma') { this.panelOrigin = undefined; this.startChromaSettings(); }
    else if (slash.kind === 'screensaver') {
      this.panelOrigin = undefined;
      if (slash.start) {
        if (slash.mode) this.applySettingsConfiguration({...this.promptConfiguration, idleVisuals: {...this.promptConfiguration.idleVisuals, mode: slash.mode}});
        this.startIdle(true);
      } else this.screensaverPanel = createScreensaverPanel(Date.now());
    }
    // The cursor has one configuration: /cursor opens its existing Settings rows.
    else if (slash.kind === 'cursor') this.openCursorPanel();
    else if (slash.kind === 'activity') { this.panelOrigin = undefined; this.focusConfigRow('activityColors'); }
    else if (slash.kind === 'theme') { this.panelOrigin = undefined; this.themeStudio = createThemeStudio(this.promptConfiguration.customTheme, this.promptConfiguration.nmsh.palette); }
    else if (slash.kind === 'settings') this.openSettingsPanel(slash.view);
    else if (slash.kind === 'tools') { this.panelOrigin = undefined; this.startTools(); }
    else if (slash.kind === 'setup') { this.panelOrigin = undefined; this.startSetup(slash.entry); }
    else if (slash.kind === 'transcript') { this.panelOrigin = undefined; this.startTranscriptSettings(); }
    else if (slash.kind === 'syntax') { this.panelOrigin = undefined; this.startSyntaxSettings(); }
    else if (slash.kind === 'layout') { this.panelOrigin = undefined; this.startLayoutSettings(); }
    else if (slash.kind === 'keyboard') { this.panelOrigin = undefined; await this.startKeyboard(); }
    else if (slash.kind === 'handoff') this.leaveForOrdinaryShell(slash.shell ?? this.promptConfiguration.shellBackend, command);
    else if (slash.kind === 'version') this.output.addFrontendInteraction(command, formatBuildIdentity(this.buildIdentity), INFO);
    else if (slash.kind === 'update') void this.runUpdateCommand(command, slash.apply);
    else if (slash.kind === 'clear') await this.startFreshPresentation();
    else if (slash.kind === 'presets') this.startPresets();
    else if (slash.kind === 'resume') await this.openResumePicker();
    else if (slash.kind === 'sessions') await this.openSessionsView();
    else if (slash.kind === 'ai') this.openAi(command, slash.target);
    else if (slash.kind === 'help') this.showHelp(command);
    else if (slash.kind === 'agents') this.runAgentsCommand(command, slash.action);
    else if (slash.kind === 'about') { this.panelOrigin = undefined; this.openAbout(); }
    else if (slash.kind === 'find') this.findCommand(command, slash.arguments);
    else if (slash.kind === 'open') {
      if (slash.target) await this.openLocation(command, slash.target, this.shellCwd);
      else { this.panelOrigin = undefined; this.openPanel = {references: this.recentReferences(), selected: 0, editor: this.hostActions().label}; }
    }
    else if (slash.kind === 'openDiff') await this.openDiff(command, slash.left, slash.right);
    else if (slash.kind === 'filter') this.applyFilterCommand(command, slash.arguments);
    else if (slash.kind === 'shell') {
      if (slash.shell) await this.switchShell(slash.shell, command);
      else this.openShellPanel();
    }
    else if (slash.kind === 'notices') await this.runNoticesCommand(command, slash.action);
    else if (slash.kind === 'history') {
      if (command.startsWith(HISTORY_SEARCH)) this.submitHistorySearch(slash.query, true);
      else await this.openHistoryPicker(slash.query);
    }
    else if (slash.kind === 'directories') {
      if (command.startsWith(DIRECTORY_SEARCH)) {
        const selected = this.directoryMatches(slash.query)[this.selectedSuggestion];
        this.applySuggestion({insertion: selected?.insertion ?? `${DIRECTORY_SEARCH}${slash.query}`});
      } else await this.openDirectoryPicker(slash.query);
    }
    else if (slash.kind === 'palette') this.openPalette();
    else if (slash.kind === 'ask') this.openAsk(slash.request);
    else if (slash.kind === 'providers') this.openProvidersOverview();
    else if (slash.kind === 'llm') this.openUnderstandingPanel();
    else this.output.addFrontendInteraction(command, `Unknown NMSh command: ${(slash as any).input || command}`, ERROR);
  }

  private openPalette(): void {
    if (this.settingsPanelActive) return;
    const record = this.focusedCommandIndex === undefined ? this.output.recent(1) : this.output.recent(this.focusedCommandIndex + 1);
    this.paletteState = createPalette([...paletteItems(), ...(record ? blockPaletteItems(record) : [])]);
  }

  private clearBlockFocus(): void {
    this.focusedCommandIndex = undefined;
    this.focusedLineIndex = undefined;
    this.focusedActivityId = undefined;
  }

  private openBlockPalette(startId: number): void {
    if (this.running || this.settingsPanelActive) return;
    const record = this.output.view().completed.find(item => item.startId === startId);
    if (record) this.paletteState = createPalette(blockPaletteItems(record));
  }

  private async runBlockAction(startId: number, action: BlockActionId): Promise<void> {
    if (this.running || this.stopped) return;
    const records = this.output.view().completed;
    const index = records.findIndex(item => item.startId === startId);
    const record = records[index];
    if (!record) return; // A clear/restore must never act on stale screen coordinates.
    const payload = blockCopyPayload(record, action);
    if (payload !== undefined) {
      try { await writeClipboard(payload); }
      catch (error) { this.output.addFrontendInteraction('/copy', clipboardFailure(error), ERROR); }
    } else if (action === 'fold') this.output.toggleExpanded(index);
    else if (action === 'edit' || action === 'rerun') {
      this.clearBlockFocus();
      this.editor.clear();
      this.editor.insert(record.command);
      this.historyViewport.latest();
      // A real stored shell command must never become an NMSh slash dispatch.
      if (action === 'rerun' && !parseSlashCommand(record.command)) await this.submit();
    }
  }

  /** Executes only the declared NMSh action of the chosen entry. */
  private async runPaletteItem(item: PaletteItem): Promise<void> {
    this.paletteRecent = [item.id, ...this.paletteRecent.filter(id => id !== item.id)].slice(0, 20);
    const action = item.action;
    const config = structuredClone(this.promptConfiguration);
    switch (action.kind) {
      case 'block':
        await this.runBlockAction(action.startId, action.id);
        break;
      case 'slash': {
        const slash = parseSlashCommand(action.command);
        if (slash) await this.runSlash(action.command, slash);
        break;
      }
      case 'open': {
        this.openSettingsPanel('settings');
        const index = SETTINGS_ENTRIES.findIndex(entry => entry.control === 'child' && entry.destination === action.destination);
        this.openSettingsDestination(action.destination, 'settings', Math.max(0, index), this.settingsPanelState!);
        break;
      }
      case 'config':
        this.focusConfigRow(action.rowId);
        break;
      case 'toggleComposerPosition':
        config.composerPosition = ({bottom: 'top', top: 'flow', flow: 'bottom'} as const)[config.composerPosition];
        this.applySettingsConfiguration(config);
        break;
      case 'toggleTranscriptPresentation':
        config.transcriptPresentation = config.transcriptPresentation === 'chat' ? 'normal' : 'chat';
        this.applySettingsConfiguration(config);
        break;
      case 'cycleOutputFolding':
        config.outputFolding = OUTPUT_FOLDING_MODES[(OUTPUT_FOLDING_MODES.indexOf(config.outputFolding) + 1) % OUTPUT_FOLDING_MODES.length]!;
        this.applySettingsConfiguration(config);
        break;
      case 'theme':
        config.nmsh.palette = action.palette;
        this.applySettingsConfiguration(config);
        break;
      case 'latest':
        this.historyViewport.latest();
        break;
      case 'toggleInspector':
        this.inspectorVisible = !this.inspectorVisible;
        break;
      case 'toggleDetails':
        this.output.toggleMostRelevant();
        break;
    }
  }

  private async submit(realShell = false, skipInstallCheck = false): Promise<void> {
    this.clearCorrection();
    const command = this.editor.text;
    const slash = realShell ? undefined : parseSlashCommand(command);
    if (!slash && !skipInstallCheck && !this.startupPending && installCandidate(command, this.promptConfiguration)) {
      // Real zsh resolution decides first; the composer keeps the text while it is asked.
      this.preparingCommand = true;
      let offered = false;
      try { offered = await this.offerInstallFor(command); } finally { this.preparingCommand = false; }
      if (this.stopped) return;
      if (offered) { this.render(); return; }
      if (this.editor.text !== command) return;
    }
    this.editor.clear();
    this.composerHistory.reset();
    if (!command.trim()) return;
    // Valid NMSh commands are recalled with the session; unknown slash input runs as typed and follows shell history.
    // With Ask recording off, the request text is not kept for recall either.
    if (!(slash?.kind === 'ask' && !this.promptConfiguration.askRecord)) this.sessionSubmissions.push({text: command, slash: Boolean(slash && slash.kind !== 'unknown')});
    if (this.sessionSubmissions.length > SESSION_SUBMISSION_LIMIT) this.sessionSubmissions.shift();

    if (slash) {
      await this.runSlash(command, slash);
      this.render();
      return;
    }

    const contextAtSubmission = this.context;
    this.effects.cancel();
    this.commandModes.reset();
    const startId = this.output.beginCommand(command, this.formatCommandAnsi(command, null), (mode) => {
      if (mode === 'PASSTHROUGH' && !this.passthrough && !this.startupPending) {
        this.cancelPresentation();
        this.passthrough = true;
        this.terminalFocus = 'unknown';
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
    this.running = {command, startedAt, interrupted: false, cleared: false, startId, cwd: this.shellCwd, awaitingExec: true};
    void this.journal?.flush().catch(() => {
      this.output.addFrontendInteraction('/resume', 'Could not persist the submitted command.', ERROR);
    });
    this.activityAnimationNow = startedAt;

    // Initial static heuristic, but dynamic can override
    this.passthrough = !this.startupPending && shouldPassthrough(command);
    if (this.passthrough) {
      this.terminalFocus = 'unknown';
      this.renderer.suspendForPassthrough();
      const dimensions = this.dimensions();
      this.session.resize(dimensions.columns, dimensions.rows);
    }
    if (command.includes('\n')) {
      this.session.submit(`{ ${command}\n}`);
    } else {
      this.session.submit(command);
    }
    // After the command is on its way: one sweep acknowledging the submission (never delays it).
    if (!this.passthrough) this.startSweep('prompt', 'vivid');
    this.render();
  }

  private async saveAppearance(): Promise<void> {
    if (!this.appearanceState) return;
    const state = this.appearanceState;
    this.appearanceState = undefined;

    this.output.addHistoryLine(`${INFO}✻ Saving appearance settings...${RESET}`);
    this.render();

    const result = await this.host.integration!.saveAppearance({
      opacity: state.opacity,
      blurMode: BLUR_MODES[state.blurModeIndex],
      blurStrength: state.blurStrength
    });

    if (result.success) {
      this.output.addHistoryLine(`${SUCCESS}✻ Saved to ${result.fragmentPath}${RESET}`);
      this.output.addHistoryLine(`${INFO}✻ Host config updated: ${result.hostPath}${RESET}`);
      if (state.opacity < 1) {
        this.output.addHistoryLine(`${INFO}✻ ${this.host.integration!.appearanceRestart}${RESET}`);
      }
    } else {
      this.output.addHistoryLine(`${ERROR}✻ Failed to save appearance${RESET}`);
      this.output.addHistoryLine(`  ⎿ ${result.error}`);
    }
    this.render();
  }

  private async startKeyboard(): Promise<void> {
    if (!this.host.capabilities.hostConfiguration || !this.host.integration) {
      this.output.addFrontendInteraction('/keyboard', this.host.keyboardGuidance ?? 'Ctrl+J inserts a newline; Ctrl+W deletes a word.', INFO);
      this.render();
      return;
    }
    this.keyboardState = { selectedIndex: 0 };
    this.render();
  }


  private async saveKeyboard(): Promise<void> {
    if (!this.keyboardState) return;
    this.keyboardState = undefined;

    this.output.addHistoryLine(`${INFO}✻ Installing ${this.host.name} keyboard bindings...${RESET}`);
    this.render();

    const result = await this.host.integration!.installKeyboard();

    if (result.success) {
      this.output.addHistoryLine(`${SUCCESS}✻ Installed keyboard bindings in ${this.host.name} config${RESET}`);
      this.output.addHistoryLine(`${INFO}✻ ${this.host.integration!.keyboardReload}${RESET}`);
    } else {
      this.output.addHistoryLine(`${ERROR}✻ Failed to install binding${RESET}`);
      this.output.addHistoryLine(`  ⎿ ${result.error}`);
    }
    this.render();
  }

  private async startAppearance(): Promise<void> {
    if (!this.host.capabilities.appearanceIntegration || !this.host.integration) {
      this.output.addFrontendInteraction('/appearance', `Host: ${this.host.name}\n${this.host.appearanceGuidance ?? 'Window opacity and blur are controlled by the host.'}`, INFO);
      this.returnFromPanel();
      this.render();
      return;
    }
    const settings = await this.host.integration.readAppearance();
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
    const record = this.output.recentShell(index);
    if (!record) {
      this.output.addFrontendInteraction(command, `No completed command output at /copy ${index}`, ERROR);
      return;
    }
    try {
      const payload = serializeCopyPayload(record);
      await writeClipboard(payload);
      this.output.addFrontendInteraction(command, copyFeedback(copyStats(payload), index), INFO);
    } catch (error) {
      this.output.addFrontendInteraction(command, clipboardFailure(error), ERROR);
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

  /**
   * Archive the current presentation (it stays available in /resume) and
   * start a fresh one with a new welcome. Used by /clear and /shell.
   */
  private async startFreshPresentation(command = '/clear'): Promise<boolean> {
    if (this.running) {
      this.output.addFrontendInteraction(command, 'Wait for the foreground command to finish before clearing the transcript.', INFO);
      return false;
    }
    try { await this.archiveCurrentPresentation(); } catch {
      this.output.addFrontendInteraction(command, 'Could not archive this transcript; the current view was kept.', ERROR);
      return false;
    }
    this.output.clearPresentation();
    this.presentationStartCwd = this.shellCwd;
    this.startWelcome(this.presentationStartCwd);
    this.historyViewport.latest();
    try { await this.journal?.start(); this.journalActive = Boolean(this.journal); } catch {
      this.journalActive = false;
      this.output.addFrontendInteraction(command, 'A fresh view started, but its journal could not be persisted yet.', ERROR);
    }
    return true;
  }

  /** Session id the launcher should attach after this frontend detaches. */
  switchTarget?: string;
  private detaching = false;

  /**
   * LIVE rows attach: this frontend detaches its own session (it keeps
   * running) and the launcher reattaches the selected one.
   */
  private switchToLiveSession(sessionId: string, state: 'attached' | 'detached'): void {
    if (state === 'attached') {
      this.resumeBrowser = undefined;
      this.output.addFrontendInteraction('/resume', 'That session is attached in another NMSh window; it was not taken over.', INFO);
      return;
    }
    this.switchTarget = sessionId;
    this.detaching = true;
    this.session.detach();
    this.stop(0);
  }

  private async killSelectedLiveSession(): Promise<void> {
    const browser = this.resumeBrowser;
    const target = browser?.live.find(session => session.id === browser.confirmKill);
    if (!browser || !target) return;
    browser.confirmKill = undefined;
    try {
      await killAndArchive(target, {store: this.transcriptStore});
      browser.live = browser.live.filter(session => session.id !== target.id);
      browser.selectedIndex = Math.min(browser.selectedIndex, Math.max(0, resumeRowCount(browser) - 1));
      this.output.addFrontendInteraction('/resume', `Killed the session in ${target.cwd}; its transcript was archived.`, INFO);
    } catch (error) {
      this.output.addFrontendInteraction('/resume', `Could not kill that session: ${error instanceof Error ? error.message : String(error)}.`, ERROR);
    }
    this.render();
  }

  /** /sessions: live sessions right now, through the same browser /resume uses (live-only mode). */
  private async openSessionsView(): Promise<void> {
    if (this.sessionMode !== 'service') {
      this.output.addFrontendInteraction('/sessions', 'This window runs its shell in-process (no session service), so it is the only live session it can see. /resume lists archived transcripts.', INFO);
      return;
    }
    let live: SessionInfo[] = [];
    try { live = await listLiveSessions(); } catch {
      this.output.addFrontendInteraction('/sessions', 'The session service did not answer; try again.', ERROR);
      return;
    }
    this.panelOrigin = undefined;
    this.resumeBrowser = createSessionsView(live, this.sessionId);
  }

  private sessionsViewRows(browser: ResumeBrowserState, columns: number): string[] {
    const now = Date.now();
    const safe = getCurrentGlyphMode() === 'safe';
    const visible = visibleLiveSessions(browser);
    const rows = liveSessionRows(visible, browser.currentId, now);
    const out = [`${PRIMARY}  Sessions${RESET}  ${SUBTLE}live now · archived transcripts are in /resume${RESET}`, ''];
    if (browser.query) out.push(`${SECONDARY}  Search: ${browser.query}${RESET}`, '');
    if (!rows.length) out.push(`  ${SUBTLE}No live NMSh sessions${browser.query ? ' match' : ''}.${RESET}`);
    rows.forEach((row, index) => {
      const selected = index === browser.selectedIndex;
      const marker = row.current ? (safe ? '*' : '●') : row.session.state === 'detached' ? (safe ? '-' : '◌') : (safe ? 'o' : '○');
      const color = row.state === 'failed' ? ERROR : row.state === 'attention' ? ACCENT : row.state === 'completed' ? SUCCESS : SECONDARY;
      const who = row.agent ? `${agentColor(row.agent.color)}${safe ? row.agent.safeGlyph : row.agent.glyph} ${row.agent.short}${RESET} ` : '';
      out.push(truncateAnsi(`${selected ? `${ACCENT}›` : ' '} ${marker} ${PRIMARY}${(row.current ? 'this' : `#${row.ordinal}`).padEnd(5)}${RESET}${SECONDARY}${row.shell.padEnd(5)}${RESET} `
        + `${color}${row.stateLabel.padEnd(16)}${RESET}${who}${selected ? PRIMARY : SECONDARY}${row.summary}${RESET}`, columns));
    });
    const confirming = browser.live.find(session => session.id === browser.confirmKill);
    if (confirming) out.push('', truncateAnsi(`${ERROR}  Kill the live session in ${confirming.cwd}? Its shell and anything running in it will end. Enter kill · Esc cancel${RESET}`, columns));
    else out.push('', `${SUBTLE}  ↑↓ move · type to search · Enter switch to a detached session · Ctrl+K kill a detached session · Tab agent sessions · Esc close${RESET}`);
    // Agent sessions share this switcher: a compact section here, the full list (and their views) one Tab away.
    if (this.agents.sessions.length) {
      out.push('', `${PRIMARY}  Agent sessions${RESET}  ${SUBTLE}Tab opens them${RESET}`);
      for (const session of shelfOrder(this.agents.sessions).slice(0, 6)) out.push(truncateAnsi(`    ${renderShelf([session], columns - 4, now)}${SUBTLE} · ${session.level === 'observed' ? 'observed only' : session.level}${RESET}`, columns));
    }
    return out;
  }

  private async openResumePicker(): Promise<void> {
    try {
      // Anything that ended while no window watched is archived before listing.
      if (this.sessionMode === 'service') {
        try { await recoverEndedSessions(defaultRuntimeDir(), this.transcriptStore); } catch { /* best effort */ }
      }
      const sessions = (await this.transcriptStore.listSummaries()).filter(session => session.id !== this.journal?.id);
      // LIVE comes from the service itself, so a dead shell is never listed as live.
      let live: SessionInfo[] = [];
      if (this.sessionMode === 'service') {
        try { live = (await listLiveSessions()).filter(session => session.id !== this.sessionId); } catch { /* service unreachable: archives only */ }
      }
      if (sessions.length === 0 && live.length === 0) {
        this.output.addFrontendInteraction('/resume', 'No live sessions or archived NMSh transcripts were found.', INFO);
        return;
      }
      const liveJournals = new Set(live.flatMap(session => session.journalId ? [session.journalId] : []));
      const browser = createResumeBrowser(sessions, live, liveJournals);
      this.resumeBrowser = browser;
      void this.indexResumeCommands(browser);
    } catch {
      this.output.addFrontendInteraction('/resume', 'Could not read local transcript archives.', ERROR);
    }
  }

  private async resumeSelectedSession(): Promise<void> {
    const browser = this.resumeBrowser;
    if (!browser) return;
    const selection = resumeSelection(browser);
    if (selection?.kind !== 'archived') return;
    await this.restoreTranscriptById(selection.session.id);
  }

  /** Restore one archived transcript into this window (the current view is archived first). Shared by /resume and Ask. */
  private async restoreTranscriptById(id: string): Promise<void> {
    let restored: TranscriptSession;
    try {
      restored = await this.transcriptStore.load(id);
      const current = this.output.transcript();
      if (current.welcome || current.records.length > 0 || current.lines.length > 0) await this.archiveCurrentPresentation();
    } catch {
      this.output.addFrontendInteraction('/resume', 'Could not restore the selected transcript; the current view was kept.', ERROR);
      this.resumeBrowser = undefined;
      return;
    }
    this.output.restoreTranscript(restored.transcript);
    this.welcomeGeneration += 1;
    this.presentationStartCwd = restored.startCwd;
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


  /** Opt-in background discovery: one quiet line per newly seen release, never an interruption. */
  private async quietUpdateCheck(): Promise<void> {
    const release = await backgroundUpdateCheck(this.buildIdentity.version, this.promptConfiguration.updateChecks).catch(() => undefined);
    if (!release || this.stopped) return;
    this.output.addHistoryLine(`${INFO}NMSh ${release.version} is available (you have ${this.buildIdentity.version}) · /update${RESET}`);
    this.render();
  }

  /**
   * `/update` checks and shows the plan; `/update apply` installs only the
   * release the last `/update` offered. Both re-verify everything first.
   */
  private async runUpdateCommand(command: string, apply: boolean): Promise<void> {
    const reply = (text: string, style = INFO) => { this.output.addFrontendInteraction(command, text, style); this.render(); };
    if (this.updateInProgress) return reply('An update check is already running.');
    this.updateInProgress = true;
    try {
      const current = this.buildIdentity.version;
      let release: ReleaseInfo;
      try {
        release = await fetchLatestRelease();
      } catch (error) {
        return reply(`Could not check for updates: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`, ERROR);
      }
      if (compareVersions(release.version, current) <= 0) return reply(`NMSh ${current} is up to date (latest release ${release.tag}).`, SUCCESS);
      const header = [`NMSh ${current} → ${release.version} is available.`, ...release.summary.map(line => `  ${line}`), release.url];
      const planned = await planUpdate(await detectInstall(installRoot()), release);
      if (!planned.ok) {
        return reply([...header, '', `NMSh will not update this installation automatically: ${planned.reason}`,
          'To update it yourself:', ...planned.manual.map(line => `  ${line}`)].join('\n'));
      }
      if (!apply || this.offeredUpdate !== release.version) {
        this.offeredUpdate = release.version;
        return reply([...header, '', 'Plan:', ...planned.plan.steps.map(line => `  • ${line}`), '',
          'Run /update apply to install it. Your settings, transcripts, and shell profile are not touched.'].join('\n'));
      }
      reply(`Updating to ${release.version}…`);
      const result = await applyUpdate(planned.plan, systemRunner, line => {
        this.output.addHistoryLine(`${SECONDARY}  ${line}${RESET}`);
        this.render();
      });
      this.offeredUpdate = undefined;
      if (result.ok) this.milestoneEffect();
      this.output.addHistoryLine(result.ok
        ? `${SUCCESS}NMSh ${release.version} is installed. Restart NMSh to use it; this session keeps running ${current}.${RESET}`
        : `${ERROR}The update did not complete; the lines above say what happened.${RESET}`);
    } finally {
      this.updateInProgress = false;
      this.render();
    }
  }

  private showHelp(command: string): void {
    const helpText = renderMarkdownText(helpMarkdown(), {columns: Math.max(20, this.dimensions().columns - 6),
      hyperlinks: false}); // the transcript cell model has no OSC 8 support
    this.output.addFrontendInteraction(command, helpText, INFO);
  }

  private onInputRejected(data: string, submission: boolean): void {
    if (submission && this.running?.awaitingExec) {
      const command = this.running.command;
      this.output.complete(1);
      this.running = undefined;
      if (!this.editor.text) this.editor.insert(command);
    } else {
      const input = data.replace(/\r$/u, '');
      if (!this.editor.text) this.editor.insert(input);
      else this.output.addFrontendInteraction('rejected input', input, ERROR);
    }
    this.output.addFrontendInteraction('session', 'Input was not sent: shell startup queue exceeds 64 KiB. Rejected input is retained. Wait for readiness, then submit again.', ERROR);
    this.render();
  }

  private onShellData(data: string): void {
    // New output is activity: it ends idle visuals and restarts the inactivity timer.
    this.noteActivity();
    if (this.passthrough) {
      this.renderer.observePassthrough(data);
      process.stdout.write(data);
    } else {
      this.commandModes.observeModes(data);
      this.lastOutputTime = Date.now();
      const wasPassthrough = this.passthrough;
      this.output.write(data);
      this.journal?.schedule();
      this.output.setActiveActivities(this.tapActivityObserver.push(data, Date.now()));
      if (!wasPassthrough && this.passthrough) {
        this.renderer.observePassthrough(data);
        process.stdout.write(data);
      } else if (!this.replaying) {
        this.render();
      }
    }
  }

  private onShellPrompt(exitCode: number, cwd: string, at = Date.now()): void {
    this.completionService.invalidate();
    this.shellSuggestions = [];
    this.lastSuggestionInput = '';
    this.shellCwd = cwd;
    this.endStartupWatch();
    this.switchedShellStarting = false;
    const initialPrompt = !this.presetShellReady;
    this.presetShellReady = true;
    this.context.exitStatus = exitCode;
    // A slow global/user bootstrap may finish after the frontend submits.
    // Its initial prompt is readiness, not completion of that queued command.
    if (initialPrompt && this.running?.awaitingExec) {
      void this.refreshContext(cwd);
      this.render();
      return;
    }
    if (!this.running) {
      void this.refreshContext(cwd);
      this.render();
      this.advancePresetStartup(exitCode, cwd);
      return;
    }

    const command = this.running;
    // Program identity only (the command's program word); never the agent's prompt or output.
    const agent = detectAgentCommand(command.command);
    if (agent && this.promptConfiguration.agentActivity && !command.cleared) {
      const interrupted = command.interrupted || exitCode === 130;
      try {
        this.agentActivity.record({agent: agent.id, startedAt: command.startedAt, durationMs: Math.max(0, at - command.startedAt),
          ...(interrupted ? {} : {exitCode})}, `${this.sessionId ?? this.journal?.id ?? 'local'}:${command.startedAt}`);
      } catch { /* local stats are best effort and never affect the command */ }
    }
    const notification = {command: command.command, elapsedMs: Math.max(0, at - command.startedAt), exitCode,
      interrupted: command.interrupted || exitCode === 130};
    if (!this.replaying && shouldNotify(notification, this.promptConfiguration.notifications, this.terminalFocus)) {
      // Delivery failures must never affect completion, transcript or journal.
      try { void this.notificationService.notify(formatCommandNotification(notification)).catch(() => {}); } catch { /* best effort */ }
    }
    if (this.replaying) this.replayedCompletions += 1;
    const completedAt = new Date(at);
    const elapsed = completedAt.getTime() - command.startedAt;
    this.output.setActiveActivities(this.tapActivityObserver.finish(completedAt.getTime()));
    const completedRecord = this.output.complete(exitCode);
    if (completedRecord) {
      completedRecord.startedAt = command.startedAt;
      completedRecord.durationMs = Math.max(0, elapsed);
      completedRecord.historyEligible = command.historyAllowed === 1 && !isPrivateCommand(command.command, ignorePatternFromEnv());
      this.directoryQuery = undefined;
      this.directoryQueryAbort?.abort();
      this.historyService.record(completedRecord, this.journal?.id ?? this.sessionId ?? 'current');
      this.historyQuery = undefined;
      if (!this.replaying) void this.adviseFolding(completedRecord);
    }
    this.suggestions.record({command: command.command, cwd: command.cwd, exitCode, at: command.startedAt, previous: this.submittedCommands[0]});
    this.submittedCommands.unshift(command.command);
    if (this.submittedCommands.length > 50) this.submittedCommands.length = 50;
    if (!command.cleared) {
      const outputText = completedRecord?.output ?? '';
      const facts = extractFacts(command.command, outputText);
      const isInterrupted = command.interrupted || exitCode === 130;
      const displayCompletedAt = presentationCompletionTime(completedAt);
      const parts = completedActivity(command.command, elapsed, displayCompletedAt, isInterrupted ? 0 : exitCode, isInterrupted, facts);
      const failure = isInterrupted ? undefined : classifyShellFailure(command.command, exitCode, outputText);
      if (failure) parts.main = parts.main.replace('Command failed', failure === 'command-not-found' ? 'Command not found' : 'Shell syntax error');
      else if (agent) parts.main = agentCompletionText(agent.id, elapsed, exitCode, isInterrupted);
      this.output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
      const rowStyle = isInterrupted ? STOPPED : (exitCode !== 0 ? ERROR : SUCCESS);
      this.output.addHistoryLine(`${rowStyle}${parts.main}${SECONDARY}${parts.detail}${RESET}`);
    }
    this.running = undefined;
    if (!this.replaying && !command.interrupted && !command.cleared) void this.suggestCorrection(command.command, exitCode, completedRecord?.output ?? '').catch(() => {});
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
    this.advancePresetStartup(exitCode, cwd);
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
    // Read live, so the current-shell module follows /shell and the default-shell setting immediately.
    const shell = {current: this.shellId, differs: this.shellId !== this.promptConfiguration.shellBackend};
    return {...this.context, commandWords: words, shell, ...(kubeContext ? {kubeContext} : {}), ...(dockerContext ? {dockerContext} : {})};
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
      const saved = structuredClone(this.promptConfiguration);
      this.promptConfiguration.provider = 'nmsh';
      try { savePromptConfiguration(this.promptConfiguration, undefined, saved); } catch { /* Runtime fallback remains in effect. */ }
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

  /** /chroma: the /prompt Chroma view directly, editing the same presentation settings. */
  private startChromaSettings(): void {
    this.promptPanelState = {onboarding: false, step: 'appearance', view: 'chroma', selectedIndex: 0,
      draft: structuredClone(this.promptConfiguration), saved: structuredClone(this.promptConfiguration)};
    this.panelExternalPrompt = undefined;
    this.render();
  }

  /**
   * A brief, restrained effect for a real milestone (a confirmed install,
   * an applied update, finished setup). Respects Milestone effects, Reduced
   * Motion and Effects Off; never during a command, passthrough or panel.
   */
  private milestoneEffect(): boolean {
    const presentation = this.promptConfiguration.presentation;
    if (presentation.autoEffects === false || presentation.effectsOff || presentation.reducedMotion || isReducedMotion()) return false;
    // Panels own the screen and leave no decorative gap: celebrate once the panel closes.
    if (this.settingsPanelActive || this.running || this.passthrough || this.externalPassthrough || this.frontendSuspended) {
      this.pendingMilestone = true;
      return false;
    }
    this.pendingMilestone = false;
    return this.effects.trigger('confetti', 'bottom', Date.now(), Date.now() >>> 0, presentation);
  }

  private async runPowerlevel10kWizard(status: Powerlevel10kStatus): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The Powerlevel10k wizard requires a real terminal.');
    if (this.running || this.passthrough || this.externalPassthrough) throw new Error('The terminal is busy.');
    const ignoreInterrupt = (): void => { /* The foreground wizard handles Ctrl+C. */ };
    this.cancelPresentation();
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
      this.terminalFocus = 'unknown';
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
        const hasHomebrew = resolveCommand('brew') !== undefined;
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
        state.task = new TaskProgress('Installing Starship with Homebrew', () => this.renderTaskPresentation(), Date.now(), 'Starship');
        this.render();
        const outcome = await state.task.run('brew', ['install', 'starship']);
        if (this.stopped) return;
        if (outcome.status === 'succeeded') {
          this.starshipStatus = await detectStarship(process.env);
          state.starshipStatus = this.starshipStatus;
          if (!this.starshipStatus.installed) state.task.markFailure('Homebrew completed, but starship was not found on PATH.');
          else { recordInstall('starship', {label: 'brew install starship', command: 'brew', args: ['install', 'starship']}); this.milestoneEffect(); }
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
    } else if (onGradientRow(state)) {
      openGradientEditor(state);
    } else if (state.step === 'modules') {
      state.step = 'appearance';
      state.selectedIndex = appearanceModulesRow(state.draft);
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
      savePromptConfiguration(state.draft, undefined, this.promptConfiguration);
      this.promptConfiguration = structuredClone(state.draft);
      this.promptPanelState = undefined;
      if (state.onboarding && !this.promptConfiguration.toolsSetupComplete) this.startTools(true);
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
    // Configuring layout, appearance, or modules uses the deterministic
    // showcase so every module type is visible; other steps show the live prompt.
    const context = state.step === 'modules' || state.step === 'appearance' || state.step === 'layout'
      ? moduleShowcaseContext() : this.promptContext();
    let providerRow: string;
    if (previewConfig.provider !== 'nmsh') {
      const preview = this.panelExternalPrompt?.provider === previewConfig.provider ? this.panelExternalPrompt.result : undefined;
      if (!preview) return [this.externalPanelStatusText(state, previewConfig.provider, width)];
      providerRow = this.externalPromptRow(preview, width, previewConfig.composerLayout === 'oneLine' ? 'composer' : previewConfig.placement);
    } else if (previewConfig.composerLayout === 'oneLine') {
      const line = `${buildInlineContextPrefix(context, width, previewConfig)}command`;
      const right = buildRightContext(context, width - displayWidth(line) - 2, previewConfig);
      return [boundary, right ? `${line}${RESET}${' '.repeat(width - displayWidth(line) - displayWidth(right))}${right}${RESET}` : line, boundary];
    } else {
      providerRow = buildContextLine(context, width, previewConfig, previewConfig.placement);
    }
    if (previewConfig.composerLayout === 'oneLine') {
      const prefix = previewConfig.provider !== 'nmsh'
        ? `${providerRow}${RESET} `
        : buildInlineContextPrefix(context, width, previewConfig);
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
    return Boolean(this.stopsEditor || this.chromeEditor || this.screensaverPanel || this.themeStudio || this.setupState || this.installPrompt || this.presetPanel || this.toolsPanel || this.toolConfigurationLoading || this.toolConfiguration || this.promptPanelState || this.transcriptPanelState || this.providerPanelState || this.paletteState || this.syntaxPanelState || this.layoutPanelState || this.settingsPanelState
      || this.resumeBrowser || this.appearanceState || this.keyboardState || this.startupPanel || this.aboutPanel || this.shellPanel || this.openPanel || this.askState || this.agentView || this.agentPanel || this.providersOverview || this.understandingPanel || this.cursorPanel);
  }

  /** Complex panels declare the smallest size that shows their essential controls. */
  private panelMinimum(): MinimumSize | undefined {
    if (this.setupState) return SETUP_MIN_SIZE;
    if (this.themeStudio) return STUDIO_MIN_SIZE;
    if (this.screensaverPanel) return SCREENSAVER_MIN_SIZE;
    if (this.chromeEditor || this.stopsEditor) return CHROME_EDITOR_MIN_SIZE;
    return undefined;
  }

  private settingsPanelRows(columns: number): string[] {
    const minimum = this.panelMinimum();
    const {rows} = this.dimensions();
    if (minimum && !fits(minimum, columns, rows)) return renderTooSmall(minimum, columns, rows);
    return this.panelContentRows(columns);
  }

  private panelContentRows(columns: number): string[] {
    if (this.startupPanel) return framePanel(renderStartupPanel({tail: this.startupPanel.tail, elapsedMs: Date.now() - this.startupPanel.since}, columns, this.dimensions().rows), columns);
    if (this.toolConfigurationLoading) return framePanel(['  Reading supported configuration...', '  Esc cancel'], columns);
    if (this.toolConfiguration) return renderConfigurationPanel(this.toolConfiguration, columns, this.dimensions().rows);
    if (this.presetPanel) return renderPresetPanel(this.presetPanel, columns, this.dimensions().rows);
    if (this.misePanel) return renderMisePanel(this.misePanel, columns, this.dimensions().rows);
    if (this.installPrompt) return renderInstallPrompt(this.installPrompt, columns);
    if (this.themeStudio) return this.renderThemeStudioRows(this.themeStudio, columns);
    if (this.screensaverPanel) return this.renderScreensaverRows(this.screensaverPanel, columns);
    if (this.stopsEditor) return this.renderStopsEditor(this.stopsEditor, columns);
    if (this.chromeEditor) return renderChromeEditor(this.chromeEditor, columns, this.dimensions().rows, colorLevel());
    if (this.setupState) {
      const state = this.setupState;
      if (!state.toolBrowser) state.context.preview = this.withDraftTheme(state.draft, () => this.setupPreview(state, columns));
      state.context.title = this.setupTitle(state);
      return this.withDraftTheme(state.draft, () => renderSetup(state, columns, this.dimensions().rows));
    }
    if (this.toolsPanel) return renderTools(this.toolsPanel, columns, this.dimensions().rows);
    if (this.settingsPanelState) {
      return renderSettingsPanel(this.settingsPanelState, columns, this.dimensions().rows, {configuration: this.promptConfiguration,
        status: settingsView(this.settingsPanelState) === 'status' ? this.statusSections() : undefined});
    }
    if (this.layoutPanelState) {
      return framePanel(renderLayoutPanel(this.layoutPanelState, columns, this.dimensions().rows - 4), columns);
    }
    if (this.syntaxPanelState) {
      return framePanel(renderSyntaxPanel(this.syntaxPanelState, columns, this.promptConfiguration.nmsh.palette, this.dimensions().rows - 4), columns);
    }
    if (this.paletteState) {
      return framePanel(renderPalette(this.paletteState, columns, Math.min(18, this.dimensions().rows - 4), this.paletteRecent), columns);
    }
    if (this.providerPanelState) {
      return framePanel(renderProviderPanel(this.providerPanelState, columns, this.providerPreview(this.providerPanelState, columns - 2),
        this.dimensions().rows - 4), columns);
    }
    if (this.transcriptPanelState) {
      return framePanel(renderTranscriptPanel(this.transcriptPanelState, columns, this.transcriptPreviewSample(), this.dimensions().rows - 4, this.promptConfiguration.presentation), columns);
    }
    if (this.aboutPanel) return framePanel(this.aboutRows(columns), columns);
    if (this.openPanel) return framePanel(renderOpenPanel(this.openPanel, columns, this.dimensions().rows - 4), columns);
    if (this.agentView) {
      const session = this.agents.get(this.agentView.sessionId);
      if (session) return framePanel(renderAgentView(session, this.agentView, columns, this.dimensions().rows - 4, Date.now()), columns);
    }
    if (this.agentPanel) return framePanel(renderAgentPanel(this.agentPanel, this.agentPanelRows(), columns, Date.now(), this.dimensions().rows - 4), columns);
    if (this.askState) {
      const activity = this.askActivityLine();
      return framePanel(renderAsk(this.askState, columns, {presentation: this.promptConfiguration.askPresentation, height: this.dimensions().rows - 4, shell: this.shellId, ...(activity ? {activity} : {})}), columns);
    }
    if (this.cursorPanel) {
      const still = !this.decorativeMotionAllowed() || colorLevel() === 'none';
      return framePanel(renderCursorPanel(this.cursorPanel, columns, Date.now(), chooseBackend(this.cursorPanel.draft, this.cursorHost ?? hostCursorFacts(process.env, host => nativeCursorIntegrated(host))), still), columns);
    }
    if (this.understandingPanel) return framePanel(renderUnderstandingPanel(this.understandingPanel, this.understandingFacts(), columns), columns);
    if (this.providersOverview) return framePanel(renderProvidersOverview(this.providersOverview, this.providersOverviewFacts(), columns), columns);
    if (this.shellPanel) return framePanel(renderShellPanel(this.shellPanel, columns), columns);
    if (this.resumeBrowser?.liveOnly) return framePanel(this.sessionsViewRows(this.resumeBrowser, columns), columns);
    if (this.resumeBrowser) {
      const browser = this.resumeBrowser;
      const sessions = visibleResumeSessions(browser);
      const canMove = (unit: 'week' | 'month', direction: -1 | 1) =>
        navigateResume({...browser}, unit, direction);
      const week = new Date(browser.week).toLocaleDateString();
      const live = visibleLiveSessions(browser);
      const rows = [`${PRIMARY}  Resume session${RESET}`,
        `${SECONDARY}  Search: ${browser.query || '_'}${browser.indexing ? `  ${SUBTLE}(indexing commands…)${SECONDARY}` : ''}${RESET}`, ''];
      if (live.length > 0) {
        const now = Date.now();
        rows.push(`${SUBTLE}  LIVE${RESET}`);
        const safe = getCurrentGlyphMode() === 'safe';
        live.forEach((session, index) => {
          const selected = index === browser.selectedIndex;
          const state = liveRowState(session, now);
          const stateColor = state === 'failed' ? ERROR : state === 'attention' ? ACCENT : state === 'completed' ? SUCCESS : state === 'active' ? PRIMARY : SECONDARY;
          const agent = liveRowAgent(session);
          // Agent color only when identity is proven and color is allowed; generic otherwise.
          const who = agent ? `${agentColor(agent.color)}${safe ? agent.safeGlyph : agent.glyph} ${agent.short}${RESET} ` : '';
          rows.push(truncateAnsi(`${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${stateColor}${(safe ? '*' : '●')} ${LIVE_ROW_LABELS[state].padEnd(16)}${RESET}${who}`
            + `${selected ? ACCENT : SECONDARY}${describeLiveRow(session, now)}${RESET}`, columns));
        });
        rows.push('', `${SUBTLE}  ARCHIVED${RESET}`);
      }
      rows.push(`${SUBTLE}  Week of ${week} · ← ${canMove('week', -1) ? 'previous week' : '—'} · → ${canMove('week', 1) ? 'next week' : '—'}${RESET}`, '');
      const budget = Math.max(1, this.dimensions().rows - 7);
      const start = Math.max(0, browser.selectedIndex - live.length - 2);
      let lastDay = '';
      for (let index = start; index < sessions.length && rows.length < budget + 4; index++) {
        const session = sessions[index]!;
        const day = resumeDayLabel(session.createdAt);
        if (day !== lastDay && rows.length + 1 < budget + 4) rows.push(`${SUBTLE}  ${day}${RESET}`);
        if (rows.length >= budget + 4) break;
        lastDay = day;
        const selected = index + live.length === browser.selectedIndex;
        const time = new Date(session.createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        rows.push(truncateAnsi(`${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${time}  ${SUBTLE}Archived${RESET}${selected ? ACCENT : SECONDARY}  ${describeArchivedRow(session, Date.now())}${RESET}`, columns));
      }
      if (sessions.length === 0) rows.push(`${SUBTLE}  No matching archived sessions${RESET}`);
      const confirming = browser.live.find(session => session.id === browser.confirmKill);
      if (confirming) {
        rows.push('', truncateAnsi(`${ERROR}  Kill the live session in ${confirming.cwd}? Its shell and anything running in it will end. Enter kill · Esc cancel${RESET}`, columns));
      } else {
        const selectedLive = resumeSelection(browser)?.kind === 'live';
        rows.push('', `${SUBTLE}  ↑↓ move · ←→ week · Shift+←→ month · Enter ${selectedLive ? 'attach' : 'restore transcript'}${selectedLive ? ' · Ctrl+K kill' : ''} · Esc close${RESET}`);
      }
      return framePanel(rows, columns);
    }
    if (this.appearanceState) return framePanel(renderAppearancePanel(this.appearanceState, columns), columns);
    if (this.keyboardState) return framePanel(renderKeyboardPanel(this.keyboardState, columns, this.host.name), columns);
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
      savePromptConfiguration(next, undefined, this.promptConfiguration);
      this.promptConfiguration = next;
      setIconStyle(style);
      const onboarding = this.settingsPanelState?.onboarding;
      this.settingsPanelState = undefined;
      if (!onboarding) this.settingsPanelState = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: GLYPH_ENTRY_INDEX(),
        glyphStyle: style, onboarding: false};
      if (onboarding && !next.onboardingComplete) {
        this.promptPanelState = {onboarding: true, step: 'provider', selectedIndex: PROVIDER_ORDER.indexOf(next.provider),
          draft: structuredClone(next), saved: structuredClone(next)};
      }
    } catch (error) {
      // Keep the chooser visible so the user can retry without losing their choice.
      this.output.addHistoryLine(`${ERROR}${error instanceof Error ? error.message : String(error)}${RESET}`);
      if (this.settingsPanelState) this.settingsPanelState.glyphStyle = style;
    }
  }

  /** Config position, search and advanced toggle survive closing and reopening within one run (never persisted). */
  private settingsMemory?: {contentIndex: number; searchQuery: string; showAdvanced: boolean};

  private openSettingsPanel(view: SettingsView): void {
    // Status reports the shared model service as it is now (never starts it).
    if (view === 'status') void this.understanding.refreshStatus().then(() => this.render(), () => undefined);
    const memory = view === 'config' ? this.settingsMemory : undefined;
    this.settingsPanelState = {section: 'root', view, selectedIndex: 0, contentIndex: memory?.contentIndex ?? 0,
      searchQuery: memory?.searchQuery, showAdvanced: memory?.showAdvanced,
      glyphStyle: this.promptConfiguration.glyphStyle, onboarding: false};
  }

  /** Opens Config on a specific row, revealing it if it is an advanced row; clears any remembered search. */
  private focusConfigRow(rowId: string): void {
    this.openSettingsPanel('config');
    const state = this.settingsPanelState!;
    state.searchQuery = '';
    state.showAdvanced = state.showAdvanced || SETTINGS_ROWS.find(row => row.id === rowId)?.level === 'advanced';
    state.contentIndex = Math.max(0, visibleSettingsRows(state, this.promptConfiguration).findIndex(row => row.id === rowId));
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
      else if (state.section === 'appearance') { state.section = 'root'; state.view = 'settings'; state.contentIndex = GLYPH_ENTRY_INDEX(); }
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
    const row = selectedSettingsRow(state, this.promptConfiguration);
    const editedSearch = state.searchFocused ? editText(state.searchQuery ?? '', key) : undefined;
    if (editedSearch !== undefined) {
      state.searchQuery = editedSearch;
      state.contentIndex = 0;
    } else if (key.kind === 'text' && view === 'config' && state.focus !== 'tabs' && !state.searchFocused && key.value.toLowerCase() === 'a' && !state.searchQuery?.trim()) {
      state.showAdvanced = !state.showAdvanced;
      state.contentIndex = 0;
    } else if (key.kind === 'text' && view === 'config' && state.focus !== 'tabs' && !state.searchFocused && key.value.toLowerCase() === 'r' && row) {
      if (settingsRowChanged(row, this.promptConfiguration)) this.applySettingsConfiguration(resetSettingsRow(row, this.promptConfiguration));
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
      const count = settingsItemCount(state, this.promptConfiguration);
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
    if (destination === 'resetInstallSuggestions') {
      const count = this.promptConfiguration.ignoredInstallSuggestions.length;
      if (count) this.applySettingsConfiguration({...this.promptConfiguration, ignoredInstallSuggestions: []});
      this.output.addFrontendInteraction('/settings', count ? `Install suggestions reset for ${count} tool${count === 1 ? '' : 's'}.` : 'No ignored install suggestions to reset.', INFO);
      return;
    }
    if (destination === 'glyph') {
      state.section = 'appearance';
      state.selectedIndex = this.promptConfiguration.glyphStyle === 'nerd' ? 0 : 1;
      return;
    }
    this.panelOrigin = 'settings';
    this.panelOriginView = view;
    this.panelOriginRow = rowIndex;
    this.settingsPanelState = undefined;
    if (destination === 'tools') this.startTools();
    else if (destination === 'setup') this.startSetup();
    else if (destination === 'screensaver') this.screensaverPanel = createScreensaverPanel(Date.now());
    else if (destination === 'chromeColors') {
      const config = this.promptConfiguration;
      this.chromeEditor = createChromeEditor(config.uiChrome.colors ?? chromeColorsFrom(resolveChrome({...config.uiChrome, source: 'theme'}, config.nmsh.palette, config.nmsh.accent, config.customTheme)));
    }
    else if (destination === 'idleColors' || destination === 'activityColors') this.openStopsEditor(destination === 'idleColors' ? 'idle' : 'activity');
    else if (destination === 'toolConfig') void this.startToolConfiguration('starship');
    else if (destination === 'appearance') void this.startAppearance();
    else if (destination === 'prompt') void this.startPromptSettings(false);
    else if (destination === 'transcript') this.startTranscriptSettings();
    else if (destination === 'syntax') this.startSyntaxSettings();
    else if (destination === 'layout') this.startLayoutSettings();
    else if (destination === 'welcome' || destination === 'suggestions' || destination === 'history' || destination === 'picker' || destination === 'navigation') this.startProviderPanel(destination);
    else void this.startKeyboard();
  }

  private async startToolConfiguration(id: string): Promise<void> {
    const generation = ++this.toolConfigurationGeneration;
    this.toolConfigurationLoading = true;
    this.render();
    try {
      const adapter = await openSupportedConfiguration(id, this.starshipEnvironment(this.promptConfiguration));
      const state = await createConfigurationPanel(adapter);
      if (!this.stopped && generation === this.toolConfigurationGeneration) this.toolConfiguration = state;
    } catch {
      if (!this.stopped && generation === this.toolConfigurationGeneration) {
        this.output.addFrontendInteraction('/settings', 'Supported tool configuration is unavailable. Check installation and configuration.', INFO);
        this.returnFromPanel();
      }
    } finally {
      if (generation === this.toolConfigurationGeneration) this.toolConfigurationLoading = false;
    }
    this.render();
  }

  private startPresets(): void {
    try { this.presetPanel = createPresetPanel(this.presetStore.list()); }
    catch (error) { this.output.addFrontendInteraction('/presets', error instanceof Error ? error.message : 'Could not read presets.', ERROR); }
  }

  private handlePresetKey(key: Key, state: PresetPanel): void {
    const action = presetPanelKey(state, key, this.shellCwd);
    try {
      if (action === 'close') this.presetPanel = undefined;
      else if (action === 'create' && state.form) {
        const created = this.presetStore.create({name:state.form.name,cwd:state.form.cwd,commands:state.form.commands.split('\n').filter(command=>command.trim())});
        state.presets = this.presetStore.list(); state.selected = state.presets.findIndex(preset => preset.name === created.name); state.form = undefined; state.message = 'Preset created. Enter inspects it; L launches a new session.';
      } else if (action === 'delete' && state.detail) {
        this.presetStore.delete(state.detail.name); state.presets = this.presetStore.list(); state.detail = undefined; state.message = 'Preset deleted; live sessions are unchanged.';
      } else if (action === 'launch' && state.detail) {
        if (this.sessionMode !== 'service') throw new Error('Preset launch requires the live-session service. Start a new terminal with nmsh --preset <name>.');
        // If the stored content changed since inspection, acknowledge rejects it.
        const current = this.presetStore.get(state.detail.name);
        if (presetNeedsAcknowledgement(current) && !presetNeedsAcknowledgement(state.detail)) throw new Error('Preset changed; reopen and review it.');
        this.switchPreset = this.presetStore.acknowledge(state.detail);
        this.detaching = true; this.session.detach(); this.stop(0);
      }
    } catch (error) { state.message = error instanceof Error ? error.message : 'Preset operation failed.'; }
    if (!this.stopped) this.render();
  }

  private advancePresetStartup(exitCode: number, cwd: string): void {
    if (!this.presetFrontendReady || !this.presetShellReady || this.stopped || this.running || !this.presetStartup?.active) return;
    const next = this.presetStartup.next(exitCode,cwd);
    if (next && 'error' in next) this.output.addFrontendInteraction('/presets',next.error,ERROR);
    else if (next) {
      this.editor.clear(); this.editor.insert(next.command);
      void this.submit(true);
    }
  }

  private startTools(onboarding = false): void {
    const config = this.promptConfiguration;
    const state = this.toolsPanel = createToolsPanel(new Set([config.history, config.picker, config.navigation, config.welcome, config.provider]), onboarding);
    state.updates = this.toolUpdates;
    void refreshTools(state, () => { if (!this.stopped && this.toolsPanel === state) this.render(); });
  }

  private async handleToolsKey(key: Key, state: ToolsPanel): Promise<void> {
    if (state.confirm) {
      await confirmToolInstall(state, key, () => this.renderTaskPresentation());
      if (state.task?.state.status === 'succeeded' && state.detail && state.statuses[state.detail.id]?.state === 'installed') this.milestoneEffect();
      this.render();
      return;
    }
    const wasOnboarding = state.onboarding !== undefined;
    const action = toolsKey(state, key);
    if (wasOnboarding && (action === 'close' || action === 'finishOnboarding')) {
      this.applySettingsConfiguration({...this.promptConfiguration, toolsSetupComplete: true});
      // First-run setup is complete; a skip is not a milestone.
      if (action === 'finishOnboarding') this.milestoneEffect();
    }
    if (action === 'close') { this.toolsPanel = undefined; this.returnFromPanel(); }
    else if (action === 'mise') {
      const project = detectMiseProject(this.shellCwd);
      this.misePanel = {project, selected: 0, result: this.miseService.cached(project)};
    }
    else if (action === 'configure' && state.detail?.configuration) await this.startToolConfiguration(state.detail.configuration);
    else if (action === 'provider') {
      const family = state.detail?.providerFamily;
      if (family === 'welcome' || family === 'history' || family === 'picker' || family === 'navigation') {
        this.toolsPanel = undefined;
        this.startProviderPanel(family);
      }
    } else if (action === 'refresh') await refreshTools(state, () => this.render());
    else if (action === 'checkUpdates') await this.checkToolUpdates(state);
    this.render();
  }

  /** An explicit or due background check: one batched package-manager call, never on render or keystrokes. */
  private async checkToolUpdates(panel?: ToolsPanel): Promise<void> {
    if (this.toolUpdateCheckRunning) return;
    this.toolUpdateCheckRunning = true;
    if (panel) { panel.checking = true; this.render(); }
    try {
      this.toolUpdates = await runToolUpdateCheck();
    } finally {
      this.toolUpdateCheckRunning = false;
      if (panel) { panel.checking = false; panel.updates = this.toolUpdates; }
    }
    if (this.toolsPanel) this.toolsPanel.updates = this.toolUpdates;
    if (!this.stopped) this.render();
  }

  private async quietToolUpdateCheck(): Promise<void> {
    if (!toolUpdateCheckDue(this.promptConfiguration.toolUpdateChecks, this.toolUpdates)) return;
    await this.checkToolUpdates();
    const count = Object.keys(this.toolUpdates.outdated).length;
    if (count && !this.stopped) {
      this.output.addHistoryLine(`${SUBTLE}Optional tool updates available · /tools${RESET}`);
      this.render();
    }
  }

  private renderThemeStudioRows(state: ThemeStudioState, columns: number): string[] {
    const draft: PromptConfiguration = {...this.promptConfiguration, customTheme: state.draft, nmsh: {...this.promptConfiguration.nmsh, palette: 'custom'}};
    const width = Math.max(1, columns - 16);
    const preview = state.picker || state.importPath !== undefined ? [] : this.withDraftTheme(draft, () => [
      `  ${SECONDARY}${'Preview'.padEnd(12)}${RESET}${buildThemePreviewLine(draft, 'custom', width)}${RESET}`]);
    return renderThemeStudio(state, columns, this.dimensions().rows, colorLevel(), preview);
  }

  private handleThemeStudioKey(key: Key, state: ThemeStudioState): void {
    const result = studioKey(state, key, colorLevel(), this.shellCwd);
    if (!result) return;
    if (result.kind === 'cancel') { this.themeStudio = undefined; this.returnFromPanel(); return; }
    if (result.kind === 'export') {
      try { state.message = `Exported to ${writeThemeExport(state.draft)}`; }
      catch (error) { state.message = `Export failed: ${error instanceof Error ? error.message : String(error)}`; }
      return;
    }
    const next = {...this.promptConfiguration, customTheme: result.theme, nmsh: {...this.promptConfiguration.nmsh, palette: 'custom' as const}};
    if (this.applySettingsConfiguration(next)) {
      this.themeStudio = undefined;
      this.output.addFrontendInteraction('/theme', `Custom theme ${result.theme.name} is active. Your terminal and editor colors are unchanged.`, SUCCESS);
      this.startSweep('prompt', 'vivid');
    }
  }

  // ---- Idle visuals ---------------------------------------------------------------

  /** Any input, output, resize or lifecycle change: restart the inactivity countdown (and end idle visuals). */
  private noteActivity(): void {
    this.lastActivity = Date.now();
    if (this.idle) this.dismissIdle();
    else this.armIdle();
  }

  /** One timer for the configured timeout; none when the timeout is Never or NMSh is not running. */
  private armIdle(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    const minutes = this.promptConfiguration.idleVisuals.timeout;
    // While idle visuals own the screen there is nothing to count down to.
    if (!minutes || this.stopped || !this.presentationStarted || this.idle) return;
    const delay = Math.max(1000, this.lastActivity + minutes * 60_000 - Date.now());
    this.idleTimer = setTimeout(() => { this.idleTimer = undefined; this.onIdleTimeout(); }, delay);
    this.idleTimer.unref?.();
  }

  /**
   * Starts only at a safe, quiet prompt that NMSh owns: no running or waiting command, no panel,
   * picker or palette, no passthrough, not suspended. Focus does not matter: an unfocused
   * terminal is often still visible (another monitor, beside a browser or editor).
   */
  private idleEligible(): boolean {
    return !this.stopped && this.presentationStarted && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended
      && !this.running && !this.startupPending && !this.settingsPanelActive && !this.paletteState && !this.presetStartup?.active
      && !this.pickerOpening;
  }

  private onIdleTimeout(): void {
    const minutes = this.promptConfiguration.idleVisuals.timeout;
    if (!minutes) return;
    if (Date.now() - this.lastActivity < minutes * 60_000 - 50) { this.armIdle(); return; }
    if (this.idleEligible()) this.startIdle(false);
    else { this.lastActivity = Date.now(); this.armIdle(); }
  }

  /** Begins the overlay; `preview` is an explicit start from /screensaver. Effects Off keeps idle visuals off. */
  private startIdle(preview: boolean): void {
    const motion = idleMotion(this.promptConfiguration);
    if (motion.disabled) {
      if (preview) this.output.addFrontendInteraction('/screensaver', 'Idle visuals stay off while Decorative effects are Off.', INFO);
      return;
    }
    if (this.stopped || this.passthrough || this.externalPassthrough || this.frontendSuspended || this.idle) return;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    // Exclusive ownership: every other presentation owner stops before the first idle frame.
    // The gallery (if any) stays open underneath and resumes its own preview on dismissal.
    this.suspendPresentationOwners();
    const mode = effectiveMode(this.promptConfiguration.idleVisuals.mode, motion);
    this.idle = {mode, startedAt: Date.now(), frame: 0, interval: IDLE_FRAME_MS[mode], preview, paused: false, still: motion.still};
    this.renderer.invalidate();
    this.paintIdle();
    if (!motion.still) this.idleSubscription = presentationClock.subscribe(now => this.tickIdle(now), this.idle.interval);
  }

  private tickIdle(now: number): void {
    const idle = this.idle;
    if (!idle || idle.paused) return;
    idle.frame += 1;
    const started = performance.now();
    this.paintIdle(now);
    // Adaptive cadence: a frame that costs too much slows the scene instead of the shell.
    const cost = performance.now() - started;
    if (cost > 35 && idle.interval < 500) {
      idle.interval = Math.min(500, Math.round(idle.interval * 1.5));
      this.stopIdleFrames();
      this.idleSubscription = presentationClock.subscribe(next => this.tickIdle(next), idle.interval);
    }
  }

  private paintIdle(now = Date.now()): void {
    const idle = this.idle;
    if (!idle) return;
    const {columns, rows} = this.dimensions();
    const time = idle.still ? 20_000 : sceneTime(now - idle.startedAt, idle.frame, idle.mode);
    const frame = idleFrameRows(this.idleGrid, {mode: idle.mode, width: columns, height: rows, time,
      palette: idlePaletteFor(this.promptConfiguration), level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd'});
    try { this.renderer.render({rows: frame, columns, cursorRow: 1, cursorColumn: 1, cursorVisible: false}); }
    catch (error) { this.onTerminate(); throw error; }
  }

  private stopIdleFrames(): void {
    this.idleSubscription?.(); this.idleSubscription = undefined;
  }

  /**
   * Stop every animation subscription that paints the normal UI, so the idle
   * scene is the only thing drawn while it is active. Each one is recreated by
   * the normal render path after dismissal (render → syncPresentationClock,
   * syncPanelAnimation, the gallery's own preview subscription).
   */
  private suspendPresentationOwners(): void {
    this.effects.cancel();
    this.endSweep();
    this.presentationSubscription?.(); this.presentationSubscription = undefined;
    this.panelAnimation?.(); this.panelAnimation = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.stripTimer?.(); this.stripTimer = undefined;
    this.noticeTimer?.(); this.noticeTimer = undefined;
  }

  /** Restores the exact presentation underneath: nothing it covered was changed. */
  private dismissIdle(render = true): void {
    if (!this.idle) return;
    this.stopIdleFrames();
    this.idle = undefined;
    this.lastActivity = Date.now();
    this.renderer.invalidate();
    if (render) this.render();
    this.armIdle();
  }

  /**
   * Setup Cat's preview for the current step, from the real renderers and the
   * draft (never the saved config). Animated steps get one repaint timer while
   * shown; nothing ever changes the real terminal cursor.
   */
  private setupPreview(state: SetupState, columns: number): string[] {
    const draft = state.draft;
    const section = SETUP_SECTIONS[state.section]?.id;
    const width = Math.max(10, columns - 4);
    const label = (text: string) => `  ${SUBTLE}${text.padEnd(12)}${RESET}`;
    let animate = false;
    const rows: string[] = [];
    const motion = idleMotion(draft);
    switch (section) {
      case 'welcome': {
        const cat = vespyrSprite();
        const caption = [`${PRIMARY}Vespyr${RESET} ${SUBTLE}the NMSh cat${RESET}`, `${SUBTLE}also the Native Welcome; Setup Cat is this wizard${RESET}`];
        cat.forEach((line, index) => rows.push(`  ${line}${RESET}  ${caption[index - 1] ?? ''}`));
        break;
      }
      case 'terminal': {
        // The real production glyphs in both modes, column by column, so a font problem is visible.
        rows.push(...glyphDiagnosticRows(draft.glyphStyle).map(row => `  ${row}`), '');
        // A drawn caret only: the real terminal cursor is never changed by a preview.
        const caret = draft.cursor.shape === 'block' ? `${INVERSE}s${RESET}` : draft.cursor.shape === 'bar' ? `${ACCENT}▏${RESET}s`
          : draft.cursor.shape === 'underline' ? `\u001B[4ms\u001B[24m` : `${SUBTLE}▏${RESET}s`;
        const shape = {host: 'Host default: your terminal decides', block: 'Block', bar: 'Bar', underline: 'Underline'}[draft.cursor.shape];
        const blink = draft.cursor.shape === 'host' ? '' : ` · blink ${draft.cursor.blink === 'host' ? 'as the terminal does' : draft.cursor.blink}`;
        rows.push(`${label('Caret')}${PRIMARY}git ${caret}${PRIMARY}tatus${RESET}   ${SUBTLE}${shape}${blink}${RESET}`);
        break;
      }
      case 'prompt': {
        if (draft.provider === 'nmsh') {
          rows.push(`${label('Prompt')}${buildContextLine(themePreviewContext(), width - 12, draft, 'composer', Date.now())}${RESET}`);
          rows.push(`${label('Composer')}${ACCENT}${GLYPHS.prompt}${RESET} ${PRIMARY}git status${RESET}`);
          animate ||= treatmentAnimated(draft.presentation);
          break;
        }
        // An external provider's own prompt, never the Native one standing in for it.
        rows.push(this.setupExternalPromptRow(draft, width - 12, label(providerLabel(draft.provider))));
        rows.push(`  ${SUBTLE}${providerExplanation('prompt', draft.provider)}${RESET}`, `  ${SUBTLE}${NATIVE_ONLY_NOTE}${RESET}`);
        break;
      }
      case 'appearance': {
        rows.push(`${label('Prompt')}${buildThemePreviewLine(draft, draft.nmsh.palette, width - 12, Date.now())}${RESET}`);
        rows.push(`${label('Chrome')}${renderTabStrip(['Settings', 'Status', 'Config'], 2, Math.min(36, width - 12), true)}`);
        rows.push(`${label('')}${SEPARATOR}${repeatToWidth(GLYPHS.separator, Math.min(36, width - 12))}${RESET}`);
        rows.push(`${label('')}${background(UI_COLORS.selection)}${ACCENT}${GLYPHS.selection} ${PRIMARY}Selected row${' '.repeat(Math.max(0, Math.min(36, width - 12) - 14))}${RESET}`);
        if (draft.presentation.preset !== 'off') {
          // The selected treatment, live: Breathe breathes, Comet and Travel move, Static stays still.
          const treatment = treatmentFor({...draft.presentation, intensity: 1}, themeChromaStops(draft.nmsh.palette, draft.nmsh.vibrance));
          const swatch = treatment ? treatmentText('█'.repeat(Math.max(4, Math.min(36, width - 12))), treatment,
            {role: 'effect', base: {red: 40, green: 40, blue: 46}, reducedMotion: draft.presentation.reducedMotion || isReducedMotion(), effectsOff: draft.presentation.effectsOff}, Date.now()) : '';
          rows.push(`${label('Chroma')}${swatch}${RESET}  ${SUBTLE}${TREATMENT_MOTION_LABELS[draft.presentation.motion]}${RESET}`);
          if (draft.provider === 'nmsh') rows.push(`  ${SUBTLE}${CHROMA_PREVIEW_NOTE}${RESET}`);
        }
        rows.push(`  ${SUBTLE}${draft.presentation.effectsOff ? 'Decorative effects Off: Chroma motion, sparkles and idle visuals stay still.'
          : draft.presentation.reducedMotion ? 'Reduced Motion: colors stay, movement stops.' : 'Decorative effects On: Chroma motion and effects may move.'}${RESET}`);
        // The light sweep over a semantic sample: with Semantic Preserve, ✔ and ✘ keep their hues.
        const style = sweepStyleFor(draft);
        if (style.level !== 'off') {
          const sample: Array<{glyph: string; color?: Rgb; semantic?: boolean}> = [];
          const add = (text: string, color: Rgb | undefined, semantic = false) => { for (const glyph of graphemes(text)) sample.push({glyph, color: glyph === ' ' ? undefined : color, semantic}); };
          add('✔ 0 ', NATIVE_PROMPT_THEMES[draft.nmsh.palette].colors('success').background, true);
          add('notMyShell ', NATIVE_PROMPT_THEMES[draft.nmsh.palette].colors('project').background);
          add('~/src ', NATIVE_PROMPT_THEMES[draft.nmsh.palette].colors('cwd').background);
          add('✘ 1', NATIVE_PROMPT_THEMES[draft.nmsh.palette].colors('failure').background, true);
          // One pass on each change in this step (the same event as the selected row), not a loop.
          rows.push(`${label('Shimmer')}${sweepOnce(sample, this.sweep?.target === 'selection' ? this.sweepElapsed() : Number.POSITIVE_INFINITY, style, colorLevel(), sweepStill(draft))}${RESET}`);
        }
        animate ||= treatmentAnimated(draft.presentation);
        break;
      }
      case 'editor': {
        rows.push(...this.setupEditorPreview(draft, width));
        break;
      }
      case 'transcript': {
        rows.push(...this.setupTranscriptPreview(draft, width));
        break;
      }
      case 'history': {
        for (const [family, title, id] of [['history', 'History', draft.history], ['navigation', 'Navigation', draft.navigation], ['picker', 'Picker', draft.picker]] as const) {
          rows.push(`${label(title)}${PRIMARY}${family === 'history' ? HISTORY_PROVIDERS.find(item => item.id === id)?.label : family === 'navigation'
            ? NAVIGATION_PROVIDERS.find(item => item.id === id)?.label : PICKER_PROVIDERS.find(item => item.id === id)?.label}${RESET}`);
          rows.push(`${label('')}${SUBTLE}${providerExplanation(family, id)}${RESET}`);
        }
        break;
      }
      case 'welcomeScreen': {
        rows.push(`  ${SUBTLE}${providerExplanation('welcome', draft.welcome)}${RESET}`);
        if (draft.welcome === 'vespyr') rows.push(...vespyrSprite().map(line => `  ${line}${RESET}`));
        if (draft.statusStrip.enabled) rows.push(`${label('Strip')}${stripAnsi(renderStatusStrip(draft.statusStrip, this.stripStats, Math.min(60, width - 12))).trim()}`);
        break;
      }
      case 'idle': {
        if (motion.disabled) { rows.push(`  ${SUBTLE}Decorative effects Off: idle visuals stay off.${RESET}`); break; }
        const mode = effectiveMode(draft.idleVisuals.mode, motion);
        const elapsed = Date.now() - this.lastActivity;
        rows.push(...idleFrameRows(this.screensaverGrid, {mode, width: Math.max(10, Math.min(56, columns - 6)), height: 6, palette: idlePaletteFor(draft),
          level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd', time: motion.still ? 20_000 : sceneTime(elapsed, Math.floor(elapsed / IDLE_FRAME_MS[mode]), mode)})
          .map(line => `  ${line}`));
        animate = !motion.still;
        break;
      }
      case 'tools': {
        for (const tool of TOOLS.filter(item => item.tier === 'recommended')) {
          const status = state.context.statuses[tool.executable ?? ''] ?? this.toolStatuses.get(tool.id);
          const installed = status?.state === 'installed' ? `${SUCCESS}installed${RESET}` : status?.state === 'missing' ? `${SUBTLE}not installed${RESET}` : `${SUBTLE}…${RESET}`;
          rows.push(`${label(tool.label)}${installed}  ${SUBTLE}${tool.description}${RESET}`);
        }
        break;
      }
    }
    if (animate && !this.screensaverAnimation) {
      this.screensaverAnimation = presentationClock.subscribe(() => { if (this.setupState) this.render(); }, 150);
    } else if (!animate && this.screensaverAnimation) { this.screensaverAnimation(); this.screensaverAnimation = undefined; }
    return rows.map(row => truncateAnsi(row, columns - 2));
  }

  /**
   * A compact, representative picture of the Editor step: where the composer
   * sits, Normal or Chat transcript rows, a folded output block, syntax
   * colors, ghost text and the empty-prompt prediction, each following the draft.
   */
  private setupEditorPreview(draft: PromptConfiguration, width: number): string[] {
    const inner = Math.max(20, Math.min(60, width));
    const chat = draft.transcriptPresentation === 'chat';
    const command = (text: string) => {
      const painted = `${renderSyntaxPreviewLine(text, draft.syntax, draft.nmsh.palette)}${RESET}`;
      return chat ? `${' '.repeat(Math.max(1, inner - displayWidth(text) - 2))}${painted} ${SUBTLE}${GLYPHS.prompt}${RESET}` : `${SUBTLE}${GLYPHS.prompt}${RESET} ${painted}`;
    };
    const transcript = [command('npm test'), `${SECONDARY}  ${GLYPHS.success} 42 passed${RESET}`];
    if (draft.outputFolding !== 'never') transcript.push(`${SUBTLE}  ${getCurrentGlyphMode() === 'nerd' ? '▸' : '>'} 318 more lines folded${RESET}`);
    const ghost = draft.suggestions === 'none' ? '' : `${SECONDARY} --amend${RESET}`;
    const composer = [`${ACCENT}${GLYPHS.prompt}${RESET} ${renderSyntaxPreviewLine('git commit -m "fix"', draft.syntax, draft.nmsh.palette)}${ghost}`];
    const rule = `${SUBTLE}${repeatToWidth(GLYPHS.separator, inner)}${RESET}`;
    const body = draft.composerPosition === 'top' ? [...composer, rule, ...transcript] : [...transcript, rule, ...composer];
    const rows = body.map(line => `  ${SUBTLE}│${RESET} ${line}`);
    const where = draft.composerPosition === 'flow' ? 'Flow: the composer follows the newest output' : `Composer docked at the ${draft.composerPosition}`;
    rows.push(`  ${SUBTLE}${where} · ${chat ? 'Chat' : 'Normal'} transcript · syntax ${draft.syntax.highlighting ? 'on' : 'off'} · folding ${draft.outputFolding}${RESET}`);
    rows.push(draft.suggestionsOnEmpty && draft.suggestions !== 'none'
      ? `  ${SUBTLE}Empty prompt:${RESET} ${ACCENT}${GLYPHS.prompt}${RESET} ${SECONDARY}git push${RESET}  ${SUBTLE}predicted before typing${RESET}`
      : `  ${SUBTLE}Empty prompt: no prediction until you type${RESET}`);
    rows.push(`  ${SUBTLE}${providerExplanation('suggestions', draft.suggestions)}${RESET}`);
    return rows;
  }

  /**
   * The Transcript step's preview through the real history-header renderer:
   * a historical prompt with its divider, the command (Normal or Chat), short
   * output, and a long block as the Output folding draft would present it.
   */
  private setupTranscriptPreview(draft: PromptConfiguration, width: number): string[] {
    const inner = Math.max(20, Math.min(72, width));
    const chat = draft.transcriptPresentation === 'chat';
    const sample = this.transcriptPreviewSample();
    const header = renderHistoricalContext(sample, chat ? Math.max(10, Math.floor(inner * 0.6)) : inner, draft.transcript, draft.presentation);
    const rows: string[] = [];
    const place = (line: string) => chat ? `${' '.repeat(Math.max(0, inner - displayWidth(line)))}${line}` : line;
    if (header) rows.push(place(header.ansi));
    rows.push(place(`${SECONDARY}${GLYPHS.prompt} ${RESET}${PRIMARY}npm test${RESET}`), `${SUBTLE}  ${GLYPHS.success} 42 passing${RESET}`);
    if (header) rows.push(place(header.ansi));
    // The same long-block preview /transcript shows for this Output folding choice.
    return [...rows.map(line => `  ${line}`), ...foldingPreview(draft.outputFolding)];
  }

  /** Setup Cat's external prompt preview, rendered off the render path once per provider. */
  private setupExternalPrompt?: {provider: PromptProviderId; result?: StarshipPromptResult; error?: string};

  private setupExternalPromptRow(draft: PromptConfiguration, width: number, label: string): string {
    const provider = draft.provider;
    const cached = this.setupExternalPrompt?.provider === provider ? this.setupExternalPrompt : undefined;
    if (!cached) {
      const entry: NonNullable<TerminalApp['setupExternalPrompt']> = {provider};
      this.setupExternalPrompt = entry;
      void this.renderExternalPrompt(draft).then(result => { entry.result = result; }, (error: unknown) => {
        entry.error = error instanceof Error ? error.message : String(error);
      }).then(() => { if (!this.stopped && this.setupState && this.setupExternalPrompt === entry) this.render(); });
      return `${label}${SUBTLE}Checking ${providerLabel(provider)}…${RESET}`;
    }
    if (cached.result) return `${label}${this.externalPromptRow(cached.result, width, 'composer')}${RESET}`;
    if (cached.error) return `${label}${SUBTLE}${truncateText(`No preview: ${cached.error}`, width)}${RESET}`;
    return `${label}${SUBTLE}Checking ${providerLabel(provider)}…${RESET}`;
  }

  /** The Setup Cat title takes the current one-shot sweep when the step changes; otherwise it rests. */
  private setupTitle(state: SetupState): string {
    const text = 'Setup Cat';
    const cells = [...text].map(glyph => ({glyph, color: glyph === ' ' ? undefined : {...UI_COLORS.primary}}));
    const elapsed = this.sweep && this.sweep.section === state.section && this.sweep.titled ? this.sweepElapsed() : Number.POSITIVE_INFINITY;
    return sweepOnce(cells, elapsed, sweepStyleFor(this.promptConfiguration), colorLevel());
  }

  // ---- Light sweep controller -----------------------------------------------------

  /**
   * At most one sweep at a time, started by an event (a new selection or a changed value in the
   * active panel, a submitted command, an Apply or Save). A new event replaces the running sweep, so
   * fast navigation never builds a backlog. One clock subscription exists only while a sweep runs.
   */
  private sweep?: {target: 'selection' | 'prompt'; startedAt: number; frame: number; strength: 'subtle' | 'vivid'; section?: number; titled?: boolean};
  private sweepTimer?: () => void;
  private lastSelection?: string;
  private static readonly SWEEP_FRAME_MS = 40;
  private static readonly SWEEP_MAX_MS = 1300;

  private sweepAllowed(): boolean {
    const style = sweepStyleFor(this.promptConfiguration);
    return sweepAnimates(style.level, sweepStill(this.promptConfiguration), colorLevel()) && !this.stopped && !this.idle;
  }

  /** Elapsed time of the running sweep; deterministic runs use the frame count. */
  private sweepElapsed(now = Date.now()): number {
    if (!this.sweep) return Number.POSITIVE_INFINITY;
    return isDeterministicPresentation() ? this.sweep.frame * TerminalApp.SWEEP_FRAME_MS : now - this.sweep.startedAt;
  }

  private startSweep(target: 'selection' | 'prompt', strength: 'subtle' | 'vivid', extra: {section?: number; titled?: boolean} = {}): void {
    if (!this.sweepAllowed()) return;
    this.sweep = {target, startedAt: Date.now(), frame: 0, strength, ...extra};
    if (!this.sweepTimer) {
      this.sweepTimer = presentationClock.subscribe(now => {
        if (!this.sweep) return;
        this.sweep.frame += 1;
        if (this.sweepElapsed(now) > TerminalApp.SWEEP_MAX_MS) this.endSweep();
        this.render();
      }, TerminalApp.SWEEP_FRAME_MS);
    }
  }

  private endSweep(): void {
    this.sweep = undefined;
    this.sweepTimer?.(); this.sweepTimer = undefined;
  }

  /** The selected panel row: the line marked with the selection pointer. */
  private static selectedRowIndex(rows: readonly string[]): number {
    return rows.findIndex(row => /^\s*[›>] \S/u.test(stripAnsi(row)));
  }

  /** Called with the panel rows of each render: a new selection or a changed value starts one sweep. */
  private noteSelection(rows: readonly string[] | undefined): void {
    const index = rows ? TerminalApp.selectedRowIndex(rows) : -1;
    const signature = index === -1 ? undefined : `${this.setupState ? `setup:${this.setupState.section}` : 'panel'}|${stripAnsi(rows![index]!).trim()}`;
    if (signature === this.lastSelection) return;
    const sectionChanged = Boolean(this.setupState && this.lastSelection && !this.lastSelection.startsWith(`setup:${this.setupState.section}|`));
    const opening = this.lastSelection === undefined;
    this.lastSelection = signature;
    if (!signature) { if (this.sweep?.target === 'selection') this.endSweep(); return; }
    this.startSweep('selection', 'subtle', this.setupState ? {section: this.setupState.section, titled: sectionChanged || opening} : {});
  }

  /** Applies the running sweep to its target row in a painted frame (presentation only). */
  private applySweep(rows: string[], plan: ScreenPlan, columns: number): void {
    const sweep = this.sweep;
    if (!sweep) return;
    const elapsed = this.sweepElapsed();
    const style = sweepStyleFor(this.promptConfiguration, sweep.strength);
    const level = colorLevel();
    const contentRange = (row: string, skipPointer: boolean) => {
      const plain = stripAnsi(row);
      const start = skipPointer ? plain.search(/[›>] \S/u) + 2 : plain.search(/\S/u);
      return {from: Math.max(0, displayWidth(plain.slice(0, Math.max(0, start)))), to: Math.min(columns, displayWidth(plain.trimEnd()))};
    };
    if (sweep.target === 'prompt') {
      const region = plan.regions.find(item => item.kind === 'prompt' && item.height > 0) ?? plan.regions.find(item => item.kind === 'input');
      if (region) rows[region.top] = sweepAnsiRow(rows[region.top]!, elapsed, style, level, contentRange(rows[region.top]!, false));
      return;
    }
    const panel = plan.regions.find(item => item.kind === 'panel');
    if (!panel) return;
    const local = TerminalApp.selectedRowIndex(rows.slice(panel.top, panel.top + panel.height));
    if (local === -1) return;
    const row = rows[panel.top + local]!;
    rows[panel.top + local] = sweepAnsiRow(row, elapsed, style, level, contentRange(row, true));
  }

  /** Recommended-tool install state for Setup Cat's tools preview, detected once off the render path. */
  private readonly toolStatuses = new Map<string, ProviderStatus>();

  private renderScreensaverRows(state: ScreensaverPanelState, columns: number): string[] {
    const {rows} = this.dimensions();
    const settings = this.promptConfiguration.idleVisuals;
    const motion = idleMotion(this.promptConfiguration);
    const size = previewSize(columns, rows);
    const mode = effectiveMode(settings.mode, motion);
    const elapsed = Date.now() - state.startedAt;
    const preview = motion.disabled ? [] : idleFrameRows(this.screensaverGrid, {mode, width: size.width, height: size.height,
      time: motion.still ? 20_000 : sceneTime(elapsed, Math.floor(elapsed / IDLE_FRAME_MS[mode]), mode),
      palette: idlePaletteFor(this.promptConfiguration), level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd'});
    // A real animated preview while the gallery is open; one timer, removed with the panel.
    if (!motion.still && !motion.disabled && !this.screensaverAnimation) {
      this.screensaverAnimation = presentationClock.subscribe(() => { if (this.screensaverPanel) this.render(); }, Math.max(120, IDLE_FRAME_MS[mode]));
    }
    return renderScreensaverPanel(state, columns, rows, {settings, motion, preview});
  }

  private handleScreensaverKey(key: Key, state: ScreensaverPanelState): void {
    const action = screensaverKey(state, key, this.promptConfiguration.idleVisuals, this.promptConfiguration);
    if (!action) return;
    if (action.kind === 'editColors') {
      this.screensaverPanel = undefined;
      this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
      this.openStopsEditor('idle');
      return;
    }
    if (action.kind === 'close') {
      this.screensaverPanel = undefined;
      this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
      this.returnFromPanel();
    } else if (action.kind === 'change') {
      this.applySettingsConfiguration({...this.promptConfiguration, idleVisuals: action.settings});
      this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
      this.armIdle();
    } else this.startIdle(true);
  }

  private openStopsEditor(target: 'idle' | 'activity'): void {
    const config = this.promptConfiguration;
    const stops = target === 'idle' ? config.idleVisuals.customStops : config.liveActivity.customStops;
    this.stopsEditor = {target, gradient: {stops: [...(stops.length >= MIN_CUSTOM_STOPS ? stops : PRESET_STOPS.lavender)], index: 0}};
  }

  /** The draft stops applied to a copy of the configuration, for live previews. */
  private stopsDraft(editor: NonNullable<TerminalApp['stopsEditor']>): PromptConfiguration {
    const config = this.promptConfiguration;
    const customStops = editor.gradient.stops.length >= MIN_CUSTOM_STOPS ? [...editor.gradient.stops] : [...PRESET_STOPS.lavender];
    return editor.target === 'idle'
      ? {...config, idleVisuals: {...config.idleVisuals, colorSource: 'custom', customStops}}
      : {...config, liveActivity: {colors: 'custom', customStops}};
  }

  /** Shared stop editor keys; Esc (when not typing a hex) saves the stops and returns. */
  private handleStopsEditorKey(key: Key, editor: NonNullable<TerminalApp['stopsEditor']>): void {
    const saved = editor.target === 'idle' ? this.promptConfiguration.idleVisuals.customStops : this.promptConfiguration.liveActivity.customStops;
    if (gradientEditorKey(editor.gradient, key, () => saved.length >= MIN_CUSTOM_STOPS ? saved : PRESET_STOPS.lavender)) return;
    if (key.kind !== 'escape' && key.kind !== 'interrupt') return;
    if (key.kind === 'escape' && this.applySettingsConfiguration(this.stopsDraft(editor))) this.armIdle();
    this.stopsEditor = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.returnFromPanel();
  }

  private renderStopsEditor(editor: NonNullable<TerminalApp['stopsEditor']>, columns: number): string[] {
    const draft = this.stopsDraft(editor);
    const title = editor.target === 'idle' ? 'Idle visuals · Custom colors' : 'Live activity · Custom colors';
    const rows = ['', ...renderGradientEditorRows(editor.gradient, title).map(row => `  ${row}`), '', `  ${SUBTLE}${GLYPHS.separator.repeat(2)} Preview${RESET}`];
    if (editor.target === 'idle') {
      rows.push(...idleFrameRows(this.screensaverGrid, {mode: draft.idleVisuals.mode, width: Math.max(10, Math.min(56, columns - 6)), height: 5,
        palette: idlePaletteFor(draft), level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd', time: 20_000}).map(line => `  ${line}`));
    } else {
      const {cells, style} = liveActivityPaint('• Running sleep 5 · ', draft);
      rows.push(`  ${sweepCells(cells, Number.POSITIVE_INFINITY, style, colorLevel(), true)}${SECONDARY}3.4s${RESET}`,
        `  ${SUBTLE}Only live work uses these colors; finished commands show their plain success or failure.${RESET}`);
    }
    rows.push('', renderControls(gradientEditorControls(editor.gradient)));
    return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, this.dimensions().rows));
  }

  private startSetup(entry?: string): void {
    this.setupExternalPrompt = undefined;
    const state = this.setupState = createSetup(this.promptConfiguration, entry);
    void this.loadSetupContext(state);
  }

  /** Provider install state and completion facts, detected once per Setup Cat open; never on render. */
  private async loadSetupContext(state: SetupState): Promise<void> {
    const descriptors = [...PICKER_PROVIDERS, ...NAVIGATION_PROVIDERS, ...HISTORY_PROVIDERS, ...SUGGESTION_PROVIDERS, ...WELCOME_PROVIDERS]
      .filter(descriptor => descriptor.kind === 'external' && descriptor.executable);
    const statuses: Record<string, ProviderStatus> = {};
    const facts = this.semanticService.completionFacts().then(result => {
      state.context = {...state.context, completion: result ?? {zshCompletions: false, fzfTab: false, completionSystem: false}};
    });
    await Promise.all(descriptors.map(async descriptor => { statuses[descriptor.executable!] = await detectProvider(descriptor); }));
    const starship = await detectProvider({id: 'starship', family: 'prompt', label: 'Starship', kind: 'external', description: '', executable: 'starship'});
    statuses.starship = starship;
    for (const tool of TOOLS.filter(item => item.tier === 'recommended')) {
      const status = await detectProvider(tool);
      this.toolStatuses.set(tool.id, status);
      if (tool.executable) statuses[tool.executable] ??= status;
    }
    state.context = {...state.context, statuses};
    await facts;
    if (!this.stopped && this.setupState === state) this.render();
  }

  private handleSetupKey(key: Key, state: SetupState): void {
    if (state.toolBrowser) { void this.handleSetupToolsKey(key, state, state.toolBrowser); return; }
    const result = setupKey(state, key);
    if (!result) return;
    if (result.kind === 'browseTools') { this.openSetupToolBrowser(state, result.toolId); return; }
    this.setupState = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;

    if (result.kind === 'cancel') { this.returnFromPanel(); return; }
    const previous = this.promptConfiguration;
    const next = result.tools !== 'keep' ? {...result.configuration, toolsSetupComplete: true} : result.configuration;
    if (result.changed && !setupIsIdempotent({...state, draft: next})) {
      if (!this.applySettingsConfiguration(next)) return;
      this.armIdle();
      if (previous.suggestions !== next.suggestions) this.applySuggestionProvider();
      if (previous.history !== next.history) void this.loadHistory();
      if (previous.navigation !== next.navigation) { this.directoryQueryAbort?.abort(); this.directoryQuery = undefined; this.directoryResults = []; }
      if (previous.provider !== next.provider) void this.refreshProviderPrompt().then(() => this.render());
      this.output.addFrontendInteraction('/setup', 'Setup Cat applied your changes. Rerun /setup anytime; it starts from your current settings.', SUCCESS);
      this.startSweep('prompt', 'vivid');
    } else this.output.addFrontendInteraction('/setup', 'Setup Cat: no changes; your settings are unchanged.', INFO);
    this.panelOrigin = undefined;
    // Auto or Always with a use enabled: continue straight into model setup (the same /llm controller), detecting first.
    const understanding = next.localUnderstanding;
    if (understanding.mode !== 'off' && (understanding.ask || understanding.folding)
      && JSON.stringify(previous.localUnderstanding) !== JSON.stringify(understanding)) { this.openUnderstandingPanel(true); return; }
    if (result.tools === 'recommended' || result.tools === 'enhanced' || result.tools === 'individual') {
      this.startTools();
      if (this.toolsPanel) this.toolsPanel.tier = result.tools === 'individual' ? undefined : result.tools;
    }
  }

  /**
   * The shared tool browser inside Setup Cat: the same panel, recipes, previews, confirmation and
   * installer as /tools. The Setup Cat draft and step are untouched; Esc returns to them.
   */
  private openSetupToolBrowser(state: SetupState, toolId?: string): void {
    const config = state.draft;
    const browser = createToolsPanel(new Set([config.history, config.picker, config.navigation, config.welcome, config.provider]));
    browser.updates = this.toolUpdates;
    const tool = toolId ? TOOLS.find(item => item.id === toolId) : undefined;
    if (tool) browser.detail = tool;
    state.toolBrowser = browser;
    void refreshTools(browser, () => { if (!this.stopped && state.toolBrowser === browser) this.render(); });
  }

  private async handleSetupToolsKey(key: Key, state: SetupState, browser: ToolsPanel): Promise<void> {
    if (browser.confirm) {
      // Same confirmation and installer as /tools; a failure stays visible and the draft is kept.
      await confirmToolInstall(browser, key, () => this.renderTaskPresentation());
      if (browser.task?.state.status === 'succeeded' && browser.detail && browser.statuses[browser.detail.id]?.state === 'installed') this.pendingMilestone = true;
      this.render();
      return;
    }
    const action = toolsKey(browser, key);
    if (action === 'close') {
      state.toolBrowser = undefined;
      // Fresh install state for the provider rows, so a just-installed tool can be selected at once.
      clearProviderDetection();
      void this.loadSetupContext(state);
    } else if (action === 'refresh') await refreshTools(browser, () => this.render());
    else if (action === 'checkUpdates') await this.checkToolUpdates(browser);
    this.render();
  }

  /**
   * Before a submitted command runs: when its first word exactly names a curated tool that the real
   * zsh cannot resolve (no alias, function, builtin or executable), offer an install instead. Returns
   * true when the offer is shown; the command text stays in the composer meanwhile.
   */
  private async offerInstallFor(command: string): Promise<boolean> {
    const tool = installCandidate(command, this.promptConfiguration);
    if (!tool || !tool.executable) return false;
    const source = await this.semanticService.resolveSource(tool.executable);
    const resolution = source === undefined ? 'unavailable' : source.kind;
    const onPath = this.installProbe.onPath(tool.executable);
    const recipe = this.installProbe.recipe(tool);
    if (!shouldOfferInstall(tool, resolution, onPath, recipe)) return false;
    this.installPrompt = createInstallPrompt(tool, recipe, command);
    return true;
  }

  private async handleInstallPromptKey(key: Key, state: InstallPromptState): Promise<void> {
    const action = installPromptKey(state, key);
    if (!action) { this.render(); return; }
    const restore = () => { this.editor.clear(); this.editor.insert(state.command); };
    if (action === 'close' || action === 'later') { this.installPrompt = undefined; restore(); }
    else if (action === 'run') { this.installPrompt = undefined; restore(); await this.submit(false, true); }
    else if (action === 'ignoreTool' || action === 'never') {
      this.installPrompt = undefined; restore();
      this.applySettingsConfiguration(ignoreInstallSuggestion(this.promptConfiguration, action, state.tool));
      this.output.addFrontendInteraction('/tools', action === 'never'
        ? 'Install suggestions are off. Turn them back on in /settings (Tools).'
        : `NMSh will not offer to install ${state.tool.label} again. Reset in /settings (Tools).`, INFO);
    } else if (action === 'install') {
      state.task = new TaskProgress(`Installing ${state.tool.label}`, () => this.renderTaskPresentation(), Date.now(), state.tool.label);
      this.render();
      const outcome = await state.task.run(state.recipe.command, [...state.recipe.args]);
      if (this.stopped) return;
      clearProviderDetection();
      this.semanticService.cache.delete(state.tool.executable ?? '');
      this.commandSources.clear();
      const installed = resolveCommand(state.tool.executable ?? state.tool.id) !== undefined;
      if (outcome.status === 'succeeded' && installed) recordInstall(state.tool.id, state.recipe);
      state.result = outcome.status === 'succeeded' && installed
        ? {ok: true, message: `${state.tool.label} installed. Nothing was run.`}
        : {ok: false, message: outcome.status === 'succeeded' ? `${state.recipe.label} finished, but ${state.tool.executable} was not found.`
          : `${state.tool.label} was not installed. ${state.task.state.error ?? ''}`.trim()};
      restore();
      if (state.result.ok) this.pendingMilestone = true;
    }
    this.render();
  }

  private async handleMiseKey(key: Key, state: MisePanel): Promise<void> {
    const action = misePanelKey(state, key);
    if (action === 'close') { this.miseService.cancel(); this.misePanel = undefined; }
    else if (action === 'inspect') {
      state.busy = true;
      this.render();
      // A fresh identity after explicit consent; no metadata on cwd/render events.
      state.project = detectMiseProject(this.shellCwd);
      const result = await this.miseService.inspect(state.project, true, true);
      if (!this.stopped && this.misePanel === state) { state.result = result; state.selected = 0; state.busy = false; }
    } else if (action && typeof action === 'object') {
      this.misePanel = undefined; this.toolsPanel = undefined;
      this.returnFromPanel();
      this.editor.clear(); this.editor.insert(action.command);
      this.historyViewport.latest();
    }
    if (!this.stopped) this.render();
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
    const terminal = this.host.name;
    const active = this.effectivePromptProvider;
    return [
      [
        {label: 'Version', value: build.version},
        {label: 'Build', value: `${build.commit}${build.branch ? ` (${build.branch}${build.dirty ? ', dirty' : ''})` : ''}`, tone: build.commit === 'unknown' ? 'muted' : undefined},
        {label: 'Platform', value: `${process.platform} ${process.arch}`},
        {label: 'Platform support', value: this.platformInfo.support, tone: this.platformInfo.wsl?.version === 1 ? 'warning' as const : undefined},
        {label: 'Node', value: process.version},
        {label: 'Shell', value: `${shellAdapter(this.shellId).label}${this.shellId === this.promptConfiguration.shellBackend ? '' : ` (default for new sessions: ${shellAdapter(this.promptConfiguration.shellBackend).label})`}`},
        {label: 'Shell capabilities', value: (() => { const caps = shellAdapter(this.shellId).capabilities; return `completion ${caps.completion}${caps.completionDescriptions ? ' + descriptions' : ''} · live names ${caps.liveNames ? 'yes' : 'no'} · history import ${caps.historyImport ? 'yes' : 'no'}`; })()},
        ...understandingStatusRows(this.promptConfiguration.localUnderstanding, this.understanding.status)
          .map(row => ({label: `Local understanding ${row.label === 'Mode' ? '' : row.label.toLowerCase()}`.trim(), value: row.value})),
        {label: 'Session', value: this.sessionId ? `live · ${this.sessionId}` : 'in-process', tone: this.sessionMode === 'service' ? undefined : 'muted'},
        ...(this.sessionMode === 'service' ? [
          {label: 'Session service', value: this.session.serviceBuild ? `connected · ${this.session.serviceBuild}` : 'connected · older build (no build reported)'},
          {label: 'Shell switching', value: this.session.features.has('shell-switch') ? 'available' : 'unavailable (older service; ends with its sessions)',
            ...(this.session.features.has('shell-switch') ? {} : {tone: 'warning' as const})},
          ...(this.session.features.has('notices') ? [] : [{label: 'Session notices', value: 'basic (older service reports no notices)', tone: 'muted' as const}]),
        ] : []),
        {label: 'Working directory', value: tilde(this.shellCwd)},
        ...(terminal ? [{label: 'Terminal', value: terminal}] : []),
        {label: 'Host capabilities', value: Object.entries(this.host.capabilities).filter(([, value]) => value === true).map(([key]) => key).join(', ') || 'baseline'},
        {label: 'Terminal size', value: `${columns}×${rows}`},
      ],
      [
        {label: 'Prompt provider', value: providerLabel(config.provider)},
        ...(active !== config.provider ? [{label: 'Active prompt', value: `${providerLabel(active)} (fallback)`, tone: 'warning' as const}] : []),
        {label: 'Composer', value: layoutLabel(config)},
        {label: 'Glyph style', value: config.glyphStyle === 'nerd' ? 'Nerd Font' : 'Safe / ASCII'},
        {label: 'Syntax', value: !config.syntax.highlighting ? 'Off' : config.syntax.colors === 'followPrompt' ? 'Follow prompt theme' : config.syntax.colors === 'theme' ? 'Choose theme' : 'Grayscale'},
        {label: 'Directory navigation', value: this.directoryService.status.detail ?? this.directoryService.status.active},
        {label: 'Picker', value: this.promptConfiguration.picker},
        {label: 'Command history', value: this.historyService.status.detail ?? (this.historyService.status.active === 'atuin' ? 'Atuin · local read-only' : 'NMSh Native')},
        ...(() => {
          const host = this.hostActions();
          const caps = host.capabilities;
          const editor = caps.integratedEditor === 'zed' ? 'Zed' : caps.integratedEditor === 'vscode' ? 'VS Code' : undefined;
          return [
            ...(editor ? [{label: 'Integrated editor', value: editor}] : []),
            {label: 'Editor bridge', value: host.id === 'none' ? (editor ? 'unavailable' : 'no editor known (set VISUAL/EDITOR or Open with)')
              : `${host.label} · file ${caps.nativeFileOpen ? 'yes' : 'no'} · folder ${caps.nativeDirectoryOpen ? 'yes' : 'no'} · diff ${caps.nativeDiff ? 'yes' : 'no'}`,
              ...(host.id === 'none' ? {tone: 'warning' as const} : {})},
            ...(caps.cliMissing ? [{label: caps.cliMissing === 'zed' ? 'Zed CLI' : 'code CLI', value: 'not found on PATH', tone: 'warning' as const}] : []),
          ];
        })(),
        {label: 'Completion sources', value: this.completionService.sourceIds.join(' + ')},
        {label: 'Session notices', value: config.sessionNotices ? (this.sessionMode === 'service' ? 'On' : 'On (needs the live-session service)') : 'Off'},
        {label: 'Agent activity', value: config.agentActivity ? 'On · local only' : 'Off'},
        ...shellEnvironmentRows(this.shellEnvironment).map(([label, value]) => ({label, value})),
        {label: 'History colors', value: config.transcript.historyColors === 'followPrompt' ? 'Follow prompt' : config.transcript.historyColors === 'theme' ? 'Theme' : 'Grayscale'},
      ],
      [
        {label: 'Session journal', value: this.journalActive ? 'active' : 'inactive', tone: this.journalActive ? 'success' : 'warning'},
        {label: 'Session retention', value: config.sessionRetention === null ? 'unlimited' : `${config.sessionRetention} sessions`},
        {label: 'Config file', value: tilde(promptConfigurationPath()), tone: 'muted'},
        {label: 'Runtime directory', value: tilde(defaultRuntimeDir()), tone: 'muted'},
      ],
    ];
  }

  /** Persists an inline Settings edit and applies it live; on failure the old value stays. */
  private applySettingsConfiguration(next: PromptConfiguration | undefined): boolean {
    if (!next) return false;
    try {
      savePromptConfiguration(next, undefined, this.promptConfiguration);
    } catch (error) {
      this.output.addHistoryLine(`${ERROR}${error instanceof Error ? error.message : String(error)}${RESET}`);
      this.render();
      return false;
    }
    this.promptConfiguration = next;
    setIconStyle(next.glyphStyle);
    this.renderer.setCursorStyle(cursorStyleSequence(next.cursor.shape, next.cursor.blink));
    if (next.idleVisuals.timeout !== this.idleArmedFor) { this.idleArmedFor = next.idleVisuals.timeout; this.armIdle(); }
    this.output.setTranscriptAppearance(next.transcript);
    this.output.presenter.setTreatment(next.presentation);
    this.output.setOutputFolding(next.outputFolding);
    this.output.presenter.setLayout(next.transcriptPresentation);
    if (this.settingsPanelState) this.settingsPanelState.glyphStyle = next.glyphStyle;
    return true;
  }

  /**
   * Starts the welcome for a new presentation. External providers are
   * captured once in the background; failure falls back to Vespyr quietly.
   */
  private startWelcome(cwd: string): void {
    const generation = ++this.welcomeGeneration;
    const provider = this.promptConfiguration.welcome;
    const vespyr = () => this.output.setWelcome(createWelcomeSnapshot(this.buildIdentity, cwd, this.shellId, this.welcomeUnderstanding()));
    if (provider === 'none') return;
    if (provider === 'vespyr') { vespyr(); return; }
    void captureWelcome(provider, cwd).then(result => {
      if (generation !== this.welcomeGeneration || this.stopped) return;
      if (result.ok) this.output.setWelcome({...createWelcomeSnapshot(this.buildIdentity, cwd, this.shellId, this.welcomeUnderstanding()), provider, captured: result.lines});
      else {
        vespyr();
        this.output.addHistoryLine(`${SUBTLE}${welcomeProvider(provider).label} welcome ${result.reason}; showing Vespyr.${RESET}`);
      }
      this.render();
    });
  }

  /** History loads in the background after startup; suggestions refine once it is indexed. */
  private async loadHistory(): Promise<void> {
    this.historyQuery = undefined;
    this.historyQueryAbort?.abort();
    this.historyResults = [];
    try { if (!await this.historyService.reload(this.promptConfiguration.history)) return; } catch {
      if (this.stopped) return;
      this.output.addFrontendInteraction('/history', 'Command history is unavailable; check local storage.', ERROR);
      return;
    }
    this.historyQuery = undefined;
    if (this.stopped) return;
    await this.nativeSuggestions.loadInChunks(this.historyService.getEntries());
    if (this.stopped) return;
    this.suggestions.refresh();
    this.render();
  }

  /** Suggestions apply to plain shell input at the end of the buffer only. */
  private suggestionGhost(): string | undefined {
    const text = this.editor.text;
    if (this.editor.hasPasteAtoms || this.historySearchActive || text.startsWith('/')) {
      this.suggestions.reset();
      return undefined;
    }
    this.suggestions.update({buffer: text, cwd: this.shellCwd, previous: this.submittedCommands, now: Date.now()},
      this.promptConfiguration.suggestionsOnEmpty && !this.running);
    return this.suggestions.ghost(text);
  }

  /**
   * Suggestion keys never steal an existing binding: word-right only accepts
   * at the end of the buffer, Ctrl+N/Ctrl+P were unbound, and Up/Down/Enter
   * act on alternatives only while that list is open.
   */
  private handleSuggestionKey(key: Key): boolean {
    const buffer = this.editor.text;
    const atEnd = this.editor.cursorIndex === graphemes(buffer).length && !this.editor.hasPasteAtoms;
    if (key.kind === 'suggestNext' || key.kind === 'suggestPrevious') {
      this.suggestions.cycle(key.kind === 'suggestNext' ? 1 : -1);
      return true;
    }
    if (this.suggestions.alternativesOpen) {
      if (key.kind === 'up' || key.kind === 'down') {
        this.suggestions.cycle(key.kind === 'down' ? 1 : -1);
        return true;
      }
      if (key.kind === 'right' || key.kind === 'lineEnd' || key.kind === 'bufferEnd' || key.kind === 'complete' || key.kind === 'enter') {
        const text = this.suggestions.acceptance(buffer);
        this.suggestions.alternativesOpen = false;
        if (text) {
          this.editor.clear();
          this.editor.insert(text);
        }
        return true;
      }
      if (key.kind === 'escape') return this.suggestions.dismiss(buffer);
      return false;
    }
    if (key.kind === 'wordRight' && atEnd) {
      const word = this.suggestions.nextWord(buffer);
      if (!word) return false;
      this.editor.insert(word);
      return true;
    }
    if (key.kind === 'escape') return this.suggestions.dismiss(buffer);
    return false;
  }

  /** External providers are detected in the background; Native answers until then and whenever they are unusable. */
  private applySuggestionProvider(): void {
    const id = this.promptConfiguration.suggestions;
    this.suggestions.setProvider(id === 'none' ? undefined : this.nativeSuggestions, this.nativeSuggestions);
    if (id !== 'deja') return;
    const descriptor = SUGGESTION_PROVIDERS.find(provider => provider.id === 'deja')!;
    void detectProvider(descriptor).then(status => {
      if (this.stopped || this.promptConfiguration.suggestions !== 'deja') return;
      const resolved = resolveProvider(SUGGESTION_PROVIDERS, 'deja', status, 'nmsh');
      if (resolved.id === 'deja' && status.binary) this.suggestions.setProvider(new DejaSuggestions(status.binary), this.nativeSuggestions);
      else if (resolved.notice) this.output.addHistoryLine(`${SUBTLE}${resolved.notice}${RESET}`);
      this.render();
    });
  }

  private startProviderPanel(family: 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation'): void {
    const state: ProviderPanelState = family === 'welcome'
      ? createProviderPanel(family, 'Welcome', WELCOME_PROVIDERS, this.promptConfiguration.welcome)
      : family === 'navigation' ? createProviderPanel(family, 'Directory navigation', NAVIGATION_PROVIDERS, this.promptConfiguration.navigation)
      : family === 'picker' ? createProviderPanel(family, 'Picker', PICKER_PROVIDERS, this.promptConfiguration.picker)
      : family === 'history' ? createProviderPanel(family, 'Command history', HISTORY_PROVIDERS, this.promptConfiguration.history)
      : createProviderPanel(family, 'Suggestions', SUGGESTION_PROVIDERS, this.promptConfiguration.suggestions);
    this.providerPanelState = state;
    this.welcomePreviews.clear();
    for (const provider of state.providers) {
      void detectProvider(provider).then(status => {
        state.statuses[provider.id] = status;
        if (this.providerPanelState === state) this.render();
      });
    }
  }

  /** The highlighted provider rendered by its own family; captures are cached per panel. */
  private providerPreview(state: ProviderPanelState, width: number): string[] {
    const selected = providerPanelSelection(state);
    if (state.family === 'navigation') return [`${SUBTLE}Find with /dirs; selecting inserts a visible cd command. Press Enter separately to navigate.${RESET}`];
    if (state.family === 'picker') return [`${SUBTLE}Selections restore the composer; cancel leaves it unchanged. Missing or failing tools use Native.${RESET}`];
    if (state.family === 'history') return [`${SUBTLE}${selected.id === 'atuin' ? 'Read-only local history; existing hooks unchanged; no sync.' : 'Shell-approved journal metadata and imported zsh history.'}${RESET}`];
    if (state.family === 'suggestions') {
      if (selected.id === 'none') return [`${SUBTLE}No ghost text while typing.${RESET}`];
      return [`${ACCENT}${GLYPHS.prompt}${RESET} git st${SECONDARY}atus${RESET}   ${SUBTLE}→ / End accept · Alt+→ next word · Ctrl+N/P alternatives · Esc dismiss${RESET}`];
    }
    if (selected.id === 'none') return [`${SUBTLE}No welcome; new sessions start at the first command.${RESET}`];
    if (selected.id === 'vespyr') return renderWelcome(createWelcomeSnapshot(this.buildIdentity, this.shellCwd, this.shellId), width).map(row => row.ansi);
    if (state.statuses[selected.id]?.state !== 'installed') return [];
    const cached = this.welcomePreviews.get(selected.id);
    if (cached) return cached;
    this.welcomePreviews.set(selected.id, [`${SUBTLE}Running ${selected.label}…${RESET}`]);
    void captureWelcome(selected.id as Exclude<PromptConfiguration['welcome'], 'vespyr' | 'none'>, this.shellCwd).then(result => {
      this.welcomePreviews.set(selected.id, result.ok
        ? renderWelcome({...createWelcomeSnapshot(this.buildIdentity, this.shellCwd, this.shellId), captured: result.lines}, width).map(row => row.ansi)
        : [`${SUBTLE}${selected.label} failed: ${result.reason}${RESET}`]);
      if (this.providerPanelState === state) this.render();
    });
    return this.welcomePreviews.get(selected.id)!;
  }

  private async handleProviderPanelKey(key: Key, state: ProviderPanelState): Promise<void> {
    if (state.step === 'installProgress') return;
    if (key.kind === 'escape' || key.kind === 'interrupt') {
      if (state.step === 'installConfirm') state.step = 'list';
      else { this.providerPanelState = undefined; this.returnFromPanel(); }
    } else if (key.kind === 'enter') {
      const selected = providerPanelSelection(state);
      const install = providerInstall(selected);
      if (state.step === 'installConfirm' && install) {
        state.step = 'installProgress';
        state.task = new TaskProgress(`Installing ${selected.label}`, () => this.renderTaskPresentation(), Date.now(), selected.label);
        this.render();
        const outcome = await state.task.run(install.command, [...install.args]);
        if (this.stopped) return;
        clearProviderDetection();
        state.statuses[selected.id] = await detectProvider(selected);
        state.step = 'list';
        if (outcome.status === 'succeeded' && state.statuses[selected.id]?.state === 'installed') {
          recordInstall(selected.executable ?? selected.id, install);
          // Installed and re-detected: use it right away, as the user asked.
          this.saveProviderChoice(state);
          this.milestoneEffect();
        } else {
          state.message = outcome.status === 'succeeded'
            ? `${install.label} finished, but ${selected.label} was not found on PATH; nothing was selected.`
            : `${selected.label} was not installed. ${state.task.state.error ?? ''}`.trim();
        }
      } else {
        const action = providerPanelEnterAction(state);
        if (action === 'installConfirm') state.step = 'installConfirm';
        else if (action === 'unavailable') state.message = installUnavailableReason(selected);
        else this.saveProviderChoice(state);
      }
    } else if (!handleProviderPanelKey(key, state)) return;
    this.render();
  }

  private saveProviderChoice(state: ProviderPanelState): void {
    const selected = providerPanelSelection(state);
    const next = state.family === 'welcome'
      ? {...structuredClone(this.promptConfiguration), welcome: selected.id as PromptConfiguration['welcome']}
      : state.family === 'navigation' ? {...structuredClone(this.promptConfiguration), navigation: selected.id as PromptConfiguration['navigation']}
      : state.family === 'picker' ? {...structuredClone(this.promptConfiguration), picker: selected.id as PromptConfiguration['picker']}
      : state.family === 'history' ? {...structuredClone(this.promptConfiguration), history: selected.id as PromptConfiguration['history']}
      : {...structuredClone(this.promptConfiguration), suggestions: selected.id as PromptConfiguration['suggestions']};
    try {
      savePromptConfiguration(next, undefined, this.promptConfiguration);
      this.promptConfiguration = next;
      this.providerPanelState = undefined;
      if (state.family === 'suggestions') this.applySuggestionProvider();
      if (state.family === 'history') void this.loadHistory();
      if (state.family === 'navigation') { this.directoryQueryAbort?.abort(); this.directoryQuery = undefined; this.directoryResults = []; }
      this.output.addHistoryLine(state.family === 'welcome'
        ? `${SUCCESS}Welcome · ${selected.label} · shown on launch and /clear.${RESET}`
        : `${SUCCESS}${state.title} · ${selected.label}.${RESET}`);
    } catch (error) {
      state.message = `Could not save: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private startTranscriptSettings(): void {
    const saved = structuredClone(this.promptConfiguration.transcript);
    const folding = this.promptConfiguration.outputFolding;
    this.transcriptPanelState = {selectedIndex: 0, draft: structuredClone(saved), saved, folding: {draft: folding, saved: folding}};
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
    const next = {...structuredClone(this.promptConfiguration), transcript: structuredClone(state.draft),
      outputFolding: state.folding?.draft ?? this.promptConfiguration.outputFolding};
    try {
      savePromptConfiguration(next, undefined, this.promptConfiguration);
      this.promptConfiguration = next;
      this.output.setTranscriptAppearance(next.transcript);
      this.output.setOutputFolding(next.outputFolding);
    this.output.presenter.setTreatment(next.presentation);
      this.transcriptPanelState = undefined;
      this.output.addHistoryLine(`${SUCCESS}Transcript settings saved.${RESET}`);
    } catch (error) {
      state.message = `Could not save transcript settings: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.render();
  }

  private startLayoutSettings(): void {
    const {composerPosition, transcriptPresentation} = this.promptConfiguration;
    this.layoutPanelState = createLayoutPanel({composerPosition, transcriptPresentation});
  }

  /** Persist the chosen layout and apply it live; the preview itself never touched the real transcript. */
  private saveLayoutSettings(): void {
    const state = this.layoutPanelState;
    if (!state) return;
    const next = {...structuredClone(this.promptConfiguration), ...state.draft};
    this.applySettingsConfiguration(next);
    if (this.promptConfiguration !== next) {
      state.message = 'Could not save the layout; check that the NMSh configuration directory is writable.';
      this.render();
      return;
    }
    this.layoutPanelState = undefined;
    this.historyViewport.latest();
    this.returnFromPanel();
    this.output.addHistoryLine(`${SUCCESS}Layout saved.${RESET}`);
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
      savePromptConfiguration(next, undefined, this.promptConfiguration);
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
    const state = this.promptPanelState;
    if (!state) return [];
    return this.withDraftTheme(state.draft, () => this.renderPromptPanelRows(state, columns));
  }

  private renderPromptPanelRows(state: PromptPanelState, columns: number): string[] {
    const now = Date.now();
    const preview = state.step.startsWith('install') ? [] : this.chromaPanelActive(state) ? this.chromaPanelPreview(columns, now) : this.promptPanelPreview(columns);
    const stops = themeChromaStops(state.draft.nmsh.palette, state.draft.nmsh.vibrance);
    const full = renderPromptPanel(state, columns, preview, this.promptThemePreviews(columns, now), this.dimensions().rows - 1,
      this.promptGitShowcase(columns), stops);
    // Short terminals keep the editable rows and live preview; the theme gallery goes first, then preview lines.
    const budget = this.dimensions().rows - 3;
    if (full.length <= budget) return full;
    const compact = renderPromptPanel(state, columns, preview, [], this.dimensions().rows - 1, [], stops);
    const overflow = compact.length - budget;
    if (overflow <= 0 || !preview.length) return compact;
    return renderPromptPanel(state, columns, preview.slice(0, Math.max(1, preview.length - overflow)), [], this.dimensions().rows - 1, [], stops);
  }

  private chromaPanelActive(state: PromptPanelState): boolean {
    return state.step === 'gradient' || (state.step === 'appearance' && state.view === 'chroma');
  }

  /** The Chroma draft (including stops being edited) the previews render. */
  private chromaPreviewDraft(state: PromptPanelState): PromptConfiguration {
    const draft = structuredClone(state.draft);
    // Previews show the Native treatment even while an external provider is selected.
    draft.provider = 'nmsh';
    if (state.step === 'gradient' && state.gradient && state.gradient.stops.length >= 2) {
      draft.presentation = {...draft.presentation, preset: 'custom', customStops: [...state.gradient.stops]};
    }
    return draft;
  }

  /**
   * Chroma preview: the user's current prompt (live context, saved style,
   * theme, vibrance, modules, icons) and the synthetic full-module showcase,
   * both through the real renderer with the draft treatment at `now`.
   */
  private chromaPanelPreview(columns: number, now: number): string[] {
    const state = this.promptPanelState!;
    const width = Math.max(1, columns - 16);
    const draft = this.chromaPreviewDraft(state);
    const label = (text: string) => `  ${SECONDARY}${text.padEnd(12)}${RESET}`;
    const current = buildContextLine(this.promptContext(), width, draft, 'composer', now);
    const showcase = structuredClone(draft);
    showcase.modules = showcase.modules.map(module => ({...module, visible: true}));
    return [`${label('Current')}${current}${RESET}`, `${label('Showcase')}${buildContextLine(moduleShowcaseContext(), width, showcase, 'composer', now)}${RESET}`];
  }

  /** Panels with an animated Chroma preview repaint on the shared clock; nothing ticks otherwise. */
  private syncPanelAnimation(): void {
    const state = this.promptPanelState;
    const animated = Boolean(state && this.chromaPanelActive(state) && treatmentAnimated(this.chromaPreviewDraft(state).presentation)
      && colorLevel() !== 'none' && !this.stopped);
    if (animated && !this.panelAnimation) this.panelAnimation = presentationClock.subscribe(() => this.render(), 120);
    if (!animated && this.panelAnimation) { this.panelAnimation(); this.panelAnimation = undefined; }
  }

  /** Previews of a draft see its accent and custom theme; the live context is restored afterwards. */
  private withDraftTheme<T>(draft: PromptConfiguration, render: () => T): T {
    const live = themeContext();
    const symbol = {nerd: promptSymbolGlyph(this.configuration.promptSymbol, this.configuration.promptSymbolCustom, true),
      safe: promptSymbolGlyph(this.configuration.promptSymbol, this.configuration.promptSymbolCustom, false)};
    const config = this.configuration;
    setThemeContext(draft.nmsh.accent, draft.customTheme);
    setPromptSymbol(promptSymbolGlyph(draft.promptSymbol, draft.promptSymbolCustom, true), promptSymbolGlyph(draft.promptSymbol, draft.promptSymbolCustom, false));
    // The draft's chrome and Current Theme stops too, so previews show what Apply would show.
    applyUiTheme(uiColorsFor(resolveChrome(draft.uiChrome, draft.nmsh.palette, draft.nmsh.accent, draft.customTheme)));
    setActiveThemeStops(themeChromaStops(draft.nmsh.palette, draft.nmsh.vibrance));
    try { return render(); } finally {
      setThemeContext(live.accent, live.custom);
      setPromptSymbol(symbol.nerd, symbol.safe);
      applyUiTheme(uiColorsFor(resolveChrome(config.uiChrome, config.nmsh.palette, config.nmsh.accent, config.customTheme)));
      setActiveThemeStops(themeChromaStops(config.nmsh.palette, config.nmsh.vibrance));
    }
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
  private promptThemePreviews(columns: number, now = Date.now()): string[] {
    const state = this.promptPanelState;
    if (!state || state.step !== 'appearance' || state.view === 'git') return [];
    if (state.view === 'chroma') {
      // One row per palette: the showcase prompt in the draft style, theme and vibrance.
      const width = Math.max(1, columns - 20);
      const draft = this.chromaPreviewDraft(state);
      return TREATMENT_PRESETS.map(preset => buildThemePreviewLine({...draft, presentation: {...draft.presentation, preset,
        customStops: draft.presentation.customStops.length ? draft.presentation.customStops : [...PRESET_STOPS.lavender]}},
      draft.nmsh.palette, width, now));
    }
    const width = Math.max(1, columns - 22);
    return galleryPalettes(state.draft).map(palette => buildThemePreviewLine(state.draft, palette, width));
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

  private currentPromptLine(width: number, time = Date.now()): string {
    if (this.effectivePromptProvider !== 'nmsh' && this.externalPrompt) {
      return this.externalPromptRow(this.externalPrompt, width, this.promptConfiguration.placement, time);
    }
    return buildContextLine(this.promptContext(), width, this.promptConfiguration, this.promptConfiguration.placement, time);
  }

  /** Animated Chroma on the Native prompt row needs presentation frames; external prompts never do. */
  private promptChromaAnimated(): boolean {
    return this.effectivePromptProvider === 'nmsh' && treatmentAnimated(this.promptConfiguration.presentation) && colorLevel() !== 'none';
  }

  /**
   * Blink the welcome cat occasionally. The frame lives on OutputBuffer as
   * presentation state, so transcript contents, row count, and width never
   * change. Blinks are skipped (not queued) while no welcome is present.
   */
  private scheduleWelcomeBlink(): void {
    if (this.stopped || !this.decorativeMotionAllowed() || !this.output.hasWelcome) return;
    this.welcomeBlinkTimer = presentationClock.after(() => {
      this.welcomeBlinkTimer = undefined;
      if (this.stopped || !this.decorativeMotionAllowed()) return;
      if (!this.output.hasWelcome || this.passthrough) {
        this.welcomeBlinkCount += 1;
        this.scheduleWelcomeBlink();
        return;
      }
      this.output.setWelcomeFrame('blink');
      this.welcomeBlinkTimer = presentationClock.after(() => {
        this.welcomeBlinkTimer = undefined;
        this.output.setWelcomeFrame('open');
        if (this.stopped) return;
        this.welcomeBlinkCount += 1;
        this.scheduleWelcomeBlink();
        this.render();
      }, WELCOME_BLINK_CLOSED_MS);
      this.render();
    }, welcomeBlinkDelay(this.welcomeBlinkCount));
  }

  /** External provider content follows the native placement rule: the divider fill only in header placement. */
  private externalPromptRow(prompt: StarshipPromptResult, width: number, placement: PromptConfiguration['placement'], time = Date.now()): string {
    const content = truncateAnsi(prompt.ansi, Math.max(0, width - 1));
    if (placement === 'composer') return `${content}${RESET}`;
    return `${content}${RESET}${paintDivider(repeatToWidth(GLYPHS.separator, Math.max(0, width - displayWidth(content))), this.promptConfiguration.presentation, time)}${RESET}`;
  }

  private scroll(direction: -1 | 1): void {
    const {columns} = this.dimensions();
    const outputHeight = this.transcriptViewportHeight();
    const total = this.output.wrapped(columns).length;
    this.historyViewport.resolve(total, outputHeight);
    this.historyViewport.page(total, outputHeight, direction);
  }

  private scrollLines(amount: number): void {
    const {columns} = this.dimensions();
    const outputHeight = this.transcriptViewportHeight();
    const total = this.output.wrapped(columns).length;
    this.historyViewport.resolve(total, outputHeight);
    this.historyViewport.scrollLines(total, outputHeight, amount);
  }

  /** Scroll paging needs at least one row even when the plan leaves the transcript empty. */
  private transcriptViewportHeight(): number {
    const {columns, rows} = this.dimensions();
    return this.planFrame(columns, rows).viewportRows;
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

  /** Interactive history search is the editor state `/history <query>`; it never reaches zsh or the transcript. */
  private get historySearchActive(): boolean {
    return !this.editor.hasPasteAtoms && this.editor.text.startsWith(HISTORY_SEARCH);
  }

  private clearCorrection(): void {
    this.correctionAbort?.abort(); this.correctionAbort = undefined; this.correction = undefined;
  }

  private async suggestCorrection(command: string, exitCode: number, output: string): Promise<void> {
    this.clearCorrection();
    if (exitCode !== 127 || this.editor.text || this.running) return;
    const active = new AbortController();
    this.correctionAbort = active;
    const correction = await this.correctionService.suggest(command, exitCode, output, active.signal);
    if (!this.stopped && !active.signal.aborted && !this.editor.text && !this.running && this.correctionAbort === active) {
      this.correction = correction; this.render();
    }
  }

  private get directorySearchActive(): boolean {
    return !this.editor.hasPasteAtoms && this.editor.text.startsWith(DIRECTORY_SEARCH);
  }

  private directoryMatches(query: string): Array<{name: string; insertion: string; description: string}> {
    if (query !== this.directoryQuery) {
      this.directoryQuery = query;
      this.directoryQueryAbort?.abort();
      const active = new AbortController();
      this.directoryQueryAbort = active;
      this.directoryResults = [];
      void this.directoryService.query(this.historyService.index.all(), query, this.promptConfiguration.navigation, active.signal).then(items => {
        if (this.stopped || active.signal.aborted || this.directoryQuery !== query) return;
        this.directoryResults = items; this.selectedSuggestion = 0; this.render();
      }).catch(() => {});
    }
    return this.directoryResults.map(item => ({name: item.path, insertion: directoryCommand(item.path),
      description: [item.project, item.visits === undefined ? 'zoxide' : `${item.visits} visits`].filter(Boolean).join(' · ')}));
  }

  private historyMatches(query: string): Array<{id: string; name: string; insertion: string; description: string}> {
    if (query !== this.historyQuery) {
      this.historyQuery = query;
      this.historyQueryAbort?.abort();
      const active = new AbortController();
      this.historyQueryAbort = active;
      this.historyResults = [];
      const ranked = this.historyService.status.active === 'native'
        ? this.historyService.searchRanked(query, {cwd: this.shellCwd, project: this.context.project, session: this.journal?.id ?? this.sessionId, now: Date.now()}, active.signal)
        : this.historyService.search(query, active.signal);
      void ranked.then(entries => {
        if (this.stopped || active.signal.aborted || this.historyQuery !== query) return;
        this.historyResults = entries;
        this.selectedSuggestion = 0;
        this.render();
      }).catch(() => {});
    }
    return this.historyResults.map(entry => ({id: entry.id, name: entry.command.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' '), insertion: entry.command,
      description: ['count' in entry && typeof entry.count === 'number' && entry.count > 1 ? `×${entry.count}` : undefined,
        entry.agent ? `agent ${entry.agent}` : undefined, entry.exitCode === undefined ? undefined : `exit ${entry.exitCode}`,
        entry.durationMs === undefined ? undefined : `${entry.durationMs}ms`, entry.cwd, entry.project].filter(Boolean).join(' · ') || 'History'}));
  }

  /** Composer suggestion rows for the current editor state; the same list render paints and geometry counts. */
  private composerSuggestions(): any[] {
    if (this.running || this.settingsPanelActive) return [];
    if (this.correction && this.editor.text.length === 0) return [this.correction];
    if (this.directorySearchActive) return this.directoryMatches(this.editor.text.substring(DIRECTORY_SEARCH.length));
    if (this.historySearchActive) return this.historyMatches(this.editor.text.substring(HISTORY_SEARCH.length));
    if (!this.editor.hasPasteAtoms && this.editor.text.startsWith('/')) return slashSuggestions(this.editor.text);
    const alternatives = this.suggestions.alternatives();
    if (alternatives.items.length > 0) return alternatives.items.map(item => ({name: item.text, description: ''}));
    return this.shellSuggestions;
  }

  /**
   * The one screen plan for the current state. Render, hit-testing, scroll,
   * focus, cursor and PTY sizing all call this instead of counting rows.
   */
  private inspectorRows(columns: number): string[] {
    if (!this.inspectorVisible || this.running || this.settingsPanelActive || this.editor.hasPasteAtoms) return [];
    if (this.editor.text.startsWith('/')) {
      const slash = describeSlashCommand(this.editor.text);
      return slash ? [truncateText(`Inspect ${this.editor.text.trim().split(/\s+/u)[0]}`, columns), truncateText(slash, columns)] : [];
    }
    const context = inspectCommand(this.editor.text, this.editor.cursorIndex, this.shellCwd, this.shellSuggestions, this.semanticService.cache);
    if (!context || context.kind !== 'command' || context.value !== context.command) return renderInspector(context, columns);
    return renderInspector(context, columns, describeCommandSource(context.value, this.commandSource(context.value)));
  }

  /** Cached source lookup; a miss is resolved off the keypress path and re-renders when known. */
  private commandSource(word: string): CommandSource | undefined {
    if (this.commandSources.has(word)) return this.commandSources.get(word) ?? undefined;
    if (this.commandSources.size >= 512) this.commandSources.delete(this.commandSources.keys().next().value!);
    this.commandSources.set(word, null);
    void this.semanticService.resolveSource(word).then(source => {
      if (this.stopped) return;
      if (source) this.commandSources.set(word, source); else this.commandSources.delete(word);
      if (source && this.inspectorVisible) this.render();
    });
    return undefined;
  }

  private planFrame(
    columns: number,
    rows: number,
    fullInput = this.layoutEditorInput(columns),
    suggestions = this.composerSuggestions().length,
    panelRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : undefined,
  ): ScreenPlan {
    // The status strip owns one top row only when it is on, fits, and no panel owns the screen.
    if (panelRows === undefined && this.stripActive(columns, rows)) return withStatusRow(this.planWithNotices(columns, rows - 1, fullInput, suggestions, panelRows));
    return this.planWithNotices(columns, rows, fullInput, suggestions, panelRows);
  }

  private planWithNotices(columns: number, rows: number, fullInput: ReturnType<TerminalApp['layoutEditorInput']>, suggestions: number,
    panelRows: number | undefined): ScreenPlan {
    const find = panelRows === undefined ? this.searchChrome(columns).length : 0;
    const count = panelRows === undefined ? this.noticeRows(columns).length : 0;
    // Notices never squeeze the composer or transcript out: small screens simply do not show them.
    const notices = count > 0 && rows - find >= 12 + count ? count : 0;
    const plan = this.planComposer(columns, rows - notices - find, fullInput, suggestions, panelRows);
    // The find bar sits right above the composer, notices above it.
    return withNoticeRows(withNoticeRows(plan, find, 'find'), notices);
  }

  /** One compact line per notice (max three, the last may summarize overflow). */
  private noticeRows(columns: number): string[] {
    // The agent shelf shares this chrome slot (and the screen plan's rows): hidden at rest, never a permanent row.
    const shelf = this.shelfRow(columns);
    const rows = [...this.sessionNoticeRows(columns), ...this.taskRows(columns)];
    return shelf ? [...rows, shelf] : rows;
  }

  /** Live rows for NMSh-managed tasks (shared live-activity look); finished ones linger briefly, then go. */
  private taskRows(columns: number): string[] {
    if (this.passthrough || this.externalPassthrough) return [];
    const now = Date.now();
    const still = this.promptConfiguration.presentation.reducedMotion || this.promptConfiguration.presentation.effectsOff || isReducedMotion();
    return this.managedTasks.tasks.filter(task => !task.endedAt || now - task.endedAt < 8000).map(task => {
      const live = task.status === 'starting' || task.status === 'running' || task.status === 'waiting' || task.status === 'stopping';
      const url = task.urls[0];
      if (!live) return truncateAnsi(`${task.status === 'failed' ? ERROR : SUCCESS}${task.status === 'failed' ? GLYPHS.failure : GLYPHS.success}${RESET} ${SECONDARY}${task.label} ${task.status === 'failed' ? `failed · exit ${task.exitCode ?? '?'}` : 'stopped'}${RESET}`, columns);
      return truncateAnsi(liveLine(task.label, [task.status === 'running' ? undefined : task.status, url].filter(Boolean).join(' · ') || undefined, task.startedAt, now, {still}), columns);
    });
  }

  /** A ticking clock only while a managed task is live (its elapsed time and shimmer); none otherwise. */
  private syncTaskClock(): void {
    const live = this.managedTasks.live().length > 0;
    if (live && !this.taskClock) this.taskClock = presentationClock.subscribe(() => { if (!this.stopped) this.render(); }, 250);
    else if (!live && this.taskClock) { this.taskClock(); this.taskClock = undefined; setTimeout(() => { if (!this.stopped) this.render(); }, 8100).unref(); }
  }

  private shelfRow(columns: number): string | undefined {
    if (this.passthrough || this.externalPassthrough || !this.agents.sessions.length) return undefined;
    const attention = this.agents.sessions.some(session => session.attention);
    if (!this.shelf.visible && !this.shelf.focused && !attention) return undefined;
    return renderShelf(this.agents.sessions, columns, Date.now(), this.shelf.selected, this.shelf.focused) || undefined;
  }

  private sessionNoticeRows(columns: number): string[] {
    if (!this.promptConfiguration.sessionNotices || this.passthrough) return [];
    const {notices, hidden} = this.noticeView;
    const now = Date.now();
    const safe = getCurrentGlyphMode() === 'safe';
    const symbols = {done: safe ? '+' : '✦', attention: safe ? '!' : '◆', failed: safe ? 'x' : '×', ended: safe ? '-' : '○', long: safe ? '~' : '◷'};
    const rows = notices.map(notice => {
      const parts = describeNotice(notice, this.noticeLabels.get(notice.sessionId) ?? sessionLabel(notice.sessionId), now);
      const color = parts.symbol === 'failed' ? ERROR : parts.symbol === 'attention' ? ACCENT : parts.symbol === 'done' ? SUCCESS : SECONDARY;
      return truncateAnsi(`${color}${symbols[parts.symbol]}${RESET} ${SECONDARY}${parts.text}${RESET}`, columns);
    });
    if (hidden > 0) rows.push(truncateAnsi(`${SECONDARY}… ${hidden} more session update${hidden === 1 ? '' : 's'} · /resume · /notices clear${RESET}`, columns));
    return rows;
  }

  /** Poll the service's session list on a slow cadence while notices are on and NMSh owns the screen. */
  private syncNotices(): void {
    const wanted = this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended
      && this.sessionMode === 'service' && this.promptConfiguration.sessionNotices;
    if (wanted && !this.noticeTimer) {
      this.noticeTimer = presentationClock.subscribe(() => void this.refreshNotices(), NOTICE_REFRESH_MS);
      void this.refreshNotices();
    } else if (!wanted && this.noticeTimer) {
      this.noticeTimer(); this.noticeTimer = undefined;
    }
    if (!wanted && !this.promptConfiguration.sessionNotices && this.noticeView.notices.length) this.noticeView = {notices: [], hidden: 0};
  }

  private async refreshNotices(): Promise<void> {
    if (this.noticePolling) return;
    this.noticePolling = true;
    try {
      const {sessions, ended} = await listSessionNotices();
      if (this.stopped) return;
      const ordered = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
      this.noticeLabels = new Map(ordered.map((session, index) => [session.id, sessionLabel(session.id, index + 1)]));
      const all: SessionNotice[] = [...sessions.flatMap(session => (session.notice ? [session.notice] : [])), ...ended];
      const next = selectNotices(all, this.sessionId, this.dismissedNotices);
      const changed = JSON.stringify(next) !== JSON.stringify(this.noticeView);
      this.noticeView = next;
      if (changed) this.render();
    } catch { /* notices are best effort */ } finally { this.noticePolling = false; }
  }

  /** Clear every visible notice, for every attached frontend where the service supports it. */
  private async clearNotices(): Promise<void> {
    const shown = [...this.noticeView.notices];
    for (const notice of shown) this.dismissedNotices.add(noticeKey(notice));
    this.noticeView = {notices: [], hidden: 0};
    await Promise.all(shown.map(notice => dismissSessionNotice(notice.sessionId)));
    await this.refreshNotices();
  }

  private stripActive(columns: number, rows: number): boolean {
    return stripVisible(this.promptConfiguration.statusStrip, columns, rows);
  }

  private statusStripRow(columns: number): string {
    return renderStatusStrip(this.promptConfiguration.statusStrip, this.stripStats, columns);
  }

  /** One timer while the strip is on and NMSh owns the screen; none otherwise. */
  private syncStatusStrip(): void {
    const wanted = this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended
      && this.promptConfiguration.statusStrip.enabled;
    if (wanted && !this.stripTimer) {
      this.stripTimer = presentationClock.subscribe(() => void this.sampleStrip(), STRIP_REFRESH_MS);
      void this.sampleStrip();
    } else if (!wanted && this.stripTimer) {
      this.stripTimer(); this.stripTimer = undefined;
    }
  }

  private async sampleStrip(): Promise<void> {
    if (this.stripSampling) return;
    this.stripSampling = true;
    try {
      const {columns} = this.dimensions();
      const before = this.statusStripRow(columns);
      this.stripStats = await this.statsSource.sample();
      // The clock also moves without new stats; repaint only when the row text changes.
      if (this.stripTimer && !this.stopped && this.statusStripRow(columns) !== before) this.render();
    } catch { /* A failed sample keeps the previous values. */ }
    finally { this.stripSampling = false; }
  }

  private openPanel?: OpenPanelState;

  private hostActions(): HostActionAdapter {
    return resolveHostActions(this.promptConfiguration.openWith);
  }

  /** path:line references in the newest outputs, each with the cwd its command ran in. */
  private recentReferences(): OpenPanelState['references'] {
    const references: OpenPanelState['references'] = [];
    for (let index = 1; index <= 5 && references.length < 200; index += 1) {
      const record = this.output.recentShell(index);
      if (!record) break;
      const cwd = record.historicalContext?.cwd ?? this.shellCwd;
      const lines = stripAnsi(record.output).split('\n').slice(-2000).reverse();
      for (const line of lines) for (const reference of findSourceReferences(line)) {
        if (!references.some(item => item.text === reference.text && item.cwd === cwd)) references.push({...reference, cwd, command: record.command});
      }
    }
    return references;
  }

  /** Delegate a location to the editor; relative paths resolve against the command's own cwd. */
  private async openLocation(command: string, target: string, cwd: string): Promise<void> {
    const report = (message: string, style: string) => { this.output.addFrontendInteraction(command, message, style); this.render(); };
    const parsed = parseOpenArgument(target);
    if (!parsed) return report('Usage: /open <path>[:line[:column]]', INFO);
    const resolved = resolveLocation(parsed, cwd);
    if (!resolved.ok) return report(resolved.reason, ERROR);
    const adapter = this.hostActions();
    const action = resolved.kind === 'directory' ? adapter.openDirectory(resolved.location.path) : adapter.openFile(resolved.location);
    await this.performHostAction(action, report);
  }

  private async openDiff(command: string, left: string, right: string): Promise<void> {
    const report = (message: string, style: string) => { this.output.addFrontendInteraction(command, message, style); this.render(); };
    if (!left || !right) return report('Usage: /open-diff <old-file> <new-file> (opens your editor\'s diff view)', INFO);
    const paths: string[] = [];
    for (const side of [left, right]) {
      const resolved = resolveLocation({path: side}, this.shellCwd);
      if (!resolved.ok) return report(resolved.reason, ERROR);
      if (resolved.kind !== 'file') return report(`${resolved.location.path} is a directory; /open-diff compares two files.`, ERROR);
      paths.push(resolved.location.path);
    }
    await this.performHostAction(this.hostActions().openDiff(paths[0]!, paths[1]!), report);
  }

  private async performHostAction(action: HostAction, report: (message: string, style: string) => void): Promise<void> {
    if (action.kind === 'unsupported') return report(action.reason, INFO);
    if (action.kind === 'compose') {
      // Terminal editors take over the terminal: the exact command goes in the composer for you to run.
      const quote = this.shellId === 'fish' ? fishQuote : posixQuote;
      const line = action.argv.map(arg => (/^[\w@%+=:,./-]+$/u.test(arg) ? arg : quote(arg))).join(' ');
      this.editor.clear();
      this.editor.insert(line);
      return report(`Ready to open in ${action.label}: press Enter to run it.`, INFO);
    }
    const failure = await runHostAction(action);
    report(failure ? `Could not start ${action.label}: ${failure}` : `Opened in ${action.label}.`, failure ? ERROR : INFO);
  }

  /** Changes whenever presented rows may have changed; matches are recomputed only then. */
  private findGeneration(wrapped: readonly WrappedRow[], columns: number): string {
    const filter = this.output.activeFilter;
    return `${wrapped.length}|${columns}|${this.lastOutputTime}|${filter ? JSON.stringify(filter) : ''}`;
  }

  private revealFindMatch(totalRows: number, height: number): void {
    const result = this.findState?.results[this.findState.active];
    if (!result) return;
    this.historyViewport.scrollLines(totalRows, height, revealStart(result.row, totalRows, height) - this.historyViewport.resolve(totalRows, height));
  }

  /** The block a block-scoped action targets: the focused block, else the newest completed one. */
  private targetBlockStartId(): number | undefined {
    const index = this.focusedCommandIndex ?? 0;
    return this.output.recent(index + 1)?.startId;
  }

  /** Ctrl+F or /find alone: a fresh clause input; applied clauses stay. */
  private openFindEditor(): void {
    this.findState ??= createFind();
    this.findState.editing = {query: '', options: {regex: false, caseSensitive: false}};
  }

  private findCommand(command: string, argumentsText: string): void {
    const parsed = parseSearchCommand(argumentsText);
    const say = (message: string, style = INFO) => this.output.addFrontendInteraction(command, message, style);
    if (parsed.kind === 'open') { this.openFindEditor(); return; }
    if (parsed.kind === 'clear') { this.findState = undefined; say('Find cleared.'); return; }
    if (parsed.kind === 'remove') {
      const clauses = this.findState?.clauses ?? [];
      if (parsed.index < 1 || parsed.index > clauses.length) { say(`No find term ${parsed.index}; ${clauses.length} active.`, ERROR); return; }
      clauses.splice(parsed.index - 1, 1);
      if (!clauses.length && !this.findState?.editing) this.findState = undefined;
      return;
    }
    if (!parsed.parsed.query) { this.openFindEditor(); return; }
    const check = compileQuery(parsed.parsed.query, parsed.parsed.options);
    if (!check.ok) { say(`Invalid regular expression: ${check.error}`, ERROR); return; }
    if (!this.findState) {
      const block = parsed.parsed.block ? this.targetBlockStartId() : undefined;
      this.findState = createFind(block === undefined ? 'transcript' : 'block', block);
    }
    // Repeated /find adds a clause: every clause must match the same logical line (AND).
    this.findState.clauses.push({query: parsed.parsed.query, options: parsed.parsed.options});
  }

  /** Find and filter status above the composer: at most two rows. */
  private searchChrome(columns: number): string[] {
    const find = this.findState;
    const filter = this.output.activeFilter;
    const safe = getCurrentGlyphMode() === 'safe';
    return searchChromeRows(find ? {clauses: find.clauses, ...(find.editing ? {editing: find.editing} : {}), count: findCount(find), error: Boolean(find.error)} : undefined,
      filter ? {clauses: filter.clauses} : undefined, columns,
      {accent: ACCENT, primary: PRIMARY, secondary: SECONDARY, subtle: SUBTLE, error: ERROR, reset: RESET},
      safe ? {find: '/', filter: '|'} : {find: '⌕', filter: '⧩'}).map(row => truncateAnsi(row, columns));
  }

  /**
   * Find editor keys (while a clause is being typed). Enter applies a typed
   * clause, or with an empty input steps to the older match; Shift+Enter steps
   * newer; Tab cycles the clause's options; Esc discards only the input.
   * Returns false for keys the editor does not own.
   */
  private handleFindKey(key: Key): boolean {
    const state = this.findState!;
    const editing = state.editing;
    if (!editing) return false;
    const {columns, rows} = this.dimensions();
    const step = (direction: 'next' | 'previous') => {
      stepFind(state, direction);
      const total = this.output.wrapped(columns).length;
      this.revealFindMatch(total, this.planFrame(columns, rows).viewportRows);
    };
    if (key.kind === 'escape' || key.kind === 'interrupt') {
      state.editing = undefined;
      if (!state.clauses.length) this.findState = undefined;
    } else if (key.kind === 'enter') {
      if (editing.query) {
        if (!compileQuery(editing.query, editing.options).ok) return true;
        state.clauses.push(editing);
        state.editing = {query: '', options: {regex: false, caseSensitive: false}};
      } else step('next');
    } else if (key.kind === 'up') step('next');
    else if (key.kind === 'newline' || key.kind === 'down') step('previous');
    else if (key.kind === 'complete') {
      // Tab cycles: plain → case-sensitive → regex → regex + case.
      const order = [[false, false], [false, true], [true, false], [true, true]] as const;
      const current = order.findIndex(([regex, caseSensitive]) => regex === editing.options.regex && caseSensitive === editing.options.caseSensitive);
      const [regex, caseSensitive] = order[(current + 1) % order.length]!;
      editing.options = {regex, caseSensitive};
    } else if (key.kind === 'text') editing.query += key.value;
    else if (key.kind === 'paste') editing.query += key.value.replace(/[\r\n]+/gu, ' ');
    else if (key.kind === 'backspace') editing.query = [...editing.query].slice(0, -1).join('');
    else if (key.kind === 'deleteWord' || key.kind === 'deleteLineBefore') editing.query = '';
    else if (key.kind === 'find') { /* already open */ }
    else return false;
    this.render();
    return true;
  }

  private applyFilterCommand(command: string, argumentsText: string): void {
    const parsed = parseSearchCommand(argumentsText);
    const say = (message: string, style = INFO) => { this.output.addFrontendInteraction(command, message, style); this.render(); };
    const current = this.output.activeFilter;
    if (parsed.kind === 'open' || parsed.kind === 'clear') {
      this.output.setOutputFilter(undefined);
      say(current ? 'Filter cleared; the complete output is shown again.' : 'No filter is active. /filter <text> shows only matching lines of the newest output.');
      return;
    }
    if (parsed.kind === 'remove') {
      if (!current || parsed.index < 1 || parsed.index > current.clauses.length) { say(`No filter term ${parsed.index}; ${current?.clauses.length ?? 0} active.`, ERROR); return; }
      const clauses = current.clauses.filter((_clause, index) => index !== parsed.index - 1);
      this.output.setOutputFilter(clauses.length ? {startId: current.startId, clauses} : undefined);
      this.render();
      return;
    }
    const {query, options, invert, context} = parsed.parsed;
    const check = compileQuery(query, options);
    if (!check.ok) { say(`Invalid regular expression: ${check.error}`, ERROR); return; }
    // Repeated /filter adds a clause to the same block's set (AND); it never moves to a newer block.
    const startId = current?.startId ?? this.targetBlockStartId();
    if (startId === undefined) { say('There is no command output to filter yet.', ERROR); return; }
    this.output.setOutputFilter({startId, clauses: [...(current?.clauses ?? []), {query, options, invert, context}]});
    this.historyViewport.latest();
    this.render();
  }

  private providersOverview?: ProvidersOverviewState;
  private cursorPanel?: CursorPanelState;
  private cursorPanelClock?: () => void;

  /** /cursor: the canonical cursor & effects surface; its preview animates only while it is open (and motion is allowed). */
  private openCursorPanel(): void {
    this.panelOrigin = undefined;
    this.cursorPanel = createCursorPanel(this.promptConfiguration.cursor);
    this.cursorPanelClock?.();
    this.cursorPanelClock = this.decorativeMotionAllowed() && colorLevel() !== 'none'
      ? presentationClock.subscribe(() => { if (this.cursorPanel && !this.stopped) this.render(); }, 33, 16) : undefined;
  }

  private closeCursorPanel(): void {
    this.cursorPanel = undefined;
    this.cursorPanelClock?.(); this.cursorPanelClock = undefined;
    this.returnFromPanel();
  }

  private handleCursorPanelKey(key: Key, state: CursorPanelState): void {
    const action = cursorPanelKey(state, key);
    if (!action) return;
    if (action.kind === 'close') { this.closeCursorPanel(); return; }
    if (action.kind === 'apply') {
      this.updateConfiguration(configuration => { configuration.cursor = action.settings; });
      this.renderer.setCursorStyle(cursorStyleSequence(action.settings.shape, action.settings.blink));
      // Native integration already set up: refresh NMSh's own managed files (never the host's main config).
      const host = this.cursorHost?.host;
      if (host && host !== 'other' && this.cursorHost?.integrated) { try { writeManagedFiles(host, action.settings); } catch { state.message = 'Could not update the managed cursor files.'; } }
      return;
    }
    const facts = this.cursorHost ?? hostCursorFacts(process.env, host => nativeCursorIntegrated(host));
    const host = facts.host === 'other' ? undefined : facts.host;
    if (action.kind === 'native') {
      if (!host || !nativeBackendFor(facts)) { state.message = 'This terminal has no native cursor effects NMSh can use; Portable works here.'; return; }
      if (facts.integrated) { state.message = `${nativeHostLabel(host)} native is already set up; changes here update NMSh's managed files.`; return; }
      const setup = setupPlan(host);
      const blocked = setup.plan.kind === 'refuse' ? setup.plan.reason : undefined;
      state.native = {host, configPath: setup.configPath, ...(setup.plan.kind === 'plan' || setup.plan.kind === 'noop' ? {line: includeLine(host)} : {}), related: setup.related,
        ...(blocked ? {blocked} : {}), choice: 'no'};
      return;
    }
    if (action.kind === 'nativeConfirm' && state.native) {
      const native = state.native;
      state.native = undefined;
      const setup = setupPlan(native.host);
      try { writeManagedFiles(native.host, state.draft); } catch { state.message = 'Could not write NMSh\'s managed cursor files; nothing else was changed.'; return; }
      if (setup.plan.kind === 'plan') {
        const applied = applyPlan(setup.plan.plan);
        if (!applied.ok) { state.message = applied.reason; return; }
      }
      this.cursorHost = hostCursorFacts(process.env, value => nativeCursorIntegrated(value));
      state.message = this.cursorHost.integrated ? `Set up. Reload ${nativeHostLabel(native.host)}'s config to see native effects; Renderer Auto now uses them.` : 'Setup did not verify; Portable stays in use.';
    }
  }
  private understandingPanel?: UnderstandingPanelState;

  /** The welcome's factual local-understanding text at presentation start; it never claims a model it has not seen loaded. */
  private welcomeUnderstanding(): string {
    return understandingWelcomeText(this.configuration.localUnderstanding, this.understanding?.status);
  }

  private async refreshUnderstandingDiscovery(again: boolean): Promise<void> {
    try { await this.understanding.discover(again); } catch { /* discovery is best effort */ }
    try { await this.understanding.refreshStatus(); } catch { /* no service: idle */ }
  }

  /** /providers' Local understanding row: what is in use, and the facts behind it. */
  private understandingSummary(): {active: string; detail: string[]} {
    const settings = this.promptConfiguration.localUnderstanding;
    const loaded = this.understanding.status && (this.understanding.status.state === 'ready' || this.understanding.status.state === 'busy');
    const active = settings.mode === 'off' || !settings.model ? 'Built-in' : loaded ? `${settings.model.label}` : `Built-in (${settings.model.label} idle)`;
    const found = this.understanding.discovery;
    const detail = understandingStatusRows(settings, this.understanding.status).map(row => `${row.label}: ${row.value}`);
    if (found) detail.push(`Found locally: ${found.models.filter(model => model.suitability !== 'unsuitable').length} usable model(s); runtimes: ${found.runtimes.map(runtime => runtime.label).join(', ') || 'none'}`);
    return {active, detail};
  }

  private openUnderstandingPanel(onboarding = false): void {
    this.panelOrigin = undefined;
    this.understandingPanel = createUnderstandingPanel(onboarding);
    void this.refreshUnderstandingDiscovery(false).then(() => this.render());
  }

  private understandingFacts(): UnderstandingFacts {
    const brew = resolveCommand('brew');
    const recommended = loadRecommendedModel();
    return {settings: this.promptConfiguration.localUnderstanding, ...(this.understanding.discovery ? {discovery: this.understanding.discovery} : {}),
      ...(this.understanding.status ? {status: this.understanding.status} : {}), ...(recommended ? {recommended} : {}),
      ...(this.understanding.downloadFailure ? {downloadFailure: this.understanding.downloadFailure} : {}),
      ...(brew && (process.platform === 'darwin' || process.platform === 'linux') ? {runtimeRecipe: 'brew install llama.cpp'} : {}),
      activity: {requests: this.understanding.requests, ...(this.understanding.lastRoute ? {lastRoute: this.understanding.lastRoute} : {}),
        ...(this.understanding.lastInference ? {lastInference: this.understanding.lastInference} : {})},
      ...(this.ownedModelFacts() ? {ownedModel: this.ownedModelFacts()!} : {}),
      ...(brew && (() => { try { return new InstallProvenance().find('llama-server'); } catch { return undefined; } })() ? {runtimeOwned: {label: 'brew install llama.cpp'}} : {}),
      now: Date.now()};
  }

  /**
   * The model file NMSh itself downloaded: inside NMSh's own model folder (real
   * path checked, no symlink escape) and a regular .gguf file. Nothing else is
   * ever offered for removal.
   */
  private ownedModelFacts(): {path: string; bytes?: number; inUse: boolean} | undefined {
    const directory = nmshModelDirectory();
    const configured = this.promptConfiguration.localUnderstanding.model;
    const candidates = [configured?.owned ? configured.path : undefined,
      ...(this.understanding.discovery?.models.filter(model => model.owned).map(model => model.path) ?? [])].filter((path): path is string => Boolean(path));
    for (const path of candidates) {
      try {
        const real = realpathSync(path);
        const root = realpathSync(directory);
        if (!real.startsWith(`${root}/`) || !/\.gguf$/iu.test(real) || !statSync(real).isFile()) continue;
        return {path: real, bytes: statSync(real).size, inUse: Boolean(configured?.path && (configured.path === path || configured.path === real))};
      } catch { /* gone */ }
    }
    return undefined;
  }

  /** Approved steps run here, then are verified and activated; nothing runs without the panel's Yes. */
  private async handleUnderstandingAction(action: import('../understanding/UnderstandingPanel.js').UnderstandingAction): Promise<void> {
    const panel = this.understandingPanel;
    if (!panel) return;
    const update = (change: (settings: PromptConfiguration['localUnderstanding']) => PromptConfiguration['localUnderstanding']) =>
      this.updateConfiguration(configuration => { configuration.localUnderstanding = change({...configuration.localUnderstanding}); });
    if (action.kind === 'close') { this.understandingPanel = undefined; this.returnFromPanel(); return; }
    if (action.kind === 'detect') { await this.refreshUnderstandingDiscovery(true); panel.message = 'Detected again.'; this.render(); return; }
    if (action.kind === 'mode') {
      const modes = ['off', 'auto', 'always'] as const;
      update(settings => ({...settings, mode: modes[(modes.indexOf(settings.mode) + action.delta + modes.length) % modes.length]!}));
      return;
    }
    if (action.kind === 'scope') { update(settings => ({...settings, [action.scope]: !settings[action.scope]})); return; }
    if (action.kind === 'stop') {
      panel.message = await this.understanding.stopModel() ? 'Unloading the model; it loads again on next use.' : 'No model service is running.';
      await this.refreshUnderstandingDiscovery(false);
      this.render();
      return;
    }
    if (action.kind === 'remove') {
      // Re-checked right before deleting: only the exact NMSh-owned file.
      const owned = this.ownedModelFacts();
      if (!owned) { panel.message = 'There is no NMSh-downloaded model to remove.'; return; }
      if (owned.inUse) {
        await this.understanding.stopModel();
        update(settings => { const {model: _model, ...rest} = settings; return rest; });
      }
      try { rmSync(owned.path); panel.message = `Removed ${owned.path}.`; } catch (error) { panel.message = `Couldn't remove it: ${error instanceof Error ? error.message : String(error)}`; }
      await this.refreshUnderstandingDiscovery(true);
      this.render();
      return;
    }
    if (action.kind === 'uninstallRuntime') {
      const record = (() => { try { return new InstallProvenance().find('llama-server'); } catch { return undefined; } })();
      const brew = resolveCommand('brew');
      if (!record || !brew) { panel.message = 'NMSh has no record of installing llama.cpp, so it won\'t uninstall it.'; return; }
      panel.working = 'Running brew uninstall llama.cpp…';
      this.render();
      await this.understanding.stopModel();
      const task = new TaskProgress('Uninstalling llama.cpp', () => this.render(), Date.now(), 'llama.cpp');
      const outcome = await task.run(brew, ['uninstall', 'llama.cpp']);
      panel.working = undefined;
      if (outcome.status === 'succeeded') { try { new InstallProvenance().forget('llama-server'); } catch { /* record stays */ } }
      clearProviderDetection();
      await this.refreshUnderstandingDiscovery(true);
      panel.message = outcome.status === 'succeeded' ? 'llama.cpp was uninstalled.' : `llama.cpp was not uninstalled. ${task.state.error ?? ''}`.trim();
      this.render();
      return;
    }
    if (action.kind === 'use') {
      update(settings => ({...settings, model: modelChoice(action.model), mode: settings.mode === 'off' ? 'auto' : settings.mode}));
      panel.message = `Using ${action.model.label}${action.model.owned ? '' : ' (found on this machine; NMSh will not delete it)'}.`
        + (this.promptConfiguration.localUnderstanding.ask || this.promptConfiguration.localUnderstanding.folding ? '' : ' Enable Ask or Smart Folding above to use it.');
      return;
    }
    if (action.kind === 'runtime') {
      panel.working = 'Running brew install llama.cpp…';
      this.render();
      const task = new TaskProgress('Installing llama.cpp', () => this.render(), Date.now(), 'llama.cpp');
      const outcome = await task.run(resolveCommand('brew') ?? 'brew', ['install', 'llama.cpp']);
      panel.working = undefined;
      clearProviderDetection();
      await this.refreshUnderstandingDiscovery(true);
      const found = this.understanding.discovery?.runtimes.some(runtime => runtime.kind === 'llama.cpp');
      if (outcome.status === 'succeeded' && found) recordInstall('llama-server', {label: 'brew install llama.cpp', command: 'brew', args: ['install', 'llama.cpp']});
      panel.message = outcome.status === 'succeeded' && found ? 'llama.cpp is installed and detected.'
        : outcome.status === 'succeeded' ? 'brew finished, but llama-server was not found on PATH; nothing was changed.' : `llama.cpp was not installed. ${task.state.error ?? ''}`.trim();
      this.render();
      return;
    }
    if (action.kind === 'download') {
      const artifact = loadRecommendedModel()?.artifact;
      if (!artifact) { panel.message = 'No verified download is pinned in this build.'; return; }
      const label = `${loadRecommendedModel()?.model ?? 'Qwen3 0.6B'}`;
      panel.progress = {label, stage: 'Downloading', received: 0, total: artifact.bytes, since: Date.now()};
      const clock = presentationClock.subscribe(() => { if (!this.stopped) this.render(); }, 100);
      this.render();
      try {
        const path = await downloadPinned(artifact, nmshModelDirectory(), received => { if (panel.progress) panel.progress.received = received; },
          fetch, undefined, stage => { if (panel.progress) panel.progress.stage = stage === 'verify' ? 'Verifying SHA-256' : 'Installing'; this.render(); });
        clock();
        panel.progress = undefined;
        update(settings => ({...settings, mode: settings.mode === 'off' ? 'auto' : settings.mode,
          model: {label: `Qwen3 0.6B ${artifact.quantization}`, runtime: 'llama.cpp', path, owned: true}}));
        this.understanding.downloadFailure = undefined;
        await this.refreshUnderstandingDiscovery(true);
        panel.message = 'Downloaded and verified (sha256). It loads on first use and unloads when idle.';
      } catch (error) {
        clock();
        panel.progress = undefined;
        // Verification failure is remembered: the model is not used and nothing retries until you choose to.
        this.understanding.downloadFailure = error instanceof Error ? error.message : String(error);
        panel.message = `The recommended model was not installed: ${this.understanding.downloadFailure}. The incomplete file was removed; nothing was changed. `
          + 'Ask and Smart Folding keep working without it, and you can still choose a compatible model already on this machine.';
      }
      this.render();
    }
  }

  /** Optional, advisory, bounded: a late hint may tip only a borderline block the user has not touched. */
  private async adviseFolding(record: CompletedCommand): Promise<void> {
    if (!this.understanding.eligible('folding')) return;
    const input = {command: record.command, output: record.output, exitCode: record.exitCode ?? 0, lineCount: (record.endId ?? record.outputStartId) - record.outputStartId};
    if (!hintEligible(this.promptConfiguration.outputFolding, input)) return;
    const hint = await this.understanding.foldHint(foldExcerpt(record.command, record.output, record.exitCode ?? 0));
    if (!hint || this.stopped) return;
    if (this.output.applyAdvisoryFold(record.startId, applyFoldHint(input, hint))) this.render();
  }

  private openProvidersOverview(): void {
    this.panelOrigin = undefined;
    this.providersOverview = createProvidersOverview();
    void this.refreshProvidersOverview(false);
  }

  /** Local detection only (PATH and known locations); R forgets cached results first. */
  private async refreshProvidersOverview(again: boolean): Promise<void> {
    const state = this.providersOverview;
    if (!state) return;
    state.detecting = true;
    if (again) { clearProviderDetection(); this.providerStatuses.clear(); }
    await this.refreshProviderStatuses();
    await this.refreshUnderstandingDiscovery(again);
    state.detecting = false;
    if (again) state.message = 'Detected again.';
    if (this.providersOverview === state) this.render();
  }

  private providersOverviewFacts() {
    let installedByNmsh = new Set<string>();
    try { installedByNmsh = new Set(new InstallProvenance().list().map(record => record.toolId)); } catch { /* no provenance yet */ }
    return {configuration: this.promptConfiguration, statuses: this.providerStatuses, installedByNmsh,
      understanding: this.understandingSummary(), shell: {current: shellAdapter(this.shellId).label, defaultShell: shellAdapter(this.promptConfiguration.shellBackend).label}};
  }

  /** Each family opens its existing panel: switching, previewed installs and configuration live there. */
  private openProviderFamily(row: string): void {
    this.providersOverview = undefined;
    if (row === 'prompt') void this.startPromptSettings(false);
    else if (row === 'shell') this.openShellPanel();
    else if (row === 'understanding') this.openUnderstandingPanel();
    else this.startProviderPanel(row as 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation');
  }

  /** Ask's in-memory interaction; discarded on close (only visible turns may be recorded). */
  private askState?: AskState;
  /** External agent harness sessions (managed via supported protocols, or observed processes). */
  private readonly agents = new AgentSessions();
  private readonly agentsSubscription = this.agents.onChange(() => { if (!this.stopped) this.render(); });
  /** Long-lived tasks Ask started (dev servers): owned by NMSh, stopped when it exits. */
  private readonly managedTasks = new ManagedTasks();
  /** Portable cursor effects over NMSh's own input (presentation only; Off schedules nothing). */
  private readonly cursorPresenter = new CursorPresenter(() => this.promptConfiguration.cursor, () => { if (!this.stopped) this.paintPresentation(Date.now()); });
  private caretCause: 'typing' | 'jump' = 'jump';
  private cursorHost?: HostCursorFacts;
  private cursorBackend(): BackendChoice {
    this.cursorHost ??= hostCursorFacts(process.env, host => nativeCursorIntegrated(host));
    return chooseBackend(this.promptConfiguration.cursor, this.cursorHost);
  }
  private readonly tasksSubscription = this.managedTasks.onChange(() => { if (!this.stopped) { this.syncTaskClock(); this.render(); } });
  private taskClock?: () => void;
  private agentPanel?: AgentPanelState;
  private agentView?: AgentViewState;
  /** The transient activity shelf above the composer: hidden at rest, revealed by ↓, pinned while something needs attention. */
  private shelf = {visible: false, focused: false, selected: 0, shownAt: 0};
  private agentDiscoveryTimer?: () => void;
  private askGeneration = 0;
  /** What Ask is doing right now (factual stage), for its transient live line; never recorded. */
  private askStage?: {label: string; since: number; started: number};
  private askClock?: () => void;

  private setAskStage(label: string | undefined): void {
    if (!label) { this.askStage = undefined; this.askClock?.(); this.askClock = undefined; return; }
    const started = this.askStage?.started ?? Date.now();
    this.askStage = {label, since: Date.now(), started};
    // A clock only while Ask works; it stops with the stage.
    this.askClock ??= presentationClock.subscribe(() => { if (!this.stopped && this.askState?.busy) this.render(); }, 100);
  }

  /** The live line under Ask's input: shown only after ~300 ms, so instant answers never flash. */
  private askActivityLine(): string | undefined {
    const stage = this.askStage;
    if (!stage || !this.askState?.busy) return undefined;
    const now = Date.now();
    if (now - stage.started < 300) return undefined;
    const still = this.promptConfiguration.presentation.reducedMotion || this.promptConfiguration.presentation.effectsOff || isReducedMotion();
    const model = this.understanding.activeSince ? this.promptConfiguration.localUnderstanding.model?.label : undefined;
    return liveLine(model ? `Local understanding · ${model}` : stage.label, undefined, model ? this.understanding.activeSince! : stage.started, now, {still});
  }

  /** `/ask` and `/ask <request>` open the same Ask; with a request it is submitted at once. */
  private openAsk(request: string): void {
    this.panelOrigin = undefined;
    const parked = this.parkedAsk;
    this.parkedAsk = undefined;
    this.askGeneration += 1;
    // /ask alone returns to a conversation parked by Insert; a new request starts fresh (the parked one is recorded as closed).
    if (parked && !request) { parked.pending = undefined; this.askState = parked; return; }
    if (parked) this.recordAsk(parked);
    this.askState = createAskState();
    if (!request) {
      // Starters from strong facts only (a dirty repository, a recent command); nothing is guessed.
      const git = this.context.git;
      const recent = this.output.recentShell(1);
      this.askState.pending = {kind: 'choose', reason: 'missing', question: ASK_GREETING, options: askStarters({...(this.context.root ? {repoRoot: this.context.root} : {}),
        ...(this.context.branch ? {branch: this.context.branch} : {}), dirty: Boolean(git && (git.staged || git.modified || git.untracked)),
        recent: recent ? [{command: recent.command, exitCode: recent.exitCode, lines: 0}] : []})};
    }
    if (request) {
      this.askState.turns.push({role: 'you', text: request});
      this.askState.submitted = true;
      this.askState.original = request;
      this.askState.busy = true;
      void this.handleAskEvent({kind: 'resolve', text: request});
    }
  }

  private async handleAskEvent(event: AskEvent): Promise<void> {
    const state = this.askState;
    if (!state) return;
    if (event.kind === 'close') { this.closeAsk(); this.render(); return; }
    if (event.kind === 'complete') {
      // Paths only after the request's first word ("open pa", "find src/"): the same directory facts the composer completes from.
      const before = [...event.text].slice(0, event.caret).join('');
      if (!/\s/u.test(before.trimStart()) && !before.includes('/')) return;
      const completion = completePath(event.text, event.caret, this.shellCwd, homedir());
      if (completion) applyAskCompletion(state, completion);
      this.render();
      return;
    }
    if (event.kind === 'resolve') {
      const generation = this.askGeneration;
      let outcome: AskOutcome;
      this.setAskStage('Resolving locally');
      try { outcome = await this.resolveAsk(event.text, state); } catch {
        outcome = {kind: 'unclear', text: 'Something went wrong while looking that up.', categories: []};
      } finally { this.setAskStage(undefined); }
      if (this.askState !== state || generation !== this.askGeneration || this.stopped) return;
      const next = receiveOutcome(state, outcome);
      if (next) await this.handleAskEvent(next);
      this.render();
      return;
    }
    if (event.kind === 'copy' || event.kind === 'insert') {
      const text = event.block.literal ?? event.block.script ?? renderCommand(event.block, this.shellId);
      if (event.kind === 'copy') {
        try { await writeClipboard(text); pushTurn(state, 'ask', 'Copied the command. Nothing was run.'); } catch { pushTurn(state, 'ask', 'The clipboard isn\'t available here; Insert puts the command in the composer instead.'); }
        this.render();
        return;
      }
      // Insert: the command waits, unsent, in the shell composer; the conversation is parked and /ask reopens it.
      this.parkedAsk = state;
      this.askState = undefined;
      this.askGeneration += 1;
      this.returnFromPanel();
      this.editor.clear();
      this.editor.insert(text);
      this.render();
      return;
    }
    // Actions with a factual result stay inside the conversation; navigation to another surface leaves Ask.
    if (event.action.kind === 'git' || event.action.kind === 'recipe' || event.action.kind === 'project' || event.action.kind === 'startTask' || event.action.kind === 'stopTask'
      || event.action.kind === 'taskOutput' || event.action.kind === 'openUrl' || event.action.kind === 'read' || event.action.kind === 'setting' || event.action.kind === 'installTool' || event.action.kind === 'applyEdit' || event.action.kind === 'openFile' || event.action.kind === 'format' || event.action.kind === 'brew') {
      await this.runInAsk(state, event.action);
      this.render();
      return;
    }
    if (event.action.kind === 'pickFile') { await this.pickFileInAsk(state, event.action.root); this.render(); return; }
    this.closeAsk();
    await this.executeAskAction(event.action);
    this.render();
  }

  /**
   * "open" with an external picker configured (fzf, Television): the project's
   * files in that picker; the chosen file opens in the editor. Native, a
   * missing tool or a busy terminal fall back to Ask's own file list.
   */
  private async pickFileInAsk(state: AskState, root: string): Promise<void> {
    const fallback = () => { receiveOutcome(state, browseOutcome(this.shellCwd, {cwd: this.shellCwd, home: homedir(), ...(this.context.root ? {repoRoot: this.context.root} : {}),
      editor: {label: this.hostActions().label, available: true}} as AskContext, {note: 'type to filter'})); };
    if (this.promptConfiguration.picker === 'native' || this.pickerOpening || this.running) { fallback(); return; }
    this.pickerOpening = true;
    try {
      const files = listProjectFiles(root).slice(0, 20_000);
      const result = await openPicker(this.promptConfiguration.picker, files.map(path => ({id: path, label: path, value: path})), fallback, this.pickerHandoff);
      if (this.askState !== state || this.stopped) return;
      if (result?.kind === 'selected') await this.runInAsk(state, {kind: 'openFile', path: resolvePath(root, result.candidate.value)});
      else if (result?.kind === 'fallback') fallback();
      else pushTurn(state, 'ask', 'Nothing was opened.');
    } finally { this.pickerOpening = false; }
  }

  /** The Homebrew facts one package request needs; nothing else is queried. */
  private async gatherBrew(intent: PackageIntent): Promise<BrewFacts> {
    const adapter = homebrewAdapter();
    if (!adapter.executable()) return {available: false};
    const wanted = packageQueries(intent);
    const names = [...new Set([...wanted.info, ...wanted.uses, ...wanted.prefix])];
    const [installed, outdated, info, search, uses, prefix] = await Promise.all([
      wanted.installed ? adapter.installed() : undefined,
      wanted.outdated ? adapter.outdated() : undefined,
      Promise.all(wanted.info.map(async name => [name, await adapter.info(name)] as const)),
      Promise.all(wanted.search.map(async term => [term, await adapter.search(term)] as const)),
      Promise.all(wanted.uses.map(async name => [name, await adapter.uses(name)] as const)),
      Promise.all(wanted.prefix.map(async name => [name, await adapter.prefix(name)] as const)),
    ]);
    const identity = Object.fromEntries(names.map(name => { const path = resolveCommand(name); return [name, {...(path ? {path} : {}), owner: toolOwner(path)}]; }));
    return {available: true, ...(installed ? {installed} : {}), ...(outdated ? {outdated} : {}), info: Object.fromEntries(info), search: Object.fromEntries(search),
      uses: Object.fromEntries(uses), prefix: Object.fromEntries(prefix), identity};
  }

  /** Current facts the guide shows next to features ("now: …"): only settings NMSh already holds. */
  private askNmshFacts(): Record<string, string> {
    const config = this.promptConfiguration;
    const label = (id: string) => shellAdapter(id as ShellId).label;
    return {shell: this.shellId === config.shellBackend ? label(this.shellId) : `${label(this.shellId)} (default ${label(config.shellBackend)})`,
      chroma: config.presentation.preset === 'off' ? 'Off' : TREATMENT_PRESET_LABELS[config.presentation.preset], folding: config.outputFolding === 'never' ? 'Off' : config.outputFolding === 'smart' ? 'Smart' : 'Always',
      understanding: config.localUnderstanding.mode === 'off' ? 'Off' : config.localUnderstanding.mode === 'auto' ? 'Auto' : 'Always', layout: `${config.composerPosition} · ${config.transcriptPresentation}`,
      suggestions: askProviderFacts(config, this.providerStatuses).find(item => item.family === 'suggestions' && item.active)?.label ?? config.suggestions};
  }

  /** A conversation parked by Insert; /ask with no request reopens it. */
  private parkedAsk?: AskState;

  /**
   * Run an Ask action without leaving Ask: show what is running, wait for the
   * structured result (exit status of the visible command, install outcome,
   * applied setting), then add a factual result turn and next steps from
   * refreshed facts. Esc remains the only way out.
   */
  private async runInAsk(state: AskState, action: AskAction): Promise<void> {
    const finish = (text: string, next: AskOption[] = []) => {
      state.working = undefined;
      state.pending = next.length ? {kind: 'answer', capability: 'help.command', text, next} : undefined;
      pushTurn(state, 'ask', text);
      state.scroll = 0;
    };
    if (action.kind === 'setting') {
      await this.executeAskAction(action);
      finish(`Done: ${action.label}.`);
      return;
    }
    if (action.kind === 'startTask') {
      const project = readProjectFacts(action.cwd);
      if (!projectRunAllowed(action.argv, project)) { finish('That script is no longer defined by this project, so nothing was started.'); return; }
      const started = this.managedTasks.start(action.label, action.argv, action.cwd);
      if ('error' in started) { finish(`${action.label} didn't start: ${started.error}`); return; }
      finish(`Started ${action.label} in the background (${action.argv.join(' ')}). The shell stays free; its URL shows above the composer once it prints one.`,
        [{key: `task:url:${started.id}`, label: 'What URL is it on?', refine: 'what url is the dev server on'}, {key: `task:out:${started.id}`, label: 'Show its output', outcome: {kind: 'proposal', capability: 'project.task', safety: 'navigate', confidence: 1, direct: true, text: 'Output', action: {kind: 'taskOutput', id: started.id}}},
          {key: `task:stop:${started.id}`, label: 'Stop it', refine: 'stop the dev server'}]);
      return;
    }
    if (action.kind === 'stopTask') {
      const task = this.managedTasks.get(action.id);
      finish(task && this.managedTasks.stop(action.id) ? `Stopping ${task.label}…` : 'That task isn\'t running.');
      return;
    }
    if (action.kind === 'taskOutput') {
      const task = this.managedTasks.get(action.id);
      if (!task) { finish('That task is gone.'); return; }
      const tail = task.output.slice(-30);
      finish(`${task.label} · ${task.status} · ${task.output.length} line${task.output.length === 1 ? '' : 's'}${tail.length < task.output.length ? ' (last 30)' : ''}\n${tail.map(line => `  ${line}`).join('\n') || '  (no output yet)'}`);
      return;
    }
    if (action.kind === 'openUrl') {
      if (!openableUrl(action.url)) { finish('That isn\'t a URL Ask opens.'); return; }
      const opener = process.platform === 'darwin' ? '/usr/bin/open' : resolveCommand('xdg-open') ?? resolveCommand('wslview');
      if (!opener) { finish(`No system URL opener is available here. The URL is ${action.url}`); return; }
      try { spawn(opener, [action.url], {detached: true, stdio: 'ignore'}).unref(); finish(`Opened ${action.url}.`); } catch { finish(`Couldn't open ${action.url}.`); }
      return;
    }
    if (action.kind === 'openFile') {
      await this.openLocation('/ask', action.path, this.shellCwd);
      finish(`Opened ${action.path.startsWith(`${homedir()}/`) ? `~${action.path.slice(homedir().length)}` : action.path} in ${this.hostActions().label}.`);
      state.referents = {...state.referents, file: action.path};
      return;
    }
    if (action.kind === 'applyEdit') {
      const applied = applyPlan(action.plan);
      if (!applied.ok) { finish(applied.reason); return; }
      // Verify by reading back: the file must now be exactly what the preview showed.
      let verified = false;
      try { verified = sha256(readFileSync(action.plan.resolvedPath, 'utf8')) === action.plan.resultSha256; } catch { /* unreadable */ }
      state.referents = {...state.referents, file: action.plan.path, block: undefined};
      const open: AskOption = {key: 'edit:open', label: 'Open the file', outcome: {kind: 'proposal', capability: 'file.open', safety: 'navigate', confidence: 0.95,
        text: `Opening ${action.plan.path}.`, action: {kind: 'openFile', path: action.plan.path}}};
      let check: string | undefined;
      try { check = validateAfterWrite(action.plan, readFileSync(action.plan.resolvedPath, 'utf8'), resolveCommand('python3')); } catch { /* unreadable */ }
      finish(verified ? `Updated ${action.plan.path}: ${action.plan.reason}.${check ? ` ${check}` : ''}` : `Wrote ${action.plan.path}, but reading it back did not match the preview; check the file.`, [open]);
      return;
    }
    if (action.kind === 'brew') {
      const adapter = homebrewAdapter();
      const brewPath = adapter.executable();
      if (!brewPath || !brewMutationAllowed(action.argv)) { finish('Ask can\'t run that Homebrew command, so nothing was run.'); return; }
      state.working = `Running ${action.argv.join(' ')}…`;
      this.render();
      const task = new TaskProgress(action.argv.join(' '), () => this.render(), Date.now(), action.name);
      const outcome = await task.run(brewPath, action.argv.slice(1));
      if (this.askState !== state) return;
      // Verify with Homebrew itself rather than trusting the exit status.
      const after = (await adapter.info(action.name)).find(item => item.name === action.name);
      const ok = action.expect === 'absent' ? !after?.installed.length : action.expect === 'installed' ? Boolean(after?.installed.length) : Boolean(after?.installed.length && !after.outdated);
      if (ok && action.expect === 'installed') { const tool = TOOLS.find(item => item.package === action.name || item.id === action.name); if (tool) recordInstall(tool.id, {label: action.argv.join(' '), command: 'brew', args: action.argv.slice(1)}); }
      clearProviderDetection();
      this.commandSources.delete(action.name);
      const verb = action.expect === 'installed' ? 'Installed' : action.expect === 'upgraded' ? 'Upgraded' : 'Uninstalled';
      const next: AskOption[] = ok && action.expect !== 'absent' && after?.kind === 'formula' ? [{key: `cmd:${action.name}`, label: 'Basic command overview', refine: `what is ${action.name}`},
        {key: `syntax:${action.name}`, label: 'Show syntax', refine: `how do i use ${action.name}`}] : [];
      finish(ok ? `${verb} ${action.name}${after?.installed.length ? ` ${after.installed.at(-1)}` : ''}.` : `${action.argv.join(' ')} ${outcome.status === 'succeeded' ? 'finished, but Homebrew does not report the expected result' : 'did not succeed'}. Nothing else was changed.`, next);
      return;
    }
    if (action.kind === 'installTool') {
      const tool = TOOLS.find(item => item.id === action.tool);
      const recipe = tool ? toolInstall(tool) : undefined;
      // Only the exact recipe that was shown and confirmed runs.
      if (!tool || !recipe || recipe.label !== action.label) { finish('That install is no longer available here, so nothing was run.'); return; }
      state.working = `Installing ${tool.label} · ${recipe.label}…`;
      this.render();
      const task = new TaskProgress(`Installing ${tool.label}`, () => this.render(), Date.now(), tool.label);
      const outcome = await task.run(recipe.command, [...recipe.args]);
      if (this.askState !== state) return;
      if (outcome.status === 'succeeded') recordInstall(tool.id, recipe);
      clearProviderDetection();
      this.commandSources.delete(tool.executable ?? tool.id);
      const executable = tool.executable ?? tool.id;
      const found = resolveCommand(executable);
      if (outcome.status !== 'succeeded' || !found) { finish(`Installing ${tool.label} did not succeed${outcome.status === 'succeeded' ? ' (it is still not found)' : ''}. Nothing else was changed.`); return; }
      const next: AskOption[] = [{key: `syntax:${executable}`, label: 'Show syntax and useful options', refine: `how do i use ${executable}`}];
      if (tool.family && selectProvider(this.promptConfiguration, tool.family, tool.id)) next.push({key: `use:${tool.id}`, label: `Use ${tool.label} as the ${tool.family} provider`, refine: `switch ${tool.family} to ${tool.id}`});
      finish(`Installed ${tool.label} at ${found}.`, next);
      return;
    }
    if (action.kind !== 'git' && action.kind !== 'read' && action.kind !== 'format' && action.kind !== 'recipe' && action.kind !== 'project') return;
    if (action.kind === 'project' && !projectRunAllowed(action.argv, readProjectFacts(state.repoRoot ?? this.shellCwd))) { finish('That script is no longer defined by this project, so nothing was run.'); return; }
    if (action.kind === 'recipe' && recipeRunAllowed(action.argv) !== action.risk) { finish('Ask can\'t run that command, so nothing was run.'); return; }
    const argv = action.kind === 'read' ? readArgv(action.command) : action.argv;
    if (action.kind === 'git' && gitRunAllowed(action.argv) !== action.risk) { finish('Ask can\'t run that command, so nothing was run.'); return; }
    if (action.kind === 'format' && !formatterAllowed(action.argv)) { finish('Ask can\'t run that formatter command, so nothing was run.'); return; }
    const command = renderCommand({argv}, this.shellId);
    const previous = this.output.recentShell(1)?.startId;
    const draft = this.editor.text;
    state.working = `Running ${command}… (its output goes to the transcript)`;
    this.render();
    // A normal, visible submission: the command and its output follow ordinary transcript and history rules.
    this.editor.clear();
    this.editor.insert(command);
    await this.submit(false, true);
    if (draft) this.editor.insert(draft);
    for (let waited = 0; this.askState === state && !this.stopped && waited < 30 * 60_000; waited += 50) {
      const latest = this.output.recentShell(1);
      if (!this.running && latest && latest.startId !== previous) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (this.askState !== state) return;
    const record = this.output.recentShell(1);
    const ok = record?.exitCode === 0;
    const result = `${ok ? '✓' : '✗'} ${command} ${ok ? 'finished' : `exited with status ${record?.exitCode ?? '?'}`}. Its output is in the transcript.`;
    if (argv[0] === 'git') {
      // Refresh the repository this conversation is about.
      const git = await readGitFacts(state.repoRoot ?? this.shellCwd);
      if (this.askState !== state) return;
      if (git) { state.referents = {...state.referents, files: undefined}; finish(`${result}\n\n${gitSummary(git)}`, gitNextSteps(git)); return; }
    }
    finish(result);
  }

  /** Close Ask; its visible turns join the transcript only when "Record Ask in transcript" is on. */
  private closeAsk(): void {
    const state = this.askState;
    this.askState = undefined;
    this.askGeneration += 1;
    if (!state) return;
    this.recordAsk(state);
    this.returnFromPanel();
  }

  /** Visible turns join the transcript only when "Record Ask in transcript" is on; referents and outcomes never do. */
  private recordAsk(state: AskState): void {
    const recorded = this.promptConfiguration.askRecord ? askTranscriptText(state, this.shellId) : undefined;
    if (recorded) this.output.addAskInteraction(recorded.request, recorded.turns);
  }

  /** Command knowledge and identity for Ask: the completion catalog's facts and this shell's names; nothing is run. */
  private askCommands(): CommandEnvironment {
    return {reference: commandReference(), identity: name => {
      const type = this.semanticService.cache.get(name);
      if (type === 'alias' || type === 'function' || type === 'builtin') return {kind: type};
      const path = /^[\w.+-]+$/u.test(name) ? resolveCommand(name) : undefined;
      return path ? {kind: 'executable', path} : undefined;
    }, ...(resolveCommand('tldr') ? {examples: (path: readonly string[]) => tldrExamples(resolveCommand('tldr'), path)} : {}), install: name => {
      // Only a curated /tools entry for this exact executable name; never a guessed package.
      const tool = TOOLS.find(item => (item.executable ?? item.id) === name && !item.legacy);
      const recipe = tool ? toolInstall(tool) : undefined;
      return tool && recipe ? {tool: tool.id, label: recipe.label} : undefined;
    }};
  }

  /** Deterministic resolution first; an optional local interpretation may refine it (see LocalUnderstanding). */
  private async resolveAsk(text: string, state: AskState): Promise<AskOutcome> {
    const context = await this.askContext(text);
    state.repoRoot = context.repoRoot;
    const commands = this.askCommands();
    const files = systemFileAssistEnvironment(homedir(), context.repoRoot, resolveCommand('python3'), process.execPath, name => resolveCommand(name), commands.install);
    const deterministic = resolveRequest(text, context, {rejected: state.rejected}, commands, files);
    const deterministicRoute = () => { this.understanding.lastRoute = {route: 'deterministic', at: Date.now()}; return deterministic; };
    if (!this.understanding.eligible('ask')) return deterministicRoute();
    // Auto: deterministic first; the model only when it is unsure. Always: the model first, still feeding deterministic builders.
    const unsure = deterministic.kind === 'unclear' || (deterministic.kind === 'choose' && deterministic.reason === 'ambiguous');
    if (!this.understanding.prefersModel && !unsure) return deterministicRoute();
    const inventory = modelInventory();
    const ids = new Set(inventory.map(item => item.id));
    const facts: Record<string, string | string[]> = {shell: context.shell, defaultShell: context.defaultShell,
      ...(context.repoRoot ? {repository: basename(context.repoRoot)} : {}), ...(context.branch ? {branch: context.branch} : {}),
      ...(context.project?.kind === 'node' ? {scripts: Object.keys(context.project.scripts).slice(0, 12)} : {}),
      ...(context.tasks?.length ? {backgroundTasks: context.tasks.map(task => `${task.label} ${task.status}`)} : {}),
      ...(context.worktrees.length > 1 ? {worktrees: context.worktrees.map(item => basename(item.path))} : {}),
      ...(context.recentFiles.length ? {recentFiles: context.recentFiles.slice(0, 5).map(path => basename(path))} : {}),
      ...(context.transcripts.length ? {transcripts: context.transcripts.slice(0, 5).map(item => `${item.createdAt.slice(0, 16)} ${basename(item.finalCwd)}`)} : {})};
    const request = {text, capabilities: inventory, facts};
    const interpret = (interpretation: Awaited<ReturnType<LocalUnderstanding['interpretAsk']>>) => interpretation
      ? resolveModelIntent(interpretation, context, {rejected: state.rejected}, commands, files) ?? resolveWithInterpretation(text, interpretation as never, context, {rejected: state.rejected})
      : undefined;
    // Non-thinking first: fast and enough for ordinary wording.
    let modelled = interpret(await this.understanding.interpretAsk(request, ids, 'fast'));
    // A bounded thinking retry only when the request is still genuinely ambiguous to both.
    if (!modelled && unsure && this.askState === state) modelled = interpret(await this.understanding.interpretAsk(request, ids, 'thinking'));
    // A missing, failed or unsure model keeps the deterministic outcome: model failure is not the user's ambiguity.
    if (!modelled) return deterministicRoute();
    this.understanding.lastRoute = {route: 'model', at: Date.now()};
    return modelled;
  }

  /** Bounded facts from existing services: no environment, file contents or output beyond these. */
  /** Runtime-only detection of every external provider (cached, bounded); never persisted. */
  private readonly providerStatuses = new Map<string, ProviderStatus>();
  private async refreshProviderStatuses(): Promise<void> {
    const descriptors = PROVIDER_FAMILIES.flatMap(family => family.providers).filter(descriptor => descriptor.kind === 'external');
    const results = await Promise.all(descriptors.map(async descriptor => [descriptor.id, await detectProvider(descriptor)] as const));
    for (const [id, status] of results) this.providerStatuses.set(id, status);
  }

  private async askContext(text: string): Promise<AskContext> {
    const root = this.context.root;
    const worktrees = root ? await gitWorktrees(this.shellCwd, root) : [];
    await this.refreshProviderStatuses();
    let sessions: AskContext['sessions'] = [];
    if (this.sessionMode === 'service') {
      try {
        sessions = (await listLiveSessions()).map(session => ({id: session.id, state: session.state, current: session.id === this.sessionId,
          cwd: session.cwd, createdAt: session.createdAt, ...(session.shell ? {shell: session.shell} : {}), ...(session.running ? {running: session.running} : {})}));
      } catch { /* service unreachable: no live facts */ }
    }
    let transcripts: AskContext['transcripts'] = [];
    try {
      transcripts = (await this.transcriptStore.listSummaries()).filter(item => item.id !== this.journal?.id).slice(0, 40)
        .map(item => ({id: item.id, createdAt: item.createdAt, startCwd: item.startCwd, finalCwd: item.finalCwd, project: item.project, commandCount: item.commandCount}));
    } catch { /* no archives readable */ }
    const host = this.hostActions();
    const probe = host.openFile({path: this.shellCwd});
    const brew = resolveCommand('brew');
    const shells = shellAvailability(process.env).map(item => ({id: item.adapter.id, label: item.adapter.label, installed: Boolean(item.executable),
      installable: shellInstall(item.adapter.id, brew).kind === 'recipe'}));
    const statuses = this.providerStatuses;
    const recentFiles = this.recentReferences().map(reference => resolvePath(reference.cwd, reference.path)).filter((path, index, all) => all.indexOf(path) === index).slice(0, 10);
    const recentCommands: string[] = [];
    const recent: NonNullable<AskContext['recent']> = [];
    for (let index = 1; index <= 8; index += 1) {
      const record = this.output.recentShell(index);
      if (!record) break;
      recentCommands.push(record.command.slice(0, 80));
      // Facts only: never the output itself.
      recent.push({command: record.command.slice(0, 200), ...(record.historicalContext?.cwd ? {cwd: record.historicalContext.cwd} : {}),
        ...(record.historicalContext?.branch ? {branch: record.historicalContext.branch} : {}), exitCode: record.exitCode,
        ...(record.durationMs !== undefined ? {durationMs: record.durationMs} : {}), lines: Math.max(0, (record.endId ?? record.outputStartId) - record.outputStartId)});
    }
    // The project file list is read (names only, bounded) only for requests about opening things.
    if (this.askStage) this.setAskStage('Checking repository files');
    const files = /\b(?:open|edit|view|show|list|ls|find|where|locate|file|files|folder|repo|config|json|this|that|it|one|typescript|python|tests?)\b/iu.test(text) ? listProjectFiles(root ?? this.shellCwd) : undefined;
    const conversation = this.askState?.referents;
    // Homebrew facts only for package requests (bounded, local, auto-update off).
    const packageRequest = packageIntent(normalizeRequest(text));
    if (packageRequest && this.askStage) this.setAskStage('Checking Homebrew');
    const brewFacts = packageRequest ? await this.gatherBrew(packageRequest) : undefined;
    // Config targets (existence checks only) for requests about config files or edits.
    const configs = /\b(?:config(?:uration)?|settings|rc|dotfile|zshrc|bashrc|add|put|insert|append|set|replace|paste|it|that|this)\b/iu.test(text) || conversation?.config || conversation?.file
      ? configTargets(systemConfigEnvironment(this.shellId, root ?? this.shellCwd)).map(target => ({...target, exists: Boolean(target.path && existsSync(target.path))})) : undefined;
    // Git facts (local status and remote names; no network) only when the request or the conversation is about Git or its files.
    const referents = this.askState?.referents;
    if (this.askStage && root) this.setAskStage('Checking Git state');
    const git = root && (/\b(?:git|branch|upstream|remotes?|untracked|staged?|unstaged|commit|push|pull|fetch|conflicts?|conflicted|clean|working tree|changes|changed)\b/iu.test(text) || referents?.files)
      ? await readGitFacts(root) : undefined;
    if (this.askStage) this.setAskStage('Reading project files');
    const projectFacts = readProjectFacts(root ?? this.shellCwd);
    const tasks = this.managedTasks.tasks.map(task => ({id: task.id, label: task.label, status: task.status, urls: [...task.urls], startedAt: task.startedAt, lines: task.output.length, command: task.argv.join(' ')}));
    const understanding = this.promptConfiguration.localUnderstanding;
    const llm = {mode: understanding.mode, requests: this.understanding.requests,
      ...(understanding.model ? {model: {label: understanding.model.label, runtime: understanding.model.runtime, owned: Boolean(understanding.model.owned)}} : {}),
      ...(understanding.model ? {state: stateLabel(this.understanding.status, understanding)} : {}),
      ...(this.understanding.lastRoute ? {lastRoute: this.understanding.lastRoute.route} : {}),
      ...(this.understanding.lastInference ? {lastInference: this.understanding.lastInference.label} : {})};
    return {cwd: this.shellCwd, home: homedir(), platform: process.platform, picker: this.promptConfiguration.picker, llm, ...(projectFacts ? {project: projectFacts} : {}), tasks, ...(root ? {repoRoot: root} : {}), ...(this.context.branch ? {branch: this.context.branch} : {}),
      ...(this.context.git ? {dirty: Boolean(this.context.git.staged || this.context.git.modified || this.context.git.untracked)} : {}),
      worktrees, shell: this.shellId, defaultShell: this.promptConfiguration.shellBackend, shells, sessions, transcripts, recentFiles, recentCommands,
      editor: {label: host.label, available: probe.kind !== 'unsupported', ...(probe.kind === 'unsupported' ? {reason: probe.reason} : {})},
      providers: askProviderFacts(this.promptConfiguration, statuses), sessionMode: this.sessionMode, now: Date.now(), ...(files ? {files} : {}),
      ...(git ? {git} : {}), ...(referents ? {referents} : {}), recent, nmsh: this.askNmshFacts(), ...(configs ? {configs} : {}), ...(brewFacts ? {brew: brewFacts} : {})};
  }

  /** Every Ask action is an existing NMSh handler; read-only commands are NMSh-built argv submitted visibly. */
  private async executeAskAction(action: AskAction): Promise<void> {
    switch (action.kind) {
      case 'slash': await this.runSlash(action.label, action.slash); return;
      case 'switchShell': await this.switchShell(action.shell, `/shell ${action.shell}`); return;
      case 'installShell': {
        this.openShellPanel(action.shell);
        const recipe = shellInstall(action.shell, resolveCommand('brew'));
        // Ask's own Yes (which starts on No) was the confirmation of this exact recipe.
        if (recipe.kind === 'recipe') await this.installShell(action.shell, recipe);
        return;
      }
      case 'openFile': await this.openLocation('/ask', action.path, this.shellCwd); return;
      case 'read': {
        const argv = readArgv(action.command);
        const quote = this.shellId === 'fish' ? fishQuote : posixQuote;
        // A normal, visible submission: the command and its output follow ordinary transcript and history rules.
        this.editor.clear();
        this.editor.insert(argv.map(part => /^[\w./=-]+$/u.test(part) ? part : quote(part)).join(' '));
        await this.submit(false, true);
        return;
      }
      case 'git': {
        // Re-checked here: only allowlisted, non-destructive Git argv that NMSh built from facts ever runs.
        if (gitRunAllowed(action.argv) !== action.risk) return;
        const quote = this.shellId === 'fish' ? fishQuote : posixQuote;
        this.editor.clear();
        this.editor.insert(action.argv.map(part => /^[\w@%+=:,./-]+$/u.test(part) ? part : quote(part)).join(' '));
        await this.submit(false, true);
        return;
      }
      case 'resumeTranscript': await this.restoreTranscriptById(action.id); return;
      case 'attachSession': this.switchToLiveSession(action.id, 'detached'); return;
      case 'setting': {
        if (action.setting === 'shellBackend') {
          if (isShellId(action.value)) this.updateConfiguration(configuration => { configuration.shellBackend = action.value as ShellId; });
        } else if (action.setting === 'composerDividers') {
          this.updateConfiguration(configuration => { configuration.composerDividers = action.value === 'on'; });
        } else if (action.setting === 'localUnderstanding') {
          const mode = action.value as PromptConfiguration['localUnderstanding']['mode'];
          if (['off', 'auto', 'always'].includes(mode)) this.updateConfiguration(configuration => { configuration.localUnderstanding = {...configuration.localUnderstanding, mode}; });
        } else {
          const next = selectProvider(this.promptConfiguration, action.setting, action.value);
          if (next) this.applySettingsConfiguration(next);
        }
        this.output.addFrontendInteraction('/settings', `${action.label}.`, INFO);
        return;
      }
    }
  }

  /** The composer is completely idle: ← and ↓ shortcuts apply only here, never over editing, menus, panels or a running command. */
  private composerIdle(): boolean {
    return !this.editor.text && !this.running && !this.historySearchActive && !this.directorySearchActive && this.composerSuggestions().length === 0
      && !this.passthrough && !this.externalPassthrough && !this.settingsPanelActive && !this.editor.hasPasteAtoms;
  }

  private revealShelf(): void {
    if (this.shelf.visible) { this.shelf.focused = true; this.shelf.selected = 0; return; }
    this.shelf.visible = true;
    this.shelf.shownAt = Date.now();
    // Auto-hide after a short idle period unless something needs attention (checked on the presentation clock).
    setTimeout(() => { if (!this.stopped) this.render(); }, SHELF_IDLE_MS + 50).unref?.();
  }

  private handleShelfKey(key: Key): boolean {
    const items = shelfOrder(this.agents.sessions);
    if (!items.length) { this.shelf.focused = false; return false; }
    if (key.kind === 'left' || key.kind === 'right') this.shelf.selected = (this.shelf.selected + (key.kind === 'left' ? -1 : 1) + items.length) % items.length;
    else if (key.kind === 'enter') { const session = items[this.shelf.selected]; this.shelf.focused = false; if (session) this.openAgentView(session.id); }
    else if (key.kind === 'up' || key.kind === 'escape') { this.shelf.focused = false; this.shelf.shownAt = Date.now(); }
    else return false;
    this.render();
    return true;
  }

  private syncAgents(): void {
    const wanted = this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended;
    if (wanted && !this.agentDiscoveryTimer) {
      // Bounded, asynchronous discovery on a modest cadence, only while NMSh owns the screen; never at startup.
      this.agentDiscoveryTimer = presentationClock.subscribe(() => void this.agents.discover(), AGENT_DISCOVERY_MS);
      setTimeout(() => { if (!this.stopped) void this.agents.discover(); }, 3000).unref?.();
    } else if (!wanted && this.agentDiscoveryTimer) { this.agentDiscoveryTimer(); this.agentDiscoveryTimer = undefined; }
    const attention = this.agents.sessions.some(session => session.attention);
    if (this.shelf.visible && !this.shelf.focused && !attention && Date.now() - this.shelf.shownAt > SHELF_IDLE_MS) this.shelf.visible = false;
  }

  private agentPanelRows() {
    return agentPanelRows(this.agents.sessions, this.agents.harnesses());
  }

  /** /ai: the agent session list; /ai <harness|profile>: start a managed session in the background. */
  private openAi(command: string, target?: string): void {
    this.panelOrigin = undefined;
    if (!target) { this.agentPanel = {selected: 0}; void this.agents.discover(); return; }
    const profile = this.promptConfiguration.agentProfiles.find(item => item.name === target);
    const harnessId = profile?.harness ?? target;
    if (!harness(harnessId)) {
      this.output.addFrontendInteraction(command, `No harness or launch profile is called "${target}". /ai lists the harnesses; profiles live in NMSh's config as agentProfiles (name, harness, and for Claude: model, permissionMode, configDir).`, INFO);
      return;
    }
    const result = this.agents.launch(harnessId, this.shellCwd, profile ? {profile} : {});
    if (!result.ok) { this.output.addFrontendInteraction(command, result.reason, ERROR); return; }
    // The agent runs in the background; its view opens so the first message can be typed. Esc returns to the shell.
    this.openAgentView(result.session.id);
  }

  private openAgentView(id: string): void {
    this.agentPanel = undefined;
    this.resumeBrowser = undefined;
    this.agentView = {sessionId: id, input: '', expanded: new Set(), scroll: 0};
    this.agents.acknowledge(id);
    this.shelf.visible = false;
  }

  private handleAgentPanelKey(key: Key): void {
    const panel = this.agentPanel!;
    const rows = this.agentPanelRows();
    if (panel.rename !== undefined) {
      const row = rows[panel.selected];
      if (key.kind === 'escape' || key.kind === 'interrupt') panel.rename = undefined;
      else if (key.kind === 'enter') { if (row?.kind === 'session') this.agents.rename(row.session.id, panel.rename); panel.rename = undefined; }
      else if (key.kind === 'backspace') panel.rename = [...panel.rename].slice(0, -1).join('');
      else if (key.kind === 'text') panel.rename += key.value;
      this.render();
      return;
    }
    if (key.kind === 'escape' || key.kind === 'interrupt') { this.agentPanel = undefined; this.returnFromPanel(); }
    else if (key.kind === 'up' || key.kind === 'down') panel.selected = (panel.selected + (key.kind === 'up' ? -1 : 1) + rows.length) % Math.max(1, rows.length);
    else if (key.kind === 'text' && /^[rR]$/u.test(key.value) && rows[panel.selected]?.kind === 'session') panel.rename = (rows[panel.selected] as {session: AgentSession}).session.title;
    else if (key.kind === 'text' && /^[aA]$/u.test(key.value)) { this.agentPanel = undefined; void this.runSlash('/agents', {kind: 'agents', action: 'show'}); }
    else if (key.kind === 'enter') {
      const row = rows[panel.selected];
      if (row?.kind === 'session') this.openAgentView(row.session.id);
      else if (row?.kind === 'harness') {
        const result = this.agents.launch(row.harness.id, this.shellCwd);
        if (result.ok) this.openAgentView(result.session.id); else panel.message = result.reason;
      }
    }
    this.render();
  }

  private handleAgentViewKey(key: Key): void {
    const view = this.agentView!;
    const session = this.agents.get(view.sessionId);
    if (!session || key.kind === 'escape') { this.agentView = undefined; this.returnFromPanel(); this.render(); return; }
    view.message = undefined;
    // Approvals are explicit: A allows once, D denies; nothing else answers them.
    if (session.pendingApproval && !view.input && key.kind === 'text' && /^[aAdD]$/u.test(key.value)) {
      this.agents.answer(session.id, /^[aA]$/u.test(key.value));
    } else if (key.kind === 'interrupt') {
      if (session.state === 'working' || session.state === 'approval') this.agents.cancel(session.id); else { this.agentView = undefined; this.returnFromPanel(); }
    } else if (key.kind === 'toggleDetails') {
      const tools = agentBlocks(session).filter(block => block.kind === 'tool' && block.detail);
      const last = tools.at(-1);
      if (last?.id) { if (view.expanded.has(last.id)) view.expanded.delete(last.id); else view.expanded.add(last.id); }
    } else if (key.kind === 'pageUp' || key.kind === 'wheelUp') view.scroll += key.kind === 'pageUp' ? 10 : 3;
    else if (key.kind === 'pageDown' || key.kind === 'wheelDown') view.scroll = Math.max(0, view.scroll - (key.kind === 'pageDown' ? 10 : 3));
    else if (session.level === 'observed') { /* metadata only: no input */ }
    else if (key.kind === 'text' || key.kind === 'paste') view.input += key.value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, '');
    else if (key.kind === 'newline') view.input += '\n';
    else if (key.kind === 'backspace') view.input = [...view.input].slice(0, -1).join('');
    else if (key.kind === 'enter' && view.input.trim()) {
      const text = view.input;
      view.input = '';
      const copy = /^\/copy(?:\s+(\d+))?\s*$/u.exec(text.trim());
      if (copy) void this.copyAgentBlock(session, Number(copy[1] ?? 1));
      else if (!this.agents.send(session.id, text)) view.message = 'This session is not accepting input.';
      view.scroll = 0;
    }
    this.render();
  }

  /** /copy inside an agent view: the Nth newest reply's visible text, never protocol data. */
  private async copyAgentBlock(session: AgentSession, index: number): Promise<void> {
    const replies = agentBlocks(session).filter(block => block.kind === 'assistant');
    const block = replies[replies.length - index];
    if (!block) { if (this.agentView) this.agentView.message = 'Nothing to copy yet.'; this.render(); return; }
    try { await writeClipboard(block.text); if (this.agentView) this.agentView.message = 'Copied the reply.'; } catch { if (this.agentView) this.agentView.message = 'The clipboard is not available here.'; }
    this.render();
  }

  private openShellPanel(select?: ShellId): void {
    this.panelOrigin = undefined;
    this.shellPanel = createShellPanel(shellAvailability(process.env, true), this.shellId, this.promptConfiguration.shellBackend, this.switchBlocker());
    this.shellPanel.installFor = shell => shellInstall(shell, resolveCommand('brew'));
    if (select) this.shellPanel.selected = Math.max(0, this.shellPanel.shells.findIndex(item => item.adapter.id === select));
  }

  /** Runs an explicitly confirmed `brew install <shell>` (argv, no sudo), then refreshes what is available. */
  private async installShell(shell: ShellId, install: {command: string; args: string[]; label: string}): Promise<void> {
    const panel = this.shellPanel;
    if (!panel) return;
    panel.installing = `Running ${install.label}…`;
    this.render();
    const task = new TaskProgress(`Installing ${shellAdapter(shell).label}`, () => this.render(), Date.now(), shellAdapter(shell).label);
    const outcome = await task.run(install.command, [...install.args]);
    if (this.stopped || this.shellPanel !== panel) return;
    panel.installing = undefined;
    clearProviderDetection();
    panel.shells = shellAvailability(process.env, true);
    const found = panel.shells.find(item => item.adapter.id === shell);
    panel.message = outcome.status === 'succeeded' && found?.executable
      ? `${shellAdapter(shell).label} is installed: ${found.version ?? found.executable}. Enter switches this session to it.`
      : `${shellAdapter(shell).label} was not installed. ${outcome.status === 'succeeded' ? `${install.label} finished, but no usable ${shell} is on PATH.` : task.state.error ?? ''}`.trim();
    this.render();
  }

  /** A factual reason the session cannot switch shells right now, checked before asking the session. */
  private switchBlocker(): string | undefined {
    if (!this.session.features.has('shell-switch')) return OLDER_SERVICE_SWITCH;
    if (this.running) return `"${this.running.command.slice(0, 60)}" is still running; switching would end it. Finish or interrupt it first.`;
    if (this.passthrough) return 'A full-screen program owns the terminal; switching would end it.';
    if (this.startupPending || this.switchedShellStarting) return 'The shell is still starting; switch once it is ready.';
    return undefined;
  }

  /**
   * Replace this session's shell backend in place. The frontend, transcript,
   * draft, session identity, settings and NMSh history stay; shell-specific
   * services (classification, completion, shell history import) are rebound.
   */
  private async switchShell(target: ShellId, command: string): Promise<void> {
    const adapter = shellAdapter(target);
    const blocker = this.switchBlocker();
    const refuse = (message: string) => { this.output.addFrontendInteraction(command, message, ERROR); this.render(); };
    if (target === this.shellId) { this.output.addFrontendInteraction(command, `This session already runs ${adapter.label}.`, INFO); this.render(); return; }
    // The session's own limits (an older service, a running command) come first: they hold whatever shell is chosen.
    if (blocker) return refuse(blocker);
    const unavailable = adapter.unavailableReason(process.env);
    if (unavailable) return refuse(unavailable);
    if (this.shellSwitching) return refuse('A shell switch is already in progress.');
    this.shellSwitching = true;
    const from = shellAdapter(this.shellId).label;
    try {
      await this.session.switchShell(target, this.shellCwd);
    } catch (error) {
      refuse(`Did not switch to ${adapter.label}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    } finally { this.shellSwitching = false; }
    this.shellId = target;
    this.shellJobs = 0;
    this.switchedShellStarting = true;
    // The new shell's first prompt is readiness, not a command completion.
    this.presetShellReady = true;
    this.bindShellServices(target, true);
    // The old presentation ends with the transition and is archived (see /resume); the new backend gets a fresh welcome.
    this.output.addFrontendInteraction(command, `Switched this session from ${from} to ${adapter.label}.`, INFO);
    const fresh = await this.startFreshPresentation(command);
    this.output.addFrontendInteraction(command, `${fresh ? `Same session, now ${adapter.label}, in ${this.shellCwd}; the ${from} view is in /resume. ` : ''}`
      + `${from} aliases, functions, variables and jobs stayed with ${from}; NMSh history and settings carry over.`
      + (target === this.promptConfiguration.shellBackend ? '' : ` New sessions still start ${shellAdapter(this.promptConfiguration.shellBackend).label} (/shell, D to change).`), INFO);
    this.render();
  }

  /** Rebind everything that depends on the shell backend; NMSh-owned state is untouched. */
  private bindShellServices(target: ShellId, reload: boolean): void {
    const adapter = shellAdapter(target);
    if (reload) {
      this.semanticService.kill();
      this.semanticService = target === 'zsh' ? new SemanticService(this.shellCwd) : new PathClassifier(adapter);
    }
    this.completionService.dispose();
    this.completionService = target === 'zsh' ? new CompletionService() : new CompletionService(defaultCompletionSources(adapter.completionSource()));
    this.commandUsageVersion = -1;
    this.commandSources.clear();
    this.shellSuggestions = [];
    this.historyService.shellHistory = target === 'zsh' ? undefined
      : {id: target, file: adapter.historyFile(process.env, homedir()), parse: content => adapter.parseHistory(content)};
    if (reload) void this.loadHistory();
  }

  /** Apply one small settings change and persist it over a fresh read (other windows' edits survive). */
  private updateConfiguration(change: (configuration: PromptConfiguration) => void): void {
    const next = structuredClone(this.promptConfiguration);
    change(next);
    try { savePromptConfiguration(next, undefined, this.promptConfiguration); } catch { /* applies to this window */ }
    this.promptConfiguration = next;
  }

  private runAgentsCommand(command: string, action: 'show' | 'on' | 'off' | 'reset'): void {
    if (action === 'on' || action === 'off') {
      this.updateConfiguration(configuration => { configuration.agentActivity = action === 'on'; });
      this.output.addFrontendInteraction(command, action === 'on' ? 'Agent activity recording is On (local only).' : 'Agent activity recording is Off; existing data is kept until /agents reset.', INFO);
      return;
    }
    if (action === 'reset') {
      try { this.agentActivity.reset(); this.output.addFrontendInteraction(command, 'Deleted all local agent activity data.', INFO); }
      catch (error) { this.output.addFrontendInteraction(command, `Could not delete agent activity data: ${error instanceof Error ? error.message : String(error)}`, ERROR); }
      return;
    }
    const data = this.agentActivity.load();
    this.output.addFrontendBlock(command, renderAgentStats(data, {now: Date.now(), columns: Math.max(20, this.dimensions().columns - 2),
      enabled: this.promptConfiguration.agentActivity, loadState: this.agentActivity.state}));
  }

  private async runNoticesCommand(command: string, action: 'show' | 'on' | 'off' | 'clear'): Promise<void> {
    if (action === 'on' || action === 'off') {
      this.updateConfiguration(configuration => { configuration.sessionNotices = action === 'on'; });
      this.output.addFrontendInteraction(command, `Session notices are ${action === 'on' ? 'On' : 'Off'}.`, INFO);
    } else if (action === 'clear') {
      await this.clearNotices();
      this.output.addFrontendInteraction(command, 'Cleared session notices.', INFO);
    } else {
      const state = this.promptConfiguration.sessionNotices ? 'On' : 'Off';
      const mode = this.sessionMode === 'service' ? '' : ' They need the live-session service; this window runs its shell in-process.';
      this.output.addFrontendInteraction(command, `Session notices are ${state}: other sessions' finished, failed, attention and ended states show above the composer.${mode}`, INFO);
    }
    this.syncNotices();
  }

  private planComposer(columns: number, rows: number, fullInput: ReturnType<TerminalApp['layoutEditorInput']>, suggestions: number,
    panelRows: number | undefined): ScreenPlan {
    const transcriptRows = this.output.wrapped(columns).length;
    const input = {
      rows,
      inputRows: fullInput.allRows.length,
      suggestions,
      inspectorRows: this.inspectorRows(columns).length,
      running: Boolean(this.running),
      detached: this.historyViewport.detached,
      hasOutput: transcriptRows > 0,
      composerPosition: this.promptConfiguration.composerPosition,
      transcriptRows,
      contextPlacement: this.promptConfiguration.placement,
      hasVisibleContext: this.hasVisibleProviderPrompt(),
      composerLayout: this.promptConfiguration.composerLayout,
      composerDividers: this.promptConfiguration.composerDividers,
      panelRows,
    };
    if (input.composerPosition !== 'flow' || !input.detached || panelRows !== undefined) return planScreen(input);
    // Flow scrolled back: where the view starts decides how much of the composer
    // is still on screen, and it is resolved against the following capacity.
    const following = planScreen({...input, detached: false});
    const viewStart = this.historyViewport.resolve(transcriptRows, following.viewportRows);
    return this.historyViewport.detached ? planScreen({...input, viewStart}) : following;
  }

  private render(): void {
    if (this.stopped || this.passthrough || this.externalPassthrough || this.frontendSuspended) { this.cancelPresentation(); return; }
    if (this.idle) { this.paintIdle(); return; }
    for (const task of [this.promptPanelState?.task, this.toolsPanel?.task, this.providerPanelState?.task]) task?.setReducedMotion(!this.decorativeMotionAllowed());
    if (!this.decorativeMotionAllowed()) this.effects.cancel();
    this.syncPanelAnimation();
    if (this.pendingMilestone && !this.settingsPanelActive && !this.running) this.milestoneEffect();
    void this.fetchSuggestions();
    const {columns, rows} = this.dimensions();
    const availableSuggestions = this.composerSuggestions();
    const panelRows = this.settingsPanelActive ? this.settingsPanelRows(columns) : undefined;
    this.noteSelection(panelRows);
    const promptLine = this.currentPromptLine(columns);
    this.editor.ghost = this.suggestionGhost();
    const fullInput = this.layoutEditorInput(columns);
    const completionMenu = availableSuggestions === this.shellSuggestions && availableSuggestions.length > 0;
    const plan = this.planFrame(columns, rows, fullInput, completionMenu ? completionMenuRows(availableSuggestions.length) : availableSuggestions.length, panelRows?.length);
    const input = plan.panelActive
      ? {...fullInput, rows: [], caretRow: 0, caretColumn: 0}
      : this.layoutEditorInput(columns, plan.inputHeight);
    const effectiveSelection = Math.max(0, Math.min(availableSuggestions.length - 1, this.selectedSuggestion));
    // A bounded completion viewport: when candidates overflow it, the last row says how many follow.
    const menuOverflow = completionMenu && plan.suggestionCount > 1 && availableSuggestions.length > plan.suggestionCount;
    const suggestionView = suggestionWindow(availableSuggestions, effectiveSelection, menuOverflow ? plan.suggestionCount - 1 : plan.suggestionCount);
    const hiddenBelow = menuOverflow ? availableSuggestions.length - suggestionView.start - suggestionView.items.length : 0;
    if (this.lastPtyRows !== plan.ptyRows || this.lastPtyColumns !== columns) {
      this.lastPtyRows = plan.ptyRows;
      this.lastPtyColumns = columns;
      this.session.resize(columns, plan.ptyRows);
    }

    const wrapped = this.output.wrapped(columns);
    if (this.findState) {
      const before = this.findState.active;
      refreshFind(this.findState, wrapped, this.findGeneration(wrapped, columns));
      if (this.findState.active !== before) this.revealFindMatch(wrapped.length, plan.viewportRows);
    }
    const viewStart = this.historyViewport.resolve(wrapped.length, plan.viewportRows);
    // Flow's viewport scrolls by its capacity; the region shows only what is on screen.
    const outputHeight = plan.transcript.height;
    const presenter = this.output.presenter;
    const interaction = {hoveredLineIndex: this.hoveredLineIndex, focusedLineIndex: this.focusedLineIndex,
      focusedCommandIndex: this.focusedCommandIndex, focusedActivityId: this.focusedActivityId,
      now: presentationNow().getTime()};
    // Matching lines show every clause's spans; the active result is marked more strongly. Presentation only.
    const findSpans = new Map<number, {spans: Array<{start: number; end: number}>; active: boolean}>();
    if (this.findState) this.findState.results.forEach((result, index) => {
      for (const [row, spans] of result.spans) findSpans.set(row, {spans, active: index === this.findState!.active});
    });
    const visible = wrapped.slice(viewStart, viewStart + outputHeight).map((row, offset) => {
      if (isRowSelected(this.selection, viewStart + offset)) return `${background(UI_COLORS.selection)}${PRIMARY}${row.plain}${RESET}`;
      const marked = findSpans.get(viewStart + offset);
      if (marked) return markSpans(row.plain, marked.spans, `${background(UI_COLORS.selection)}${PRIMARY}`, marked.active ? `${PRIMARY}` : SECONDARY,
        marked.active ? '' : '\u001b[4m');
      const ansi = presenter.decorate(row, row.lineIndex === undefined ? undefined : this.output.lineTypes.get(row.lineIndex), interaction);
      const focused = this.focusedCommandIndex !== undefined && row.lineIndex === this.output.recent(this.focusedCommandIndex + 1)?.startId;
      const controls = !this.running && (focused || row.lineIndex === this.hoveredLineIndex) ? blockAffordance(row, columns) : undefined;
      return controls ? `${ansi}${RESET}${controls.suffix}` : ansi;
    });
    const sticky = this.stickyHeader(wrapped, viewStart);
    const stickyRow = sticky && this.output.presentSticky(sticky.startId, columns);
    if (stickyRow && visible.length > 0) visible[0] = stickyRow;
    const SELECTION_BG = background(UI_COLORS.selection);
    const sel = this.editor.displaySelection;

    const inputChars = graphemes(this.editor.displayText);
    const pasteAtoms = this.editor.displayPasteAtoms;
    const tokens = this.highlighter.tokenize(inputChars, this.semanticService.cache);
    const charColors = syntaxCharStyles(tokens, inputChars.length, this.syntaxSgr);

    for (const token of tokens) {
      if (token.type === 'Command') {
        const before = this.semanticService.cache.get(token.text);
        void this.semanticService.classifyCommand(token.text).then(() => {
          // Unavailable/uncached results must not schedule another immediate
          // render and classification loop that starves editor input.
          if (this.semanticService.cache.get(token.text) !== before) this.render();
        });
      }
    }

    const inputRows = input.rows.map(row => {
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
      const line = truncateAnsi(`${prefix}${textStyled}${suffix}`, columns);
      return row.charStart === 0 && row === input.allRows[0] ? `${line}${this.oneLineRightContext(line, columns)}` : line;
    });

    // The plan decides where each region lives; this only decides what paints into it.
    // Composer top and bottom divider lines; the prompt row's divider fill uses the same source.
    const separator = `${paintDivider(repeatToWidth(GLYPHS.separator, columns), this.promptConfiguration.presentation, Date.now())}${RESET}`;
    const regionRows = (region: Region): string[] => {
      switch (region.kind) {
        case 'transcript': return visible;
        case 'gap': return [];
        case 'jump': return [this.jumpAffordance(columns)];
        // Panels frame their composer-side edge: under Dock Top the frame line moves below the panel.
        case 'panel': return plan.composerPosition === 'top' && panelRows && /^[─-]+$/u.test(stripAnsi(panelRows[0] ?? ''))
          ? [...panelRows.slice(1), panelRows[0]!] : panelRows ?? [];
        case 'inspector': return this.inspectorRows(columns);
        case 'suggestions': return [...suggestionView.items.map((suggestion, visibleIndex) => {
          const selected = suggestionView.start + visibleIndex === effectiveSelection;
          if ('correction' in suggestion) return renderCorrection(suggestion, columns);
          if ('source' in suggestion && 'replacement' in suggestion) {
            return renderCompletion(suggestion, selected, columns, this.completionDescription(suggestion));
          }
          return truncateAnsi(
            `${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${suggestion.name.padEnd(10)}${RESET}${SECONDARY} ${suggestion.description}${RESET}`,
            columns,
          );
        }), ...(menuOverflow ? [renderCompletionMore(hiddenBelow, suggestionView.start, columns)] : [])];
        // The spacer sits between the newest output and the activity line in both positions.
        case 'activity': {
          if (!this.running) return [];
          const activity = truncateAnsi(this.currentActivity(), columns);
          return plan.composerPosition === 'top' ? ['', activity] : [activity, ''];
        }
        case 'composerBorder': return [separator];
        case 'prompt': return [promptLine];
        case 'input': return inputRows;
        case 'separator': return [separator];
        case 'status': return [this.statusStripRow(columns)];
        case 'notices': return this.noticeRows(columns);
        case 'find': return this.searchChrome(columns);
      }
    };
    const frameRows = new Array<string>(plan.rows).fill('');
    for (const region of plan.regions) {
      const content = regionRows(region);
      for (let index = 0; index < region.height; index += 1) frameRows[region.top + index] = content[index] ?? '';
    }

    const frame: TerminalFrame = {
      rows: frameRows,
      columns,
      cursorRow: terminalRowFromScreen(cursorScreenRow(plan, input.caretRow)),
      cursorColumn: Math.max(1, Math.min(columns, input.caretColumn + 1)),
      // Flow can scroll the input row off screen.
      cursorVisible: !plan.panelActive && plan.inputHeight > 0,
    };
    this.renderer.setImageOverlay(this.aboutOverlay(plan, columns));
    this.presentationFrame = {frame, plan};
    this.paintPresentation(Date.now());
    this.syncPresentationClock();
  }

  /** /about: build identity and the logo, as an image where the host supports one, text otherwise. */
  private aboutPanel?: {protocol: ImageProtocol; png?: Buffer};

  private openAbout(): void {
    const protocol = selectImageProtocol({capabilities: this.host.capabilities, env: process.env});
    let png: Buffer | undefined;
    if (protocol !== 'none') try { png = readFileSync(join(installRoot(), 'assets', 'brand', 'nmsh-logo.png')); } catch { /* text logo */ }
    this.aboutPanel = {protocol: png ? protocol : 'none', ...(png ? {png} : {})};
  }

  private aboutLogoSize(columns: number): ImageSize {
    const size = this.aboutPanel?.png && pngSize(this.aboutPanel.png);
    return size ? fitCells(size.width, size.height, Math.max(8, columns - 6), 6) : {columns: 0, rows: 0};
  }

  private aboutRows(columns: number): string[] {
    const panel = this.aboutPanel!;
    const rows = [`${PRIMARY}  About NMSh${RESET}`, ''];
    if (panel.protocol !== 'none') rows.push(...Array<string>(this.aboutLogoSize(columns).rows).fill(''));
    else rows.push(`  ${ACCENT}\u001b[1mN${SECONDARY}❯${ACCENT}MSh${RESET}`, `  ${PRIMARY}not${ACCENT}My${PRIMARY}Shell${RESET}`);
    const images = panel.protocol === 'kitty' ? 'Kitty graphics protocol' : panel.protocol === 'iterm2' ? 'iTerm2 inline images'
      : 'not available in this terminal; NMSh works fully without them';
    rows.push('', `  ${SUBTLE}${formatBuildIdentity(this.buildIdentity)}${RESET}`,
      `  ${SUBTLE}Keep your terminal. Keep your shell. Upgrade the interaction layer.${RESET}`,
      `  ${SUBTLE}Inline images: ${images}${RESET}`, '', `  ${SUBTLE}Any key closes${RESET}`);
    return rows;
  }

  /** The logo overlay sits in the blank rows reserved by aboutRows inside the panel region. */
  private aboutOverlay(plan: ScreenPlan, columns: number): ImageOverlay | undefined {
    const panel = this.aboutPanel;
    const region = plan.regions.find(item => item.kind === 'panel');
    if (!panel?.png || panel.protocol === 'none' || !region) return undefined;
    const size = this.aboutLogoSize(columns);
    // framePanel's frame line leads the panel (it moves below the panel under Dock Top), then title and spacer.
    const row = region.top + (plan.composerPosition === 'top' ? 0 : 1) + 2;
    if (row + size.rows > region.top + region.height) return undefined;
    return createImageOverlay(panel.protocol, panel.png, `about:${panel.protocol}:${row}:${size.columns}x${size.rows}`, row, 2, size);
  }

  /** Existing #91 tasks repaint their panel only while its geometry is unchanged. */
  private renderTaskPresentation(): void {
    if (this.idle) return;
    if (this.stopped || this.passthrough || this.externalPassthrough || this.frontendSuspended) { this.cancelPresentation(); return; }
    const cached = this.presentationFrame;
    const region = cached?.plan.regions.find(item => item.kind === 'panel');
    if (!cached || !region) { this.render(); return; }
    for (const task of [this.promptPanelState?.task, this.toolsPanel?.task, this.providerPanelState?.task]) task?.setReducedMotion(!this.decorativeMotionAllowed());
    const content = this.settingsPanelRows(cached.frame.columns ?? 80);
    if (Math.min(cached.plan.rows, content.length) !== region.height) { this.render(); return; }
    const projected = cached.plan.composerPosition === 'top' && /^[─-]+$/u.test(stripAnsi(content[0] ?? ''))
      ? [...content.slice(1), content[0]!] : content;
    const rows = [...cached.frame.rows];
    for (let index = 0; index < region.height; index++) rows[region.top + index] = projected[index] ?? '';
    this.presentationFrame = {...cached, frame: {...cached.frame, rows}};
    this.paintPresentation(Date.now());
  }

  private decorativeMotionAllowed(): boolean {
    return !isReducedMotion() && !this.promptConfiguration.presentation.reducedMotion && !this.promptConfiguration.presentation.effectsOff;
  }

  private cancelPresentation(): void {
    this.effects.cancel();
    this.endSweep();
    if (this.escapeFlushTimer) { clearTimeout(this.escapeFlushTimer); this.escapeFlushTimer = undefined; }
    this.stopIdleFrames();
    this.idle = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.stripTimer?.(); this.stripTimer = undefined;
    this.noticeTimer?.(); this.noticeTimer = undefined;
    this.panelAnimation?.(); this.panelAnimation = undefined;
    this.presentationSubscription?.(); this.presentationSubscription = undefined;
    this.welcomeBlinkTimer?.(); this.welcomeBlinkTimer = undefined;
    this.output.setWelcomeFrame('open');
    this.presentationFrame = undefined;
  }

  /** Decorative frames reuse the base projection; they never walk transcript history. */
  private paintPresentation(now: number): void {
    // Idle visuals are the sole owner of the screen while active.
    if (this.idle) return;
    const cached = this.presentationFrame;
    if (!cached) return;
    const {frame, plan} = cached;
    const settings = this.promptConfiguration.presentation;
    const rows = [...frame.rows];
    for (const region of plan.regions) {
      if (region.kind === 'activity' && this.running) {
        const line = truncateAnsi(this.currentActivity(), frame.columns ?? 80);
        const content = plan.composerPosition === 'top' ? ['', line] : [line, ''];
        for (let index = 0; index < region.height; index++) rows[region.top + index] = content[index] ?? '';
      }
      // Live composer divider lines move with Chroma only when Divider lines follow Chroma.
      if ((region.kind === 'separator' || region.kind === 'composerBorder') && dividerAnimated(settings)) {
        rows[region.top] = paintDivider(repeatToWidth(GLYPHS.separator, frame.columns ?? 80), settings, now) + RESET;
      }
      // The prompt row is re-rendered from the same semantic modules; only Chroma colors move (its divider fill too).
      if (region.kind === 'prompt' && region.height > 0 && (this.promptChromaAnimated() || dividerAnimated(settings)) && this.decorativeMotionAllowed()) {
        rows[region.top] = this.currentPromptLine(frame.columns ?? 80, now);
      }
    }
    this.applySweep(rows, plan, frame.columns ?? 80);
    const active = this.effects.active;
    const region = active && effectRegion(plan, active.placement);
    if (active && !region) this.effects.cancel();
    // Cursor effects: an overlay on the input rows only, never over panels, passthrough or idle visuals.
    const columns = frame.columns ?? 80;
    const input = plan.regions.find(item => item.kind === 'input');
    const caretShown = frame.cursorVisible !== false && Boolean(input) && !plan.panelActive;
    const cursor = this.cursorPresenter.apply(rows, caretShown ? {row: frame.cursorRow - 1, column: frame.cursorColumn - 1} : undefined,
      {top: Math.max(0, (input?.top ?? 0) - 1), bottom: (input?.top ?? 0) + (input?.height ?? 1) - 1, columns}, this.caretCause,
      !this.passthrough && !this.externalPassthrough && this.decorativeMotionAllowed() && colorLevel() !== 'none', now, this.cursorBackend());
    const painted = cursor.rows;
    try {
      this.renderer.render({...frame, ...(cursor.hideCaret ? {cursorVisible: false} : {}), rows: active && region
        ? applyEffect(painted, active, region, columns, now, getCurrentGlyphMode() === 'safe', colorLevel()) : painted});
    } catch (error) { this.onTerminate(); throw error; }
  }

  private renderPresentation(now: number): void {
    if (this.idle) return;
    if (this.stopped || this.passthrough || this.externalPassthrough || this.frontendSuspended) { this.cancelPresentation(); return; }
    if (!this.decorativeMotionAllowed()) this.effects.cancel();
    this.effects.expire(now);
    if (this.running) {
      this.activityAnimationNow = now;
      this.output.tickActiveCommand();
      if (this.passthrough) { this.cancelPresentation(); return; }
    }
    this.paintPresentation(now);
    this.syncPresentationClock();
  }

  private syncPresentationClock(): void {
    if (!this.presentationStarted || this.stopped || this.idle) return;
    this.syncStatusStrip();
    this.syncNotices();
    this.syncAgents();
    const settings = this.promptConfiguration.presentation;
    const animatedRule = this.presentationFrame?.plan.regions.some(region => region.kind === 'separator' || region.kind === 'composerBorder'
      || (region.kind === 'prompt' && region.height > 0)) && dividerAnimated(settings) && colorLevel() !== 'none';
    const animatedPrompt = this.presentationFrame?.plan.regions.some(region => region.kind === 'prompt' && region.height > 0) && this.promptChromaAnimated();
    const needsFrames = Boolean(this.running || this.effects.active || ((animatedRule || animatedPrompt) && this.decorativeMotionAllowed()));
    if (needsFrames && !this.presentationSubscription) this.presentationSubscription = presentationClock.subscribe(now => this.renderPresentation(now));
    if (!needsFrames) { this.presentationSubscription?.(); this.presentationSubscription = undefined; }
    if (this.decorativeMotionAllowed() && this.output.hasWelcome && !this.welcomeBlinkTimer) this.scheduleWelcomeBlink();
    if (!this.decorativeMotionAllowed()) {
      this.welcomeBlinkTimer?.(); this.welcomeBlinkTimer = undefined; this.output.setWelcomeFrame('open');
    }
  }

  private currentActivity(): string {
    if (!this.running) return '';
    const elapsed = this.activityAnimationNow - this.running.startedAt;
    const isActive = (Date.now() - this.lastOutputTime) < 750;
    const animationElapsed = this.decorativeMotionAllowed() ? presentationAnimationElapsed(elapsed) : 0;
    const parts = liveActivityParts(this.running.command, elapsed, animationElapsed);
    // A soft light sweep over the working phrase: its own colors lifted in place, never moved; faster while output arrives.
    // Colors come from Live activity colors; the sweep is the same light sweep everywhere.
    const still = !this.decorativeMotionAllowed() || sweepStill(this.promptConfiguration);
    const {cells, style} = liveActivityPaint(parts.phrase, this.promptConfiguration, this.activityAnimationNow, still);
    const phrase = sweepCells(cells, animationElapsed * (isActive ? 1.4 : 1), style, colorLevel(), !this.decorativeMotionAllowed());
    return `${phrase}${SECONDARY}${parts.duration}${RESET}`;
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

  /**
   * One-line composer: right-aligned context on the first input row while the
   * typed text leaves room, like a right prompt. It yields to the input and
   * never pushes the caret or wraps.
   */
  private oneLineRightContext(line: string, columns: number): string {
    if (this.promptConfiguration.composerLayout !== 'oneLine' || this.effectivePromptProvider !== 'nmsh') return '';
    const used = displayWidth(line);
    // Two cells of breathing room after the text, plus the caret cell.
    const right = buildRightContext(this.promptContext(), columns - used - 2, this.promptConfiguration);
    if (!right) return '';
    return `${RESET}${' '.repeat(columns - used - displayWidth(right))}${right}${RESET}`;
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

  /** Transcript row under a terminal row, clamped to the transcript region so a drag past its edge keeps selecting. */
  private transcriptRowAt(y: number): number | undefined {
    const {columns, rows} = this.dimensions();
    const plan = this.planFrame(columns, rows);
    const wrapped = this.output.wrapped(columns);
    if (!wrapped.length) return undefined;
    const viewStart = this.historyViewport.resolve(wrapped.length, plan.viewportRows);
    const top = plan.transcript.top;
    const local = Math.max(0, Math.min(plan.transcript.height - 1, screenRowFromTerminal(y) - top));
    return Math.min(wrapped.length - 1, viewStart + local);
  }

  private handleSelectionPointer(kind: 'mouseDrag' | 'mouseRelease', y: number | undefined): void {
    const selection = this.selection;
    if (!selection?.dragging || !y) return;
    const row = this.transcriptRowAt(y);
    if (row !== undefined) extendSelection(selection, row, y);
    if (kind === 'mouseRelease') {
      selection.dragging = false;
      if (!selection.moved) { this.selection = undefined; return; }
      const text = selectedText(this.output.wrapped(this.dimensions().columns), selection);
      // Like a terminal selection: copied on release, silently; only a failure is worth a line.
      if (text) void writeClipboard(text).catch(() => {
        this.output.addFrontendInteraction('selection', 'Could not copy the selection: no clipboard is available here.', ERROR);
        this.render();
      });
    }
    this.render();
  }

  /** While dragging, a wheel step scrolls the transcript and the selection follows the pointer's row. */
  private followSelectionPointer(): void {
    const selection = this.selection;
    if (!selection?.dragging || selection.pointerY === undefined) return;
    const row = this.transcriptRowAt(selection.pointerY);
    if (row !== undefined) extendSelection(selection, row);
    this.render();
  }

  /** The ordinary shell to hand the terminal to after NMSh exits, when one was requested. */
  get shellHandoff(): {shell: ShellId; executable: string; label: string; cwd?: string; returnSession?: string} | undefined {
    return this.requestedHandoff;
  }

  /** Kept for existing callers. */
  get ordinaryZshHandoffCwd(): string | undefined { return this.requestedHandoff?.cwd; }
  get isOrdinaryZshHandoffRequested(): boolean { return Boolean(this.requestedHandoff); }

  /**
   * Leave NMSh for an ordinary interactive shell: /zsh, /fish, /bash, or /exit
   * (the configured default backend, never $SHELL). One decision path; a busy
   * session or a missing shell keeps NMSh running and untouched.
   */
  private leaveForOrdinaryShell(target: ShellId, command: string): void {
    const adapter = shellAdapter(target);
    const executable = adapter.resolveExecutable(process.env);
    if (!executable) {
      const isDefault = command === '/exit';
      this.output.addFrontendInteraction(command, `${isDefault ? `Your default shell (${adapter.label}) is not available. ` : ''}${adapter.unavailableReason(process.env) ?? `${adapter.label} is not available.`} `
        + `NMSh stays open. ${isDefault ? 'Install it from /shell, or choose another default there (D). ' : 'Install it from /shell. '}No other shell was started.`, ERROR);
      this.render();
      return;
    }
    const busy = this.running ? `"${this.running.command.slice(0, 60)}" is still running`
      : this.passthrough || this.externalPassthrough ? 'a full-screen program owns the terminal'
      : this.startupPending || this.switchedShellStarting ? 'the shell is still starting'
      : this.shellJobs ? `${this.shellJobs} background or stopped job${this.shellJobs === 1 ? '' : 's'} would end with the session (jobs, fg, kill %N)` : undefined;
    const decision: ShellHandoffDecision = chooseShellHandoff(busy ? `${busy}; finish or interrupt it, then run ${command} again.` : false, this.shellCwd, this.initialCwd);
    if (decision.kind === 'busy') {
      this.output.addFrontendInteraction(command, `Not leaving NMSh: ${decision.reason ?? 'the session is busy.'}`, INFO);
      this.render();
      return;
    }
    // A service session is detached, not ended: `nmsh` in the ordinary shell returns to exactly this session.
    // In-process there is no service to keep it, so the session ends as before.
    const keep = this.sessionMode === 'service' && Boolean(this.sessionId);
    this.requestedHandoff = {shell: target, executable, label: adapter.label, ...(decision.cwd ? {cwd: decision.cwd} : {}),
      ...(keep ? {returnSession: this.sessionId!} : {})};
    if (keep) {
      this.detaching = true;
      this.session.detach();
    } else {
      this.shellEnded = true;
      this.session.kill();
    }
    this.stop(0);
  }

  /** A /shell switch started a new backend that has not reached its first prompt. */
  private switchedShellStarting = false;
  /** Background/stopped jobs in the managed shell, from its latest name snapshot. */
  private shellJobs = 0;
  private requestedHandoff?: {shell: ShellId; executable: string; label: string; cwd?: string; returnSession?: string};

  private stop(exitCode: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.understanding.dispose();
    this.agentDiscoveryTimer?.();
    this.agentsSubscription();
    this.agents.dispose();
    this.cursorPresenter.dispose();
    this.cursorPanelClock?.(); this.cursorPanelClock = undefined;
    this.tasksSubscription();
    this.taskClock?.(); this.taskClock = undefined;
    this.askClock?.(); this.askClock = undefined;
    this.managedTasks.dispose();
    this.cancelPresentation();
    this.promptPanelState?.task?.dispose();
    this.presetStartup?.cancel();
    this.endStartupWatch();
    this.miseService.cancel();
    this.toolsPanel?.task?.dispose();
    this.installPrompt?.task?.dispose();
    this.providerPanelState?.task?.dispose();
    this.welcomeBlinkTimer?.();
    this.welcomeBlinkTimer = undefined;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    this.stopIdleFrames();
    this.idle = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.endSweep();
    process.stdin.off('data', this.onInput);
    process.stdout.off('resize', this.onResize);
    process.off('SIGTSTP', this.onSuspend);
    process.off('SIGCONT', this.onContinue);
    process.off('SIGTERM', this.onTerminate);
    process.off('SIGHUP', this.onTerminate);
    if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
    process.stdin.pause();
    this.terminalFocus = 'unknown';
    try { this.renderer.leave(); } catch { /* A closed terminal must not prevent resource cleanup. */ }
    this.completionService.dispose();
    this.commandDescriptions.dispose();
    this.historyQueryAbort?.abort();
    this.clearCorrection();
    this.directoryQueryAbort?.abort();
    this.pickerAbort?.abort();
    this.historyService.dispose();
    this.semanticService.kill();
    this.finish(exitCode);
  }
}

/** Commands newest first, read lazily so navigation stops at its bound. */
function* historyCommands(entries: readonly {command: string}[]): Iterable<string> {
  for (const entry of entries) yield entry.command;
}
