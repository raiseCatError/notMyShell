import {failurePolicyNote} from '../status/queueText.js';
import {formatDuration} from '../status/commandTiming.js';
import {renderQueueActivitySummary} from '../status/executionTimeline.js';
import {queuePresentationChanges, queueRowKey, staleQueueSnapshot} from '../status/queueTransitions.js';
import {shellSubmission} from '../shell/submission.js';
import {railNeedsPromptConversion, railPreviewConfiguration} from '../prompt/railLayout.js';
import {prepareRail, paintRailComposition, railCompositionPreview, type PreparedRail} from '../prompt/railComposition.js';
import {routeModule} from '../context/surfaceRouter.js';
import {promptFacts, moduleFactContext, updateFact, factAllowed} from '../context/facts.js';
import {chromaPreviewNote} from '../appearance/chromaNotes.js';
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
import {detectBackend, keepAwakePath, KeepAwakeController, type KeepAwakeRecord} from '../keepAwake/keepAwake.js';
import {awakeDuration, awakeLabel, awakeStyle, awakeView, edgeAccessoryColumns, edgeFits, placeOnSaver, renderComposerEdge, resolveAccessorySlot, sliceAnsiCells} from '../keepAwake/presentation.js';
import {createKeepAwakePanel, describeStart, keepAwakeKey, renderKeepAwakePanel, requestStart, statusLines, type KeepAwakePanel} from '../keepAwake/KeepAwakePanel.js';
import {homedir, tmpdir} from 'node:os';
import {createNotificationService, formatCommandNotification, shouldNotify, type TerminalFocus} from '../notifications/commandNotifications.js';
import {blockAffordance, blockControlsLayout, blockPaletteItems, stickyControlsWidth, type BlockActionId, type BlockControls} from '../ui/BlockActions.js';
import {paletteItems} from '../ui/CommandPalette.js';
import {createConfigurationPanel, configurationKey, renderConfigurationPanel, type ConfigurationPanel} from '../tools/ConfigurationPanel.js';
import {openSupportedConfiguration} from '../tools/SupportedConfiguration.js';
import {selectOpener} from '../host/desktop.js';
import {findOutputReferences, referenceFollowUp} from '../output/references.js';
import {referenceCopyText, referencePaletteItems} from '../ui/ReferenceMenu.js';
import {integrationActivation} from '../tools/Activation.js';
import {confirmToolInstall, createToolsPanel, refreshTools, renderTools, toolsKey, type ToolsPanel} from '../tools/ToolsPanel.js';
import {describeCommandSource, describeSlashCommand, inspectCommand, renderInspector} from '../shell/CommandInspector.js';
import {CHROMA_PREVIEW_NOTE, createSetup, createQuickSetup, GUIDED_STEPS, guidedPreviewWidth, NATIVE_ONLY_NOTE, renderSetup, wrapWords, SETUP_MIN_SIZE, SETUP_SECTIONS, setStartupEvidence, setupIsIdempotent, setupKey, setupSelectedRow, type SetupState, setupShowsChroma, chromaVisibilityNote} from '../setup/SetupCat.js';
import {detectEnvironment, type EnvironmentEvidence} from '../setup/environment/detect.js';
import {createStartupContext, defaultStartupPreview, startupCatX, startupLayout} from '../setup/startup/view.js';
import {paintStartupEnding, WELCOME_START_MS, type StartupEnding} from '../setup/startup/ending.js';
import {STARTING_POINT_MOODS, startingPointAt} from '../setup/startup/startingPoints.js';
import {renderFirstRunWelcome} from '../output/FirstRunWelcome.js';
import {FirstRunWindow} from '../host/window/firstRun.js';
import {systemWindowContext, windowHost} from '../host/window/route.js';
import {skyFrameMs} from '../setup/startup/sky.js';
import {keepExistingPlan} from '../setup/environment/keepExisting.js';
import {glyphDiagnosticRows} from '../setup/glyphDiagnostic.js';
import {fits, renderTooSmall, type MinimumSize} from '../ui/Modal.js';
import {CellGrid} from '../idle/CellGrid.js';
import {IDLE_FRAME_MS, type IdleMode, IDLE_MODE_LABELS} from '../idle/scenes.js';
import {createScreensaverPanel, effectiveMode, idleFrameRows, idleMotion, idlePaletteFor, previewSize, renderScreensaverPanel, sceneTime, SCREENSAVER_MIN_SIZE, screensaverKey, IDLE_SEED, type ScreensaverPanelState, idlePreviewRows, previewSaver} from '../idle/IdleVisuals.js';
import {captureFromRows, cropCapture, type ScreenCapture} from '../idle/screenCapture.js';
import {makeRng} from '../idle/screenEffects.js';
import {SCREEN_MODE_EFFECT, pickRandomSaver, saverLoopComplete, IDLE_FRAME_MS as SAVER_FRAME_MS} from '../idle/scenes.js';
import {createThemeStudio, readThemeImport, previewTheme, renderThemeStudio, STUDIO_MIN_SIZE, studioKey, writeThemeExport, type StudioContext, type StudioTab, type ThemeStudioState} from '../appearance/ThemeStudio.js';
import {addTheme, deleteTheme, duplicateBuiltin, duplicateCurrentToCustom, duplicateRefToCustom, duplicateTheme, renameTheme, saveTheme, setActiveTheme, type ActionResult} from '../appearance/themeLibraryActions.js';
import {findTheme} from '../appearance/themeLibrary.js';
import {activeThemeRef, assetRef, selectableThemes, themeRefLabel} from '../appearance/themeRefs.js';
import {resolveSemanticPalette} from '../appearance/semanticPalette.js';
import {anyBridgeTargetActive, targetsPinnedTo, type BridgeTargetId} from '../themeBridge/model.js';
import {applyThemeBridge, bridgeColorLevel, bridgeStateExists, detectTargets, fzfBridgeArgs, integrationHealth, reloadTmux, reportTargets, setupBat, targetPalette, themeBridgeKey, type ApplyOutcome, type BridgeContext, type TargetFacts, type TargetReport} from '../themeBridge/runtime.js';
import {createThemeBridgePanel, renderThemeBridgePanel, themeBridgeKey as themeBridgePanelKey, type BridgePanelAction, type BridgePanelContext, type ThemeBridgePanelState} from '../themeBridge/ThemeBridgePanel.js';
import {createRowPanel, renderRowPanel, rowPanelKey, type RowPanelState} from '../ui/RowPanel.js';
import {copiedNote, copySelectionPayload, parseCopyArgs, recordCopyText, resolveCopySelection, semanticCopyPayload, type CopyContent} from '../clipboard/copySelection.js';
import {captureOutputAnchor, createOutputSelection, moveOutputSelection, restoreOutputAnchor, revealOutputSelection, validateOutputSelection, type OutputAnchor, type OutputScope, type OutputSelection} from '../output/OutputSelection.js';
import {copyPickerKey, createCopyPicker, renderCopyPicker, type CopyPickerState} from '../ui/CopyPicker.js';
import {DEFAULT_REPORT_OPTIONS, describeFindings, redactText, scanSensitive, type ReportFormat} from '../clipboard/report.js';
import {applyReportEdit, createReportReview, createTextReview, renderReportReview, reportReviewKey, type ReportReviewState} from '../ui/ReportReview.js';
import {configuredEditor} from '../host/HostActions.js';
import {comparePanelKey, createComparePanel, renderComparePanel, type ComparePanelState} from '../ui/ComparePanel.js';
import {displayPath, loadFileDocument, outputDocument} from '../viewer/document.js';
import {createViewer, renderViewer, viewerKey, type ViewerLook, type ViewerState} from '../viewer/ViewerPanel.js';
import {createEditor, editorKey, renderEditor, type EditorAction, type EditorState} from '../viewer/EditorPanel.js';
import {openForEdit, saveFile} from '../viewer/fileEdit.js';
import {buildComparisonReport, copyableDiff, previousRun} from '../output/compare.js';
import {createStripStudio, renderStripStudio, stripStudioKey, type StripStudioState} from '../status/StripStudio.js';
import {configureListKey, renderConfigureList, type ConfigureListState} from '../tools/config/ConfigureList.js';
import {registryFacts, toolConfigEntry} from '../tools/config/registry.js';
import {createTmuxPanel, describeTmuxChange, pendingChanges, renderTmuxPanel, tmuxPanelKey, type TmuxPanelState} from '../tools/config/TmuxPanel.js';
import {applyTmuxChange, loadTmuxModel, parseTmuxConfig, readUserTmuxConfig, saveTmuxModel} from '../tools/config/tmux.js';
import {writeTmuxManaged} from '../tools/config/tmuxManaged.js';
import {createDotfilesPanel, dotfilesKey, renderDotfilesPanel, type DotfilesAction, type DotfilesState} from '../dotfiles/DotfilesPanel.js';
import {expandSource, isRemoteSource, scanDotfiles} from '../dotfiles/scan.js';
import {applyPlan as applyDotfilesPlan, buildPlan, reviewLines} from '../dotfiles/plan.js';
import {applyHook, applyHookRemoval, artifactPath, hookSpec, loadLedger, ownership, planHook, planHookRemoval, recordedHook, removeArtifact, type HookSpec, type HookTarget, type ManagedTarget} from '../themeBridge/artifacts.js';
import {BRIDGE_MODE_LABELS, BRIDGE_POLICY_LABELS, BRIDGE_TARGET_LABELS, effectiveMode as bridgeMode} from '../themeBridge/model.js';
import type {FileEditPlan} from '../ask/fileEdit.js';
import {colorEscape} from '../chroma/escape.js';
import {parseHexColor} from '../chroma/color.js';
import type {CustomTheme} from '../appearance/customTheme.js';
import {commandWord, createInstallPrompt, ignoreInstallSuggestion, installCandidate, installPromptKey, renderInstallPrompt, shouldOfferInstall,
  type InstallPromptState} from '../tools/InstallSuggestion.js';
import {detectTool, knownToolForExecutable, suggestibleToolFor, toolInstall, TOOLS, verifyTool, type Tool, type ToolTier} from '../tools/catalog.js';
import {openGuidedInstall, openPrevious} from '../tools/OhMyZshView.js';
import {planPackageInstall} from '../packages/managers.js';
import {loadToolUpdateState, runToolUpdateCheck, toolUpdateCheckDue, type ToolUpdateState} from '../tools/ToolUpdates.js';
import type {CommandSource} from '../shell/SemanticService.js';
import {GLYPHS, setIconStyle, getCurrentGlyphMode, setPromptSymbol} from '../ui/glyphs.js';
import {applyUiTheme, uiColorsFor} from '../appearance/uiTheme.js';
import {chromeColorsFrom, resolveChrome} from '../appearance/uiChrome.js';
import {CHROME_EDITOR_MIN_SIZE, chromeEditorKey, createChromeEditor, renderChromeEditor, type ChromeEditorState} from '../appearance/ChromeEditor.js';
import {promptSymbolGlyph} from '../prompt/glyphChoices.js';
import {framePanel, renderTabStrip, selectedRowBand, tabCycleDelta} from '../ui/PanelShell.js';
import {providerExplanation} from '../setup/providerExplanations.js';
import {liveActivityPaint} from '../status/liveActivityColors.js';
import {renderControlRows, renderControls} from '../ui/controls.js';
import {gradientEditorControls, gradientEditorKey, isApplyKey, renderGradientEditorRows, type GradientEditorState} from '../ui/GradientEditor.js';
import {
  adjustSettingsRow, isInlineEditable, resetSettingsRow, settingsRowChanged, renderSettingsPanel, selectedSettingsRow, settingsItemCount, settingsRowDestination,
  settingsRowValue, settingsView, statusLineCount, statusSection, visibleSettingsRows, switchSettingsView, toggleSettingsRow, type SettingsDestination, type SettingsPanelState,
  type SettingsView, type StatusSections,
  SETTINGS_ENTRIES,
  SETTINGS_ROWS,
  QUEUE_SETTINGS_ROW_IDS,
  customColorEditor,
} from '../ui/SettingsPanel.js';
import {OUTPUT_FOLDING_MODES} from '../output/FoldPolicy.js';
import {accessSync, appendFileSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
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
import {authoredLink, closeAuthoredLinks} from '../output/Hyperlinks.js';
import {HostSemantics, semanticSupport} from '../host/semanticMarks.js';
import {HostTitle, composeTitle, sessionTitleName, titleSupport} from '../host/terminalTitle.js';
import {OutputBuffer, renderHistoricalContext, serializeCopyPayload, type CompletedCommand, type HistoricalContextSnapshot} from '../output/OutputBuffer.js';
import {createWelcomeSnapshot, renderWelcome, vespyrSprite, WELCOME_BLINK_CLOSED_MS, welcomeBlinkDelay} from '../output/Welcome.js';
import {captureWelcome, WELCOME_PROVIDERS, welcomeProvider} from '../output/WelcomeProviders.js';
import {clearProviderDetection, detectProvider, installUnavailableReason, providerInstall, resolveCommand, resolveProvider, runExternal, verified, type ProviderStatus} from '../providers/providers.js';
import {createProviderPanel, handleProviderPanelKey, providerPanelEnterAction, providerPanelSelection, renderProviderPanel,
  type ProviderPanelState} from '../providers/ProviderPanel.js';
import {TapActivityObserver} from '../output/TapActivityObserver.js';
import {HistoryViewport, stickyHeaderFor, type StickyHeader, type WrappedRow} from '../output/viewport.js';
import {NATIVE_PROMPT_THEMES, setThemeContext, themeContext, themeChromaStops, themeLabel, statusStripModules, buildContextLine, buildInlineContextPrefix, buildRightContext, isOnCommandRelevant, moduleConditionMet, buildRichGitShowcaseLine, buildThemePreviewLine, RICH_GIT_SHOWCASE, moduleShowcaseContext, nativePromptSnapshot, renderedModules, themePreviewContext} from '../prompt/prompt.js';
import {foldingPreview, handleTranscriptPanelKey, renderTranscriptPanel, type TranscriptPanelState} from '../output/TranscriptPanel.js';
import {tabCompletionAction} from '../input/tabBehavior.js';
import {formatBuildIdentity, readBuildIdentity} from '../buildInfo.js';
import {hasVisibleContextModule, loadPromptConfiguration, NATIVE_PALETTE_IDS, savePromptConfiguration, type NativePaletteId, type OnboardingBackdrop, type PromptConfiguration, type PromptProviderId, type StartingPointId} from '../prompt/configuration.js';
import {detectStarship, normalizeStarshipConfigPath, renderStarshipPrompt, type StarshipPromptResult, type StarshipStatus} from '../prompt/starship.js';
import {STARSHIP_MODULES, StarshipConfigAdapter} from '../prompt/StarshipConfigAdapter.js';
import {detectPowerlevel10k, renderPowerlevel10kPrompt, type Powerlevel10kStatus} from '../prompt/powerlevel10k.js';
import {detectOhMyPosh, renderOhMyPoshPrompt} from '../prompt/ohMyPosh.js';
import {configuratorFileChanged, launchPowerlevel10kConfigurator, preparePowerlevel10kConfigurator} from '../prompt/Powerlevel10kConfigurator.js';
import {galleryPalettes, promptPanelOwnsKey, appearanceModulesRow, closeGradientEditor, onGradientRow, openGradientEditor, applyLayoutChoice, onModulesRow, layoutLabel, describePromptConfiguration, PROVIDER_ORDER, providerLabel, handlePromptPanelKey, layoutChoiceIndex, renderPromptPanel, type PromptPanelState} from '../prompt/PromptPanel.js';
import type {PromptSnapshot} from '../prompt/snapshot.js';
import {commandWords, type CommandContextId} from '../prompt/commandContext.js';
import {ContextEngine} from '../context/engine.js';
import {CORE_CAPABILITIES} from '../context/registry.js';
import {contextDemand} from '../context/demand.js';
import {firstPartyPacks, installedPacks, setInstalledPacks} from '../context/modules.js';
import {activeInstalledPacks, installedPackStatuses, removePack, setPackEnabled} from '../context/packs/store.js';
import type {ParsedPack} from '../context/packs/schema.js';
import {recommendModules, type Recommendation} from '../context/packs/recommend.js';
import {listNames, workspaceRoots} from '../context/services.js';
import {choosePager, pagerDocument, pagerProcessEnvironment, runPager} from '../output/BlockPager.js';
import {pagerEnvironment as bridgePagerColors} from '../themeBridge/targets.js';
import {moduleSettingsSignature, type ModulesContext, type PackListing} from '../prompt/ModulesPanel.js';
import {applyClaudeBridge, applyClaudeBridgeRemoval, inspectClaudeBridge, planClaudeBridge, planClaudeBridgeRemoval} from '../agents/claudeStatusLine.js';
import {currentLauncher} from '../cli/agentStatus.js';
import {frontendEnvironment, parseShellEnvironment, type ShellEnvironment} from '../context/shellEnvironment.js';
import type {CapabilityScopeInput} from '../context/capability.js';
import {safeContextText, type ContextFact} from '../context/facts.js';
import {discoverLocalExecutables} from '../tools/localDiscovery.js';
import {applyUpdate, checkForUpdate, compareVersions, detectInstall, installProvenanceLabel, fetchLatestRelease, installRoot, loadUpdateState, planUpdate, prepareAutomaticUpdate, quickRunner, readyVersion, recordInstalled, systemRunner, updatesDisabledByEnvironment, type ReleaseInfo, type UpdateCheckFrequency} from '../update/update.js';
import {renderUpdateNotice, type UpdateProvenance} from '../output/UpdateNotice.js';
import {resolvePathAbbreviations} from '../prompt/pathDisplay.js';
import {resolvePromptContext, type PromptContext} from '../shell/ShellContext.js';
import type {AttachedSession, SessionClient, SessionConnection, StreamStamp} from '../session/SessionClient.js';
import {InProcessSessionClient} from '../session/InProcessSessionClient.js';
import {cursorStyleSequence, TerminalRenderer} from '../terminal/TerminalRenderer.js';
import {KeyDecoder, type Key} from '../terminal/keys.js';
import {promptConfigurationPath} from '../configuration/paths.js';
import {displayWidth, padCells, repeatToWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {isSlashInput, parseSlashCommand, slashCommands, slashSuggestions, suggestionWindow, type ParsedSlashCommand} from '../commands/slashCommands.js';
import {ClipboardUnavailableError, copyFeedback, copyStats, readClipboard, writeClipboard} from '../clipboard/clipboard.js';
import {beginSelection, extendSelection, isRowSelected, selectedText, type TranscriptSelection} from '../output/TranscriptSelection.js';
import {shouldPassthrough} from '../passthrough/PassthroughPolicy.js';
import {QueryExtractor, ReplyRouter} from '../passthrough/TerminalQueries.js';
import {TerminalOutputProcessing} from '../terminal/outputProcessing.js';
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
import {renderStatusStrip, stripStatsFromFacts, stripVisible, type StripModuleItem} from '../status/StatusStrip.js';
import {PATH_DISPLAY_LEVELS} from '../prompt/pathDisplay.js';
import {completedActivity, liveActivityParts} from '../status/activity.js';
import {ACTIVITY_VERBS, selectActivityVerb, type ActivityVerbPair} from '../status/activityVerbs.js';
import {OpenLine, promptShaped} from '../session/openLine.js';
import {completionWaitFact, inputActivityRows, inputComposerHint, inputGlyph, inputProgram, waitedDetail} from '../status/inputStatus.js';
import {pauseReason, pausedGlyph, queueGlyph, queuePreview, queueRow, queueBlock, type QueueAffordance} from '../status/queueStatus.js';
import {queueSettingsPreview} from '../status/queueSettingsPreview.js';
import {queuePanelKey, renderQueuePanel, type QueuePanelState} from '../queue/QueuePanel.js';
import {queueHistoryPanelKey, renderQueueHistoryPanel, type QueueHistoryPanelState} from '../queue/QueueHistoryPanel.js';
import {queueSummaryLine, renderQueueSummary, queueSummaryLines, type QueueSummaryViewOptions} from '../status/queueSummaryView.js';
import {buildQueueSummary, recognizedExecutables, reviewedTextSafe, type QueueSummary} from '../session/QueueSummary.js';
import type {QueueTimeline} from '../session/ExecutionTimeline.js';
import type {QueueEntry, QueueState} from '../session/CommandQueue.js';
import type {QueueNews} from '../session/SessionClient.js';
import {directInput, type InputState, type InputTiming} from '../session/inputState.js';
import {directKeyBytes} from '../terminal/keyBytes.js';
import {extractFacts} from '../status/adapters.js';
import {focusForeground, foreground, background, UI_COLORS, lazyForeground} from '../ui/palette.js';
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
import {runDoctor} from '../doctor/doctor.js';
import {parseWatch, watchSafety, WatchTasks, type WatchSafety} from '../tasks/WatchTasks.js';
import {renderWatchPanel, watchNoticeRows, watchPanelKey, type WatchPanelState} from '../tasks/WatchPanel.js';
import {finalResultRows, trackBlockRows} from '../tasks/trackBlock.js';
import {explainModules, moduleTimings} from '../prompt/moduleReport.js';
import {analyzePaste, KIND_LABELS, needsPreview, PASTE_EXACT_NOTE, pasteHeader, primaryKind, type PasteAnalysis, nmshCommandNote} from '../input/pasteGuard.js';
import type {BatchShell} from '../input/pasteBatch.js';
import {createPasteReview, displaySafe, pasteReviewKey, renderPasteReview, type PasteReviewState} from '../input/PasteReview.js';
import {batchFromCommands, batchRefusal, batchReviewKey, batchTexts, batchBlockText, createBatchReview, createBatchReviewWithRefusal, renderBatchReview, type BatchReviewState} from '../input/BatchReview.js';
import {QUEUE_LIMIT} from '../session/CommandQueue.js';
import {addPin, addRecipe, changeItem, keepProblem, loadPins, pinsPath, removeItem, type PinData, type Recipe} from '../pins/PinStore.js';
import {createPinsPanel, pinsPanelKey, renderPinsPanel, type PinsPanelState} from '../pins/PinsPanel.js';
import {ClipStore, type Clip} from '../clipboard/ClipStore.js';
import {clipboardCounter, ClipboardChangeWatch} from '../clipboard/ClipboardChanges.js';
import {expandSteps, quotedPlaceholder} from '../pins/recipes.js';
import {splitBatch} from '../input/pasteBatch.js';
import {verifyCommands} from '../input/pasteBatchCheck.js';
import {WHY_FAILED} from '../ask/failure.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {createDoctorPanel, doctorKey, renderDoctorPanel, type DoctorPanelState} from '../doctor/DoctorPanel.js';
import {signatureAccent} from '../session/signatures.js';
import {renameSession} from '../session/SocketSessionClient.js';
import {appearanceHubKey, createAppearanceHub, hubMotionPreview, renderAppearanceHub, type AppearanceHubState} from '../appearance/AppearanceHub.js';
import {diffModules, progress, transitionPaint, Transitions, type MotionGate} from '../motion/transitions.js';
import {overlayRow, type CellPaint} from '../presentation/cellOverlay.js';
import {chooseBackend, hostCursorFacts, nativeBackendFor, setCursorHostProvider, type BackendChoice, type HostCursorFacts} from '../cursor/backends.js';
import {includeLine, installedNativeHost, nativeCursorIntegrated, nativeHostLabel, reloadInstruction, setupPlan, writeManagedFiles, type ManagedWrite} from '../cursor/native.js';
import {createCursorPanel, cursorPanelKey, openCursorEditor, renderCursorPanel, type CursorPanelEnv, type CursorPanelOptions, type CursorPanelState} from '../cursor/CursorPanel.js';
import {contextFor, resolveCursorSettings} from '../cursor/colors.js';
import {renderCursorPreview} from '../cursor/CursorPreview.js';
import {MOTION_ROWS} from '../motion/motionRows.js';
import {renderMotionPreview} from '../motion/MotionPreview.js';
import {liveLine} from '../status/liveLine.js';
import {browseOutcome} from '../ask/fileAssist.js';
import {gitWorktrees} from '../ask/git.js';
import type {AskAction, AskContext, AskOutcome} from '../ask/types.js';
import {askProviderFacts, PROVIDER_FAMILIES, providerFamily, selectProvider, type SwitchableFamily} from '../providers/families.js';
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
import {applyShellIndicatorAction, createShellPanel, renderShellPanel, shellPanelKey, type ShellPanelState} from '../shell/ShellPanel.js';
import {detectPlatform, type PlatformInfo} from '../host/platform.js';
import {createImageOverlay, fitCells, pngSize, selectImageProtocol, type ImageOverlay, type ImageProtocol, type ImageSize} from '../presentation/ImageSurface.js';
import {detectShellEnvironment, shellEnvironmentRows, type ShellEnvironmentReport} from '../shell/ShellEnvironment.js';
import {agentColor, agentCompletionText, renderAgentStats} from '../agents/AgentStatsView.js';
import {detectAgentCommand} from '../agents/agents.js';
import {describeNotice, noticeExpiresAt, noticeKey, noticeVisible, selectNotices, sessionLabel, type NoticeView, type SessionNotice} from '../session/SessionNotices.js';
import {composerEdgeStates, cursorScreenRow, planScreen, regionAt, withNoticeRows, withStatusRow, screenRowFromTerminal, terminalRowFromScreen, type Region, type ScreenPlan, withQueueRows, regionOf} from './screenPlan.js';
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
import {OLDER_SERVICE_SWITCH, serviceBuildNotice} from '../session/SocketSessionClient.js';
import {killAndArchive} from '../session/liveSessions.js';
import {recoverEndedSessions} from '../session/recovery.js';
import {AgentSessions, normalizeProfiles, type AgentProfile} from '../agents/sessions/manager.js';
import type {AgentSession} from '../agents/sessions/model.js';
import {AgentInputController} from '../agents/input/controller.js';
import {handleAgentInput} from '../agents/input/surface.js';
import {initialSelection, launcherRows, moveSelection, profileLabel, renderLauncher, targetStatus, type LauncherRow, type LauncherState} from '../agents/launcher.js';
import {discoverClaudeProfiles} from '../agents/profileDiscovery.js';
import {ModsController, modsKeyAction} from '../agents/mods/controller.js';
import {renderMods} from '../agents/mods/view.js';
import {WorktreeManagerController} from '../worktrees/controller.js';
import {discoverWorktrees, repositoryIdentity} from '../worktrees/discovery.js';
import {createGitRunner, succeeded, type GitRunner} from '../worktrees/git.js';
import {newWorktreeRequest} from '../worktrees/host.js';
import {displayText as worktreeText} from '../worktrees/model.js';
import {buildWorktreeView, renderWorktreeView} from '../worktrees/view.js';
import {GithubWorkspaceController, type ListTab, type WorkspaceIntent} from '../githubWorkspace/controller.js';
import {githubRepositoryFromRemote, workspaceKey} from '../githubWorkspace/host.js';
import {attachRenderer, renderWorkspace, type RenderOptions as GithubRenderOptions} from '../githubWorkspace/render.js';
import {safeGithubUrl} from '../githubWorkspace/sanitize.js';
import type {PrSummary} from '../githubWorkspace/model.js';
import {GithubWorkspaceService} from '../githubWorkspace/service.js';
import {GhSource} from '../githubWorkspace/source.js';
import {loadModInventory, withLoadedIn} from '../agents/mods/inventory.js';
import {inspectPlugin, setPluginEnabled} from '../agents/mods/claudePlugins.js';
import {openEffortPicker, openModelPicker} from '../agents/input/pickers.js';
import {applyPickerChoice} from '../agents/input/surface.js';
import {settingsEffort} from '../agents/claudeSettings.js';
import {renderSidePanel, sidePanelShown, sidePanelWidth} from '../agents/workspace/sidePanel.js';
import {WORKSPACE_DISABLED_MESSAGE, WorkspaceHost} from './workspaceHost.js';
import {BackgroundHost} from './backgroundHost.js';
import {entersBar, removalBlocked} from '../backgroundTasks/bar.js';
import {BackgroundManager} from '../backgroundTasks/manager.js';
import {rememberFamily} from '../backgroundTasks/preferences.js';
import {nextLevel} from '../backgroundTasks/protocol.js';
import {explicitRun, parseBackgroundCommand, suggestionKey} from '../backgroundTasks/suggestion.js';
import type {TaskRecord} from '../backgroundTasks/supervisor.js';
import {TaskOutputView} from '../backgroundTasks/view.js';
import {composeWorkspaceRows} from './workspaceFrame.js';
import type {WorkspaceOwner} from '../workspace/focus.js';
import {columnAt, type WorkspaceColumns} from '../workspace/layout.js';
import {createTmuxRunner, listTmuxPanes, tmuxServer, trustedTmux} from '../workspace/tmux.js';
import {describeKeymap, hostNotes, keymapHostProfile} from '../workspace/keymapConfig.js';
import type {WorkspaceEffect} from './workspaceHost.js';
import type {ActivationIntent} from '../workspace/resources.js';
import {agentBlocks, agentPanelRows, renderAgentPanel, renderAgentView, renderShelf, shelfOrder, type AgentPanelState, type AgentViewMeta, type AgentViewState} from '../agents/sessions/AgentViews.js';
import {harness} from '../agents/harnesses.js';
import {defaultRuntimeDir, socketPathFor} from '../session/runtimeDir.js';

/** Editor text that marks interactive history search. */
const HISTORY_SEARCH = '/history ';
const DIRECTORY_SEARCH = '/dirs ';
const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const SEPARATOR = lazyForeground(UI_COLORS.separator);
/** Keep Awake presentation poll: record changes, timeout, idle reminder and its minute counter. */
const AWAKE_POLL_MS = 5000;
/** Free cells the input row keeps after typed text before Keep Awake yields it (Input row placement). */
const AWAKE_INPUT_SLACK = 8;
const ACCENT = lazyForeground(UI_COLORS.accent);
/** A command waiting for the person: the waiting rows, the composer's prompt mark and /sessions rows share it. */
const ATTENTION = lazyForeground(UI_COLORS.attention);
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
const WARNING = lazyForeground(UI_COLORS.warning);
const ERROR = lazyForeground(UI_COLORS.failure);
/** How long after Ctrl+C or Ctrl+Z typing is taken as type-ahead for the shell prompt rather than queued. */
const STOP_TYPE_AHEAD_MS = 2000;
/** Longest a key waits for an on-demand look at the running command's input state before it is routed anyway. */
const OWNERSHIP_LOOK_MS = 800;
/** How long after confirming a queue review an empty Enter is not sent to the command that just started. */
const QUEUE_CONFIRM_SETTLE_MS = 600;
/** The transcript keeps at least this many rows when the expanded queue takes some (as withQueueRows does). */
const QUEUE_MIN_TRANSCRIPT_ROWS = 3;
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
/** How long a directory change waits for demanded context facts before showing what has resolved (the rest arrives later). */
const CONTEXT_SETTLE_MS = 150;

export class TerminalApp {
  /** Workspace regions (#330): sidebar, detail panel, their focus and keymap. Declared first: dimensions() reads it. */
  /** The docked sidebar and detail panel: experimental, gated by the workspacePanels setting (Off by default). */
  private readonly workspace = new WorkspaceHost(() => this.configuration.workspacePanels);
  /** Background tasks of this session (#382): what the task owner reported, never run by the frontend itself. */
  private readonly background = new BackgroundHost();
  /** Task ids this window has already announced (a reattach adopts the existing list silently). */
  private backgroundSeen?: Set<string>;
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
    // The cleared lines and their blocks are gone: nothing may stay focused, hovered or selected by their ids.
    this.hoveredLineIndex = undefined;
    this.focusedLineIndex = undefined;
    this.focusedActivityId = undefined;
    this.focusedCommandIndex = undefined;
    this.selection = undefined;
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
  private hostProgramAbort?: AbortController;
  private historyQuery?: string;
  private historyQueryAbort?: AbortController;
  private historyResults: HistoryEntry[] = [];
  private context: PromptContext = {cwd: process.cwd(), project: '…', exitStatus: 0};
  /** Context Engine: demand-driven, cached, bounded capability resolution. Rendering only reads its facts. */
  private contextEngine = new ContextEngine({capabilities: CORE_CAPABILITIES, onUpdate: () => { this.scheduleContextRefresh(); this.render(); }});
  /** The live shell's allowlisted context environment; NMSh's own launch environment until the shell reports one. */
  private contextEnvironment: ShellEnvironment = frontendEnvironment();
  private readonly contextStartedAt = Date.now();
  private contextRefreshTimer?: NodeJS.Timeout;
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
    const previous = this.configuration;
    this.configuration = next;
    // One place for every way configuration changes (Settings, Setup, /cursor, import): the caret style applies to this
    // session at once, and NMSh's managed native cursor files follow the cursor and theme settings.
    if (this.renderer) {
      this.renderer.setCursorStyle(cursorStyleSequence(next.cursor.shape, next.cursor.blink));
      if (JSON.stringify(previous.cursor) !== JSON.stringify(next.cursor) || previous.nmsh.palette !== next.nmsh.palette || previous.nmsh.accent !== next.nmsh.accent
        || JSON.stringify(previous.customTheme) !== JSON.stringify(next.customTheme)) this.syncCursorNative(next);
    }
    // Off: no model use from this window, and the shared service is told to unload.
    if (turnedOff) this.understanding?.modeChanged();
    // Theme Bridge follows the same funnel: a theme, library or bridge change regenerates what Follow/Choose targets use.
    if (themeBridgeKey(previous) !== themeBridgeKey(next)) this.scheduleThemeBridge();
    // Experimental workspace regions turned Off: close them now; the next frame gives the PTY every column again.
    if (!next.workspacePanels && this.workspace?.open) this.workspace.close();
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
  /** Cancels a superseded Oh My Posh render, so at most one child runs. */
  private ohMyPoshRender?: AbortController;
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
  private idle?: {mode: IdleMode; startedAt: number; frame: number; interval: number; preview: boolean; paused: boolean; still: boolean; capture?: ScreenCapture; random?: boolean; offset: number};
  /** Snapshot of the screen taken when the screensaver gallery opened: the gallery preview's material. */
  private saverCapture?: ScreenCapture;
  private saverGalleryCapture?: ScreenCapture;
  private saverGalleryMode?: IdleMode;
  private randomSaver = makeRng(0x5eed);
  private idleSubscription?: () => void;
  private readonly idleGrid = new CellGrid();
  private lastActivity = Date.now();
  private idleArmedFor = -1;
  private screensaverPanel?: ScreensaverPanelState;
  private screensaverAnimation?: () => void;
  private readonly screensaverGrid = new CellGrid();
  /** The sample screen previews animate when no screen of the person's is captured (see idlePreviewRows). */
  private readonly idleSample: {key?: string; capture?: ScreenCapture} = {};
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
  /** Whether the strip's own facts were last demanded; a change re-derives Context Engine demand. */
  private stripDemanded = false;
  /** Cross-session notices from the session service; frontend chrome only. */
  private noticeView: NoticeView = {notices: [], hidden: 0};
  /** Every notice the service reported at the last poll; visibility (TTL) is applied on top, never stored. */
  private noticeSource: SessionNotice[] = [];
  private noticeExpiry?: ReturnType<typeof setTimeout>;
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
  /** Frontend PATH and recipe lookups for install offers; replaceable in tests. */
  private installProbe = {onPath: (name: string) => resolveCommand(name, this.shellPath()) !== undefined, recipe: (tool: Tool) => planPackageInstall(tool) ?? toolInstall(tool)};
  private misePanel?: MisePanel;
  private keepAwakePanel?: KeepAwakePanel;
  private keepAwakeController?: KeepAwakeController;
  /** One controller for /caffeinate, /awake and /zoomies; the backend is detected once. */
  private keepAwake(): KeepAwakeController { return this.keepAwakeController ??= new KeepAwakeController(detectBackend()); }

  /** The verified Keep Awake record presentation shows; undefined (Off) renders nothing anywhere. */
  private awakeRecord?: KeepAwakeRecord;
  private awakeTimer?: () => void;
  /** Last local NMSh input (keys, mouse, paste): the idle reminder's clock. Output and OS idle state never count. */
  private lastUserInput = Date.now();
  /** A cheap key for what Keep Awake shows, so the poll repaints only when it changes. */
  private awakeShown = '';

  /** Full verified refresh (ownership checked): on launch, after every Keep Awake action, and when the stored record changes. */
  private refreshAwake(): void {
    if (!this.keepAwakeController && !existsSync(keepAwakePath())) { this.awakeRecord = undefined; return; }
    const status = this.keepAwake().status();
    this.awakeRecord = status.state === 'running' ? status.record : undefined;
  }

  /** Polled while NMSh presents: a file read, plus an ownership check only when the record changed or its timeout passed. */
  private pollAwake(): void {
    const stored = this.keepAwakeController || existsSync(keepAwakePath()) ? this.keepAwake().peek() : undefined;
    const current = this.awakeRecord;
    const expired = current?.timeoutSeconds !== undefined && Date.now() >= current.startedAt + current.timeoutSeconds * 1000;
    if (stored?.token !== current?.token || expired) this.refreshAwake();
    const shown = this.awakeShownKey();
    if (shown !== this.awakeShown) { this.awakeShown = shown; this.render(); }
  }

  private awakeShownKey(): string {
    const record = this.awakeRecord;
    if (!record) return '';
    return `${record.token}|${this.awakeIdle()}|${awakeDuration(record, Date.now())}`;
  }

  /** One timer while Keep Awake is active (or could become active from another window); none once NMSh stops presenting. */
  private syncAwake(): void {
    const wanted = this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended;
    if (wanted && !this.awakeTimer) this.awakeTimer = presentationClock.subscribe(() => this.pollAwake(), AWAKE_POLL_MS);
    else if (!wanted && this.awakeTimer) { this.awakeTimer(); this.awakeTimer = undefined; }
  }

  /** Expanded reminder after no local NMSh input for the configured delay (a deterministic demo may shorten it). */
  private awakeIdle(now = Date.now()): boolean {
    const settings = this.promptConfiguration.keepAwake;
    if (!this.awakeRecord || !settings.idleReminder) return false;
    const override = isDeterministicPresentation() ? Number(process.env.NMSH_DEMO_AWAKE_IDLE_MS) : Number.NaN;
    const delay = Number.isFinite(override) && override >= 0 ? override : settings.idleAfterSeconds * 1000;
    return now - this.lastUserInput >= delay;
  }

  private awakeViewNow(now = Date.now()) {
    const record = this.awakeRecord;
    return record ? awakeView(record, this.promptConfiguration.keepAwake, this.awakeIdle(now), now) : undefined;
  }

  /**
   * Input row placement: the width reserved at the end of the first input row,
   * or 0. Only when completely safe: a single-line edit with room to spare and
   * no right prompt on that row. Wrapping, the caret, selection and mouse hit
   * testing all use the narrowed width (inputColumns), so typed text can never
   * run under it.
   */
  private awakeInputReserve(columns: number): number {
    const view = this.awakeViewNow();
    if (!view || this.promptConfiguration.keepAwake.placement !== 'input') return 0;
    if (this.promptConfiguration.composerLayout === 'oneLine' && this.effectivePromptProvider === 'nmsh') return 0;
    if (this.editor.displayText.includes('\n')) return 0;
    const reserve = view.compact.width + 2;
    const prefix = this.inputFirstLinePrefix(columns);
    const used = displayWidth(prefix ?? `${GLYPHS.prompt} `) + displayWidth(this.editor.displayText) + 1;
    return used + AWAKE_INPUT_SLACK <= columns - reserve ? reserve : 0;
  }

  /** The editor's width: the terminal width less any Keep Awake input reservation. */
  private inputColumns(columns: number): number {
    const rail = this.preparedRail(columns).presentation;
    const available = rail.rows ? rail.editorColumns : columns;
    return Math.max(1, available - this.awakeInputReserve(columns));
  }

  /** Resolves this frame's slot against real composer geometry; the saved preference never changes. */
  private awakeDecision(plan: ScreenPlan, columns: number): ScreenPlan['awake'] {
    const view = this.awakeViewNow();
    if (!view || plan.panelActive) return undefined;
    const edges = composerEdgeStates(plan, this.promptConfiguration.placement);
    const fits = edgeFits(columns, view.compact.width);
    const slot = resolveAccessorySlot(this.promptConfiguration.keepAwake.placement, {
      topEdge: edges.topEdge === 'available' && fits ? 'available' : edges.topEdge === 'occupied' ? 'occupied' : 'unavailable',
      bottomEdge: edges.bottomEdge === 'available' && fits ? 'available' : 'unavailable',
      inputTrailing: this.awakeInputReserve(columns) > 0 ? 'available' : 'unavailable',
    });
    return {slot, expandedOnEdge: Boolean(view.expanded && (slot === 'topEdge' || slot === 'bottomEdge') && edgeFits(columns, view.expanded.width))};
  }

  /** Rows the adjacent slot needs: its own row, or the muted reminder when the idle form does not fit where the label is. */
  private awakeAdjacentRows(decision: ScreenPlan['awake']): number {
    if (!decision) return 0;
    if (decision.slot === 'adjacentRow') return 1;
    return this.awakeIdle() && !decision.expandedOnEdge ? 1 : 0;
  }

  private awakeRows(plan: ScreenPlan, columns: number): string[] {
    const view = this.awakeViewNow();
    if (!view || !plan.awake) return [];
    return [plan.awake.slot === 'adjacentRow' ? view.row(columns) : view.reminder.ansi];
  }

  /** The composer edge (border or separator) through the one shared renderer: the rule, plus the accessory when this edge holds it. */
  private composerEdgeRow(kind: 'composerBorder' | 'separator', plan: ScreenPlan, columns: number, now: number): string {
    const rule = `${paintDivider(repeatToWidth(GLYPHS.separator, columns), this.promptConfiguration.presentation, now)}${RESET}`;
    const accessory = this.edgeAccessory(kind, plan, now);
    return accessory ? renderComposerEdge({rule, width: columns, accessory}) : rule;
  }

  private edgeAccessory(kind: 'composerBorder' | 'separator', plan: ScreenPlan, now = Date.now()): {ansi: string; width: number} | undefined {
    const view = this.awakeViewNow(now);
    if (!view || plan.awake?.slot !== (kind === 'composerBorder' ? 'topEdge' : 'bottomEdge')) return undefined;
    return plan.awake.expandedOnEdge && view.expanded ? view.expanded : view.compact;
  }

  private handleKeepAwakeSlash(command: string, slash: Extract<ParsedSlashCommand, {kind: 'keepAwake'}>): void {
    const controller = this.keepAwake();
    if (slash.op === 'panel') {
      this.panelOrigin = undefined;
      this.keepAwakePanel = {...createKeepAwakePanel(controller, slash.invalid ? `"${slash.invalid}" is not a Keep Awake mode or duration. Modes: idle, display, system, all; durations like 45s, 30m, 2h.` : undefined), command: command.split(/\s+/u)[0]!};
    } else if (slash.op === 'status') this.output.addFrontendInteraction(command, statusLines(controller).join('\n'), INFO);
    else if (slash.op === 'stop') this.output.addFrontendInteraction(command, controller.stop(), INFO);
    else {
      const result = controller.start(slash.mode!, slash.timeoutSeconds);
      if (result.kind === 'needsConfirm') {
        // A different mode is running: the panel asks first (default No).
        this.keepAwakePanel = {...createKeepAwakePanel(controller), command: command.split(/\s+/u)[0]!};
        requestStart(this.keepAwakePanel, controller, slash.mode!, slash.timeoutSeconds);
      } else this.output.addFrontendInteraction(command, describeStart(result), result.kind === 'failed' || result.kind === 'unsupported' ? ERROR : INFO);
    }
    this.refreshAwake();
    this.render();
  }
  private readonly miseService = new MiseProjectService();
  private toolConfigurationLoading = false;
  private toolConfigurationGeneration = 0;
  private paletteState?: PaletteState;
  private blockPaletteContext?: {palette: PaletteState; scope: OutputScope};
  private outputNavigation?: OutputSelection<{anchor: OutputAnchor; draft: string; cursor: number}> & {includeStatus: boolean; report?: ReportFormat; busy?: boolean};
  /** Only this originating contextual palette can return to navigation. */
  private blockPaletteReturn?: {selection: NonNullable<TerminalApp['outputNavigation']>; palette: PaletteState};
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
  private running?: {command: string; startedAt: number; interrupted: boolean; cleared: boolean; startId: number; cwd: string; historyAllowed?: number; awaitingExec?: boolean;
    /** The decorative phrase pair chosen for this command, once (Expressive activity wording). */
    activity?: ActivityVerbPair;
    /** Started from the command queue rather than typed at the prompt. */
    queued?: boolean;
    /** When you sent Ctrl+C or Ctrl+Z: for a moment the command is ending at your request, so what you type next is
     * for the shell's prompt (type-ahead, as in any terminal), not a queue entry held behind the pause that stop
     * causes. Only for STOP_TYPE_AHEAD_MS: a program that survives the signal (a REPL, a remote shell) gets the
     * ordinary routing again, so later typing is never sent into it unasked. */
    stoppedAt?: number};
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
  private presentationFrame?: {frame: TerminalFrame; plan: ScreenPlan; agentCaretRow?: number};
  private activityAnimationNow = Date.now();
  /** The running command's input state, as the session's InputWatch reports it; never guessed here. */
  private inputState?: InputState;
  /** Waiting time the shell's completing prompt carried for the command that just finished. */
  private completedInputTiming?: InputTiming;
  /**
   * A composer draft started while a command runs: when, and whether a request for input was already shown (an
   * answer, discarded rather than run if the command ends first). Drafts started before the command's latest output
   * are type-ahead for the shell and stay in the composer.
   */
  private runningDraft?: {startId: number; at: number; answering: boolean};
  /**
   * Keys held while the session looks whether the running command waits for input: the first key of a draft (a
   * hidden reply is never drawn) and an Enter that would queue (a reply never becomes a queued command).
   */
  private ownershipLook?: {keys: Key[]; startId: number; answering: boolean; release: () => void};
  private replayingHeld = false;
  /**
   * The queue review a first empty Enter armed at idle (resume a paused queue, or approve the entry that asks first).
   * While it is armed it owns the keys: Enter or y confirms, n or Esc leaves everything as it was, e edits.
   */
  private queueReview?: {kind: QueueAffordance; id: number; revision?: number};
  /** A requested pause is not a pause until its owner acknowledges it. No draft is submitted on acknowledgement. */
  private pendingQueuePause?: {command: string; revision?: number; declined: boolean};
  private queueExpiry?: () => void;
  private queueObservedMono = 0;
  private queueVisibleRows = new Map<string, number>();
  private queueTransientUntil = 0;
  /** After a review is confirmed, an empty Enter for a moment is swallowed: it never reaches the command it started. */
  private queueConfirmedAt = 0;
  /** The previous command's phrase pair, so two commands in a row never get the same one. */
  private lastActivityPair?: ActivityVerbPair;
  /** This session's command queue as its owner (the session service or in-process client) last reported it. */
  private queueState: QueueState = {entries: []};
  /** Ctrl+Q while a program reads keys directly: the composer takes typing for one queue entry, never the program. */
  private queueCompose = false;
  /** The line the running command left the cursor on: a question there is answered before any probe confirms it. */
  private readonly commandLine = new OpenLine();
  /** A queued entry being edited in the composer: Enter saves it in place, Esc cancels. */
  private queueEdit?: {id: number; draft: string};
  private queuePanel?: QueuePanelState;
  /** `/queue history`: the recent settled chains as a review panel; the owner keeps the chains themselves. */
  private queueHistoryPanel?: QueueHistoryPanelState;
  /**
   * An armed summary save review: the exact artifact the container showed and the redacted texts it would keep.
   * Enter stores precisely that through the owner, which re-validates everything; Esc stores nothing.
   */
  private summaryReview?: {chainId: number; revision?: number; texts: (string | null)[]; summary: QueueSummary; document: ReportReviewState};
  /** `/queue save-summary` asked for one chain's retained results; the review arms when the owner answers. */
  private pendingSummarySave?: number;
  private pinsPanel?: PinsPanelState;
  private readonly clips = new ClipStore();
  private readonly clipboardChangeCounter = clipboardCounter();
  private clipboardChangeWatch?: ClipboardChangeWatch;
  private clipboardChangeSuggested = false;
  /** One pending timeout at a time drives the welcome cat's occasional blink. */
  private welcomeBlinkTimer?: () => void;
  private welcomeBlinkCount = 0;
  private contextGeneration = 0;
  private appearanceHub?: AppearanceHubState;
  private keyboardState?: KeyboardState;
  /**
   * Where the currently-open top-level panel (prompt/transcript/appearance/
   * keyboard) was opened from. Esc at that panel's own root uses this to
   * decide whether to return to the /settings root or close to the
   * composer, instead of every panel guessing independently.
   */
  private panelOrigin?: 'settings' | 'setup';
  /** Setup Cat waiting under an editor it opened, with its draft unapplied, and the configuration it last knew. */
  private parkedSetup?: {state: SetupState; knew: PromptConfiguration};
  private panelOriginView: SettingsView = 'settings';
  private panelOriginRow = 0;
  /** Whether continuous session journaling is persisting; shown in Status. */
  private journalActive = false;
  private lastPtyRows = 0;
  private lastPtyColumns = 0;
  private stopped = false;
  private originalRawMode = false;
  private rawInputPrepared = false;
  private shellHandoffCwd?: string;
  private shellHandoffRequested = false;
  private presentationStartCwd = process.cwd();
  /**
   * Whether the presentation is this window's own live session. A restored archive brings its own saved summaries
   * and never adopts the live queue's: otherwise the next journal checkpoint would archive another session's
   * artifacts into it. A fresh view and a reattached journal are this window's own again.
   */
  private presentationOwned = true;
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
    // keymap.json is validated once here and on /keys reload; a missing file is the defaults.
    this.workspace.loadKeymap();
    // The backend this frontend manages, known before the first welcome is drawn.
    this.shellId = isShellId(connection?.shell) ? connection.shell : isShellId(connection?.attached?.shell) ? connection.attached.shell as ShellId : 'zsh';
    this.output.setWelcomeVisible(this.promptConfiguration.welcome !== 'none');
    this.startWelcome(this.initialCwd);
    this.applySuggestionProvider();
    this.output.setTranscriptAppearance(this.promptConfiguration.transcript);
    this.output.presenter.setTreatment(this.promptConfiguration.presentation);
    this.output.setOutputFolding(this.promptConfiguration.outputFolding);
    this.output.setSemanticOutput(this.promptConfiguration.semanticOutput);
    this.output.setLiveRows((id, width) => this.trackRows(id, width));
    this.output.presenter.setLayout(this.promptConfiguration.transcriptPresentation);
    this.output.presenter.setHyperlinks(this.host.capabilities.hyperlinks);
    this.renderer.setCursorStyle(cursorStyleSequence(this.promptConfiguration.cursor.shape, this.promptConfiguration.cursor.blink));
    // Settings and Setup rows read the host's cursor capabilities through the one provider this window owns.
    setCursorHostProvider(() => this.cursorFacts());
    const dimensions = this.dimensions();
    this.session = connection?.client
      ?? new InProcessSessionClient({cwd: this.initialCwd, columns: dimensions.columns, rows: Math.max(2, dimensions.rows - 4)});
    this.semanticService = this.shellId === 'zsh' ? new SemanticService(this.initialCwd) : new PathClassifier(shellAdapter(this.shellId));
    if (this.shellId !== 'zsh') this.bindShellServices(this.shellId, false);
    this.done = new Promise(resolve => {
      this.finish = resolve;
    });
    this.session.on('data', (data, stamp) => { if (!this.stopped && this.inStream(stamp)) this.onShellData(data); });
    this.session.on('prompt', (marker, stamp) => {
      // Buffered prompts after shutdown cannot restart collection or queue work.
      if (!this.stopped && this.inStream(stamp)) {
        if (marker.knowledge !== undefined) {
          this.shellJobs = knowledgeJobCount(marker.knowledge) ?? 0;
          // An older bootstrap reports no snapshot: keep the documented launch-environment fallback.
          this.contextEnvironment = parseShellEnvironment(marker.knowledge) ?? this.contextEnvironment;
          this.correctionService.usePath(this.shellPath());
          this.semanticService.applyShellKnowledge(marker.knowledge);
          this.commandSources.clear();
          this.completionService.setShellKnowledge(parseShellKnowledge(marker.knowledge));
          this.rememberShellNames(marker.knowledge);
        }
        // Host OSC 7 / OSC 133: a projection of this authoritative marker, never the other way round.
        this.hostSemantics.prompt(marker.cwd, marker.exitCode);
        this.completedInputTiming = marker.inputWaits ? {waitedMs: marker.inputWaitMs ?? 0, waits: marker.inputWaits} : undefined;
        this.onShellPrompt(marker.exitCode, marker.cwd, stamp.at);
      }
    });
    this.session.on('exec', (command, stamp) => { if (!this.stopped && this.inStream(stamp)) { this.hostSemantics.exec(); this.onShellExec(command, stamp.at, stamp.historyAllowed, stamp.queued); } });
    this.session.on('replayed', summary => this.finishReplay(summary));
    this.session.on('inputState', state => this.onInputState(state));
    this.session.on('queueState', (state, news) => this.onQueueState(state, news));
    this.session.on('tasks', records => this.onBackgroundTasks(records));
    this.session.on('taskOutput', (taskId, update) => { this.background.onOutput(taskId, update); if (!this.passthrough && !this.externalPassthrough) this.render(); });
    this.session.on('taskRefused', reason => { this.output.addFrontendInteraction('/background', `Not done: ${reason}`, ERROR); this.render(); });
    this.session.on('inputRejected', (data, submission) => this.onInputRejected(data, submission));
    this.session.on('startup', tail => {
      this.startupTail = tail;
      if (this.startupPanel) { this.startupPanel.tail = tail; this.render(); }
    });
    this.session.on('exit', event => {
      this.shellEnded = true;
      this.hostSemantics.end();
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
    const stale = connection?.mode === 'service' ? serviceBuildNotice(this.session.serviceBuild, this.buildIdentity) : undefined;
    if (stale) this.output.addFrontendInteraction('session', stale, INFO);
    this.beginStartupWatch(connection?.attached);
    this.session.start();
    void this.loadInstalledPacks();
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
  /** Commands that completed during the current replay: marked incomplete if the replay lost output. */
  private replayedRecords: CompletedCommand[] = [];
  private attachedSession?: AttachedSession;
  private continuedJournal?: TranscriptSession;
  private rendererEntered = false;
  /** Current fullscreen ownership can release startup while its journal awaits IO. */
  private startupPassthroughReady?: () => void;

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
    this.pendingQueuePause = undefined;
    this.replaying = true;
    this.shellCwd = attached.cwd;
    this.streamSeq = attached.ackedSeq;
    if (attached.knowledge !== undefined) {
      this.shellJobs = knowledgeJobCount(attached.knowledge) ?? 0;
      this.contextEnvironment = parseShellEnvironment(attached.knowledge) ?? this.contextEnvironment;
      this.correctionService.usePath(this.shellPath());
      this.semanticService.applyShellKnowledge(attached.knowledge);
      this.completionService.setShellKnowledge(parseShellKnowledge(attached.knowledge));
      this.rememberShellNames(attached.knowledge);
    }
    if (!journal) return;
    this.continuedJournal = journal;
    this.welcomeGeneration += 1;
    this.queueReview = undefined;
    this.summaryReview = undefined;
    this.pendingSummarySave = undefined;
    this.queueHistoryPanel = undefined;
    this.output.restoreTranscript(journal.transcript);
    this.presentationOwned = true;
    this.presentationStartCwd = journal.startCwd;
    if (journal.live) {
      this.streamSeq = Math.max(this.streamSeq, journal.live.seq);
      this.lastActivityPair = ACTIVITY_VERBS[journal.live.previousActivityIndex ?? -1];
      const running = journal.live.running;
      if (running) {
        const {cleared} = this.output.resumeActive(running.command, running.startId, running.outputStartId, mode => this.onActiveModeChange(mode));
        this.running = {command: running.command, startedAt: running.startedAt, interrupted: false, cleared,
          startId: running.startId, cwd: running.cwd, historyAllowed: running.historyAllowed,
          activity: ACTIVITY_VERBS[running.activityIndex ?? -1],
          // A submission checkpoint can precede the very first shell event.
          // Its replayed readiness prompt must not complete the queued command.
          awaitingExec: this.streamSeq === 0};
      }
    }
  }

  private finishReplay(summary: {truncatedBytes: number}): void {
    const attached = this.attachedSession;
    if (this.stopped || !this.replaying || !attached) return;
    this.replaying = false;
    const parts = [`Reattached live session ${attached.sessionId.slice(0, 8)} (zsh pid ${attached.pid})`];
    const completed = this.replayedCompletions;
    if (completed > 0) parts.push(`${completed} command${completed === 1 ? '' : 's'} completed while detached`);
    this.output.addFrontendInteraction('session', `${parts.join(' · ')}.`, INFO);
    // The spool keeps command boundaries but drops output past its limit: any command completed during this replay
    // may be missing some, and says so wherever its output is used.
    if (summary.truncatedBytes > 0) for (const record of this.replayedRecords) record.outputIncomplete = true;
    this.replayedRecords = [];
    if (summary.truncatedBytes > 0) {
      this.output.addFrontendInteraction('session',
        `${formatBytes(summary.truncatedBytes)} of output produced while detached exceeded the retention limit and was not kept.`, ERROR);
    }
    // Without a journal the running command is known only from the service.
    if (!this.running && attached.running) this.onShellExec(attached.running, attached.runningSince, undefined, attached.runningQueued);
    if (!this.startupPending && this.running && (attached.fullscreen !== 0 || shouldPassthrough(this.running.command))) {
      this.cancelPresentation();
      this.passthrough = true;
      this.noteForeignScreen();
      this.commandModes.reset('alternate');
      this.commandModes.observeModes(attached.modes ?? '');
      if (this.rendererEntered) this.enterAttachedPassthrough();
      else this.startupPassthroughReady?.();
    }
    this.scheduleJournal();
    this.render();
  }

  private enterAttachedPassthrough(): void {
    // Reattached into a fullscreen app: hand it the whole terminal again,
    // including the mouse/paste/cursor-key modes it set before the detach.
    this.handOverTerminal(this.commandModes.restoreSequence());
  }

  /**
   * The foreground program takes the terminal: NMSh stops drawing, and nothing half-decoded on NMSh's side
   * (an Escape awaiting its flush, part of a sequence) can later turn into composer input; from here every
   * byte goes to the program. Reclaimed in onShellPrompt.
   */
  private handOverTerminal(restore = ''): void {
    // Before any of the program's bytes are forwarded: they must reach the terminal untranslated.
    this.outputProcessing.set(true);
    // A reply still arriving belongs to the program, which now receives every byte anyway.
    const held = this.replyRouter.stop();
    if (held) this.session.write(held);
    this.queryExtractor.reset();
    if (this.escapeFlushTimer) { clearTimeout(this.escapeFlushTimer); this.escapeFlushTimer = undefined; }
    this.keyDecoder.reset();
    this.terminalFocus = 'unknown';
    if (!this.rendererEntered) {
      // Entry clears the screen. Wake startup first, then resize exactly once
      // after entry so the program's resulting repaint cannot be erased.
      this.startupPassthroughReady?.();
      return;
    }
    this.renderer.suspendForPassthrough(restore);
    const dimensions = this.dimensions();
    this.session.resize(dimensions.columns, dimensions.rows);
    this.startupPassthroughReady?.();
  }

  private onActiveModeChange(mode: PresentationMode): void {
    if (this.idle) this.dismissIdle(false);
    if (this.replaying) return;
    if (mode === 'PASSTHROUGH' && !this.passthrough && !this.startupPending) {
      this.cancelPresentation();
      this.passthrough = true;
      this.noteForeignScreen();
      // Modes the program set in earlier output never reached the terminal; hand them over with it.
      this.handOverTerminal(this.commandModes.restoreSequence());
    }
    this.render();
  }

  /**
   * zsh started a command line this frontend did not submit (it began while
   * detached, or came from type-ahead): give it its own transcript block.
   */
  private onShellExec(command: string, at = Date.now(), historyAllowed?: number, queued?: string): void {
    this.pendingQueuePause = undefined;
    this.queueReview = undefined;
    // New work makes an older chain's save review stale, and a pending detail fetch has nothing left to show.
    this.summaryReview = undefined;
    this.pendingSummarySave = undefined;
    this.effects.cancel();
    if (this.running) {
      this.running.awaitingExec = false;
      this.running.historyAllowed = historyAllowed;
      this.chooseActivityPair(this.running);
      if (!this.replaying && !this.startupPending && !this.passthrough && shouldPassthrough(command)) {
        this.cancelPresentation();
        this.passthrough = true;
        this.noteForeignScreen();
        this.handOverTerminal();
      }
      return;
    }
    this.commandModes.reset();
    this.commandLine.reset();
    this.inputState = undefined;
    // A queued entry runs under its own text (a multi-line entry reaches the shell wrapped as one block); the session's
    // queue says so on the exec itself, so a window that attached later shows it the same way.
    if (queued !== undefined) command = queued;
    const startId = this.output.beginCommand(command, this.formatCommandAnsi(command, null), mode => this.onActiveModeChange(mode),
      this.historicalContext(this.shellCwd, this.context, command));
    // The same highlighting as a command typed in the composer: command words NMSh has not classified yet are
    // classified now, and the stored command line is recolored when they resolve (queued, attached and restored runs).
    this.formatCommandAnsi(command, startId);
    this.tapActivityObserver.reset(this.output.activeOutputStartId ?? startId);
    this.running = {command, startedAt: at, interrupted: false, cleared: false, startId, cwd: this.shellCwd, historyAllowed, ...(queued !== undefined ? {queued: true} : {})};
    if (!this.replaying && !this.startupPending && !this.passthrough && shouldPassthrough(command)) {
      this.cancelPresentation();
      this.passthrough = true;
      this.noteForeignScreen();
      this.handOverTerminal();
    }
    this.chooseActivityPair(this.running);
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
    const previousActivityIndex = this.lastActivityPair ? ACTIVITY_VERBS.indexOf(this.lastActivityPair) : -1;
    const activityIndex = running?.activity ? ACTIVITY_VERBS.indexOf(running.activity) : -1;
    return {sessionId: this.sessionId, seq: this.streamSeq,
      ...(previousActivityIndex < 0 ? {} : {previousActivityIndex}),
      ...(running && outputStartId !== undefined ? {running: {command: running.command, startedAt: running.startedAt,
        cwd: running.cwd, startId: this.output.activeStartId ?? running.startId, outputStartId, historyAllowed: running.historyAllowed,
        ...(activityIndex < 0 ? {} : {activityIndex})}} : {})};
  }

  /** Protect input before any program prompt is visible, including synchronous attach replay. */
  private prepareRawInput(): void {
    if (this.stopped || !process.stdin.isTTY || this.rawInputPrepared) return;
    this.originalRawMode = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    this.rawInputPrepared = true;
  }

  async run(): Promise<number> {
    if (this.stopped) return this.done;
    // Catchable shutdown must own cleanup even while probes or persistence await.
    process.once('SIGTERM', this.onTerminate);
    process.once('SIGHUP', this.onTerminate);
    this.prepareRawInput();
    process.once('exit', this.onProcessExit);
    let earlyInput = '';
    // A reattached interactive program owns terminal queries and replies.
    if (!this.passthrough && process.stdin.isTTY && process.stdout.isTTY) {
      process.stdin.setEncoding('utf8');
      const resolved = await probeHost(this.host.capabilities, {
        write: data => process.stdout.write(data),
        listen: receive => {
          process.stdin.on('data', receive);
          process.stdin.resume();
          return () => { process.stdin.off('data', receive); process.stdin.pause(); };
        },
      }, undefined, {graphics: shouldProbeGraphics(process.env)});
      if (this.stopped) return this.done;
      this.host.capabilities = resolved.capabilities;
      this.renderer.setCapabilities(resolved.capabilities);
      earlyInput = resolved.input;
    }
    this.journal = new SessionJournal(this.transcriptStore, this.promptConfiguration.sessionRetention,
      () => ({startCwd: this.presentationStartCwd, finalCwd: this.shellCwd, transcript: this.output.transcript(), live: this.liveLink()}),
      () => this.output.addFrontendInteraction('/resume', 'Could not persist the current session; check local storage.', ERROR),
      // Durable now: the service may forget these stream events.
      saved => { if (saved.live) this.session.ack(saved.live.seq, saved.id); });
    // Initialize the journal before input can schedule snapshots, but do not wait
    // for disk IO before restoring a fullscreen program's terminal and size.
    // The journal serializes saves and acknowledges only durable checkpoints.
    let journalSettled = false;
    const journalStarted = (this.continuedJournal
      ? this.journal.continue(this.continuedJournal)
      : this.journal.start()).then(() => {
      this.journalActive = true;
    }, () => {
      this.output.addFrontendInteraction('/resume', 'Continuous session journaling could not start; check local storage.', ERROR);
      this.render();
    }).finally(() => { journalSettled = true; });
    // A fresh ordinary frontend must first publish its journal identity so an
    // immediate detach can continue that journal. An already-owned terminal
    // must instead restore its raw input and full size without waiting on IO.
    while (!this.stopped && !this.passthrough && !journalSettled) {
      // Replay or the next foreground command can establish ownership while
      // persistence waits. A completion in the same socket batch can withdraw
      // it again, so each wakeup must check the current owner before proceeding.
      try {
        await Promise.race([journalStarted, new Promise<void>(resolve => { this.startupPassthroughReady = resolve; })]);
      } finally {
        this.startupPassthroughReady = undefined;
      }
    }
    // A shell exit or shutdown during startup cannot reinstall frontend input.
    if (!this.stopped) {
      this.startOnboarding();
      // Restored terminal modes are a visible handoff: keys can arrive at once.
      // Install raw input first so the host cannot echo or translate those keys.
      this.prepareRawInput();
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
      this.presentationStarted = true;
      void this.loadSessionIdentity();
      this.refreshAwake();
      // Re-apply (or clean up) Theme Bridge state once per launch; nothing happens when it was never used.
      this.scheduleThemeBridge(500);
      this.scheduleWelcomeBlink();
      void this.loadHistory();
      this.render();
      void this.quietUpdateCheck();
      void this.quietToolUpdateCheck();
      this.armIdle();
      this.presetFrontendReady = true;
      if (this.presetShellReady) this.advancePresetStartup(0, this.shellCwd);
    }
    const exitCode = await this.done;
    await journalStarted;
    try { await this.journal.close(!this.detaching || this.shellEnded); } catch {
      process.stderr.write('NMSh could not finish persisting the current presentation session.\n');
    }
    return exitCode;
  }

  private readonly outputProcessing = new TerminalOutputProcessing();
  private readonly queryExtractor = new QueryExtractor();
  private readonly replyRouter = new ReplyRouter();

  private logEditorKeyInput(data: string): void {
    const hex = Array.from(Buffer.from(data)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    appendFileSync(join(tmpdir(), 'nmsh-key-debug.log'), `RAW hex=${hex} escaped=${JSON.stringify(data)}\n`);
  }

  private readonly onInput = (data: string): void => {
    // Before probes classify a read, or inside a native reader, input can already be sensitive.
    // Key diagnostics therefore observe only the idle composer, never startup or running-program input.
    if (process.env.NMSH_DEBUG_KEYS === '1' && !this.running && !this.startupPending && !this.passthrough && !this.externalPassthrough) {
      this.logEditorKeyInput(data);
    }
    if (this.passthrough && !this.startupPending) {
      // Keys held for an ownership look were typed first: they reach the program first.
      this.ownershipLook?.release();
      this.session.write(data);
      return;
    }
    // The terminal's answers to queries a running program asked (see TerminalQueries) are the program's.
    if (this.replyRouter.expecting) {
      const {replies, rest} = this.replyRouter.split(data, Date.now());
      if (replies && this.running) this.session.write(replies);
      if (!rest) return;
      data = rest;
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
    if (keys.some(key => key.kind !== 'focusIn' && key.kind !== 'focusOut')) {
      // Pointer motion alone is not interaction for the Keep Awake reminder; keys, clicks, scroll and paste are.
      if (keys.some(key => key.kind !== 'focusIn' && key.kind !== 'focusOut' && key.kind !== 'mouseMove')) this.lastUserInput = Date.now();
      this.noteActivity();
    }
    for (const key of keys) {
      const before = {text: this.editor.text, index: this.editor.displayCursorIndex};
      this.handleKey(key);
      this.noteCaretTravel(before);
      this.requestContextDemand();
    }
    // Passive motion renders only when hover changes; skip the generic frame.
    if (keys.length === 0 || keys.some(key => key.kind !== 'mouseMove')) this.render();
  }

  /**
   * A multi-cell caret jump on the same editor line starts the soft travel trail. Purely visual: the logical caret
   * already moved, nothing waits for the animation, and a newer jump retargets the old trail.
   */
  private noteCaretTravel(before: {text: string; index: number}): void {
    if (this.editor.text !== before.text || this.editor.displayCursorIndex === before.index || this.settingsPanelActive || this.passthrough) return;
    const columns = this.dimensions().columns;
    const prefix = this.railInputPrefix(columns);
    const at = (index: number) => layoutInput(this.editor.displayText, index, this.inputColumns(columns), Number.POSITIVE_INFINITY, prefix);
    const from = at(before.index), to = at(this.editor.displayCursorIndex);
    if (from.caretRow !== to.caretRow) return;
    this.transitions.travel(from.caretColumn, to.caretColumn, to.caretRow, Date.now());
  }

  private readonly onResize = (): void => {
    this.stopStartupEnding();
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

  private readonly onProcessExit = (): void => {
    if (!this.stopped) {
      if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
      this.terminalFocus = 'unknown';
      this.renderer.leave();
    }
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
    this.noteForeignScreen();
    this.terminalFocus = 'unknown';
    this.renderer.leave();
    if (process.stdin.isTTY) process.stdin.setRawMode(this.originalRawMode);
    this.outputProcessing.reapplied();
    process.stdin.pause();
    process.kill(process.pid, 'SIGSTOP');
  };

  private readonly onContinue = (): void => {
    if (!this.frontendSuspended || this.stopped) return;
    this.frontendSuspended = false;
    this.terminalFocus = 'unknown';
    this.renderer.enter();
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    this.outputProcessing.reapplied();
    if (this.passthrough) {
      this.outputProcessing.set(true);
      this.renderer.suspendForPassthrough(this.commandModes.restoreSequence());
    }
    process.stdin.resume();
    this.keyDecoder.reset();
    this.onResize();
  };

  private handleKey(key: Key): void {
    // Any real input finishes the ending at once (focus changes and pointer movement are not input); the key is then handled normally.
    if (this.startupEnding && key.kind !== 'focusIn' && key.kind !== 'focusOut' && key.kind !== 'mouseMove') this.finishStartupEnding();
    const navigating = Boolean(this.outputNavigation);
    const validNavigation = this.reconcileOutputNavigation();
    if (navigating && !validNavigation && this.outputNavigationAvailable()
      && ['up', 'down', 'enter', 'escape'].includes(key.kind)) { this.render(); return; }
    // Adjacent typing barely animates the caret; every other movement travels (cursor effects only).
    this.caretCause = key.kind === 'text' || key.kind === 'backspace' || key.kind === 'delete' || key.kind === 'paste' ? 'typing' : 'jump';
    if (this.effects.active && (key.kind === 'escape' || (key.kind === 'interrupt' && !this.running))) {
      this.effects.cancel(); this.render(); return;
    }
    if (key.kind === 'focusIn' || key.kind === 'focusOut') {
      this.terminalFocus = key.kind === 'focusIn' ? 'focused' : 'blurred';
      return;
    }
    // Workspace columns: pointer events on a region are the workspace's; center events continue center-relative.
    const routed = this.routeWorkspacePointer(key);
    if (!routed) return;
    key = routed;
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
    if (this.keepAwakePanel) {
      const result = keepAwakeKey(this.keepAwakePanel, this.keepAwake(), key, this.promptConfiguration.keepAwake);
      if (result && typeof result === 'object' && 'settings' in result) {
        const next = result.settings;
        this.updateConfiguration(configuration => { configuration.keepAwake = next; });
      } else if (result) {
        const command = this.keepAwakePanel.command;
        this.keepAwakePanel = undefined;
        if (typeof result === 'object' && 'done' in result) this.output.addFrontendInteraction(command ?? '/caffeinate', result.done, INFO);
        this.refreshAwake();
        this.returnFromPanel();
      }
      this.render();
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
    if (this.themeBridgePanel) {
      void this.handleThemeBridgeKey(key, this.themeBridgePanel);
      return;
    }
    if (this.copyPicker) {
      const action = copyPickerKey(this.copyPicker, key);
      const report = this.copyPickerReport;
      if (action?.kind === 'close') { this.copyPicker = undefined; this.copyPickerReport = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'copy' || action?.kind === 'report') {
        this.copyPicker = undefined;
        this.copyPickerReport = undefined;
        this.returnFromPanel();
        if (action.kind === 'report' || report) this.startReport(action.records, report ?? 'markdown');
        else void this.copyRecords(action.records, action.includeStatus);
      }
      this.render();
      return;
    }
    if (this.textEditor) {
      const editor = this.textEditor;
      const {columns, rows} = this.dimensions();
      const action = editorKey(editor, key, columns, rows - 4);
      if (action) this.runEditorAction(editor, action);
      this.render();
      return;
    }
    if (this.viewer) {
      const viewer = this.viewer;
      const {columns, rows} = this.dimensions();
      const action = viewerKey(viewer, key, columns, rows - 4, this.viewerLook());
      if (action?.kind === 'close') { this.viewer = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'edit') { this.viewer = undefined; this.openTextEditor(action.path, '/edit', viewer); }
      else if (action?.kind === 'copy') {
        void this.copyText(action.text, 'Copied the document').then(note => { if (note && this.viewer === viewer) { viewer.note = note; this.render(); } });
      }
      this.render();
      return;
    }
    if (this.comparePanel) {
      const {columns, rows} = this.dimensions();
      const action = comparePanelKey(this.comparePanel, key, columns, rows - 4);
      if (action?.kind === 'close') { this.comparePanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'copy' && action.what === 'diff') {
        const panel = this.comparePanel;
        const diff = copyableDiff(action.comparison);
        // The plain diff is copied as is, without the report review: say so when it looks like it holds secrets.
        const sensitive = scanSensitive(diff, homedir());
        void this.copyText(diff, 'Copied diff', sensitive.length ? ` · not redacted: ${describeFindings(sensitive)} (r reviews)` : '').then(note => { if (note && this.comparePanel === panel) { panel.note = note; this.render(); } });
      } else if (action?.kind === 'copy') {
        // A comparison report is a report: the same review (exact text, wrapped, redaction) before it is copied.
        this.comparePanel = undefined;
        const comparison = structuredClone(action.comparison);
        this.reportReview = createTextReview('Copy comparison report', options => buildComparisonReport(comparison, options), [comparison.a, comparison.b],
          {...DEFAULT_REPORT_OPTIONS, home: homedir()}, Boolean(configuredEditor(process.env)));
      }
      this.render();
      return;
    }
    if (this.summaryReview) { this.summaryReviewKey(key); return; }
    if (this.reportReview) {
      const {columns, rows} = this.dimensions();
      const action = reportReviewKey(this.reportReview, key, rows - 4, columns);
      const review = this.reportReview;
      if (action?.kind === 'close') { this.reportReview = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'copy') { this.reportReview = undefined; this.returnFromPanel(); void this.copyReportText(action.text, review.records); }
      else if (action?.kind === 'edit') void this.editReport(review);
      this.render();
      return;
    }
    if (this.rowPanel) {
      const action = rowPanelKey(this.rowPanel, key, this.promptConfiguration);
      if (action?.kind === 'close') { this.rowPanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'change') { this.applySettingsConfiguration(action.configuration); this.syncStatusStrip(); }
      this.render();
      return;
    }
    if (this.stripStudio) {
      const action = stripStudioKey(this.stripStudio, key, this.promptConfiguration);
      if (action?.kind === 'close') { this.stripStudio = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'change') { this.applySettingsConfiguration(action.configuration); this.syncStatusStrip(); this.requestContextDemand(); }
      this.render();
      return;
    }
    if (this.configureList) {
      const tools = registryFacts();
      const action = configureListKey(this.configureList, key, tools);
      if (action?.kind === 'close') { this.configureList = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'open') { this.configureList = undefined; void this.openConfigure(action.id, '/configure'); }
      else if (action?.kind === 'bridge') { this.configureList = undefined; void this.openThemeBridge(); }
      this.render();
      return;
    }
    if (this.tmuxPanel) {
      void this.handleTmuxKey(key, this.tmuxPanel);
      return;
    }
    if (this.dotfiles) {
      const action = dotfilesKey(this.dotfiles, key);
      if (action) void this.handleDotfilesAction(action, this.dotfiles).then(() => this.render());
      this.render();
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
      else if (result?.kind === 'save' && this.panelOrigin === 'setup' && this.parkedSetup) {
        // Opened from Setup: the colors join its draft; nothing is saved until Setup's Apply.
        const draft = this.parkedSetup.state.draft;
        this.parkedSetup.state.draft = {...draft, uiChrome: {source: 'custom', preset: 'custom', colors: result.colors}};
        this.chromeEditor = undefined; this.returnFromPanel();
      } else if (result?.kind === 'save' && this.applySettingsConfiguration({...this.promptConfiguration,
        uiChrome: {source: 'custom', preset: 'custom', colors: result.colors}})) { this.chromeEditor = undefined; this.returnFromPanel(); }
      return;
    }
    if (this.toolsPanel) {
      void this.handleToolsKey(key, this.toolsPanel);
      return;
    }
    if (this.paletteState) {
      const state = this.paletteState;
      if (key.kind === 'escape' || key.kind === 'interrupt' || key.kind === 'palette') {
        const returning = this.blockPaletteReturn?.palette === state;
        this.paletteState = undefined;
        this.blockPaletteContext = undefined;
        this.blockPaletteReturn = undefined;
        if (returning && this.outputNavigation) this.revealOutputNavigation();
      }
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
    if (this.outputNavigation && this.handleOutputNavigationKey(key)) return;
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
      if (this.promptPanelState.step === 'railInsideConfirm' && (key.kind === 'escape' || key.kind === 'interrupt')) {
        const state = this.promptPanelState;
        state.step = state.railConfirmReturn?.step ?? 'appearance';
        state.selectedIndex = state.railConfirmReturn?.selectedIndex ?? 0;
        state.railConfirmReturn = undefined;
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
      if (this.promptPanelState.step === 'modules') this.promptPanelState.context = this.modulesContext();
      if ((key.kind === 'escape' || key.kind === 'interrupt') && this.promptPanelState.standalone && !promptPanelOwnsKey(this.promptPanelState, key)) {
        // /modules saved each change as it was made: Esc only closes.
        this.promptPanelState = undefined;
        this.returnFromPanel();
        this.render();
        return;
      }
      if (key.kind === 'escape' && this.promptPanelState.step === 'modules' && !promptPanelOwnsKey(this.promptPanelState, key)) {
        // Esc leaves the module manager, keeping its draft edits for the final save (or A saved them already).
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
      if (this.promptPanelState?.request) void this.handleModulesRequest(this.promptPanelState);
      else if (this.promptPanelState?.standalone) { this.persistModuleSettings(this.promptPanelState); this.render(); }
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
    if (this.pinsPanel) { void this.handlePinsKey(key); return; }
    if (this.queueHistoryPanel) {
      const action = queueHistoryPanelKey(this.queueHistoryPanel, key, this.queueState);
      if (action?.kind === 'close') { this.queueHistoryPanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'detail') {
        this.queueHistoryPanel.detail = action.chainId;
        this.session.queue(action.chainId === undefined ? {op: 'history-detail'} : {op: 'history-detail', chainId: action.chainId});
      } else if (action?.kind === 'save') {
        this.queueHistoryPanel = undefined;
        this.returnFromPanel();
        this.beginSummarySave(action.chainId);
      }
      this.render();
      return;
    }
    if (this.queuePanel) {
      const action = queuePanelKey(this.queuePanel, key, this.queueState, this.queueConditionsAvailable(), this.session.features.has('queue-timeline'));
      if (action?.kind === 'close') { this.queuePanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'change') this.session.queue(action.change);
      else if (action?.kind === 'edit') { this.queuePanel = undefined; this.returnFromPanel(); this.beginQueueEdit(action.id); }
      else if (action?.kind === 'saveRecipe') { this.queuePanel = undefined; this.openPins({naming: this.queueState.entries.map(entry => entry.text)}); }
      this.render();
      return;
    }
    if (this.watchPanel) {
      const panel = this.watchPanel;
      const action = watchPanelKey(panel, key, this.watches.active());
      if (action?.kind === 'close') { this.watchPanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'confirm' && panel.confirm) {
        const pending = panel.confirm;
        const size = this.dimensions();
        if (size.columns < 40 || size.rows < 14) {
          panel.message = 'Resize to at least 40 columns and 14 rows to review this recurring command.';
          this.render();
          return;
        }
        panel.confirm = undefined;
        const safety = watchSafety(pending.command);
        if (safety.kind === 'refused') panel.message = safety.reason;
        else if (this.startWatch(pending.track ? `/track ${pending.command}` : `/watch ${pending.command}`, pending.command, pending.cwd, pending.intervalMs, safety, Boolean(pending.track))) {
          // A confirmed /track shows its block in the transcript; the manager closes.
          if (pending.track) { this.watchPanel = undefined; this.returnFromPanel(); }
          else panel.selected = this.watches.active().length - 1;
        }
      } else if (action?.kind === 'pause') this.watches.pause(action.id);
      else if (action?.kind === 'resume') this.watches.resume(action.id);
      else if (action?.kind === 'now' && !this.watches.runNow(action.id)) panel.message = 'A result is still being produced; no second one was started.';
      else if (action?.kind === 'copy') {
        const latest = this.watches.get(action.id)?.current;
        if (!latest) panel.message = 'No completed result to copy yet.';
        else void this.copyText(latest.output, 'Copied the latest result').then(note => { if (note && this.watchPanel === panel) { panel.message = note; this.render(); } });
      }
      else if (action?.kind === 'stop') this.watches.stop(action.id);
      this.render();
      return;
    }
    if (this.doctorPanel) {
      const action = doctorKey(this.doctorPanel, key);
      if (action?.kind === 'close') { this.doctorPanel = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'rerun') void this.openDoctor();
      else if (action?.kind === 'action') {
        // Doctor only opens things; any change still goes through that surface's own confirmation.
        this.doctorPanel = undefined;
        if (action.action.kind === 'slash') { const parsed = parseSlashCommand(action.action.command); if (parsed) void this.runSlash(action.action.command, parsed); }
        else this.openAsk(action.action.request);
      }
      this.render();
      return;
    }
    if (this.understandingPanel) {
      const action = understandingKey(this.understandingPanel, key, this.understandingFacts());
      if (action) void this.handleUnderstandingAction(action);
      this.render();
      return;
    }
    if (this.providersOverview) {
      const action = providersOverviewKey(this.providersOverview, key, {configuration: this.promptConfiguration, statuses: this.providerStatuses});
      if (action?.kind === 'close') { this.providersOverview = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'detect') void this.refreshProvidersOverview(true);
      else if (action?.kind === 'open') this.openProviderFamily(action.row);
      else if (action?.kind === 'select') this.selectProviderInline(action.family, action.id);
      else if (action?.kind === 'install') void this.installProviderInline(action.family, action.id);
      this.render();
      return;
    }
    if (this.modsPanel) {
      const action = modsKeyAction(key, this.modsPanel.owner);
      const result = action ? this.modsPanel.dispatch(action) : undefined;
      if (result === 'close') {this.modsPanel = undefined; this.returnFromPanel();}
      else if (result === 'refresh') void this.refreshMods();
      else if (result === 'toggle') void this.toggleMod();
      else if (result === 'inspect') void this.inspectMod();
      this.render(); return;
    }
    if (this.worktreePanel) { void this.handleWorktreeKey(key); return; }
    if (this.githubPanel) { this.handleGithubKey(key); return; }
    if (this.agentView) { this.handleAgentViewKey(key); return; }
    if (this.batchReview) {
      const review = this.batchReview;
      const action = batchReviewKey(review, key, this.dimensions().rows - 4);
      const done = () => { this.batchReview = undefined; this.pasteReview = undefined; this.pastePreview = undefined; this.selectedSuggestion = 0; };
      if (action?.kind === 'queue') {
        // Enter on the reviewed list is the confirmation: exactly these commands, in this order, into this session's own queue.
        const texts = batchTexts(review);
        if (!this.queueAvailable() || texts.length > QUEUE_LIMIT - this.queueState.entries.length) {
          this.output.addFrontendInteraction('/ps', 'The queue cannot take these commands now; nothing was queued.', ERROR);
        } else {
          for (const text of texts) {
            this.syncQueuePolicy();
            this.session.queue({op: 'add', text});
            this.sessionSubmissions.push({text, slash: false});
            if (this.sessionSubmissions.length > SESSION_SUBMISSION_LIMIT) this.sessionSubmissions.shift();
          }
          this.output.addFrontendInteraction('/ps', `Queued ${texts.length} command${texts.length === 1 ? '' : 's'}. They run one at a time in this shell; /queue shows them.`, INFO);
        }
        done();
      } else if (action?.kind === 'block') {
        done();
        void this.runReviewedBlock(batchBlockText(review));
      } else if (action?.kind === 'edit') {
        this.editor.insertPaste(batchBlockText(review));
        done();
      } else if (action?.kind === 'text') {
        this.editor.insertPaste(review.source);
        done();
      } else if (action?.kind === 'back') {
        this.batchReview = undefined;
        if (review.title) this.openPins();
      } else if (action?.kind === 'cancel') {
        done();
      }
      this.render();
      return;
    }
    if (this.pasteReview && this.pastePreview) {
      // The bounded review surface: Enter inserts the original text (nothing runs), Esc returns to the compact preview.
      const outcome = pasteReviewKey(this.pasteReview, key, this.dimensions().rows - 4);
      if (outcome === 'batch') void this.openBatchReview(this.pastePreview.text);
      else if (outcome === 'clip') this.keepClip(this.pastePreview.text, 'paste', this.shellCwd);
      else if (outcome === 'insert') { const text = this.pastePreview.text; this.pasteReview = undefined; this.pastePreview = undefined; this.editor.insertPaste(text); this.selectedSuggestion = 0; }
      else if (outcome === 'back') { this.pasteReview = undefined; if (!this.pasteCompactFits()) this.pastePreview = undefined; }
      else if (outcome === 'cancel') { this.pasteReview = undefined; this.pastePreview = undefined; }
      this.render();
      return;
    }
    if (this.pastePreview) {
      const preview = this.pastePreview;
      if (key.kind === 'enter') {
        this.pastePreview = undefined;
        this.editor.insertPaste(preview.text);
        this.selectedSuggestion = 0;
        this.render();
        return;
      }
      if (key.kind === 'text' && key.value.toLowerCase() === 'r') {
        this.pasteReview = createPasteReview(preview.text, preview.analysis, preview.batch, this.shellId);
        this.render();
        return;
      }
      if (key.kind === 'text' && key.value.toLowerCase() === 'b' && preview.batch) {
        void this.openBatchReview(preview.text);
        this.render();
        return;
      }
      if (key.kind === 'text' && key.value.toLowerCase() === 'c') {
        this.keepClip(preview.text, 'paste', this.shellCwd);
        this.render();
        return;
      }
      if (key.kind === 'escape' || key.kind === 'interrupt') {
        this.pastePreview = undefined;
        this.render();
        return;
      }
      // Any other key (typing, editing) invalidates the paste preview and continues normal processing
      this.pastePreview = undefined;
    }
    if (this.shelf.focused && this.handleShelfKey(key)) return;
    if (this.background.panel) { this.handleBackgroundPanelKey(key); return; }
    if (this.background.bar.focused && this.handleBackgroundBarKey(key)) return;
    if (this.launcher) { this.handleLauncherKey(key); return; }
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
      else if (action?.kind === 'indicatorVisibility' || action?.kind === 'indicatorSide') {
        this.updateConfiguration(configuration => applyShellIndicatorAction(configuration, action));
        this.shellPanel.promptConfiguration = this.promptConfiguration;
      }
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
    // Every panel, program and search above keeps its keys. Then a focused workspace region, or an opt-in keymap
    // binding from an idle composer (it comes before the agent shelf, the task bar and history).
    if (this.handleWorkspaceKey(key)) return;
    if (this.background.suggestion && this.handleBackgroundSuggestionKey(key)) return;
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
          // The sticky overlay owns the top row: its controls act on that block; elsewhere a click jumps to its header.
          const controls = key.kind === 'mouseClick' ? this.stickyControls(sticky.startId, columns)?.controls : undefined;
          const x = key.x ?? 0;
          if (controls?.copy && x >= controls.copy.column && x <= controls.copy.end) { void this.copyBlock(sticky.startId); return; }
          if (controls && x >= controls.column) { this.openBlockPalette(sticky.startId); this.render(); return; }
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
            const affordance = blockAffordance(row, columns, this.controlOptions(row.blockStartId));
            if (!this.running && key.kind === 'mouseClick' && row.lineIndex === this.hoveredLineIndex && affordance && row.blockStartId !== undefined) {
              const x = key.x ?? 0;
              if (affordance.copy && x >= affordance.copy.column && x <= affordance.copy.end) { this.selection = undefined; void this.copyBlock(row.blockStartId); return; }
              if (x >= affordance.column) { this.selection = undefined; this.openBlockPalette(row.blockStartId); this.render(); return; }
            }
            if (key.kind === 'mouseClick' && row.semanticToggle !== undefined) {
              this.output.toggleSemanticDetails(row.semanticToggle);
              this.render();
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
    if (this.appearanceHub) {
      const action = appearanceHubKey(this.appearanceHub, key, this.promptConfiguration);
      if (action?.kind === 'close') { this.appearanceHub = undefined; this.returnFromPanel(); }
      else if (action?.kind === 'motion') this.updateConfiguration(configuration => { configuration.motion = action.motion; });
      else if (action?.kind === 'saveHost') void this.saveAppearance();
      else if (action?.kind === 'open') {
        // The canonical editors; /appearance never duplicates them.
        this.appearanceHub = undefined;
        if (action.destination === 'prompt') void this.startPromptSettings(false);
        else if (action.destination === 'theme') this.openThemeStudio();
        else if (action.destination === 'themeBridge') void this.openThemeBridge();
        else if (action.destination === 'cursor') { this.panelOrigin = undefined; this.openCursorPanel(); }
        else if (action.destination === 'chroma') this.startChromaSettings();
        else this.focusConfigRow('uiChrome');
      }
      this.render();
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
    if (this.queueReview) { this.queueReviewKey(key); return; }
    if (this.ownershipLook) {
      // Ctrl+C is never held: what was typed is routed on what is known now, then the interrupt goes.
      if (key.kind !== 'interrupt') { this.ownershipLook.keys.push(key); return; }
      this.ownershipLook.release();
    } else if (this.needsOwnershipLook(key)) {
      this.holdForOwnershipLook(key);
      return;
    }
    // A program reading a hidden line or single keys gets each key as it is typed, as in any terminal: the
    // composer neither shows nor keeps it, and Enter is a key for the program, never a shell submission.
    // Ctrl+Q while a program reads keys directly: the composer takes the next command for the queue; the program
    // never sees those keys. Esc returns typing to the program.
    if (key.kind === 'queueCommand' && this.directInputRequest() && this.queueAvailable()) {
      this.queueCompose = true;
      this.render();
      return;
    }
    if (key.kind === 'escape' && this.queueCompose) {
      this.queueCompose = false;
      this.editor.clear();
      this.render();
      return;
    }
    if (key.kind === 'escape' && this.queueEdit) {
      this.cancelQueueEdit();
      this.render();
      return;
    }
    if (this.directInputRequest()) {
      this.sendDirectKey(key);
      return;
    }
    // Typing that starts while a command waits for a line is an answer: if the command ends before it is sent, it
    // is discarded rather than left to run as the next shell command.
    if (this.running && !this.editor.text && (key.kind === 'text' || key.kind === 'paste')) {
      // Right after Ctrl+C or Ctrl+Z, typing is type-ahead for the prompt, not a reply.
      this.runningDraft = {startId: this.running.startId, at: Date.now(), answering: this.answersByDefault() && !this.justStopped()};
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
    if (key.kind === 'escape' && this.queueAffordance() === 'resume' && this.focusedCommandIndex === undefined) {
      this.openQueueReview('clear'); this.render(); return;
    }
    if (key.kind === 'escape') this.clearBlockFocus();
    if (FLOW_EDIT_KEYS.has(key.kind) && key.kind !== 'enter') this.clearBlockFocus();

    if (key.kind === 'previousFailure' || key.kind === 'nextFailure') {
      if (!this.running) this.goToFailure(key.kind === 'previousFailure' ? 'previous' : 'next');
      return;
    }
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
        this.running.stoppedAt = Date.now();
        this.editor.clear();
        this.session.interrupt();
        // Ctrl+C ends a waiting question: what is typed next is for the prompt, never a reply to discard.
        this.runningDraft = undefined;
        this.answerSent();
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
      if (this.running) { this.running.stoppedAt = Date.now(); this.session.write('\u001A'); this.runningDraft = undefined; this.answerSent(); }
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

    if (!this.running && !this.historySearchActive && !this.directorySearchActive && !isSlashInput(this.editor.text) && this.shellSuggestions.length > 0
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
    const isSlash = !this.editor.hasPasteAtoms && isSlashInput(this.editor.text);
    // /history and /dirs own Up/Down. Slash suggestions behave like the shell
    // completion menu: Down enters it, Up from its first row (or before
    // entering it) leaves it for command history.
    const searchSurface = this.historySearchActive || this.directorySearchActive;
    // A bottom composer lists picker results above the query, best match nearest it: Up moves away from the input.
    if (searchSurface && this.pickerFromBottom() && (key.kind === 'up' || key.kind === 'down')) key = {...key, kind: key.kind === 'up' ? 'down' : 'up'} as Key;
    const inSlashMenu = this.slashMenuFor === this.editor.text;
    if (key.kind === 'up' && suggestions.length > 0 && (searchSurface || (inSlashMenu && this.selectedSuggestion > 0))) {
      this.selectedSuggestion = (this.selectedSuggestion - 1 + suggestions.length) % suggestions.length;
    } else if (key.kind === 'down' && suggestions.length > 0 && (searchSurface || isSlash)) {
      if (!searchSurface && !inSlashMenu) { this.slashMenuFor = this.editor.text; this.selectedSuggestion = 0; }
      else this.selectedSuggestion = (this.selectedSuggestion + 1) % suggestions.length;
    } else if (key.kind === 'up' && isSlash && !searchSurface && suggestions.length > 0 && this.leaveSlashMenu()) {
      // Left the slash menu; fall through to history recall below.
      const {columns} = this.dimensions();
      if (!this.editor.moveUp(this.inputColumns(columns), this.railInputPrefix(columns)) && this.composerHistoryEligible()) this.recallHistory('previous');
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
      // Paste Guard: worth-a-look pastes are previewed first (never changed); ordinary ones insert at once.
      const analysis = analyzePaste(key.value);
      if (needsPreview(analysis, this.promptConfiguration.pastePreview)) {
        const batch = this.batchAvailable(key.value);
        this.pastePreview = {text: key.value, analysis, batch};
        // The compact strip never squeezes the composer: when this screen has no room for it, Review is the surface.
        if (!this.pasteCompactFits()) this.pasteReview = createPasteReview(key.value, analysis, batch, this.shellId);
        this.render();
        return;
      }
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
    else if (key.kind === 'right') this.acceptingGhost(() => this.editor.moveRight());
    else if (key.kind === 'selectLeft') this.editor.selectLeft();
    else if (key.kind === 'selectRight') this.editor.selectRight();
    else if (key.kind === 'wordLeft') this.editor.wordLeft();
    else if (key.kind === 'wordRight') this.editor.wordRight();
    else if (key.kind === 'selectWordLeft') this.editor.selectWordLeft();
    else if (key.kind === 'selectWordRight') this.editor.selectWordRight();
    else if (key.kind === 'up') {
      const {columns} = this.dimensions();
      // Spatial focus: the shelf sits above the composer. Only an already visible shelf, from a completely idle
      // composer; a hidden shelf is never revealed by ↑, which stays shell history.
      if (this.composerIdle() && !this.composerHistory.active && this.shelfShown()) { this.shelf.focused = true; this.shelf.selected = 0; this.render(); return; }
      // Then the background task bar (only from an idle composer, only when tasks are shown), then history.
      if (this.enterBackgroundBar(key)) return;
      if (!this.editor.moveUp(this.inputColumns(columns), this.railInputPrefix(columns)) && this.composerHistoryEligible()) this.recallHistory('previous');
    } else if (key.kind === 'selectUp') {
      const {columns} = this.dimensions();
      if (this.enterBackgroundBar(key)) return;
      this.editor.selectUp(this.inputColumns(columns), this.railInputPrefix(columns));
    } else if (key.kind === 'down') {
      const {columns} = this.dimensions();
      // At the newest, empty composer ↓ has nothing to do: it reveals the agent shelf (↑ then focuses it).
      if (!this.editor.text && !this.composerHistory.active && this.agents.sessions.length && !this.running) { this.revealShelf(); this.render(); return; }
      if (!this.editor.moveDown(this.inputColumns(columns), this.railInputPrefix(columns)) && this.composerHistoryEligible()) this.recallHistory('next');
    } else if (key.kind === 'selectDown') {
      const {columns} = this.dimensions();
      this.editor.selectDown(this.inputColumns(columns), this.railInputPrefix(columns));
    }
    else if (key.kind === 'lineHome') this.editor.lineHome();
    else if (key.kind === 'selectLineHome') this.editor.selectLineHome();
    else if (key.kind === 'lineEnd') this.acceptingGhost(() => this.editor.lineEnd());
    else if (key.kind === 'selectLineEnd') this.editor.selectLineEnd();
    else if (key.kind === 'bufferHome') this.editor.moveBufferHome();
    else if (key.kind === 'bufferEnd') this.acceptingGhost(() => this.editor.moveBufferEnd());
    else if (key.kind === 'selectBufferHome') this.editor.selectBufferHome();
    else if (key.kind === 'selectBufferEnd') this.editor.selectBufferEnd();
    else if (key.kind === 'backspace') this.editor.backspace();
    else if (key.kind === 'deleteWord') this.editor.deleteWord();
    else if (key.kind === 'deleteLineBefore') this.editor.deleteLineBefore();
    else if (key.kind === 'deleteLineAfter') this.editor.deleteLineAfter();
    else if (key.kind === 'delete') this.editor.delete();
    else if (key.kind === 'newline') this.editor.insert('\n');
    else if (key.kind === 'queueCommand') this.routeComposer('queue');
    else if (key.kind === 'sendToProgram') this.routeComposer('send');
    else if (key.kind === 'enter') this.routeComposer('enter');
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
   * Whether Up/Down may browse command history right now. NMSh owns the composer unless a foreground program
   * actually reads input: ordinary execution (queued entries included) never takes the keys, while a program
   * waiting for a line — or a direct hidden/single-key reader — keeps them, and an explicit queued-entry edit
   * keeps its own draft. The direct-reader and line-waiting checks are defense in depth: those keys are routed
   * to the program earlier in handleKey, and this predicate must never disagree with that.
   */
  private composerHistoryEligible(): boolean {
    if (this.queueEdit || this.passthrough || this.externalPassthrough) return false;
    if (this.queueCompose) return true;
    if (!this.running) return true;
    return !this.directInputRequest() && !this.answersByDefault();
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
    const eligible = !this.running && !this.settingsPanelActive && !this.editor.hasPasteAtoms && !isSlashInput(input) && Boolean(input.trim())
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
      })), native, this.pickerHandoff, process.env, await this.fzfThemeArgs(), this.fzfLayout());
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
      const result = await openPicker(this.promptConfiguration.picker, candidates, native, this.pickerHandoff, process.env, await this.fzfThemeArgs(), this.fzfLayout());
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
      })), native, this.pickerHandoff, process.env, await this.fzfThemeArgs(), this.fzfLayout());
      if (this.stopped) return;
      if (result?.kind === 'selected') this.applySuggestion({insertion: result.candidate.value});
      if (result?.kind === 'fallback') this.output.addFrontendInteraction('/dirs', result.reason, INFO);
      this.render();
    } finally { this.pickerOpening = false; }
  }

  /** Whether a program may take the host terminal now: a real TTY, and nothing else owns it. */
  private hostTerminalFree(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !this.running && !this.passthrough && !this.externalPassthrough;
  }

  /**
   * A child program (picker, pager, wizard) temporarily owns the host
   * terminal, never the managed shell PTY: NMSh detaches input, leaves raw
   * mode and its screen, lets the program handle Ctrl+C, and restores itself
   * afterwards whatever happened. The signal aborts on stop (and on resize
   * for programs that cannot follow one).
   */
  private async withHostTerminal<T>(run: (signal: AbortSignal) => Promise<T>, options: {abortOnResize?: boolean} = {}): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const ignoreInterrupt = () => { /* The foreground program handles Ctrl+C. */ };
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
      if (options.abortOnResize) process.on('SIGWINCH', abort);
      this.hostProgramAbort = controller;
      return await run(controller.signal);
    } finally {
      process.off('SIGINT', ignoreInterrupt); process.off('SIGWINCH', abort);
      this.hostProgramAbort = undefined;
      if (!this.stopped) {
        if (left) this.renderer.enter();
        if (released) process.stdin.setRawMode(true);
        this.keyDecoder.reset();
        if (detached) { process.stdin.on('data', this.onInput); process.stdin.resume(); }
        this.renderer.invalidate();
      }
      this.externalPassthrough = false;
      this.noteForeignScreen();
      this.render();
    }
  }

  /** External pickers temporarily own the host terminal; a resize cancels them (they cannot follow it). */
  private readonly pickerHandoff: PickerHandoff = async run => {
    if (!this.hostTerminalFree()) return {kind: 'fallback', reason: 'A free interactive terminal is required; using Native'};
    try { return await this.withHostTerminal(run, {abortOnResize: true}); }
    catch (error) { return {kind: 'fallback', reason: `Picker failed: ${String(error)}; using Native`}; }
  };

  /** "Open in pager": the block's command and complete stored output reach the pager only through its stdin. */
  private async openBlockInPager(record: CompletedCommand): Promise<void> {
    const say = (text: string, kind = INFO) => this.output.addFrontendInteraction('Open in pager', text, kind);
    if (!this.hostTerminalFree()) { say('Opening a pager needs a free interactive terminal.'); return; }
    const pager = await choosePager(process.env, workspaceRoots(this.context.cwd, this.context.root, homedir()));
    if (!pager) { say('No pager was found: less or more on PATH, or a PAGER that names a program directly.'); return; }
    const bridge = this.themeBridgePagerEnvironment();
    const result = await this.withHostTerminal(signal => runPager(pager, pagerDocument(record.command, record.output), pagerProcessEnvironment(process.env, bridge), signal));
    if (!result.ok && result.reason !== 'cancelled') say(`${result.reason}.`, ERROR);
  }

  /** An accepted ghost suggestion became real text: it materializes like a completion. */
  private acceptingGhost(move: () => void): void {
    const before = graphemes(this.editor.text).length;
    const text = this.editor.text;
    move();
    const after = graphemes(this.editor.text).length;
    if (after > before && this.editor.text.startsWith(text)) this.transitions.materialize(before, after, this.editor.text, Date.now());
  }

  private applySuggestion(suggestion: {insertion: string; insertionCursor?: number}): void {
    const before = graphemes(this.editor.text);
    this.editor.clear();
    this.editor.insert(suggestion.insertion);
    // Completion Materialization: only the newly inserted graphemes (common prefix and suffix kept).
    const after = graphemes(this.editor.text);
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
    let tail = 0;
    while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
    this.transitions.materialize(start, after.length - tail, this.editor.text, Date.now());
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
    else if (slash.kind === 'copy') await this.copySlash(command, slash.args);
    else if (slash.kind === 'actions') {
      if (!this.outputNavigationAvailable()) return;
      if (slash.error) this.output.addFrontendInteraction(command.trim(), slash.error, ERROR);
      else if (slash.index !== undefined) {
        const record = this.output.recentShell(slash.index);
        if (record) this.openBlockPalette(record.startId);
        else this.output.addFrontendInteraction(command.trim(), `No completed command output at ${slash.index}.`, ERROR);
      } else this.openOutputNavigation('actions');
    }
    else if (slash.kind === 'pasteClipboard') await this.pasteClipboard(command);
    else if (slash.kind === 'clips') {
      if (slash.suggestions === undefined) this.openClips();
      else this.configureClipboardChanges(slash.suggestions);
    }
    else if (slash.kind === 'pins') { this.panelOrigin = undefined; this.openPins(); }
    else if (slash.kind === 'view') this.openViewer(slash.target, command.trim());
    else if (slash.kind === 'editFile') {
      if (!slash.target) this.output.addFrontendInteraction(command.trim(), 'Name a file: /edit notes.md. Your own editor and vim, nano or micro still work as usual.', INFO);
      else this.openTextEditor(slash.target, command.trim());
    }
    else if (slash.kind === 'compare') {
      if (slash.error) this.output.addFrontendInteraction(command.trim(), slash.error, ERROR);
      else {
        const recent = this.output.recentShellCommands();
        const first = recent[(slash.first ?? 1) - 1];
        const second = slash.second === undefined ? undefined : recent[slash.second - 1];
        if (!first || (slash.second !== undefined && !second)) this.output.addFrontendInteraction(command.trim(), `No completed command output at ${!first ? slash.first ?? 1 : slash.second}.`, ERROR);
        else if (second === first) this.output.addFrontendInteraction(command.trim(), 'Choose two different outputs to compare.', ERROR);
        else this.openCompare(first, second ?? (slash.first === undefined ? previousRun(first, recent) : undefined));
      }
    }
    else if (slash.kind === 'copySettings') { this.panelOrigin = undefined; this.rowPanel = createRowPanel('Copy', '/copy and /cp', ['copyMode', 'copyIncludeStatus', 'copyAutoExpand']); }
    else if (slash.kind === 'appearance') { this.panelOrigin = undefined; await this.startAppearance(); }
    else if (slash.kind === 'motion') {
      // The same Motion screen and state as /appearance → Motion.
      this.panelOrigin = undefined;
      await this.startAppearance();
      if (this.appearanceHub) { this.appearanceHub.view = 'motion'; this.appearanceHub.selected = 0; this.appearanceHub.previewStart = Date.now(); }
    }
    else if (slash.kind === 'prompt') { this.panelOrigin = undefined; await this.startPromptSettings(false); }
    else if (slash.kind === 'modules' && slash.report === 'explain') this.output.addFrontendBlock(command.trim(), explainModules(this.promptConfiguration.modules, this.modulesContext(), this.promptConfiguration));
    else if (slash.kind === 'modules' && slash.report === 'timings') this.output.addFrontendBlock(command.trim(), moduleTimings(id => this.contextEngine.status(id)));
    else if (slash.kind === 'modules') { this.panelOrigin = undefined; this.openModulesManager(); }
    else if (slash.kind === 'chroma') { this.panelOrigin = undefined; this.startChromaSettings(); }
    else if (slash.kind === 'screensaver') {
      this.panelOrigin = undefined;
      if (slash.start) {
        if (slash.mode) this.applySettingsConfiguration({...this.promptConfiguration, idleVisuals: {...this.promptConfiguration.idleVisuals, mode: slash.mode}});
        this.startIdle(true);
      } else this.openScreensaverGallery();
    }
    // The cursor has one configuration: /cursor opens its existing Settings rows.
    else if (slash.kind === 'cursor') { this.panelOrigin = undefined; this.openCursorPanel(); }
    else if (slash.kind === 'activity') { this.panelOrigin = undefined; this.focusConfigRow('activityColors'); }
    else if (slash.kind === 'theme') { this.panelOrigin = undefined; this.openThemeStudio(); }
    else if (slash.kind === 'themeBridge') { this.panelOrigin = undefined; await this.openThemeBridge(); }
    // Short routes into the canonical surfaces: no second editor and no second state anywhere.
    else if (slash.kind === 'chrome') { this.panelOrigin = undefined; this.focusConfigRow('uiChrome'); }
    else if (slash.kind === 'glyphs') {
      this.panelOrigin = undefined;
      this.settingsPanelState = {section: 'appearance', selectedIndex: this.promptConfiguration.glyphStyle === 'nerd' ? 0 : 1, glyphStyle: this.promptConfiguration.glyphStyle, onboarding: false};
    }
    else if (slash.kind === 'statusStrip') { this.panelOrigin = undefined; this.openStatusStrip(); }
    else if (slash.kind === 'configure') { this.panelOrigin = undefined; await this.openConfigure(slash.tool, command); }
    else if (slash.kind === 'integrations') { this.panelOrigin = undefined; await this.openIntegrations(); }
    else if (slash.kind === 'dotfiles') { this.panelOrigin = undefined; this.dotfiles = createDotfilesPanel(slash.source ?? '~/dotfiles'); if (slash.source) await this.handleDotfilesAction({kind: 'scan', source: slash.source}, this.dotfiles); this.render(); }
    else if (slash.kind === 'settings') {
      if (slash.destination === 'queue') this.openQueueSettingsPanel();
      else this.openSettingsPanel(slash.view);
    }
    else if (slash.kind === 'tools') { this.panelOrigin = undefined; this.startTools(); }
    else if (slash.kind === 'keepAwake') this.handleKeepAwakeSlash(command, slash);
    else if (slash.kind === 'setup') { this.panelOrigin = undefined; this.startSetup(slash.entry); }
    else if (slash.kind === 'transcript') { this.panelOrigin = undefined; this.startTranscriptSettings(); }
    else if (slash.kind === 'syntax') { this.panelOrigin = undefined; this.startSyntaxSettings(); }
    else if (slash.kind === 'layout') { this.panelOrigin = undefined; this.startLayoutSettings(); }
    else if (slash.kind === 'keyboard') { this.panelOrigin = undefined; await this.startKeyboard(); }
    else if (slash.kind === 'handoff') this.leaveForOrdinaryShell(slash.shell ?? this.promptConfiguration.shellBackend, command);
    else if (slash.kind === 'version') this.output.addFrontendInteraction(command, `${formatBuildIdentity(this.buildIdentity)}\nInstalled  ${installProvenanceLabel()}`, INFO);
    else if (slash.kind === 'update') void this.runUpdateCommand(command, slash.apply);
    else if (slash.kind === 'clear') await this.startFreshPresentation();
    else if (slash.kind === 'presets') this.startPresets();
    else if (slash.kind === 'resume') await this.openResumePicker();
    else if (slash.kind === 'sessions') await this.openSessionsView();
    else if (slash.kind === 'ai') this.openAi(command, slash.target);
    else if (slash.kind === 'mods') this.openMods(slash.provider);
    else if (slash.kind === 'worktrees') await this.openWorktrees();
    else if (slash.kind === 'workspace') {
      await this.applyWorkspaceEffect(this.workspace.perform(slash.focus ? `${slash.region}.focus` : `${slash.region}.toggle`, this.terminalDimensions().columns), command);
    }
    else if (slash.kind === 'keys') this.showWorkspaceKeys(command, slash.reload);
    else if (slash.kind === 'background') this.runBackgroundCommand(command);
    else if (slash.kind === 'github') await this.openGithub(slash.tab);
    else if (slash.kind === 'managedTarget') this.openManagedTarget(command, slash.provider, slash.action);
    else if (slash.kind === 'rawProvider') {
      if (slash.command) {this.editor.replaceText(slash.command); await this.submit(true);}
      else this.output.addFrontendInteraction(command, 'Native provider TUI: /nmsh raw claude [CLI args] or /nmsh raw codex [CLI args]. The command runs through your real shell.', INFO);
    }
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
    else if (slash.kind === 'ask') this.openAsk(slash.request, /^\/ask(?:\s|$)/u.test(command) ? '/ask' : '/btw');
    else if (slash.kind === 'providers') this.openProvidersOverview(slash.family);
    else if (slash.kind === 'llm') this.openUnderstandingPanel();
    else if (slash.kind === 'doctor') void this.openDoctor();
    else if (slash.kind === 'watch') this.handleWatch(command.trim(), slash.op, slash.arguments, slash.track === true);
    else if (slash.kind === 'queue') this.handleQueueCommand(command, slash.op);
    else if (slash.kind === 'rename') {
      if (this.sessionMode !== 'service' || !this.sessionId) this.output.addFrontendInteraction(command, 'Renaming needs a live session (this one runs in-process).', INFO);
      else {
        try {
          const info = await renameSession(socketPathFor(defaultRuntimeDir(process.env)), this.sessionId, slash.name);
          if (info) {
            this.noticeLabels.set(this.sessionId, info.name || info.signature || this.noticeLabels.get(this.sessionId) || '');
            this.noteSessionIdentity(info);
          }
          this.output.addFrontendInteraction(command, info ? `This session is ${info.name || info.signature || 'unnamed'}${info.name && info.signature ? ` (signature ${info.signature})` : ''}.` : 'The session service did not answer.', INFO);
        } catch { this.output.addFrontendInteraction(command, 'The session service did not answer; nothing changed.', ERROR); }
      }
    }
    else this.output.addFrontendInteraction(command, `Unknown NMSh command: ${(slash as any).input || command}`, ERROR);
  }

  private openPalette(): void {
    if (this.settingsPanelActive) return;
    const record = this.focusedCommandIndex === undefined ? this.output.recent(1) : this.output.recent(this.focusedCommandIndex + 1);
    const history = this.historySearchActive && this.historyQuery === this.editor.text.substring(HISTORY_SEARCH.length)
      ? this.historyResults[this.selectedSuggestion] : undefined;
    const historyItems: PaletteItem[] = history ? [{id: `history:pin:${history.id}`, label: 'Pin selected history command',
      detail: displaySafe(history.command), category: 'Transcript', action: {kind: 'pinHistory', id: history.id}},
      {id: `history:clip:${history.id}`, label: 'Keep selected history command as clip', detail: displaySafe(history.command),
        category: 'Transcript', action: {kind: 'keepHistoryClip', id: history.id}}] : [];
    const composerItems: PaletteItem[] = this.editor.text.trim() && !isSlashInput(this.editor.text)
      ? [{id: 'clip:keep-composer', label: 'Keep composer draft as clip', detail: 'Keep text in memory without changing the draft or executing it', category: 'Transcript', action: {kind: 'keepComposerClip'}}] : [];
    this.paletteState = createPalette([...historyItems, ...composerItems, ...paletteItems(), ...this.failureNavigationItems(), ...(record ? blockPaletteItems(record, this.blockOptions(record)) : [])]);
  }

  /** Newest-first indexes of completed commands that did not exit 0 (a nonzero exit or an interrupt is authoritative; output text is not). */
  private failedBlockIndexes(): number[] {
    return this.output.view().completed.flatMap((record, index) => record.exitCode !== 0 ? [index] : []);
  }

  private failureNavigationItems(): PaletteItem[] {
    const failed = this.failedBlockIndexes();
    if (!failed.length) return [];
    const count = `${failed.length} failed command${failed.length === 1 ? '' : 's'} in this transcript`;
    return [
      {id: 'failure:previous', label: 'Previous failed command', detail: `Older block that exited nonzero or was interrupted · ${count}`, category: 'Transcript', action: {kind: 'failure', direction: 'previous'}},
      {id: 'failure:next', label: 'Next failed command', detail: `Newer block that exited nonzero or was interrupted · ${count}`, category: 'Transcript', action: {kind: 'failure', direction: 'next'}},
    ];
  }

  /** Focus the previous (older) or next (newer) failed block, found by its command record and brought into view. */
  private goToFailure(direction: 'previous' | 'next'): void {
    const failed = this.failedBlockIndexes();
    const current = this.focusedCommandIndex;
    const target = direction === 'previous'
      ? failed.find(index => current === undefined || index > current)
      : [...failed].reverse().find(index => current !== undefined && index < current);
    if (target === undefined) {
      this.output.addFrontendInteraction('/failures', direction === 'previous' ? (failed.length ? 'No older failed command.' : 'No failed command in this transcript.') : (current === undefined ? 'Nothing is focused; use Previous failed command first.' : 'No newer failed command.'), INFO);
      return;
    }
    const record = this.output.view().completed[target];
    this.focusedLineIndex = undefined;
    this.focusedActivityId = undefined;
    this.focusedCommandIndex = target;
    if (record) this.revealBlock(record.startId);
  }

  /** Scroll so a block's first row is in view (the same placement find uses for a match). */
  private revealBlock(startId: number): void {
    const {columns, rows} = this.dimensions();
    const wrapped = this.output.wrapped(columns);
    const row = wrapped.findIndex(item => item.blockStartId === startId);
    if (row < 0) return;
    const height = this.planFrame(columns, rows).viewportRows;
    this.historyViewport.scrollLines(wrapped.length, height, revealStart(row, wrapped.length, height) - this.historyViewport.resolve(wrapped.length, height));
  }

  private openReferences(record: CompletedCommand): void {
    const references = findOutputReferences(record);
    if (!references.length) {
      this.output.addFrontendInteraction('/references', 'No files, links, commits or devices found in this output.', INFO);
      return;
    }
    this.paletteState = createPalette(referencePaletteItems(record.startId, references));
  }

  /** One action on one reference, resolved again from its block: nothing here runs a command. */
  private async runReference(startId: number, refId: string, verb: 'open' | 'copy' | 'stage'): Promise<void> {
    const say = (message: string, style = INFO) => { this.output.addFrontendInteraction('/references', message, style); this.render(); };
    const record = this.output.view().completed.find(item => item.startId === startId);
    const reference = record ? findOutputReferences(record).find(item => item.id === refId) : undefined;
    if (!record || !reference) return say('That output is no longer available.', ERROR);
    if (verb === 'copy') {
      const text = referenceCopyText(reference);
      try { await writeClipboard(text); this.noteClipboard(`Copied ${reference.kind === 'file' ? 'location' : reference.kind} · ${copyStats(text).characters.toLocaleString()} characters`, 'success'); }
      catch (error) { this.noteClipboard(clipboardFailure(error), 'error'); }
      return;
    }
    if (reference.kind === 'file') {
      const resolved = resolveLocation({path: reference.value, ...(reference.line ? {line: reference.line} : {}), ...(reference.column ? {column: reference.column} : {})}, record.historicalContext?.cwd ?? this.shellCwd);
      if (!resolved.ok) return say(resolved.reason, ERROR);
      const adapter = this.hostActions();
      await this.performHostAction(resolved.kind === 'directory' ? adapter.openDirectory(resolved.location.path) : adapter.openFile(resolved.location), say);
      return;
    }
    if (reference.kind === 'url') {
      const opener = selectOpener();
      if (!opener) return say(`No system URL opener is available here. The link is ${reference.value}`);
      try { spawn(opener, [reference.value], {detached: true, stdio: 'ignore'}).unref(); say(`Opened ${reference.value}.`); } catch { say(`Couldn't open ${reference.value}.`, ERROR); }
      return;
    }
    const argv = referenceFollowUp(reference);
    if (!argv) return say(reference.kind === 'device' ? `${reference.value} is not ready (${reference.state ?? 'unknown state'}), so there is no follow-up for it.` : 'There is nothing to stage for this.');
    // The composer is the person's: staged text never replaces what they have typed.
    if (this.editor.text.trim()) return say('The composer has text. Clear it (or run it) first; nothing was staged.');
    const quote = this.shellId === 'fish' ? fishQuote : posixQuote;
    this.editor.insert(argv.map(arg => (/^[\w@%+=:,./-]+$/u.test(arg) ? arg : quote(arg))).join(' '));
    this.clearBlockFocus();
    this.historyViewport.latest();
    say('Staged in the composer for you to review. Press Enter to run it.');
  }

  private outputScope() { return {session: `${this.sessionId ?? 'in-process'}:${this.shellId}`, generation: this.output.presentationGeneration}; }

  /** Reuse the workspace's ownership model, excluding only this selector and its own originating palette. */
  private outputNavigationAvailable(): boolean {
    return !this.stopped && !this.running && !this.startupPending && !this.shellSwitching && !this.preparingCommand && !this.frontendSuspended
      && !this.passthrough && !this.externalPassthrough && !this.queueReview && !this.summaryReview && this.pendingSummarySave === undefined && !this.queueCompose && !this.queueEdit && !this.ownershipLook
      && this.workspaceOwner(true) === 'COMPOSER';
  }

  private openOutputNavigation(intent: 'copy' | 'actions', includeStatus = this.promptConfiguration.copy.includeStatus, report?: ReportFormat): void {
    if (!this.outputNavigationAvailable()) return;
    const {columns, rows} = this.dimensions();
    const wrapped = this.output.wrapped(columns);
    const state = createOutputSelection(intent, this.outputScope(), this.output.recentShellCommands(), {
      anchor: captureOutputAnchor(wrapped, this.historyViewport, this.planFrame(columns, rows).viewportRows),
      draft: this.editor.text, cursor: this.editor.cursorIndex,
    });
    if (!state) { this.noteClipboard('No completed command output yet.', 'info'); return; }
    this.clearBlockFocus();
    this.selection = undefined;
    this.outputNavigation = {...state, includeStatus, report};
    this.revealOutputNavigation();
  }

  private revealOutputNavigation(): void {
    if (!this.outputNavigation) return;
    const {columns, rows} = this.dimensions();
    revealOutputSelection(this.output.wrapped(columns), this.historyViewport, this.planFrame(columns, rows).viewportRows, this.outputNavigation.focusedId);
  }

  /** False means there is no valid navigation left. Ownership/generation loss never restores stale state. */
  private reconcileOutputNavigation(): boolean {
    const state = this.outputNavigation;
    if (!state) return false;
    if (this.outputNavigationAvailable() && validateOutputSelection(state, this.outputScope(), this.output.recentShellCommands())) return true;
    const vanished = this.outputNavigationAvailable() && state.scope.session === this.outputScope().session
      && state.scope.generation === this.outputScope().generation;
    this.endOutputNavigation(false);
    if (vanished) this.noteClipboard('Selected output is no longer available.', 'info');
    return false;
  }

  private endOutputNavigation(restore: boolean): void {
    const state = this.outputNavigation;
    if (!state) return;
    if (this.blockPaletteReturn?.selection === state) {
      if (this.blockPaletteContext?.palette === this.blockPaletteReturn.palette) this.blockPaletteContext = undefined;
      if (this.paletteState === this.blockPaletteReturn.palette) this.paletteState = undefined;
      this.blockPaletteReturn = undefined;
    }
    this.outputNavigation = undefined;
    if (restore && this.outputNavigationAvailable() && state.scope.session === this.outputScope().session
      && state.scope.generation === this.outputScope().generation) {
      const {columns, rows} = this.dimensions();
      restoreOutputAnchor(this.output.wrapped(columns), this.historyViewport, this.planFrame(columns, rows).viewportRows, state.returnTo.anchor);
      // The editor, including paste atoms and its cursor, was never modified. Never overwrite a newer draft.
    }
  }

  private handleOutputNavigationKey(key: Key): boolean {
    const state = this.outputNavigation;
    if (!state) return false;
    if (key.kind === 'escape' || key.kind === 'interrupt') { this.endOutputNavigation(true); this.render(); return true; }
    if (key.kind === 'up' || key.kind === 'down') {
      moveOutputSelection(state, key.kind); this.revealOutputNavigation(); this.render(); return true;
    }
    if (key.kind === 'enter') { void this.activateOutputNavigation(); return true; }
    // Pointer hit testing must use the displayed viewport; restoring here would retarget clicks/drags.
    if (['mouseMove', 'mouseClick', 'mouseDrag', 'mouseRelease', 'wheelUp', 'wheelDown', 'pageUp', 'pageDown'].includes(key.kind)) return false;
    // Letters and normal editor keys retain their composer meaning.
    this.endOutputNavigation(true);
    return false;
  }

  private async activateOutputNavigation(): Promise<void> {
    if (!this.reconcileOutputNavigation()) return;
    const state = this.outputNavigation!;
    if (state.busy) return;
    const record = this.output.recentShellCommands().find(record => record.startId === state.focusedId);
    if (!record) { this.endOutputNavigation(false); return; }
    if (state.intent === 'actions') { this.openBlockPalette(record.startId); this.render(); return; }
    if (state.report) { this.endOutputNavigation(false); this.startReport([record], state.report); return; }
    state.busy = true;
    const copied = await this.copyRecords([record], state.includeStatus);
    if (this.outputNavigation === state) {
      state.busy = false;
      if (this.reconcileOutputNavigation() && copied) this.endOutputNavigation(true);
    }
    this.render();
  }

  private clearBlockFocus(): void {
    this.focusedCommandIndex = undefined;
    this.focusedLineIndex = undefined;
    this.focusedActivityId = undefined;
  }

  private openBlockPalette(startId: number): void {
    if (this.running || this.settingsPanelActive) return;
    const record = this.output.view().completed.find(item => item.startId === startId);
    if (record && !record.frontend) {
      this.paletteState = createPalette(blockPaletteItems(record, this.blockOptions(record)));
      this.blockPaletteContext = {palette: this.paletteState, scope: this.outputScope()};
      if (this.outputNavigation?.intent === 'actions' && this.outputNavigation.focusedId === startId) {
        this.blockPaletteReturn = {selection: this.outputNavigation, palette: this.paletteState};
      }
    }
  }

  private async runBlockAction(startId: number, action: BlockActionId): Promise<void> {
    if (this.running || this.stopped) return;
    const records = this.output.view().completed;
    const index = records.findIndex(item => item.startId === startId);
    const record = records[index];
    if (!record || !blockPaletteItems(record, this.blockOptions(record)).some(item => item.action.kind === 'block' && item.action.id === action)) return;
    // Selection itself never runs actions. An explicit choice ends it before any editor/program handoff.
    this.endOutputNavigation(false);
    const includeStatus = this.promptConfiguration.copy.includeStatus;
    if (action === 'copyOutput') await this.copyRecords([record], includeStatus);
    else if (action === 'copyReport') this.startReport([record], 'markdown');
    else if (action === 'compare') this.openCompare(record);
    else if (action === 'references') this.openReferences(record);
    else if (action === 'pin') this.pinCommand(record.command, record.historicalContext?.cwd ?? this.shellCwd);
    else if (action === 'clipCommand' || action === 'clipOutput') this.keepClip(action === 'clipCommand' ? record.command : recordCopyText(record, false),
      action === 'clipCommand' ? 'command' : 'output', record.historicalContext?.cwd, null);
    else if (action === 'copyBoth') await this.copyRecords([record], includeStatus, record.command);
    else if (action === 'copyCommand') {
      // The command text only: completion status never applies here.
      try { await writeClipboard(record.command); this.noteClipboard(`Copied command · ${copyStats(record.command).characters.toLocaleString()} characters`, 'success'); }
      catch (error) { this.noteClipboard(clipboardFailure(error), 'error'); }
    } else if (action === 'fold') this.output.toggleExpanded(index);
    else if (action === 'view') this.openOutputViewer(record);
    else if (action === 'details') this.output.toggleSemanticDetails(record.startId);
    else if (action === 'pager') await this.openBlockInPager(record);
    else if (action === 'explain') { this.explainBlock = record.startId; this.openAsk('why did this fail'); }
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
    if (item.action.kind === 'block' && this.blockPaletteContext) {
      const context = this.blockPaletteContext;
      this.blockPaletteContext = undefined;
      if (context.scope.session !== this.outputScope().session || context.scope.generation !== this.outputScope().generation) {
        if (this.paletteState === context.palette) this.paletteState = undefined;
        this.endOutputNavigation(false);
        this.noteClipboard('Selected output is no longer available.', 'info');
        return;
      }
    }
    if (item.action.kind === 'block' && this.blockPaletteReturn) {
      if (!this.outputNavigationAvailable() || !this.reconcileOutputNavigation()) return;
      this.endOutputNavigation(false);
    }
    this.paletteRecent = [item.id, ...this.paletteRecent.filter(id => id !== item.id)].slice(0, 20);
    const action = item.action;
    const config = structuredClone(this.promptConfiguration);
    switch (action.kind) {
      case 'block':
        await this.runBlockAction(action.startId, action.id);
        break;
      case 'reference':
        await this.runReference(action.startId, action.refId, action.verb);
        break;
      case 'failure':
        this.goToFailure(action.direction);
        break;
      case 'pinHistory': {
        const entry = this.historyResults.find(entry => entry.id === action.id);
        if (entry) this.pinCommand(entry.command, entry.cwd ?? this.shellCwd);
        break;
      }
      case 'keepComposerClip':
        if (!this.running && !isSlashInput(this.editor.text)) this.keepClip(this.editor.text, 'composer', this.shellCwd);
        break;
      case 'keepHistoryClip': {
        const entry = this.historyResults.find(entry => entry.id === action.id);
        if (entry) this.keepClip(entry.command, 'history', entry.cwd, entry.session ?? null);
        break;
      }
      case 'clip': {
        if (action.verb === 'remove') { this.clips.remove(action.id); this.openClips(); break; }
        const clip = this.clips.get(action.id);
        if (!clip || this.running) break;
        if (this.editor.text.trim()) { this.output.addFrontendInteraction('/clips', 'The composer has text. Clear it before staging a clip.', INFO); break; }
        const analysis = analyzePaste(clip.text);
        const batch = this.batchAvailable(clip.text);
        this.pastePreview = {text: clip.text, analysis, batch};
        this.pasteReview = createPasteReview(clip.text, analysis, batch, this.shellId);
        break;
      }
      case 'clearClips':
        this.clips.clear(); this.openClips();
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

  private async submit(realShell = false, skipInstallCheck = false, fromComposer = false): Promise<void> {
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
    // Background tasks: only for a command typed and submitted from an idle composer, never queued, startup or program
    // input. A family the person set to Always runs in the background; with suggestions on, a recognized command asks.
    if (fromComposer && this.backgroundAvailable() && !this.running && !this.startupPending && !this.passthrough && !this.externalPassthrough) {
      const decision = this.background.decide(command);
      if (decision.action === 'background') { this.startBackgroundTask(command, decision.classification.family); this.render(); return; }
      if (decision.action === 'suggest') { this.background.suggestion = {command, classification: decision.classification}; this.render(); return; }
    }

    const contextAtSubmission = this.context;
    this.effects.cancel();
    this.commandModes.reset();
    this.inputState = undefined;
    this.runningDraft = undefined;
    const startId = this.output.beginCommand(command, this.formatCommandAnsi(command, null), (mode) => {
      if (mode === 'PASSTHROUGH' && !this.passthrough && !this.startupPending) {
        this.cancelPresentation();
        this.passthrough = true;
        this.noteForeignScreen();
        this.handOverTerminal();
      }
      this.render();
    }, this.historicalContext(this.shellCwd, contextAtSubmission, command));
    this.tapActivityObserver.reset(this.output.activeOutputStartId ?? startId);
    this.output.setActiveActivities([]);
    this.formatCommandAnsi(command, startId);
    const startedAt = Date.now();
    this.running = {command, startedAt, interrupted: false, cleared: false, startId, cwd: this.shellCwd, awaitingExec: true};
    // Command Transfer: the command already went to the shell; the sweep only presents the handoff.
    if (!this.replaying && !this.askState) this.transitions.launch(startedAt);
    void this.journal?.flush().catch(() => {
      this.output.addFrontendInteraction('/resume', 'Could not persist the submitted command.', ERROR);
    });
    this.activityAnimationNow = startedAt;

    // Initial static heuristic, but dynamic can override
    this.passthrough = !this.startupPending && shouldPassthrough(command);
    if (this.passthrough) {
      this.noteForeignScreen();
      this.handOverTerminal();
    }
    this.session.submit(shellSubmission(command, this.shellId));
    // After the command is on its way: one sweep acknowledging the submission (never delays it).
    if (!this.passthrough) this.startSweep('prompt', 'vivid');
    this.render();
  }

  private async saveAppearance(): Promise<void> {
    const hub = this.appearanceHub;
    const state = hub?.host;
    if (!hub || !state || !this.host.integration) return;
    hub.hostDirty = false;
    this.output.addHistoryLine(`${INFO}✻ Saving appearance settings...${RESET}`);
    this.render();

    const result = await this.host.integration.saveAppearance({
      opacity: state.opacity,
      blurMode: BLUR_MODES[state.blurModeIndex],
      blurStrength: state.blurStrength
    });

    if (result.success) {
      this.output.addHistoryLine(`${SUCCESS}✻ Saved to ${result.fragmentPath}${RESET}`);
      this.output.addHistoryLine(`${INFO}✻ Host config updated: ${result.hostPath}${RESET}`);
      if (state.opacity < 1) {
        this.output.addHistoryLine(`${INFO}✻ ${this.host.integration.appearanceRestart}${RESET}`);
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
    this.returnFromPanel();

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

  /** /appearance: the visual hub. NMSh rows always work; host window rows edit opacity/blur only where the host supports it. */
  private async startAppearance(): Promise<void> {
    let host: AppearanceState | undefined;
    if (this.host.capabilities.appearanceIntegration && this.host.integration) {
      const settings = await this.host.integration.readAppearance();
      host = {opacity: settings.opacity, blurModeIndex: Math.max(0, BLUR_MODES.indexOf(settings.blurMode)), blurStrength: settings.blurStrength, selectedIndex: 0};
    }
    this.appearanceHub = createAppearanceHub(this.host.name, host, this.host.appearanceGuidance);
    this.render();
  }

  /** Whether a block's Copy control currently confirms a copy. */
  private controlOptions(startId: number | undefined): {copied: boolean; safe: boolean} {
    const copied = this.copiedBlock;
    return {copied: Boolean(copied && copied.startId === startId && Date.now() < copied.until), safe: getCurrentGlyphMode() === 'safe'};
  }

  /** Controls in muted text; a confirmed copy in the success color (words carry it under NO_COLOR). */
  private styledControls(controls: BlockControls, width?: number): string {
    const text = width === undefined ? controls.suffix : controls.suffix.slice(-width);
    return `${SUBTLE}${text.replace(/\[[✓+] Copied\]/u, match => `${SUCCESS}${match}${SUBTLE}`)}${RESET}`;
  }

  /** The sticky row's controls for a completed block (none for a running one, or when NMSh is busy with a panel). */
  private stickyControls(startId: number, columns: number): {controls: BlockControls; width: number} | undefined {
    if (this.running) return undefined;
    if (!this.output.view().completed.some(record => record.startId === startId)) return undefined;
    const width = stickyControlsWidth(columns);
    const controls = width ? blockControlsLayout(columns - width, columns, this.controlOptions(startId)) : undefined;
    return controls ? {controls, width} : undefined;
  }

  /** A block's direct Copy: that command's full stored output (folded lines too), with the Copy settings. */
  private async copyBlock(startId: number): Promise<void> {
    if (this.running || this.stopped) return;
    const record = this.output.view().completed.find(item => item.startId === startId);
    if (!record) return; // A clear or restore must never act on stale coordinates.
    if (!await this.copyRecords([record], this.promptConfiguration.copy.includeStatus)) return;
    // Only after the clipboard accepted it: Copy reads "Copied" for a moment, in place.
    this.copiedBlock = {startId, until: Date.now() + 1600};
    if (this.copiedBlockTimer) clearTimeout(this.copiedBlockTimer);
    this.copiedBlockTimer = setTimeout(() => { this.copiedBlock = undefined; this.copiedBlockTimer = undefined; if (!this.stopped) this.render(); }, 1600);
    this.copiedBlockTimer.unref?.();
    this.render();
  }

  /**
   * Copy as Report. A report is made to be shared, and pattern-based redaction cannot promise to catch everything,
   * so every report goes through its review (Enter copies): it never reaches the clipboard unseen. Oldest first.
   */
  private startReport(records: readonly CompletedCommand[], format: ReportFormat): void {
    this.panelOrigin = undefined;
    this.reportReview = createReportReview(records, {...DEFAULT_REPORT_OPTIONS, format, home: homedir()}, Boolean(configuredEditor(process.env)));
    this.render();
  }

  /** The report's clipboard write: the same tool, feedback and Auto-expand rule as every other copy. */
  private async copyReportText(text: string, records: readonly CompletedCommand[]): Promise<void> {
    try { await writeClipboard(text); }
    catch (error) { this.noteClipboard(clipboardFailure(error), 'error'); return; }
    if (this.promptConfiguration.copy.autoExpand) this.output.expandBlocks(records.filter(record => record.output.trim()).map(record => record.startId));
    const stats = copyStats(text);
    this.noteClipboard(`Copied report · ${records.length} command${records.length === 1 ? '' : 's'} · ${stats.characters.toLocaleString()} characters`, 'success');
  }

  /** e in the report review: the text in your editor (a private temporary file), back into the review when it exits. */
  private async editReport(review: ReportReviewState): Promise<void> {
    const editor = configuredEditor(process.env);
    if (!editor || !this.hostTerminalFree()) return;
    const directory = mkdtempSync(join(tmpdir(), 'nmsh-report-'));
    const file = join(directory, review.options.format === 'markdown' ? 'report.md' : 'report.txt');
    try {
      writeFileSync(file, review.text, {mode: 0o600});
      const code = await this.withHostTerminal(() => new Promise<number | null>(done => {
        const child = spawn(editor[0]!, [...editor.slice(1), file], {stdio: 'inherit'});
        child.once('error', () => done(null));
        child.once('close', exit => done(exit));
      }));
      if (code === 0 && this.reportReview === review) applyReportEdit(review, readFileSync(file, 'utf8'));
    } catch { /* The review keeps the text it had. */ }
    finally { rmSync(directory, {recursive: true, force: true}); this.render(); }
  }

  /** Which conditional block actions this block offers. */
  private blockOptions(record: CompletedCommand): {details: boolean} {
    return {details: Boolean(this.output.semanticFor(record)?.items.length)};
  }

  private viewerLook(): ViewerLook {
    return {syntax: this.syntaxSgr, hyperlinks: this.host.capabilities.hyperlinks};
  }

  /**
   * /view: a completed output by its /copy number (the latest when no target is given), or a file relative to the
   * shell's directory. The file is read asynchronously and read-only; a failure is reported in the transcript.
   */
  private openViewer(target: string, command: string): void {
    this.viewerLoad?.abort();
    this.viewerLoad = undefined;
    if (!target || /^[1-9]\d{0,2}$/u.test(target)) {
      const number = target ? Number(target) : 1;
      const record = this.output.recentShellCommands()[number - 1];
      if (!record) {
        this.output.addFrontendInteraction(command, target ? `No completed command output at ${number}.` : 'No completed output yet. /view <file> opens a file.', target ? ERROR : INFO);
        return;
      }
      this.openOutputViewer(record);
      return;
    }
    const load = new AbortController();
    this.viewerLoad = load;
    void loadFileDocument(target, this.shellCwd, {signal: load.signal}).then(result => {
      if (this.viewerLoad !== load || this.stopped) return;
      this.viewerLoad = undefined;
      if (!result.ok) { this.output.addFrontendInteraction(command, result.reason, ERROR); this.render(); return; }
      // Another panel opened while the file was read: it keeps the keys; the file is not opened over it.
      if (this.hasModalInput()) return;
      this.panelOrigin = undefined;
      this.viewer = createViewer(result.document);
      this.render();
    });
  }

  /**
   * /edit: open one small text file in NMSh's editor, or say in the transcript why it cannot be edited (refused files
   * stay readable in /view). `returnTo` is the viewer it was opened from; it is reopened if the file cannot be edited.
   */
  private openTextEditor(target: string, command: string, returnTo?: ViewerState): void {
    void openForEdit(target, this.shellCwd).then(result => {
      if (this.stopped) return;
      if (!result.ok) {
        if (returnTo && !this.hasModalInput()) { returnTo.note = result.reason; this.viewer = returnTo; }
        else this.output.addFrontendInteraction(command, result.reason, ERROR);
        this.render();
        return;
      }
      if (this.hasModalInput()) return;
      this.panelOrigin = undefined;
      this.textEditor = createEditor(result.file);
      this.render();
    });
  }

  /** The editor's requests that touch the disk or the clipboard; the panel shows the outcome. */
  private runEditorAction(editor: EditorState, action: EditorAction): void {
    if (action.kind === 'close') { this.textEditor = undefined; this.returnFromPanel(); return; }
    if (action.kind === 'copy') {
      void this.copyText(action.text, 'Copied').then(note => { if (note && this.textEditor === editor) { editor.note = {text: note, tone: 'success'}; this.render(); } });
      return;
    }
    editor.busy = true;
    if (action.kind === 'reload') {
      void openForEdit(editor.file.path, this.shellCwd).then(result => {
        editor.busy = false;
        if (this.textEditor !== editor) return;
        if (!result.ok) { editor.note = {text: result.reason, tone: 'error'}; this.render(); return; }
        this.textEditor = {...createEditor(result.file), note: {text: 'Reloaded from disk; your changes were discarded.', tone: 'info'}};
        this.render();
      });
      return;
    }
    const lines = [...editor.buffer.lines];
    void saveFile(editor.file, lines, {...(action.force ? {force: true} : {})}).then(result => {
      editor.busy = false;
      if (this.textEditor !== editor) return;
      if (result.ok) {
        editor.file = result.file;
        // Only what was written is clean: typing during the save stays unsaved.
        if (editor.buffer.lines.length === lines.length && editor.buffer.lines.every((line, index) => line === lines[index])) editor.buffer.markSaved();
        if (action.thenClose) { this.textEditor = undefined; this.returnFromPanel(); }
        else editor.note = {text: `Saved ${editor.file.title}.`, tone: 'success'};
      } else if (result.conflict) {
        editor.dialog = {kind: 'conflict', focus: 0, conflict: result.conflict, reason: result.reason, ...(action.thenClose ? {thenClose: true} : {})};
      } else editor.note = {text: `${result.reason} Your text is still here.`, tone: 'error'};
      this.render();
    });
  }

  /** View output: the record's stored output, numbered as /copy numbers it. */
  private openOutputViewer(record: CompletedCommand): void {
    const number = this.output.recentShellCommands().indexOf(record) + 1;
    this.panelOrigin = undefined;
    // The text /copy copies (tabs as the program wrote them), without the optional completion status.
    this.viewer = createViewer(outputDocument({command: record.command, output: recordCopyText(record, false), exitCode: record.exitCode}, Math.max(1, number)));
    this.render();
  }

  /** Compare output…: straight to the difference when the other side is known, otherwise choose it (previous run first). */
  private openCompare(base: CompletedCommand, partner?: CompletedCommand): void {
    this.panelOrigin = undefined;
    this.comparePanel = createComparePanel(base, this.output.recentShellCommands(), partner);
    this.render();
  }

  /** A text copy that is not command output (a diff, a comparison report): the same tool and feedback. */
  private async copyText(text: string, what: string, caution = ''): Promise<string | undefined> {
    try { await writeClipboard(text); }
    catch (error) { const note = clipboardFailure(error); this.noteClipboard(note, 'error'); return note; }
    const stats = copyStats(text);
    const note = `${what} · ${stats.lines.toLocaleString()} line${stats.lines === 1 ? '' : 's'} · ${stats.characters.toLocaleString()} characters${caution}`;
    this.noteClipboard(note, 'success');
    return note;
  }

  /** /copy and /cp: one parser, the configured default, and the same clipboard write as the picker and block Copy. */
  private async copySlash(command: string, args: string): Promise<void> {
    if (!this.outputNavigationAvailable()) return;
    const parsed = parseCopyArgs(args);
    if (!parsed.ok) { this.output.addFrontendInteraction(command.trim(), parsed.error, ERROR); return; }
    const {status, report, content} = parsed.request;
    // --semantic and --both copy directly: without a selection they take the latest output, whatever the copy mode.
    const selector = content === 'semantic' || content === 'both' ? (parsed.request.selector.kind === 'default' ? {kind: 'latest' as const, count: 1} : parsed.request.selector) : parsed.request.selector;
    const includeStatus = status ?? this.promptConfiguration.copy.includeStatus;
    if (selector.kind === 'picker' || (selector.kind === 'default' && this.promptConfiguration.copy.mode === 'picker')) {
      this.panelOrigin = undefined;
      this.copyPicker = createCopyPicker(this.output.recentShellCommands(), includeStatus);
      this.copyPickerReport = report;
      return;
    }
    if (selector.kind === 'default' && this.promptConfiguration.copy.mode === 'navigate') {
      this.openOutputNavigation('copy', includeStatus, report);
      return;
    }
    const resolved = resolveCopySelection(selector.kind === 'default' ? {kind: 'latest', count: 1} : selector, this.output.recentShellCommands());
    if (!resolved.ok) { this.output.addFrontendInteraction(command.trim(), resolved.error, ERROR); return; }
    if (report) { this.startReport(resolved.records, report); return; }
    await this.copyRecords(resolved.records, includeStatus, undefined, parsed.request.content);
  }

  /**
   * The one clipboard write for command output (/copy, /cp, the picker, block Copy and Copy output): the records'
   * stored output, oldest first, each followed by its recorded completion status when asked. Nothing to copy leaves
   * the clipboard as it was. Feedback is a brief note above the composer, given only after the write succeeded.
   */
  private async copyRecords(records: readonly CompletedCommand[], includeStatus: boolean, before?: string, content: CopyContent = 'raw'): Promise<boolean> {
    const scope = this.outputScope();
    // --semantic / --both: the reading as text (raw for a record without one, said in the note); raw is the default.
    const semantic = content === 'raw' ? undefined : semanticCopyPayload(records, content, includeStatus, record => this.output.semanticFor(record));
    const payload = [before ?? '', semantic ? semantic.payload : copySelectionPayload(records, includeStatus)].filter(Boolean).join('\n');
    if (!payload.trim()) {
      const what = records.length === 1 ? `${records[0]!.command.split('\n')[0]!.slice(0, 60)} printed no output` : 'the selected commands printed no output';
      this.noteClipboard(`Nothing to copy: ${what}; the clipboard is unchanged`, 'info');
      return false;
    }
    try { await writeClipboard(payload); }
    catch (error) { this.noteClipboard(clipboardFailure(error), 'error'); return false; }
    // Folding is presentation and copying reads stored data: only the explicit setting connects them, and only
    // for the blocks whose text was copied (a silent block copied for nothing stays as it was).
    if (this.promptConfiguration.copy.autoExpand && scope.session === this.outputScope().session && scope.generation === this.outputScope().generation) {
      const live = this.output.recentShellCommands();
      this.output.expandBlocks(records.filter(record => live.includes(record) && recordCopyText(record, includeStatus)).map(record => record.startId));
    }
    const fallback = semantic?.unavailable ? ` · ${semantic.unavailable === records.length ? 'semantic unavailable, copied raw' : `${semantic.unavailable} without a semantic reading copied raw`}` : '';
    this.noteClipboard(`${copiedNote(records.length, copyStats(payload), includeStatus)}${content === 'semantic' && !fallback ? ' · semantic' : content === 'both' && !fallback ? ' · raw and semantic' : ''}${fallback}`, 'success');
    return true;
  }

  /** One transient clipboard note in the notice slot above the composer (never a transcript line). */
  private noteClipboard(text: string, tone: 'success' | 'info' | 'error'): void {
    const ms = tone === 'error' ? 6000 : 2600;
    this.clipboardNote = {text, tone, until: Date.now() + ms};
    if (this.clipboardNoteTimer) clearTimeout(this.clipboardNoteTimer);
    this.clipboardNoteTimer = setTimeout(() => { this.clipboardNote = undefined; this.clipboardNoteTimer = undefined; if (!this.stopped) this.render(); }, ms);
    this.clipboardNoteTimer.unref?.();
    this.render();
  }

  private clipboardRows(columns: number): string[] {
    if (this.outputNavigation && !this.paletteState) {
      const intent = this.outputNavigation.intent === 'copy' ? 'Copy output' : 'Actions';
      const enter = this.outputNavigation.intent === 'copy' ? this.outputNavigation.report ? 'review report' : 'copy' : 'actions';
      return [...renderControlRows([[intent, ''], ['↑↓', 'output'], ['Enter', enter], ['Esc', 'return']], Math.max(1, columns)),
        ...(this.clipboardNote && Date.now() <= this.clipboardNote.until ? [displaySafe(this.clipboardNote.text)] : [])]
        .map(row => truncateAnsi(row, columns));
    }
    const note = this.clipboardNote;
    if (!note || this.passthrough || Date.now() > note.until) return [];
    const glyph = note.tone === 'success' ? `${SUCCESS}${GLYPHS.success}` : note.tone === 'error' ? `${ERROR}${GLYPHS.failure}` : `${SUBTLE}·`;
    // Notes can name a command: drawn as text, never interpreted.
    return [truncateAnsi(`${glyph}${RESET} ${SECONDARY}${displaySafe(note.text)}${RESET}`, columns)];
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
    this.queueReview = undefined;
    this.summaryReview = undefined;
    this.pendingSummarySave = undefined;
    this.queueHistoryPanel = undefined;
    this.output.clearPresentation();
    this.pendingQueuePause = undefined;
    this.presentationOwned = true;
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

  /** Refresh live facts without moving the person's selection, query or composer. */
  private refreshSessionsView(live: SessionInfo[]): boolean {
    const browser = this.resumeBrowser;
    if (!browser?.liveOnly) return false;
    const selected = resumeSelection(browser);
    browser.live = live;
    const visible = visibleLiveSessions(browser);
    const index = selected?.kind === 'live' ? visible.findIndex(session => session.id === selected.session.id) : -1;
    browser.selectedIndex = index >= 0 ? index : Math.max(0, Math.min(browser.selectedIndex, visible.length - 1));
    if (browser.confirmKill) {
      const target = live.find(session => session.id === browser.confirmKill);
      if (!target || target.state !== 'detached' || target.id === browser.currentId) browser.confirmKill = undefined;
    }
    return true;
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
      const color = row.state === 'failed' ? ERROR : row.state === 'input' || row.state === 'inputLikely' ? ATTENTION : row.state === 'attention' ? ACCENT : row.state === 'completed' ? SUCCESS : SECONDARY;
      const who = row.agent ? `${agentColor(row.agent.color)}${safe ? row.agent.safeGlyph : row.agent.glyph} ${row.agent.short}${RESET} ` : '';
      out.push(truncateAnsi(`${selected ? `${ACCENT}›` : ' '} ${marker} ${PRIMARY}${(row.current ? 'this' : `#${row.ordinal}`).padEnd(5)}${RESET}${SECONDARY}${row.shell.padEnd(5)}${RESET} `
        + `${color}${row.stateLabel.padEnd(18)}${RESET}${who}${focusForeground(selected)}${row.summary}${RESET}`, columns));
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
    this.queueReview = undefined;
    this.summaryReview = undefined;
    this.pendingSummarySave = undefined;
    this.queueHistoryPanel = undefined;
    this.output.restoreTranscript(restored.transcript);
    this.presentationOwned = false;
    this.pendingQueuePause = undefined;
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


  private pendingAutoUpdate?: ReleaseInfo;
  private autoUpdateTimer?: NodeJS.Timeout;
  private preparingUpdate?: string;

  private updateFrequencyInEffect(): UpdateCheckFrequency {
    const {updateMode, updateFrequency} = this.promptConfiguration;
    return updateMode === 'off' || updatesDisabledByEnvironment() ? 'off' : updateFrequency;
  }

  /**
   * Quiet, due-gated discovery. Notify only: one line per newly seen release.
   * Automatic: remember the release and prepare it at the next idle point.
   */
  private async quietUpdateCheck(): Promise<void> {
    const result = await checkForUpdate(this.buildIdentity.version, this.updateFrequencyInEffect()).catch(() => ({announce: false} as const));
    if (this.stopped) return;
    if (this.promptConfiguration.updateMode === 'automatic' && this.updateFrequencyInEffect() !== 'off') {
      const state = loadUpdateState();
      const version = 'release' in result && result.release ? result.release.version : state.latestVersion;
      const settled = version !== undefined && (state.installedVersion === version || state.failed?.version === version || state.skipped?.version === version);
      if (version && compareVersions(version, this.buildIdentity.version) > 0 && !settled) {
        this.pendingAutoUpdate = ('release' in result && result.release) || {version, tag: `v${version}`, summary: [],
          url: `https://github.com/raiseCatError/notMyShell/releases/tag/v${version}`};
        this.scheduleAutoUpdate(5_000);
      }
      return;
    }
    // Notify: once per newly seen stable release (never when Off, never without one).
    if (!('release' in result) || !result.release || !result.announce) return;
    await this.announceUpdate(result.release);
  }

  /** How this copy was installed, from facts only (Homebrew metadata, a verified official checkout), with a short bound. */
  private async updateProvenance(): Promise<UpdateProvenance> {
    try {
      const install = await detectInstall(installRoot(), quickRunner);
      return install.kind === 'homebrew' ? 'homebrew' : install.kind === 'checkout' ? 'checkout' : 'manual';
    } catch { return 'manual'; }
  }

  /** The update notice in the transcript: amber accent, the versions, short notes and how to update this installation. */
  private async announceUpdate(release: ReleaseInfo, ready = false): Promise<void> {
    const provenance = ready ? 'manual' : await this.updateProvenance();
    if (this.stopped) return;
    for (const row of renderUpdateNotice({installed: this.buildIdentity.version, available: release.version, summary: release.summary, url: release.url, provenance, ready})) {
      this.output.addHistoryLine(row);
    }
    this.render();
  }

  private scheduleAutoUpdate(delay: number): void {
    if (this.autoUpdateTimer || this.stopped || !this.pendingAutoUpdate) return;
    this.autoUpdateTimer = setTimeout(() => { this.autoUpdateTimer = undefined; void this.autoUpdateTick(); }, delay);
    this.autoUpdateTimer.unref?.();
  }

  /** Starts the build only at a calm prompt NMSh owns; otherwise waits for the next tick. */
  private async autoUpdateTick(): Promise<void> {
    const release = this.pendingAutoUpdate;
    if (!release || this.stopped || this.promptConfiguration.updateMode !== 'automatic') { this.pendingAutoUpdate = undefined; return; }
    if (this.updateInProgress || !this.idleEligible()) { this.scheduleAutoUpdate(30_000); return; }
    this.pendingAutoUpdate = undefined;
    this.updateInProgress = true;
    this.preparingUpdate = release.version;
    this.render();
    try {
      const outcome = await prepareAutomaticUpdate(release);
      if (this.stopped || !outcome.announce) return;
      // Ready: a restart is all that is left. Skipped (Homebrew, a manual copy): the notice says how to update it.
      if (outcome.kind === 'ready') await this.announceUpdate(release, true);
      else if (outcome.kind === 'skipped') await this.announceUpdate(release);
      else this.output.addHistoryLine(`${INFO}Automatic update to ${outcome.version} did not complete and was rolled back · Run /update for details${RESET}`);
    } catch { /* an automatic update never crashes the session */ } finally {
      this.updateInProgress = false;
      this.preparingUpdate = undefined;
      if (!this.stopped) this.render();
    }
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
      if (readyVersion(loadUpdateState(), current) === release.version) {
        return reply(`Running      ${current}\nInstalled    ${release.version}\nStatus       Restart NMSh to use it`, SUCCESS);
      }
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
      if (result.ok) { recordInstalled(release.version); this.milestoneEffect(); }
      this.output.addHistoryLine(result.ok
        ? `${SUCCESS}NMSh ${release.version} is ready ✓  This session is still running ${current}. Restart NMSh when convenient to use the new version.${RESET}`
        : `${ERROR}The update did not complete; the lines above say what happened.${RESET}`);
    } finally {
      this.updateInProgress = false;
      this.render();
    }
  }

  private updateStatusRows(): Array<{label: string; value: string; tone?: 'success' | 'warning' | 'muted'}> {
    const running = this.buildIdentity.version;
    const {updateMode, updateFrequency} = this.promptConfiguration;
    const state = loadUpdateState();
    const latest = state.latestVersion;
    const newer = latest !== undefined && compareVersions(latest, running) > 0;
    const ready = readyVersion(state, running);
    let status: {value: string; tone?: 'success' | 'warning' | 'muted'};
    if (this.preparingUpdate) status = {value: `Preparing ${running} → ${this.preparingUpdate}`};
    else if (ready) status = {value: `Ready · restart NMSh to use ${ready}`, tone: 'success'};
    else if (state.failed && latest === state.failed.version && newer) status = {value: 'Last automatic update failed · run /update', tone: 'warning'};
    else if (state.skipped && latest === state.skipped.version && newer) status = {value: 'Automatic update skipped · run /update for details', tone: 'warning'};
    else if (newer) status = {value: 'Update available', tone: 'warning'};
    else if (latest) status = {value: 'Up to date', tone: 'success'};
    else status = {value: updateMode === 'off' ? 'Not checking' : 'Check pending', tone: 'muted'};
    const ago = state.lastCheck === undefined ? undefined : (() => {
      const minutes = Math.max(0, Math.round((Date.now() - state.lastCheck) / 60_000));
      return minutes < 1 ? 'just now' : minutes < 90 ? `${minutes}m ago` : minutes < 2880 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
    })();
    return [
      {label: 'Running version', value: running},
      ...(latest ? [{label: 'Latest release', value: latest}] : []),
      {label: 'Mode', value: updateMode === 'automatic' ? 'Automatic' : updateMode === 'notify' ? 'Notify only' : 'Off'},
      ...(updateMode === 'off' ? [] : [{label: 'Check frequency', value: updateFrequency === 'daily' ? 'Daily' : 'Weekly'}]),
      {label: 'State', ...status},
      ...(ago ? [{label: 'Last checked', value: ago}] : []),
    ];
  }

  private showHelp(command: string): void {
    // Authored links are stored as authored cells and painted only where the host supports OSC 8; elsewhere the URL is shown inline.
    const linked = this.host.capabilities.hyperlinks;
    const helpText = renderMarkdownText(helpMarkdown(), {columns: Math.max(20, this.dimensions().columns - 6), hyperlinks: linked});
    this.output.addFrontendInteraction(command, helpText, INFO, linked);
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
      this.prepareRawInput();
      // Raw bytes still reach the host now; retain only their bounded mode
      // state so renderer entry cannot replace the current owner's modes.
      if (!this.rendererEntered) this.commandModes.observeModes(data);
      this.renderer.observePassthrough(data);
      process.stdout.write(data);
    } else {
      this.commandModes.observeModes(data);
      if (this.running) this.commandLine.push(data);
      this.lastOutputTime = Date.now();
      const wasPassthrough = this.passthrough;
      this.output.write(data);
      this.journal?.schedule();
      this.output.setActiveActivities(this.tapActivityObserver.push(data, Date.now()));
      if (!wasPassthrough && this.passthrough) {
        this.prepareRawInput();
        this.renderer.observePassthrough(data);
        process.stdout.write(data);
      } else if (!this.replaying) {
        // Queries the program asked before taking the screen go to the terminal; they paint nothing.
        const queries = this.running ? this.queryExtractor.push(data) : '';
        if (queries) { process.stdout.write(queries); this.replyRouter.expect(Date.now()); }
        this.render();
      }
    }
  }

  private onShellPrompt(exitCode: number, cwd: string, at = Date.now()): void {
    this.completionService.invalidate();
    this.shellSuggestions = [];
    this.lastSuggestionInput = '';
    this.shellCwd = cwd;
    // The authenticated prompt owns the command directory. Async workspace
    // collection may still describe the previous prompt when the next command
    // is submitted; refresh this cheap fact now without weakening its policy.
    this.context.cwd = cwd;
    const cwdFact = promptFacts({cwd, project: ''}, at).cwd;
    this.context.facts = {...this.context.facts, cwd: updateFact(cwdFact, this.context.facts?.cwd)};
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
    // Never collapse output under the reader: while scrolled back or selecting, the block finishes expanded.
    const isQueued = Boolean(command.queued);
    const isInterrupted = command.interrupted || exitCode === 130;
    const foldQueued = Boolean(isQueued && this.promptConfiguration.queue.outputDisplay === 'fold');
    const completedRecord = this.output.complete(exitCode, {
      holdOpen: this.historyViewport.detached || Boolean(this.selection),
      queued: isQueued,
      foldQueued,
      interrupted: isInterrupted,
    });
    if (this.replaying && completedRecord) this.replayedRecords.push(completedRecord);
    if (completedRecord) {
      if (isQueued) completedRecord.queued = true;
      completedRecord.startedAt = command.startedAt;
      completedRecord.durationMs = Math.max(0, elapsed);
      // Wall-clock duration stays whole; the time spent waiting for the person is a separate, measured fact.
      if (this.completedInputTiming) { completedRecord.inputWaitMs = this.completedInputTiming.waitedMs; completedRecord.inputWaits = this.completedInputTiming.waits; }
      completedRecord.historyEligible = command.historyAllowed === 1 && !isPrivateCommand(command.command, ignorePatternFromEnv());
      this.directoryQuery = undefined;
      this.directoryQueryAbort?.abort();
      this.historyService.record(completedRecord, this.journal?.id ?? this.sessionId ?? 'current');
      this.historyQuery = undefined;
      if (!this.replaying && !isQueued) void this.adviseFolding(completedRecord);
    }
    this.suggestions.record({command: command.command, cwd: command.cwd, exitCode, at: command.startedAt, previous: this.submittedCommands[0]});
    this.submittedCommands.unshift(command.command);
    if (this.submittedCommands.length > 50) this.submittedCommands.length = 50;
    if (!command.cleared) {
      const outputText = completedRecord?.output ?? '';
      const facts = extractFacts(command.command, outputText);
      const isInterrupted = command.interrupted || exitCode === 130;
      const displayCompletedAt = presentationCompletionTime(completedAt);
      const failure = isInterrupted ? undefined : classifyShellFailure(command.command, exitCode, outputText);
      const finish = (pair?: ActivityVerbPair) => {
        const parts = completedActivity(command.command, elapsed, displayCompletedAt, isInterrupted ? 0 : exitCode, isInterrupted, facts, pair);
        if (failure) parts.main = parts.main.replace('Command failed', failure === 'command-not-found' ? 'Command not found' : 'Shell syntax error');
        else if (agent) parts.main = agentCompletionText(agent.id, elapsed, exitCode, isInterrupted);
        parts.main += completionWaitFact(this.completedInputTiming);
        if (command.queued) parts.main += ' · from queue';
        return parts;
      };
      // What is stored (copies, reports, restored records) is always the factual wording; only the drawn row is playful.
      const factual = finish();
      this.output.setCompletionLifecycle(`${factual.main}${factual.detail}`);
      const parts = agent || failure ? factual : finish(this.activityPairFor(command));
      const rowStyle = isInterrupted ? STOPPED : (exitCode !== 0 ? ERROR : SUCCESS);
      this.output.addHistoryLine(`${rowStyle}${parts.main}${SECONDARY}${parts.detail}${RESET}`);
      // The raw shell error stays; a curated command NMSh knows gets a factual follow-up (identity only, no lookup or install).
      const known = failure === 'command-not-found' ? this.knownMissingNote(command.command) : undefined;
      if (known) this.output.addHistoryLine(`${INFO}${known}${RESET}`);
    }
    this.running = undefined;
    this.inputState = undefined;
    this.queueCompose = false;
    this.completedInputTiming = undefined;
    // An answer typed for this command but never sent must not become the next shell command.
    const draft = this.runningDraft;
    this.runningDraft = undefined;
    if (draft?.answering) {
      if (this.editor.text) {
        this.editor.clear();
        this.output.addFrontendInteraction(commandWords(command.command)[0] ?? 'command', 'The command finished before your reply was sent; the reply was discarded, not run.', INFO);
      }
    }
    if (!this.replaying && !command.cleared && completedRecord) {
      const interrupted = command.interrupted || exitCode === 130;
      const now = Date.now();
      this.transitions.seal(completedRecord.startId, interrupted ? 'interrupted' : exitCode === 0 ? 'success' : 'failure', now);
      // Semantic Echo only for meaningful outcomes: failures, and successes after a long wait.
      if (!interrupted && exitCode !== 0) this.transitions.echo('failure', now);
      else if (!interrupted && elapsed >= 10_000) this.transitions.echo('longSuccess', now);
    }
    if (!this.replaying && !command.interrupted && !command.cleared) void this.suggestCorrection(command.command, exitCode, completedRecord?.output ?? '').catch(() => {});
    void this.journal?.flush().catch(() => {
      this.output.addFrontendInteraction('/resume', 'Could not persist the completed command.', ERROR);
    });
    this.replyRouter.stop();
    this.queryExtractor.reset();
    if (this.passthrough) {
      this.passthrough = false;
      this.commandModes.reset();
      // The program may have set a title or cwd as it exited (Vim: "Thanks for flying Vim"): reclaim both now.
      this.noteForeignScreen();
      this.renderer.resumeAfterPassthrough();
      this.outputProcessing.set(false);
      // Bytes the program owned (its keys, the terminal's replies to it) never continue as NMSh input.
      if (this.escapeFlushTimer) { clearTimeout(this.escapeFlushTimer); this.escapeFlushTimer = undefined; }
      this.keyDecoder.reset();
      this.lastPtyRows = 0;
      this.lastPtyColumns = 0;
    }
    // A command may have changed what workspace facts say (npm version, terraform workspace select, aws configure).
    this.contextEngine.invalidate('command');
    void this.refreshContext(cwd);
    this.render();
    this.advancePresetStartup(exitCode, cwd);
  }


  /** Rich Git status is computed only while a visible Git module can show it (field demand for the legacy collector). */
  private gitStatusDemanded(configuration = this.promptConfiguration): boolean {
    return configuration.nmsh.gitEnabled && configuration.modules.some(module => (module.id === 'gitStatus' || module.id === 'gitBranch') && routeModule(module) !== 'hidden');
  }

  private contextScope(cwd: string, root: string | undefined): CapabilityScopeInput {
    return {cwd, home: homedir(), ...(root ? {root} : {}), session: this.agentScope, env: this.contextEnvironment,
      live: {jobs: this.shellJobs, startedAt: this.contextStartedAt}};
  }

  /** The live shell's PATH once it has reported one; NMSh's own launch PATH until then. */
  private shellPath(): string {
    return (this.contextEnvironment.source === 'shell' ? this.contextEnvironment.values.PATH : undefined) ?? process.env.PATH ?? '';
  }

  /** The NMSh session agents running inside this shell report to (NMSH_SESSION_ID in the managed shell). */
  private get agentScope(): string {
    return this.sessionId ?? (this.session as {contextId?: string}).contextId ?? 'external';
  }

  private async refreshContext(cwd: string): Promise<void> {
    const generation = ++this.contextGeneration;
    const wantsDiscovery = this.promptConfiguration.modules.some(module => module.id === 'discoveredTools' && routeModule(module) !== 'hidden');
    const [context, pathAbbreviations] = await Promise.all([
      resolvePromptContext(cwd, undefined, undefined, {status: this.gitStatusDemanded(),
        ...(wantsDiscovery ? {discovery: await discoverLocalExecutables()} : {})}),
      resolvePathAbbreviations(cwd, homedir()),
    ]);
    if (generation !== this.contextGeneration || this.stopped) return;
    // Stage the engine for this directory and shell environment; demanded facts resolve (bounded wait)
    // while the previous ones stay visible, then both change together.
    const staged = this.contextEngine.stage(this.contextScope(cwd, context.root));
    this.requestContextDemand(context);
    await this.contextEngine.settle(CONTEXT_SETTLE_MS);
    if (generation !== this.contextGeneration || this.stopped) return;
    this.contextEngine.commit(staged);
    // Semantic Echo when Git conflicts become visible (not on every redraw while they remain).
    if ((context.git?.conflicts ?? 0) > 0 && !(this.context.git?.conflicts ?? 0)) this.transitions.echo('conflict', Date.now());
    this.context = {...context, home: homedir(), pathAbbreviations, exitStatus: this.context.exitStatus ?? 0};
    this.context.facts = promptFacts(this.context, Date.now());
    this.requestContextDemand();
    await this.refreshProviderPrompt();
    this.render();
  }

  /**
   * Prompt context plus show-on-command state from the editor buffer. The
   * text is only tokenized; lookups are cached reads that never block typing.
   */
  private promptContext(command = this.editor.text): PromptContext {
    const words = commandWords(command);
    const wanted = (id: CommandContextId) => this.promptConfiguration.modules.some(module => module.id === id && routeModule(module) !== 'hidden'
      && (module.condition !== 'onCommand' || isOnCommandRelevant(id, words)));
    // Render-safe reads of resolved engine facts: nothing here asks a capability to run.
    const engine = this.contextEngine.facts();
    const kubeFact = wanted('kubeContext') ? engine['infra.kubernetes'] : undefined;
    const dockerFact = wanted('dockerContext') ? engine['infra.docker'] : undefined;
    const kube = kubeFact?.value as {context?: string; namespace?: string} | undefined;
    const docker = dockerFact?.value as {context?: string} | undefined;
    // Read live, so the current-shell module follows /shell and the default-shell setting immediately.
    const shell = {current: this.shellId, differs: this.shellId !== this.promptConfiguration.shellBackend};
    const live = {...this.context, commandWords: words, shell, now: presentationNow().getTime(),
      ...(kube?.context ? {kubeContext: kube.context, ...(kube.namespace ? {kubeNamespace: kube.namespace} : {})} : {}),
      ...(docker?.context ? {dockerContext: docker.context} : {})};
    // Workspace facts retain collection time; cheap live shell/exit values are adapted in memory.
    const facts = promptFacts({...live, facts: undefined});
    // Engine-backed legacy fields keep the engine's provenance, freshness and policy.
    const engineBacked = (fact: ContextFact<unknown> | undefined, value: string | undefined) => fact && value ? {...fact, value} as ContextFact<string> : undefined;
    return {...live, facts: {...this.context.facts, ...engine, exitStatus: updateFact(facts.exitStatus, this.context.facts?.exitStatus),
      shell: updateFact(facts.shell, this.context.facts?.shell),
      // A refreshed value never weakens a privacy policy established earlier.
      kubeContext: updateFact(engineBacked(kubeFact, kube?.context) ?? facts.kubeContext, this.context.facts?.kubeContext),
      dockerContext: updateFact(engineBacked(dockerFact, docker?.context) ?? facts.dockerContext, this.context.facts?.dockerContext)}};
  }

  /**
   * Context demand from lifecycle, editor and settings changes, never from
   * rendering. Passthrough and handoff demand nothing (their screen is not ours).
   */
  private requestContextDemand(context: Pick<PromptContext, 'branch'> = this.context): void {
    if (this.stopped) return;
    const configuration = this.promptConfiguration;
    const native = this.effectivePromptProvider === 'nmsh';
    const suspended = this.passthrough || this.externalPassthrough || this.frontendSuspended;
    const {columns, rows} = this.dimensions();
    this.contextEngine.demand(suspended ? new Map() : contextDemand(configuration, {commandWords: commandWords(this.editor.text), nativePrompt: native,
      railVisible: native && configuration.contextRail.mode !== 'off', statusStripVisible: this.stripActive(columns, rows), inRepository: Boolean(context.branch)}));
    this.scheduleContextRefresh();
  }

  /** One timer, only while a visible module shows a time-based fact (clock, memory, battery, agent status). */
  private scheduleContextRefresh(): void {
    if (this.contextRefreshTimer) { clearTimeout(this.contextRefreshTimer); this.contextRefreshTimer = undefined; }
    if (this.stopped || this.passthrough || this.externalPassthrough || this.frontendSuspended) return;
    const delay = this.contextEngine.refreshDelay();
    if (delay === undefined) return;
    this.contextRefreshTimer = setTimeout(() => { this.contextRefreshTimer = undefined; this.requestContextDemand(); }, delay);
    this.contextRefreshTimer.unref?.();
  }

  private renderRail?: {columns: number; prepared: PreparedRail};

  private preparedRail(columns: number): PreparedRail {
    if (this.renderRail?.columns === columns) return this.renderRail.prepared;
    const configuration = this.passthrough || this.externalPassthrough || this.effectivePromptProvider !== 'nmsh'
      ? {...this.promptConfiguration, contextRail: {...this.promptConfiguration.contextRail, mode: 'off' as const}} : this.promptConfiguration;
    return prepareRail(this.promptContext(), columns, configuration);
  }

  private contextRailRows(columns: number): string[] {
    if (this.passthrough || this.externalPassthrough || this.effectivePromptProvider !== 'nmsh') return [];
    return this.preparedRail(columns).content;
  }

  /** Prompt None submissions genuinely have no prompt snapshot; history never substitutes Native for them. */
  private historicalContext(cwd: string, context: Pick<PromptContext, 'project' | 'branch' | 'facts'>, command: string): HistoricalContextSnapshot {
    const prompt = this.currentPromptSnapshot(command);
    const legacy = {cwd, project: context.project, branch: context.branch, facts: context.facts};
    const metadata = moduleFactContext(legacy, promptFacts(legacy), ['cwd', 'project', 'branch'], 'snapshot');
    return {cwd: metadata.cwd, project: metadata.project, branch: metadata.branch, ...(prompt ? {prompt} : this.effectivePromptProvider === 'none' ? {promptless: true as const} : {})};
  }

  private currentPromptSnapshot(command?: string): PromptSnapshot | undefined {
    if (this.effectivePromptProvider === 'none') return undefined;
    if (this.effectivePromptProvider !== 'nmsh' && this.externalPrompt) {
      const context = this.promptContext(command);
      const facts = promptFacts(context);
      const metadata = moduleFactContext(context, facts, ['cwd', 'branch'], 'snapshot');
      // External output has no fact-to-segment provenance. Retain it only when
      // all input facts may be persisted; otherwise fail closed on presentation.
      const persist = Object.values(facts).every(fact => !fact || factAllowed(fact, 'snapshot'));
      return {provider: this.effectivePromptProvider, layout: this.promptConfiguration.composerLayout,
        segments: persist ? structuredClone(this.externalPrompt.segments) : [], cwd: metadata.cwd,
        ...(metadata.branch ? {branch: metadata.branch} : {})};
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
    if (configuration.provider === 'ohMyPosh') {
      const status = await detectOhMyPosh(configuration.ohMyPosh.configPath ?? undefined);
      this.ohMyPoshRender?.abort();
      const controller = new AbortController();
      this.ohMyPoshRender = controller;
      try { return await renderOhMyPoshPrompt(this.context, status, process.env, {signal: controller.signal}); }
      finally { if (this.ohMyPoshRender === controller) this.ohMyPoshRender = undefined; }
    }
    const env = this.starshipEnvironment(configuration);
    this.starshipStatus ??= await detectStarship(env);
    if (!this.starshipStatus.installed) throw new Error('Starship is not installed or not available on PATH.');
    return renderStarshipPrompt(this.context, this.starshipStatus, env);
  }

  private async refreshProviderPrompt(): Promise<void> {
    if (this.promptConfiguration.provider === 'nmsh' || this.promptConfiguration.provider === 'none') {
      this.effectivePromptProvider = this.promptConfiguration.provider;
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

  private modulesListings: PackListing[] = [];
  private moduleRecommendations: Recommendation[] = [];
  private claudeBridgeState?: {state: string; detail?: string};
  private pendingBridgePlan?: {plan: import('../ask/fileEdit.js').FileEditPlan; launcher?: string};

  /** What /prompt's module manager shows beside the draft: live capability status, packs, recommendations, the Claude Code bridge. */
  private modulesContext(): ModulesContext {
    const presentation = this.promptContext();
    return {conditionMet: module => moduleConditionMet(module, presentation), status: id => this.contextEngine.status(id), packs: this.modulesListings, recommendations: this.moduleRecommendations,
      ...(this.claudeBridgeState ? {claudeBridge: this.claudeBridgeState} : {}), now: Date.now()};
  }

  /** Gathered explicitly when the module manager opens: pack states, the bridge state and local evidence for recommendations. */
  private async refreshModulesContext(): Promise<void> {
    const statuses = await installedPackStatuses(undefined, this.buildIdentity.version).catch(() => []);
    const listing = (parsed: ParsedPack, builtIn: boolean, state: string, message?: string): PackListing => ({id: parsed.pack.id, version: parsed.pack.version,
      name: parsed.pack.name, description: parsed.pack.description, builtIn, state, ...(message ? {message} : {}), license: parsed.pack.license,
      author: parsed.pack.provenance.author, sha256: parsed.sha256, requires: parsed.pack.requires, modules: parsed.pack.modules.map(module => ({id: module.id, label: module.label}))});
    this.modulesListings = [...firstPartyPacks().map(parsed => listing(parsed, true, 'bundled')),
      ...statuses.map(status => status.parsed ? listing(status.parsed, false, status.state, status.message)
        : {id: status.record.id, version: status.record.version, name: status.record.id, description: 'The installed manifest could not be verified.', builtIn: false,
          state: status.state, ...(status.message ? {message: status.message} : {}), license: 'unknown', author: 'unknown', sha256: status.record.sha256, requires: [], modules: []})];
    const bridge = inspectClaudeBridge();
    this.claudeBridgeState = {state: bridge.state, ...(bridge.state === 'conflict' ? {detail: bridge.command} : bridge.state === 'unreadable' ? {detail: bridge.reason} : {})};
    // Recommendation evidence: one bounded listing of this directory and the repository root, the shared inventory, resolved facts.
    const names = new Set([...await listNames(this.shellCwd), ...(this.context.root ? await listNames(this.context.root) : [])]);
    const inventory = await discoverLocalExecutables().catch(() => undefined);
    this.moduleRecommendations = recommendModules(this.promptPanelState?.draft ?? this.promptConfiguration, {workspaceNames: names,
      executables: new Set(inventory?.executables.map(item => item.name) ?? []), facts: this.contextEngine.facts()}, [...firstPartyPacks(), ...installedPacks()]);
    if (this.promptPanelState) this.promptPanelState.context = this.modulesContext();
    this.render();
  }

  /** Side effects the module manager asked for; every settings change is shown first and applied only on Enter. */
  private async handleModulesRequest(state: PromptPanelState): Promise<void> {
    const request = state.request;
    state.request = undefined;
    if (!request) return;
    try {
      if (request.kind === 'claudeBridgeReview' || request.kind === 'claudeBridgeRemoveReview') {
        const launcher = currentLauncher();
        const planned = request.kind === 'claudeBridgeRemoveReview' ? planClaudeBridgeRemoval()
          : launcher ? planClaudeBridge(launcher) : {refuse: 'Start NMSh through the installed `nmsh` command so Claude Code can run its bridge.'};
        if ('noop' in planned) state.message = planned.noop;
        else if ('refuse' in planned) state.message = planned.refuse;
        else {
          this.pendingBridgePlan = {plan: planned.plan, ...(launcher ? {launcher} : {})};
          state.confirm = {request: {kind: request.kind === 'claudeBridgeReview' ? 'claudeBridgeApply' : 'claudeBridgeRemove'},
            title: request.kind === 'claudeBridgeReview' ? 'Let Claude Code report to NMSh?' : 'Stop Claude Code reporting to NMSh?',
            lines: [`${planned.plan.path} — ${planned.plan.reason}`, ...planned.plan.preview]};
        }
      } else if (request.kind === 'claudeBridgeApply' || request.kind === 'claudeBridgeRemove') {
        const pending = this.pendingBridgePlan;
        this.pendingBridgePlan = undefined;
        const result = !pending ? {ok: false as const, reason: 'Review the change again first.'}
          : request.kind === 'claudeBridgeApply' ? applyClaudeBridge(pending.plan, pending.launcher ?? '') : applyClaudeBridgeRemoval(pending.plan);
        state.message = result.ok ? (request.kind === 'claudeBridgeApply' ? 'Claude Code reports to NMSh from its next update.' : 'Removed the NMSh status line from Claude Code settings.')
          : result.reason;
      } else if (request.kind === 'packEnabled') {
        const result = await setPackEnabled(request.id, request.enabled);
        state.message = result.ok ? `${request.id} ${request.enabled ? 'enabled' : 'disabled'}.` : result.reason;
        await this.loadInstalledPacks();
      } else if (request.kind === 'saveModules') {
        this.persistModuleSettings(state);
      } else if (request.kind === 'packRemove') {
        const result = await removePack(request.id);
        if (result.ok) {
          state.draft.modules = state.draft.modules.filter(module => !module.id.startsWith(`${request.id}:`));
          state.detail = undefined;
        }
        state.message = result.ok ? `Removed ${request.id}.${state.standalone ? '' : ' Save to update your prompt settings.'}` : result.reason;
        await this.loadInstalledPacks();
      }
    } catch (error) {
      state.message = error instanceof Error ? error.message : String(error);
    }
    // Results can quote settings paths and file content: displayed, never trusted as terminal text.
    if (state.standalone) this.persistModuleSettings(state);
    if (state.message) state.message = safeContextText(state.message, 400);
    await this.refreshModulesContext();
  }

  /** Installed Context Packs (verified, enabled) join the module catalog: read at startup and whenever /prompt opens. */
  private async loadInstalledPacks(): Promise<void> {
    let packs: ParsedPack[];
    try { packs = await activeInstalledPacks(undefined, this.buildIdentity.version); } catch { return; /* bundled modules remain available */ }
    // Most sessions have no installed packs: nothing changes, so nothing repaints.
    const key = (list: readonly ParsedPack[]) => list.map(pack => pack.sha256).sort().join(',');
    if (this.stopped || key(packs) === key(installedPacks())) return;
    setInstalledPacks(packs);
    this.requestContextDemand();
    this.render();
  }

  private async startPromptSettings(onboarding: boolean): Promise<void> {
    this.promptPanelState = {onboarding, step: 'provider', selectedIndex: PROVIDER_ORDER.indexOf(this.promptConfiguration.provider),
      draft: structuredClone(this.promptConfiguration), saved: structuredClone(this.promptConfiguration)};
    // Packs installed since startup join the catalog; the panel opens at once and repaints when they arrive.
    void this.loadInstalledPacks();
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

  /** /modules: the same module manager /prompt embeds, opened directly; each change is saved as it is made. */
  private openModulesManager(): void {
    this.promptPanelState = {onboarding: false, step: 'modules', selectedIndex: 0, standalone: true,
      draft: structuredClone(this.promptConfiguration), saved: structuredClone(this.promptConfiguration)};
    this.panelExternalPrompt = undefined;
    void this.loadInstalledPacks();
    void this.refreshModulesContext();
    this.render();
  }

  /**
   * Persists only the module settings (order, visibility, surfaces, conditions,
   * mirroring) from a module-manager draft onto the saved configuration. /modules
   * calls it after every change; inside /prompt, A calls it and leaves the rest
   * of the /prompt draft unsaved.
   */
  private persistModuleSettings(state: PromptPanelState): void {
    if (moduleSettingsSignature(state.draft) === moduleSettingsSignature(this.promptConfiguration)) return;
    const previous = this.promptConfiguration;
    const next = structuredClone(previous);
    next.modules = structuredClone(state.draft.modules);
    next.nmsh.mirrorRight = state.draft.nmsh.mirrorRight;
    try {
      savePromptConfiguration(next, undefined, previous);
    } catch (error) {
      state.message = `Could not save module settings: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    this.promptConfiguration = next;
    if (state.saved) { state.saved.modules = structuredClone(next.modules); state.saved.nmsh.mirrorRight = next.nmsh.mirrorRight; }
    state.message = state.message ? `${state.message} Saved.` : 'Saved.';
    if (this.gitStatusDemanded(previous) !== this.gitStatusDemanded(next)) void this.refreshContext(this.shellCwd);
    this.requestContextDemand();
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
    if (!this.hostTerminalFree()) throw new Error('The terminal is busy.');
    return this.withHostTerminal(() => launchPowerlevel10kConfigurator(status));
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
      } else if (state.draft.provider === 'ohMyPosh' && !(await detectOhMyPosh(state.draft.ohMyPosh.configPath ?? undefined)).installed) {
        // Nothing to render with: stay on the provider list and say why.
        state.draft.provider = state.saved?.provider ?? this.promptConfiguration.provider;
        state.message = 'Oh My Posh is not installed. Install it from /tools (Shell / Workflow) and choose it again.';
      } else if (state.draft.provider === 'none') {
        // Composer only: no layout applies; the appearance step keeps the theme and the input marker.
        state.step = 'appearance';
        state.selectedIndex = 0;
      } else {
        state.step = 'layout';
        state.selectedIndex = layoutChoiceIndex(state.draft);
        if (state.draft.provider === 'ohMyPosh') await this.refreshPanelPreview(state);
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
    } else if (state.step === 'railInsideConfirm') {
      const confirmed = state.selectedIndex === 0;
      state.step = state.railConfirmReturn?.step ?? 'appearance';
      state.selectedIndex = state.railConfirmReturn?.selectedIndex ?? 0;
      state.railConfirmReturn = undefined;
      if (confirmed) {
        state.draft = railPreviewConfiguration(state.draft);
        await this.savePromptSettings();
      }
    } else if (state.step === 'layout') {
      applyLayoutChoice(state.draft, state.selectedIndex);
      if (state.draft.provider === 'nmsh' || state.draft.provider === 'none') { state.step = 'appearance'; state.selectedIndex = 0; }
      else await this.savePromptSettings();
    } else if (onModulesRow(state)) {
      state.step = 'modules';
      state.selectedIndex = 0;
      void this.refreshModulesContext();
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
    if (railNeedsPromptConversion(state.draft)) {
      state.railConfirmReturn = {step: state.step, selectedIndex: state.selectedIndex};
      state.step = 'railInsideConfirm';
      state.selectedIndex = 1;
      this.render();
      return;
    }
    state.draft.onboardingComplete = true;
    try {
      savePromptConfiguration(state.draft, undefined, this.promptConfiguration);
      this.promptConfiguration = structuredClone(state.draft);
      this.promptPanelState = undefined;
      if (state.onboarding && !this.promptConfiguration.toolsSetupComplete) this.startTools(true);
      this.panelExternalPrompt = undefined;
      // Turning Rich Git on needs a status probe the last refresh may have skipped.
      if (state.saved && this.gitStatusDemanded(state.saved) !== this.gitStatusDemanded(state.draft)) void this.refreshContext(this.shellCwd);
      await this.refreshProviderPrompt();
      this.requestContextDemand();
      // refreshProviderPrompt already fell back to NMSh and saved that truthfully.
      if (this.externalPromptError && state.draft.provider !== 'nmsh') {
        this.output.addHistoryLine(`${ERROR}${providerLabel(state.draft.provider)} prompt failed; NMSh is active. ${this.externalPromptError}${RESET}`);
      } else if (!this.panelOrigin) {
        this.output.addHistoryLine(`${SUCCESS}Prompt settings saved · ${describePromptConfiguration(this.promptConfiguration)}${RESET}`);
      }
      this.returnFromPanel();
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
    const previewConfig = railPreviewConfiguration(state.draft);
    if (state.step === 'railInsideConfirm' || state.step === 'appearance' && state.view === 'rail') {
      const label = (text: string) => `  ${SECONDARY}${truncateAnsi(text, Math.max(1, width - 2))}${RESET}`;
      const currentContent = prepareRail(this.promptContext(), width, previewConfig).content;
      const current = railCompositionPreview(this.promptContext(), width, previewConfig);
      const showcase = structuredClone(previewConfig);
      // Synthetic facts exercise configured Rail modules without stealing Main or Right Context.
      showcase.modules = showcase.modules.map(module => ({...module, visible: true}));
      const sample = railCompositionPreview(moduleShowcaseContext(), width, showcase);
      const empty = previewConfig.contextRail.mode === 'off' ? [label('Rail is Off')]
        : [label('No visible Rail context'), label(previewConfig.contextRail.mode === 'always'
          ? `Always reserves ${previewConfig.contextRail.rows} row${previewConfig.contextRail.rows === 1 ? '' : 's'}; module visibility still applies`
          : 'Route modules to Rail in Modules; visibility conditions still apply')];
      return [label('Current'), ...(currentContent.some(row => stripAnsi(row).trim()) ? current : [...empty, ...current]), label('Showcase'),
        ...(sample.length ? sample : [label('Rail is Off')])];
    }
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
    if (previewConfig.provider === 'none') return [`${SUBTLE}None · composer only${RESET}`, boundary, `${ACCENT}${GLYPHS.prompt}${RESET} echo hello`, boundary];
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

  private get settingsPanelActive(): boolean { return this.hasModalInput(); }

  private hasModalInput(ignorePalette = false): boolean {
    return Boolean(this.stopsEditor || this.chromeEditor || this.screensaverPanel || this.themeStudio || this.themeBridgePanel || this.rowPanel || this.copyPicker || this.summaryReview || this.reportReview || this.comparePanel || this.viewer || this.textEditor || this.background.panel || this.batchReview || this.pinsPanel || this.stripStudio || this.configureList || this.tmuxPanel || this.dotfiles || this.setupState || this.installPrompt || this.presetPanel || this.toolsPanel || this.toolConfigurationLoading || this.toolConfiguration || this.promptPanelState || this.transcriptPanelState || this.providerPanelState || (!ignorePalette && this.paletteState) || this.syntaxPanelState || this.layoutPanelState || this.settingsPanelState
      || this.resumeBrowser || this.appearanceHub || this.keyboardState || this.startupPanel || this.aboutPanel || this.shellPanel || this.openPanel || this.askState || this.agentView || this.agentPanel || this.launcher || this.modsPanel || this.worktreePanel || this.githubPanel || this.providersOverview || this.understandingPanel || this.cursorPanel || this.doctorPanel || this.watchPanel || this.queuePanel || this.queueHistoryPanel || this.pasteReview || this.misePanel || this.keepAwakePanel);
  }

  /** Complex panels declare the smallest size that shows their essential controls. */
  private panelMinimum(): MinimumSize | undefined {
    if (this.setupState) return this.setupState.quick ? {columns: 16, rows: 6} : SETUP_MIN_SIZE;
    if (this.themeStudio) return STUDIO_MIN_SIZE;
    if (this.themeBridgePanel) return {columns: 56, rows: 14};
    if (this.tmuxPanel || this.configureList || this.rowPanel || this.dotfiles) return {columns: 50, rows: 12};
    if (this.screensaverPanel) return SCREENSAVER_MIN_SIZE;
    if (this.chromeEditor || this.stopsEditor) return CHROME_EDITOR_MIN_SIZE;
    return undefined;
  }

  private settingsPanelRows(columns: number): string[] {
    const minimum = this.panelMinimum();
    const {rows} = this.dimensions();
    if (minimum && !fits(minimum, columns, rows)) {
      this.stopSetupPlayback();
      return renderTooSmall(minimum, columns, rows);
    }
    return this.panelContentRows(columns);
  }

  private panelContentRows(columns: number): string[] {
    this.agentCaret = undefined;
    if (this.startupPanel) return framePanel(renderStartupPanel({tail: this.startupPanel.tail, elapsedMs: Date.now() - this.startupPanel.since}, columns, this.dimensions().rows), columns);
    if (this.toolConfigurationLoading) return framePanel(['  Reading supported configuration...', '  Esc cancel'], columns);
    if (this.toolConfiguration) return renderConfigurationPanel(this.toolConfiguration, columns, this.dimensions().rows);
    if (this.presetPanel) return renderPresetPanel(this.presetPanel, columns, this.dimensions().rows);
    if (this.misePanel) return renderMisePanel(this.misePanel, columns, this.dimensions().rows);
    if (this.keepAwakePanel) return renderKeepAwakePanel(this.keepAwakePanel, this.keepAwake(), columns, this.dimensions().rows, this.promptConfiguration.keepAwake);
    if (this.installPrompt) return renderInstallPrompt(this.installPrompt, columns);
    if (this.themeStudio) return this.renderThemeStudioRows(this.themeStudio, columns);
    if (this.themeBridgePanel) return renderThemeBridgePanel(this.themeBridgePanel, this.themeBridgePanelContext(), columns, this.dimensions().rows);
    if (this.stripStudio) return renderStripStudio(this.stripStudio, this.promptConfiguration, columns, this.dimensions().rows,
      (configuration, width) => this.statusStripRow(width, configuration));
    if (this.copyPicker) return renderCopyPicker(this.copyPicker, columns, this.dimensions().rows - 4);
    if (this.summaryReview) return renderReportReview(this.summaryReview.document, columns, this.dimensions().rows - 4);
    if (this.reportReview) return renderReportReview(this.reportReview, columns, this.dimensions().rows - 4);
    if (this.comparePanel) return renderComparePanel(this.comparePanel, columns, this.dimensions().rows - 4);
    if (this.viewer) return renderViewer(this.viewer, columns, this.dimensions().rows - 4, this.viewerLook());
    if (this.textEditor) return renderEditor(this.textEditor, columns, this.dimensions().rows - 4);
    if (this.background.panel) return framePanel(this.background.panelRows(Math.max(1, columns - 4), this.dimensions().rows - 4,
      {now: Date.now(), color: colorLevel() !== 'none', safe: getCurrentGlyphMode() === 'safe'}), columns);
    if (this.rowPanel) return renderRowPanel(this.rowPanel, this.promptConfiguration, columns, this.dimensions().rows, this.rowPanelPreview(columns));
    if (this.configureList) return renderConfigureList(this.configureList, registryFacts(), columns, this.dimensions().rows);
    if (this.tmuxPanel) return renderTmuxPanel(this.tmuxPanel, columns, this.dimensions().rows);
    if (this.dotfiles) return renderDotfilesPanel(this.dotfiles, columns, this.dimensions().rows);
    if (this.screensaverPanel) return this.renderScreensaverRows(this.screensaverPanel, columns);
    if (this.stopsEditor) return this.renderStopsEditor(this.stopsEditor, columns);
    if (this.chromeEditor) return renderChromeEditor(this.chromeEditor, columns, this.dimensions().rows, colorLevel());
    if (this.setupState) {
      const state = this.setupState;
      if (state.cursorPanel) return this.withDraftTheme(state.draft, () => framePanel(this.cursorPanelRows(state.cursorPanel!, columns, this.cursorEnv(state.cursorPanel!.draft, state.draft)), columns));
      if (state.quick && !state.quick.manual && !state.toolBrowser) {
        // The selector draws in the saved theme's chrome; its previews draw with the highlighted draft's own settings.
        const startup = state.context.startup ??= createStartupContext({reopened: !state.onboarding, steps: GUIDED_STEPS});
        startup.preview = (config, width) => this.withDraftTheme(config, () => defaultStartupPreview(config, width));
        return this.withDraftTheme(state.saved, () => renderSetup(state, columns, this.dimensions().rows));
      }
      // Beside the rows when two columns fit, below them otherwise: the preview is rendered for the space it gets.
      if (!state.toolBrowser && !(state.quick && !state.quick.manual)) state.context.preview = this.withDraftTheme(state.draft, () => this.setupPreview(state, guidedPreviewWidth(state, columns)));
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
      // The agent view is a workspace: it owns the full height below its frame line (the shell is one Esc away).
      if (session) {
        // The agent draft uses the shell composer's geometry and the terminal's own caret: the view reports where it is.
        const layout: {caret?: {row: number; column: number}} = {};
        const height = this.dimensions().rows - (this.agentView.controller ? 1 : 4);
        // The right panel sits beside the conversation when shown; the conversation keeps the composer and caret.
        const panel = session.level === 'managed' && sidePanelShown(this.agentView.panel, columns);
        const panelWidth = panel ? sidePanelWidth(columns) : 0;
        const mainWidth = columns - (panel ? panelWidth + 3 : 0);
        const main = renderAgentView(session, this.agentView, mainWidth, height, Date.now(), this.agentViewMeta(session),
          {presentation: this.promptConfiguration.transcriptPresentation, composerPosition: this.promptConfiguration.composerPosition === 'top' ? 'top' : 'bottom', hardwareCaret: true, layout});
        const side = panel ? renderSidePanel(session, panelWidth, main.length, Date.now(), this.agentSettingsEffort.get(session.id)) : [];
        const divider = `${foreground(UI_COLORS.subtle)}${getCurrentGlyphMode() === 'safe' ? '|' : '│'}\u001b[0m`;
        const rows = framePanel(panel ? main.map((row, index) => `${padCells(row, mainWidth, 0)} ${divider} ${side[index] ?? ''}`) : main, columns);
        // framePanel puts its rule first; a Top panel later moves that rule to its last row.
        this.agentCaret = layout.caret && {row: layout.caret.row + 1, column: layout.caret.column};
        return rows;
      }
    }
    if (this.launcher) return framePanel(renderLauncher(this.launcher, this.launcherRows(), columns, this.dimensions().rows - 4), columns);
    if (this.modsPanel) return framePanel(renderMods(this.modsPanel, columns, this.dimensions().rows - 4), columns);
    if (this.worktreePanel) return framePanel(this.worktreeRows(columns, this.dimensions().rows - 4), columns);
    if (this.githubPanel) return framePanel(this.githubRows(columns, this.dimensions().rows - 4), columns);
    if (this.agentPanel) return framePanel(renderAgentPanel(this.agentPanel, this.agentPanelRows(), columns, Date.now(), this.dimensions().rows - 4), columns);
    if (this.askState) {
      const activity = this.askActivityLine();
      return framePanel(renderAsk(this.askState, columns, {presentation: this.promptConfiguration.askPresentation, height: this.dimensions().rows - 4, shell: this.shellId, ...(activity ? {activity} : {})}), columns);
    }
    if (this.pinsPanel) return framePanel(renderPinsPanel(this.pinsPanel, columns, this.dimensions().rows - 4), columns);
    if (this.batchReview) return framePanel(renderBatchReview(this.batchReview, columns, this.dimensions().rows - 4), columns);
    if (this.pasteReview) return framePanel(renderPasteReview(this.pasteReview, columns, this.dimensions().rows - 4), columns);
    if (this.queueHistoryPanel) return framePanel(renderQueueHistoryPanel(this.queueHistoryPanel, this.queueState, columns, this.dimensions().rows - 4), columns);
    if (this.queuePanel) return framePanel(renderQueuePanel(this.queuePanel, this.queueState, this.running?.command, columns, this.dimensions().rows - 4, this.queueConditionsAvailable()), columns);
    if (this.watchPanel) return framePanel(renderWatchPanel(this.watchPanel, this.watches.active(), columns, Date.now(), this.dimensions().rows - 4), columns);
    if (this.doctorPanel) return framePanel(renderDoctorPanel(this.doctorPanel, columns, Date.now(), !this.decorativeMotionAllowed()), columns);
    if (this.cursorPanel) return framePanel(this.cursorPanelRows(this.cursorPanel, columns, this.cursorEnv(this.cursorPanel.draft, this.promptConfiguration)), columns);
    if (this.understandingPanel) return framePanel(renderUnderstandingPanel(this.understandingPanel, this.understandingFacts(), columns), columns);
    if (this.providersOverview) return framePanel(renderProvidersOverview(this.providersOverview, this.providersOverviewFacts(), columns, this.dimensions().rows - 3), columns);
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
          const stateColor = state === 'failed' ? ERROR : state === 'input' || state === 'inputLikely' ? ATTENTION : state === 'attention' ? ACCENT : state === 'completed' ? SUCCESS : state === 'active' ? PRIMARY : SECONDARY;
          const agent = liveRowAgent(session);
          // Agent color only when identity is proven and color is allowed; generic otherwise.
          const who = agent ? `${agentColor(agent.color)}${safe ? agent.safeGlyph : agent.glyph} ${agent.short}${RESET} ` : '';
          const signature = signatureAccent(session.signature);
          const stateMark = state === 'input' ? (safe ? '!' : '◆') : state === 'inputLikely' ? (safe ? '?' : '◇') : (safe ? '*' : '●');
          rows.push(truncateAnsi(`${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${stateColor}${stateMark} ${LIVE_ROW_LABELS[state].padEnd(17)}${RESET}${signature ? `${foreground(signature)}${safe ? '+' : '◆'}${RESET} ` : ''}${who}`
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
    if (this.appearanceHub) {
      const theme = themeLabel(this.promptConfiguration.nmsh.palette);
      const now = Date.now();
      const gate = this.motionPreviewGate();
      // A frame clock only while the one-shot preview is animating; none once it settles.
      const busy = hubMotionPreview(this.appearanceHub, this.promptConfiguration, columns, gate, now)?.busy ?? false;
      if (busy && !this.motionPreviewClock) this.motionPreviewClock = presentationClock.subscribe(() => {
        if (!this.stopped && this.appearanceHub) { this.render(); return; }
        this.motionPreviewClock?.(); this.motionPreviewClock = undefined;
      }, 33, 16);
      else if (!busy && this.motionPreviewClock) { this.motionPreviewClock(); this.motionPreviewClock = undefined; }
      return framePanel(renderAppearanceHub(this.appearanceHub, this.promptConfiguration, columns, theme, this.cursorBackend().backend.label, {gate, now}, this.dimensions().rows - 4), columns);
    }
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
    if (this.panelOrigin === 'setup' && this.parkedSetup) {
      // Back to the exact step: the draft, row and scroll are as they were; what the editor saved joins them.
      const {state, knew} = this.parkedSetup;
      this.parkedSetup = undefined; this.panelOrigin = undefined;
      // Only the values the editor changed, at their own depth, so other unapplied edits in the same group survive.
      const merge = (target: Record<string, unknown>, before: Record<string, unknown>, after: Record<string, unknown>) => {
        for (const key of Object.keys(after)) {
          const was = before?.[key], is = after[key];
          if (JSON.stringify(was) === JSON.stringify(is)) continue;
          const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
          if (plain(was) && plain(is) && plain(target[key])) merge(target[key] as Record<string, unknown>, was, is);
          else target[key] = structuredClone(is);
        }
      };
      const now = this.promptConfiguration as unknown as Record<string, unknown>;
      const before = knew as unknown as Record<string, unknown>;
      merge(state.saved as unknown as Record<string, unknown>, before, now);
      merge(state.draft as unknown as Record<string, unknown>, before, now);
      this.setupState = state;
      if (!state.quick || state.quick.manual) void this.loadSetupContext(state);
      return;
    }
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
    } else if (tabCycleDelta(key) && !state.searchFocused) {
      switchSettingsView(state, tabCycleDelta(key)!);
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
      if (isInlineEditable(row)) {
        this.applySettingsConfiguration(toggleSettingsRow(row, this.promptConfiguration));
        // Enter landing on Custom opens its editor at once; Esc there cancels and comes back to this row.
        const editor = key.kind === 'enter' && row.control === 'enum' ? customColorEditor(row.id, this.promptConfiguration) : undefined;
        if (editor) {
          this.openSettingsDestination(editor.destination, view, state.contentIndex ?? 0, state);
          if (editor.cursor && this.cursorPanel) openCursorEditor(this.cursorPanel, editor.cursor, this.cursorEnv(this.cursorPanel.draft, this.promptConfiguration));
        }
      } else if (key.kind === 'enter') {
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
    this.openDestinationPanel(destination);
  }

  /** Open the panel behind a Settings destination (also where Setup routes after Apply). */
  private openDestinationPanel(destination: SettingsDestination): void {
    if (destination === 'tools') this.startTools();
    else if (destination === 'setup') this.startSetup();
    else if (destination === 'setupQuick') this.startSetup('quick');
    else if (destination === 'screensaver') this.openScreensaverGallery();
    else if (destination === 'chromeColors') {
      const config = this.editorBase();
      this.chromeEditor = createChromeEditor(config.uiChrome.colors ?? chromeColorsFrom(resolveChrome({...config.uiChrome, source: 'theme'}, config.nmsh.palette, config.nmsh.accent, config.customTheme)));
    }
    else if (destination === 'idleColors' || destination === 'activityColors') this.openStopsEditor(destination === 'idleColors' ? 'idle' : 'activity');
    else if (destination === 'toolConfig') void this.startToolConfiguration('starship');
    else if (destination === 'appearance') void this.startAppearance();
    else if (destination === 'prompt') void this.startPromptSettings(false);
    else if (destination === 'transcript') this.startTranscriptSettings();
    else if (destination === 'syntax') this.startSyntaxSettings();
    else if (destination === 'layout') this.startLayoutSettings();
    else if (destination === 'cursor') this.openCursorPanel();
    else if (destination === 'themeStudio') this.openThemeStudio();
    else if (destination === 'themeBridge') void this.openThemeBridge();
    else if (destination === 'welcome' || destination === 'suggestions' || destination === 'history' || destination === 'picker' || destination === 'navigation') this.startProviderPanel(destination);
    else if (destination === 'queue') this.rowPanel = createRowPanel('Queue', '/queue · /settings queue', [...QUEUE_SETTINGS_ROW_IDS], 'queue');
    else void this.startKeyboard();
  }

  /** The preview behind a focused row panel; the caller owns the renderer, and the panel itself holds no settings. */
  private rowPanelPreview(columns: number): readonly string[] {
    if (this.rowPanel?.preview === 'queue') return queueSettingsPreview(this.promptConfiguration, Math.max(24, columns - 4));
    if (this.rowPanel?.preview === 'statusStrip') return this.promptConfiguration.statusStrip.enabled ? [this.statusStripRow(columns - 2)] : ['  (Status strip Off)'];
    return [];
  }

  /** Opens the Queue destination the way the palette does: Esc returns to the Settings view it was opened from. */
  private openQueueSettingsPanel(): void {
    this.openSettingsPanel('config');
    const index = SETTINGS_ENTRIES.findIndex(entry => entry.control === 'child' && entry.destination === 'queue');
    this.openSettingsDestination('queue', 'config', Math.max(0, index), this.settingsPanelState!);
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

  private shellNames?: ReadonlySet<string>;
  private shellNamesComplete = false;
  private rememberShellNames(knowledge: string): void {
    this.shellNames = new Set(parseShellKnowledge(knowledge).keys());
    this.shellNamesComplete = /^complete$/mu.test(knowledge);
  }

  /** /tools, Settings → Tools and the tools step after Apply: one panel and installer. `preselect` ticks the missing recommended tools once verified. */
  /**
   * `tier` is the view it opens on: Recommended + Enhanced unless said otherwise ('all' for every curated tool).
   * `preselect` ticks that view's verified missing tools; nothing installs without the review and confirmation.
   */
  private startTools(onboarding = false, options: {tier?: ToolTier | 'all'; preselect?: boolean; fromSetup?: boolean} = {}): void {
    const config = this.promptConfiguration;
    const state = this.toolsPanel = createToolsPanel(new Set([config.history, config.picker, config.navigation, config.welcome, config.provider]), onboarding);
    state.tier = options.tier === 'all' ? undefined : options.tier ?? 'enhanced';
    if (options.preselect && state.tier) { state.preselect = true; state.preselectTier = state.tier; }
    if (options.fromSetup) state.fromSetup = true;
    // Opened from Settings (or another panel): Esc goes back there, and the footer says so.
    state.back = this.panelOrigin !== undefined;
    state.updates = this.toolUpdates;
    state.activation = toolId => integrationActivation(toolId, this.shellId, this.shellNames, this.shellNamesComplete);
    state.prompt = {selected: config.provider, effective: this.effectivePromptProvider};
    state.shellBackend = this.shellId;
    void refreshTools(state, () => { if (!this.stopped && this.toolsPanel === state) this.render(); });
  }

  /** /tools → Use as prompt: the one canonical provider setting, then a truthful render (fallback to Native if it fails). */
  private async useToolAsPrompt(state: ToolsPanel, provider: NonNullable<Tool['promptProvider']>): Promise<void> {
    const saved = structuredClone(this.promptConfiguration);
    this.promptConfiguration.provider = provider;
    try { savePromptConfiguration(this.promptConfiguration, undefined, saved); } catch { /* applies to this window */ }
    this.starshipStatus = undefined;
    await this.refreshProviderPrompt();
    state.prompt = {selected: this.promptConfiguration.provider, effective: this.effectivePromptProvider};
    state.message = this.effectivePromptProvider === provider
      ? `${providerLabel(provider)} is now the prompt provider. No shell rc file was changed.`
      : `${providerLabel(provider)} could not render (${this.externalPromptError ?? 'unknown error'}); NMSh Native stays active.`;
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
    else if (action === 'configure' && state.detail?.configuration) { this.toolsPanel = undefined; await this.openConfigure(state.detail.configuration, '/tools'); }
    else if (action === 'usePrompt' && state.detail?.promptProvider) await this.useToolAsPrompt(state, state.detail.promptProvider);
    else if (action === 'promptSettings') { this.toolsPanel = undefined; await this.startPromptSettings(false); }
    else if (action === 'p10kConfigure') {
      // The existing configurator flow: backups of ~/.p10k.zsh and .zshrc, then the official wizard.
      this.toolsPanel = undefined;
      await this.startPromptSettings(false);
      if (this.promptPanelState) {
        this.promptPanelState.draft.provider = 'powerlevel10k';
        this.promptPanelState.p10kStatus = this.detectPowerlevel10k(this.promptPanelState.draft);
        this.promptPanelState.step = 'p10kConfirm';
        this.promptPanelState.selectedIndex = 0;
      }
    } else if (action === 'importAppearance') {
      const status = await detectOhMyPosh(this.promptConfiguration.ohMyPosh.configPath ?? undefined);
      if (!status.configPath) state.message = 'Oh My Posh is using its built-in default config, so there is no local file to import. Choose a config in /prompt, or import a file in /theme → Import.';
      else if (!status.configExists) state.message = `Oh My Posh config not found: ${status.configPath}`;
      else {
        // The existing Theme Studio import (static colors only); the provider is not switched.
        this.toolsPanel = undefined;
        this.openThemeStudio('import');
        if (this.themeStudio) {
          this.themeStudio.importPath = status.configPath;
          const result = readThemeImport(status.configPath, this.shellCwd, 'auto');
          if ('errors' in result) this.themeStudio.message = result.errors.join(' ');
          else this.themeStudio.importPreview = result;
        }
      }
    } else if (action === 'openFiles' && state.openPaths?.length === 2) {
      await this.performHostAction(this.hostActions().openDiff(state.openPaths[0]!, state.openPaths[1]!), message => { state.message = message; this.render(); });
    }
    else if (action === 'provider') {
      const family = state.detail?.providerFamily;
      if (family === 'welcome' || family === 'history' || family === 'picker' || family === 'navigation') {
        // The one provider surface, focused on this family.
        this.toolsPanel = undefined;
        this.openProvidersOverview(family);
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

  private studioContext(): StudioContext {
    const config = this.promptConfiguration;
    const ref = activeThemeRef(config);
    const chroma = config.presentation.preset === 'off' ? 'Off' : `${TREATMENT_PRESET_LABELS[config.presentation.preset]} · ${config.presentation.motion}`;
    return {themes: config.themes, accent: config.nmsh.accent, ...(ref ? {activeRef: ref} : {}), pinnedTo: target => targetsPinnedTo(config.themeBridge, target),
      chroma, activeName: themeLabel(config.nmsh.palette)};
  }

  private openThemeStudio(tab?: StudioTab): void {
    this.themeStudio = createThemeStudio(this.studioContext(), tab);
  }

  /**
   * The shared theme preview: the real Native renderer over synthetic context
   * (project, path, Git, Node/Go/Python/Docker, Kubernetes, success and
   * failure), UI text tiers and roles, and a syntax sample. Built-in,
   * Imported and Custom themes all preview through this one path.
   */
  private themePreviewRows(theme: CustomTheme, palette: NativePaletteId | undefined, columns: number, previewChroma = false): string[] {
    const base = this.promptConfiguration;
    // Preview Chroma Off (the default) shows the exact theme colors; On uses the saved Chroma. Nothing is persisted either way.
    const draft: PromptConfiguration = {...base, provider: 'nmsh', customTheme: theme, nmsh: {...base.nmsh, palette: palette ?? 'custom'},
      presentation: previewChroma ? base.presentation : {...base.presentation, preset: 'off'}};
    const width = Math.max(1, columns - 16);
    const level = colorLevel();
    const label = (text: string) => `  ${SECONDARY}${text.padEnd(12)}${RESET}`;
    const fg = (hex: string) => level === 'none' ? '' : colorEscape(38, parseHexColor(hex)!, level);
    const bg = (hex: string) => level === 'none' ? '' : colorEscape(48, parseHexColor(hex)!, level);
    const ui = theme.ui;
    return this.withDraftTheme(draft, () => {
      const showcase = {...draft, modules: draft.modules.map(module => ({...module, visible: true}))};
      return [
        `${label('Prompt')}${buildThemePreviewLine(draft, draft.nmsh.palette, width)}${RESET}`,
        `${label('Context')}${buildContextLine(moduleShowcaseContext(), width, showcase, 'composer', 0)}${RESET}`,
        truncateAnsi(`${label('Interface')}${fg(ui.primary)}Primary ${fg(ui.secondary)}Secondary ${fg(ui.subtle)}Muted ${fg(ui.accent)}● Accent ${fg(ui.separator)}│ ${RESET}${bg(ui.selection)}${fg(ui.primary)} Selected ${RESET}`, columns),
        truncateAnsi(`${label('Status')}${fg(ui.success)}${GLYPHS.success} done ${fg(ui.warning)}! warning ${fg(ui.failure)}${GLYPHS.failure} failed ${fg(ui.info)}i info${RESET}`, columns),
        `${label('Syntax')}${renderSyntaxPreviewLine('git commit -m "fix" && npm test', draft.syntax, draft.nmsh.palette)}${RESET}`,
      ];
    });
  }

  private renderThemeStudioRows(state: ThemeStudioState, columns: number): string[] {
    const context = this.studioContext();
    const shown = previewTheme(state, context);
    const rows = this.dimensions().rows;
    const preview = !shown || state.editor?.picker || rows < 24 ? [] : this.themePreviewRows(shown.theme, shown.palette, columns, state.previewChroma);
    return renderThemeStudio(state, context, columns, rows, colorLevel(), preview);
  }

  private handleThemeStudioKey(key: Key, state: ThemeStudioState): void {
    const action = studioKey(state, key, colorLevel(), this.shellCwd, this.studioContext());
    if (!action) return;
    if (action.kind === 'close') { this.themeStudio = undefined; this.returnFromPanel(); return; }
    const config = this.promptConfiguration;
    if (action.kind === 'export') {
      const asset = findTheme(config.themes, action.id);
      if (!asset) { state.message = 'That theme no longer exists.'; return; }
      try { state.message = `Exported to ${writeThemeExport(asset.theme)}`; }
      catch (error) { state.message = `Export failed: ${error instanceof Error ? error.message : String(error)}`; }
      return;
    }
    const result: ActionResult = action.kind === 'activate' ? setActiveTheme(config, action.ref)
      : action.kind === 'saveTheme' ? (action.id ? saveTheme(config, action.id, action.theme) : addTheme(config, action.theme))
        : action.kind === 'importTheme' ? addTheme(config, action.theme, action.origin)
          : action.kind === 'rename' ? renameTheme(config, action.id, action.name)
            : action.kind === 'duplicate' ? duplicateTheme(config, action.id)
              : action.kind === 'duplicateBuiltin' ? duplicateBuiltin(config, action.ref)
                : action.kind === 'duplicateCurrent' ? duplicateCurrentToCustom(config)
                  : deleteTheme(config, action.id, action.confirmIndependent);
    if (!result.ok) { state.message = result.error; return; }
    if (!this.applySettingsConfiguration(result.config)) return;
    state.message = result.message;
    // New and imported themes land on their tab, selected, ready to use or edit.
    if (result.id && (action.kind === 'importTheme' || action.kind === 'saveTheme' || action.kind.startsWith('duplicate'))) {
      const asset = findTheme(result.config.themes, result.id);
      if (asset) {
        const tab = asset.origin ? 'imported' : 'custom';
        state.tab = tab;
        state.focus = 'list';
        state.selected[tab] = result.config.themes.filter(item => Boolean(item.origin) === Boolean(asset.origin)).findIndex(item => item.id === asset.id) + (tab === 'custom' ? 2 : 0);
      }
    }
    if (action.kind === 'activate') this.startSweep('prompt', 'vivid');
  }

  // ---- Theme Bridge -----------------------------------------------------------

  private bridgeFacts?: Record<BridgeTargetId, TargetFacts>;
  private bridgeTimer?: NodeJS.Timeout;
  private bridgeRun?: Promise<ApplyOutcome[]>;
  /** The last Theme Bridge application problems, shown by /theme-bridge. */
  private bridgeProblems: ApplyOutcome[] = [];

  private async themeBridgeContext(): Promise<BridgeContext> {
    this.bridgeFacts ??= await detectTargets();
    const config = this.promptConfiguration;
    return {source: config, facts: this.bridgeFacts, level: colorLevel()};
  }

  /**
   * Debounced application of the current Theme Bridge state. With every
   * target Independent and nothing generated before, nothing is written at all.
   */
  private scheduleThemeBridge(delay = 150): void {
    if (this.bridgeTimer) clearTimeout(this.bridgeTimer);
    this.bridgeTimer = setTimeout(() => {
      this.bridgeTimer = undefined;
      if (this.stopped) return;
      const config = this.promptConfiguration;
      if (!anyBridgeTargetActive(config.themeBridge) && !bridgeStateExists()) return;
      this.bridgeRun = this.themeBridgeContext().then(applyThemeBridge).then(outcomes => {
        this.bridgeProblems = outcomes.filter(outcome => !outcome.ok);
        if (this.themeBridgePanel) this.render();
        return outcomes;
      }).catch(error => {
        this.bridgeProblems = [{target: 'pager', ok: false, message: error instanceof Error ? error.message : String(error)}];
        return this.bridgeProblems;
      });
    }, delay);
    this.bridgeTimer.unref?.();
  }

  /** OSC 7 / OSC 133 for capable hosts, held while a fullscreen program owns the terminal. */
  private readonly hostSemantics = new HostSemantics(semanticSupport(), data => { process.stdout.write(data); },
    () => this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended, undefined,
    {attached: () => this.presentationStarted && !this.stopped && !this.frontendSuspended, replaying: () => this.replaying});
  /** Opt-in OSC 2 title: written only while NMSh owns the screen, re-asserted after programs that set their own. */
  private readonly hostTitle = new HostTitle(titleSupport(), data => { process.stdout.write(data); },
    () => this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended && !this.replaying);

  /** A program, a nested shell or another frontend owned the terminal: cwd and title are re-asserted when NMSh has it back. */
  private noteForeignScreen(): void {
    this.hostSemantics.foreignScreen();
    this.hostTitle.foreign();
  }

  /** NMSh's title for this moment: Off returns undefined (the terminal keeps its own). Names are hostile data; HostTitle sanitizes. */
  private desiredTitle(): string | undefined {
    const mode = this.promptConfiguration.terminalTitle;
    if (mode === 'off') return undefined;
    const project = this.context.project && this.context.project !== '…' ? this.context.project : basename(this.shellCwd) || this.shellCwd;
    const session = this.sessionId ? sessionTitleName(this.sessionIdentity, this.noticeLabels.get(this.sessionId)) : undefined;
    const request = this.running && !this.passthrough ? this.inputState?.request : undefined;
    const running = request ? `${inputGlyph(request)} ${inputProgram(request, this.running!.command)} needs input`
      : this.running && !this.passthrough ? commandWords(this.running.command)[0] : undefined;
    return composeTitle(mode, project, session, running);
  }

  /** This session's own name and signature, as the service last reported them (attach, /rename, notice refresh). */
  private sessionIdentity?: {name?: string; signature?: string};

  private noteSessionIdentity(info: {name?: string; signature?: string} | undefined): void {
    if (!info) return;
    const next = {name: info.name, signature: info.signature};
    if (this.sessionIdentity?.name === next.name && this.sessionIdentity?.signature === next.signature) return;
    this.sessionIdentity = next;
    this.render();
  }

  /** One request at launch/reattach (never polled): the title and notices know who this session is without waiting for a refresh. */
  private async loadSessionIdentity(): Promise<void> {
    if (this.sessionMode !== 'service' || !this.sessionId) return;
    const sessions = await listLiveSessions().catch(() => []);
    if (!this.stopped) this.noteSessionIdentity(sessions.find(session => session.id === this.sessionId));
  }
  private themeBridgePanel?: ThemeBridgePanelState;
  private bridgeReports: TargetReport[] = [];
  /** A plan shown for confirmation, kept with what it came from; confirming applies exactly this plan. */
  private bridgePlan?: {target: BridgeTargetId; plan?: FileEditPlan; spec?: HookSpec; removal: boolean};
  /** bat setup awaiting confirmation: the source theme reference (possibly a fresh Custom duplicate). */
  private bridgeBatPlan?: {ref: string};
  /** Apply all: the reviewed include plans by target. */
  private bridgeReviewPlans = new Map<BridgeTargetId, {plan: FileEditPlan; spec: HookSpec}>();

  private async openThemeBridge(): Promise<void> {
    this.themeBridgePanel = createThemeBridgePanel();
    await this.refreshBridgeReports();
    this.render();
  }

  private async refreshBridgeReports(): Promise<void> {
    this.bridgeFacts ??= await detectTargets();
    this.bridgeReports = reportTargets(await this.themeBridgeContext());
  }

  private themeBridgePanelContext(): BridgePanelContext {
    const config = this.promptConfiguration;
    const ledger = loadLedger();
    const active = activeThemeRef(config);
    const bridge = config.themeBridge;
    return {enabled: bridge.enabled, policy: bridge.policy, ...(bridge.theme ? {globalTheme: bridge.theme, globalThemeLabel: themeRefLabel(bridge.theme, config)} : {}),
      reports: this.bridgeReports, themes: selectableThemes(config), pinned: target => bridge.targets[target].theme,
      ...(active ? {activeRef: active, activeLabel: themeRefLabel(active, config)} : {}),
      managed: target => target === 'tmux' || target === 'neovim' || target === 'vim' || target === 'helix' || target === 'bat'
        ? {...(ledger.entries[target] && ownership(target, ledger) === 'owned' ? {artifact: artifactPath(target)} : {}), ...(target !== 'bat' && recordedHook(target as HookTarget) ? {include: recordedHook(target as HookTarget)!.configPath} : {})}
        : undefined};
  }

  /** Save a Theme Bridge settings change and apply it at once (not debounced) so the panel status is factual. */
  private async saveBridge(change: (bridge: PromptConfiguration['themeBridge']) => void): Promise<boolean> {
    const config = structuredClone(this.promptConfiguration);
    change(config.themeBridge);
    if (!this.applySettingsConfiguration(config)) return false;
    if (this.bridgeTimer) { clearTimeout(this.bridgeTimer); this.bridgeTimer = undefined; }
    this.bridgeProblems = (await applyThemeBridge(await this.themeBridgeContext())).filter(outcome => !outcome.ok);
    return true;
  }

  private async handleThemeBridgeKey(key: Key, state: ThemeBridgePanelState): Promise<void> {
    const action = themeBridgePanelKey(state, key, this.themeBridgePanelContext());
    if (!action) { this.render(); return; }
    await this.handleThemeBridgeAction(action, state);
  }

  private async handleThemeBridgeAction(action: BridgePanelAction, state: ThemeBridgePanelState): Promise<void> {
    if (action.kind === 'close') { this.themeBridgePanel = undefined; this.bridgePlan = undefined; this.bridgeBatPlan = undefined; this.returnFromPanel(); this.render(); return; }
    const home = process.env.HOME || homedir();
    const problem = (target: BridgeTargetId) => this.bridgeProblems.find(outcome => outcome.target === target)?.message;
    if (action.kind === 'setEnabled') {
      if (await this.saveBridge(bridge => { bridge.enabled = action.enabled; })) {
        state.message = action.enabled ? 'Theme Bridge is On.' : 'Theme Bridge is Off; every tool is Independent and NMSh-set values are restored at the next prompt.';
      }
    } else if (action.kind === 'setPolicy') {
      // The per-target Manual settings are never rewritten by a global policy.
      if (await this.saveBridge(bridge => { bridge.policy = action.policy; if (action.theme) bridge.theme = action.theme; })) {
        state.message = `Apply themes · ${BRIDGE_POLICY_LABELS[action.policy]}${action.policy === 'manual' ? ' · each tool\'s own setting is back' : ''}`;
      }
    } else if (action.kind === 'setGlobalTheme') {
      if (await this.saveBridge(bridge => { bridge.theme = action.theme; })) state.message = `Every supported tool uses ${themeRefLabel(action.theme, this.promptConfiguration)}.`;
    } else if (action.kind === 'setMode') {
      if (await this.saveBridge(bridge => {
        const theme = action.theme ?? bridge.targets[action.target].theme;
        bridge.targets[action.target] = {mode: action.mode, ...(theme ? {theme} : {})};
        // Choosing a mode for a tool is the opt-in; Independent leaves the switch as it is.
        if (action.mode !== 'independent') bridge.enabled = true;
      })) {
        state.message = problem(action.target) ?? `${BRIDGE_TARGET_LABELS[action.target]} · ${BRIDGE_MODE_LABELS[action.mode]}${action.target === 'pager' || action.target === 'lsColors' ? ' · NMSh shells apply it at their next prompt' : ''}`;
      }
    } else if (action.kind === 'reloadTmux') {
      state.message = (await reloadTmux()).message;
    } else if (action.kind === 'planHook') {
      const target = action.target as HookTarget;
      const spec = hookSpec(target);
      if ('error' in spec) state.message = spec.error;
      else {
        const planned = planHook(spec, home);
        if ('error' in planned) state.message = planned.error;
        else if ('noop' in planned) state.message = 'The include is already in place.';
        else {
          this.bridgePlan = {target, plan: planned.plan, spec, removal: false};
          state.confirm = {kind: 'hook', target, path: spec.configPath, preview: planned.plan.preview};
        }
      }
    } else if (action.kind === 'planRemoval') {
      const target = action.target as HookTarget | 'bat';
      const hook = target === 'bat' ? undefined : recordedHook(target as HookTarget);
      if (!hook) {
        this.bridgePlan = {target, removal: true};
        state.confirm = {kind: 'removeSetup', target, path: artifactPath(target), preview: [`- ${artifactPath(target)} (NMSh-managed file; no config include is recorded)`]};
      } else {
        const planned = planHookRemoval(target as HookTarget, home);
        if ('error' in planned) state.message = planned.error;
        else {
          this.bridgePlan = {target, ...('plan' in planned ? {plan: planned.plan} : {}), removal: true};
          state.confirm = {kind: 'removeSetup', target, path: hook.configPath, preview: ['plan' in planned ? planned.plan.preview : ['  (the include is already gone from the file)'], [`- ${artifactPath(target)}`]].flat()};
        }
      }
    } else if (action.kind === 'confirmHook' || action.kind === 'confirmRemoval') {
      const pending = this.bridgePlan;
      this.bridgePlan = undefined;
      if (!pending || pending.target !== action.target) state.message = 'Nothing was changed.';
      else if (!pending.removal && pending.plan && pending.spec) {
        const result = applyHook(pending.target as HookTarget, pending.plan, pending.spec);
        state.message = result.ok ? `Added the include to ${pending.spec.configPath}. New ${BRIDGE_TARGET_LABELS[pending.target]} instances load NMSh colors; later theme changes update automatically${pending.target === 'tmux' ? ' (Reload applies them to the running server)' : ''}.` : result.error;
      } else if (pending.removal) {
        // Remove managed setup: NMSh's file and include only. The tool's mode is not changed behind the user's back.
        const removed = pending.target === 'bat' ? {ok: true as const} : applyHookRemoval(pending.target as HookTarget, pending.plan);
        if (!removed.ok) state.message = removed.error;
        else {
          const artifact = removeArtifact(pending.target as ManagedTarget);
          state.message = artifact.ok ? `${BRIDGE_TARGET_LABELS[pending.target]}: NMSh's managed setup is removed${bridgeMode(this.promptConfiguration.themeBridge, pending.target) !== 'independent' ? '; it reports Needs setup until set up again' : ''}.` : artifact.error;
          if (artifact.ok && pending.target !== 'bat') {
            // A target that is still active would regenerate its file at once; only Independent targets stay clean.
            if (bridgeMode(this.promptConfiguration.themeBridge, pending.target) !== 'independent') this.bridgeProblems = (await applyThemeBridge(await this.themeBridgeContext())).filter(outcome => !outcome.ok);
          }
        }
      }
    } else if (action.kind === 'planBat') {
      const reports = this.bridgeReports.find(report => report.target === 'bat');
      let ref = targetPalette(this.promptConfiguration.themeBridge, 'bat', this.promptConfiguration).ref ?? activeThemeRef(this.promptConfiguration);
      if (action.source === 'duplicate' && ref) {
        // An ordinary Custom copy of the source theme, editable in Theme Studio; bat then pins it (Manual).
        const copy = duplicateRefToCustom(this.promptConfiguration, ref);
        if (!copy.ok) { state.message = copy.error; this.render(); return; }
        const newRef = assetRef(copy.id!);
        const config = copy.config;
        config.themeBridge = {...config.themeBridge, policy: config.themeBridge.policy, targets: {...config.themeBridge.targets, bat: {mode: 'choose', theme: newRef}}};
        if (!this.applySettingsConfiguration(config)) { this.render(); return; }
        ref = newRef;
        state.message = `Created ${themeRefLabel(newRef, this.promptConfiguration)} (Custom). Edit it in /theme; bat ${this.promptConfiguration.themeBridge.policy === 'manual' ? 'is pinned to it' : 'uses it when Apply themes is Manual'}.`;
      }
      if (!ref) { state.message = 'No theme to create the bat theme from.'; this.render(); return; }
      this.bridgeBatPlan = {ref};
      void reports;
      state.confirm = {kind: 'batCache', target: 'bat', path: artifactPath('bat'), preview: [`+ ${artifactPath('bat')} (from ${themeRefLabel(ref, this.promptConfiguration)})`, '+ bat cache --build', '  bat --list-themes must then include nmsh-bridge; only then is BAT_THEME set in NMSh shells']};
    } else if (action.kind === 'confirmBat') {
      const pending = this.bridgeBatPlan;
      this.bridgeBatPlan = undefined;
      const resolved = pending ? resolveSemanticPalette(pending.ref, this.promptConfiguration) : undefined;
      if (!resolved?.ok) state.message = 'Nothing was changed.';
      else {
        const result = await setupBat(resolved.palette, bridgeMode(this.promptConfiguration.themeBridge, 'bat'), pending!.ref);
        state.message = result.message;
        this.bridgeProblems = (await applyThemeBridge(await this.themeBridgeContext())).filter(outcome => !outcome.ok);
      }
    } else if (action.kind === 'reviewAll') {
      const items = integrationHealth(await this.themeBridgeContext());
      const previews: Record<string, string[]> = {};
      this.bridgeReviewPlans.clear();
      for (const item of items) {
        if (item.action !== 'include') continue;
        const spec = hookSpec(item.target as HookTarget);
        if ('error' in spec) { item.action = undefined; item.state = 'conflict'; item.detail = spec.error; continue; }
        const planned = planHook(spec, home);
        if ('plan' in planned) { this.bridgeReviewPlans.set(item.target, {plan: planned.plan, spec}); previews[item.target] = [`${spec.configPath}`, ...planned.plan.preview.filter(line => line.startsWith('+'))]; }
        else { item.action = undefined; item.detail = 'error' in planned ? planned.error : 'Already in place'; item.state = 'error' in planned ? 'conflict' : 'ready'; }
      }
      for (const item of items) if (item.action === 'cache') previews[item.target] = [`+ ${artifactPath('bat')}`, '+ bat cache --build (then verified with bat --list-themes)'];
      state.review = {items, previews, yes: false};
    } else if (action.kind === 'applyAll') {
      const results: string[] = [];
      const context = await this.themeBridgeContext();
      for (const item of integrationHealth(context)) {
        if (item.action === 'generate') { const outcomes = await applyThemeBridge(context); results.push(`${item.label}: ${outcomes.find(outcome => outcome.target === item.target)?.message ?? 'generated'}`); }
        else if (item.action === 'include') {
          const reviewed = this.bridgeReviewPlans.get(item.target);
          if (!reviewed) { results.push(`${item.label}: skipped (not in the reviewed plan)`); continue; }
          const result = applyHook(item.target as HookTarget, reviewed.plan, reviewed.spec);
          results.push(`${item.label}: ${result.ok ? 'include added' : result.error}`);
        } else if (item.action === 'cache') {
          const palette = targetPalette(this.promptConfiguration.themeBridge, 'bat', this.promptConfiguration);
          const result = palette.palette ? await setupBat(palette.palette, bridgeMode(this.promptConfiguration.themeBridge, 'bat'), palette.ref ?? '') : {ok: false, message: 'no theme'};
          results.push(`${item.label}: ${result.ok ? 'ready' : result.message}`);
        }
      }
      this.bridgeReviewPlans.clear();
      this.bridgeProblems = (await applyThemeBridge(await this.themeBridgeContext())).filter(outcome => !outcome.ok);
      state.message = results.length ? results.join(' · ') : 'Nothing needed changing.';
    }
    await this.refreshBridgeReports();
    this.render();
  }

  /**
   * Picker orientation follows the composer: Bottom puts the query at the
   * bottom with results above (best match nearest the input), Top puts the
   * query at the top with results below. Flow keeps results below its input,
   * so it reads like Top; fullscreen external pickers use the bottom layout for Flow.
   */
  private pickerFromBottom(): boolean {
    return this.promptConfiguration.composerPosition === 'bottom';
  }

  private orientPicker(rows: string[]): string[] {
    return (this.historySearchActive || this.directorySearchActive) && this.pickerFromBottom() ? [...rows].reverse() : rows;
  }

  /** fzf layout for NMSh-owned launches: query at the bottom (fzf's default) unless the composer docks at the top. */
  private fzfLayout(): 'default' | 'reverse' {
    return this.promptConfiguration.composerPosition === 'top' ? 'reverse' : 'default';
  }

  // ---- Status strip, /configure, /tmux, /integrations -------------------------------

  private rowPanel?: RowPanelState;
  /** /copy as an Interactive Picker (Settings → Copy, or /copy ui). */
  private copyPicker?: CopyPickerState;
  /** /copy picks headed for a report (`/copy ui --report`). */
  private copyPickerReport?: ReportFormat;
  /** The review before a report is copied. */
  private reportReview?: ReportReviewState;
  /** Compare output…: choosing the other block, then the difference. */
  private comparePanel?: ComparePanelState;
  /** The native read-only viewer (/view, View output); owns keys while open. */
  private viewer?: ViewerState;
  /** A file /view is still reading; a newer request or Esc cancels it. */
  private viewerLoad?: AbortController;
  /** NMSh's small text editor (/edit, e in /view); owns keys while open. */
  private textEditor?: EditorState;
  private clipboardNote?: {text: string; tone: 'success' | 'info' | 'error'; until: number};
  private clipboardNoteTimer?: ReturnType<typeof setTimeout>;
  /** The block whose Copy control just succeeded (by startId), shown as "Copied" until `until`. */
  private copiedBlock?: {startId: number; until: number};
  private copiedBlockTimer?: ReturnType<typeof setTimeout>;
  private configureList?: ConfigureListState;
  private tmuxPanel?: TmuxPanelState;
  /** The include plan shown in the tmux review, applied exactly if confirmed. */
  private tmuxIncludePlan?: {plan: FileEditPlan; spec: HookSpec};

  private stripStudio?: StripStudioState;

  /** /strip and /status-strip: the Status Strip Studio over the canonical strip settings, previewed by the real strip renderer. */
  private openStatusStrip(): void {
    this.stripStudio = createStripStudio();
    this.requestContextDemand();
  }

  /** /configure [tool] and /tmux: the registered adapter's editor, or a factual answer. */
  private async openConfigure(tool: string | undefined, command: string): Promise<void> {
    if (!tool) { this.configureList = {selected: 0}; this.render(); return; }
    const entry = toolConfigEntry(tool);
    if (!entry) { this.output.addFrontendInteraction(command, `NMSh has no managed configuration adapter for ${tool}. /configure lists the tools it can configure.`, INFO); this.render(); return; }
    if (entry.id === 'starship') { void this.startToolConfiguration('starship'); return; }
    if (entry.id === 'tmux') {
      const user = readUserTmuxConfig();
      this.bridgeFacts ??= await detectTargets();
      const report = reportTargets(await this.themeBridgeContext()).find(item => item.target === 'tmux');
      this.tmuxPanel = createTmuxPanel(loadTmuxModel(), user ? {path: user.path, parsed: parseTmuxConfig(user.text)} : undefined,
        report ? `${BRIDGE_MODE_LABELS[report.mode]}${report.themeLabel && report.mode !== 'independent' ? ` · ${report.themeLabel}` : ''}` : 'Independent', Boolean(this.bridgeFacts.tmux?.installed));
      this.render();
      return;
    }
    if (entry.ownership === 'theme-bridge') { await this.openThemeBridge(); return; }
    this.output.addFrontendInteraction(command, `${entry.label}: ${entry.summary}.`, INFO);
    this.render();
  }

  /** /integrations: the shared Theme Bridge planner, opened straight on Review all. */
  private async openIntegrations(): Promise<void> {
    await this.openThemeBridge();
    if (this.themeBridgePanel) await this.handleThemeBridgeAction({kind: 'reviewAll'}, this.themeBridgePanel);
  }

  private dotfiles?: DotfilesState;
  private dotfilesInclude?: {plan: FileEditPlan; spec: HookSpec};

  /** /dotfiles actions: scanning reads data only; cloning needs the confirmed step; applying goes through the adapters. */
  private async handleDotfilesAction(action: DotfilesAction, state: DotfilesState): Promise<void> {
    if (action.kind === 'close') { this.dotfiles = undefined; this.dotfilesInclude = undefined; this.returnFromPanel(); return; }
    if (action.kind === 'scan') {
      if (isRemoteSource(action.source)) {
        const slug = action.source.replace(/^.*[/:]/u, '').replace(/\.git$/u, '').replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 60) || 'repository';
        state.clone = {url: action.source, target: join(nmshConfigDirectory(), 'dotfiles-inspect', `${slug}-${Date.now()}`), yes: false};
        state.step = 'clone';
        return;
      }
      const root = expandSource(action.source, this.shellCwd);
      const scan = scanDotfiles(root);
      if ('error' in scan) { state.message = scan.error; state.step = 'source'; return; }
      state.scan = scan;
      state.items = buildPlan(scan);
      state.selected = 0;
      state.step = 'items';
      return;
    }
    if (action.kind === 'clone' && state.clone) {
      const git = resolveCommand('git', process.env.PATH ?? '');
      if (!git) { state.message = 'git is not installed.'; state.step = 'source'; return; }
      state.message = 'Cloning…';
      this.render();
      const env = {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1'};
      const result = await runExternal(git, ['clone', '--depth', '1', '--no-recurse-submodules', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', '--', state.clone.url, state.clone.target],
        {timeoutMs: 120_000, maxBytes: 64 * 1024, env});
      if (!result.ok) { state.message = 'The clone failed; nothing else was done.'; state.step = 'source'; state.clone = undefined; return; }
      const target = state.clone.target;
      state.clone = undefined;
      await this.handleDotfilesAction({kind: 'scan', source: target}, state);
      return;
    }
    if (action.kind === 'review') {
      this.dotfilesInclude = undefined;
      const include: string[] = [];
      if (state.items.some(item => item.mode === 'import' && item.fields?.some(field => field.use)) && !recordedHook('tmux')) {
        const spec = hookSpec('tmux');
        if (!('error' in spec)) {
          const planned = planHook(spec, process.env.HOME || homedir());
          if ('plan' in planned) { this.dotfilesInclude = {plan: planned.plan, spec}; include.push(spec.configPath, ...planned.plan.preview.filter(line => line.startsWith('+'))); }
        }
      }
      state.review = {lines: reviewLines(state.items, include), yes: false};
      state.step = 'review';
      return;
    }
    if (action.kind === 'apply') {
      const results = applyDotfilesPlan(state.items);
      if (this.dotfilesInclude) {
        const included = applyHook('tmux', this.dotfilesInclude.plan, this.dotfilesInclude.spec);
        results.push(`tmux.conf: ${included.ok ? 'one include added' : included.error}`);
        this.dotfilesInclude = undefined;
      }
      state.results = results.length ? results : ['Nothing was selected, so nothing changed.'];
      state.step = 'result';
    }
  }

  private async handleTmuxKey(key: Key, state: TmuxPanelState): Promise<void> {
    const action = tmuxPanelKey(state, key);
    if (action?.kind === 'close') { this.tmuxPanel = undefined; this.tmuxIncludePlan = undefined; this.returnFromPanel(); }
    else if (action?.kind === 'openPrompt') { this.tmuxPanel = undefined; void this.startPromptSettings(false); }
    else if (action?.kind === 'openBridge') { this.tmuxPanel = undefined; await this.openThemeBridge(); }
    else if (action?.kind === 'reload') state.message = (await reloadTmux()).message;
    else if (action?.kind === 'review') {
      const include: string[] = [];
      this.tmuxIncludePlan = undefined;
      if (!recordedHook('tmux')) {
        const spec = hookSpec('tmux');
        if ('error' in spec) include.push(`  ${spec.error}`);
        else {
          const planned = planHook(spec, process.env.HOME || homedir());
          if ('plan' in planned) { this.tmuxIncludePlan = {plan: planned.plan, spec}; include.push(spec.configPath, ...planned.plan.preview); }
        }
      }
      state.review = {lines: pendingChanges(state).map(describeTmuxChange), include, yes: false};
    } else if (action?.kind === 'apply') {
      try {
        saveTmuxModel(state.draft);
        const written = writeTmuxManaged(state.draft);
        if (!written.ok) state.message = written.error;
        else {
          const included = this.tmuxIncludePlan ? applyHook('tmux', this.tmuxIncludePlan.plan, this.tmuxIncludePlan.spec) : {ok: true as const};
          this.tmuxIncludePlan = undefined;
          state.saved = structuredClone(state.draft);
          state.message = included.ok ? 'Saved to NMSh\'s managed tmux file. New tmux servers load it; R reloads a running server now.' : included.error;
        }
      } catch (error) { state.message = `Nothing was applied: ${error instanceof Error ? error.message : String(error)}`; }
    }
    this.render();
  }

  /** fzf `--color` for an NMSh-owned launch; empty unless fzf is the picker and its bridge mode is active. */
  private async fzfThemeArgs(): Promise<string[]> {
    const config = this.promptConfiguration;
    // The effective mode: Apply themes (Follow NMSh / Choose theme) decides over fzf's own Manual setting.
    if (config.picker !== 'fzf' || bridgeMode(config.themeBridge, 'fzf') === 'independent') return [];
    return fzfBridgeArgs(await this.themeBridgeContext());
  }

  /** less/man colors for a pager NMSh launches: the values NMSh shells get, only while that target is active. */
  private themeBridgePagerEnvironment(): Record<string, string> {
    const config = this.promptConfiguration;
    if (bridgeMode(config.themeBridge, 'pager') === 'independent') return {};
    const palette = targetPalette(config.themeBridge, 'pager', config).palette;
    if (!palette) return {};
    return Object.fromEntries(Object.entries(bridgePagerColors(palette, bridgeColorLevel(colorLevel(), process.env)))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
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
      && (!this.running || this.promptConfiguration.idleVisuals.runWhileBusy) && !this.startupPending && !this.settingsPanelActive && !this.paletteState && !this.presetStartup?.active
      && !this.pickerOpening && !this.updateInProgress && !this.agents.sessions.some(session => session.attention);
  }

  private onIdleTimeout(): void {
    const minutes = this.promptConfiguration.idleVisuals.timeout;
    if (!minutes) return;
    if (Date.now() - this.lastActivity < minutes * 60_000 - 50) { this.armIdle(); return; }
    // Reduced Motion: screen savers never start by themselves (a manual preview still works).
    const screenMode = SCREEN_MODE_EFFECT[this.promptConfiguration.idleVisuals.mode] !== undefined || this.promptConfiguration.idleVisuals.mode === 'random';
    if (screenMode && idleMotion(this.promptConfiguration).still) { this.lastActivity = Date.now(); this.armIdle(); return; }
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
    const configured = effectiveMode(this.promptConfiguration.idleVisuals.mode, motion);
    // The screen as the user sees it right now (or, from the gallery, as it was before the gallery opened).
    const wantsCapture = configured === 'random' || SCREEN_MODE_EFFECT[configured] !== undefined;
    const captureDimensions = this.dimensions();
    const captured = wantsCapture
      ? (this.screensaverPanel && this.saverCapture ? this.saverCapture : this.captureScreen(captureDimensions.columns, captureDimensions.rows)) : undefined;
    // Exclusive ownership: every other presentation owner stops before the first idle frame.
    // The gallery (if any) stays open underneath and resumes its own preview on dismissal.
    this.suspendPresentationOwners();
    const random = configured === 'random';
    const mode: IdleMode = random ? this.pickRandomSaver() : configured;
    this.idle = {mode, startedAt: Date.now(), frame: 0, interval: IDLE_FRAME_MS[mode], preview, paused: false, still: motion.still,
      ...(captured ? {capture: {...captured, instances: {}}} : {}), random, offset: 0};
    this.renderer.invalidate();
    this.paintIdle();
    if (!motion.still) this.idleSubscription = presentationClock.subscribe(now => this.tickIdle(now), this.idle.interval);
  }

  private captureScreen(columns: number, rows: number): ScreenCapture {
    return captureFromRows(this.renderer.snapshot(), columns, rows, isDeterministicPresentation() ? IDLE_SEED : (Date.now() ^ (process.pid << 8)) >>> 0);
  }

  private pickRandomSaver(previous?: IdleMode): IdleMode {
    return (pickRandomSaver(this.randomSaver, previous) ?? 'blackHole') as IdleMode;
  }

  private tickIdle(now: number): void {
    const idle = this.idle;
    if (!idle || idle.paused) return;
    idle.frame += 1;
    // Random switches only when the current effect finished a full loop, never mid-effect.
    if (idle.random) {
      const {columns, rows} = this.dimensions();
      const sceneNow = isDeterministicPresentation() ? idle.frame * (SAVER_FRAME_MS[idle.mode] ?? 66) : now - idle.startedAt;
      if (saverLoopComplete(idle.mode, {elapsed: sceneNow - idle.offset, width: columns, height: rows, ...(idle.capture ? {capture: idle.capture} : {})})) {
        idle.mode = this.pickRandomSaver(idle.mode);
        if (idle.capture) idle.capture = {...idle.capture, instances: {}};
        idle.offset = sceneNow;
        idle.interval = SAVER_FRAME_MS[idle.mode] ?? 66;
        this.stopIdleFrames();
        this.idleSubscription = presentationClock.subscribe(next => this.tickIdle(next), idle.interval);
      }
    }
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
    const frame = idleFrameRows(this.idleGrid, {mode: idle.mode, width: columns, height: rows, time: Math.max(0, time - idle.offset),
      palette: idlePaletteFor(this.promptConfiguration), level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd', ...(idle.capture ? {capture: idle.capture} : {})});
    const shown = this.saverAwake(frame, columns, now);
    try { this.renderer.render({rows: shown, columns, cursorRow: 1, cursorColumn: 1, cursorVisible: false}); }
    catch (error) { this.onTerminate(); throw error; }
  }

  /** The screensaver's positioned Keep Awake status: a small separate element; the saver and mascot are untouched. */
  private saverAwake(frame: string[], columns: number, now: number): string[] {
    const record = this.awakeRecord;
    const settings = this.promptConfiguration.keepAwake;
    if (!record || !settings.screensaver) return frame;
    const text = `${awakeLabel(record, settings.display, 'full')} · ${awakeDuration(record, now)}`;
    return placeOnSaver(frame, columns, {ansi: `${awakeStyle.active()}${text}${awakeStyle.reset}`, width: displayWidth(text)}, settings.screensaverPosition,
      (row, column, ansi, width) => `${sliceAnsiCells(row, 0, column)}${RESET}${' '.repeat(Math.max(0, column - Math.min(column, displayWidth(stripAnsi(sliceAnsiCells(row, 0, column))))))}${ansi}${sliceAnsiCells(row, column + width, columns)}${RESET}`);
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
  private stopSetupPlayback(): void { this.setupCursorClock?.(); this.setupCursorClock = undefined; }

  private setupPlayback(state: SetupState, busy: boolean): void {
    if (busy && !this.setupCursorClock) this.setupCursorClock = presentationClock.subscribe(() => {
      if (this.setupState === state && !this.stopped) this.render();
      else { this.stopSetupPlayback(); }
    }, 80);
    else if (!busy) { this.stopSetupPlayback(); }
  }

  private setupPreview(state: SetupState, columns: number): string[] {
    const section0 = SETUP_SECTIONS[state.section]?.id;
    // Look and Prompt previews show the draft's Chroma as soon as it is on; P compares with the base theme.
    const chromaStep = section0 === 'appearance' || section0 === 'prompt';
    const shown = chromaStep && setupShowsChroma(state);
    const rawPreview = chromaStep && !shown;
    const draft = rawPreview ? {...state.draft, presentation: {...state.draft.presentation, preset: 'off' as const}} : state.draft;
    const preset = state.draft.presentation.preset;
    // One line each where they fit; in a narrower preview (beside the rows) they wrap rather than being cut off.
    const noteWidth = Math.max(10, columns - 4);
    const chromaLabel = preset === 'off' ? 'Off' : TREATMENT_PRESET_LABELS[preset];
    const chromaHint = `preview shows ${shown ? 'it' : 'the base theme'}${preset === 'off' ? '' : `  ·  P ${shown ? 'compares with the base theme' : 'shows Chroma again'}`}`;
    const chromaNote = !chromaStep ? [] : displayWidth(`Chroma setting  ${chromaLabel}  ·  ${chromaHint}`) <= noteWidth
      ? [`  ${PRIMARY}\u001b[1mChroma setting${RESET}  ${SECONDARY}${chromaLabel}${RESET}  ${SUBTLE}·  ${chromaHint}${RESET}`, `  ${SECONDARY}${chromaVisibilityNote(state.draft)}${RESET}`]
      : [`  ${PRIMARY}\u001b[1mChroma setting${RESET}  ${SECONDARY}${chromaLabel}${RESET}`, ...wrapWords(chromaHint.replace(/ {2}· {2}/gu, ' · '), noteWidth).map(line => `  ${SUBTLE}${line}${RESET}`),
        ...wrapWords(chromaVisibilityNote(state.draft), noteWidth).map(line => `  ${SECONDARY}${line}${RESET}`)];
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
        break;
      }
      case 'cursor': {
        // The selected row, demonstrated by the same preview /cursor shows; it restarts when the row or a value changes.
        const selected = setupSelectedRow(state);
        const id = selected?.row.id ?? 'cursorShape';
        const scene = id === 'cursorShape' ? 'shape' : id === 'cursorBlink' ? 'blink' : id === 'cursorIdle' ? 'idle' : 'jump';
        const signature = `${id}|${JSON.stringify(draft.cursor)}`;
        const now = Date.now();
        if (state.previewKey !== signature) { state.previewKey = signature; state.previewStart = now; }
        const env = this.cursorEnv(draft.cursor, draft);
        const reason = selected && id !== 'cursorBlink' ? selected.row.unavailable?.(draft) : undefined;
        const shown = renderCursorPreview({scene, title: selected ? `${selected.row.label}: ${settingsRowValue(selected.row, draft) ?? ''}` : 'Cursor', settings: resolveCursorSettings(draft.cursor, env.context),
          choice: env.choice, columns, elapsed: now - (state.previewStart ?? now), still: env.still, ...(reason ? {unavailable: reason} : {})});
        rows.push(...shown.rows);
        if (shown.busy && !this.setupCursorClock) this.setupCursorClock = presentationClock.subscribe(() => { if (this.setupState) this.render(); }, 40, 16);
        else if (!shown.busy && this.setupCursorClock) { this.setupCursorClock(); this.setupCursorClock = undefined; }
        break;
      }
      case 'motion': {
        // The selected motion, run once on sample content by the same renderer /appearance → Motion uses; it restarts on a new row or value.
        const selected = setupSelectedRow(state);
        const item = MOTION_ROWS.find(entry => `motion_${entry.key}` === selected?.row.id) ?? MOTION_ROWS.find(entry => entry.key === 'commandLaunch')!;
        const gate: MotionGate = {reducedMotion: draft.presentation.reducedMotion || isReducedMotion(), effectsOff: draft.presentation.effectsOff, color: colorLevel() !== 'none'};
        const signature = `${item.key}|${JSON.stringify(draft.motion)}|${gate.reducedMotion}|${gate.effectsOff}`;
        const now = Date.now();
        if (state.previewKey !== signature) { state.previewKey = signature; state.previewStart = now; }
        // Reduced Motion and Decorative effects head this step: say what they hold still, above the motion they govern.
        rows.push(`  ${SUBTLE}${draft.presentation.effectsOff ? 'Decorative effects Off: Chroma motion, sparkles, shimmer and idle visuals stay still.'
          : gate.reducedMotion ? 'Reduced Motion: colors stay, movement stops (Chroma, motion below, cursor effects).' : 'Decorative effects On: Chroma motion and effects may move.'}${RESET}`);
        if (selected?.row.id === 'shimmer') {
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
          } else rows.push(`${label('Shimmer')}${SUBTLE}Off: no sweep of light${RESET}`);
          // No looping motion preview runs behind the one-shot sweep.
          if (this.setupCursorClock) { this.setupCursorClock(); this.setupCursorClock = undefined; }
          break;
        }
        const shown = renderMotionPreview(item.key, draft.motion, gate, columns, state.previewStart ?? now, now);
        rows.push(`  ${SUBTLE}Preview · ${item.label} · ${draft.motion.rendering === 'rich' ? 'Rich' : 'Clean'}${RESET}`, ...shown.rows);
        if (shown.busy && !this.setupCursorClock) this.setupCursorClock = presentationClock.subscribe(() => { if (this.setupState) this.render(); }, 40, 16);
        else if (!shown.busy && this.setupCursorClock) { this.setupCursorClock(); this.setupCursorClock = undefined; }
        break;
      }
      case 'prompt': {
        if (draft.provider === 'nmsh') {
          rows.push(`${label('Prompt')}${buildContextLine(themePreviewContext(), width - 12, draft, 'composer', Date.now())}${RESET}`);
          rows.push(`${label('Composer')}${ACCENT}${GLYPHS.prompt}${RESET} ${PRIMARY}git status${RESET}`);
          animate ||= treatmentAnimated(draft.presentation);
          break;
        }
        if (draft.provider === 'none') {
          rows.push(`${label('Prompt')}${SUBTLE}None · composer only${RESET}`, `${label('Composer')}${ACCENT}${GLYPHS.prompt}${RESET} ${PRIMARY}git status${RESET}`);
          rows.push(`  ${SUBTLE}${providerExplanation('prompt', draft.provider)}${RESET}`);
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
        if (draft.statusStrip.enabled) rows.push(`${label('Strip')}${stripAnsi(renderStatusStrip(draft.statusStrip, stripStatsFromFacts(this.contextEngine.facts()), Math.min(60, width - 12))).trim()}`);
        break;
      }
      case 'idle': {
        // The activity rows show the running and finished wording, not the screen saver.
        const selectedId = setupSelectedRow(state)?.row.id;
        if (selectedId === 'activityStyle' || selectedId === 'activityColors' || selectedId === 'setupActivityColors') {
          rows.push(...this.setupActivityPreview(draft, state));
          animate = !motion.still && !motion.disabled;
          break;
        }
        if (motion.disabled) { rows.push(`  ${SUBTLE}Decorative effects Off: idle visuals stay off.${RESET}`); break; }
        const mode = effectiveMode(draft.idleVisuals.mode, motion);
        // The real saver over a sample screen (the screen-animating ones need one), restarted when the mode changes;
        // Random shows each saver it can choose, in turn, and says which.
        const signature = `idle|${mode}`;
        const now = Date.now();
        if (state.previewKey !== signature) { state.previewKey = signature; state.previewStart = now; }
        const preview = idlePreviewRows(this.screensaverGrid, {mode, width: Math.max(10, Math.min(56, columns - 6)), height: 7, palette: idlePaletteFor(draft),
          level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd', elapsed: now - (state.previewStart ?? now), still: motion.still, sample: this.idleSample});
        rows.push(`  ${SUBTLE}Preview · ${mode === 'random' ? `Random · now ${IDLE_MODE_LABELS[preview.shown]}` : IDLE_MODE_LABELS[preview.shown]}${SCREEN_MODE_EFFECT[preview.shown] ? ' · over a sample screen; it animates your real screen' : ''}${motion.still ? ' · still (Reduced Motion)' : ''}${RESET}`,
          ...preview.rows.map(line => `  ${line}`));
        animate = !motion.still;
        break;
      }
      case 'tools': {
        for (const tool of TOOLS.filter(item => item.tier === 'recommended')) {
          const status = state.context.statuses[tool.executable ?? ''] ?? this.toolStatuses.get(tool.id);
          const installed = status?.state === 'installed' ? `${SUCCESS}installed${RESET}` : status?.state === 'missing' ? `${SUBTLE}not installed${RESET}`
            : status?.state === 'unknown' ? `${WARNING}unable to verify${RESET}` : `${SUBTLE}…${RESET}`;
          rows.push(`${label(tool.label)}${installed}  ${SUBTLE}${tool.description}${RESET}`);
        }
        break;
      }
    }
    if (animate && !this.screensaverAnimation) {
      this.screensaverAnimation = presentationClock.subscribe(() => { if (this.setupState) this.render(); }, 150);
    } else if (!animate && this.screensaverAnimation) { this.screensaverAnimation(); this.screensaverAnimation = undefined; }
    return [...chromaNote, ...rows].map(row => truncateAnsi(row, columns - 2));
  }

  /**
   * The live activity wording as a command shows it, through the real renderers: while it runs (with the live
   * activity colors and sweep), when it finishes, and when it fails, which stays factual in every style.
   */
  private setupActivityPreview(draft: PromptConfiguration, state: SetupState): string[] {
    const expressive = draft.liveActivity.style === 'expressive';
    const pair = expressive ? {active: 'Cooking', complete: 'Cooked'} : undefined;
    const now = Date.now();
    const signature = `activity|${draft.liveActivity.style}|${JSON.stringify(draft.liveActivity)}`;
    if (state.previewKey !== signature) { state.previewKey = signature; state.previewStart = now; }
    const elapsed = now - (state.previewStart ?? now);
    const still = !this.decorativeMotionAllowed() || sweepStill(draft);
    const parts = liveActivityParts('npm run build', 4200, still ? 0 : elapsed, pair);
    const {cells, style} = liveActivityPaint(parts.phrase, draft, still ? 0 : elapsed, still);
    const running = `${sweepCells(cells, still ? 0 : elapsed, style, colorLevel(), still)}${SECONDARY}${parts.duration}${RESET}`;
    const at = new Date(2026, 0, 1, 14, 46);
    const done = completedActivity('npm run build', 18_000, at, 0, false, undefined, pair);
    const failed = completedActivity('npm run build', 2000, at, 1, false, undefined, pair);
    const label = (text: string) => `  ${SECONDARY}${text.padEnd(11)}${RESET}`;
    return [
      `  ${PRIMARY}\u001b[1m${expressive ? 'Expressive' : 'Classic'}${RESET}  ${SECONDARY}${expressive ? 'a phrase while it runs, its past tense when done' : 'plain words: Running, then Completed'}${RESET}`,
      '',
      `${label('Running')}${running}`,
      `${label('Completed')}${SUCCESS}${done.main}${RESET}${SECONDARY}${done.detail}${RESET}`,
      `${label('Failed')}${ERROR}${failed.main}${RESET}${SECONDARY}${failed.detail}${RESET}`,
      '',
      `  ${SECONDARY}Failures and interrupts always keep their plain wording and exit code.${RESET}`,
    ];
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

  /** The step's name: it takes the current one-shot sweep when the step changes; otherwise it rests. */
  private setupTitle(state: SetupState): string {
    const text = SETUP_SECTIONS[state.section]?.title ?? 'Setup Cat';
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
    return rows.findIndex(row => /^\s*[›>] +\S/u.test(stripAnsi(row)));
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

  private openScreensaverGallery(): void {
    const {columns, rows} = this.dimensions();
    this.saverCapture = this.captureScreen(columns, rows);
    this.saverGalleryCapture = undefined;
    this.screensaverPanel = createScreensaverPanel(Date.now());
  }

  private renderScreensaverRows(state: ScreensaverPanelState, columns: number): string[] {
    const {rows} = this.dimensions();
    const settings = this.promptConfiguration.idleVisuals;
    const motion = idleMotion(this.promptConfiguration);
    const size = previewSize(columns, rows);
    const mode = effectiveMode(settings.mode, motion);
    const elapsed = Date.now() - state.startedAt;
    // Screen savers preview over the real screen snapshot taken when the gallery opened (cropped to the preview box);
    // Random previews each saver it can choose, in turn.
    const previewMode: IdleMode = previewSaver(mode, elapsed).mode;
    let capture: ScreenCapture | undefined;
    if (SCREEN_MODE_EFFECT[previewMode] && this.saverCapture) {
      if (!this.saverGalleryCapture || this.saverGalleryCapture.width !== Math.min(size.width, this.saverCapture.width) || this.saverGalleryCapture.height !== Math.min(size.height, this.saverCapture.height) || this.saverGalleryMode !== previewMode) {
        this.saverGalleryCapture = cropCapture(this.saverCapture, size.width, size.height); this.saverGalleryMode = previewMode;
      }
      capture = this.saverGalleryCapture;
    }
    const preview = motion.disabled ? [] : idlePreviewRows(this.screensaverGrid, {mode, width: capture?.width ?? size.width, height: capture?.height ?? size.height,
      elapsed, still: motion.still, palette: idlePaletteFor(this.promptConfiguration), level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd',
      ...(capture ? {capture} : {}), sample: this.idleSample}).rows;
    // A real animated preview while the gallery is open; one timer, removed with the panel.
    if (!motion.still && !motion.disabled && !this.screensaverAnimation) {
      this.screensaverAnimation = presentationClock.subscribe(() => { if (this.screensaverPanel) this.render(); }, Math.max(120, IDLE_FRAME_MS[mode]));
    }
    return renderScreensaverPanel(state, columns, rows, {settings, motion, preview});
  }

  private handleScreensaverKey(key: Key, state: ScreensaverPanelState): void {
    const action = screensaverKey(state, key, this.promptConfiguration.idleVisuals, this.promptConfiguration);
    if (!action) return;
    if (action.kind === 'replay') {
      // Restart from the pristine snapshot: a fresh clock and a fresh effect instance, no stacked timers.
      state.startedAt = Date.now();
      this.saverGalleryCapture = undefined;
      if (!idleMotion(this.promptConfiguration).still) this.render();
      return;
    }
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

  /** The configuration a color editor works on: Setup's unapplied draft when opened from it, otherwise the saved one. */
  private editorBase(): PromptConfiguration {
    return this.panelOrigin === 'setup' && this.parkedSetup ? this.parkedSetup.state.draft : this.promptConfiguration;
  }

  private openStopsEditor(target: 'idle' | 'activity'): void {
    const config = this.editorBase();
    const stops = target === 'idle' ? config.idleVisuals.customStops : config.liveActivity.customStops;
    this.stopsEditor = {target, gradient: {stops: [...(stops.length >= MIN_CUSTOM_STOPS ? stops : PRESET_STOPS.lavender)], index: 0}};
  }

  /** The draft stops applied to a copy of the configuration, for live previews. */
  private stopsDraft(editor: NonNullable<TerminalApp['stopsEditor']>): PromptConfiguration {
    const config = this.editorBase();
    const customStops = editor.gradient.stops.length >= MIN_CUSTOM_STOPS ? [...editor.gradient.stops] : [...PRESET_STOPS.lavender];
    return editor.target === 'idle'
      ? {...config, idleVisuals: {...config.idleVisuals, colorSource: 'custom', customStops}}
      : {...config, liveActivity: {...config.liveActivity, colors: 'custom', customStops}};
  }

  /**
   * Shared stop editor keys. S applies (into Setup's draft when opened from Setup, saved otherwise); Esc cancels and
   * goes back to the setting that opened it, with nothing changed.
   */
  private handleStopsEditorKey(key: Key, editor: NonNullable<TerminalApp['stopsEditor']>): void {
    const base = this.editorBase();
    const saved = editor.target === 'idle' ? base.idleVisuals.customStops : base.liveActivity.customStops;
    const apply = isApplyKey(editor.gradient, key);
    if (!apply && gradientEditorKey(editor.gradient, key, () => saved.length >= MIN_CUSTOM_STOPS ? saved : PRESET_STOPS.lavender)) return;
    if (!apply && key.kind !== 'escape' && key.kind !== 'interrupt') return;
    if (apply && this.panelOrigin === 'setup' && this.parkedSetup) this.parkedSetup.state.draft = this.stopsDraft(editor);
    else if (apply && this.applySettingsConfiguration(this.stopsDraft(editor))) this.armIdle();
    else if (apply) return;
    this.stopsEditor = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.returnFromPanel();
  }

  private renderStopsEditor(editor: NonNullable<TerminalApp['stopsEditor']>, columns: number): string[] {
    const draft = this.stopsDraft(editor);
    const title = editor.target === 'idle' ? 'Idle visuals · Custom colors' : 'Live activity · Custom colors';
    const rows = ['', ...renderGradientEditorRows(editor.gradient, title).map(row => `  ${row}`), '', `  ${SUBTLE}${GLYPHS.separator.repeat(2)} Preview${RESET}`];
    if (editor.target === 'idle') {
      rows.push(...idlePreviewRows(this.screensaverGrid, {mode: draft.idleVisuals.mode, width: Math.max(10, Math.min(56, columns - 6)), height: 5,
        palette: idlePaletteFor(draft), level: colorLevel(), nerd: getCurrentGlyphMode() === 'nerd', elapsed: 2000, still: true, sample: this.idleSample}).rows.map(line => `  ${line}`));
    } else {
      const {cells, style} = liveActivityPaint('• Running sleep 5 · ', draft);
      rows.push(`  ${sweepCells(cells, Number.POSITIVE_INFINITY, style, colorLevel(), true)}${SECONDARY}3.4s${RESET}`,
        `  ${SUBTLE}Only live work uses these colors; finished commands show their plain success or failure.${RESET}`);
    }
    rows.push('', ...renderControlRows(gradientEditorControls(editor.gradient, true), Math.max(10, columns - 4)).map(row => `  ${row}`));
    return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, this.dimensions().rows));
  }

  private setupCursorClock?: () => void;

  private handleSetupCursorKey(key: Key, state: SetupState, panel: CursorPanelState): void {
    const action = cursorPanelKey(panel, key, this.cursorEnv(panel.draft, state.draft));
    if (!action) return;
    if (action.kind === 'close') { state.cursorPanel = undefined; this.cursorPanelClock?.(); this.cursorPanelClock = undefined; return; }
    if (action.kind === 'apply') state.draft = {...state.draft, cursor: action.settings};
    if (action.kind === 'apply' && action.close) { state.cursorPanel = undefined; this.cursorPanelClock?.(); this.cursorPanelClock = undefined; }
  }

  /**
   * A on the selector: the backdrop is saved at once (local presentation state, never exported). The selector's saved
   * copy and draft follow, so a later Apply keeps it; a failed save is shown and the selector keeps working.
   */
  private saveOnboardingBackdrop(state: SetupState, backdrop: OnboardingBackdrop): void {
    const next = {...this.promptConfiguration, onboardingBackdrop: backdrop};
    try {
      savePromptConfiguration(next, undefined, this.promptConfiguration);
      this.promptConfiguration = next;
      state.saved.onboardingBackdrop = backdrop; state.draft.onboardingBackdrop = backdrop;
      state.message = undefined;
    } catch (error) { state.message = `The backdrop could not be saved: ${error instanceof Error ? error.message : String(error)}`; }
  }

  /** Presets deliberately bypass discovery; completed or already-introduced installs never reopen setup. */
  private startOnboarding(): void {
    if (this.presetStartup || this.attachedSession) return;
    if (!this.promptConfiguration.onboardingComplete && !this.promptConfiguration.introSeen) {
      this.startSetup('quick');
      this.setupState!.onboarding = true;
      this.output.setWelcomeVisible(false);
      this.offerFirstRunWindow(this.setupState!);
      const next = {...this.promptConfiguration, introSeen: true};
      try {
        savePromptConfiguration(next, undefined, this.promptConfiguration);
        this.promptConfiguration = next;
        this.setupState!.saved.introSeen = true; this.setupState!.draft.introSeen = true;
      } catch (error) { this.setupState!.message = `Setup state could not be saved: ${error instanceof Error ? error.message : String(error)}`; }
    } else if (this.promptConfiguration.onboardingComplete && !this.promptConfiguration.toolsSetupComplete) this.startTools(true);
  }

  /**
   * The one-time window offer of the genuine first run (never /startup, never a later launch): a read-only probe in
   * the background, and the offer row only once the host has proven the window is NMSh's own and unmaximized.
   * Process memory only; nothing about it is saved. Tests substitute the factory; nothing is probed outside a
   * real terminal window.
   */
  private createFirstRunWindow: () => FirstRunWindow | undefined = () => new FirstRunWindow(() => windowHost(systemWindowContext()));
  private firstRunWindow?: FirstRunWindow;
  /** Apply started the ending: the window is put back only once it has finished. */
  private restoreWindowAfterEnding = false;
  /** The tools panel the review chose, opened once the ending has landed (never over it). */
  private toolsAfterEnding?: {tier?: ToolTier | 'all'; preselect: boolean; fromSetup?: boolean};

  private offerFirstRunWindow(state: SetupState): void {
    const window = this.firstRunWindow = this.createFirstRunWindow();
    if (!window) return;
    void window.probe().then(offer => {
      if (!offer || this.stopped || this.setupState !== state || !state.quick || !window.offered) return;
      state.quick.windowOffer = true;
      this.render();
    });
  }

  /** M: maximize once; a host that refuses is said once, quietly, and setup goes on at the current size. */
  private acceptFirstRunWindow(state: SetupState): void {
    void this.firstRunWindow?.accept().then(outcome => {
      if (outcome === undefined || outcome === 'maximized' || this.stopped || this.setupState !== state) return;
      state.message = 'This window could not be maximized, so setup continues at its current size.';
      this.render();
    });
  }

  /** Onboarding is over: put back only what NMSh changed, only if it is still as NMSh left it (a no-op otherwise). */
  private restoreFirstRunWindow(): void {
    this.restoreWindowAfterEnding = false;
    void this.firstRunWindow?.restore();
  }

  private startSetup(entry?: string): void {
    this.setupExternalPrompt = undefined;
    this.stopSetupPlayback();
    const state = this.setupState = entry === 'quick' ? createQuickSetup(this.promptConfiguration) : createSetup(this.promptConfiguration, entry);
    if (!state.quick) void this.loadSetupContext(state);
    else void this.loadStartupEvidence(state);
  }

  /**
   * Keep Existing's read-only evidence: read once per open (and again for R), in the background; keys never wait for it.
   * Only the latest read for the open selector lands. If the environment cannot be read, Keep Existing says so and
   * still offers Composer only or NMSh Minimal.
   */
  private startupEvidenceRead = 0;
  /** The read-only detector (tests substitute fixed evidence so no tool runs). */
  private detectStartupEnvironment: () => Promise<EnvironmentEvidence> = () => detectEnvironment();
  private async loadStartupEvidence(state: SetupState): Promise<void> {
    const read = ++this.startupEvidenceRead;
    let evidence: EnvironmentEvidence;
    try { evidence = await this.detectStartupEnvironment(); }
    catch {
      const shell = process.env.SHELL?.split('/').at(-1) ?? 'your shell';
      evidence = {shell: {label: shell}, files: [], prompts: [], custom: [], tools: [], notes: ['NMSh could not read your startup files; nothing was changed.']};
    }
    if (this.stopped || this.setupState !== state || read !== this.startupEvidenceRead) return;
    setStartupEvidence(state, evidence);
    if (state.context.startup) state.context.startup.sample = undefined;
    this.render();
    void this.loadStartupSample(state, evidence, read);
  }

  /**
   * Keep Existing shows the detected Starship prompt as NMSh will draw it: the real adapter, once, in this directory.
   * Starship's cache points somewhere uncreatable, so nothing is written. Powerlevel10k and Oh My Posh keep a caption:
   * they are not run before Apply.
   */
  private async loadStartupSample(state: SetupState, evidence: EnvironmentEvidence, read: number): Promise<void> {
    const plan = keepExistingPlan(evidence, state.saved, state.quick?.keep.redetect ?? false);
    const starship = evidence.prompts.find(prompt => prompt.id === 'starship' && prompt.runnable && prompt.binary);
    const offered = plan.kept?.id === 'starship' || plan.question?.options.some(option => option.answer === 'starship');
    if (!starship?.binary || !offered) return;
    try {
      const status: StarshipStatus = {installed: true, binary: starship.binary, configPath: starship.configPath ?? normalizeStarshipConfigPath(process.env), configExists: starship.configExists};
      const result = await renderStarshipPrompt(this.context, status, {...process.env, STARSHIP_CACHE: '/dev/null/nmsh-read-only'});
      if (this.stopped || this.setupState !== state || read !== this.startupEvidenceRead || !state.context.startup) return;
      state.context.startup.sample = result.ansi;
      this.render();
    } catch { /* The caption stays: Starship draws this row from your own config. */ }
  }

  /** Provider install state and completion facts, detected once per Setup Cat open; never on render. */
  private async loadSetupContext(state: SetupState): Promise<void> {
    const descriptors = [...PICKER_PROVIDERS, ...NAVIGATION_PROVIDERS, ...HISTORY_PROVIDERS, ...SUGGESTION_PROVIDERS, ...WELCOME_PROVIDERS]
      .filter(descriptor => descriptor.kind === 'external' && descriptor.executable);
    const statuses: Record<string, ProviderStatus> = {};
    const facts = this.semanticService.completionFacts().then(result => {
      state.context = {...state.context, completion: result ?? {zshCompletions: false, fzfTab: false, completionSystem: false}};
    });
    // A failed or slow check is Unable to verify, never Not installed, and never blocks Setup.
    await Promise.all(descriptors.map(async descriptor => { statuses[descriptor.executable!] = await verified(() => detectProvider(descriptor)); }));
    const starship = await verified(() => detectProvider({id: 'starship', family: 'prompt', label: 'Starship', kind: 'external', description: '', executable: 'starship'}));
    statuses.starship = starship;
    for (const tool of TOOLS.filter(item => item.tier === 'recommended')) {
      const status = await verifyTool(tool);
      this.toolStatuses.set(tool.id, status);
      if (tool.executable) statuses[tool.executable] ??= status;
    }
    state.context = {...state.context, statuses};
    // Theme Bridge targets present on this system (PATH facts; cached for the session).
    this.bridgeFacts ??= await detectTargets();
    state.context = {...state.context, bridgeTargets: (Object.entries(this.bridgeFacts) as Array<[BridgeTargetId, TargetFacts]>).filter(([, facts]) => facts.installed).map(([target]) => target)};
    await facts;
    if (!this.stopped && this.setupState === state) this.render();
  }

  private handleSetupKey(key: Key, state: SetupState): void {
    if (state.toolBrowser) { void this.handleSetupToolsKey(key, state, state.toolBrowser); return; }
    if (state.cursorPanel) { this.handleSetupCursorKey(key, state, state.cursorPanel); return; }
    this.stopSetupPlayback();
    const result = setupKey(state, key);
    if (!result) return;
    if (result.kind === 'manual') { void this.loadSetupContext(state); return; }
    if (result.kind === 'backdrop') { this.saveOnboardingBackdrop(state, result.backdrop); return; }
    if (result.kind === 'maximize') { this.acceptFirstRunWindow(state); return; }
    if (result.kind === 'keepSize') { this.firstRunWindow?.decline(); return; }
    if (result.kind === 'redetect') { void this.loadStartupEvidence(state); return; }
    if (result.kind === 'browseTools') { this.openSetupToolBrowser(state, result.toolId); return; }
    if (result.kind === 'open') {
      // The editor opens over Setup Cat; nothing is applied or saved on the way in or out.
      this.stopSetupPlayback();
      this.parkedSetup = {state, knew: structuredClone(this.promptConfiguration)};
      this.setupState = undefined;
      this.panelOrigin = 'setup';
      this.openDestinationPanel(result.destination);
      return;
    }
    if (result.kind === 'cursorEditor') {
      // The shared /cursor panel over the draft's cursor settings: changes land in the draft, nothing is saved until Apply.
      const panel = state.cursorPanel = createCursorPanel(state.draft.cursor, Date.now(), {embedded: true, advanced: result.advanced, ...(result.row ? {row: result.row} : {})});
      // Custom colors open their editor at once; applying or cancelling it comes straight back to this step.
      if (result.row === 'fireEdit' || result.row === 'idleEdit' || result.row === 'colorCustom') openCursorEditor(panel, result.row, this.cursorEnv(panel.draft, state.draft));
      return;
    }
    if (result.kind === 'cancel') {
      const firstRun = Boolean(state.onboarding && state.quick);
      this.setupState = undefined; this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
      // Leaving the first run applies nothing; one quiet line says so and how to come back.
      if (firstRun) this.output.addHistoryLine(`${SUBTLE}Setup closed. Nothing was applied · /startup reopens it${RESET}`);
      if (state.onboarding) this.restoreFirstRunWindow();
      this.returnFromPanel(); return;
    }
    const previous = this.promptConfiguration;
    const configured = result.tools !== 'keep' ? {...result.configuration, toolsSetupComplete: true} : result.configuration;
    const next = state.onboarding ? {...configured, onboardingComplete: true, glyphChoiceComplete: true, toolsSetupComplete: true} : configured;
    const fromSelector = Boolean(state.quick);
    const startingPoint: StartingPointId = result.startingPoint ?? 'customize';
    // A genuine first run is welcomed once, whichever starting point it chose; every later Apply gets one receipt line.
    const welcome = fromSelector && Boolean(state.onboarding);
    if ((result.changed || state.onboarding) && !setupIsIdempotent({...state, draft: next})) {
      if (!this.applySettingsConfiguration(next)) { state.message = 'Could not save. Your draft is kept; retry Apply or Esc to cancel.'; return; }
      this.armIdle();
      if (previous.suggestions !== next.suggestions) this.applySuggestionProvider();
      if (previous.history !== next.history) void this.loadHistory();
      if (previous.navigation !== next.navigation) { this.directoryQueryAbort?.abort(); this.directoryQuery = undefined; this.directoryResults = []; }
      if (previous.provider !== next.provider) void this.refreshProviderPrompt().then(() => this.render());
      if (fromSelector) this.addStartingPointContent(state, startingPoint, next, welcome);
      else this.output.addFrontendInteraction('/setup', 'Setup Cat applied your changes. Customize anytime with /setup.', SUCCESS);
      if (this.cursorReload && JSON.stringify(previous.cursor) !== JSON.stringify(next.cursor)) this.output.addFrontendInteraction('/setup', this.cursorReload, INFO);
      // From the selector the ending is the presentation; elsewhere the prompt gets its sweep.
      if (!fromSelector && !next.presentation.effectsOff) this.startSweep('prompt', 'vivid');
    } else if (fromSelector) this.output.addHistoryLine(this.startingPointReceipt(state, startingPoint, next, true));
    else this.output.addFrontendInteraction('/setup', 'Setup Cat: no changes; your settings are unchanged.', INFO);
    this.setupState = undefined;
    this.stopSetupPlayback();
    if (state.onboarding && !welcome) this.output.setWelcomeVisible(false);
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.panelOrigin = undefined;
    const understanding = next.localUnderstanding;
    const understandingFollows = understanding.mode !== 'off' && (understanding.ask || understanding.folding)
      && JSON.stringify(previous.localUnderstanding) !== JSON.stringify(understanding);
    const tools = result.tools;
    // The selector folds away into the real transcript and composer, unless model setup opens next.
    if (fromSelector && !understandingFollows) this.beginStartupEnding(state, welcome);
    // A window maximized for setup goes back once the ending has finished (never mid-transition), or now.
    if (state.onboarding) {
      if (this.startupEnding) this.restoreWindowAfterEnding = true;
      else this.restoreFirstRunWindow();
    }
    // Auto or Always with a use enabled: continue straight into model setup (the same /llm controller), detecting first.
    if (understandingFollows) { this.openUnderstandingPanel(true); return; }
    if (tools === 'recommended' || tools === 'enhanced' || tools === 'individual') {
      // The same tools panel and installer as /tools: Review and install recommended ticks the missing ones once
      // they are verified; nothing installs until its own confirmation. After the ending, when one runs.
      // Recommended and Recommended + Enhanced open on their own view with its missing tools ticked; Choose
      // individually opens on every curated tool with nothing ticked.
      const options = {tier: tools === 'individual' ? 'all' as const : tools, preselect: result.preselect ?? (tools !== 'individual'), fromSetup: true};
      if (this.startupEnding) this.toolsAfterEnding = options;
      else this.startTools(false, options);
    }
  }

  /**
   * What Apply adds to the real transcript (no command echo, no fake prompt): on a genuine first run, Vespyr's block
   * and the first-run welcome, once, for any starting point; otherwise one receipt line.
   */
  private addStartingPointContent(state: SetupState, startingPoint: StartingPointId, next: PromptConfiguration, welcome: boolean): void {
    if (welcome) {
      // Vespyr's block this once, whatever the welcome preference (later launches follow it), then the first-run welcome.
      this.output.setWelcome(createWelcomeSnapshot(this.buildIdentity, this.context.cwd || this.initialCwd, this.shellId, this.welcomeUnderstanding()));
      this.output.setFirstRunWelcome({version: 1});
      return;
    }
    this.output.addHistoryLine(this.startingPointReceipt(state, startingPoint, next, false));
  }

  private startingPointReceipt(state: SetupState, startingPoint: StartingPointId, next: PromptConfiguration, unchanged: boolean): string {
    const tail = '/startup changes it anytime';
    let text: string;
    switch (startingPoint) {
      case 'recommended': text = `NMSh Recommended is ready · ${tail}`; break;
      case 'minimal': text = `Minimal Terminal is ready · ${next.composerLayout === 'oneLine' ? 'One-line' : 'Two-line'} · ${tail}`; break;
      case 'customize': text = `${unchanged ? 'Nothing changed' : 'Your settings are applied'} · /setup changes them anytime`; break;
      case 'existing': {
        const prompt = next.provider === 'starship' ? 'Starship' : next.provider === 'powerlevel10k' ? 'Powerlevel10k' : next.provider === 'ohMyPosh' ? 'Oh My Posh' : undefined;
        const shell = state.quick?.evidence?.shell.id ?? next.shellBackend;
        text = `Keeping your setup · ${[prompt, shell, unchanged ? 'nothing changed' : undefined].filter(Boolean).join(' · ')} · ${tail}`;
        break;
      }
    }
    const mark = getCurrentGlyphMode() === 'nerd' ? '✓' : '+';
    return `${foreground(UI_COLORS.success)}${mark}${RESET} ${SECONDARY}${text}${RESET}`;
  }

  /** The ending after Apply (see ending.ts): one presentation-only transition over the real frame, on its own clock. */
  private startupEnding?: StartupEnding;
  private startupEndingClock?: () => void;
  private readonly endingSky = new CellGrid();
  private endingBlink = false;
  /** Frame rows of the first-run welcome and their line numbers, recorded by the last full render. */
  private welcomeFrameRows = new Map<number, number>();

  /**
   * The ending is the selector's own exit, so it moves only where the selector's sky could: never under Reduced
   * Motion or Effects Off in the configuration the selector ran under, or without color. Then the completed state
   * simply appears.
   */
  private beginStartupEnding(state: SetupState, welcome: boolean): void {
    const quick = state.quick;
    const ran = state.saved.presentation;
    if (!quick || isReducedMotion() || ran.reducedMotion || ran.effectsOff || this.promptConfiguration.presentation.reducedMotion || colorLevel() === 'none') return;
    const {columns, rows} = this.dimensions();
    const layout = startupLayout(columns, rows);
    const skyHeight = quick.manual || layout.tier === 'tiny' ? 0 : layout.skyHeight;
    // Vespyr stood on the horizon where the selector drew it.
    const catX = skyHeight ? startupCatX(columns, layout) : undefined;
    const shown = this.presentationFrame?.frame.rows ?? [];
    this.startupEnding = {start: Date.now(), columns, rows, skyHeight, backdrop: quick.backdrop, config: structuredClone(state.saved),
      sky: {started: quick.sky.started, mood: STARTING_POINT_MOODS[startingPointAt(quick.choice)], previousMood: STARTING_POINT_MOODS[startingPointAt(quick.previousChoice)],
        changedAt: quick.changedAt, from: quick.sky.from, timeAt: quick.sky.timeAt, activeAt: quick.sky.activeAt},
      ground: shown.slice(skyHeight), ...(catX === undefined ? {} : {catX}), welcome, welcomeLines: welcome ? Math.max(0, ...renderFirstRunWelcome(columns).map(row => row.firstRunLine ?? 0)) : 0, sweep: sweepStyleFor(this.promptConfiguration)};
    this.startupEndingClock?.();
    this.startupEndingClock = presentationClock.subscribe(now => this.tickStartupEnding(now), 40, 16);
  }

  private tickStartupEnding(now: number): void {
    const ending = this.startupEnding;
    if (!ending || this.stopped) { this.stopStartupEnding(); return; }
    // Vespyr blinks once while the welcome arrives (the welcome rows are the transcript's own, so this is a full render).
    if (ending.welcome) {
      const t = now - ending.start;
      const blink = t >= WELCOME_START_MS + 600 && t < WELCOME_START_MS + 750;
      if (blink !== this.endingBlink) { this.endingBlink = blink; this.output.setWelcomeFrame(blink ? 'blink' : 'open'); this.render(); return; }
    }
    this.paintPresentation(now);
  }

  /** Ends the transition where it is: the next paint is the real frame alone. */
  private stopStartupEnding(): void {
    this.startupEnding = undefined;
    this.startupEndingClock?.(); this.startupEndingClock = undefined;
    if (this.endingBlink) { this.endingBlink = false; this.output.setWelcomeFrame('open'); }
    if (this.restoreWindowAfterEnding) this.restoreFirstRunWindow();
    const tools = this.toolsAfterEnding;
    this.toolsAfterEnding = undefined;
    if (tools && !this.stopped) this.startTools(false, tools);
  }

  /** A key or a resize finishes the ending at once; the key is then handled normally. */
  private finishStartupEnding(): void {
    if (!this.startupEnding) return;
    this.stopStartupEnding();
    this.render();
  }

  /**
   * The shared tool browser inside Setup Cat: the same panel, recipes, previews, confirmation and
   * installer as /tools. The Setup Cat draft and step are untouched; Esc returns to them.
   */
  private openSetupToolBrowser(state: SetupState, toolId?: string): void {
    const config = state.draft;
    const browser = createToolsPanel(new Set([config.history, config.picker, config.navigation, config.welcome, config.provider]));
    browser.updates = this.toolUpdates;
    browser.back = true;
    browser.tier = 'enhanced';
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
  /** One line for an exact curated command that is not installed; undefined for unknown commands (nothing is invented). */
  private knownMissingNote(command: string): string | undefined {
    const word = commandWord(command);
    const tool = word ? knownToolForExecutable(word) : undefined;
    if (!word || !tool || resolveCommand(word) !== undefined) return undefined;
    const provided = tool.package && tool.package !== word ? ` · provided by ${tool.package}` : '';
    return `${tool.label} is not installed${provided} · install it from /tools`;
  }

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
    const editorRows = (() => {
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
    })();
    // Named sections: the same facts as before, grouped so Status reads as a short report instead of one list.
    return [
      statusSection('Build & Platform', [
        {label: 'Version', value: build.version},
        {label: 'Installed', value: installProvenanceLabel()},
        {label: 'Build', value: `${build.commit}${build.branch ? ` (${build.branch}${build.dirty ? ', dirty' : ''})` : ''}`, tone: build.commit === 'unknown' ? 'muted' : undefined},
        {label: 'Platform', value: `${process.platform} ${process.arch}`},
        {label: 'Platform support', value: this.platformInfo.support, tone: this.platformInfo.wsl?.version === 1 ? 'warning' as const : undefined},
        {label: 'Node', value: process.version},
      ]),
      statusSection('Updates', this.updateStatusRows()),
      statusSection('Shell & Session', [
        {label: 'Shell', value: `${shellAdapter(this.shellId).label}${this.shellId === this.promptConfiguration.shellBackend ? '' : ` (default for new sessions: ${shellAdapter(this.promptConfiguration.shellBackend).label})`}`},
        {label: 'Shell capabilities', value: (() => { const caps = shellAdapter(this.shellId).capabilities; return `completion ${caps.completion}${caps.completionDescriptions ? ' + descriptions' : ''} · live names ${caps.liveNames ? 'yes' : 'no'} · history import ${caps.historyImport ? 'yes' : 'no'}`; })()},
        {label: 'Session', value: this.sessionId ? `live · ${this.sessionId}` : 'in-process', tone: this.sessionMode === 'service' ? undefined : 'muted'},
        ...(this.sessionMode === 'service' ? [
          {label: 'Session service', value: this.session.serviceBuild ? `connected · ${this.session.serviceBuild}` : 'connected · older build (no build reported)'},
          {label: 'Shell switching', value: this.session.features.has('shell-switch') ? 'available' : 'unavailable (older service; ends with its sessions)',
            ...(this.session.features.has('shell-switch') ? {} : {tone: 'warning' as const})},
          ...(this.session.features.has('notices') ? [] : [{label: 'Session notices', value: 'basic (older service reports no notices)', tone: 'muted' as const}]),
        ] : []),
        {label: 'Working directory', value: tilde(this.shellCwd)},
      ]),
      statusSection('Terminal', [
        ...(terminal ? [{label: 'Terminal', value: terminal}] : []),
        {label: 'Host capabilities', value: Object.entries(this.host.capabilities).filter(([, value]) => value === true).map(([key]) => key).join(', ') || 'baseline'},
        {label: 'Terminal size', value: `${columns}×${rows}`},
      ]),
      statusSection('Local Understanding', understandingStatusRows(this.promptConfiguration.localUnderstanding, this.understanding.status)
        .map(row => ({label: row.label, value: row.value}))),
      statusSection('NMSh & Providers', [
        {label: 'Prompt provider', value: providerLabel(config.provider)},
        ...(active !== config.provider ? [{label: 'Active prompt', value: `${providerLabel(active)} (fallback)`, tone: 'warning' as const}] : []),
        {label: 'Composer', value: layoutLabel(config)},
        {label: 'Glyph style', value: config.glyphStyle === 'nerd' ? 'Nerd Font' : 'Safe / ASCII'},
        {label: 'Syntax', value: !config.syntax.highlighting ? 'Off' : config.syntax.colors === 'followPrompt' ? 'Follow prompt theme' : config.syntax.colors === 'theme' ? 'Choose theme' : 'Grayscale'},
        {label: 'Directory navigation', value: this.directoryService.status.detail ?? this.directoryService.status.active},
        {label: 'Picker', value: this.promptConfiguration.picker},
        {label: 'Command history', value: this.historyService.status.detail ?? (this.historyService.status.active === 'atuin' ? 'Atuin · local read-only' : 'NMSh Native')},
        ...editorRows,
        {label: 'Completion sources', value: this.completionService.sourceIds.join(' + ')},
        {label: 'History colors', value: config.transcript.historyColors === 'followPrompt' ? 'Follow prompt' : config.transcript.historyColors === 'theme' ? 'Theme' : 'Grayscale'},
      ]),
      statusSection('Shell Environment', shellEnvironmentRows(this.shellEnvironment, {id: this.shellId, ...(shellAdapter(this.shellId).resolveExecutable(process.env) ? {path: shellAdapter(this.shellId).resolveExecutable(process.env)!} : {})}).map(([label, value]) => ({label, value}))),
      statusSection('Services & Activity', [
        {label: 'Session notices', value: config.sessionNotices ? (this.sessionMode === 'service' ? 'On' : 'On (needs the live-session service)') : 'Off'},
        {label: 'Agent activity', value: config.agentActivity ? 'On · local only' : 'Off'},
      ]),
      statusSection('Storage', [
        {label: 'Session journal', value: this.journalActive ? 'active' : 'inactive', tone: this.journalActive ? 'success' : 'warning'},
        {label: 'Session retention', value: config.sessionRetention === null ? 'unlimited' : `${config.sessionRetention} sessions`},
        {label: 'Config file', value: tilde(promptConfigurationPath()), tone: 'muted'},
        {label: 'Runtime directory', value: tilde(defaultRuntimeDir()), tone: 'muted'},
      ]),
    ].filter(section => section.length > 0);
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
    this.syncQueuePolicy();
    setIconStyle(next.glyphStyle);
    if (next.idleVisuals.timeout !== this.idleArmedFor) { this.idleArmedFor = next.idleVisuals.timeout; this.armIdle(); }
    this.output.setWelcomeVisible(next.welcome !== 'none');
    if (next.welcome === 'none') this.welcomeGeneration++;
    this.output.setTranscriptAppearance(next.transcript);
    this.output.presenter.setTreatment(next.presentation);
    this.output.setOutputFolding(next.outputFolding);
    this.output.setSemanticOutput(next.semanticOutput);
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
    this.output.setWelcomeVisible(provider !== 'none');
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
    if (this.editor.hasPasteAtoms || this.historySearchActive || isSlashInput(text)) {
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
      if (state.family === 'welcome') this.output.setWelcomeVisible(next.welcome !== 'none');
      if (state.family === 'suggestions') this.applySuggestionProvider();
      if (state.family === 'history') void this.loadHistory();
      if (state.family === 'navigation') { this.directoryQueryAbort?.abort(); this.directoryQuery = undefined; this.directoryResults = []; }
      // Opened from Settings or Setup: back there, where the new value shows; no second announcement.
      if (!this.panelOrigin) this.output.addHistoryLine(state.family === 'welcome'
        ? `${SUCCESS}Welcome · ${selected.label} · shown on launch and /clear.${RESET}`
        : `${SUCCESS}${state.title} · ${selected.label}.${RESET}`);
      this.returnFromPanel();
    } catch (error) {
      state.message = `Could not save: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private startTranscriptSettings(): void {
    const saved = structuredClone(this.promptConfiguration.transcript);
    const folding = this.promptConfiguration.outputFolding;
    this.transcriptPanelState = {selectedIndex: 0, draft: structuredClone(saved), saved, folding: {draft: folding, saved: folding},
      presentation: {draft: this.promptConfiguration.transcriptPresentation, saved: this.promptConfiguration.transcriptPresentation}};
  }

  /** A representative history header: the live provider's identity over preview-only modules. */
  private transcriptPreviewSample(): HistoricalContextSnapshot {
    const context = themePreviewContext();
    const prompt = this.effectivePromptProvider === 'none' ? undefined : this.effectivePromptProvider !== 'nmsh' && this.externalPrompt
      ? this.currentPromptSnapshot()
      : nativePromptSnapshot(context, this.promptConfiguration);
    return {cwd: context.cwd, project: context.project, branch: context.branch, ...(prompt ? {prompt} : {promptless: true as const})};
  }

  private saveTranscriptSettings(): void {
    const state = this.transcriptPanelState;
    if (!state) return;
    const next = {...structuredClone(this.promptConfiguration), transcript: structuredClone(state.draft),
      outputFolding: state.folding?.draft ?? this.promptConfiguration.outputFolding,
      transcriptPresentation: state.presentation?.draft ?? this.promptConfiguration.transcriptPresentation};
    try {
      savePromptConfiguration(next, undefined, this.promptConfiguration);
      this.promptConfiguration = next;
      this.output.setWelcomeVisible(next.welcome !== 'none');
      if (next.welcome === 'none') this.welcomeGeneration++;
      this.output.setTranscriptAppearance(next.transcript);
      this.output.setOutputFolding(next.outputFolding);
    this.output.setSemanticOutput(next.semanticOutput);
      this.output.presenter.setTreatment(next.presentation);
      this.output.presenter.setLayout(next.transcriptPresentation);
      this.transcriptPanelState = undefined;
      if (!this.panelOrigin) this.output.addHistoryLine(`${SUCCESS}Transcript settings saved.${RESET}`);
      this.returnFromPanel();
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
    if (state.step === 'modules') state.context = this.modulesContext();
    // Module facts win over the prompt preview: details, confirmations and narrow panels drop it first.
    const modulesWithoutPreview = state.step === 'modules' && (Boolean(state.detail || state.confirm) || columns < 72 || this.dimensions().rows < 30);
    const preview = state.step.startsWith('install') || modulesWithoutPreview ? [] : this.chromaPanelActive(state) ? this.chromaPanelPreview(columns, now) : this.promptPanelPreview(columns);
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
    if (!state || state.step !== 'appearance' || state.view === 'git' || state.view === 'rail') return [];
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
    if (this.effectivePromptProvider === 'none') return false;
    if (this.effectivePromptProvider !== 'nmsh') return Boolean(this.externalPrompt?.text.trim());
    return hasVisibleContextModule(this.promptConfiguration, this.promptContext(), isOnCommandRelevant);
  }

  private currentPromptLine(width: number, time = Date.now()): string {
    if (this.effectivePromptProvider === 'none') return '';
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
    if (!this.editor.hasPasteAtoms && isSlashInput(this.editor.text)) return slashSuggestions(this.editor.text);
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
    if (isSlashInput(this.editor.text)) {
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

  /** The panel position being shown: Setup previews its unsaved draft so the choice is visible immediately. */
  private panelPositionInEffect(): 'bottom' | 'top' {
    return (this.setupState?.draft ?? this.promptConfiguration).panelPosition === 'top' ? 'top' : 'bottom';
  }

  private planFrame(
    columns: number,
    rows: number,
    fullInput = this.layoutEditorInput(columns),
    suggestions = this.composerSuggestions().length,
    panelRows = this.settingsPanelActive ? this.settingsPanelRows(columns).length : undefined,
  ): ScreenPlan {
    // The status strip owns one top row only when it is on, fits, and no panel owns the screen.
    if (panelRows === undefined && this.stripActive(columns, rows)) return withStatusRow(this.planWithNotices(columns, rows - 1, fullInput, suggestions, panelRows), this.promptConfiguration.statusStrip.edge);
    return this.planWithNotices(columns, rows, fullInput, suggestions, panelRows);
  }

  private planWithNotices(columns: number, rows: number, fullInput: ReturnType<TerminalApp['layoutEditorInput']>, suggestions: number,
    panelRows: number | undefined): ScreenPlan {
    const find = panelRows === undefined ? this.searchChrome(columns).length : 0;
    const count = panelRows === undefined ? this.noticeRows(columns).length : 0;
    // Notices never squeeze the composer or transcript out: small screens simply do not show them.
    const notices = count > 0 && rows - find >= 12 + count ? count : 0;
    const plan = this.planComposer(columns, rows - notices - find, fullInput, suggestions, panelRows);
    // Keep Awake: decided against this geometry; an adjacent row (when needed and the screen has room) sits closest to the composer.
    const decision = this.awakeDecision(plan, columns);
    const wanted = this.awakeAdjacentRows(decision);
    const awakeRows = wanted && rows - notices - find >= 10 + wanted ? wanted : 0;
    const base = awakeRows ? this.planComposer(columns, rows - notices - find - awakeRows, fullInput, suggestions, panelRows) : plan;
    const awake = decision && (decision.slot !== 'adjacentRow' || awakeRows) ? decision : undefined;
    // The find bar sits right above the composer, notices above it.
    return withNoticeRows(withNoticeRows(withNoticeRows({...base, ...(awake ? {awake} : {})}, find, 'find'), notices), awakeRows, 'awake');
  }

  /** One compact line per notice (max three, the last may summarize overflow). */
  private noticeRows(columns: number): string[] {
    // The agent shelf shares this chrome slot (and the screen plan's rows): hidden at rest, never a permanent row.
    const shelf = this.shelfRow(columns);
    const now = Date.now();
    const suggestion = this.clipboardChangeSuggested && !this.running && this.clipboardChangeWatch?.enabled
      ? [truncateAnsi(`${SUBTLE}Clipboard changed · /ps reads it for review${RESET}`, columns)] : [];
    const rows = [...this.clipboardRows(columns), ...suggestion, ...this.sessionNoticeRows(columns), ...this.taskRows(columns), ...watchNoticeRows(this.watches.active(), now).map(row => truncateAnsi(row, columns)), ...this.pastePreviewRows(columns)];
    const background = this.backgroundRows(columns);
    return shelf ? [...rows, ...background, shelf] : [...rows, ...background];
  }

  /** The shell grammar this session's shell speaks, for splitting a paste into commands (none for other shells). */
  private batchShell(): BatchShell | undefined {
    return this.shellId === 'zsh' || this.shellId === 'bash' || this.shellId === 'fish' ? this.shellId : undefined;
  }

  /** A paste can be offered as a queue of commands: the queue is available and the shell's grammar says it splits cleanly. */
  private batchAvailable(text: string): boolean {
    const shell = this.batchShell();
    return Boolean(shell && this.queueAvailable() && text.includes('\n') && createBatchReview(text, shell, 1));
  }

  /**
   * B: split the paste, have the real shell parse-check every command on its own (it never runs them), and only then
   * show the review. A boundary the shell does not accept means command separation is refused with a clear explanation,
   * while still providing Run as block, Edit, or Cancel choices.
   */
  private async openBatchReview(text: string): Promise<void> {
    const shell = this.batchShell();
    if (!shell) return;
    const capacity = Math.max(0, QUEUE_LIMIT - this.queueState.entries.length);
    const review = createBatchReview(text, shell, capacity);
    if (!review) {
      const refusal = batchRefusal(text, shell) ?? 'Separation was refused.';
      this.batchReview = createBatchReviewWithRefusal(text, shell, capacity, refusal);
      this.render();
      return;
    }
    const check = await verifyCommands(batchTexts(review), shell);
    if (this.stopped || this.pastePreview?.text !== text) return;
    if (check.ok) {
      review.note = [review.note, this.queuePolicyNote()].filter(Boolean).join(' · ');
      this.batchReview = review;
    } else {
      this.batchReview = createBatchReviewWithRefusal(text, shell, capacity, check.reason);
      this.pastePreview = {...this.pastePreview, batch: false};
      if (this.pasteReview) this.pasteReview.batch = false;
    }
    this.render();
  }

  /**
   * Run the reviewed paste as one outer execution in the real shell.
   * Grouped blocks remain one observed outer execution.
   */
  private async runReviewedBlock(text: string): Promise<void> {
    if (this.running) {
      this.output.addFrontendInteraction('/ps', 'A command is running: wait for it to complete or choose Queue separately.', ERROR);
      return;
    }
    this.editor.replaceText(text);
    await this.submit(true, true, false);
  }

  /** /ps: read the clipboard now, once, and bring it to paste review. Nothing is kept, inserted or run by reading it. */
  private async pasteClipboard(command: string): Promise<void> {
    if (this.running) { this.output.addFrontendInteraction(command, 'A command is running: /ps pastes at the prompt. Use your terminal\'s paste to send text to the program.', INFO); return; }
    let text: string;
    try { text = await this.readClipboardText(); }
    catch (error) {
      this.output.addFrontendInteraction(command, error instanceof ClipboardUnavailableError ? error.message : `Could not read the clipboard: ${error instanceof Error ? error.message : String(error)}`, ERROR);
      return;
    }
    if (this.stopped) return;
    if (!text.trim()) { this.output.addFrontendInteraction(command, 'The clipboard is empty.', INFO); return; }
    this.clipboardChangeSuggested = false;
    const analysis = analyzePaste(text);
    const batch = this.batchAvailable(text);
    this.pastePreview = {text, analysis, batch};
    // An explicit /ps always shows the review first, whatever Paste Preview is set to.
    this.pasteReview = createPasteReview(text, analysis, batch, this.shellId);
  }

  /** Explicit staging only: never reads the clipboard, writes files or submits commands. */
  private keepClip(text: string, source: Clip['source'], cwd?: string, session: string | null | undefined = this.sessionId): void {
    const added = this.clips.add(text, {source, cwd, ...(session ? {session} : {})});
    this.output.addFrontendInteraction('/clips', added.ok
      ? `Kept clip ${added.clip.id} in memory for this frontend. /clips reviews it before insertion.${added.dropped ? ` Discarded ${added.dropped} oldest clip(s) to stay within the memory limit.` : ''}`
      : added.reason, added.ok ? INFO : ERROR);
  }

  private openClips(): void {
    const clips = this.clips.list();
    if (!clips.length) { this.output.addFrontendInteraction('/clips', 'No clips kept. Use C in Paste Review, a block’s Actions, or Keep composer draft as clip in the palette. Clips disappear when this frontend exits.', INFO); return; }
    const items: PaletteItem[] = clips.flatMap(clip => {
      const detail = `${clip.source} · ${displaySafe(clip.text.replace(/[\r\n]/gu, ' ')).slice(0, 160)}`;
      return [{id: `clip:${clip.id}:review`, label: `Review clip ${clip.id}`, detail, category: 'Transcript', action: {kind: 'clip', id: clip.id, verb: 'review'}},
        {id: `clip:${clip.id}:remove`, label: `Discard clip ${clip.id}`, detail, category: 'Transcript', action: {kind: 'clip', id: clip.id, verb: 'remove'}}];
    });
    items.push({id: 'clips:clear', label: 'Discard all session clips', detail: 'Remove all staged text from this frontend’s memory', category: 'Transcript', action: {kind: 'clearClips'}});
    this.paletteState = createPalette(items);
  }

  private configureClipboardChanges(enabled: boolean): void {
    if (!enabled) {
      this.clipboardChangeWatch?.stop(); this.clipboardChangeSuggested = false;
      this.output.addFrontendInteraction('/clips', 'Clipboard-change suggestions off for this frontend.', INFO);
      return;
    }
    if (!this.clipboardChangeCounter) {
      this.output.addFrontendInteraction('/clips', 'Clipboard-change metadata is unavailable on this platform. /ps still reads text only when requested.', INFO);
      return;
    }
    this.clipboardChangeWatch ??= new ClipboardChangeWatch({counter: this.clipboardChangeCounter,
      idle: () => !this.stopped && !this.running && !this.externalPassthrough && !this.startupPending && !this.settingsPanelActive && !this.editor.text,
      changed: () => { this.clipboardChangeSuggested = true; this.render(); },
      failed: () => {
        this.clipboardChangeSuggested = false;
        this.output.addFrontendInteraction('/clips', 'Clipboard-change metadata became unavailable; suggestions disabled.', INFO); this.render();
      }});
    this.clipboardChangeSuggested = false;
    this.clipboardChangeWatch.start();
    this.output.addFrontendInteraction('/clips', 'Clipboard-change suggestions on for this frontend. Only a native change counter is read while idle; /ps explicitly reads text. /clips suggestions off stops them.', INFO);
  }

  // ---------------------------------------------------------------- pins and recipes

  private openPins(options: {naming?: string[]} = {}): void {
    const loaded = loadPins();
    if (!loaded.ok) { this.output.addFrontendInteraction('/pins', loaded.reason, ERROR); return; }
    this.pinsPanel = createPinsPanel(loaded.value, this.shellCwd, {composerText: this.editor.text, canEdit: Boolean(configuredEditor(process.env)), ...(options.naming ? {naming: options.naming} : {})});
  }

  /** Pin from a block: kept as written, global until you scope it in /pins; nothing about its output is kept. */
  private pinCommand(command: string, cwd: string): void {
    const result = addPin({command, cwd});
    this.output.addFrontendInteraction('/pins', result.ok ? `Pinned. /pins lists what you kept; it is stored in ${pinsPath()}.` : result.reason, result.ok ? INFO : ERROR);
  }

  private refreshPins(panel: PinsPanelState, message?: {text: string; error: boolean}): void {
    const loaded = loadPins();
    if (loaded.ok) panel.data = loaded.value as PinData;
    panel.composerText = this.editor.text;
    panel.message = loaded.ok ? message : {text: loaded.reason, error: true};
  }

  private async handlePinsKey(key: Key): Promise<void> {
    const panel = this.pinsPanel!;
    const action = pinsPanelKey(panel, key);
    const done = (result: {ok: true} | {ok: false; reason: string}, text: string) => this.refreshPins(panel, result.ok ? {text, error: false} : {text: result.reason, error: true});
    if (action?.kind === 'close') { this.pinsPanel = undefined; this.returnFromPanel(); }
    else if (action?.kind === 'stage') {
      // The composer is the person's: a pin never replaces what they have typed.
      if (this.editor.text.trim()) panel.message = {text: 'The composer has text. Clear it (or run it) first; nothing was staged.', error: true};
      else {
        if (action.command.includes('\n')) this.editor.insertPaste(action.command); else this.editor.insert(action.command);
        this.pinsPanel = undefined; this.returnFromPanel();
        this.output.addFrontendInteraction('/pins', 'Staged in the composer for you to review. Press Enter to run it.', INFO);
      }
    } else if (action?.kind === 'use') await this.useRecipe(panel, action.recipe, action.values);
    else if (action?.kind === 'rename') done(changeItem(action.id, {name: action.name}), 'Renamed.');
    else if (action?.kind === 'scope') done(changeItem(action.id, {scope: action.scope}), action.scope === 'directory' ? 'Kept for this folder and the folders inside it.' : 'Kept for every folder.');
    else if (action?.kind === 'delete') done(removeItem(action.id), 'Removed.');
    else if (action?.kind === 'pinComposer') done(addPin({command: this.editor.text, cwd: this.shellCwd}), 'Pinned what is in the composer. It is not run.');
    else if (action?.kind === 'saveRecipe') {
      const quoted = action.steps.map(step => quotedPlaceholder(step)).find(Boolean);
      if (quoted) { panel.message = {text: `{{${quoted}}} is inside quotes. Put placeholders outside quotes: NMSh quotes the value for you.`, error: true}; panel.mode = 'name'; panel.naming = {steps: action.steps}; panel.input = action.name; }
      else done(addRecipe({name: action.name, steps: action.steps, cwd: this.shellCwd}), `Saved the recipe “${action.name}”. Enter on it asks for its values and shows the commands first.`);
    } else if (action?.kind === 'edit') { await this.editRecipe(panel, action.recipe); }
    this.render();
  }

  /** Enter on a recipe: its values are quoted into the steps, and the expanded commands are reviewed before anything is queued. */
  private async useRecipe(panel: PinsPanelState, recipe: Recipe, values: Record<string, string>): Promise<void> {
    if (!this.queueAvailable()) { panel.message = {text: 'The command queue is off or unavailable here, so a recipe cannot be queued.', error: true}; return; }
    const expanded = expandSteps(recipe.steps, values, this.shellId === 'fish' ? fishQuote : posixQuote);
    if (!expanded.ok) { panel.message = {text: expanded.reason, error: true}; return; }
    const shell = this.batchShell();
    const check = shell ? await verifyCommands(expanded.steps, shell) : {ok: false as const, reason: 'This shell cannot check recipes.'};
    if (this.pinsPanel !== panel) return;
    if (!check.ok) { panel.message = {text: check.reason.replace('so the paste was not split', 'so the recipe was not queued'), error: true}; return; }
    const where = this.shellCwd;
    const note = recipe.scope === 'directory' && recipe.cwd && recipe.cwd !== where ? `Saved for ${recipe.cwd}; this shell is in ${where}.` : `Runs in this shell, from ${where}.`;
    this.pinsPanel = undefined;
    this.batchReview = batchFromCommands(expanded.steps, Math.max(0, QUEUE_LIMIT - this.queueState.entries.length), {title: `Recipe: ${recipe.name}`, note: `${note} · ${this.queuePolicyNote()}`});
  }

  /** e on a recipe: its commands in your editor (a private temporary file); saved only if they still split into whole commands. */
  private async editRecipe(panel: PinsPanelState, recipe: Recipe): Promise<void> {
    const editor = configuredEditor(process.env);
    const shell = this.batchShell();
    if (!editor || !shell || !this.hostTerminalFree()) return;
    const directory = mkdtempSync(join(tmpdir(), 'nmsh-recipe-'));
    const file = join(directory, 'recipe.sh');
    try {
      writeFileSync(file, recipe.steps.join('\n'), {mode: 0o600});
      const code = await this.withHostTerminal(() => new Promise<number | null>(finish => {
        const child = spawn(editor[0]!, [...editor.slice(1), file], {stdio: 'inherit'});
        child.once('error', () => finish(null));
        child.once('close', exit => finish(exit));
      }));
      if (code !== 0) { this.refreshPins(panel, {text: 'The editor did not finish; the recipe is unchanged.', error: true}); return; }
      const split = splitBatch(readFileSync(file, 'utf8'), shell);
      if (!split.ok) { this.refreshPins(panel, {text: `Not saved: ${split.reason} The recipe is unchanged.`, error: true}); return; }
      const steps = split.commands.map(command => command.text);
      const quoted = steps.map(step => quotedPlaceholder(step)).find(Boolean);
      const problem = quoted ? `{{${quoted}}} is inside quotes; put placeholders outside quotes.` : steps.map(step => keepProblem(step)).find(Boolean);
      if (problem || !steps.length) { this.refreshPins(panel, {text: `Not saved: ${problem ?? 'a recipe needs at least one command.'}`, error: true}); return; }
      const saved = changeItem(recipe.id, {steps});
      this.refreshPins(panel, saved.ok ? {text: `Saved ${steps.length} command${steps.length === 1 ? '' : 's'}. A queued run keeps the commands it was reviewed with.`, error: false} : {text: saved.reason, error: true});
    } catch { this.refreshPins(panel, {text: 'The editor could not be started; the recipe is unchanged.', error: true}); }
    finally { rmSync(directory, {recursive: true, force: true}); }
  }

  /** Whether the compact preview fits above the composer on this screen (the same rule notices follow). */
  private pasteCompactFits(): boolean {
    const {columns, rows} = this.dimensions();
    return rows - this.searchChrome(columns).length >= 12 + this.noticeRows(columns).length;
  }

  /** Paste Preview rows above the composer: compact and bounded (R opens the full Review); only risky lines get a semantic color. */
  private pastePreviewRows(columns: number): string[] {
    const preview = this.pastePreview;
    if (!preview) return [];
    const {analysis} = preview;
    const lines = preview.text.replace(/\r\n?/gu, '\n').split('\n');
    const rows = [`${SUBTLE}${pasteHeader(analysis)}${RESET}`, ''];
    for (const line of lines.slice(0, 4)) rows.push(`  ${SECONDARY}${displaySafe(line)}${RESET}`);
    if (lines.length > 4) rows.push(`  ${SUBTLE}… ${lines.length - 4} more line${lines.length - 4 === 1 ? '' : 's'}${RESET}`);
    const risky = new Set(['destructive', 'privilege', 'pipeline']);
    const items = analysis.commands.slice(0, 12).map((command, index) => {
      const kind = primaryKind(command.kinds);
      const color = risky.has(kind) ? ERROR : kind === 'install' || kind === 'modifies' ? ACCENT : SUBTLE;
      return {plain: `${index + 1} ${KIND_LABELS[kind]}`, styled: `${color}${index + 1} ${KIND_LABELS[kind]}${RESET}`};
    });
    // Summary items wrap onto at most two rows; the rest is counted, never dumped into this strip.
    const summary: string[] = [];
    let line = '';
    let width = 0;
    let used = 0;
    for (const item of items) {
      const cost = displayWidth(item.plain) + 3;
      if (width && width + cost > columns - 2) { summary.push(line); line = ''; width = 0; }
      if (summary.length >= 2) break;
      line += `${line ? `${SUBTLE} · ${RESET}` : ''}${item.styled}`;
      width += cost;
      used += 1;
    }
    if (line && summary.length < 2) summary.push(line);
    const hidden = analysis.commands.length - used;
    if (hidden > 0 && summary.length) summary[summary.length - 1] += `${SUBTLE} · +${hidden} more${RESET}`;
    for (const item of summary) rows.push(`  ${item}`);
    // NMSh commands among other lines reach the shell as text: say so before anything is inserted or queued.
    const nmsh = nmshCommandNote(analysis, this.shellId);
    if (nmsh) rows.push(`${ACCENT}${nmsh}${RESET}`);
    if (analysis.commands.some(command => ['text', 'unknown'].includes(primaryKind(command.kinds)))) rows.push(`${SUBTLE}${PASTE_EXACT_NOTE}${RESET}`);
    rows.push(`${SUBTLE}Enter insert · R review${preview.batch ? ' · B queue as commands' : ''} · Esc cancel · C keep clip${RESET}`);
    return rows.map(row => truncateAnsi(row, columns));
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
      // The dev-server URL is an NMSh-authored link (safe http(s) target only) where the host supports OSC 8.
      const shownUrl = url ? authoredLink(url, url, this.host.capabilities.hyperlinks && !this.passthrough) : undefined;
      return closeAuthoredLinks(truncateAnsi(liveLine(task.label, [task.status === 'running' ? undefined : task.status, shownUrl].filter(Boolean).join(' · ') || undefined, task.startedAt, now, {still}), columns));
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
    const {hidden} = this.noticeView;
    const now = Date.now();
    // Expired notices never paint, even between polls.
    const notices = this.noticeView.notices.filter(notice => noticeVisible(notice, now));
    const safe = getCurrentGlyphMode() === 'safe';
    const symbols = {done: safe ? '+' : '✦', attention: safe ? '!' : '◆', failed: safe ? 'x' : '×', ended: safe ? '-' : '○', long: safe ? '~' : '◷', input: safe ? '?' : '◇'};
    const rows = notices.map(notice => {
      const parts = describeNotice(notice, this.noticeLabels.get(notice.sessionId) ?? sessionLabel(notice.sessionId), now);
      if (parts.symbol === 'input') return truncateAnsi(`${ACCENT}${inputGlyph({confidence: notice.confidence === 'likely' ? 'likely' : 'confirmed'})}${RESET} ${SECONDARY}${parts.text}${RESET}`, columns);
      const color = parts.symbol === 'failed' ? ERROR : parts.symbol === 'attention' ? ACCENT : parts.symbol === 'done' ? SUCCESS : SECONDARY;
      return truncateAnsi(`${color}${symbols[parts.symbol]}${RESET} ${SECONDARY}${parts.text}${RESET}`, columns);
    });
    if (hidden > 0) rows.push(truncateAnsi(`${SECONDARY}… ${hidden} more session update${hidden === 1 ? '' : 's'} · /resume · /notices clear${RESET}`, columns));
    return rows;
  }

  /** Poll while notices or the explicit live session view need facts and NMSh owns the screen. */
  private syncNotices(): void {
    const wanted = this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended
      && this.sessionMode === 'service' && (this.promptConfiguration.sessionNotices || Boolean(this.resumeBrowser?.liveOnly));
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
      const {sessions, ended} = await listSessionNotices({throwOnError: true});
      if (this.stopped) return;
      const ordered = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
      // The person's own name, else the familiar signature, else the old ordinal label.
      this.noticeLabels = new Map(ordered.map((session, index) => [session.id, session.name || session.signature || sessionLabel(session.id, index + 1)]));
      this.noteSessionIdentity(sessions.find(session => session.id === this.sessionId));
      this.noticeSource = [...sessions.flatMap(session => (session.notice ? [session.notice] : [])), ...ended];
      const refreshedView = this.refreshSessionsView(sessions);
      const noticesChanged = this.applyNotices();
      if (refreshedView && !noticesChanged) this.render();
    } catch { /* notices are best effort */ } finally { this.noticePolling = false; }
  }

  /** Select what is visible now (expired notices drop out) and wake exactly when the next one expires. */
  private applyNotices(now = Date.now()): boolean {
    const enabled = this.promptConfiguration.sessionNotices;
    const next = enabled ? selectNotices(this.noticeSource, this.sessionId, this.dismissedNotices, now) : {notices: [], hidden: 0};
    const changed = JSON.stringify(next) !== JSON.stringify(this.noticeView);
    this.noticeView = next;
    if (this.noticeExpiry) { clearTimeout(this.noticeExpiry); this.noticeExpiry = undefined; }
    const soonest = enabled ? this.noticeSource.filter(notice => selectNotices([notice], this.sessionId, this.dismissedNotices, now).notices.length)
      .map(notice => noticeExpiresAt(notice)).filter((at): at is number => at !== undefined).sort((a, b) => a - b)[0] : undefined;
    if (soonest !== undefined && !this.stopped) {
      this.noticeExpiry = setTimeout(() => { this.noticeExpiry = undefined; this.applyNotices(); if (!this.stopped) this.render(); }, Math.max(50, soonest - now + 50));
      this.noticeExpiry.unref();
    }
    if (changed) this.render();
    return changed;
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

  /** The live strip row, from resolved facts only (the same function paints the /strip preview). */
  private statusStripRow(columns: number, configuration = this.promptConfiguration): string {
    // Active Keep Awake is always part of an enabled strip (no per-item switch); the strip itself is never forced on.
    const record = this.awakeRecord;
    const display = configuration.keepAwake.display;
    // Modules routed to the strip are resolved facts like every other surface; the strip never collects anything itself.
    return renderStatusStrip(configuration.statusStrip, stripStatsFromFacts(this.contextEngine.facts()), columns, undefined,
      record ? {full: awakeLabel(record, display, 'full'), short: awakeLabel(record, display, 'short'), glyph: awakeLabel(record, display, 'glyph')} : undefined,
      this.statusStripModuleItems(configuration));
  }

  /** Strip-routed modules with their group and, for the path, a shorter form the fitter may use first. */
  private statusStripModuleItems(configuration = this.promptConfiguration): StripModuleItem[] {
    const context = this.promptContext();
    const compact = new Map(statusStripModules(context, configuration, PATH_DISPLAY_LEVELS - 1).map(module => [module.id, module.text]));
    return statusStripModules(context, configuration).map(module => ({id: module.id, text: module.text, failure: module.role === 'failure', priority: module.priority,
      zone: configuration.modules.find(item => item.id === module.id)?.stripZone ?? 'right',
      ...(compact.get(module.id) && compact.get(module.id) !== module.text ? {compact: [compact.get(module.id)!]} : {})}));
  }

  /** The strip's own facts are Context Engine demand: re-derive it when the row appears or goes (passthrough, resize, Off). */
  private syncStatusStrip(): void {
    const {columns, rows} = this.dimensions();
    const wanted = this.presentationStarted && !this.stopped && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended && this.stripActive(columns, rows);
    if (wanted === this.stripDemanded) return;
    this.stripDemanded = wanted;
    this.requestContextDemand();
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
  private doctorPanel?: DoctorPanelState;
  private watchPanel?: WatchPanelState;
  /** Watches NMSh schedules itself; they live (and stop) with this window. */
  private readonly watches = new WatchTasks(resolveCommand('sh') ?? '/bin/sh', Date.now, () => ({...process.env, PATH: this.shellPath()}));
  /** Watches started with /track: their live transcript block keeps the height it reached (see trackBlockRows). */
  private readonly trackBlocks = new Map<string, {reserved: number; finalized: boolean}>();
  private readonly watchSubscription = this.watches.onChange((watch, transition) => {
    if (this.stopped) return;
    // A watch moving between failing and passing is one meaningful event.
    if (transition) this.transitions.echo(transition === 'pass' ? 'taskDone' : 'taskFailed', Date.now());
    // A tracker the person stopped leaves its last result in the transcript once (a closing window leaves nothing).
    const block = this.trackBlocks.get(watch.id);
    if (block && watch.status === 'stopped' && !block.finalized) {
      block.finalized = true;
      this.output.addFrontendBlock(`/track ${watch.command}`, finalResultRows(watch));
      // The anchored transcript row can render its stopped state directly from the task.
      // The mutable per-tracker height bookkeeping is no longer needed after finalization.
      this.trackBlocks.delete(watch.id);
    }
    this.render();
  });

  /** A /track block's live rows (presentation only). */
  private trackRows(id: string, width: number): string[] {
    const block = this.trackBlocks.get(id);
    const {rows, reserved} = trackBlockRows(this.watches.get(id), width, Date.now(), block?.reserved ?? 0, this.watches.sampling(id));
    if (block) block.reserved = reserved;
    return rows;
  }

  /** Start a classified (or confirmed) watch; /track also writes its block, whose live rows follow it in place. */
  private startWatch(command: string, watched: string, cwd: string, intervalMs: number | undefined, safety: Exclude<WatchSafety, {kind: 'refused'}>, track: boolean): boolean {
    let watch;
    try { watch = this.watches.start(watched, cwd, intervalMs, safety); }
    catch (error) { this.output.addFrontendInteraction(command, error instanceof Error ? error.message : 'Could not start tracking.', ERROR); return false; }
    if (track) {
      this.trackBlocks.set(watch.id, {reserved: 0, finalized: false});
      const place = cwd === this.shellCwd ? 'here' : `in ${displayPath(cwd)}`;
      this.output.addTrackBlock(watch.id, command, [`${GLYPHS.info} Tracking ${watch.command} ${place} with sh -c and your shell's PATH (not its aliases or functions). /track stop ends it.`]);
    }
    return true;
  }

  /** /watch …: start (classified first), list, pause, resume, run now, stop. */
  private handleWatch(command: string, op: 'list' | 'stop' | 'pause' | 'resume' | 'now' | 'start' | 'copy', argument: string, track = false): void {
    const active = this.watches.active();
    const pick = () => {
      const index = /^\d+$/u.test(argument) ? Number(argument) - 1 : active.length - 1;
      return active[index];
    };
    if (op === 'list') { this.panelOrigin = undefined; this.watchPanel = {selected: 0, output: false}; return; }
    if (op === 'start') {
      const parsed = parseWatch(argument);
      if (parsed.error) { this.output.addFrontendInteraction(command, parsed.error, ERROR); return; }
      const {command: watched, intervalMs} = parsed;
      const safety = watchSafety(watched);
      if (safety.kind === 'refused') { this.output.addFrontendInteraction(command, safety.reason, ERROR); return; }
      this.panelOrigin = undefined;
      if (safety.kind === 'confirm' || safety.remote) {
        this.watchPanel = {selected: 0, output: false, confirm: {command: watched, cwd: this.shellCwd, ...(intervalMs ? {intervalMs} : {}),
          reason: safety.kind === 'confirm' ? safety.reason : 'It contacts a remote host every interval (at least every 15s).', choice: 'no', ...(track ? {track: true} : {})}};
        return;
      }
      // /track shows its result in the transcript; /watch opens its manager as before.
      if (this.startWatch(command, watched, this.shellCwd, intervalMs, safety, track) && !track) this.watchPanel = {selected: this.watches.active().length - 1, output: false};
      return;
    }
    const noun = track ? 'tracker' : 'watch';
    if (op === 'stop' && argument === 'all') {
      for (const watch of active) this.watches.stop(watch.id);
      this.output.addFrontendInteraction(command, active.length ? `Stopped every ${noun}; their processes are being ended.` : `Nothing is being ${track ? 'tracked' : 'watched'}.`, INFO);
      return;
    }
    const watch = pick();
    if (!watch) { this.output.addFrontendInteraction(command, `Nothing is being ${track ? 'tracked' : 'watched'}.`, INFO); return; }
    if (op === 'copy') {
      if (!watch.current) { this.output.addFrontendInteraction(command, `No completed result of ${watch.command} yet.`, INFO); return; }
      // The latest completed result only, as plain text: never earlier refreshes, never the block's own lines.
      void this.copyText(watch.current.output, `Copied the latest result of ${watch.command.slice(0, 40)}`);
      return;
    }
    if (op === 'now' && !this.watches.runNow(watch.id)) {
      this.output.addFrontendInteraction(command, `A result of ${watch.command} is still being produced; no second one was started.`, INFO);
      return;
    }
    const done = op === 'stop' ? this.watches.stop(watch.id) : op === 'pause' ? this.watches.pause(watch.id) : op === 'resume' ? this.watches.resume(watch.id) : true;
    this.output.addFrontendInteraction(command, done ? `${op === 'now' ? 'Refreshing' : op === 'stop' ? 'Stopped' : op === 'pause' ? 'Paused' : 'Resumed'} the ${noun} on ${watch.command}.` : 'Nothing changed.', INFO);
  }

  /** /doctor: local, bounded, read-only checks gathered in parallel; a live line while they run. */
  private async openDoctor(): Promise<void> {
    this.panelOrigin = undefined;
    const root = this.context.root;
    const panel = createDoctorPanel(basename(root ?? this.shellCwd) || this.shellCwd);
    this.doctorPanel = panel;
    const clock = this.decorativeMotionAllowed() ? presentationClock.subscribe(() => { if (this.doctorPanel === panel && !this.stopped) this.render(); }, 100) : undefined;
    this.render();
    try {
      const [serviceReachable, git] = await Promise.all([
        this.sessionMode === 'service' ? listLiveSessions().then(() => true, () => false) : Promise.resolve(undefined),
        root ? readGitFacts(root) : Promise.resolve(undefined),
        this.refreshProviderStatuses().catch(() => {}),
      ]);
      const configuration = this.promptConfiguration;
      const providerRows = ([['picker', configuration.picker], ['history', configuration.history], ['navigation', configuration.navigation], ['suggestions', configuration.suggestions], ['prompt', configuration.provider]] as const)
        .flatMap(([family, id]) => {
          const descriptor = PROVIDER_FAMILIES.flatMap(item => item.providers).find(item => item.id === id && item.kind === 'external');
          if (!descriptor) return [];
          const status = this.providerStatuses.get(descriptor.id);
          return [{family, label: descriptor.label, available: status?.state === 'installed'}];
        });
      const model = configuration.localUnderstanding.model;
      const runtimeAvailable = model ? (model.runtime === 'llama.cpp' ? Boolean(resolveCommand('llama-server'))
        : Boolean(this.understanding.discovery?.runtimes.some(runtime => runtime.kind === model.runtime && runtime.running))) : false;
      const checks = runDoctor({cwd: this.shellCwd, platform: process.platform, which: name => resolveCommand(name), exists: path => existsSync(path),
        writable: path => { try { accessSync(path, constants.W_OK); return true; } catch { try { accessSync(join(path, '..'), constants.W_OK); return !existsSync(path); } catch { return false; } } },
        nmsh: {configurationLoaded: true, sessionMode: this.sessionMode, ...(serviceReachable !== undefined ? {serviceReachable} : {}), transcriptDirectory: join(nmshConfigDirectory(), 'sessions'),
          shell: {id: this.shellId, label: shellAdapter(this.shellId).label, ...(resolveCommand(this.shellId) ? {executable: resolveCommand(this.shellId)!} : {}), promptSeen: !this.startupPending},
          host: {name: this.host.name, truecolor: colorLevel() === 'truecolor', keyboard: this.host.capabilities.enhancedKeyboard || this.host.capabilities.kittyKeyboard}},
        ...(git ? {git} : {}), ...(root ? {repoRoot: root} : {}), providers: providerRows, contextEngine: {...this.contextEngine.stats},
        understanding: {mode: configuration.localUnderstanding.mode, ...(model ? {model: {label: model.label, runtime: model.runtime, ...(model.path ? {path: model.path} : {}), owned: Boolean(model.owned)}} : {}),
          runtimeAvailable, ...(model ? {state: stateLabel(this.understanding.status, configuration.localUnderstanding)} : {})},
        agents: this.agents.harnesses().map(item => ({label: item.harness.name, installed: Boolean(item.executable)})),
        ...(process.env.VIRTUAL_ENV ? {virtualEnv: process.env.VIRTUAL_ENV} : {})});
      if (this.doctorPanel === panel) { panel.checks = checks; panel.selected = 0; }
    } finally { clock?.(); }
    this.render();
  }
  private cursorPanel?: CursorPanelState;
  private cursorPanelClock?: () => void;

  /** What the cursor surfaces need to know: backend choice, host facts, theme colors, color level. `config` is the saved or (in Setup) the draft configuration. */
  private cursorEnv(draft: PromptConfiguration['cursor'], config: PromptConfiguration): CursorPanelEnv {
    const facts = this.cursorFacts();
    return {choice: chooseBackend(draft, facts), facts, context: {...contextFor(config), chrome: UI_COLORS.accent},
      still: !this.decorativeMotionAllowed() || colorLevel() === 'none', level: colorLevel(), ...(process.env.TMUX ? {multiplexed: true} : {})};
  }

  private cursorFacts(): HostCursorFacts {
    this.cursorHost ??= hostCursorFacts(process.env, host => nativeCursorIntegrated(host));
    return this.cursorHost;
  }

  /** The panel's rows; one frame clock exists only while its preview is animating and stops when it settles. */
  private cursorPanelRows(state: CursorPanelState, columns: number, env: CursorPanelEnv): string[] {
    const now = Date.now();
    const rows = renderCursorPanel(state, columns, now, env, this.dimensions().rows - 4);
    const busy = Boolean(state.previewBusy) && !state.picker && !state.gradient && !state.native;
    if (busy && !this.cursorPanelClock) this.cursorPanelClock = presentationClock.subscribe(() => { if ((this.cursorPanel || this.setupState?.cursorPanel) && !this.stopped) this.render(); }, 33, 16);
    else if (!busy && this.cursorPanelClock) { this.cursorPanelClock(); this.cursorPanelClock = undefined; }
    return rows;
  }

  /**
   * /cursor: the canonical cursor & effects surface; its preview animates only while it is open (and motion is allowed).
   * Keeps the origin it was opened from (Settings), so Esc goes back there.
   */
  private openCursorPanel(options: CursorPanelOptions = {}): void {
    this.cursorPanel = createCursorPanel(this.promptConfiguration.cursor, Date.now(), options);
  }

  private closeCursorPanel(): void {
    this.cursorPanel = undefined;
    this.cursorPanelClock?.(); this.cursorPanelClock = undefined;
    this.returnFromPanel();
  }

  private handleCursorPanelKey(key: Key, state: CursorPanelState, config: PromptConfiguration = this.promptConfiguration): void {
    const action = cursorPanelKey(state, key, this.cursorEnv(state.draft, config));
    if (!action) return;
    if (action.kind === 'close') { this.closeCursorPanel(); return; }
    if (action.kind === 'apply') {
      // The configuration setter applies shape/blink to the live renderer and refreshes NMSh's managed native files.
      this.updateConfiguration(configuration => { configuration.cursor = action.settings; });
      if (this.cursorReload) state.message = this.cursorReload;
      // Opened straight into a color editor (choosing Custom in Settings): applying it goes back there.
      if (action.close) this.closeCursorPanel();
      return;
    }
    const facts = this.cursorFacts();
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
      let written: ManagedWrite;
      try { written = writeManagedFiles(native.host, resolveCursorSettings(state.draft, contextFor(this.promptConfiguration))); } catch { state.message = 'Could not write NMSh\'s managed cursor files; nothing else was changed.'; return; }
      if (setup.plan.kind === 'plan') {
        const applied = applyPlan(setup.plan.plan);
        if (!applied.ok) { state.message = applied.reason; return; }
      }
      this.cursorHost = hostCursorFacts(process.env, value => nativeCursorIntegrated(value));
      void written;
      state.message = this.cursorHost.integrated
        ? (reloadInstruction(native.host, {changed: ['fragment']}) ?? `Set up. Renderer Auto now uses ${nativeHostLabel(native.host)} native.`)
        : 'Setup did not verify; Portable stays in use.';
    }
  }

  /** The reload line for the latest managed-file refresh, until the next one (shown in /cursor and after Setup applies). */
  private cursorReload?: string;

  /**
   * Keep NMSh's own native files in step with the cursor settings and the theme
   * colors they resolve to: only when the host integration is already set up, only
   * NMSh's own fragment and shader, and only files whose content changed.
   */
  private syncCursorNative(next: PromptConfiguration): void {
    const facts = this.cursorFacts();
    // Inside a multiplexer the outer terminal is hidden, but NMSh's own managed files may still be installed there.
    const host = facts.host !== 'other' ? (facts.integrated ? facts.host : undefined)
      : installedNativeHost();
    if (!host) { this.cursorReload = undefined; return; }
    try {
      const written = writeManagedFiles(host, resolveCursorSettings(next.cursor, contextFor(next)));
      this.cursorReload = reloadInstruction(host, written);
    } catch { this.cursorReload = 'Could not update the managed cursor files.'; }
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
        this.transitions.echo('setupDone', Date.now());
      } catch (error) {
        clock();
        panel.progress = undefined;
        // Verification failure is remembered: the model is not used and nothing retries until you choose to.
        this.understanding.downloadFailure = error instanceof Error ? error.message : String(error);
        this.transitions.echo('setupFailed', Date.now());
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

  private openProvidersOverview(focus?: SwitchableFamily): void {
    this.panelOrigin = undefined;
    this.providersOverview = createProvidersOverview(focus);
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

  /**
   * Inline selection from /providers: the same configuration and the same
   * side effects as the family panels, applied at once so the overview is
   * immediately factual (the family row shows the new provider as Active).
   */
  private selectProviderInline(family: SwitchableFamily, id: string): void {
    const next = selectProvider(this.promptConfiguration, family, id);
    const state = this.providersOverview;
    if (!next || !state) return;
    if (!this.applySettingsConfiguration(next)) return;
    if (family === 'suggestions') this.applySuggestionProvider();
    if (family === 'history') void this.loadHistory();
    if (family === 'navigation') { this.directoryQueryAbort?.abort(); this.directoryQuery = undefined; this.directoryResults = []; }
    if (family === 'prompt') void this.refreshProviderPrompt().then(() => this.render());
    const label = providerFamily(family)!.providers.find(provider => provider.id === id)!.label;
    state.message = `${providerFamily(family)!.title} · ${label}`;
  }

  private async installProviderInline(family: SwitchableFamily, id: string): Promise<void> {
    const state = this.providersOverview;
    const descriptor = providerFamily(family)?.providers.find(provider => provider.id === id);
    const install = descriptor ? providerInstall(descriptor) : undefined;
    if (!state || !descriptor || !install) return;
    state.installing = {family, id, line: `Installing ${descriptor.label} · ${install.label}…`};
    this.render();
    const task = new TaskProgress(`Installing ${descriptor.label}`, () => { if (this.providersOverview === state) this.render(); }, Date.now(), descriptor.label);
    const outcome = await task.run(install.command, [...install.args]);
    if (this.stopped) return;
    clearProviderDetection();
    const status = await detectProvider(descriptor);
    this.providerStatuses.set(descriptor.id, status);
    state.installing = undefined;
    if (outcome.status === 'succeeded' && status.state === 'installed') {
      recordInstall(descriptor.executable ?? descriptor.id, install);
      this.selectProviderInline(family, id);
      this.milestoneEffect();
    } else state.message = outcome.status === 'succeeded' ? `${install.label} finished, but ${descriptor.label} was not found on PATH; nothing was selected.`
      : `${descriptor.label} was not installed. ${task.state.error ?? ''}`.trim();
    this.render();
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
  private readonly agentsSubscription = this.agents.onChange((_session, event) => {
    if (this.stopped) return;
    // An agent asking for approval is an attention event (once per request).
    if (event?.kind === 'approval') this.transitions.echo('attention', Date.now());
    this.render();
  });
  /** Long-lived tasks Ask started (dev servers): owned by NMSh, stopped when it exits. */
  private readonly managedTasks = new ManagedTasks();
  /** Portable cursor effects over NMSh's own input (presentation only; Off schedules nothing). */
  private readonly cursorPresenter = new CursorPresenter(() => resolveCursorSettings(this.promptConfiguration.cursor, {...contextFor(this.promptConfiguration), chrome: UI_COLORS.accent}), () => { if (!this.stopped) this.paintPresentation(Date.now()); });
  private caretCause: 'typing' | 'jump' = 'jump';
  /** A paste waiting for Insert / Review / Cancel (presentation and classification only; the text is never changed). */
  private pastePreview?: {text: string; analysis: PasteAnalysis; /** Splits into separate commands that can be queued. */ batch: boolean};
  private batchReview?: BatchReviewState;
  /** The one place the clipboard is read (only /ps calls it). */
  private readClipboardText: () => Promise<string> = () => readClipboard();
  private pasteReview?: PasteReviewState;
  /** Short presentation transitions (launch, completion materialization, Block Seal, Semantic Echo, prompt morph). */
  private readonly transitions = new Transitions(() => this.promptConfiguration.motion,
    () => ({reducedMotion: !this.decorativeMotionAllowed(), effectsOff: false, color: colorLevel() !== 'none'}));
  private transitionClock?: () => void;
  private motionPreviewClock?: () => void;
  /** The /appearance → Motion preview gate: Effects Off and Reduced Motion stay distinct so the preview can say which applies. */
  private motionPreviewGate(): MotionGate {
    const presentation = this.promptConfiguration.presentation;
    return {reducedMotion: presentation.reducedMotion || isReducedMotion(), effectsOff: presentation.effectsOff, color: colorLevel() !== 'none'};
  }
  /** The semantic prompt modules last shown, for context morph (ids, roles and text only). */
  private lastModules?: Array<{id: string; text: string; role?: string}>;
  /** Each visible transcript row's owning block, for Block Seal placement. */
  private visibleBlocks: Array<number | undefined> = [];
  private cursorHost?: HostCursorFacts;
  private cursorBackend(): BackendChoice {
    return chooseBackend(this.promptConfiguration.cursor, this.cursorFacts());
  }
  private readonly taskStates = new Map<string, string>();
  private readonly tasksSubscription = this.managedTasks.onChange(() => {
    if (this.stopped) return;
    // Semantic Echo once per task ending: done, or failed (a task the person stopped ends quietly).
    for (const task of this.managedTasks.tasks) {
      const previous = this.taskStates.get(task.id);
      if (previous !== task.status && previous && previous !== 'stopping' && (task.status === 'completed' || task.status === 'failed')) this.transitions.echo(task.status === 'failed' ? 'taskFailed' : 'taskDone', Date.now());
      this.taskStates.set(task.id, task.status);
    }
    this.syncTaskClock(); this.render();
  });
  private taskClock?: () => void;
  private modsPanel?: ModsController;
  /** The agent draft's caret in the framed panel rows, when the agent view owns typing; drives the terminal cursor. */
  private agentCaret?: {row: number; column: number};
  /** /worktrees: the core controller; `branch` while `n` collects a branch name; `notice` is the host's own outcome line. */
  private worktreePanel?: {controller: WorktreeManagerController; git: GitRunner; branch?: string; notice?: string; select?: string};
  /** /github, /prs, /issues: read-only workspace over the person's `gh`. */
  private githubPanel?: {controller: GithubWorkspaceController; repository: string; detach: () => void; columns?: number};
  /** /claude, /claude new, /ai → Claude: the provider launcher (targets and launch profiles). */
  private launcher?: LauncherState;
  /** Found launch profiles were skipped in this window: not offered again until restart. */
  private launcherDiscoverySkipped = false;
  /** Passive, text-only discovery of simple Claude launch aliases (see profileDiscovery); replaceable in tests. */
  private discoverProfiles = (existing: ReadonlySet<string>) => discoverClaudeProfiles({home: homedir(), claude: resolveCommand('claude', this.shellPath())}, existing);
  private readonly agentDrafts = new Map<string, AgentViewState>();
  private agentPanel?: AgentPanelState;
  private agentView?: AgentViewState;
  /** The transient activity shelf above the composer: hidden at rest, revealed by ↓, pinned while something needs attention. */
  private shelf = {visible: false, focused: false, selected: 0, shownAt: 0};
  private agentDiscoveryTimer?: () => void;
  private askGeneration = 0;
  /** The block Explain failure was chosen on, so Ask explains that one (not just the newest failure). */
  private explainBlock?: number;
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
  private openAsk(request: string, command: '/btw' | '/ask' = '/btw'): void {
    this.panelOrigin = undefined;
    const parked = this.parkedAsk;
    this.parkedAsk = undefined;
    this.askGeneration += 1;
    // /ask alone returns to a conversation parked by Insert; a new request starts fresh (the parked one is recorded as closed).
    if (parked && !request) { parked.pending = undefined; this.askState = parked; return; }
    if (parked) this.recordAsk(parked);
    this.askState = createAskState();
    this.askState.command = command;
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
    if (event.action.kind === 'watch' || event.action.kind === 'watchControl') {
      const action = event.action;
      this.closeAsk();
      if (action.kind === 'watch') this.handleWatch('/watch', 'start', `${action.intervalMs ? `--every ${action.intervalMs / 1000}s ` : ''}${action.command}`);
      else if (action.op === 'show') this.handleWatch('/watch', 'list', '');
      else this.handleWatch('/watch', action.op === 'stopAll' ? 'stop' : action.op, action.op === 'stopAll' ? 'all' : '');
      this.render();
      return;
    }
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
      const result = await openPicker(this.promptConfiguration.picker, files.map(path => ({id: path, label: path, value: path})), fallback, this.pickerHandoff, process.env, await this.fzfThemeArgs(), this.fzfLayout());
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
      const opener = selectOpener();
      if (!opener) { finish(`No system URL opener is available here. The URL is ${action.url}`); return; }
      try { spawn(opener, [action.url], {detached: true, stdio: 'ignore'}).unref(); finish(`Opened ${action.url}.`); } catch { finish(`Couldn't open ${action.url}.`); }
      return;
    }
    if (action.kind === 'openFile') {
      await this.openLocation('/btw', action.path, this.shellCwd);
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
      this.transitions.echo(ok ? 'installDone' : 'installFailed', Date.now());
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
    if (recorded) this.output.addAskInteraction(recorded.request, recorded.turns, state.command);
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
      const tool = suggestibleToolFor(name);
      const recipe = tool ? (planPackageInstall(tool) ?? toolInstall(tool)) : undefined;
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
    // A failure question gets the failed block's bounded, redacted excerpt (the chosen block, else the newest failure).
    let failure: AskContext['failure'];
    if (WHY_FAILED.test(normalizeRequest(text))) {
      const records = this.output.view().completed.filter(record => !record.frontend);
      const record = (this.explainBlock !== undefined ? records.find(item => item.startId === this.explainBlock) : undefined) ?? records.find(item => (item.exitCode ?? 0) !== 0);
      this.explainBlock = undefined;
      if (record) failure = {command: record.command, exitCode: record.exitCode ?? 1, output: record.output.split('\n').slice(-400).join('\n'), startId: record.startId,
        cwd: record.historicalContext?.cwd ?? this.shellCwd};
    }
    const understanding = this.promptConfiguration.localUnderstanding;
    const llm = {mode: understanding.mode, requests: this.understanding.requests,
      ...(understanding.model ? {model: {label: understanding.model.label, runtime: understanding.model.runtime, owned: Boolean(understanding.model.owned)}} : {}),
      ...(understanding.model ? {state: stateLabel(this.understanding.status, understanding)} : {}),
      ...(this.understanding.lastRoute ? {lastRoute: this.understanding.lastRoute.route} : {}),
      ...(this.understanding.lastInference ? {lastInference: this.understanding.lastInference.label} : {})};
    return {cwd: this.shellCwd, home: homedir(), platform: process.platform, picker: this.promptConfiguration.picker, llm, ...(failure ? {failure} : {}), ...(projectFacts ? {project: projectFacts} : {}), tasks, ...(root ? {repoRoot: root} : {}), ...(this.context.branch ? {branch: this.context.branch} : {}),
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
      case 'tmux': {
        // Ask's own Yes (which starts on No) confirmed exactly these typed changes.
        let model = loadTmuxModel();
        for (const change of action.changes) { const next = applyTmuxChange(model, change); if (!('error' in next)) model = next; }
        saveTmuxModel(model);
        const written = writeTmuxManaged(model);
        this.output.addFrontendInteraction('/btw', written.ok ? `tmux: ${action.label}. Saved in NMSh's managed tmux file${recordedHook('tmux') ? '; /tmux → R reloads a running server' : '; your tmux.conf does not load it yet: /tmux → Review & apply adds the one include after you review it'}.` : written.error, written.ok ? SUCCESS : ERROR);
        return;
      }
      case 'themeBridge': {
        await this.saveBridge(bridge => {
          if (action.enabled !== undefined) bridge.enabled = action.enabled;
          if (action.policy) bridge.policy = action.policy;
          for (const [target, setting] of Object.entries(action.targets ?? {})) bridge.targets[target as BridgeTargetId] = {mode: setting.mode, ...(setting.theme ? {theme: setting.theme} : {})};
        });
        this.output.addFrontendInteraction('/btw', `Theme Bridge · ${action.label}. Tools that need a one-time include or cache build show it in /integrations.`, SUCCESS);
        return;
      }
      case 'switchShell': await this.switchShell(action.shell, `/shell ${action.shell}`); return;
      case 'installShell': {
        this.openShellPanel(action.shell);
        const recipe = shellInstall(action.shell, resolveCommand('brew'));
        // Ask's own Yes (which starts on No) was the confirmation of this exact recipe.
        if (recipe.kind === 'recipe') await this.installShell(action.shell, recipe);
        return;
      }
      case 'openFile': await this.openLocation('/btw', action.path, this.shellCwd); return;
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
      case 'toolView': {
        const tool = TOOLS.find(item => item.id === action.tool);
        if (!tool) return;
        this.startTools();
        const panel = this.toolsPanel!;
        panel.detail = tool;
        panel.statuses[tool.id] = await detectTool(tool);
        if (action.view === 'guided') panel.framework = openGuidedInstall();
        else if (action.view === 'previous') panel.framework = openPrevious();
        else if (action.view === 'p10kConfigure' || action.view === 'importAppearance') await this.handleToolsKey({kind: 'text', value: action.view === 'p10kConfigure' ? 'c' : 't'} as Key, panel);
        return;
      }
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
    this.shelf.visible = true;
    this.shelf.shownAt = Date.now();
    // Auto-hide after a short idle period unless something needs attention (checked on the presentation clock).
    setTimeout(() => { if (!this.stopped) this.render(); }, SHELF_IDLE_MS + 50).unref?.();
  }

  /** The shelf row is on screen now (shown, or pinned because something needs attention). */
  private shelfShown(): boolean {
    return this.shelfRow(this.dimensions().columns) !== undefined;
  }

  /** Shelf focus: ←/→ select (selection never switches targets), Enter opens, ↓ or Esc return to the composer. */
  private handleShelfKey(key: Key): boolean {
    const items = shelfOrder(this.agents.sessions);
    if (!items.length) { this.shelf.focused = false; return false; }
    if (key.kind === 'left' || key.kind === 'right') this.shelf.selected = (this.shelf.selected + (key.kind === 'left' ? -1 : 1) + items.length) % items.length;
    else if (key.kind === 'enter') { const session = items[this.shelf.selected]; this.shelf.focused = false; if (session) this.openAgentView(session.id); }
    else if (key.kind === 'down' || key.kind === 'escape') { this.shelf.focused = false; this.shelf.shownAt = Date.now(); }
    else if (key.kind === 'up') { /* already at the shelf: nothing above it */ }
    else { this.shelf.focused = false; return false; }
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
    const panel = this.agentPanel;
    const rows = panel?.profiles ? panel.profiles.map(profile => ({kind: 'profile' as const, profile})) : agentPanelRows(this.agents.sessions, this.agents.harnesses());
    return rows.filter(row => (!panel?.targetIds || (row.kind === 'session' && panel.targetIds.includes(row.session.id))) && (!panel?.query || (row.kind === 'session' ? row.session.title : row.kind === 'profile' ? row.profile.name : row.harness.name).toLowerCase().includes(panel.query.toLowerCase())));
  }

  /** /ai: the agent session list; /ai <harness|profile>: start a managed session in the background. */
  private openAi(command: string, target?: string): void {
    this.panelOrigin = undefined;
    if (!target) { this.agentPanel = {selected: 0}; void this.agents.discover(); return; }
    const profile = this.promptConfiguration.agentProfiles.find(item => item.name === target);
    const harnessId = profile?.harness ?? target;
    // `/ai claude` names the provider, not an identity: with launch profiles configured (or simple ones to import),
    // the launcher chooses, starting on a fresh target. `/ai <profile>` stays the direct path.
    if (!profile && harnessId === 'claude' && (this.promptConfiguration.agentProfiles.some(item => item.harness === 'claude') || (!this.launcherDiscoverySkipped && this.discoverProfiles(new Set()).length))) {
      this.openManagedTarget(command, 'claude', 'new');
      return;
    }
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
    const target = this.agents.get(id);
    if (target?.reconnectable && ['exited', 'failed'].includes(target.state)) {
      const result = this.agents.resume(id);
      if (!result.ok) {if (this.agentPanel) this.agentPanel.message = result.reason; return;}
    }
    this.agentPanel = undefined;
    this.resumeBrowser = undefined;
    this.agentView = this.agentDrafts.get(id) ?? {sessionId: id, input: '', expanded: new Set(), scroll: 0, controller: new AgentInputController()};
    this.agentView.controller!.owner = 'AGENT_MESSAGE';
    this.agentDrafts.set(id, this.agentView);
    this.agents.acknowledge(id);
    this.shelf.visible = false;
  }

  private handleAgentPanelKey(key: Key): void {
    const panel = this.agentPanel!;
    const rows = this.agentPanelRows();
    if (panel.searching) {
      if (key.kind === 'escape') {panel.searching = false; panel.query = ''; panel.selected = 0;}
      else if (key.kind === 'text' || key.kind === 'paste') {panel.query = ((panel.query ?? '') + key.value).slice(0, 256); panel.selected = 0;}
      else if (key.kind === 'backspace') {panel.query = [...(panel.query ?? '')].slice(0, -1).join(''); panel.selected = 0;}
      else if (key.kind === 'enter') panel.searching = false;
      this.render(); return;
    }
    if (key.kind === 'text' && key.value === '/') {panel.searching = true; panel.query = ''; this.render(); return;}
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
      else if (row?.kind === 'profile') this.openAi(`/ai ${row.profile.name}`, row.profile.name);
      else if (row?.kind === 'harness') {
        // A provider with launch profiles (or simple ones to import) opens its launcher: configured identities are never bypassed.
        if (row.controllable && row.harness.id === 'claude') this.openManagedTarget(`/${row.harness.id}`, row.harness.id, 'open');
        else {
          const result = this.agents.launch(row.harness.id, this.shellCwd);
          if (result.ok) this.openAgentView(result.session.id); else panel.message = result.reason;
        }
      }
    }
    this.render();
  }

  private handleAgentViewKey(key: Key): void {
    const view = this.agentView!;
    const session = this.agents.get(view.sessionId);
    const close = !session || handleAgentInput(view, session, key, {
      shellEmpty: !this.editor.text,
      send: (id, text) => this.agents.send(id, text),
      answer: (id, requestId, allow) => this.agents.get(id)?.pendingApproval?.requestId === requestId && this.agents.answer(id, allow),
      cancel: id => {this.agents.cancel(id);},
      choose: (id, requestId, answers) => this.agents.choose(id, requestId, answers),
      openPicker: (target, kind) => {
        if (!this.agents.controllable(target.id)) return {ok: false, reason: `/${kind} needs a running managed Claude target with a live control channel.`};
        return kind === 'model' ? openModelPicker(target.telemetry) : openEffortPicker(target.telemetry, this.agentSettingsEffort.get(target.id));
      },
      togglePanel: state => {
        const columns = this.dimensions().columns;
        state.panel = !sidePanelShown(state.panel, columns);
        if (state.panel && columns < 72) { state.panel = undefined; return 'The panel needs at least 72 columns; widen the terminal.'; }
        return state.panel ? 'Panel shown. /panel hides it.' : 'Panel hidden. /panel shows it.';
      },
      refreshContext: target => {void this.agents.contextUsage(target.id).then(result => {
        if (this.agentView?.sessionId === target.id) this.agentView.message = result.ok ? `Context: ${result.value.totalTokens.toLocaleString()} of ${result.value.maxTokens.toLocaleString()} tokens, by Claude's count.` : `Context unavailable: ${result.reason}`;
        if (!this.stopped) this.render();
      });},
      applyPicker: (target, picker, row) => {void applyPickerChoice(view, picker, row, {
        setModel: model => this.agents.setModel(target.id, model), setEffort: level => this.agents.setEffort(target.id, level), render: () => { if (!this.stopped) this.render(); }});},
      copy: text => {void writeClipboard(text).then(() => {view.message = 'Copied.'; this.render();}).catch(() => {view.message = 'Clipboard unavailable.'; this.render();});},
      copyReply: (target, index) => {void this.copyAgentBlock(target, index);},
    });
    if (close) {this.agentView = undefined; this.returnFromPanel();}
    this.render();
  }

  /**
   * `/claude` and `/claude new` open the same launcher: existing targets and the launch profiles fresh ones start
   * from. `new` only changes the initial selection to a fresh target; nothing opens, resumes or starts until Enter or N.
   */
  private openManagedTarget(_command: string, provider: string, action: 'open' | 'new'): void {
    this.panelOrigin = undefined;
    this.agentPanel = undefined;
    const launcher: LauncherState = {provider, selected: 0};
    const configured = this.promptConfiguration.agentProfiles.filter(profile => profile.harness === provider);
    if (provider === 'claude' && !configured.length && !this.launcherDiscoverySkipped) {
      const names = new Set(this.promptConfiguration.agentProfiles.map(profile => profile.name));
      const found = this.discoverProfiles(names);
      if (found.length) launcher.found = found;
    }
    this.launcher = launcher;
    launcher.selected = initialSelection(this.launcherRows(), action);
  }

  private launcherRows(): LauncherRow[] {
    return this.launcher ? launcherRows(this.launcher, this.agents.sessions, this.promptConfiguration.agentProfiles) : [];
  }

  /** Start a fresh target from a launch profile (or the provider's default identity when none is configured). */
  private startTarget(provider: string, profile?: AgentProfile): boolean {
    const result = this.agents.launch(provider, this.shellCwd, profile ? {profile} : {});
    if (!result.ok) { if (this.launcher) this.launcher.message = result.reason; return false; }
    this.launcher = undefined;
    this.openAgentView(result.session.id);
    return true;
  }

  private handleLauncherKey(key: Key): void {
    const launcher = this.launcher!;
    const rows = this.launcherRows();
    launcher.message = undefined;
    if (launcher.searching) {
      if (key.kind === 'escape') { launcher.searching = false; launcher.query = undefined; }
      else if (key.kind === 'enter') launcher.searching = false;
      else if (key.kind === 'text' || key.kind === 'paste') launcher.query = ((launcher.query ?? '') + key.value.replace(/[\u0000-\u001f\u007f]/gu, '')).slice(0, 80);
      else if (key.kind === 'backspace') launcher.query = [...(launcher.query ?? '')].slice(0, -1).join('');
      launcher.selected = initialSelection(this.launcherRows(), 'open');
      this.render(); return;
    }
    const row = rows[launcher.selected];
    const profiles = this.promptConfiguration.agentProfiles;
    if (key.kind === 'escape' || key.kind === 'interrupt') { this.launcher = undefined; this.returnFromPanel(); }
    else if (key.kind === 'up' || key.kind === 'down') launcher.selected = moveSelection(rows, launcher.selected, key.kind === 'up' ? -1 : 1);
    else if (key.kind === 'text' && key.value === '/') { launcher.searching = true; launcher.query = ''; }
    else if (key.kind === 'text' && /^[nN]$/u.test(key.value)) {
      // A fresh target from the selected row's profile: the target's own launch profile, or the + New row's.
      const profile = row?.kind === 'target' ? row.profile : row?.kind === 'new' ? row.profile : undefined;
      const configured = profiles.filter(item => item.harness === launcher.provider);
      if (profile) this.startTarget(launcher.provider, profile);
      else if (!configured.length && row?.kind !== 'import' && row?.kind !== 'skip') this.startTarget(launcher.provider);
      else {
        launcher.selected = initialSelection(rows, 'new');
        launcher.message = 'Choose which account starts it: select its + New target and press Enter.';
      }
    } else if (key.kind === 'enter' && row) {
      if (row.kind === 'target') {
        const status = targetStatus(row.session);
        if (!status.live && status.resumable) {
          const resumed = this.agents.resume(row.session.id);
          if (!resumed.ok) { launcher.message = resumed.reason; this.render(); return; }
        }
        this.launcher = undefined;
        this.openAgentView(row.session.id);
      } else if (row.kind === 'new') this.startTarget(launcher.provider, row.profile);
      else if (row.kind === 'import' && launcher.found?.length) {
        const imported: AgentProfile[] = launcher.found.map(item => ({name: item.name, harness: launcher.provider, label: item.label, configDir: item.configDir}));
        const next = {...this.promptConfiguration, agentProfiles: normalizeProfiles([...profiles, ...imported])};
        try {
          savePromptConfiguration(next, undefined, this.promptConfiguration);
          this.promptConfiguration = next;
          launcher.found = undefined;
          launcher.message = `Imported ${imported.length} launch profile${imported.length === 1 ? '' : 's'}.`;
          launcher.selected = initialSelection(this.launcherRows(), 'new');
        } catch { launcher.message = 'Could not save the launch profiles; nothing was changed.'; }
      } else if (row.kind === 'skip') {
        this.launcherDiscoverySkipped = true;
        launcher.found = undefined;
        launcher.selected = initialSelection(this.launcherRows(), 'open');
      }
    }
    this.render();
  }

  /** Effort from each target's Claude settings files, read once off the render path. */
  private readonly agentSettingsEffort = new Map<string, string | undefined>();

  /** Header facts for an agent view: the launch profile's label and configured model, and the shell's branch when the target shares its directory. */
  private agentViewMeta(session: AgentSession): AgentViewMeta {
    const profile = session.profileId ? this.promptConfiguration.agentProfiles.find(item => item.name === session.profileId) : undefined;
    if (session.harness === 'claude' && session.cwd && !this.agentSettingsEffort.has(session.id)) {
      this.agentSettingsEffort.set(session.id, undefined);
      void settingsEffort(profile?.configDir, session.cwd).then(level => { if (level && !this.stopped) { this.agentSettingsEffort.set(session.id, level); this.render(); } });
    }
    const effort = this.agentSettingsEffort.get(session.id);
    const defaultDir = process.env.CLAUDE_CONFIG_DIR ? process.env.CLAUDE_CONFIG_DIR.replace(/^\/(?:Users|home)\/[^/]+/u, '~') : '~/.claude';
    return {...(profile ? {profileLabel: profileLabel(profile), ...(profile.model ? {configuredModel: profile.model} : {})} : {identity: session.harness === 'claude' ? `Default identity · ${defaultDir}` : 'Default identity'}),
      ...(session.cwd === this.shellCwd && this.context.branch ? {branch: this.context.branch} : {}), ...(effort ? {settingsEffort: effort} : {})};
  }

  private openMods(provider?: string): void {
    this.panelOrigin = undefined;
    this.modsPanel ??= new ModsController();
    this.modsPanel.setProvider(provider);
    void this.refreshMods();
  }

  /** Where the shell is, as Git reports paths (macOS /tmp is /private/tmp), so removal never offers the shell's own worktree. */
  private canonicalShellCwd(): string {
    try { return realpathSync(this.shellCwd); } catch { return this.shellCwd; }
  }

  private async openWorktrees(select?: string): Promise<void> {
    const git = createGitRunner();
    let repository: string;
    try { repository = await repositoryIdentity(git, this.shellCwd); } catch (error) {
      this.output.addFrontendInteraction('/worktrees', `No worktrees here: ${worktreeText((error as Error).message, 200)}.`, INFO);
      this.render(); return;
    }
    this.panelOrigin = undefined;
    // Related PRs only from the last /github listing of this same github.com repository; never fetched from here.
    const origin = await this.githubOrigin();
    const controller = new WorktreeManagerController({git, repository, currentPath: () => this.canonicalShellCwd(),
      pullRequests: () => (origin && this.githubListing?.repository.toLowerCase() === origin.toLowerCase() ? this.githubListing : undefined)});
    const panel = {controller, git, ...(select ? {select} : {})};
    this.worktreePanel = panel;
    this.render();
    await controller.refresh();
    if (this.worktreePanel !== panel) return;
    if (select) {
      const match = controller.state.snapshot?.worktrees.find(worktree => worktree.branch === select);
      if (match) controller.select(match.id);
      else this.worktreePanel.notice = `No worktree has ${worktreeText(select, 120)} checked out. n creates one.`;
    }
    this.render();
  }

  /** Live managed agents working inside a worktree: removing it would pull the directory out from under them. */
  private agentsInside(path: string): string[] {
    const live = this.agents.sessions.filter(session => !['finished', 'failed', 'exited'].includes(session.state) && session.cwd);
    return live.filter(session => {
      let cwd = session.cwd!;
      try { cwd = realpathSync(cwd); } catch { /* keep as reported */ }
      return cwd === path || cwd.startsWith(`${path}/`);
    }).map(session => session.title);
  }

  private async handleWorktreeKey(key: Key): Promise<void> {
    const panel = this.worktreePanel;
    if (!panel) return;
    const {controller} = panel;
    if (panel.branch !== undefined) {
      if (key.kind === 'escape') panel.branch = undefined;
      else if (key.kind === 'backspace') panel.branch = [...panel.branch].slice(0, -1).join('');
      else if ((key.kind === 'text' || key.kind === 'paste') && !/[\u0000-\u001f\u007f-\u009f\s]/u.test(key.value)) panel.branch = (panel.branch + key.value).slice(0, 200);
      else if (key.kind === 'enter' && controller.state.snapshot) {
        const request = await newWorktreeRequest(panel.git, controller.state.snapshot, panel.branch);
        if (this.worktreePanel !== panel) return;
        if ('error' in request) panel.notice = request.error;
        else { panel.branch = undefined; panel.notice = undefined; await controller.planNew(request); }
      }
      if (this.worktreePanel === panel) this.render();
      return;
    }
    panel.notice = undefined;
    if (key.kind === 'text' && key.value.toLowerCase() === 'x' && !controller.state.review && !controller.state.searching) {
      const selected = controller.selected();
      const agents = selected ? this.agentsInside(selected.path) : [];
      if (agents.length) { panel.notice = `Not removed: ${agents.length === 1 ? 'agent' : 'agents'} ${agents.map(title => worktreeText(title, 60)).join(', ')} ${agents.length === 1 ? 'is' : 'are'} working there.`; this.render(); return; }
    }
    const outcome = await controller.handleKey(key);
    if (this.worktreePanel !== panel) return;
    if (outcome.kind === 'back') { this.worktreePanel = undefined; this.returnFromPanel(); }
    else if (outcome.kind === 'requestNewWorktree') panel.branch = '';
    else if (outcome.kind === 'navigate' && outcome.intent.kind === 'cd') {
      if (this.editor.text.trim()) panel.notice = 'Your draft is kept. Clear the composer, then press Enter here to stage the cd.';
      else {
        let command: string | undefined;
        try { command = directoryCommand(outcome.intent.path); } catch { panel.notice = 'That path cannot be typed safely as a cd command.'; }
        if (command) { this.worktreePanel = undefined; this.returnFromPanel(); this.applySuggestion({insertion: command}); }
      }
    }
    else if (outcome.kind === 'openPullRequest') {
      this.worktreePanel = undefined;
      this.returnFromPanel();
      await this.openGithub('prs', outcome.pr.ref);
    }
    this.render();
  }

  private worktreeRows(columns: number, rows: number): string[] {
    const panel = this.worktreePanel!;
    const glyphs = this.promptConfiguration.glyphStyle === 'safe' ? 'safe' : 'nerd';
    const extra = [
      ...(panel.branch !== undefined ? [`New worktree branch: ${panel.branch}${glyphs === 'safe' ? '_' : '▏'}`, 'Enter plans it (nothing changes yet) · Esc cancels'] : []),
      ...(panel.notice ? [panel.notice] : []),
    ].map(line => truncateText(line, Math.max(1, columns)));
    const body = renderWorktreeView(buildWorktreeView(panel.controller), {columns, rows: Math.max(1, rows - extra.length), glyphs, level: colorLevel(), home: homedir()});
    return [...body, ...extra];
  }

  /** The github.com repository of the shell directory's `origin`, when it has one. */
  private async githubOrigin(cwd = this.shellCwd): Promise<string | undefined> {
    const remote = await createGitRunner()(cwd, ['remote', 'get-url', '--', 'origin'], {timeoutMs: 2000, maxBytes: 4096});
    return succeeded(remote) ? githubRepositoryFromRemote(remote.stdout) : undefined;
  }

  /**
   * The pull requests the last /github listing loaded, with its repository: the only evidence /worktrees uses for a
   * related PR (it never fetches). Replaced whenever a /github PR list loads.
   */
  private githubListing?: {repository: string; prs: PrSummary[]};

  private async openGithub(tab: ListTab, pullRequest?: PrSummary['ref']): Promise<void> {
    const repository = await this.githubOrigin();
    if (!repository) {
      this.output.addFrontendInteraction(`/${tab === 'issues' ? 'issues' : 'github'}`, 'This directory has no github.com origin remote, so there is no repository to show.', INFO);
      this.render(); return;
    }
    this.panelOrigin = undefined;
    const controller = new GithubWorkspaceController(new GithubWorkspaceService(new GhSource()), {
      title: `${repository} (read-only)`, initialTab: tab,
      initialQueries: {prs: `repo:${repository} is:open`, issues: `repo:${repository} is:open`, search: `repo:${repository}`},
    });
    attachRenderer(controller, () => this.githubRenderOptions(this.githubPanel?.columns ?? this.dimensions().columns, this.dimensions().rows - 4));
    const detach = controller.onChange(() => {
      const list = controller.snapshot.lists.prs;
      if (list.status === 'loaded') this.githubListing = {repository, prs: list.items.filter((item): item is PrSummary => item.ref.kind === 'pr')};
      if (this.githubPanel?.controller === controller) this.render();
    });
    this.githubPanel = {controller, repository, detach};
    this.render();
    await controller.submitQuery(tab);
    // From /worktrees' related PR: that pull request's detail, read-only like every other.
    if (pullRequest && this.githubPanel?.controller === controller) await controller.openDetail(pullRequest);
  }

  private githubRenderOptions(columns: number, rows: number): GithubRenderOptions {
    return {columns, rows: Math.max(1, rows), glyphs: this.promptConfiguration.glyphStyle === 'safe' ? 'safe' : 'nerd', color: colorLevel(), now: Date.now()};
  }

  private githubRows(columns: number, rows: number): string[] {
    const panel = this.githubPanel!;
    panel.columns = columns;
    panel.controller.setViewport(columns, rows);
    return renderWorkspace(panel.controller.snapshot, panel.controller.availableActions(), this.githubRenderOptions(columns, rows));
  }

  private handleGithubKey(key: Key): void {
    const panel = this.githubPanel;
    if (!panel) return;
    const mapped = workspaceKey(key);
    const intent = mapped ? panel.controller.handleKey(mapped) : undefined;
    if (intent) this.githubIntent(panel, intent);
    this.render();
  }

  private githubIntent(panel: NonNullable<TerminalApp['githubPanel']>, intent: WorkspaceIntent): void {
    if (intent.type === 'Exit') { panel.detach(); this.githubPanel = undefined; this.returnFromPanel(); return; }
    if (intent.type === 'OpenRelatedWorktree') {
      if (intent.headRepository && intent.headRepository.toLowerCase() !== panel.repository.toLowerCase()) { panel.controller.notify(`The branch lives in ${intent.headRepository}, a fork; there is no local worktree for it here.`); return; }
      panel.detach(); this.githubPanel = undefined;
      void this.openWorktrees(intent.headRef);
      return;
    }
    const url = safeGithubUrl(intent.url);
    const opener = url ? selectOpener() : undefined;
    if (!url || !opener) { panel.controller.notify(url ? `No system URL opener here. The URL is ${url}` : 'That link is not a github.com URL, so it was not opened.'); return; }
    try { spawn(opener, [url], {detached: true, stdio: 'ignore'}).unref(); panel.controller.notify(`Opened ${url}`); } catch { panel.controller.notify(`Couldn't open ${url}`); }
  }

  private async refreshMods(): Promise<void> {
    const panel = this.modsPanel;
    if (!panel) return;
    await panel.refresh(async () => withLoadedIn(await loadModInventory(this.shellCwd, this.buildIdentity.version, this.promptConfiguration.agentProfiles), this.agents.sessions));
    if (this.modsPanel === panel) this.render();
  }

  /**
   * The confirmed change, through Claude's own command at the plugin's installed scope; then the listing is read again
   * as evidence, and running managed targets of the same launch identity reload plugins. Says exactly what happened.
   */
  private async toggleMod(): Promise<void> {
    const panel = this.modsPanel;
    const pending = panel?.confirm;
    const entry = panel?.inventoryEntry(pending?.key);
    if (!panel || !pending || !entry) return;
    panel.confirm = undefined;
    const executable = resolveCommand('claude');
    if (!executable) { panel.message = 'Claude Code is not on PATH.'; this.render(); return; }
    panel.busy = `${pending.enable ? 'Enabling' : 'Disabling'} ${entry.name}…`;
    this.render();
    try {
      const installed = new Set(panel.entries.filter(item => item.profileId === entry.profileId && item.claude).map(item => item.claude!.pluginId));
      const result = await setPluginEnabled(executable, entry, pending.enable, installed);
      if (!result.ok) { panel.message = `Not changed: ${result.message}`; return; }
      await panel.refresh(async () => withLoadedIn(await loadModInventory(this.shellCwd, this.buildIdentity.version, this.promptConfiguration.agentProfiles), this.agents.sessions));
      const after = panel.inventoryEntry(pending.key);
      const confirmed = after?.enabled === (pending.enable ? 'yes' : 'no');
      const targets = this.agents.sessions.filter(session => session.harness === 'claude' && session.level === 'managed' && (session.profileId ?? undefined) === (entry.profileId ?? undefined)
        && this.agents.controllable(session.id) && (entry.claude?.scope === 'user' || session.cwd === entry.claude?.projectPath));
      const reloads = await Promise.all(targets.map(async session => ({session, result: await this.agents.reloadPlugins(session.id)})));
      const reloaded = reloads.filter(item => item.result.ok);
      const errors = reloaded.reduce((sum, item) => sum + (item.result.ok ? item.result.value.errors : 0), 0);
      panel.message = [
        `${entry.name} ${pending.enable ? 'enabled' : 'disabled'}${result.alreadyInGoalState ? ' (it already was)' : ''}${confirmed ? ', confirmed by Claude\'s listing' : ', but Claude\'s listing does not show it yet'}.`,
        targets.length ? `Reloaded in ${reloaded.length} of ${targets.length} running managed session${targets.length === 1 ? '' : 's'}${errors ? `; Claude reported ${errors} plugin load error${errors === 1 ? '' : 's'}` : ''}.` : 'New sessions pick it up; no managed session on this account is running.',
        'Claude\'s own terminal sessions need /reload-plugins or a restart.',
      ].join(' ');
      if (this.modsPanel === panel) panel.setInventory(withLoadedIn([...panel.entries], this.agents.sessions));
    } finally {
      panel.busy = undefined;
      if (this.modsPanel === panel) this.render();
    }
  }

  private async inspectMod(): Promise<void> {
    const panel = this.modsPanel;
    const entry = panel?.selectedEntry;
    const executable = resolveCommand('claude');
    if (!panel || !entry?.claude || !executable || panel.inspections.has(entry.key)) return;
    panel.busy = `Asking Claude to describe ${entry.name}…`;
    this.render();
    try { panel.inspections.set(entry.key, await inspectPlugin(executable, entry)); }
    finally { panel.busy = undefined; if (this.modsPanel === panel) this.render(); }
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
    this.shellPanel = createShellPanel(shellAvailability(process.env, true), this.shellId, this.promptConfiguration.shellBackend, this.switchBlocker(), this.promptConfiguration);
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
    this.batchReview = undefined;
    this.pasteReview = undefined;
    this.pastePreview = undefined;
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
    // A history navigation belongs to the shell it browsed: an arrow after the switch must never step the old
    // shell's snapshot, and the new shell's history starts its own session. The draft in the editor is untouched.
    this.composerHistory.reset();
    // The old shell's zone ends here; the new shell's first prompt opens the next one.
    this.hostSemantics.end();
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
      running: Boolean(this.running) || Boolean(this.queueLine(80)),
      detached: this.historyViewport.detached,
      hasOutput: transcriptRows > 0,
      composerPosition: this.promptConfiguration.composerPosition,
      panelPosition: this.panelPositionInEffect(),
      transcriptRows,
      contextPlacement: this.promptConfiguration.placement,
      hasVisibleContext: this.hasVisibleProviderPrompt(),
      // Prompt None is only the input: framed like the one-line composer (divider, input, divider), never a two-line gap.
      composerLayout: this.effectivePromptProvider === 'none' ? 'oneLine' : this.promptConfiguration.composerLayout,
      composerDividers: this.promptConfiguration.composerDividers,
      panelRows,
      railPresentation: this.preparedRail(columns).presentation,
    };
    // Timeline chrome borrows transcript rows. Its activity/transient reservation never resizes the shell PTY.
    const planned = (overrides: Partial<typeof input> & {viewStart?: number} = {}): ScreenPlan => {
      const visible = planScreen({...input, ...overrides});
      if (this.queueState.timeline) visible.ptyRows = planScreen({...input, ...overrides, running: Boolean(this.running)}).ptyRows;
      return visible;
    };
    // The expanded queue asks for exactly the rows its block needs within what the transcript can spare, so the plan
    // and the painted block always agree (a block painted at its own height is the same block).
    const listed = (plan: ScreenPlan) => {
      if (panelRows !== undefined) return plan;
      const budget = Math.min(this.queueBudget(rows), Math.max(0, plan.transcript.height - QUEUE_MIN_TRANSCRIPT_ROWS) + 1);
      // The timeline's and the summary's own first row is their header; only the expanded entry list shares its
      // first row with the activity region.
      const inline = this.timelineVisible() || Boolean(this.summaryChrome());
      return withQueueRows(plan, Math.max(0, (this.queueBlockRows(columns, budget)?.length ?? 0) - (inline ? 0 : 1)), inline);
    };
    if (input.composerPosition !== 'flow' || !input.detached || panelRows !== undefined) return listed(planned());
    // Flow scrolled back: where the view starts decides how much of the composer
    // is still on screen, and it is resolved against the following capacity.
    const following = planned({detached: false});
    const viewStart = this.historyViewport.resolve(transcriptRows, following.viewportRows);
    return listed(this.historyViewport.detached ? planned({viewStart}) : following);
  }

  /**
   * The expanded queue (header and list) when the screen has room, else undefined (the one-line row says it). Room
   * follows the terminal's height: up to three commands from 24 rows, two from 18, none below. Hidden while a
   * program waits for input: its question stays next to the composer.
   */
  private queueBlockRows(columns: number, budget: number): string[] | undefined {
    this.queueVisibleRows.clear();
    // The summary's own container: the newest saved artifact at idle, or exactly what an armed save review showed.
    const chrome = this.summaryChrome();
    if (chrome) return budget >= 3 ? renderQueueSummary(chrome.summary, columns, budget,
      {...this.summaryViewOptions(), ...(chrome.review ? {title: 'Save this Queue Summary?'} : {})}) : undefined;
    if (!this.queueAvailable() || (!this.queueState.entries.length && !this.timelineVisible()) || this.queueEdit) return undefined;
    if (this.running && (this.inputState?.request || this.passthrough)) return undefined;
    const review = this.queueReview?.kind;
    const now = this.activityAnimationNow || Date.now();
    return budget >= 2 ? queueBlock(this.queueState, columns, budget, {now, animate: this.decorativeMotionAllowed() && colorLevel() !== 'none' && colorLevel() !== 'ansi16' && getCurrentGlyphMode() !== 'safe', treatment: this.promptConfiguration.presentation,
      liveTimeline: this.promptConfiguration.queue.liveTimeline, recentResults: this.promptConfiguration.queue.recentResults, upcoming: this.promptConfiguration.queue.upcoming,
      row: (key, index) => this.queueVisibleRows.set(key, index),
      animationElapsed: this.running ? presentationAnimationElapsed(now - this.running.startedAt) : 0,
      ...(review ? {review} : {}), ...(this.queueAffordance() ? {affordance: this.queueAffordance()!} : {})}) : undefined;
  }

  /** Rows the expanded queue may use (header included) on a screen of `rows`; the plan may give it fewer. */
  private queueBudget(rows: number): number {
    if (this.summaryChrome()) return rows >= 30 ? 8 : rows >= 24 ? 6 : rows >= 18 ? 4 : 0;
    if (this.timelineVisible()) return rows >= 30 ? 7 : rows >= 24 ? 6 : rows >= 18 ? 3 : 0;
    return rows >= 28 && this.queueReview?.kind === 'approve' ? 7 : rows >= 24 ? 5 : rows >= 18 ? 3 : 0;
  }

  /**
   * The summary the chrome shows: exactly what an armed save review displayed, else the newest saved artifact at
   * idle — no queue entries, nothing running, the timeline's own view dismissed. A new chain, the timeline's
   * transient view and the expanded queue all own the space instead; the entry list itself never shows summaries.
   */
  private summaryChrome(): {summary: QueueSummary; review: boolean} | undefined {
    if (this.summaryReview) return {summary: this.summaryReview.summary, review: true};
    if (!this.queueAvailable() || this.running || this.timelineVisible() || this.queueState.entries.length || this.queueEdit) return undefined;
    // A restored archive shows the summaries its own transcript carried; a live view shows the owner's newest.
    const latest = (this.presentationOwned ? this.queueState.summaries : this.output.queueSummaries)?.at(-1);
    return latest ? {summary: latest, review: false} : undefined;
  }

  /** The one presentation contract: the chrome and its review read the same Queue Settings. */
  private summaryViewOptions(now = Date.now()): QueueSummaryViewOptions {
    const queue = this.promptConfiguration.queue;
    return {detail: queue.summaryDetail, placement: queue.summaryPlacement, align: queue.summaryAlign,
      durations: queue.summaryDurations, exitCodes: queue.summaryExitCodes, inputWaits: queue.summaryInputWaits,
      treatment: this.promptConfiguration.presentation, now};
  }

  /**
   * What the queue offers from an empty Enter: only at idle (no command, so no program can be waiting for input),
   * with an empty composer and nothing else owning input. A paused queue offers a review before resuming; an entry
   * that asks first offers a review before approving. Nothing ever runs from one key.
   */
  private queueAffordance(): QueueAffordance | undefined {
    if (this.running || this.passthrough || this.startupPending || this.editor.text || this.queueEdit || this.queueCompose || this.queuePanel || this.pendingQueuePause) return undefined;
    if (!this.queueAvailable() || !this.queueState.entries.length) return undefined;
    if (this.queueState.paused) return 'resume';
    const next = this.queueState.entries[0]!;
    return this.queueConditionsAvailable() && next.condition === 'approve' && !next.approved ? 'approve' : undefined;
  }

  /** Keys while a queue review is armed: it owns them until confirmed or dismissed. */
  private queueReviewKey(key: Key): void {
    const review = this.queueReview!;
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    if (key.kind === 'enter' || value === 'y') {
      this.queueReview = undefined;
      this.queueConfirmedAt = Date.now();
      // The exact entry that was reviewed: a queue that changed meanwhile already dismissed the review.
      const change = review.kind === 'approve' ? {op: 'approve' as const, id: review.id} : {op: review.kind === 'clear' ? 'clear' as const : 'resume' as const};
      const count = this.queueState.entries.length;
      this.session.queue({...change, ...(review.revision === undefined ? {} : {expectedRevision: review.revision})});
      if (review.kind === 'clear' && !this.queueState.entries.length) this.output.addFrontendInteraction('/queue', `Cleared ${count} queued command${count === 1 ? '' : 's'}; none of them ran.`, INFO);
    } else if (key.kind === 'escape' || key.kind === 'interrupt' || value === 'n') {
      this.queueReview = undefined;
      // Not now: an entry that asks first would hold everything typed behind it, so the queue pauses and commands run.
      if (review.kind === 'approve' && value === 'n') {
        this.requestQueuePause('/queue', true, review.revision);
      }
    } else if (value === 'e') {
      this.queueReview = undefined;
      this.beginQueueEdit(review.id);
    }
    this.render();
  }

  private render(): void {
    this.reconcileOutputNavigation();
    if (this.stopped || this.passthrough || this.externalPassthrough || this.frontendSuspended) { this.cancelPresentation(); return; }
    this.hostSemantics.flush();
    this.hostTitle.set(this.desiredTitle());
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
    this.renderRail = undefined;
    this.renderRail = {columns, prepared: this.preparedRail(columns)};
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
      this.output.setScreenRows(plan.ptyRows);
      this.output.setScreenColumns(columns);
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
    this.visibleBlocks = wrapped.slice(viewStart, viewStart + outputHeight).map(row => row.blockStartId);
    const transcriptTop = plan.regions.find(region => region.kind === 'transcript')?.top ?? 0;
    this.welcomeFrameRows = new Map();
    wrapped.slice(viewStart, viewStart + outputHeight).forEach((row, offset) => { if (row.firstRunLine !== undefined) this.welcomeFrameRows.set(transcriptTop + offset, row.firstRunLine); });
    const sticky = this.stickyHeader(wrapped, viewStart);
    // While the block's header is scrolled away, its controls ride on the sticky row instead: never both.
    const stickyControls = sticky ? this.stickyControls(sticky.startId, columns) : undefined;
    const visible = wrapped.slice(viewStart, viewStart + outputHeight).map((row, offset) => {
      // Selected output rows: the selection background, or reverse video without color, so they never vanish.
      if (isRowSelected(this.selection, viewStart + offset)) return colorLevel() === 'none' ? `\u001b[7m${row.plain}${RESET}` : `${background(UI_COLORS.selection)}${PRIMARY}${row.plain}${RESET}`;
      const marked = findSpans.get(viewStart + offset);
      if (marked) return markSpans(row.plain, marked.spans, `${background(UI_COLORS.selection)}${PRIMARY}`, marked.active ? `${PRIMARY}` : SECONDARY,
        marked.active ? '' : '\u001b[4m');
      const ansi = presenter.decorate(row, row.lineIndex === undefined ? undefined : this.output.lineTypes.get(row.lineIndex), interaction);
      const focused = this.focusedCommandIndex !== undefined && row.lineIndex === this.output.recent(this.focusedCommandIndex + 1)?.startId;
      const controls = !this.running && (focused || row.lineIndex === this.hoveredLineIndex) && !(stickyControls && row.blockStartId === sticky?.startId)
        ? blockAffordance(row, columns, this.controlOptions(row.blockStartId)) : undefined;
      return controls ? `${ansi}${RESET}${this.styledControls(controls)}` : ansi;
    });
    const stickyRow = sticky && (stickyControls
      ? this.output.presentSticky(sticky.startId, columns, this.styledControls(stickyControls.controls, stickyControls.width), stickyControls.width)
      : this.output.presentSticky(sticky.startId, columns));
    if (stickyRow && visible.length > 0) visible[0] = stickyRow;
    if (this.outputNavigation && !panelRows) {
      const focusedId = this.outputNavigation.focusedId;
      visible.forEach((ansi, offset) => {
        if (wrapped[viewStart + offset]?.blockStartId === focusedId) visible[offset] = selectedRowBand(ansi, columns);
      });
    }
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

    const direct = this.directInputRequest();
    const inputRows = input.rows.map(row => {
      // While a program waits for the person, the composer's mark takes the waiting color: typing answers it.
      const mark = this.running && !this.passthrough && !this.queueCompose && this.answersByDefault() ? ATTENTION : ACCENT;
      const prefix = row.prefix.startsWith(GLYPHS.prompt) ? `${mark}${GLYPHS.prompt}${RESET}${row.prefix.slice(GLYPHS.prompt.length)}` : row.prefix;
      if (direct) {
        return row === input.rows[0] ? truncateAnsi(`${prefix}${SECONDARY}${inputComposerHint(direct, inputProgram(direct, this.running!.command), this.queueAvailable())}${RESET}`, this.inputColumns(columns)) : '';
      }
      const hint = row === input.rows[0] && !this.editor.text ? this.composerHint() : undefined;
      // An instruction for a waiting program reads at secondary contrast; the ordinary running hint stays subtle.
      if (hint) return truncateAnsi(`${prefix}${hint.waiting ? SECONDARY : SUBTLE}${hint.text}${RESET}`, this.inputColumns(columns));
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
      const editorColumns = this.inputColumns(columns);
      const line = truncateAnsi(`${prefix}${textStyled}${suffix}`, editorColumns);
      if (row.charStart !== 0 || row !== input.allRows[0]) return line;
      // Input row placement: the reserved trailing cells, outside the editor's own width.
      const accessory = plan.awake?.slot === 'inputTrailing' && editorColumns < columns ? this.awakeViewNow()?.compact : undefined;
      if (accessory) return `${line}${RESET}${' '.repeat(Math.max(0, columns - displayWidth(line) - accessory.width))}${accessory.ansi}`;
      return `${line}${this.oneLineRightContext(line, columns)}`;
    });

    // The plan decides where each region lives; this only decides what paints into it.
    // Composer top and bottom edges share one renderer (composerEdgeRow); the prompt row's divider fill uses the same rule source.
    const now = Date.now();
    const regionRows = (region: Region): string[] => {
      switch (region.kind) {
        // Setup Cat owns a clean screen: the ordinary transcript/welcome is not drawn behind it (presentation only; nothing is cleared).
        case 'transcript': return this.setupState ? [] : visible;
        case 'gap': return [];
        case 'jump': return [this.jumpAffordance(columns)];
        // The frame line sits on the panel edge that faces the transcript: the bottom edge for a Top panel.
        case 'panel': return plan.panelPosition === 'top' && panelRows && /^[─-]+$/u.test(stripAnsi(panelRows[0] ?? ''))
          ? [...panelRows.slice(1), panelRows[0]!] : panelRows ?? [];
        case 'inspector': return this.inspectorRows(columns);
        case 'suggestions': return this.orientPicker([...suggestionView.items.map((suggestion, visibleIndex) => {
          const selected = suggestionView.start + visibleIndex === effectiveSelection;
          if ('correction' in suggestion) return renderCorrection(suggestion, columns);
          if ('source' in suggestion && 'replacement' in suggestion) {
            return renderCompletion(suggestion, selected, columns, this.completionDescription(suggestion));
          }
          return truncateAnsi(
            `${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${suggestion.name.padEnd(10)}${RESET}${SECONDARY} ${suggestion.description}${RESET}`,
            columns,
          );
        }), ...(menuOverflow ? [renderCompletionMore(hiddenBelow, suggestionView.start, columns)] : [])]);
        // The spacer sits between the newest output and the activity line in both positions.
        case 'activity': return this.activityRows(plan, columns);
        case 'queue': return this.timelineVisible() || this.summaryChrome()
          ? this.queueBlockRows(columns, region.height) ?? []
          : this.queueBlockRows(columns, region.height + 1)?.slice(1) ?? [];
        case 'composerBorder': return [this.composerEdgeRow('composerBorder', plan, columns, now)];
        case 'prompt': return [promptLine];
        case 'input': return inputRows;
        case 'separator': return [this.composerEdgeRow('separator', plan, columns, now)];
        case 'contextRail': case 'railGap': case 'railEdge': return [];
        case 'awake': return this.awakeRows(plan, columns);
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

    // The agent view's draft owns typing: the terminal caret sits in its composer row (a Top panel ends with its frame rule).
    const panelRegion = plan.regions.find(region => region.kind === 'panel');
    const agentOffset = this.agentCaret && panelRegion ? this.agentCaret.row - (plan.panelPosition === 'top' ? 1 : 0) : -1;
    const agentCaretRow = plan.panelActive && panelRegion && agentOffset >= 0 && agentOffset < panelRegion.height ? panelRegion.top + agentOffset : undefined;
    const frame: TerminalFrame = {
      rows: frameRows,
      columns,
      cursorRow: terminalRowFromScreen(agentCaretRow ?? cursorScreenRow(plan, input.caretRow)),
      cursorColumn: Math.max(1, Math.min(columns, (agentCaretRow !== undefined ? this.agentCaret!.column : input.caretColumn) + 1)),
      // Flow can scroll the input row off screen.
      cursorVisible: agentCaretRow !== undefined || (!plan.panelActive && plan.inputHeight > 0),
    };
    this.renderer.setImageOverlay(this.aboutOverlay(plan, columns));
    this.presentationFrame = {frame, plan, ...(agentCaretRow !== undefined ? {agentCaretRow} : {})};
    this.paintPresentation(Date.now());
    this.renderRail = undefined;
    this.syncPresentationClock();
    this.syncStartupSky();
  }

  /**
   * The starting-point selector's sky: one clock at the band's own cadence (40 ms while a cross-fade or tail flick
   * runs, 200/320 ms at rest) that repaints only the panel. None under Reduced Motion, Effects Off, Off, NO_COLOR or
   * 16 colors, after 60 s without a key, while the guided setup is open, and never after the selector closes.
   */
  private startupSkyClock?: () => void;
  private startupSkyInterval = 0;
  private syncStartupSky(now = Date.now()): void {
    const state = this.setupState, quick = state?.quick;
    const shown = Boolean(quick && !quick.manual && !state!.cursorPanel && !state!.toolBrowser) && !this.stopped && !this.idle
      && !this.passthrough && !this.externalPassthrough && !this.frontendSuspended;
    const interval = shown && quick ? skyFrameMs({now, changedAt: quick.changedAt, activeAt: quick.sky.activeAt, backdrop: quick.backdrop,
      reduced: state!.context.startup?.reduced ?? !this.decorativeMotionAllowed()}) : 0;
    if (interval === this.startupSkyInterval && Boolean(this.startupSkyClock) === interval > 0) return;
    this.startupSkyClock?.(); this.startupSkyClock = undefined;
    this.startupSkyInterval = interval;
    if (interval > 0) this.startupSkyClock = presentationClock.subscribe(() => this.paintStartupSky(), interval, Math.min(40, interval));
  }

  /** One sky frame: the panel region of the cached frame is redrawn (the ground comes from its cache); nothing else. */
  private paintStartupSky(): void {
    if (!this.stopped && this.setupState?.quick && !this.setupState.quick.manual) this.renderTaskPresentation();
    this.syncStartupSky();
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
    const row = region.top + (plan.panelPosition === 'top' ? 0 : 1) + 2;
    if (row + size.rows > region.top + region.height) return undefined;
    return createImageOverlay(panel.protocol, panel.png, `about:${panel.protocol}:${row}:${size.columns}x${size.rows}`, row, 2 + (this.workspace.open ? this.workspaceColumns().center.x : 0), size);
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
    const projected = cached.plan.panelPosition === 'top' && /^[─-]+$/u.test(stripAnsi(content[0] ?? ''))
      ? [...content.slice(1), content[0]!] : content;
    const rows = [...cached.frame.rows];
    for (let index = 0; index < region.height; index++) rows[region.top + index] = projected[index] ?? '';
    this.presentationFrame = {...cached, frame: {...cached.frame, rows}};
    this.paintPresentation(Date.now());
  }

  /**
   * The short transitions, in one composition order after Chroma and before the cursor:
   * prompt morph, launch, materialization, Block Seal, Semantic Echo. Drawn by the selected rendering (Clean or Rich).
   */
  private paintTransitions(rows: string[], plan: ScreenPlan, columns: number, now: number): void {
    // Context morph: a semantic diff of the prompt's modules (never raw ANSI); one epoch per change.
    if (this.promptConfiguration.motion.contextTransitions !== 'off' && this.effectivePromptProvider === 'nmsh') {
      const modules = renderedModules(this.promptContext(), this.promptConfiguration).map(module => ({id: module.id, text: module.text, role: module.role}));
      if (this.lastModules) { const changes = diffModules(this.lastModules, modules); if (changes.length) this.transitions.morph(changes, now); }
      this.lastModules = modules;
    }
    this.transitions.editorChanged(this.editor.text);
    const rowTargets = new Map<string, number>();
    const queue = regionOf(plan, 'queue');
    const activity = regionOf(plan, 'activity');
    if (!plan.panelActive && !this.passthrough && !this.externalPassthrough && !this.inputState?.request && this.timelineVisible()) {
      if (queue) for (const [key, index] of this.queueVisibleRows) if (index < queue.height) rowTargets.set(key, queue.top + index);
      if (activity && this.queueState.timeline) rowTargets.set(queueRowKey(this.queueState.timeline.id, 'summary'), activity.top);
    }
    this.transitions.retainRows(new Set(rowTargets.keys()));
    const current = this.transitions.live(now); // Prune even while a panel owns input.
    const live = plan.panelActive || this.passthrough || this.externalPassthrough ? [] : current;
    const paints = new Map<number, Map<number, CellPaint>>();
    const add = (row: number, cells: Map<number, CellPaint>) => {
      if (row < 0 || row >= rows.length || !cells.size) return;
      const line = paints.get(row) ?? new Map<number, CellPaint>();
      for (const [column, paint] of cells) line.set(column, {...line.get(column), ...paint});
      paints.set(row, line);
    };
    const regions = (...kinds: string[]) => plan.regions.filter(region => kinds.includes(region.kind) && region.height > 0);
    for (const transition of live) {
      const t = progress(transition, now);
      if (transition.kind === 'row') {
        const row = rowTargets.get(transition.target);
        if (row !== undefined) add(row, transitionPaint.row(transition.tone, columns, t, transition.style, transition.look));
      } else if (transition.kind === 'launch') {
        for (const region of regions('input', 'separator', 'composerBorder')) for (let index = 0; index < region.height; index += 1) {
          add(region.top + index, transitionPaint.launch(transition.style, columns, t, region.kind !== 'input', transition.look));
        }
      } else if (transition.kind === 'materialize') {
        const input = regions('input')[0];
        if (!input) continue;
        const prefix = this.railInputPrefix(columns);
        const at = (index: number) => layoutInput(this.editor.displayText, index, this.inputColumns(columns), Number.POSITIVE_INFINITY, prefix);
        const from = at(transition.from);
        const to = at(transition.to);
        const caret = this.layoutEditorInput(columns, Math.max(1, input.height));
        const offset = caret.caretRow - at(this.editor.displayCursorIndex).caretRow;
        if (from.caretRow === to.caretRow) add(input.top + from.caretRow + offset, transitionPaint.materialize(from.caretColumn, to.caretColumn, t, transition.vivid, transition.look));
      } else if (transition.kind === 'travel') {
        const input = regions('input')[0];
        if (!input) continue;
        const caret = this.layoutEditorInput(columns, Math.max(1, input.height));
        add(input.top + transition.row + (caret.caretRow - layoutInput(this.editor.displayText, this.editor.displayCursorIndex, this.inputColumns(columns), Number.POSITIVE_INFINITY, this.railInputPrefix(columns)).caretRow),
          transitionPaint.travel(transition.from, transition.to, t, transition.look));
      } else if (transition.kind === 'seal') {
        const transcript = plan.regions.find(region => region.kind === 'transcript');
        const index = this.visibleBlocks.lastIndexOf(transition.blockStartId);
        if (transcript && index >= 0) add(transcript.top + index, transitionPaint.seal(transition.tone, columns, t, transition.look));
      } else if (transition.kind === 'echo') {
        for (const region of regions('separator', 'composerBorder')) add(region.top, transitionPaint.echoRule(transition.event, columns, t, transition.expressive, transition.look));
        if (transition.expressive) for (const region of regions('input')) add(region.top, transitionPaint.echoInput(transition.event, columns, t, transition.look));
      } else if (transition.kind === 'morph') {
        const prompt = regions('prompt')[0] ?? regions('input')[0];
        if (!prompt) continue;
        const plain = stripAnsi(rows[prompt.top] ?? '');
        for (const change of transition.changes) {
          if (change.change === 'disappeared' || !change.text) continue;
          // The final geometry, located by the module's own text; a module the width rules removed is simply skipped.
          const start = plain.indexOf(change.text);
          if (start < 0) continue;
          const column = displayWidth(plain.slice(0, start));
          add(prompt.top, transitionPaint.morph(column, column + displayWidth(change.text), t, transition.expressive, change.change, transition.look));
        }
      }
    }
    // Transition light passes over the rule but not over a Keep Awake accessory: its text stays semantically stable.
    for (const region of regions('separator', 'composerBorder')) {
      const accessory = this.edgeAccessory(region.kind as 'separator' | 'composerBorder', plan, now);
      const span = accessory && edgeAccessoryColumns(columns, accessory.width);
      const cells = span && paints.get(region.top);
      if (cells) for (let column = span.start - 1; column <= span.end; column += 1) cells.delete(column);
    }
    if (paints.size) for (const [row, cells] of paints) rows[row] = overlayRow(rows[row] ?? '', cells, columns);
    // A clock only while a transition is live (~30 fps for their short lifetime); none otherwise.
    const busy = this.transitions.busy;
    if (busy && !this.transitionClock) this.transitionClock = presentationClock.subscribe(() => { if (!this.stopped) this.paintPresentation(Date.now()); }, 33, 16);
    else if (!busy && this.transitionClock) { this.transitionClock(); this.transitionClock = undefined; }
  }

  private decorativeMotionAllowed(): boolean {
    return !isReducedMotion() && !this.promptConfiguration.presentation.reducedMotion && !this.promptConfiguration.presentation.effectsOff;
  }

  private cancelPresentation(): void {
    this.startupSkyClock?.(); this.startupSkyClock = undefined; this.startupSkyInterval = 0;
    this.stopStartupEnding();
    this.transitions.cancel();
    this.transitionClock?.(); this.transitionClock = undefined;
    this.effects.cancel();
    this.endSweep();
    if (this.escapeFlushTimer) { clearTimeout(this.escapeFlushTimer); this.escapeFlushTimer = undefined; }
    this.stopIdleFrames();
    this.idle = undefined;
    this.screensaverAnimation?.(); this.screensaverAnimation = undefined;
    this.awakeTimer?.(); this.awakeTimer = undefined;
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
      if (region.kind === 'queue' && this.running && this.timelineVisible()) {
        const content = this.queueBlockRows(frame.columns ?? 80, region.height);
        for (let index = 0; index < region.height; index++) rows[region.top + index] = content?.[index] ?? '';
      }
      if (region.kind === 'activity' && this.running) {
        const content = this.activityRows(plan, frame.columns ?? 80);
        for (let index = 0; index < region.height; index++) rows[region.top + index] = content[index] ?? '';
      }
      // Live composer divider lines move with Chroma only when Divider lines follow Chroma.
      // The composed edge (rule + any Keep Awake accessory) is repainted, never a bare rule over it.
      if ((region.kind === 'separator' || region.kind === 'composerBorder') && dividerAnimated(settings)) {
        rows[region.top] = this.composerEdgeRow(region.kind, plan, frame.columns ?? 80, now);
      }
      // The prompt row is re-rendered from the same semantic modules; only Chroma colors move (its divider fill too).
      if (region.kind === 'prompt' && region.height > 0 && (this.promptChromaAnimated() || dividerAnimated(settings)) && this.decorativeMotionAllowed()) {
        rows[region.top] = this.currentPromptLine(frame.columns ?? 80, now);
      }
    }
    paintRailComposition(rows, plan, this.preparedRail(frame.columns ?? 80), this.promptContext(), frame.columns ?? 80, this.promptConfiguration, now);
    this.applySweep(rows, plan, frame.columns ?? 80);
    const active = this.effects.active;
    const region = active && effectRegion(plan, active.placement);
    if (active && !region) this.effects.cancel();
    const columns = frame.columns ?? 80;
    this.paintTransitions(rows, plan, columns, now);
    let endingHidesCaret = false;
    if (this.startupEnding) {
      const ending = this.startupEnding;
      if (ending.columns !== columns || ending.rows !== this.dimensions().rows) this.stopStartupEnding();
      else {
        const painted = paintStartupEnding(rows, plan, columns, now, ending, this.endingSky, this.welcomeFrameRows);
        rows.splice(0, rows.length, ...painted.rows);
        endingHidesCaret = !painted.caretVisible;
        if (painted.done) this.stopStartupEnding();
      }
    }
    // Cursor effects: an overlay on the input rows only, never over panels, passthrough or idle visuals.
    const input = plan.regions.find(item => item.kind === 'input');
    // The agent composer's caret gets the same caret effects, bounded to its own row.
    const agentRow = this.presentationFrame?.agentCaretRow;
    const caretShown = !endingHidesCaret && frame.cursorVisible !== false && (agentRow !== undefined || (Boolean(input) && !plan.panelActive));
    const bounds = agentRow !== undefined ? {top: agentRow, bottom: agentRow, columns}
      : {top: Math.max(0, (input?.top ?? 0) - 1), bottom: (input?.top ?? 0) + (input?.height ?? 1) - 1, columns};
    const cursor = this.cursorPresenter.apply(rows, caretShown ? {row: frame.cursorRow - 1, column: frame.cursorColumn - 1} : undefined,
      bounds, this.caretCause,
      !this.passthrough && !this.externalPassthrough && this.decorativeMotionAllowed() && colorLevel() !== 'none', now, this.cursorBackend());
    const painted = cursor.rows;
    try {
      this.renderer.render(this.composeWorkspaceFrame({...frame, ...(cursor.hideCaret || endingHidesCaret ? {cursorVisible: false} : {}), rows: active && region
        ? applyEffect(painted, active, region, columns, now, getCurrentGlyphMode() === 'safe', colorLevel()) : painted}, plan));
    } catch (error) { this.onTerminate(); throw error; }
  }

  /**
   * Workspace regions are composed last, beside (docked) or over (a focused drawer) the finished center rows, so every
   * effect, transition and cursor decision above stays in center coordinates. The Status Strip row keeps the full
   * width. While a region has the keyboard, the composer's caret is not shown.
   */
  private composeWorkspaceFrame(frame: TerminalFrame, plan: ScreenPlan): TerminalFrame {
    if (!this.workspace.open) return frame;
    const terminal = this.terminalDimensions();
    const owner = this.workspaceOwner();
    const columns = this.workspace.plan(terminal.columns, this.workspaceSuppressed(), owner);
    if (columns.sidebar.mode === 'hidden' && columns.panel.mode === 'hidden') return frame;
    const status = plan.regions.find(region => region.kind === 'status' && region.height > 0);
    const spanned = frame.rows.length - (status ? 1 : 0);
    const safe = getCurrentGlyphMode() === 'safe';
    const style = {safe, color: colorLevel() !== 'none', now: Date.now()};
    const glyph = safe ? '|' : '│';
    const rows = composeWorkspaceRows({rows: frame.rows, plan: columns,
      sidebar: this.workspace.sidebarRows(columns, spanned, owner, style), panel: this.workspace.panelRows(columns, spanned, owner, style),
      ...(status ? {fullWidth: new Map([[status.top, this.statusStripRow(terminal.columns)]])} : {}),
      divider: style.color ? `${SUBTLE}${glyph}${RESET}` : glyph});
    const regionOwns = owner === 'LEFT_SIDEBAR' || owner === 'RIGHT_PANEL';
    return {...frame, rows, columns: terminal.columns, cursorColumn: frame.cursorColumn + columns.center.x, ...(regionOwns ? {cursorVisible: false} : {})};
  }

  /**
   * Pointer events before anything else sees them: the column plan decides the region. A click on the sidebar or panel
   * focuses it (the same action as /sidebar focus or /panel focus); a click in the center while a region has the
   * keyboard returns it to the composer. Center events continue with center-relative columns, so every existing hit
   * test keeps working unchanged. Returns undefined when the event was the workspace's.
   */
  private routeWorkspacePointer(key: Key): Key | undefined {
    const x = 'x' in key ? key.x : undefined;
    const y = 'y' in key ? key.y : undefined;
    if (x === undefined || !this.workspace.open) return key;
    const owner = this.workspaceOwner();
    const plan = this.workspace.plan(this.terminalDimensions().columns, this.workspaceSuppressed(), owner);
    if (plan.center.x === 0 && plan.sidebar.mode === 'hidden' && plan.panel.mode === 'hidden') return key;
    const status = this.presentationFrame?.plan.regions.find(region => region.kind === 'status' && region.height > 0);
    const center = {...key, x: Math.max(1, x - plan.center.x)} as Key;
    if (status && y !== undefined && screenRowFromTerminal(y) === status.top) return center;
    const hit = columnAt(plan, x - 1);
    const regionOwns = owner === 'LEFT_SIDEBAR' || owner === 'RIGHT_PANEL';
    if (hit === 'center') {
      if (key.kind === 'mouseClick' && regionOwns) void this.applyWorkspaceEffect(this.workspace.perform('focus.return', plan.columns));
      return center;
    }
    // A protected owner (a panel, a program, the agent view) keeps the keyboard; a click beside it does nothing.
    if (key.kind === 'mouseClick' && (owner === 'COMPOSER' || regionOwns)) {
      if (hit === 'sidebar' && owner !== 'LEFT_SIDEBAR') void this.applyWorkspaceEffect(this.workspace.perform('sidebar.focus', plan.columns));
      if (hit === 'panel' && owner !== 'RIGHT_PANEL') void this.applyWorkspaceEffect(this.workspace.perform('panel.focus', plan.columns));
    }
    return undefined;
  }

  /** Workspace keys after every panel and owner that comes first (they are protected anyway): true when consumed. */
  private handleWorkspaceKey(key: Key): boolean {
    // Experimental regions Off: keymap.json bindings stay as written but take no key; the key does what it always did.
    if (!this.workspace.open && (!this.workspace.available || !this.workspace.bindings.some(binding => binding.context === 'composerEmpty'))) return false;
    const owner = this.workspaceOwner();
    const {columns, rows} = this.terminalDimensions();
    const effect = this.workspace.handleKey(key, {owner, columns, viewRows: Math.max(1, rows - 4),
      composerIdle: owner === 'COMPOSER' && this.composerIdle() && !this.composerHistory.active});
    if (!effect) return false;
    void this.applyWorkspaceEffect(effect);
    return true;
  }

  private async applyWorkspaceEffect(effect: WorkspaceEffect, command = '/sidebar'): Promise<void> {
    if (effect.kind === 'none') return;
    if (effect.kind === 'disabled') { this.output.addFrontendInteraction(command, WORKSPACE_DISABLED_MESSAGE, INFO); this.render(); return; }
    if (effect.kind === 'refresh') { this.render(); await this.refreshWorkspaceSources(); return; }
    if (effect.kind === 'intent') await this.performWorkspaceIntent(effect.intent);
    this.render();
  }

  private workspaceRefreshGeneration = 0;

  /**
   * One explicit listing per open or focus: tmux (only the server NMSh runs inside, through the trusted tmux
   * executable) and this repository's worktrees. Nothing polls; a newer refresh wins.
   */
  /** `/keys`: every workspace binding in effect, problems in keymap.json, and keys this host may take first. */
  private showWorkspaceKeys(command: string, reload: boolean): void {
    if (reload) this.workspace.loadKeymap();
    const profile = keymapHostProfile(process.env);
    const notes = [...new Set(this.workspace.bindings.flatMap(binding => hostNotes(binding.key, profile)))];
    const lines = [...(reload ? ['keymap.json read again.'] : []),
      ...(this.workspace.available ? [] : ['The workspace sidebar and detail panel are experimental and Off (Settings → Layout): the bindings below take no key until they are turned on.']),
      'Completed output: /copy or /cp selects output (new configurations); /actions or /action selects for Actions.',
      'Output selection: Up older, Down newer, Enter copies or opens Actions, Esc returns. In Actions, Esc returns to the selected output.',
      'Shift+Tab focuses transcript blocks; Enter opens Actions on a focused command. /copy ui opens multi-selection.',
      ...describeKeymap(this.workspace.bindings),
      ...(this.workspace.problems.length ? ['Problems in keymap.json', ...this.workspace.problems.map(problem => `  ${problem.severity}${problem.entry === undefined ? '' : ` (entry ${problem.entry + 1})`}: ${problem.message}`)] : []),
      ...(notes.length ? ['Host notes', ...notes.map(note => `  ${note}`)] : [])];
    this.output.addFrontendInteraction(command, lines.join('\n'), this.workspace.problems.some(problem => problem.severity === 'error') ? ERROR : INFO);
  }

  /** Background tasks need an owner that offers them: this build in-process, or a session service from this release. */
  private backgroundAvailable(): boolean {
    return this.session.features.has('background-tasks') && typeof this.session.task === 'function';
  }

  /** The task bar and a waiting suggestion, above the composer; nothing while a program owns the screen. */
  private backgroundRows(columns: number): string[] {
    if (this.passthrough || this.externalPassthrough) return [];
    const now = Date.now();
    this.scheduleBarChange(now);
    return this.background.rows(columns, {now, color: colorLevel() !== 'none', safe: getCurrentGlyphMode() === 'safe'})
      .map(row => truncateAnsi(row, columns));
  }

  /** A finished task leaves the bar on its own after a moment: redraw then (one timer, for the soonest). */
  private barChangeTimer?: {at: number; timer: NodeJS.Timeout};
  private scheduleBarChange(now: number): void {
    const at = this.background.nextBarChange(now);
    if (at === undefined || this.barChangeTimer?.at === at) return;
    if (this.barChangeTimer) clearTimeout(this.barChangeTimer.timer);
    const timer = setTimeout(() => { this.barChangeTimer = undefined; if (!this.stopped) this.render(); }, Math.max(0, at - now) + 20);
    timer.unref?.();
    this.barChangeTimer = {at, timer};
  }

  /**
   * The task owner's list. The first list after this window attached is adopted silently (those tasks were announced
   * where they started); later, a new task and an ending one each get one NMSh line, never the task's output.
   */
  private onBackgroundTasks(records: readonly TaskRecord[]): void {
    const ended = this.background.onTasks(records);
    if (!this.backgroundSeen) this.backgroundSeen = new Set(records.map(record => record.id));
    else {
      for (const record of records) if (!this.backgroundSeen.has(record.id)) {
        this.backgroundSeen.add(record.id);
        this.output.addFrontendInteraction('/background', BackgroundHost.startLine(record), INFO);
      }
      const notify = this.background.preferences.notify;
      for (const record of ended) if (notify === 'always' || (notify === 'failure' && record.state === 'failed')) {
        this.output.addFrontendInteraction('/background', BackgroundHost.endLine(record), record.state === 'failed' ? ERROR : INFO);
      }
    }
    if (!this.passthrough && !this.externalPassthrough) this.render();
  }

  /** Start a task through the session's owner: the exact text, in the shell's current directory, with its live PATH. */
  private startBackgroundTask(command: string, family?: string): void {
    this.session.task?.({op: 'start', command, cwd: this.canonicalShellCwd(), path: this.shellPath(), ...(family ? {family} : {})});
  }

  /** Up (from an idle composer, when the preference allows) or Shift+Up enters the task bar: after the agent shelf, before history. */
  private enterBackgroundBar(key: Key): boolean {
    const composer = {empty: !this.editor.text && !this.editor.hasPasteAtoms, browsingHistory: this.composerHistory.active, foregroundBusy: Boolean(this.running),
      otherOwner: this.workspaceOwner() !== 'COMPOSER' || !this.composerIdle()};
    if (!entersBar(key, composer, this.background.barTasks(Date.now()).length, this.background.preferences.upArrow)) return false;
    this.background.bar.focused = true;
    this.background.message = undefined;
    this.render();
    return true;
  }

  private handleBackgroundBarKey(key: Key): boolean {
    const action = this.background.bar.handleKey(key, this.background.barTasks(Date.now()), this.background.next);
    this.background.message = undefined;
    if (action.kind === 'leave') {
      this.render();
      if (action.forward) this.handleKey(action.forward);
      return true;
    }
    if (action.kind === 'view') { this.background.bar.focused = false; this.background.panel = {kind: 'view', taskId: action.taskId, view: new TaskOutputView()}; }
    else if (action.kind === 'stop') this.session.task?.({op: 'stop', id: action.taskId, level: action.level});
    else if (action.kind === 'remove') this.session.task?.({op: 'remove', id: action.taskId});
    else if (action.kind === 'toggle') this.background.setPreferences({...this.background.preferences, bar: this.background.bar.expanded ? 'expanded' : 'collapsed'});
    else if (action.kind === 'none' && action.message) this.background.message = action.message;
    this.render();
    return true;
  }

  private handleBackgroundPanelKey(key: Key): void {
    const panel = this.background.panel;
    if (!panel) return;
    const close = () => { this.background.panel = undefined; this.returnFromPanel(); };
    if (panel.kind === 'manager') {
      const outcome = panel.manager.handleKey(key, this.background.records, this.background.preferences, this.background.next);
      if (outcome.kind === 'close') close();
      else if (outcome.kind === 'view') this.background.panel = {kind: 'view', taskId: outcome.taskId, view: new TaskOutputView()};
      else if (outcome.kind === 'stop') this.session.task?.({op: 'stop', id: outcome.taskId, level: outcome.level});
      else if (outcome.kind === 'remove') this.session.task?.({op: 'remove', id: outcome.taskId});
      else if (outcome.kind === 'clear') this.clearFinishedBackgroundTasks();
      else if (outcome.kind === 'preferences') this.background.setPreferences(outcome.value);
      this.render();
      return;
    }
    const task = this.background.record(panel.taskId);
    const output = this.background.output(panel.taskId);
    const height = Math.max(1, this.dimensions().rows - 6);
    if (!task || key.kind === 'escape' || (key.kind === 'text' && key.value === 'q')) close();
    else if (key.kind === 'up' || key.kind === 'down') panel.view.scroll(key.kind === 'up' ? -1 : 1, output, height);
    else if (key.kind === 'pageUp' || key.kind === 'pageDown') panel.view.scroll((key.kind === 'pageUp' ? -1 : 1) * Math.max(1, height - 1), output, height);
    else if (key.kind === 'bufferEnd' || key.kind === 'latest') panel.view.end(output);
    else if (key.kind === 'text' && key.value === 'x') {
      const level = nextLevel(task);
      if (level) this.session.task?.({op: 'stop', id: task.id, level});
    }
    this.render();
  }

  /** b / Enter / a / n / Esc on a waiting suggestion. Enter runs the command here exactly as it would have run. */
  private handleBackgroundSuggestionKey(key: Key): boolean {
    const suggestion = this.background.suggestion;
    if (!suggestion) return false;
    const choice = suggestionKey(key);
    const {command, classification} = suggestion;
    this.background.suggestion = undefined;
    // Any other key: the draft comes back unchanged and the key acts on it as usual (nothing typed is lost).
    if (!choice) { this.editor.replaceText(command); return false; }
    const foreground = () => {
      // The submission was already recorded for recall when it was first submitted.
      if (this.sessionSubmissions.at(-1)?.text === command) this.sessionSubmissions.pop();
      this.editor.replaceText(command);
      void this.submit(false, true, false);
    };
    if (choice === 'edit') this.editor.replaceText(command);
    else if (choice === 'foreground') foreground();
    else if (choice === 'background') this.startBackgroundTask(command, classification.family);
    else {
      this.background.setPreferences(rememberFamily(this.background.preferences, classification.family, choice === 'always' ? 'always' : 'never'));
      if (choice === 'always') this.startBackgroundTask(command, classification.family); else foreground();
    }
    this.render();
    return true;
  }

  /** Remove every finished task whose processes are gone; say which were kept and why. */
  private clearFinishedBackgroundTasks(): void {
    const finished = this.background.records.filter(record => record.state !== 'running' && record.state !== 'stopping');
    const kept = finished.filter(record => removalBlocked(record));
    for (const record of finished) if (!removalBlocked(record)) this.session.task?.({op: 'remove', id: record.id});
    if (kept.length) this.output.addFrontendInteraction('/background clear', `Kept ${kept.map(record => record.id).join(', ')}: their processes still run (x kills them).`, INFO);
  }

  /** `/background` (`/bg`): the manager, one task's output, or an explicit request. */
  private runBackgroundCommand(command: string): void {
    const parsed = parseBackgroundCommand(command);
    const say = (text: string, tone = INFO) => this.output.addFrontendInteraction(command.trim(), text, tone);
    if (!parsed) return;
    if (!this.backgroundAvailable()) {
      say('Background tasks need a session service from this NMSh release. Restart the session service (or start a new session) to use them.', ERROR);
      return;
    }
    switch (parsed.kind) {
      case 'open': this.background.panel = {kind: 'manager', manager: new BackgroundManager()}; return;
      case 'view': {
        if (!this.background.record(parsed.taskId)) { say(`No background task ${parsed.taskId}.`, ERROR); return; }
        this.background.panel = {kind: 'view', taskId: parsed.taskId, view: new TaskOutputView()};
        return;
      }
      case 'run': {
        const run = explicitRun(command);
        if (!run.ok) { say(run.reason, ERROR); return; }
        if (this.startupPending) { say('The shell is still starting; run it once the prompt is ready.', ERROR); return; }
        this.startBackgroundTask(run.command, run.classification?.family);
        if (run.notes.length) say(run.notes.join('; '));
        return;
      }
      case 'stop': {
        const record = this.background.record(parsed.taskId);
        if (!record) { say(`No background task ${parsed.taskId}.`, ERROR); return; }
        // /background kill is the immediate explicit path; stop asks for the next level.
        const level = parsed.force ? 'kill' : nextLevel(record);
        if (!level) { say(`${parsed.taskId} was already killed; waiting for it to exit.`); return; }
        this.session.task?.({op: 'stop', id: parsed.taskId, level});
        return;
      }
      case 'remove': {
        const record = this.background.record(parsed.taskId);
        const blocked = record ? removalBlocked(record) : `no background task ${parsed.taskId}`;
        if (blocked) { say(`Not removed: ${blocked}.`, ERROR); return; }
        this.session.task?.({op: 'remove', id: parsed.taskId});
        return;
      }
      case 'clear': this.clearFinishedBackgroundTasks(); return;
      case 'suggestions':
        this.background.setPreferences({...this.background.preferences, suggestions: parsed.value});
        say(parsed.value === 'ask' ? 'NMSh will offer to run recognized long-running commands in the background.' : 'No background suggestions; Always rules still apply.');
        return;
      case 'forget':
        this.background.setPreferences(rememberFamily(this.background.preferences, parsed.family, undefined));
        say(`Forgot the decision for ${parsed.family.slice(0, 64)}.`);
        return;
      case 'invalid': say(parsed.reason, ERROR); return;
    }
  }

  private async refreshWorkspaceSources(): Promise<void> {
    const generation = ++this.workspaceRefreshGeneration;
    const cwd = this.canonicalShellCwd();
    const server = tmuxServer(process.env);
    const executable = server ? trustedTmux() : undefined;
    const runner = server && executable ? createTmuxRunner(executable, server) : undefined;
    const [listing, worktrees] = await Promise.all([
      runner ? listTmuxPanes(runner) : Promise.resolve(server ? {panes: [], observedAt: Date.now(), error: 'tmux was not found in a trusted location'} : undefined),
      (async () => {
        try { const git = createGitRunner(); return await discoverWorktrees(git, await repositoryIdentity(git, cwd)); } catch { return undefined; }
      })(),
    ]);
    if (generation !== this.workspaceRefreshGeneration || this.stopped) return;
    this.workspace.setSources({...(server ? {tmux: {server, ...(listing ? {listing} : {}), ...(runner ? {runner} : {})}} : {}), ...(worktrees ? {worktrees} : {}), cwd});
    this.render();
  }

  /**
   * What activating a sidebar item does, through the paths NMSh already uses: a directory is staged as `cd` in an empty
   * composer (never run, never typed over a draft), a manager opens as its own command does, tmux navigates by id.
   */
  private async performWorkspaceIntent(intent: ActivationIntent): Promise<void> {
    const toComposer = () => { this.workspace.state = {...this.workspace.state, owner: 'COMPOSER'}; };
    if (intent.kind === 'changeDirectory') {
      if (this.editor.text.trim() || this.running) { this.workspace.message = this.running ? 'A command is running; stage the cd when it has finished.' : 'Your draft is kept. Clear the composer, then open this again.'; return; }
      let command: string | undefined;
      try { command = directoryCommand(intent.path); } catch { this.workspace.message = 'That path cannot be typed safely as a cd command.'; return; }
      toComposer();
      this.applySuggestion({insertion: command});
      return;
    }
    if (intent.kind === 'openManager') {
      const slash = parseSlashCommand(intent.command);
      if (!slash) return;
      toComposer();
      await this.runSlash(intent.command, slash);
      return;
    }
    if (intent.kind === 'tmux') {
      const args = this.workspace.tmuxArgs(intent);
      const runner = this.workspace.sources.tmux?.runner;
      if ('error' in args || !runner) { this.workspace.message = 'error' in args ? args.error : 'tmux is not available here'; return; }
      const result = await runner(args);
      this.workspace.message = result.code === 0 ? undefined : 'tmux could not switch there';
      if (result.code === 0) void this.refreshWorkspaceSources();
      return;
    }
    this.workspace.message = 'This item cannot be opened here.';
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
    this.syncAwake();
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

  /**
   * The live activity region (two rows, always reserved while a command runs). Ordinarily the working line and a
   * spacer; while the command waits for input, the attention line and the prompt it left open, so the question
   * stays in view however far the transcript scrolled or folded. Nothing extra is reserved and the PTY never resizes.
   */
  private activityRows(plan: ScreenPlan, columns: number): string[] {
    // With the list shown (the plan's queue region), its header takes the queue row and the list follows it.
    const region = regionOf(plan, 'queue');
    const chrome = this.summaryChrome();
    if (region && chrome && !this.inputState?.request) {
      const line = truncateAnsi(queueSummaryLine(chrome.summary, columns), columns);
      // A review says what its keys do; the plain view carries only the saved artifact's own facts.
      return [line, chrome.review ? truncateAnsi(`${SECONDARY}Enter saves this summary · Esc cancels${RESET}`, columns) : ''];
    }
    if (region && this.timelineVisible() && !this.inputState?.request) {
      const execution = this.queueState.timeline?.executions.find(entry => entry.status === 'running');
      const ownsRunning = Boolean(execution);
      const elapsed = execution?.runningMs === undefined ? undefined : execution.runningMs + Math.max(0, performance.now() - this.queueObservedMono);
      const pair = ownsRunning ? this.activityPair() : undefined;
      const factual = renderQueueActivitySummary(this.queueState, performance.now() - this.queueObservedMono, columns);
      const phrase = pair ? `${SECONDARY}${pair.active}…${RESET}` : '';
      const combined = phrase ? `${phrase} · ${factual}` : factual;
      const phraseFits = displayWidth(combined) <= columns;
      const summary = this.running && !ownsRunning ? this.currentActivity() : phraseFits ? combined : factual;
      const timing = elapsed === undefined ? '' : `${formatDuration(elapsed)} current command${waitedDetail(this.inputState, Date.now(), elapsed)}`;
      const expressive = phrase && !phraseFits ? `${phrase}${timing ? ` · ${SECONDARY}${timing}${RESET}` : ''}` : `${SECONDARY}${timing}${RESET}`;
      const hint = this.queueReview ? queueRow(this.queueState, columns, {review: this.queueReview.kind}) : this.queueAffordance() ? `${SUBTLE}${columns < 45 ? 'Enter reviews · /q' : 'Enter to review · Esc to review clear · /queue'}${RESET}` : expressive;
      const concise = displayWidth(hint ?? '') <= columns ? hint : phrase && elapsed !== undefined ? `${phrase} · ${SECONDARY}${formatDuration(elapsed)}${RESET}` : hint;
      return [truncateAnsi(summary, columns), concise ? truncateAnsi(concise, columns) : ''];
    }
    const listed = region ? this.queueBlockRows(columns, region.height + 1) : undefined;
    const queue = listed?.[0] ?? this.queueLine(columns);
    if (!this.running) return queue ? (listed ? ['', queue] : [queue, '']) : [];
    const request = this.inputState?.request;
    // A wait reads top to bottom (headline, then the question) wherever the composer is docked.
    if (request) {
      const rows = inputActivityRows({...this.inputState!, request}, this.running.command, this.running.startedAt, this.activityAnimationNow, columns);
      const count = this.queueAvailable() ? this.queueState.entries.length : 0;
      // The question keeps both rows; the queue is a count at the end of the headline, when it fits.
      const tail = count ? `${SUBTLE} · ${queueGlyph()} ${count} queued${RESET}` : '';
      if (tail && rows[0] !== undefined && displayWidth(stripAnsi(rows[0])) + displayWidth(stripAnsi(tail)) <= columns) rows[0] += tail;
      return rows.map(row => truncateAnsi(row, columns));
    }
    const activity = truncateAnsi(this.currentActivity(), columns);
    // The queue reads after what runs now, in the row the region already reserves.
    if (queue) return [activity, queue];
    return plan.composerPosition === 'top' ? ['', activity] : [activity, ''];
  }

  /** While a command runs, the empty composer says what Enter will do with what you type. */
  private composerHint(): {text: string; waiting: boolean} | undefined {
    if (!this.running || this.passthrough || this.queueEdit || this.justStopped()) return undefined;
    // The program's question keeps the activity rows, so the composer itself says how compose mode ends.
    if (this.queueCompose) return {text: 'Queue a command · Enter adds it · Esc returns to the program', waiting: false};
    const request = this.inputState?.request;
    const program = request ? inputProgram(request, this.running.command) : commandWords(this.running.command)[0] ?? 'the program';
    // A waiting program gets the one instruction, with or without a queue; a question NMSh has not yet probed reads
    // as a line.
    if (this.answersByDefault()) return {text: inputComposerHint(request ?? {since: 0, confidence: 'likely', mode: 'line'}, program, this.queueAvailable()), waiting: true};
    if (!this.queueAvailable()) return undefined;
    return {text: `Enter queues the next command · Ctrl+S sends to ${program}`, waiting: false};
  }

  /** Ctrl+C or Ctrl+Z was sent moments ago: typing is type-ahead for the prompt the stop brings back. */
  private justStopped(): boolean {
    const at = this.running?.stoppedAt;
    return at !== undefined && Date.now() - at < STOP_TYPE_AHEAD_MS;
  }

  /**
   * Enter goes to the running program: it is known to wait for input, or it left a question open on its line
   * ("Password: ", "Continue? [y/N] ") that no probe has looked at yet. A reply typed at a fresh prompt (a password
   * most of all) must never become a queued shell command, so the open question wins until it is answered.
   */
  private answersByDefault(): boolean {
    return Boolean(this.inputState?.request) || (this.commandLine.open && promptShaped(this.commandLine.line));
  }

  /** Queueing works when the setting is on and whatever owns the shell runs a queue (an older service does not). */
  /** The session's service understands per-entry conditions and approval (older ones would ignore them, so they are never offered). */
  private queueConditionsAvailable(): boolean {
    return this.queueAvailable() && this.session.features.has('queue-conditions');
  }

  private queueAvailable(): boolean {
    return this.promptConfiguration.commandQueue !== false && this.session.features.has('queue');
  }

  /** The queue's line: what is queued and what runs next, or why it waits; an edit in progress says how to finish. */
  private queueLine(columns: number): string | undefined {
    if (!this.queueAvailable()) return undefined;
    const chrome = this.summaryChrome();
    if (chrome) return queueSummaryLine(chrome.summary, columns);
    if (this.timelineVisible() && !this.queueState.entries.length) return renderQueueActivitySummary(this.queueState, performance.now() - this.queueObservedMono, columns);
    if (this.queueState.timeline && this.queueState.entries.length && !this.queueEdit && !this.queueReview) {
      const pause = this.queueState.paused;
      if (pause) {
        const cause = pause.reason === 'failed' ? `exit ${pause.exitCode} · ${pauseReason(pause)}` : pause.reason === 'user' ? 'Paused manually' : pauseReason(pause);
        return truncateAnsi(`${STOPPED}${cause}${RESET}${SUBTLE} · ${this.queueState.entries.length} waiting${RESET}`, columns);
      }
      const next = this.queueState.entries[0]!;
      const tail = ` · ${next.condition === 'approve' && !next.approved ? 'Approval' : 'Next'} · ${this.queueState.entries.length} pending`;
      return truncateAnsi(`${SECONDARY}${GLYPHS.selection} ${queuePreview(next.text, Math.max(1, columns - displayWidth(tail) - 2))}${SUBTLE}${tail}${RESET}`, columns);
    }
    if (this.queueEdit) return truncateAnsi(`${SECONDARY}${queueGlyph()} Editing a queued command${RESET}${SUBTLE} · Enter saves · Esc cancels${RESET}`, columns);
    const affordance = this.queueAffordance();
    return queueRow(this.queueState, columns, {...(this.queueReview ? {review: this.queueReview.kind} : {}), ...(affordance ? {affordance} : {})});
  }

  private onQueueState(state: QueueState, news: QueueNews): void {
    if (this.stopped) return;
    const previous = this.queueState;
    if (staleQueueSnapshot(previous, state)) return;
    this.queueState = state;
    const pause = this.pendingQueuePause;
    if (pause && (news.refused || pause.revision === undefined || (state.revision !== undefined && state.revision > pause.revision))) {
      this.pendingQueuePause = undefined;
      if (!news.refused && state.paused?.reason === 'user') {
        this.output.addFrontendInteraction(pause.command, pause.declined
          ? 'Not approved; the queue is paused, so your commands run directly. /queue to come back to it.'
          : `Queue paused${state.entries.length ? ` with ${state.entries.length} waiting` : ''}; /qr reviews before continuing.`, INFO);
      } else if (!news.refused) this.output.addFrontendInteraction(pause.command, 'The queue changed before the pause was acknowledged; review it again. Your draft was kept.', INFO);
    }
    this.queueObservedMono = performance.now();
    const chain = state.timeline;
    if (chain?.endedAt !== undefined && chain.status !== 'active' && (chain.id !== previous.timeline?.id || previous.timeline?.status === 'active')) {
      this.queueExpiry?.();
      // The completed view is presentation only: the transcript keeps every result either way.
      const linger = this.promptConfiguration.queue.transient ? this.promptConfiguration.queue.transientSeconds * 1000 : 0;
      this.queueTransientUntil = linger ? performance.now() + linger : 0;
      if (linger) this.queueExpiry = presentationClock.after(() => { this.queueExpiry = undefined; if (!this.stopped) this.render(); }, linger);
    } else if (chain?.status === 'active') { this.queueExpiry?.(); this.queueExpiry = undefined; }
    if (!this.replaying && getCurrentGlyphMode() !== 'safe' && colorLevel() !== 'ansi16') {
      for (const change of queuePresentationChanges(previous, state)) this.transitions.highlight(change.target, change.tone, Date.now(), change.phase);
    }
    if (news.refused) this.output.addFrontendInteraction('/queue', news.refused, INFO);
    if (news.dropped) this.output.addHistoryLine(`${INFO}${news.dropped} queued command${news.dropped === 1 ? '' : 's'} did not run: the shell ended.${RESET}`);
    const paused = state.paused;
    // A pause NMSh decided (not the person's own) is a safety event: say it where the failure is.
    // Said once, where it happened; the queue's own row carries what is waiting and what to do.
    if (paused && paused.reason !== 'user' && paused.at !== previous.paused?.at && state.entries.length) {
      this.output.addHistoryLine(`${STOPPED}${pausedGlyph()} Queue paused: ${pauseReason(paused)}.${RESET}`);
    }
    // A review is for what was shown: any change to what it would act on dismisses it, so nothing unseen runs.
    const review = this.queueReview;
    if (review && ((review.revision !== undefined && state.revision !== review.revision) || state.entries[0]?.id !== review.id || (review.kind === 'resume' && !state.paused)
      || (review.kind === 'approve' && (state.entries[0]?.approved || state.entries[0]?.condition !== 'approve' || state.entries[0]?.text !== previous.entries[0]?.text)))) {
      this.queueReview = undefined;
    }
    if (this.queueEdit && !state.entries.some(entry => entry.id === this.queueEdit!.id)) {
      this.queueEdit = undefined;
      this.output.addFrontendInteraction('/queue', 'That queued command already ran or was removed; your edit is still in the composer.', INFO);
    }
    // The owner is the authority for saved summaries: the presentation replaces its own list, never merges, so a
    // replayed or reattached state cannot duplicate one. An older service without the feature leaves the journaled
    // list exactly as the transcript carried it, and a restored archive keeps its own session's summaries.
    if (this.presentationOwned && this.session.features.has('queue-history')) {
      const previous = this.output.queueSummaries;
      this.output.setQueueSummaries(state.summaries ?? []);
      const updated = this.output.queueSummaries;
      const changed = previous.length !== updated.length || previous.some((summary, index) => summary.id !== updated[index]?.id);
      if (changed) void this.journal?.flush().catch(() => {});
    }
    // A requested save arms its review when the owner answers with the chain's own retained results.
    const pending = this.pendingSummarySave;
    if (pending !== undefined) {
      this.pendingSummarySave = undefined;
      const record = state.history?.find(item => item.id === pending);
      if (state.historyDetail?.id === pending && record) this.armSummarySave(state.historyDetail, record.resultsOmitted);
      else if (state.history !== undefined && !record) {
        this.output.addFrontendInteraction('/queue save-summary', 'That chain left history before its results could be reviewed; nothing was saved.', INFO);
      } else this.pendingSummarySave = pending;
    }
    // A save review is for the chain it showed: a changed queue, a save that already happened elsewhere, or a chain
    // that left history all dismiss it, so nothing unseen is stored.
    const save = this.summaryReview;
    if (save) {
      const saved = Boolean(state.summaries?.some(summary => summary.chainId === save.chainId));
      const stale = save.revision !== undefined && state.revision !== save.revision;
      const left = state.history !== undefined && !state.history.some(record => record.id === save.chainId);
      if (saved || stale || left) {
        this.summaryReview = undefined;
        this.output.addFrontendInteraction('/queue save-summary', saved
          ? 'That chain already has a saved summary; nothing is rewritten.'
          : stale ? 'The queue changed while the summary review was open; nothing was saved.'
            : 'That chain left history while the summary review was open; nothing was saved.', INFO);
      }
    }
    this.render();
  }

  /** Add the composer's text to the queue. */
  private enqueue(text: string): void {
    if (!this.queueAvailable()) {
      this.output.addFrontendInteraction('/queue', this.session.features.has('queue')
        ? 'Queueing is off (Settings → Sessions → Queue commands).' : 'This session\'s service is older and has no command queue; restart NMSh\'s session service to use it.', INFO);
      this.render();
      return;
    }
    this.syncQueuePolicy();
    this.session.queue({op: 'add', text});
    this.sessionSubmissions.push({text, slash: false});
    if (this.sessionSubmissions.length > SESSION_SUBMISSION_LIMIT) this.sessionSubmissions.shift();
    this.editor.clear();
    this.composerHistory.reset();
    this.runningDraft = undefined;
    this.queueCompose = false;
    this.render();
  }

  /**
   * Enter, Ctrl+Q (queue) and Ctrl+S (send to the running program). Input ownership comes first: a program that is
   * waiting for input (InputWatch's evidence) gets Enter, and only an explicit Ctrl+Q queues then. Otherwise, while
   * a command runs, Enter queues; at idle it queues behind pending entries so nothing jumps the order.
   */
  private routeComposer(intent: 'enter' | 'queue' | 'send'): void {
    // Composing a queue entry (Ctrl+Q during direct input): Enter adds it, and nothing typed here reaches the program.
    if (this.queueCompose) {
      if (intent === 'send') return;
      intent = 'queue';
    }
    const text = this.editor.text;
    if (this.queueEdit) {
      if (intent === 'send') return;
      const edit = this.queueEdit;
      if (!text.trim()) { this.output.addFrontendInteraction('/queue', 'A queued command cannot be empty; remove it in /queue instead.', INFO); this.render(); return; }
      this.queueEdit = undefined;
      this.session.queue({op: 'edit', id: edit.id, text});
      this.editor.replaceText(edit.draft);
      this.render();
      return;
    }
    const slash = isSlashInput(text) ? parseSlashCommand(text) : undefined;
    if (this.running) {
      if (intent !== 'send' && slash && slash.kind !== 'unknown') {
        const refused = ({zsh: 'Wait for the foreground command to finish or interrupt it, then run /zsh.', clear: 'Wait for the foreground command to finish before archiving this transcript.',
          resume: 'Wait for the foreground command to finish before switching transcripts.'} as Record<string, string>)[slash.kind === 'shell' && text.trim() === '/zsh' ? 'zsh' : slash.kind];
        if (refused) { this.editor.clear(); this.output.addFrontendInteraction(text.trim(), refused, INFO); this.render(); return; }
        void this.submit();
        return;
      }
      // A rapid second Enter after confirming a queue review is not an answer for the command it just started.
      if (intent === 'enter' && !text.trim() && Date.now() - this.queueConfirmedAt < QUEUE_CONFIRM_SETTLE_MS) return;
      const toProgram = intent === 'send' || (intent === 'enter' && (!this.queueAvailable() || !text.trim() || this.answersByDefault() || this.passthrough || this.justStopped()));
      if (toProgram) {
        this.editor.clear();
        this.runningDraft = undefined;
        this.session.write(`${text}\r`);
        this.answerSent();
        return;
      }
      if (!text.trim()) return;
      this.enqueue(text);
      return;
    }
    if (intent === 'send') return;
    if (this.pendingQueuePause) { this.render(); return; }
    // An empty Enter where the queue offers something arms its review; nothing runs yet.
    const affordance = intent === 'enter' && !text.trim() ? this.queueAffordance() : undefined;
    if (affordance && Date.now() - this.queueConfirmedAt >= QUEUE_CONFIRM_SETTLE_MS) {
      this.openQueueReview(affordance);
      this.render();
      return;
    }
    if (text.trim() && !slash && this.queueAvailable() && (intent === 'queue' || (this.queueState.entries.length > 0 && !this.queueState.paused))) {
      this.enqueue(text);
      return;
    }
    if (this.preparingCommand) return;
    // The one direct composer submission: the only path that may offer or start a background task.
    void this.submit(false, false, true);
  }

  /** `/queue` opens the manager; `/queue pause|resume|clear` act at once; history and save-summary review. */
  private handleQueueCommand(command: string, op: 'open' | 'pause' | 'resume' | 'clear' | 'history' | 'save-summary'): void {
    if (!this.queueAvailable()) {
      this.output.addFrontendInteraction(command, this.session.features.has('queue')
        ? 'Queueing is off (Settings → Sessions → Queue commands).' : 'This session\'s service is older and has no command queue; restart NMSh\'s session service to use it.', INFO);
      return;
    }
    if (op === 'open') { this.panelOrigin = undefined; this.queuePanel = {selected: 0}; return; }
    if (op === 'history') { this.openQueueHistory(command); return; }
    if (op === 'save-summary') { this.beginSummarySave(); return; }
    const count = this.queueState.entries.length;
    if (op === 'pause') {
      this.requestQueuePause(command);
      return;
    }
    if (!count) { this.output.addFrontendInteraction(command, 'The queue is empty.', INFO); return; }
    if (this.running || this.passthrough || this.startupPending) {
      this.output.addFrontendInteraction(command, 'Wait for the foreground program to finish before reviewing queued commands.', INFO); return;
    }
    if (!this.session.features.has('queue-timeline')) {
      this.panelOrigin = undefined; this.queuePanel = {selected: 0, ...(op === 'clear' ? {confirmClear: true} : {})}; return;
    }
    this.openQueueReview(op === 'clear' ? 'clear' : this.queueState.paused ? 'resume' : 'approve');
  }

  private requestQueuePause(command: string, declined = false, revision = this.queueState.revision): void {
    if (this.pendingQueuePause) return;
    const expectedRevision = this.session.features.has('queue-timeline') ? revision : undefined;
    this.pendingQueuePause = {command, declined, revision: expectedRevision};
    this.session.queue({op: 'pause', ...(expectedRevision === undefined ? {} : {expectedRevision})});
  }

  private openQueueReview(kind: QueueAffordance): void {
    const next = this.queueState.entries[0];
    if (!next) return;
    this.queueReview = {kind, id: next.id, ...(this.session.features.has('queue-timeline') ? {revision: this.queueState.revision} : {})};
  }

  /** `/queue history`: the recent settled chains; the owner keeps them, this only reviews what it observed. */
  private openQueueHistory(command: string): void {
    if (this.running || this.passthrough || this.startupPending) {
      this.output.addFrontendInteraction(command, 'Wait for the foreground program to finish before reviewing finished chains.', INFO); return;
    }
    if (!this.session.features.has('queue-history')) {
      this.output.addFrontendInteraction(command, 'This session\'s service keeps no finished-chain history; restart NMSh\'s session service to review it.', INFO); return;
    }
    if (!(this.queueState.history?.length)) {
      this.output.addFrontendInteraction(command, 'No finished chains yet; settled chains stay reviewable in history, newest first.', INFO); return;
    }
    this.summaryReview = undefined;
    this.panelOrigin = undefined;
    this.queueHistoryPanel = {selected: 0};
  }

  /**
   * Save one chain's summary: ask the owner for exactly what it observed, show the typed artifact the save would
   * store (command text only in its redacted review form, and only through this review), then wait for Enter.
   * Nothing is stored before that confirmation, and the owner re-validates everything it receives.
   */
  private beginSummarySave(chainId?: number): void {
    const command = '/queue save-summary';
    if (!this.session.features.has('queue-history')) {
      this.output.addFrontendInteraction(command, 'This session\'s service keeps no chain history to summarize; restart NMSh\'s session service to save one.', INFO); return;
    }
    if (this.running || this.passthrough || this.startupPending) {
      this.output.addFrontendInteraction(command, 'Wait for the foreground program to finish before saving a summary.', INFO); return;
    }
    const history = this.queueState.history ?? [];
    const record = chainId === undefined ? history.at(-1) : history.find(item => item.id === chainId);
    if (!record) {
      this.output.addFrontendInteraction(chainId === undefined ? command : '/queue history',
        chainId === undefined ? 'Nothing has finished to summarize yet.' : 'That chain is no longer in history; nothing was saved.', INFO);
      return;
    }
    if (this.queueState.summaries?.some(summary => summary.chainId === record.id)) {
      this.output.addFrontendInteraction(command, 'That chain already has a saved summary; nothing is rewritten.', INFO); return;
    }
    const detail = this.queueState.historyDetail?.id === record.id ? this.queueState.historyDetail : undefined;
    if (detail) { this.armSummarySave(detail, record.resultsOmitted); this.render(); return; }
    this.pendingSummarySave = record.id;
    this.session.queue({op: 'history-detail', chainId: record.id});
    this.render();
  }

  /** Arm the reviewed save: the container shows exactly the artifact the owner will store once Enter confirms it. */
  private armSummarySave(detail: QueueTimeline, omitted: number): void {
    const texts = detail.executions.map(execution => {
      if (execution.status === 'running') return null;
      const redacted = redactText(execution.text, homedir()).text;
      return reviewedTextSafe(redacted) ? redacted : null;
    });
    const summary = buildQueueSummary(detail, {savedAt: Date.now(), origin: 'reviewed', names: recognizedExecutables(this.shellId),
      ...(omitted ? {entriesOmitted: omitted} : {}), reviewed: texts});
    // One review owns the keys: arming this one gives up any entry review that was open.
    this.queueReview = undefined;
    const facts = queueSummaryLines(summary, 80, {detail: 'compact', placement: 'left'}).slice(1, -1).join('\n');
    const exactText = facts + '\n\n' + summary.entries.map((entry, index) =>
      `${index + 1}. ${entry.text ?? entry.label}\n   ${entry.outcome}${entry.exitCode === undefined ? '' : ` · exit ${entry.exitCode}`}`).join('\n\n');
    const document = createTextReview('Save this Queue Summary?', () => ({text: exactText, findings: []}), [],
      {...DEFAULT_REPORT_OPTIONS, home: homedir()}, false);
    document.fixed = true;
    document.confirmLabel = 'save';
    this.summaryReview = {chainId: detail.id, texts, summary, document, ...(this.session.features.has('queue-timeline') ? {revision: this.queueState.revision} : {})};
  }

  /** The save review's keys: Enter or y stores exactly what the container showed; Esc, n or Ctrl+C stores nothing. */
  private summaryReviewKey(key: Key): void {
    const review = this.summaryReview;
    if (!review) return;
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    if (key.kind === 'escape' || key.kind === 'interrupt' || value === 'n') {
      this.summaryReview = undefined;
      this.render();
      return;
    }
    const action = reportReviewKey(review.document, key.kind === 'text' && value === 'y' ? {kind: 'enter'} : key, this.dimensions().rows - 4, this.dimensions().columns);
    if (action?.kind === 'close') this.summaryReview = undefined;
    if (action?.kind === 'copy') {
      this.summaryReview = undefined;
      this.queueConfirmedAt = Date.now();
      this.session.queue({op: 'save-summary', chainId: review.chainId, reviewed: {text: review.texts},
        ...(review.revision === undefined ? {} : {expectedRevision: review.revision})});
    }
    this.render();
  }

  private queuePolicyNote(): string {
    const policy = this.queueState.timeline?.status === 'active' ? this.queueState.timeline.failurePolicy : this.promptConfiguration.queueFailurePolicy;
    return failurePolicyNote(policy);
  }

  private syncQueuePolicy(): void {
    if (this.session.features.has('queue-timeline')) this.session.queue({op: 'failure-policy', policy: this.promptConfiguration.queueFailurePolicy});
  }

  private timelineVisible(): boolean {
    if (!this.promptConfiguration.queue.liveTimeline) return false;
    const timeline = this.queueState.timeline;
    // A focused review pauses the completed view's dismissal: what it reviewed stays on screen until it is answered.
    const held = this.queueTransientUntil > 0 && Boolean(this.queueReview || this.summaryReview);
    return this.queueAvailable() && Boolean(timeline && (timeline.status === 'active'
      || (this.promptConfiguration.queue.transient && (held || performance.now() < this.queueTransientUntil))));
  }

  /** Load a queued entry into the composer to edit it in place; the queue holds at that entry until it is saved. */
  private beginQueueEdit(id: number): void {
    const entry = this.queueState.entries.find(item => item.id === id);
    if (!entry) return;
    this.queueEdit = {id, draft: this.editor.text};
    this.session.queue({op: 'edit-begin', id});
    this.editor.replaceText(entry.text);
  }

  private cancelQueueEdit(): void {
    const edit = this.queueEdit;
    if (!edit) return;
    this.queueEdit = undefined;
    this.session.queue({op: 'edit-cancel', id: edit.id});
    this.editor.replaceText(edit.draft);
  }

  /** Keys go straight to the program (a hidden line or single keys) rather than through the composer. */
  private directInputRequest() {
    const request = this.inputState?.request;
    return this.running && !this.passthrough && !this.startupPending && !this.queueCompose && directInput(request) ? request : undefined;
  }

  private onInputState(state: InputState): void {
    // A state for a finished run (a late message) never resurrects it.
    if (!this.running) return;
    this.inputState = state;
    const draft = this.runningDraft;
    if (state.terminalOwner) {
      // A native reader took the terminal: what was typed for this command after it started is its input, as a
      // terminal would have delivered it.
      const typed = draft && draft.startId === this.running.startId && !this.queueCompose && !this.queueEdit ? this.editor.text : '';
      this.onActiveModeChange('PASSTHROUGH');
      if (typed && this.passthrough) { this.editor.clear(); this.runningDraft = undefined; this.session.write(typed); }
      this.ownershipLook?.release();
      return;
    }
    const request = state.request;
    // Keys typed after the program wrote its question, in the moment before NMSh could tell how it reads, were
    // meant for it: a terminal would already have delivered them. Hand them over now instead of hiding them.
    if (request && directInput(request) && draft && draft.startId === this.running.startId && draft.at >= request.since && this.editor.text) {
      const typed = this.editor.text;
      this.editor.clear();
      this.runningDraft = undefined;
      this.session.write(typed);
    } else if (request && draft && draft.at >= request.since && this.editor.text) draft.answering = true;
    // The evidence a held key waited for has arrived.
    if (request) this.ownershipLook?.release();
    this.render();
  }

  /**
   * Whether this key decides where typing goes while a command runs and NMSh has no evidence yet that the command
   * waits for input: the first key of a draft, or an Enter that would otherwise queue.
   */
  private needsOwnershipLook(key: Key): boolean {
    // Right after Ctrl+C or Ctrl+Z, typing is type-ahead for the prompt the stop brings back.
    if (this.replayingHeld || !this.running || this.passthrough || this.startupPending || this.queueCompose || this.queueEdit || this.justStopped()) return false;
    if (this.inputState?.request || this.inputState?.terminalOwner || !this.session.lookInput || !this.session.features.has('input-look')) return false;
    if ((key.kind === 'text' || key.kind === 'paste') && !this.editor.text) return true;
    const text = this.editor.text;
    return key.kind === 'enter' && Boolean(text.trim()) && !isSlashInput(text) && this.queueAvailable() && !this.answersByDefault();
  }

  /** Hold the key (and any typed after it) until the session has looked, then route them on that evidence. */
  private holdForOwnershipLook(key: Key): void {
    const running = this.running!;
    const keys = [key];
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      if (this.ownershipLook?.keys === keys) this.ownershipLook = undefined;
      // The command ended while NMSh looked. A reply to its open question is discarded, never run; anything else
      // is what it would have been without the look: typing for the next command, Enter running it after.
      const ended = this.running?.startId !== running.startId;
      const typing = (item: Key) => item.kind === 'text' || item.kind === 'paste' || item.kind === 'enter';
      if (ended && hold.answering && keys.some(typing)) {
        this.output.addFrontendInteraction(commandWords(running.command)[0] ?? 'command', 'The command finished before your reply was sent; the reply was discarded, not run.', INFO);
      }
      // The program took the terminal meanwhile (a native reader, a full-screen program): the keys are its own, in order.
      if (!ended && this.passthrough) {
        for (const item of keys) { const bytes = directKeyBytes(item); if (bytes) this.session.write(bytes); }
        return;
      }
      const replay = ended && hold.answering ? keys.filter(item => !typing(item)) : keys;
      this.replayingHeld = true;
      try { for (const item of replay) this.handleKey(item); } finally { this.replayingHeld = false; }
      this.render();
    };
    const timer = setTimeout(release, OWNERSHIP_LOOK_MS);
    timer.unref?.();
    const hold = {keys, startId: running.startId, answering: this.answersByDefault(), release};
    this.ownershipLook = hold;
    void this.lookWhenStarted(running.startId, Date.now() + OWNERSHIP_LOOK_MS).then(release, release);
  }

  /** Look once the shell has started the command (keys typed right after Enter arrive before its exec). */
  private async lookWhenStarted(startId: number, deadline: number): Promise<void> {
    while (this.running?.startId === startId && this.running.awaitingExec && Date.now() < deadline) await new Promise(done => setTimeout(done, 15));
    if (this.running?.startId === startId && !this.running.awaitingExec) await this.session.lookInput?.();
  }

  /** Forward one key to the waiting program as the bytes a terminal sends; nothing is kept, shown or logged. */
  private sendDirectKey(key: Key): void {
    if (key.kind === 'interrupt') {
      if (this.running) { this.running.interrupted = true; this.running.stoppedAt = Date.now(); }
      this.session.interrupt();
      this.answerSent();
      return;
    }
    if (key.kind === 'eof') { this.session.endInput(); return; }
    const bytes = directKeyBytes(key);
    if (!bytes) return;
    const mode = this.inputState?.request?.mode;
    this.session.write(bytes);
    // One key answers a key read; Enter ends a hidden line (as the session's watch also decides).
    if (mode === 'key' || /[\r\n]/u.test(bytes)) this.answerSent();
  }

  /**
   * An answer just went to the waiting program. Until the session reports again, the question counts as answered:
   * keys typed next (the next command, at typing speed) are routed on fresh evidence, never on the question that was
   * just answered, so they never reach a program that stopped reading or a shell prompt NMSh does not draw.
   */
  private answerSent(): void {
    if (this.inputState?.request) this.inputState = {timing: this.inputState.timing};
    this.commandLine.reset();
  }

  /** This command's phrase pair under Expressive wording: chosen once from the command and its start, so it never changes while it runs. */
  private activityPair(): ActivityVerbPair | undefined {
    if (!this.running || this.promptConfiguration.liveActivity.style !== 'expressive') return undefined;
    return this.chooseActivityPair(this.running);
  }

  private chooseActivityPair(command: {command: string; startedAt: number; activity?: ActivityVerbPair}): ActivityVerbPair {
    if (!command.activity) command.activity = selectActivityVerb(command.command, command.startedAt, this.lastActivityPair);
    this.lastActivityPair = command.activity;
    return command.activity;
  }

  /** The pair for a command that just finished: the one it showed while running, or the same deterministic choice if it never drew. */
  private activityPairFor(command: {command: string; startedAt: number; activity?: ActivityVerbPair}): ActivityVerbPair | undefined {
    if (this.promptConfiguration.liveActivity.style !== 'expressive') return undefined;
    return this.chooseActivityPair(command);
  }

  private currentActivity(): string {
    if (!this.running) return '';
    const elapsed = this.activityAnimationNow - this.running.startedAt;
    const isActive = (Date.now() - this.lastOutputTime) < 750;
    const animationElapsed = this.decorativeMotionAllowed() ? presentationAnimationElapsed(elapsed) : 0;
    const parts = liveActivityParts(this.running.command, elapsed, animationElapsed, this.activityPair());
    // A soft light sweep over the working phrase: its own colors lifted in place, never moved; faster while output arrives.
    // Colors come from Live activity colors; the sweep is the same light sweep everywhere.
    const still = !this.decorativeMotionAllowed() || sweepStill(this.promptConfiguration);
    const {cells, style} = liveActivityPaint(parts.phrase, this.promptConfiguration, this.activityAnimationNow, still);
    const phrase = sweepCells(cells, animationElapsed * (isActive ? 1.4 : 1), style, colorLevel(), !this.decorativeMotionAllowed());
    return `${phrase}${SECONDARY}${parts.duration}${waitedDetail(this.inputState, this.activityAnimationNow, elapsed)}${RESET}`;
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
    // Prompt None: no context at all; the input marker (the configured prompt symbol) stays.
    if (this.effectivePromptProvider === 'none') return undefined;
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
    const rail = this.preparedRail(columns).presentation;
    if (rail.rows && rail.relation === 'right') return '';
    const used = displayWidth(line);
    // Two cells of breathing room after the text, plus the caret cell.
    const right = buildRightContext(this.promptContext(), columns - used - 2, this.promptConfiguration);
    if (!right) return '';
    return `${RESET}${' '.repeat(columns - used - displayWidth(right))}${right}${RESET}`;
  }

  private layoutEditorInput(columns: number, maxVisibleRows = Number.POSITIVE_INFINITY) {
    // Direct input: the composer shows where typing goes, never a draft, so the caret sits at the start.
    const direct = Boolean(this.directInputRequest());
    return layoutInput(
      direct ? '' : this.editor.displayText,
      direct ? 0 : this.editor.displayCursorIndex,
      this.inputColumns(columns),
      maxVisibleRows,
      this.railInputPrefix(columns),
    );
  }

  private railInputPrefix(columns: number): string | undefined {
    return this.inputFirstLinePrefix(this.inputColumns(columns));
  }

  /** The terminal's real size. Everything NMSh draws in the middle uses dimensions() instead (the workspace center). */
  private terminalDimensions(): {columns: number; rows: number} {
    return {
      columns: Math.max(1, process.stdout.columns || 80),
      rows: Math.max(1, process.stdout.rows || 24),
    };
  }

  /**
   * The size of the center: the whole terminal unless a workspace region is docked beside it. Transcript wrapping,
   * ScreenPlan, panels, hit testing and the PTY all follow this one width, so they cannot disagree; a drawer never
   * changes it (opening one never resizes the shell).
   */
  private dimensions(): {columns: number; rows: number} {
    const terminal = this.terminalDimensions();
    if (!this.workspace.open) return terminal;
    return {columns: this.workspaceColumns(terminal.columns).center.width, rows: terminal.rows};
  }

  /** The workspace column plan for this frame (see WorkspaceHost.plan): the single geometry path for regions. */
  private workspaceColumns(columns = this.terminalDimensions().columns): WorkspaceColumns {
    return this.workspace.plan(columns, this.workspaceSuppressed(), this.workspaceOwner());
  }

  /** Fullscreen or raw passthrough and idle visuals own the whole pane: no workspace chrome, the PTY gets every column. */
  private workspaceSuppressed(): boolean {
    return Boolean(this.passthrough || this.externalPassthrough || this.idle || this.frontendSuspended);
  }

  /**
   * Who has the keyboard, as the workspace sees it. Anything that owns input before the composer is protected and never
   * intercepted: startup, a program reading hidden or single-key input, passthrough, the agent view, every panel and
   * search. Only then a focused, open region, and otherwise the composer.
   */
  private workspaceOwner(ignoreNavigation = false): WorkspaceOwner {
    let owner: WorkspaceOwner | undefined;
    if (this.workspaceSuppressed() || this.startupPending || this.startupPanel || this.directInputRequest()) owner = 'PASSTHROUGH';
    else if (this.agentView) owner = 'AGENT_MESSAGE';
    else if ((!ignoreNavigation && this.outputNavigation) || this.hasModalInput(ignoreNavigation && this.blockPaletteReturn?.palette === this.paletteState) || this.presetPanel || this.batchReview || this.pastePreview || this.launcher || this.agentPanel || this.shelf.focused
      || this.background.bar.focused || this.background.suggestion) owner = 'PANEL';
    else if (this.historySearchActive || this.directorySearchActive || this.findState?.editing) owner = 'SEARCH';
    return this.workspace.owner(owner);
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
    this.pendingQueuePause = undefined;
    this.queueExpiry?.(); this.queueExpiry = undefined;
    if (this.stopped) return;
    // A window maximized for setup is put back before the frontend ends (bounded, synchronous, best effort).
    this.restoreWindowAfterEnding = false;
    this.firstRunWindow?.restoreNow();
    this.hostTitle.end();
    this.stopped = true;
    this.endOutputNavigation(false);
    this.blockPaletteContext = undefined;
    this.clips.clear();
    this.clipboardChangeWatch?.stop(); this.clipboardChangeSuggested = false;
    this.contextEngine.dispose();
    if (this.contextRefreshTimer) { clearTimeout(this.contextRefreshTimer); this.contextRefreshTimer = undefined; }
    if (this.noticeExpiry) { clearTimeout(this.noticeExpiry); this.noticeExpiry = undefined; }
    setCursorHostProvider(undefined);
    this.stopSetupPlayback();
    this.understanding.dispose();
    this.agentDiscoveryTimer?.();
    this.agentsSubscription();
    this.agents.dispose();
    this.cursorPresenter.dispose();
    this.transitions.cancel(); this.transitionClock?.(); this.transitionClock = undefined; this.motionPreviewClock?.(); this.motionPreviewClock = undefined;
    this.cursorPanelClock?.(); this.cursorPanelClock = undefined;
    this.tasksSubscription();
    this.watchSubscription();
    this.watches.dispose();
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
    process.off('exit', this.onProcessExit);
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
    this.hostProgramAbort?.abort();
    this.historyService.dispose();
    this.semanticService.kill();
    this.finish(exitCode);
  }
}

/** Commands newest first, read lazily so navigation stops at its bound. */
function* historyCommands(entries: readonly {command: string}[]): Iterable<string> {
  for (const entry of entries) yield entry.command;
}
