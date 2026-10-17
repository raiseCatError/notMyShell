---
title: Prompts and appearance
description: Native modules, external providers and comfortable presentation.
group: Make it yours
order: 8
sources: [README.md, docs/architecture/prompt-customization.md]
---

## Choose who supplies the prompt

`/prompt` lets you use NMSh Native, Starship, Oh My Posh, Powerlevel10k or no prompt
provider. The composer remains NMSh's editor in every case. An external provider
does not restore that shell theme's whole interactive UI.

NMSh Native uses semantic modules and independent choices for geometry, palette,
vibrance, Chroma and motion. Changing a color treatment should not require changing
what your prompt tells you. The [Native prompt reference](/docs/reference/prompt-customization/)
describes the supported styles and their settings in detail.

## Keep context intentional

`/modules` opens the module manager. Modules can route to Main Prompt, Right Context,
Context Rail or the Status Strip where supported. Choose what matters to the task
rather than filling every available row. `/strip` manages Status Strip composition.

## Provider limitations

Powerlevel10k is rendered through a bounded isolated helper. Its instant prompt,
right prompt and gitstatus daemon are not reproduced. Settings defined only in
`.zshrc` rather than its own config are not necessarily visible to the helper.

External providers are optional installed programs. NMSh's fallbacks are not a
promise of perfect layout parity with every upstream theme or plugin.

## Personality is optional

`/appearance`, `/motion`, `/chroma`, `/screensaver` and `/glyphs` control NMSh-owned
presentation. Vespyr is the cat in the product identity and optional visual surfaces.
Reduced motion, safe glyphs and restrained colors are first-class alternatives.
Raw program output and copied text remain outside this decoration system.
