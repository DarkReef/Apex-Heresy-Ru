/**
 * Talents the dark-heresy pack never shipped.
 *
 * A query over all 774 items found none of these by name. The Untouchable
 * talents are the set on p. 92-93, available to a character with the Untouchable
 * elite advance — the advance itself is already modelled in
 * script/creation/elite-data.mjs, only its talents were missing. The Sisters of
 * Battle Faith Talents are on p. 297.
 *
 * "Inquisitor" is deliberately absent: it is not a talent, and the elite-advance
 * module already records that it is granted by a serving Inquisitor's decree
 * rather than bought with experience.
 *
 * The text is the book's own wording, not a paraphrase.
 */

const SOURCE = "Dark Heresy Second Edition, p. 92";
const FAITH_SOURCE = "Dark Heresy Second Edition, p. 297";

/** Folder ids in the built pack, by tier. Faith talents have no tier of their own. */
export const TALENT_FOLDERS = {
    1: "kSiSzsEcrrIUJhBa",
    2: "wmzItoIpSYFAZfKI",
    3: "KOiTs9TxXptywk7c",
    faith: "M8dce5Z0NoONOAeg"
};

const talent = (name, {tier, prerequisites, aptitudes, benefit, description, source = SOURCE}) => ({
    name,
    type: "talent",
    folder: TALENT_FOLDERS[tier] ?? TALENT_FOLDERS.faith,
    img: "systems/apex-heresy-ru/assets/icons/aptitudes/willpower.webp",
    system: {
        description: `<p>${description}</p>`,
        source,
        prerequisites,
        aptitudes,
        patron: "undivided",
        benefit,
        tier: typeof tier === "number" ? tier : 0,
        starter: false,
        cost: 0
    }
});

export const MISSING_TALENTS = [
    talent("Soulless Aura", {
        tier: 1,
        prerequisites: "Willpower 30",
        aptitudes: "Finesse, Willpower",
        benefit: "Enemies nearby suffer -10 to Charm and Deceive tests.",
        description: "Enemy characters within WPB metres of the Untouchable suffer a &ndash;10 penalty to all Charm and Deceive tests."
    }),
    talent("Psychic Null", {
        tier: 2,
        prerequisites: "Willpower 40",
        aptitudes: "Defence, Willpower",
        benefit: "Gains Deny the Witch and +20 to resist psychic powers.",
        description: "The character gains the Deny the Witch talent. He also gains a +20 bonus when making Evasion tests against psychic attacks and when making Opposed tests to resist psychic powers. This talent stacks with Resistance (Psychic Powers) and can be purchased multiple times; each time a character purchases it, increase the bonus it grants by +5."
    }),
    talent("Bane of the Daemon", {
        tier: 2,
        prerequisites: "Willpower 40",
        aptitudes: "Defence, Willpower",
        benefit: "Warp Instability creatures nearby struggle to stay in realspace.",
        description: "Creatures with the Warp Instability trait within WPB metres of the Untouchable suffer a penalty on their Willpower test to remain in realspace equal to five times the Untouchable's WPB."
    }),
    talent("Warp Disruption", {
        tier: 2,
        prerequisites: "Willpower 45",
        aptitudes: "Perception, Willpower",
        benefit: "Psykers nearby lose 1 psy rating.",
        description: "All characters with a psy rating within WPB metres of the character reduce their base psy rating by 1 while they remain within range. Characters reduced to a psy rating of 0 cannot use any psychic powers."
    }),
    talent("Warp Anathema", {
        tier: 3,
        prerequisites: "Warp Disruption, Willpower 55",
        aptitudes: "Intelligence, Willpower",
        benefit: "Warp Disruption reduces psy rating by 2 instead of 1.",
        description: "Characters affected by Warp Disruption reduce their psy rating by 2, instead of the normal amount. This talent can be purchased multiple times; each time a character purchases it the reduction in psy rating increases by 1. If purchased 3 times, for example, the reduction would be 4."
    }),
    talent("Warp Bane", {
        tier: 3,
        prerequisites: "Warp Disruption, Willpower 55",
        aptitudes: "Willpower",
        benefit: "Warp Disruption reaches twice as far.",
        description: "The effects of Warp Disruption apply to all characters with a psy rating within two times WPB metres of the character, instead of the normal amount."
    }),
    talent("Null Field", {
        tier: 3,
        prerequisites: "Psychic Null, Willpower 50",
        aptitudes: "Willpower",
        benefit: "Psychic Null protects everyone nearby.",
        description: "The effects of Psychic Null apply to all characters within WPB metres of the character."
    }),
    talent("Daemonic Anathema", {
        tier: 3,
        prerequisites: "Warp Anathema, Willpower 55",
        aptitudes: "Willpower",
        benefit: "Daemons nearby lose the benefits of the Daemonic trait.",
        description: "All creatures with the Daemonic trait within WPB metres of the character do not gain any benefits from that trait."
    }),

    // Sisters of Battle Faith Talents (p. 297). As a Free Action, a character
    // with a Faith Talent may spend a Fate point to activate it until the end of
    // the encounter.
    talent("Holy Light", {
        tier: "faith",
        source: FAITH_SOURCE,
        prerequisites: "Sister of Battle",
        aptitudes: "Willpower",
        benefit: "Faith Talent. Burns with an inner light that wards and sears.",
        description: "The character burns with a bright inner light. Melee and Point Blank attacks against the character suffer a &ndash;20 penalty but Long and Extreme range attacks gain a +10 bonus. Creatures with 20 or more Corruption points, Daemons, and psykers within 5 metres of the character suffer 1d10 Energy damage with the Sanctified quality each round to their Head location."
    }),
    talent("Seal of Purity", {
        tier: "faith",
        source: FAITH_SOURCE,
        prerequisites: "Sister of Battle",
        aptitudes: "Willpower",
        benefit: "Faith Talent. A drawn seal the Warp-spawn cannot cross.",
        description: "Instead of a Free Action, the character must spend one hour drawing a blessed seal 3 metres in length. Once completed, the seal lasts for the encounter's duration, or for 1 hour of narrative time. Daemons and other Warp-spawn can neither cross, nor disturb the seal. Furthermore, psychic powers manifested by such creatures cannot affect anything within or beyond the seal."
    }),
    talent("Wrath of the Righteous", {
        tier: "faith",
        source: FAITH_SOURCE,
        prerequisites: "Sister of Battle",
        aptitudes: "Willpower",
        benefit: "Faith Talent. Allies strike harder and more vengefully.",
        description: "The character chooses a number of allies up to her FelB. She and these allies inflict 1d5 additional damage on Melee attacks, and these attacks gain Vengeful (9) quality."
    }),
    talent("Hand of the Emperor", {
        tier: "faith",
        source: FAITH_SOURCE,
        prerequisites: "Sister of Battle",
        aptitudes: "Willpower",
        benefit: "Faith Talent. Grants Unnatural Strength (3) and Unnatural Agility (2).",
        description: "The character and a number of allies up to her Fellowship bonus gain the Unnatural Strength (3) and Unnatural Agility (2) traits."
    }),
    talent("The Unforgiving Blade", {
        tier: "faith",
        source: FAITH_SOURCE,
        prerequisites: "Sister of Battle",
        aptitudes: "Willpower",
        benefit: "Faith Talent. Blesses a blade against Daemons and psykers.",
        description: "The character's touch blesses a bladed melee weapon. The blade gains the Sanctified quality and increases its damage by 1d10 and its penetration by 2 for attacks against Daemons, psykers, and creatures with 20 or more Corruption points."
    })
];
