/** Reviewed Only War equipment rules. Source IDs are the pack's stable document
 * IDs, never translated names. Conditional bonuses belong in a roll dialog;
 * they deliberately do not transfer an always-on Actor modifier.
 * PDF pages refer to the user's Russian core rulebook (physical PDF pages).
 */
const labels = {};
const allTests = ['skill:*', 'characteristic:*'];
const ordinary = ['poor', 'common'];
const superior = ['good', 'best'];

// Fixed, deterministic embedded IDs, independent of language and array order.
function effectId(value) {
    const hash = seed => {
        let number = seed;
        for (const char of value) number = Math.imul(number ^ char.charCodeAt(0), 16777619) >>> 0;
        return number.toString(16).padStart(8, '0');
    };
    return hash(2166136261) + hash(3335557771);
}

function target(selector) {
    if (selector.startsWith('characteristic:') || selector.startsWith('basedOn:')) {
        const characteristic = selector.split(':')[1];
        return `system.characteristics.${characteristic === '*' ? 'toughness' : characteristic}.displayTotal`;
    }
    const [skill, speciality] = selector.slice(6).split('.');
    return `system.skills.${skill === '*' ? 'athletics' : skill}${speciality && speciality !== '*' ? `.specialities.${speciality}` : ''}.total`;
}

function bonus(id, value, selectors, en, ru, {conditional = true, quality, activation = 'equipped'} = {}) {
    const key = `EQUIPMENT_BONUS.${id.replaceAll('.', '_').toUpperCase()}`;
    labels[key] = {en, ru};
    const metadata = {id, conditional, selectors: [...selectors]};
    if (quality) metadata.quality = [...quality];
    return {
        _id: effectId(id), name: key, img: 'icons/svg/upgrade.svg', disabled: false,
        transfer: !conditional,
        flags: {'dark-heresy': {activation, equipmentBonus: metadata}},
        system: {changes: (conditional ? [selectors[0]] : selectors).map(selector => ({
            key: target(selector), type: 'add', value: String(value), phase: 'final', priority: 20
        }))}
    };
}

const passive = (id, value, selectors, en, ru, options = {}) => bonus(id, value, selectors, en, ru, {...options, conditional: false});
const implant = (id, value, selectors, en, ru, options = {}) => bonus(id, value, selectors, en, ru, {...options, activation: 'installed'});
const implantedPassive = (id, value, selectors, en, ru, options = {}) => implant(id, value, selectors, en, ru, {...options, conditional: false});
const entry = (sourceId, type, name, ruName, sourcePdfPage, effects, unsupported = []) => ({
    sourceId, type, name, ruName, sourcePdfPage, effects, unsupported
});

/** Higher craftsmanship retains the stated Good improvement where the book
 * does not specify a separate Best value. Bonuses requiring an action, a
 * particular sense, environment, connection or tool use remain opt-in.
 */
