import {hostname, platform, release, uptime, userInfo} from 'node:os';
import type {WelcomeStudio} from './model.js';
import type {WelcomeFacts} from './compose.js';
/** Only requested, typed facts are collected. No command is run, including for Git. */
export function collectWelcomeFacts(model: WelcomeStudio, context: {shell: string; version: string; terminal: string; cwd: string; git?: string}, now = new Date()): WelcomeFacts {
  const facts: WelcomeFacts = {};
  for (const id of model.modules) {
    switch (id) {
      case 'os': facts.os = `${platform()} ${release()}`; break;
      case 'shell': facts.shell = context.shell; break;
      case 'version': facts.version = context.version; break;
      case 'terminal': facts.terminal = context.terminal; break;
      case 'time': facts.time = now.toLocaleTimeString(); break;
      case 'uptime': facts.uptime = `${Math.floor(uptime() / 60)} min`; break;
      case 'path': facts.path = context.cwd; break;
      case 'hostname': facts.hostname = hostname(); break;
      case 'user': try { facts.user = userInfo().username; } catch { facts.user = 'Unavailable'; } break;
      case 'git': facts.git = context.git ?? 'Unavailable'; break;
    }
  }
  return facts;
}
