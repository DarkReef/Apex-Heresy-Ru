/** Babele owns compendium translation; Foundry owns interface translation.
 * Register on Babele's hook so system/module init ordering is irrelevant.
 * Mechanical strings (special, aptitudes, grants, formulae, keys) are unmapped.
 */
export function registerBabele(babele) {
    babele?.setSystemTranslationsDir?.('localization');
}
Hooks.once('babele.init', registerBabele);
