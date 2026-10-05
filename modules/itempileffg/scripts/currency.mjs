export function currencyConfig(settings = globalThis.game?.settings) {
    const name = String(settings?.get('itempileffg','currencyName') || 'Троны').trim();
    const img = String(settings?.get('itempileffg','currencyIcon') || 'icons/svg/coins.svg').trim();
    return {type:'attribute',name,img,abbreviation:'{#} '+name,data:{path:'system.economy.credits'},primary:true,exchangeRate:1};
}
export async function syncCurrency() {
    if (!game.user.isGM || !game.itempiles?.API || game.users.activeGM?.id && game.users.activeGM.id!==game.user.id) return;
    const existing=game.itempiles.API.CURRENCIES ?? [];
    if (existing.length && !existing.some(c=>c.data?.path==='system.economy.credits')) return;
    await game.itempiles.API.setCurrencies(existing.length ? existing.map(c=>c.data?.path==='system.economy.credits'?currencyConfig():c) : [currencyConfig()]);
}
export async function createCurrencyLoot({amount,position,sceneId=canvas.scene?.id}={}) {
    if (!game.user.isGM) throw new Error('GM only');
    const value=Number(amount);
    if (!Number.isFinite(value)||value<=0) throw new Error('Amount must be positive');
    if (!sceneId || !position || !Number.isFinite(position.x)||!Number.isFinite(position.y)) throw new Error('Select a token on the active scene');
    const currency=currencyConfig();
    return game.itempiles.API.createItemPile({sceneId,position,createActor:true,
        actorOverrides:{name:currency.name,type:'acolyte',img:currency.img,system:{economy:{credits:value}}},
        tokenOverrides:{name:currency.name,texture:{src:currency.img}},itemPileFlags:{enabled:true,type:'pile',deleteWhenEmpty:true}});
}
