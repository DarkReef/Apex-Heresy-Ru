/** System settings remain separate from optional module settings. */
export function registerSystemSettings() {
    game.settings.register("dark-heresy", "worldSchemaVersion", {
        name: "UI.WORLD_VERSION",
        hint: "UI.WORLD_VERSION_HINT",
        scope: "world",
        config: true,
        default: 0,
        type: Number
    });
    game.settings.register("dark-heresy", "ruleset", {
        name: "SETTINGS.RULESET",
        hint: "SETTINGS.RULESET_HINT",
        scope: "world",
        config: true,
        default: "dh2",
        type: String,
        choices: { dh2: "RULESET.DH2", bc: "RULESET.BC" }
    });

    game.settings.register("dark-heresy", "autoCalcXPCosts", {
        name: "UI.CALCULATE_XP_COSTS",
        hint: "UI.XP_COSTS_HINT",
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    // Diagnostic for the effects that keep vanishing - see the preDeleteActiveEffect
    // hook. On by default until the cause is found: the bug is intermittent, and a trap
    // that is off when it happens catches nothing.
    game.settings.register("dark-heresy", "logEffectDeletions", {
        name: "UI.LOG_EFFECT_DELETIONS",
        hint: "UI.EFFECT_DELETION_LOG_HINT",
        scope: "world",
        config: true,
        default: true,
        type: Boolean
    });
    // Некоторые столы не хотят, чтобы автоматика бросала за игрока: тест силы
    // воли против огня и бросок кровопотери — это их кости, и особенно
    // кровопотеря, где шанс погибнуть невелик и цена броска высока.
    game.settings.register("dark-heresy", "promptPlayerRolls", {
        name: "UI.PLAYERS_ROLL_CONDITION_TESTS",
        hint: "UI.PLAYER_CONDITION_ROLLS_HINT",
        scope: "world",
        config: true,
        default: true,
        type: Boolean
    });
    // Мастер создания ещё не готов к столу, поэтому его вход с листа по
    // умолчанию скрыт. Настройка, а не вырезанный код: включить обратно можно
    // не трогая систему, и доделывать его при этом никто не мешает.
    game.settings.register("dark-heresy", "showCreationWizard", {
        name: "SETTINGS.SHOW_WIZARD",
        hint: "SETTINGS.SHOW_WIZARD_HINT",
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });
    game.settings.register("dark-heresy", "atmosphericEffects", {
        name: "UI.ATMOSPHERIC_EFFECTS",
        hint: "UI.ATMOSPHERIC_EFFECTS_HINT",
        scope: "client",
        config: true,
        default: true,
        type: Boolean,
        onChange: value => applyAtmosphereSetting(value)
    });

}

export function applyAtmosphereSetting(enabled) {
    document.body.classList.toggle("dh-no-atmosphere", !enabled);
}
