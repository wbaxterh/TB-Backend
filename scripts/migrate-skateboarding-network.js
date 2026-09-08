#!/usr/bin/env node
/**
 * Skateboarding Trickipedia progression network — editorial first pass.
 *
 * Mirrors the snowboarding network's edge shape:
 *   { trickId, reason, order, research: { status, confidence, evidence } }
 * in progression.{prerequisites,nextSteps,related}. Edges ship at
 * status 'reviewed' (visible on the site) with source-backed evidence;
 * a later deep-verification pass can upgrade them to 'published'.
 *
 * Dry-run by default (prints the resolved plan); pass --apply to write.
 * Uses db.js (ATLAS_URI + MONGODB_DATABASE, defaults to TrickList2Staging
 * via the importer convention — set MONGODB_DATABASE=TrickList2 for prod).
 */

require('dotenv').config();
const { connectToDatabase, closeDatabase } = require('../db');

const CHECKED_AT = new Date('2026-09-08T07:30:00.000Z');

// Verified sources (all fetched 2026-09-08).
const SRC = {
  ollieWiki: 'https://en.wikipedia.org/wiki/Ollie_(skateboarding)',
  kickflipWiki: 'https://en.wikipedia.org/wiki/Kickflip',
  heelflipWiki: 'https://en.wikipedia.org/wiki/Heelflip',
  shoveWiki: 'https://en.wikipedia.org/wiki/Pop_shove-it',
  treWiki: 'https://en.wikipedia.org/wiki/360_flip',
  grindWiki: 'https://en.wikipedia.org/wiki/Grind_(skateboarding)',
  slideWiki: 'https://en.wikipedia.org/wiki/Slide_(skateboarding)',
  freestyleWiki: 'https://en.wikipedia.org/wiki/Freestyle_skateboarding_tricks',
  ollieHow: 'https://www.wikihow.com/Ollie',
  kickflipHow: 'https://www.wikihow.com/Kickflip',
  dropInHow: 'https://www.wikihow.com/Drop-in-on-a-Skateboard',
  manualHow: 'https://www.wikihow.com/Manual-on-a-Skateboard',
  boardslideHow: 'https://www.wikihow.com/Do-a-Boardslide',
};

const CLAIMS = {
  [SRC.ollieWiki]:
    'Wikipedia describes the ollie as the foundational aerial from which most modern street tricks derive.',
  [SRC.kickflipWiki]:
    'Wikipedia describes the kickflip as an ollie variation in which the front foot flicks the board into a full flip.',
  [SRC.heelflipWiki]:
    'Wikipedia describes the heelflip as the heel-side counterpart to the kickflip, flipping the board in the opposite direction.',
  [SRC.shoveWiki]:
    'Wikipedia describes the pop shove-it as popping the board into a 180-degree rotation beneath the rider, with frontside and backside variants.',
  [SRC.treWiki]:
    'Wikipedia describes the 360 flip as combining a 360-degree backside shove-it with a kickflip.',
  [SRC.grindWiki]:
    'Wikipedia documents 50-50, 5-0, nosegrind, crooked, Smith, and feeble as truck-grind variants distinguished by which trucks contact and the board angle.',
  [SRC.slideWiki]:
    'Wikipedia documents boardslide, lipslide, noseslide, tailslide, and bluntslide as slide variants distinguished by contact point and approach.',
  [SRC.freestyleWiki]:
    'Wikipedia catalogs flatground and freestyle tricks including no-complies, impossibles, bigspins, and pressure flips with their mechanics.',
  [SRC.ollieHow]:
    'wikiHow teaches the ollie as pop, slide, and level mechanics that later tricks reuse.',
  [SRC.kickflipHow]: 'wikiHow teaches the kickflip flick off an established ollie motion.',
  [SRC.dropInHow]: 'wikiHow teaches the drop-in as the entry skill for transition riding.',
  [SRC.manualHow]: 'wikiHow teaches the manual as sustained balance on the back truck.',
  [SRC.boardslideHow]:
    'wikiHow teaches the boardslide as an ollie plus a quarter rotation onto the obstacle.',
};

const research = (url) => ({
  status: 'reviewed',
  confidence: 'medium',
  evidence: [{ url, claim: CLAIMS[url], checkedAt: CHECKED_AT }],
});

