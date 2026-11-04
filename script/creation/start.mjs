// ════════════════════════════════════════════════════════════════════════
//  «Создать персонажа» в панели «Актёры»: заводит пустой лист и сразу
//  открывает на нём Мастера.
//
//  Персонажа заводит себе игрок, поэтому кнопка стоит у всех. Но право
//  «создавать Актёров» Foundry по умолчанию даёт только Помощнику и Ведущему,
//  и своими силами игрок актора не создаст. Тогда кнопка просит об этом
//  Ведущего по системному сокету: тот заводит персонажа, отдаёт его просителю
//  во владение и отвечает — лист и Мастер открываются уже у игрока.
// ════════════════════════════════════════════════════════════════════════

import {openCharacterWizard} from "./wizard.mjs";

const SOCKET = "system.apex-heresy-ru";

/** Тип листа по умолчанию. Книгу игрок называет уже в Мастере. */
const DEFAULT_TYPE = "acolyte";

/** Имя нового листа: персонажа ещё не назвали, назовут в Мастере. */
export const NEW_CHARACTER_NAME = "New Character";

/**
 * Завести персонажа и открыть на нём Мастера; без своего права — попросить Ведущего.
 * @returns {Promise<Actor|null>} актор, если он создан здесь и сейчас
 */
export async function startCharacterCreation() {
    if (!game.user?.can?.("ACTOR_CREATE")) return requestCharacterFromGM();

    const actor = await Actor.create({name: NEW_CHARACTER_NAME, type: DEFAULT_TYPE});
    if (!actor) return null;
    await openStartedCharacter(actor);
    return actor;
}

/** Просьба к Ведущему. Ответ придёт сообщением `characterStarted`. */
function requestCharacterFromGM() {
    if (!game.users?.activeGM) {
        ui.notifications?.warn(game.i18n.localize("WIZARD.NO_GM"));
        return null;
    }
    game.socket?.emit(SOCKET, {type: "startCharacter", userId: game.user.id});
    ui.notifications?.info(game.i18n.localize("WIZARD.ASKING_GM"));
    return null;
}

/** Открыть лист созданного персонажа и Мастера на нём. */
export async function openStartedCharacter(actor) {
    if (!actor) return null;
    await actor.sheet?.render(true);
    openCharacterWizard(actor);
    return actor;
}

/** Обработать просьбу игрока — только на клиенте Ведущего. */
export async function handleStartCharacterRequest(userId) {
    if (!game.user?.isActiveGM) return;
    const actor = await Actor.create({
        name: NEW_CHARACTER_NAME,
        type: DEFAULT_TYPE,
        ownership: {[userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER}
    });
    if (actor) game.socket?.emit(SOCKET, {type: "characterStarted", userId, actorId: actor.id});
}

/** Ответ Ведущего — открыть лист и Мастера у того, кто просил. */
export function handleCharacterStarted(data) {
    if (data?.userId !== game.user?.id) return;
    openStartedCharacter(game.actors.get(data.actorId));
}
