export function validateRequest({actorUuids, characteristic, skill, modifier = 0}) {
    if (!Array.isArray(actorUuids) || !actorUuids.length || actorUuids.length > 100 || actorUuids.some(uuid => typeof uuid !== 'string')) throw new Error('Select characters');
    if (!!characteristic === !!skill || typeof (characteristic || skill) !== 'string') throw new Error('Select one test');
    if (!Number.isFinite(Number(modifier)) || Math.abs(Number(modifier)) > 1000) throw new Error('Invalid modifier');
    return {actorUuids:[...new Set(actorUuids)], characteristic:characteristic || '', skill:skill || '', modifier:Number(modifier)};
}
export function canRespond(request, actor, user) {
    return !!request && !request.closed && request.actorUuids.includes(actor?.uuid)
        && (user?.isGM || actor?.testUserPermission?.(user, 'OWNER'));
}
export function acceptedResponses(messages, requestId, request, actorFor, userFor) {
    const results = new Map();
    for (const message of messages) {
        if (message.visible === false || message.isContentVisible === false) continue;
        const response = message.getFlag?.('dark-heresy', 'partyResponse');
        if (!response || response.requestId !== requestId || results.has(response.actorUuid)) continue;
        const author = userFor(message.author?.id ?? message.user?.id ?? message.user);
        const actor = actorFor(response.actorUuid);
        if (!request.actorUuids.includes(response.actorUuid) || !(author?.isGM || actor?.testUserPermission?.(author, 'OWNER'))) continue;
        if (!Number.isInteger(response.roll) || response.roll < 1 || response.roll > 100 || !Number.isFinite(response.target)
            || typeof response.success !== 'boolean' || !Number.isFinite(response.degrees)) continue;
        results.set(response.actorUuid, response);
    }
    return results;
}
