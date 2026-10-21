#!/usr/bin/env node
/**
 * Regenerates src/arcade/games/purrword/words.ts, Purrword's offline word lists. Run once by hand on a machine with the
 * BSD word list (macOS, FreeBSD):
 *
 *   node scripts/arcade/build-purrword-words.mjs [/usr/share/dict/web2]
 *
 * Sources and licenses:
 *  - Valid guesses: every five-letter, all-lowercase word of Webster's Second International (web2, 1934; its copyright
 *    has lapsed, per the file's own README), plus each four-letter web2 word with an "s" (web2 has few plurals), plus
 *    the answers below.
 *  - Answers: written for NMSh (common words, no plurals), released with NMSh under GPL-3.0-only.
 * Nothing is fetched; the game never reads the system word list at run time.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ANSWERS = `
about above abuse actor acute admit adopt adult after again agent agree ahead alarm album alert alike alive allow alone along
alter amber amuse angel anger angle angry ankle apple apply apron arena argue arise armor aroma arrow aside asset attic audio
avoid awake award aware awful bacon badge badly bagel baker basic basil batch beach beard beast begin being below bench berry
birch birth black blade blame blank blast blaze blend bless blind blink block bloom blown board boast bonus boost booth bored
bound brain brake brand brave bread break breed brick bride brief bring brisk broad broke brook broom brown brush build built
bunch burst cabin cable camel candy canoe cargo carry catch cause cedar chain chair chalk charm chart chase cheap check cheek
cheer chess chest chief child chill chime choir chord chose chunk cider cinch civic claim clash class clean clear clerk click
cliff climb cling clock close cloth cloud clove coach coast cocoa color comet comic coral couch cough could count court cover
craft crane crash cream creek crisp crowd crown crumb crust curly curve cycle daily dairy daisy dance dealt delay dense depth
diary dizzy dodge dough dozen draft drain drama drawn dream dress dried drift drink drive eager eagle early earth easel eaten
eight elbow elder empty enjoy enter entry equal error essay event every exact exist extra fable faint fairy faith false fancy
feast fence ferry fetch fever fiber field fifty fight final flame flash fleet flint float flock flood floor flour fluid flute
focus foggy force forge forth forum found frame fresh frost froze fruit fudge funny fuzzy gauge ghost giant given glass gleam
glide globe gloom glory glove grace grade grain grand grape graph grasp grass great green greet grill grind groan group grove
growl guard guess guest guide habit happy harsh hasty hatch haven heart heavy hedge hello hinge hobby honey horse hotel house
hover human humor hurry ideal image index inner input issue ivory jelly jewel joint jolly judge juice jumpy kayak kneel knife
knock known label laser later laugh layer learn lemon level light lilac limit linen liver llama lodge lofty logic loose lucky
lunar lunch magic major maple march marsh match mayor medal melon mercy merit metal meter might minor minty mirth model moist
money month moose motor mound mount mouse mouth movie muddy mural music naive nerve never night noble noise north notch novel
nurse nylon ocean offer often olive onion opera orbit order organ other otter ought outer owner oxide paint panel paper party
pasta paste patch pause peace peach pearl pedal penny perch petal phone photo piano piece pilot pinch pizza place plain plane
plant plate plaza pluck plumb plume poem? point polar porch pouch pound power press price pride prime print prize proof proud
prune pulse punch pupil puppy purse queen query quick quiet quilt quite quote radar radio raise rally ranch range rapid raven
reach ready realm relax relay remix reply ridge rifle right rigid rinse ripen risky rival river roast robin robot rocky roost
rough round route royal ruler rusty salad sandy sauce scale scarf scene scent scone scoop scout scrub seize sense serve seven
shade shady shake shallow shape share shark sharp sheep sheet shelf shell shift shine shiny shirt shock shore short shout shrub
sight silky silly since sixty skate skill slate sleek sleep slept slice slide slope smart smell smile smoke snack snail snake
sneak snowy solar solid solve sorry sound south space spare spark speak speed spell spend spice spicy spike spine spoke spoon
sport spray squad stack staff stage stair stamp stand stare start state steam steel steep stern stick still stone stood stool
storm story stove straw strip stuck study style sugar suite sunny super swamp swarm sweep sweet swift swing sword table taken
taste teach tempo tenth thank theme there thick thing think third thorn those three threw throw thumb tiger tight timer tired
title toast today token topic torch total touch tough towel tower toxic track trade trail train treat trend trial tribe trick
tried truck truly trunk trust truth tulip tutor twice twirl ultra uncle under unity until upper upset urban usage usual vapor
vault vivid vocal voice wagon waste watch water weave wedge whale wheat wheel where which while whisk white whole widen width
windy witty woken woman world worry worth would wrist write wrong yacht yearn yeast young youth zebra zesty
`.split(/\s+/u).filter(word => /^[a-z]{5}$/u.test(word));

const source = resolve(process.argv[2] ?? '/usr/share/dict/web2');
const words = readFileSync(source, 'utf8').split('\n');
const five = words.filter(word => /^[a-z]{5}$/u.test(word));
const plurals = words.filter(word => /^[a-z]{4}$/u.test(word) && !word.endsWith('s')).map(word => `${word}s`);
const answers = [...new Set(ANSWERS)].sort();
const guesses = [...new Set([...five, ...plurals, ...answers])].sort();
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../src/arcade/games/purrword/words.ts');
const chunk = (list, width = 120) => { const text = list.join(''); const lines = []; for (let i = 0; i < text.length; i += width) lines.push(`  '${text.slice(i, i + width)}'`); return lines.join(' +\n'); };
writeFileSync(out, `/**
 * Purrword's word lists, generated by scripts/arcade/build-purrword-words.mjs (see it for sources and licenses). Each list
 * is five-letter words run together, so it stays small and has nothing to parse. Do not edit by hand.
 */
/** ${answers.length} answers: common words, no plurals. */
export const ANSWERS =
${chunk(answers)};
/** ${guesses.length} accepted guesses, sorted. */
export const GUESSES =
${chunk(guesses)};
`);
console.log(`answers ${answers.length}, guesses ${guesses.length} -> ${out}`);
