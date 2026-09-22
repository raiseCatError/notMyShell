import {displayWidth, repeatToWidth, stripAnsi, truncateText} from '../util/text.js';
import type {PromptContext} from '../shell/ShellContext.js';
import {background, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';

const RESET = '\u001B[0m';
const PROJECT_BACKGROUND = background(UI_COLORS.projectBackground);
const PROJECT_FOREGROUND = foreground(UI_COLORS.projectForeground);
const GIT_BACKGROUND = background(UI_COLORS.gitBackground);
const GIT_FOREGROUND = foreground(UI_COLORS.gitForeground);
const LINE = foreground(UI_COLORS.separator);

export const FADE_TAIL_GLYPHS = GLYPHS.powerlineFade;

interface SegmentPlan {
  project: string;
  branch?: string;
}

function planSegments(context: PromptContext, width: number): SegmentPlan {
  const fixedProjectWidth = 2 + displayWidth(`${GLYPHS.powerlineFade} `);
  const lineReserve = width >= 12 ? 2 : 1;
  let branch = context.branch;
  const branchWidth = branch ? displayWidth(`${GLYPHS.powerlineTransition} ${GLYPHS.branch} ${branch} `) : 0;
  let projectBudget = width - fixedProjectWidth - branchWidth - lineReserve;

  if (branch && projectBudget < 3) {
    branch = undefined;
    projectBudget = width - fixedProjectWidth - lineReserve;
  }

  const project = truncateText(context.project, Math.max(1, projectBudget));
  if (branch) {
    const remaining = width - displayWidth(` ${project} ${GLYPHS.powerlineTransition} ${GLYPHS.branch}  ${GLYPHS.powerlineFade} `) - lineReserve;
    branch = truncateText(branch, Math.max(1, remaining));
  }
  return {project, branch};
}

export function buildPromptLine(context: PromptContext, width: number): string {
  if (width <= 0) return '';
  if (width < 8) return `${LINE}${repeatToWidth(GLYPHS.separator, width)}${RESET}`;

  const plan = planSegments(context, width);
  let rendered = `${PROJECT_FOREGROUND}${PROJECT_BACKGROUND} ${plan.project} `;
  let tailColor = foreground(UI_COLORS.projectBackground);

  if (plan.branch) {
    rendered += `${foreground(UI_COLORS.projectBackground)}${GIT_BACKGROUND}${GLYPHS.powerlineTransition}`;
    rendered += `${GIT_FOREGROUND}${GIT_BACKGROUND} ${GLYPHS.branch} ${plan.branch} `;
    tailColor = foreground(UI_COLORS.gitBackground);
  }

  rendered += `${RESET}${tailColor}${GLYPHS.powerlineFade} `;
  const used = displayWidth(rendered);
  const separatorWidth = Math.max(0, width - used);
  return `${rendered}${LINE}${repeatToWidth(GLYPHS.separator, separatorWidth)}${RESET}`;
}

export function promptContentWidth(context: PromptContext, width: number): number {
  const plain = stripAnsi(buildPromptLine(context, width));
  const separatorIndex = plain.indexOf('─');
  return displayWidth(separatorIndex === -1 ? plain : plain.slice(0, separatorIndex));
}