// e(targetUrlSlug, reason, evidenceSourceKey)
const e = (target, reason, src) => ({ target, reason, src });

// Keyed by trick url slug; groups reference other tricks by url slug.
const GRAPH = {
  // ---- flatground foundations ----
  kickturn: {
    nextSteps: [
      e(
        'powerslide-revert',
        'Extends flat pivoting into controlled sliding turns at speed.',
        'slideWiki',
      ),
      e('drop-in', 'Comfortable kickturns make the first drop-ins recoverable.', 'dropInHow'),
      e('frontside-180', 'The pivot motion previews the frontside aerial rotation.', 'ollieWiki'),
    ],
    related: [
      e('manual-skateboard', 'Both build low-speed balance over the back truck.', 'manualHow'),
    ],
  },
  'manual-skateboard': {
    nextSteps: [
      e('nose-manual', 'Transfers the same balance to the front truck.', 'manualHow'),
      e('5-0-grind', 'A 5-0 is a manual balanced on a ledge or rail.', 'grindWiki'),
    ],
    related: [e('nose-manual', 'The front-truck counterpart.', 'manualHow')],
  },
  'nose-manual': {
    prerequisites: [
      e(
        'manual-skateboard',
        'Back-truck manuals establish the balance envelope first.',
        'manualHow',
      ),
    ],
    nextSteps: [
      e('nosegrind', 'A nosegrind is a nose manual locked on a ledge or rail.', 'grindWiki'),
      e('nollie', 'Nose pressure control feeds directly into nollie pop.', 'ollieWiki'),
    ],
    related: [e('manual-skateboard', 'The back-truck counterpart.', 'manualHow')],
  },
  'powerslide-revert': {
    prerequisites: [e('kickturn', 'Pivot control keeps slides from hooking up.', 'slideWiki')],
    related: [
      e('frontside-180', 'Both rotate the board and body through the same arc.', 'ollieWiki'),
    ],
  },
  'no-comply-180': {
    prerequisites: [
      e('kickturn', 'The planted-foot pivot builds on kickturn rotation.', 'freestyleWiki'),
    ],
    related: [
      e(
        'frontside-180',
        'The same 180 rotation performed without planting a foot.',
        'freestyleWiki',
      ),
      e('ollie', 'Both finish with a two-footed catch and roll-away.', 'ollieWiki'),
    ],
  },
  ollie: {
    nextSteps: [
      e(
        'frontside-180',
        'Adds controlled frontside aerial rotation to a stable ollie.',
        'ollieWiki',
      ),
      e('backside-180', 'Adds controlled backside aerial rotation to a stable ollie.', 'ollieWiki'),
      e(
        'pop-shove-it',
        'Reuses ollie pop timing while the board rotates beneath you.',
        'shoveWiki',
      ),
      e(
        'kickflip',
        'Adds a front-foot flick to the ollie pop and leveling motion.',
        'kickflipWiki',
      ),
      e(
        '50-50-grind',
        'Uses ollie height and accurate truck placement to lock onto a ledge.',
        'grindWiki',
      ),
      e('boardslide', 'Uses an ollie plus a quarter turn onto the obstacle.', 'boardslideHow'),
    ],
    related: [
      e('nollie', 'The same pop performed off the nose.', 'ollieWiki'),
      e('switch-ollie', 'The same foundation performed in switch stance.', 'ollieWiki'),
      e(
        'no-comply-180',
        'A planted-foot alternative for getting the board airborne.',
        'freestyleWiki',
      ),
    ],
  },
  nollie: {
    prerequisites: [
      e('ollie', 'Regular-stance pop mechanics come first.', 'ollieWiki'),
      e('nose-manual', 'Front-truck pressure control makes the nollie pop natural.', 'manualHow'),
    ],
    nextSteps: [
      e('nollie-kickflip', 'Adds the kickflip flick to nollie pop.', 'kickflipWiki'),
      e(
        'nollie-frontside-bigspin',
        'Combines nollie pop with a frontside bigspin.',
        'freestyleWiki',
      ),
      e('nollie-backside-bigspin', 'Combines nollie pop with a backside bigspin.', 'freestyleWiki'),
    ],
    related: [e('switch-ollie', 'Both invert the stance demands of the ollie.', 'ollieWiki')],
  },
  'switch-ollie': {
    prerequisites: [e('ollie', 'Master the motion in your natural stance first.', 'ollieWiki')],
    nextSteps: [
      e('fakie-bigspin', 'Fakie and switch pop share the reversed-stance scoop.', 'freestyleWiki'),
    ],
    related: [e('nollie', 'Both invert the stance demands of the ollie.', 'ollieWiki')],
  },
  'frontside-180': {
    prerequisites: [
      e('ollie', 'A consistent ollie keeps the rotation aerial instead of pivoted.', 'ollieWiki'),
    ],
    nextSteps: [
      e(
        'frontside-bigspin',
        'Extends the frontside body rotation while adding board rotation.',
        'freestyleWiki',
      ),
    ],
    related: [
      e('backside-180', 'The opposite-direction aerial 180.', 'ollieWiki'),
      e('no-comply-180', 'The planted-foot version of the same rotation.', 'freestyleWiki'),
    ],
  },
  'backside-180': {
    prerequisites: [
      e('ollie', 'A consistent ollie keeps the rotation aerial instead of pivoted.', 'ollieWiki'),
    ],
    nextSteps: [
      e(
        'backside-bigspin',
        'Extends the backside body rotation while adding board rotation.',
        'freestyleWiki',
      ),
      e('backside-flip', 'Adds a kickflip to the backside 180.', 'kickflipWiki'),
    ],
    related: [e('frontside-180', 'The opposite-direction aerial 180.', 'ollieWiki')],
  },
  // ---- shove-its and bigspins ----
  'pop-shove-it': {
    prerequisites: [e('ollie', 'Provides pop timing and centered landings.', 'shoveWiki')],
    nextSteps: [
      e('varial-kickflip', 'Combines the backside shove with a kickflip.', 'kickflipWiki'),
      e('backside-bigspin', 'Adds body rotation to the shove.', 'freestyleWiki'),
      e(
        'fakie-bigspin',
        'The fakie stance makes the first bigspin scoop forgiving.',
        'freestyleWiki',
      ),
      e(
        'tre-flip-360-flip',
        'Develops the back-foot scoop that becomes a full 360 rotation.',
        'treWiki',
      ),
    ],
    related: [
      e('frontside-pop-shove-it', 'The board rotates in the opposite direction.', 'shoveWiki'),
      e(
        'backside-pop-shove-it',
        'The named backside member of the same shove family.',
        'shoveWiki',
      ),
    ],
  },
  'frontside-pop-shove-it': {
    prerequisites: [
      e('ollie', 'Provides pop timing and centered landings.', 'shoveWiki'),
      e(
        'pop-shove-it',
        'The backside shove teaches the catch before reversing direction.',
        'shoveWiki',
      ),
    ],
    nextSteps: [
      e(
        'frontside-bigspin',
        'Adds frontside body rotation to the frontside shove.',
        'freestyleWiki',
      ),
      e('varial-heelflip', 'Combines the frontside shove with a heelflip.', 'heelflipWiki'),
      e('hardflip', 'Combines the frontside shove with a kickflip.', 'kickflipWiki'),
    ],
    related: [e('pop-shove-it', 'The opposite-direction shove.', 'shoveWiki')],
  },
  'backside-pop-shove-it': {
    prerequisites: [e('ollie', 'Provides pop timing and centered landings.', 'shoveWiki')],
    nextSteps: [
      e('backside-bigspin', 'Adds body rotation to the backside shove.', 'freestyleWiki'),
      e('varial-kickflip', 'Combines the backside shove with a kickflip.', 'kickflipWiki'),
    ],
    related: [e('pop-shove-it', 'The same backside shove family.', 'shoveWiki')],
  },
  'frontside-bigspin': {
    prerequisites: [
      e('frontside-180', 'Supplies the body rotation half of the trick.', 'freestyleWiki'),
      e('frontside-pop-shove-it', 'Supplies the board rotation half of the trick.', 'shoveWiki'),
    ],
    nextSteps: [
      e('nollie-frontside-bigspin', 'The same trick popped off the nose.', 'freestyleWiki'),
    ],
    related: [
      e('backside-bigspin', 'The opposite-direction bigspin.', 'freestyleWiki'),
      e('fakie-bigspin', 'The reversed-stance entry to the bigspin family.', 'freestyleWiki'),
    ],
  },
  'backside-bigspin': {
    prerequisites: [
      e('backside-180', 'Supplies the body rotation half of the trick.', 'freestyleWiki'),
      e('pop-shove-it', 'Supplies the board rotation half of the trick.', 'shoveWiki'),
    ],
    nextSteps: [
      e('nollie-backside-bigspin', 'The same trick popped off the nose.', 'freestyleWiki'),
    ],
    related: [
      e('frontside-bigspin', 'The opposite-direction bigspin.', 'freestyleWiki'),
      e('fakie-bigspin', 'The reversed-stance entry to the bigspin family.', 'freestyleWiki'),
    ],
  },
  'fakie-bigspin': {
    prerequisites: [
      e(
        'pop-shove-it',
        'The scoop and catch carry over with fakie momentum helping the spin.',
        'shoveWiki',
      ),
    ],
    nextSteps: [
      e('backside-bigspin', 'Take the rotation from fakie to regular stance.', 'freestyleWiki'),
    ],
    related: [e('switch-ollie', 'Both ride away in a reversed stance.', 'ollieWiki')],
  },
  'nollie-frontside-bigspin': {
    prerequisites: [
      e('nollie', 'Nose pop replaces the tail scoop.', 'ollieWiki'),
      e('frontside-bigspin', 'Learn the rotation from the tail first.', 'freestyleWiki'),
    ],
    related: [
      e('nollie-backside-bigspin', 'The opposite-direction nollie bigspin.', 'freestyleWiki'),
    ],
  },
  'nollie-backside-bigspin': {
    prerequisites: [
      e('nollie', 'Nose pop replaces the tail scoop.', 'ollieWiki'),
      e('backside-bigspin', 'Learn the rotation from the tail first.', 'freestyleWiki'),
    ],
    related: [
      e('nollie-frontside-bigspin', 'The opposite-direction nollie bigspin.', 'freestyleWiki'),
    ],
  },
  // ---- flip tricks ----
  kickflip: {
    prerequisites: [e('ollie', 'The flick is added to an established ollie pop.', 'kickflipHow')],
    nextSteps: [
      e('varial-kickflip', 'Adds a backside shove beneath the flip.', 'kickflipWiki'),
      e('backside-flip', 'Adds a backside 180 to the flip.', 'kickflipWiki'),
      e('nollie-kickflip', 'The same flick popped off the nose.', 'kickflipWiki'),
      e('hardflip', 'Adds a frontside shove beneath the flip.', 'kickflipWiki'),
    ],
    related: [e('heelflip', 'The heel-side counterpart flick.', 'heelflipWiki')],
  },
  heelflip: {
    prerequisites: [
      e('ollie', 'The flick is added to an established ollie pop.', 'heelflipWiki'),
      e('kickflip', 'Most riders learn the toe-side flick first.', 'kickflipWiki'),
    ],
    nextSteps: [
      e('varial-heelflip', 'Adds a frontside shove beneath the heelflip.', 'heelflipWiki'),
      e('inward-heelflip', 'Adds a backside shove beneath the heelflip.', 'heelflipWiki'),
      e('laser-flip', 'Extends the varial heelflip to a full 360 shove.', 'heelflipWiki'),
    ],
    related: [e('kickflip', 'The toe-side counterpart flick.', 'kickflipWiki')],
  },
  'varial-kickflip': {
    prerequisites: [
      e('kickflip', 'Supplies the flip half of the trick.', 'kickflipWiki'),
      e('pop-shove-it', 'Supplies the shove half of the trick.', 'shoveWiki'),
    ],
    nextSteps: [
      e('tre-flip-360-flip', 'Extend the shove to a full 360 under the flip.', 'treWiki'),
    ],
    related: [e('varial-heelflip', 'The heel-side varial counterpart.', 'heelflipWiki')],
  },
  'varial-heelflip': {
    prerequisites: [
      e('heelflip', 'Supplies the flip half of the trick.', 'heelflipWiki'),
      e('frontside-pop-shove-it', 'Supplies the shove half of the trick.', 'shoveWiki'),
    ],
    nextSteps: [
      e('laser-flip', 'Extend the shove to a full 360 under the heelflip.', 'heelflipWiki'),
    ],
    related: [e('varial-kickflip', 'The toe-side varial counterpart.', 'kickflipWiki')],
  },
  hardflip: {
    prerequisites: [
      e('kickflip', 'Supplies the flip half of the trick.', 'kickflipWiki'),
      e('frontside-pop-shove-it', 'Supplies the frontside shove half of the trick.', 'shoveWiki'),
    ],
    related: [
      e('inward-heelflip', 'The mirror-image shove-plus-flip combination.', 'heelflipWiki'),
    ],
  },
  'inward-heelflip': {
    prerequisites: [
      e('heelflip', 'Supplies the flip half of the trick.', 'heelflipWiki'),
      e('pop-shove-it', 'Supplies the backside shove half of the trick.', 'shoveWiki'),
    ],
    related: [
      e('hardflip', 'The mirror-image shove-plus-flip combination.', 'kickflipWiki'),
      e('varial-heelflip', 'The same flip with the opposite shove direction.', 'heelflipWiki'),
    ],
  },
  'tre-flip-360-flip': {
    prerequisites: [
      e('varial-kickflip', 'Half the rotation of the tre with the same flip.', 'treWiki'),
      e('pop-shove-it', 'The back-foot scoop grows into the full 360 rotation.', 'treWiki'),
    ],
    related: [e('laser-flip', 'The heel-side mirror of the 360 flip.', 'heelflipWiki')],
  },
  'laser-flip': {
    prerequisites: [
      e('varial-heelflip', 'Half the rotation of the laser with the same flip.', 'heelflipWiki'),
      e(
        'frontside-pop-shove-it',
        'The frontside scoop grows into the full 360 rotation.',
        'shoveWiki',
      ),
    ],
    related: [e('tre-flip-360-flip', 'The toe-side mirror of the laser flip.', 'treWiki')],
  },
  'backside-flip': {
    prerequisites: [
      e('kickflip', 'Supplies the flip.', 'kickflipWiki'),
      e('backside-180', 'Supplies the body rotation.', 'ollieWiki'),
    ],
    related: [
      e('varial-kickflip', 'Rotates the board instead of the body under the flip.', 'kickflipWiki'),
    ],
  },
  'nollie-kickflip': {
    prerequisites: [
      e('nollie', 'Nose pop replaces the tail pop.', 'ollieWiki'),
      e('kickflip', 'Learn the flick from the tail first.', 'kickflipWiki'),
    ],
    related: [e('kickflip', 'The regular-stance version of the flick.', 'kickflipWiki')],
  },
  'hospital-flip': {
    prerequisites: [e('kickflip', 'Starts from a half-kickflip catch.', 'kickflipWiki')],
    related: [
      e('pressure-flip', 'Both use unconventional flip mechanics off the pop.', 'freestyleWiki'),
      e(
        'impossible',
        'Both wrap the board around the foot rather than flicking it.',
        'freestyleWiki',
      ),
    ],
  },
  'pressure-flip': {
    prerequisites: [
      e('pop-shove-it', 'The scoop-heavy pop grows from the shove motion.', 'shoveWiki'),
    ],
    related: [
      e('hospital-flip', 'Both use unconventional flip mechanics off the pop.', 'freestyleWiki'),
    ],
  },
  impossible: {
    prerequisites: [
      e('ollie', 'Pop control precedes the wrap.', 'ollieWiki'),
      e('pop-shove-it', 'The rear-foot scoop evolves into the vertical wrap.', 'freestyleWiki'),
    ],
    related: [
      e(
        'pressure-flip',
        'Both are scoop-driven rotations rather than flicked flips.',
        'freestyleWiki',
      ),
    ],
  },
  // ---- grinds ----
  '50-50-grind': {
    prerequisites: [
      e('ollie', 'Ollie height and precise truck placement lock in the grind.', 'grindWiki'),
    ],
    nextSteps: [
      e('5-0-grind', 'Lift the front truck to balance on the back truck only.', 'grindWiki'),
      e('nosegrind', 'Balance on the front truck only.', 'grindWiki'),
      e('smith-grind', 'Drop the front truck below the ledge on the toe side.', 'grindWiki'),
      e('feeble-grind', 'Drop the front truck over the far side of the rail.', 'grindWiki'),
    ],
    related: [
      e('boardslide', 'The other canonical first trick on a ledge or rail.', 'boardslideHow'),
      e('axle-stall', 'The stationary transition version of the double-truck lock.', 'grindWiki'),
    ],
  },
  '5-0-grind': {
    prerequisites: [
      e('50-50-grind', 'Learn the double-truck lock before lifting the nose.', 'grindWiki'),
      e('manual-skateboard', 'Manual balance carries the back-truck-only position.', 'manualHow'),
    ],
    nextSteps: [
      e('smith-grind', 'Angle the board down from the 5-0 position.', 'grindWiki'),
      e('feeble-grind', 'Push the front truck over the rail from the 5-0 position.', 'grindWiki'),
    ],
    related: [e('nosegrind', 'The front-truck counterpart.', 'grindWiki')],
  },
  nosegrind: {
    prerequisites: [
      e('50-50-grind', 'Learn the double-truck lock before lifting the tail.', 'grindWiki'),
      e('nose-manual', 'Nose manual balance carries the front-truck-only position.', 'manualHow'),
    ],
    nextSteps: [
      e('crooked-grind-k-grind', 'Angle the nosegrind so the tail swings out.', 'grindWiki'),
    ],
    related: [e('5-0-grind', 'The back-truck counterpart.', 'grindWiki')],
  },
  'crooked-grind-k-grind': {
    prerequisites: [
      e(
        'nosegrind',
        'A crook is an angled nosegrind with the nose pressing the ledge.',
        'grindWiki',
      ),
      e('noseslide', 'Nose-contact confidence helps commit to the angled lock.', 'slideWiki'),
    ],
    related: [e('nosegrind', 'The straight version of the same front-truck grind.', 'grindWiki')],
  },
  'smith-grind': {
    prerequisites: [
      e('5-0-grind', 'The Smith starts from a locked 5-0 with the nose angled down.', 'grindWiki'),
    ],
    related: [
      e('feeble-grind', 'The mirror lock with the front truck over the rail.', 'grindWiki'),
    ],
  },
  'feeble-grind': {
    prerequisites: [
      e(
        '5-0-grind',
        'The feeble starts from a locked 5-0 with the front truck pushed over.',
        'grindWiki',
      ),
      e('boardslide', 'Boardslide comfort helps with the over-the-rail position.', 'boardslideHow'),
    ],
    related: [e('smith-grind', 'The mirror lock with the nose angled down.', 'grindWiki')],
  },
  // ---- slides ----
  boardslide: {
    prerequisites: [e('ollie', 'Ollie onto the obstacle with a quarter turn.', 'boardslideHow')],
    nextSteps: [
      e('lipslide', 'Take the back truck over the obstacle before locking in.', 'slideWiki'),
      e('noseslide', 'Slide on the nose instead of the middle of the board.', 'slideWiki'),
      e('tailslide', 'Slide on the tail instead of the middle of the board.', 'slideWiki'),
    ],
    related: [e('50-50-grind', 'The other canonical first trick on a ledge or rail.', 'grindWiki')],
  },
  lipslide: {
    prerequisites: [
      e('boardslide', 'The locked position is the same once over the rail.', 'slideWiki'),
      e('backside-180', 'The over-the-rail entry needs 180 body control.', 'ollieWiki'),
    ],
    related: [e('boardslide', 'The same slide entered from the near side.', 'slideWiki')],
  },
  noseslide: {
    prerequisites: [
      e('ollie', 'Precise nose placement comes from a controlled ollie.', 'slideWiki'),
      e(
        'boardslide',
        'General slide comfort makes the nose lock less intimidating.',
        'boardslideHow',
      ),
    ],
    nextSteps: [
      e('noseblunt-slide', 'Push past vertical so the wheels ride the edge.', 'slideWiki'),
      e('crooked-grind-k-grind', 'Angle the nose contact into a front-truck grind.', 'grindWiki'),
    ],
    related: [e('tailslide', 'The tail-end counterpart.', 'slideWiki')],
  },
  tailslide: {
    prerequisites: [
      e('boardslide', 'General slide comfort precedes the tail lock.', 'boardslideHow'),
      e(
        'frontside-180',
        'The wind-up into a tailslide mirrors the frontside rotation.',
        'ollieWiki',
      ),
    ],
    nextSteps: [e('bluntslide', 'Push past vertical so the wheels ride the edge.', 'slideWiki')],
    related: [e('noseslide', 'The nose-end counterpart.', 'slideWiki')],
  },
  bluntslide: {
    prerequisites: [
      e('tailslide', 'The blunt is a tailslide locked past vertical onto the wheels.', 'slideWiki'),
    ],
    related: [e('noseblunt-slide', 'The nose-end blunt counterpart.', 'slideWiki')],
  },
  'noseblunt-slide': {
    prerequisites: [
      e(
        'noseslide',
        'The noseblunt is a noseslide locked past vertical onto the wheels.',
        'slideWiki',
      ),
      e('nollie', 'Nose pop control helps enter and pop out.', 'ollieWiki'),
    ],
    related: [e('bluntslide', 'The tail-end blunt counterpart.', 'slideWiki')],
  },
  // ---- transition ----
  'drop-in': {
    prerequisites: [
      e('kickturn', 'Flat kickturns make the first wall turns recoverable.', 'dropInHow'),
    ],
    nextSteps: [
      e('rock-to-fakie', 'The first lip trick once drop-ins are comfortable.', 'dropInHow'),
      e('axle-stall', 'Locks both trucks on the coping before re-entry.', 'grindWiki'),
    ],
    related: [e('kickturn', 'The turning skill used at the top of every wall.', 'dropInHow')],
  },
  'rock-to-fakie': {
    prerequisites: [e('drop-in', 'Comfortable re-entry is the whole trick.', 'dropInHow')],
    nextSteps: [
      e('axle-stall', 'Progress from rocking the board to locking the trucks.', 'grindWiki'),
    ],
    related: [e('axle-stall', 'Both are entry-level coping stalls.', 'grindWiki')],
  },
  'axle-stall': {
    prerequisites: [
      e('rock-to-fakie', 'Coping confidence and re-entry come first.', 'dropInHow'),
      e('50-50-grind', 'The stall is the stationary version of the 50-50 lock.', 'grindWiki'),
    ],
    nextSteps: [e('5-0-grind', 'Lift the front truck from the stall into motion.', 'grindWiki')],
    related: [e('rock-to-fakie', 'Both are entry-level coping stalls.', 'dropInHow')],
  },
  wallride: {
    prerequisites: [
      e('ollie', 'An ollie carries you onto the wall.', 'ollieWiki'),
      e('kickturn', 'The re-entry off the wall is a pivoting turn.', 'slideWiki'),
    ],
    related: [
      e('powerslide-revert', 'Both break traction deliberately and recover rolling.', 'slideWiki'),
    ],
  },
};

