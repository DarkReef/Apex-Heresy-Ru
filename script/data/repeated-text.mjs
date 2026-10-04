/**
 * Undo what a doubled form field did to a line of text.
 *
 * Two inputs sharing one `name` inside a form are submitted as an array, and a
 * text field stores an array as "value,value". The character sheet carried the
 * demeanour and the comrade twice, so every save doubled what the last one had
 * left: "Stoic" became "Stoic,Stoic", then four of them, then eight.
 *
 * The line itself may hold commas, so it cannot simply be split on them. What
 * the damage always looks like is one unit repeated, joined by single commas;
 * the shortest such unit is what was typed.
 *
 * @param {*} text the stored value
 * @returns {*} the unit when the text is that unit repeated, otherwise the text
 */
export function collapseRepeatedText(text) {
    if (typeof text !== 'string' || !text.includes(',')) return text;
    for (let copies = Math.floor((text.length + 1) / 2); copies >= 2; copies--) {
        const length = (text.length - (copies - 1)) / copies;
        if (!Number.isInteger(length) || length < 1) continue;
        const unit = text.slice(0, length);
        if (Array(copies).fill(unit).join(',') === text) return unit;
    }
    return text;
}