export const OW_EQUIPMENT_CATALOG = [
    entry('iqZyNDiudPNlpc6K', 'forceField', 'Refractor Field', 'Отражающее поле', 194, [
        passive('ow.refractor.stealth', -10, ['skill:stealth'], 'Active refractor field', 'Включённое отражающее поле')
    ]),
    entry('yIfo35tuB8SsIidB', 'forceField', 'Power Field (Personal)', 'Силовое поле (личное)', 194, [
        passive('ow.power-field-personal.stealth', -20, ['skill:stealth'], 'Active personal power field', 'Включённое личное силовое поле')
    ], ['Automatic Encumbered state, power duration and attack-distance exceptions are not equipment roll bonuses.']),
    entry('B7IwhCPjveJrbNDa', 'forceField', 'Power Field (Vehicle/Emplacement)', 'Силовое поле (для техники/укреплений)', 194, [
        passive('ow.power-field-vehicle.stealth', -20, ['skill:stealth'], 'Active vehicle power field', 'Включённое силовое поле техники')
    ]),

    entry('w0t4fnQMMo5kXgD8', 'gear', 'Chameleoline Cloak', 'Хамелеолиновый плащ', 196, [
        passive('ow.chameleoline.stealth', 20, ['skill:stealth'], 'Wearing a chameleoline cloak', 'Надет хамелеолиновый плащ')
    ], ['When stationary, attackers suffer −30 Ballistic Skill; this is an attacker-side combat modifier.']),
    entry('QpmAHVybfqoPIsLu', 'gear', 'Clip/Drop Harness', 'Страховка', 196, [
        bonus('ow.harness.descent', 30, ['skill:athletics'], 'Descending a vertical surface with the harness', 'Спуск по вертикальной поверхности со страховкой')
    ], ['The English entry calls the test Climb; Only War resolves climbing with Athletics. Falling prevention is not automated.']),
    entry('QJdwMSkaw0npOt0U', 'gear', 'Deadspace Earpiece', 'Глушащие наушники', 195, [
        bonus('ow.earpiece.sound', 20, ['characteristic:toughness'], 'Resisting sound or an auditory Concussive effect', 'Сопротивление звуку или звуковому оглушению')
    ]),
    entry('7Tiv9q01Kg52pJeF', 'gear', 'Filtration Plugs', 'Фильтры-затычки', 196, [
        bonus('ow.filtration.gas', 20, ['characteristic:toughness'], 'Resisting harmful gases through the filters', 'Сопротивление вредоносным газам через фильтры', {quality: ordinary}),
        bonus('ow.filtration.gas-superior', 30, ['characteristic:toughness'], 'Resisting harmful gases with improved filters', 'Сопротивление газам с улучшенными фильтрами', {quality: superior})
    ], ['Poor filters must be replaced after five hours.']),
    entry('xh2a2nYFAhsRyKHx', 'gear', 'Preysense Goggles', 'Визор хищника', 195, [
        bonus('ow.preysense.night', 20, ['characteristic:perception'], 'A vision-based Perception test at night', 'Основанный на зрении тест Восприятия ночью')
    ], ['Ignoring darkness requires the scene/vision rules, not an unconditional Perception increase.']),
    entry('JmqJ5nr871cST1Ki', 'gear', 'Recoil Gloves', 'Перчатка-амортизатор', 195, [], [
        'Removes the −20 penalty for one-handed Basic weapon use; does not remove the separate untrained penalty. Combat-dialog automation is deferred.'
    ]),
    entry('cBq10SKdjPZa6sMw', 'gear', 'Respirator/Gas Mask', 'Респиратор или противогаз', 196, [
        bonus('ow.respirator.gas', 30, ['characteristic:toughness'], 'Resisting gas through the respirator', 'Сопротивление газу через респиратор', {quality: ordinary}),
        bonus('ow.respirator.gas-superior', 40, ['characteristic:toughness'], 'Resisting gas with an improved respirator', 'Сопротивление газу с улучшенным респиратором', {quality: superior})
    ], ['Reroll of failed gas resistance and ten-hour Poor filter life are not automated.']),
    entry('S3h9Z7Cf10vxYKyD', 'gear', 'Survival Suit', 'Костюм для выживания', 195, [
        bonus('ow.survival-suit.environment', 20, allTests, 'Resisting an extreme environment with the suit', 'Сопротивление вредным условиям среды в костюме', {quality: ordinary}),
        bonus('ow.survival-suit.environment-good', 25, allTests, 'Resisting an extreme environment with the suit', 'Сопротивление вредным условиям среды в костюме', {quality: ['good']}),
        bonus('ow.survival-suit.environment-best', 30, allTests, 'Resisting an extreme environment with the suit', 'Сопротивление вредным условиям среды в костюме', {quality: ['best']})
    ], ['Poor suits cease to protect after three days in an extreme environment.']),
    entry('odfSnUGRld48FdiA', 'gear', 'Synskin', 'Комбинезон из синтекожи', 195, [
        passive('ow.synskin.stealth', 10, ['skill:stealth'], 'Wearing synskin', 'Надет комбинезон из синтекожи')
    ], ['2 AP only on otherwise unarmoured locations, and invisibility to infrared/Dark Sight, are not implemented by this skill bonus.']),
    entry('IWWjI6Ep2ghJXHn5', 'gear', 'Void Suit', 'Пустотный костюм', 196, [
        bonus('ow.void-suit.agility', -10, ['characteristic:agility'], 'Cumbersome void suit: Agility tests', 'Неуклюжий пустотный костюм: тесты Ловкости', {quality: ordinary})
    ], ['Only Agility tests change: the characteristic bonus, movement and skill totals are not reduced. Air duration is not automated.']),

    entry('b2nt86pBygaRqGtP', 'tool', 'Auspex/Scanner', 'Ауспик или сканер', 198, [
        bonus('ow.auspex.scan', 20, ['skill:awareness'], 'Using the auspex to scan', 'Сканирование с помощью ауспика', {quality: ordinary}),
        bonus('ow.auspex.scan-superior', 30, ['skill:awareness'], 'Using an improved auspex to scan', 'Сканирование с помощью улучшенного ауспика', {quality: superior})
    ]),
    entry('faxo1U5xxyzHzlK5', 'tool', 'Auto Quill', 'Автоперо', 198, [
        bonus('ow.auto-quill.trade', 10, ['skill:trade.*'], 'Using the auto quill for a trained Trade task', 'Применение автопера для освоенного ремесла')
    ]),
    entry('fhSpaoobAznR7faG', 'tool', 'Combi-tool', 'Комбиинструмент', 199, [
        bonus('ow.combi-tool.tech', 10, ['skill:techUse'], 'Using the combi-tool', 'Использование комбиинструмента')
    ], ['A Utility Mechadendrite counts as a combi-tool; do not claim two tool bonuses for the same tool function.']),
    entry('gWLagIpJt9xvVNQY', 'tool', 'Diagnostor', 'Диагностор', 199, [
        bonus('ow.diagnostor.diagnose', 20, ['skill:medicae', 'characteristic:perception'], 'Using the diagnostor to determine an ailment', 'Определение болезни с помощью диагностора')
    ]),
    entry('saon0Vv95vGlIbnn', 'tool', 'Field Suture', 'Перевязочный пакет', 200, [
        bonus('ow.field-suture.bleeding', 30, ['skill:medicae'], 'Using field sutures to stop Blood Loss', 'Остановка кровотечения перевязочным пакетом')
    ]),
    entry('DfmeuaYux63PX8nO', 'tool', 'Magboots', 'Магнитные ботинки', 199, [], [
        'When used, reduces Agility Bonus by 2, not Agility tests by 20. This requires derived-bonus and movement integration.'
    ]),
    entry('cMpkMefljttJZcet', 'tool', 'Medi-kit', 'Медицинская сумка', 200, [
        bonus('ow.medi-kit.treatment', 20, ['skill:medicae'], 'Using a medi-kit; an untrained user requires the advanced model', 'Применение медсумки; без освоенной Медики нужен улучшенный набор')
    ]),
    entry('TcxJ6KLRJ5EvrDRw', 'tool', 'Multicompass', 'Мультикомпас', 200, [
        passive('ow.multicompass.navigation', 20, ['skill:survival', 'skill:navigate.surface'], 'Having a multicompass ready', 'Под рукой мультикомпас')
    ]),
    entry('dtD9ibbnPQPcUyEm', 'tool', 'Multikey', 'Мультиключ', 200, [
        bonus('ow.multikey.locks', 30, ['skill:security'], 'Opening a lock with the multikey', 'Вскрытие замка мультиключом')
    ]),
    entry('gpMWmrrCbB0Rb2ow', 'tool', 'Psy Focus', 'Психофокус', 200, [], [
        '+10 Focus Power tests; deferred until equipment conditions are integrated into the psychic-power dialog, not all Willpower tests.'
    ]),
    entry('nXcCyMahf3JMbHkU', 'tool', 'Stummer', 'Молчун', 200, [
        bonus('ow.stummer.stealth', 30, ['skill:stealth'], 'Carrying a powered, active stummer', 'При себе включённый и заряженный молчун')
    ], ['Twenty minutes of use and one-hour recharge remain tracked by the player.']),
    entry('vMmj0Ye9Pf5jefQy', 'tool', 'Hand-Held Targeter', 'Ручной целеуказатель', 201, [], [
        'Half Action gives ANOTHER character +20 on their next Ballistic Skill test with Indirect fire. Combat-dialog automation is deferred.'
    ]),

    entry('aD5OhczhpYUzuNze', 'cybernetic', 'Bionic Arm', 'Бионическая рука', 202, [
        implant('ow.bionic-arm.dexterity', 10, ['characteristic:agility'], 'Using the improved arm for delicate manipulation', 'Тонкая работа улучшенной бионической рукой', {quality: superior}),
        implant('ow.bionic-arm.strength', 10, ['characteristic:strength'], 'Using the Best arm for a Strength test', 'Тест Силы с применением руки высшего качества', {quality: ['best']})
    ], ['Poor: halve Agility for fine work; Russian book has −10 WS/BS using the arm (English source says −5). Neither is automated.', 'The limb grants +2 Toughness Bonus only against damage to that location, not general Toughness.']),
    entry('PETQu5Z5VoddhGQ0', 'cybernetic', 'Bionic Legs', 'Бионические ноги', 202, [
        implant('ow.bionic-legs.jump', 20, ['skill:athletics'], 'Jumping or leaping with improved bionic legs', 'Прыжок с помощью улучшенных бионических ног', {quality: superior})
    ], ['Poor movement −1, running Agility test and Sprint talent are not automated here.']),
    entry('luNxZh2ny9PkGnxZ', 'cybernetic', 'Bionic Respiratory System', 'Бионическая дыхательная система', 202, [
        implant('ow.bionic-lungs.gas', 20, ['characteristic:toughness'], 'Resisting airborne toxins or gas weapons', 'Сопротивление летучим токсинам или газовому оружию'),
        implantedPassive('ow.bionic-lungs.noise', -20, ['skill:stealth'], 'Noisy Poor bionic lungs', 'Шумная дыхательная система низкого качества', {quality: ['poor']}),
        implant('ow.bionic-lungs.exertion', -10, allTests, 'Strenuous physical activity with Poor bionic lungs', 'Физическое усилие с дыхательной системой низкого качества', {quality: ['poor']})
    ]),
    entry('1QXo3hzMQ23yRt1k', 'cybernetic', 'Bionic Heart', 'Бионическое сердце', 202, [], [
        'Body AP +1 already lives in system.grantsArmour; do not duplicate it as an Active Effect. Sprint is a separate talent.'
    ]),
    entry('EOiQLhRReICiBcBX', 'cybernetic', 'Cranial Armour', 'Черепная броня', 203, [], [
        'Head AP +1 already lives in system.grantsArmour; do not duplicate it as an Active Effect.'
    ]),
    entry('erAwcD0r0I9E0V9O', 'cybernetic', 'Subskin Armour', 'Подкожная броня', 206, [], [
        'Arms, body and legs AP +2 already live in system.grantsArmour; do not duplicate them as Active Effects.'
    ]),
    entry('yJsIpEh07JF2ebpL', 'cybernetic', 'Synthmuscle', 'Синтемускулы', 206, [
        implant('ow.synthmuscle.agility', -10, ['characteristic:agility'], 'Best synthmuscle: Agility tests', 'Синтемускулы высшего качества: тесты Ловкости', {quality: ['best']})
    ], ['Unnatural Strength (1), or (4) at Best quality, is a trait; do not convert it to +10/+40 Strength.']),
    entry('zWCBV47xn4SpfUVX', 'cybernetic', 'Augur Array', 'Комплекс авгуров', 203, [
        implant('ow.augur.scan', 20, ['skill:awareness'], 'Concentrating and scanning a detectable signal with the augur', 'Сосредоточенное сканирование доступного сигнала авгуром')
    ], ['The implant duplicates a standard auspex, not the Good hand-held auspex +30. Good arrays grant a separate reroll; Poor arrays restrict detection/range.']),
    entry('ozpbRXS3ihW9piTg', 'cybernetic', 'Calculus Logi Upgrade', 'Имплантат калькулуса логи', 203, [
        implantedPassive('ow.calculus.logic', 10, ['skill:logic', 'skill:literacy'], 'Calculus logi processing', 'Обработка данных калькулусом логи'),
        implant('ow.calculus.scholastic', 10, ['skill:scholasticLore.*'], 'Using calculus logi for Scholastic Lore', 'Применение калькулуса логи для Учёного знания')
    ], ['Lore stays a roll condition so newly added/custom specialities receive the bonus without altering training ranks.']),
    entry('jqSDuIj58pdq8iyr', 'cybernetic', 'Cerebral Implants', 'Кортикальный имплантат', 204, [
        implantedPassive('ow.cerebral.logic', 20, ['skill:logic'], 'Improved cerebral implant: Logic', 'Улучшенный кортикальный имплантат: Логика', {quality: superior}),
        implant('ow.cerebral.lore', 20, ['skill:commonLore.*', 'skill:scholasticLore.*', 'skill:forbiddenLore.*'], 'Using the improved cerebral implant for Lore', 'Применение улучшенного кортикального имплантата для Знаний', {quality: superior})
    ], ['Common permanent −1d10 WS/BS/Ag/Int/Fel requires recorded rolls, not a repeatable equipment modifier. Good Unnatural Intelligence (2) is a separate trait.']),
    entry('8PiKC83Oy7gjpxp5', 'cybernetic', 'Cybernetic Senses', 'Кибернетические органы чувств', 204, [
        implant('ow.cyber-senses.poor', -20, allTests, 'A test involving the Poor cybernetic sense', 'Тест, использующий кибернетическое чувство низкого качества', {quality: ['poor']}),
        implant('ow.cyber-senses.resist', 20, allTests, 'Resisting an attack on the improved cybernetic sense', 'Сопротивление атаке на улучшенное кибернетическое чувство', {quality: superior})
    ], ['Heightened Senses and vision traits require separate trait integration.']),
    entry('P5z2LcdNUxCO2XnO', 'cybernetic', 'Interface Port', 'Канал передачи данных', 203, [
        implant('ow.interface-port.connection', 10, ['skill:commonLore.*', 'skill:inquiry', 'skill:techUse'], 'Connected to a relevant mechanism or data spool', 'Подключён к подходящему механизму или хранилищу данных')
    ]),
    entry('OpkJdXsEwUTrxI5g', 'cybernetic', 'Luminen Capacitor', 'Светоносные батареи', 206, [
        implant('ow.luminen.poor', -10, ['characteristic:toughness'], 'Using Poor luminen capacitors', 'Применение светоносных батарей низкого качества', {quality: ['poor']}),
        implant('ow.luminen.superior', 10, ['characteristic:toughness'], 'Using improved luminen capacitors', 'Применение улучшенных светоносных батарей', {quality: superior})
    ], ['Device-dependent test difficulties +10/0/−10/−20/−30 are chosen separately; they are not equipment bonuses.']),
    entry('fVBPb1MuIGGRCfa1', 'cybernetic', 'Manipulator Mechadendrite', 'Манипуляторный механодендрит', 204, [
        implant('ow.manipulator.strength', 20, ['basedOn:strength'], 'Using the manipulator for a non-delicate Strength-based task', 'Применение манипулятора для силовой работы, не требующей аккуратности')
    ], ['The Russian phrase “+20 к Силе” is implemented as contextual tests, not a global Strength/Strength Bonus increase. Its attack is separate.']),
    entry('mP547J3O9UxIUvfV', 'cybernetic', 'Medicae Mechadendrite', 'Медицинский механодендрит', 204, [
        implant('ow.medicae-mechadendrite.use', 10, ['skill:medicae', 'skill:interrogation'], 'Using the medical mechadendrite', 'Применение медицинского механодендрита')
    ], ['Amputation difficulty +0, stopping Blood Loss and the blade attack are not this +10 bonus.']),
    entry('f2aP2xGJFZlDVeeb', 'cybernetic', 'Memorance Implant', 'Мнемоимплантат', 205, [
        implant('ow.memorance.information', 10, allTests, 'Recorded information aids Trade (Remembrancer) or a social test', 'Запись даёт преимущество в Ремесле (Летописец) или социальном тесте')
    ], ['The player/GM must confirm the recorded information is relevant; Total Recall is a separate talent.']),
    entry('zOkMpPKa3EYrXiN3', 'cybernetic', 'Mind Impulse Unit', 'Блок мыслеуправления (БМУ)', 203, [
        implant('ow.miu.common', 10, ['skill:techUse', 'skill:operate.*'], 'Using a compatible device through the MIU', 'Работа с совместимым устройством через БМУ', {quality: ['common']}),
        implant('ow.miu.poor', -10, ['skill:techUse', 'skill:operate.*', 'skill:logic', 'skill:inquiry'], 'Interfacing with a device through the Poor MIU', 'Работа с устройством через БМУ низкого качества', {quality: ['poor']}),
        implant('ow.miu.superior', 10, ['skill:techUse', 'skill:operate.*', 'skill:logic', 'skill:inquiry'], 'Using a connected device through the improved MIU', 'Работа с подключённым устройством через улучшенный БМУ', {quality: superior})
    ], ['The Good MIU Ballistic Skill bonus, machine-spirit communication and Poor activation Willpower test are not automated in combat.']),
    entry('y8hnABy3KnwVKzwu', 'cybernetic', 'Optical Mechadendrite', 'Оптический механодендрит', 205, [
        implant('ow.optical.perception', 10, ['basedOn:perception'], 'Using the optical mechadendrite for a Perception-based test', 'Применение оптического механодендрита для теста на Восприятие')
    ], ['The book separately grants +20 night vision tests without explicit stacking language; do not automatically turn this into +30. Night-vision adjustment and darkness removal remain manual.']),
    entry('bAAbDGfoRq8aBBAX', 'cybernetic', 'Utility Mechadendrite', 'Ремесленный механодендрит', 205, [
        implant('ow.utility.tech', 10, ['skill:techUse'], 'Using the mechadendrite as a combi-tool', 'Применение механодендрита как комбиинструмента')
    ], ['Do not add a second combi-tool bonus for the same function. Censer smoke −5 WS to nearby living creatures, +10 smell-based detection by observers and the blade attack are not automated.'])
];

export const OW_EQUIPMENT_LABELS = Object.freeze(labels);
/** General rules without a qualifying source document in this OW equipment set.
 * The stock OW armour entries top out at 6 AP; a future >7 AP item requires this
 * rule as well as its item-specific catalogue entry.
 */
export const OW_EQUIPMENT_RULE_NOTES = [{
    id: 'ow.heavy-armour.stealth', sourcePdfPage: 193, modifier: -30,
    selectors: ['skill:stealth'], condition: 'Wearing armour granting more than 7 AP',
    automated: false,
    reason: 'No armour in the audited Only War source set has more than 7 AP; generic armour-condition automation is not attached to unrelated items.'
}, {
    id: 'ow.flak.blast', sourcePdfPage: 193, modifier: 1,
    condition: 'Flak armour against Blast damage, except at the direct target of the blast',
    automated: false, reason: 'Conditional armour at damage resolution, not a characteristic/skill roll bonus.'
}];
const bySourceId = new Map(OW_EQUIPMENT_CATALOG.map(item => [item.sourceId, item]));

/** Return isolated data for document migration/creation; never mutate the catalogue. */
export function getOWEquipmentEntry(sourceId) {
    const item = bySourceId.get(sourceId);
    return item ? structuredClone(item) : null;
}