async function main() {
  const db = await connectToDatabase();
  const collection = db.collection('trickipedia');
  const tricks = await collection
    .find({ category: 'Skateboarding' })
    .project({ url: 1, name: 1 })
    .toArray();
  const byUrl = new Map(tricks.map((t) => [t.url, t]));

  const referenced = new Set(Object.keys(GRAPH));
  for (const groups of Object.values(GRAPH)) {
    for (const edges of Object.values(groups)) {
      for (const edgeDef of edges) referenced.add(edgeDef.target);
    }
  }
  const missing = [...referenced].filter((slug) => !byUrl.has(slug));
  if (missing.length) throw new Error(`Unknown trick slugs: ${missing.join(', ')}`);
  const uncovered = tricks.filter((t) => !GRAPH[t.url]).map((t) => t.url);

  const operations = Object.entries(GRAPH).map(([slug, groups]) => {
    const progression = Object.fromEntries(
      Object.entries(groups).map(([group, edges]) => [
        group,
        edges.map((edgeDef, order) => ({
          trickId: byUrl.get(edgeDef.target)._id,
          reason: edgeDef.reason,
          order,
          research: research(SRC[edgeDef.src]),
        })),
      ]),
    );
    return {
      updateOne: {
        filter: { _id: byUrl.get(slug)._id },
        update: {
          $set: {
            progression,
            'audit.networkReviewedAt': CHECKED_AT,
            updatedAt: new Date(),
          },
        },
      },
    };
  });

  const summary = {
    database: db.databaseName,
    tricksInGraph: Object.keys(GRAPH).length,
    totalSkateTricks: tricks.length,
    uncovered,
    operations: operations.length,
    dryRun: !process.argv.includes('--apply'),
  };

  if (process.argv.includes('--apply')) {
    const result = await collection.bulkWrite(operations);
    summary.modified = result.modifiedCount;
  }
  console.log(JSON.stringify(summary, null, 1));
  await closeDatabase();
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
