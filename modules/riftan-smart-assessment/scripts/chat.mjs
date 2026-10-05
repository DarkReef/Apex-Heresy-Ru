/** Presentation only: never rewrite stored traits, item names or roll data. */
export const TRAIT_LABELS = {
    'las weapon setting':'Смена режима лазерного оружия','las setting':'Смена режима лазерного оружия',
    reliable:'Надёжное',accurate:'Точное',balanced:'Сбалансированное',blast:'Взрывное',concussive:'Оглушающее',
    crippling:'Калечащее',defensive:'Защитное',corrosive:'Разъедающее',devastating:'Опустошительное',
    felling:'Разящее',flame:'Зажигательное',flexible:'Гибкое',force:'Психосиловое','gyro-stabilised':'Гиростабилизированное',
    hallucinogenic:'Галлюциногенное',haywire:'Помехи',inaccurate:'Неточное',maximal:'Максимальное',melta:'Мельта',
    overheats:'Перегревающееся','power field':'Силовое поле',primitive:'Примитивное',proven:'Проверенное',
    'razor sharp':'Бритвенно-острое',recharge:'Подзарядка',sanctified:'Освящённое',scatter:'Разлёт',shock:'Шоковое',
    smoke:'Дымовое',snare:'Опутывающее',spray:'Распыляющее',storm:'Штормовое',tainted:'Осквернённое',
    tearing:'Разрывное','twin-linked':'Спаренное',unbalanced:'Несбалансированное',unwieldy:'Неудобное'
};
export function traitParts(text, russian = false) {
    return String(text ?? '').split(/,\s*(?![^()]*\))/).filter(part => part.trim()).map(part => {
        const original = part.trim(), match = original.match(/^(.*?)(\s*\([^)]*\))?$/);
        const key = match[1].trim().toLowerCase();
        return {original, key, label:russian && TRAIT_LABELS[key] ? TRAIT_LABELS[key]+(match[2]??'') : original};
    });
}
export function shortChip(text) {return String(text).replace(/\s*\([^)]*\)/g,'').trim();}

export function enhanceRollCard(message, html) {
    if (game.system.id !== 'dark-heresy' || !message.isContentVisible) return;
    const root = html?.querySelector ? html : html?.[0];
    if (!root) return;
    const cards = root.querySelectorAll('.dark-heresy.chat.roll');
    const data = message.getFlag('dark-heresy','rollData');
    for (const card of cards) {
        card.classList.add('rsa-compact-card');
        for (const chip of card.querySelectorAll('.dh-chips .chip')) {
            if (chip.dataset.rsaCompact) continue;
            const full = chip.textContent.trim(), label = shortChip(full);
            chip.dataset.rsaCompact = 'true';
            if (label === full) continue;
            chip.textContent = ''; chip.append(detailLink(label, full, full));
        }
        if (!data?.weapon?.special || card.querySelector('.rsa-trait-list')) continue;
        // Locate the value by its original text, not its translated heading or
        // a fragile row index. New card rows can be added without breaking this.
        const value = [...card.querySelectorAll('.dh-kv dd')].find(dd => dd.textContent.trim() === data.weapon.special.trim());
        if (!value) continue;
        value.classList.add('rsa-trait-list'); value.replaceChildren();
        const russian = game.i18n.lang === 'ru';
        for (const part of traitParts(data.weapon.special, russian)) {
            const key = part.key.replace(/\W+/g,'_').toUpperCase();
            const path = `RSA.TRAIT_${key}`;
            const explanation = game.i18n.has(path) ? game.i18n.localize(path) : part.original;
            value.append(detailLink(part.label, explanation, part.original));
        }
    }
}
function detailLink(label, explanation, original) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'rsa-rule-link';
    button.textContent = label; button.title = explanation; button.dataset.tooltip = foundry.utils.escapeHTML(explanation);
    button.setAttribute('aria-label',`${label}: ${explanation}`);
    button.addEventListener('click',event => {
        event.preventDefault(); event.stopPropagation();
        // No prose is inserted into the chat card. Click/focus is available in
        // addition to hover, including popped-out chat and narrow sidebars.
        void foundry.applications.api.DialogV2.wait({classes:['rsa-rule-dialog'],window:{title:label},
            content:`<p>${foundry.utils.escapeHTML(explanation)}</p><small>${foundry.utils.escapeHTML(original)}</small>`,
            buttons:[{action:'close',label:game.i18n.localize('RSA.CLOSE'),default:true}]});
    });
    return button;
}
