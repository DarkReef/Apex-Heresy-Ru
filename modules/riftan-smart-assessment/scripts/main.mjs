import {enhanceRollCard} from './chat.mjs';
import {fieldCatalog,assessChange,searchFields} from './fields.mjs';
import {SCOPE,rollData,fateActor,validateReroll,createFateService} from './fate.mjs';
const t=key=>game.i18n.localize('RSA.'+key);
const esc=value=>foundry.utils.escapeHTML(String(value??''));
const pending=new Map();
const editorObservers=new WeakMap();
let service;
const resolveActor=data=>fateActor(data,fromUuidSync,game.actors);
const messages=()=>game.messages.contents;
const gmActive=()=>game.users.activeGM;
const fail=error=>ui.notifications.error(t(error.message)===('RSA.'+error.message)?error.message:t(error.message));

export async function requestReroll(messageId) {
    const source=game.messages.get(messageId),actor=resolveActor(rollData(source));
    validateReroll(source,actor,game.user,messages(),game.darkHeresy.config);
    if (!gmActive()) throw new Error('GM_REQUIRED');
    if (!game.darkHeresy.tests?.fateSnapshotVersion || !game.darkHeresy.tests?.combatRoll) throw new Error('READY_ERROR');
    // Author is supplied by Foundry; the GM trusts neither a caller-supplied Actor nor roll data.
    return ChatMessage.create({content:`<p>${esc(t('WAITING'))}: ${esc(actor.name)}</p>`,whisper:ChatMessage.getWhisperRecipients('GM').map(u=>u.id),
        flags:{[SCOPE]:{request:{sourceId:messageId,status:'pending'}}}});
}
async function execute(data,source,history) {
    let timeout,record;
    const created=new Promise((resolve,reject)=>{
        record={source,history,resolve,reject,message:null,phraseIndex:Math.floor(Math.random()*10)};
        timeout=setTimeout(()=>reject(new Error('Chat creation timed out')),30000);
    });
    // Attach a rejection handler immediately while the native engine is running.
    created.catch(()=>{});
    pending.set(data.flags.rsaRequestId,record);
    try {
        const result=await game.darkHeresy.tests[data.flags.isCombatRoll?'combatRoll':'commonRoll'](data);
        if (result?.status==='cancelled') {
            if (record.message) return record.message;
            throw new Error('Roll cancelled');
        }
        return record.message??await created;
    } catch(error) {
        if (record.message) return record.message;
        throw error;
    } finally {clearTimeout(timeout);pending.delete(data.flags.rsaRequestId);}
}
async function processRequest(request) {
    if (gmActive()?.id!==game.user.id || request.getFlag(SCOPE,'request')?.status!=='pending') return;
    try {await service(request);}
    catch(error) {
        await request.update({content:`<p>${esc(game.i18n.format('RSA.ERROR',{reason:t(error.message)===('RSA.'+error.message)?error.message:t(error.message)}))}</p>`,[`flags.${SCOPE}.request.status`]:'failed'});
    }
}

export function enhanceEffectEditor(app,html) {
    const root=html?.querySelector?html:html?.[0];
    const effect=app.document??app.object;
    if (!root || !effect || game.system.id!=='dark-heresy') return;
    const target=()=>{
        const parent=effect.parent;
        const transfer=root.querySelector('[name="transfer"]')?.checked??effect.transfer;
        if (parent?.documentName!=='Item' || !transfer) return parent;
        return parent.actor??{system:game.system.model.Actor.acolyte};
    };
    function attach() {
        for (const input of root.querySelectorAll('input[name$=".key"]')) {
            if (input.dataset.rsaAttached) continue;
            input.dataset.rsaAttached='true';
            const prefix=input.name.slice(0,-3),row=input.closest('.effect-change,.change,li,tr')??input.parentElement.parentElement;
            const box=document.createElement('div');box.className='rsa-field-helper';
            const search=document.createElement('input');search.type='search';search.placeholder=t('SEARCH');search.setAttribute('aria-label',t('SEARCH'));
            const list=document.createElement('div');list.className='rsa-field-results';
            const hint=document.createElement('small');hint.className='rsa-field-hint';hint.setAttribute('aria-live','polite');
            box.append(search,list,hint);input.parentElement.append(box);
            function catalog(){return fieldCatalog(target(),CONFIG.ActiveEffect.attributeKeys??{},key=>game.i18n.localize(key));}
            function validate(){
                const entry=catalog().find(e=>e.key===input.value);
                const field=suffix=>[...root.querySelectorAll('[name]')].find(el=>el.name===prefix+suffix);
                const value=field('value')?.value??'',type=field('type')?.value??field('mode')?.value??'override',phase=field('phase')?.value??'initial';
                const check=assessChange(entry,value,type,phase);
                input.dataset.rsaState=check.state;
                hint.textContent=`${t(check.hint)}${entry?' · '+entry.label+' · '+t(entry.type.toUpperCase()):''}`;
                hint.dataset.rsaState=check.state;
            }
            search.addEventListener('input',event=>{
                event.stopPropagation();list.replaceChildren();
                if (!search.value.trim()) return;
                for (const entry of searchFields(catalog(),search.value).slice(0,25)) {
                    const button=document.createElement('button');button.type='button';button.className='rsa-field-choice';
                    button.textContent=`${entry.label} — ${entry.key}`;
                    button.addEventListener('click',event=>{
                        event.preventDefault();event.stopPropagation();input.value=entry.key;input.dispatchEvent(new Event('change',{bubbles:true}));
                        search.value='';list.replaceChildren();validate();
                    });list.append(button);
                }
            });
            row.addEventListener('input',validate);row.addEventListener('change',validate);
            root.querySelector('[name="transfer"]')?.addEventListener('change',validate);
            validate();
        }
    }
    editorObservers.get(app)?.disconnect();
    attach();
    const observer=new MutationObserver(attach);observer.observe(root,{childList:true,subtree:true});editorObservers.set(app,observer);
    app.addEventListener?.('close',()=>observer.disconnect(),{once:true});
}

Hooks.once('ready',()=>{
    if (game.system.id!=='dark-heresy') return;
    service=createFateService({
        actor:request=>resolveActor(rollData(game.messages.get(request.getFlag(SCOPE,'request')?.sourceId))),
        source:request=>game.messages.get(request.getFlag(SCOPE,'request')?.sourceId),user:request=>request.author,
        done:request=>request.getFlag(SCOPE,'request')?.status!=='pending',messages,config:()=>game.darkHeresy.config,
        clone:foundry.utils.deepClone,execute,
        finish:async(request,source,result)=>{
            await source.setFlag(SCOPE,'replacement',result.id);
            await request.update({content:`<p>${esc(t('REQUEST_DONE'))}</p>`,[`flags.${SCOPE}.request.status`]:'done'});
        }
    });
    game.modules.get(SCOPE).api={version:1,requestReroll,enhanceEffectEditor};
    if (!game.darkHeresy?.tests?.fateSnapshotVersion) ui.notifications.warn(t('READY_ERROR'));
    Hooks.on('darkHeresy.preComputeRollTarget',data=>{
        const record=pending.get(data.flags?.rsaRequestId);
        if (!record || !data.flags?.isReRoll) return;
        data.target.final=Number(rollData(record.source).target.final);
        return false;
    });
    // Registered at ready, after other modules' load-time pre-create hooks.
    Hooks.on('preCreateChatMessage',(message)=>{
        const data=rollData(message),id=data?.flags?.rsaRequestId;
        if (!id) return;
        const record=pending.get(id);
        if (!record) return false;
        const success=!!data.flags.isSuccess;
        message.updateSource({whisper:[...record.source.whisper],blind:!!record.source.blind,
            [`flags.${SCOPE}.fate`]:{...record.history,after:Number(data.result),success,phraseIndex:record.phraseIndex,requestId:id}});
    });
    Hooks.on('createChatMessage',message=>{
        const id=message.getFlag(SCOPE,'fate')?.requestId,record=pending.get(id);
        if (record) {record.message=message;record.resolve(message);}
        if (message.getFlag(SCOPE,'request')) void processRequest(message);
    });
    // Replace the native entry instead of presenting two ways to spend the same point.
    Hooks.on('getChatMessageContextOptions',(_html,options)=>{
        for(let i=options.length-1;i>=0;i--) if(options[i].name===game.i18n.localize('CHAT.CONTEXT.REROLL')) options.splice(i,1);
        options.push({name:t('REROLL'),icon:'<i class="fa-solid fa-repeat"></i>',condition:li=>{
            if(!gmActive() || !game.darkHeresy.tests?.fateSnapshotVersion) return false;
            const source=game.messages.get((li?.dataset??li?.[0]?.dataset)?.messageId);
            try {validateReroll(source,resolveActor(rollData(source)),game.user,messages(),game.darkHeresy.config);return true;}catch{return false;}
        },callback:li=>requestReroll((li?.dataset??li?.[0]?.dataset)?.messageId).catch(fail)});
    });
});
Hooks.on('renderActiveEffectConfig',enhanceEffectEditor);
Hooks.on('renderChatMessageHTML',(message,html)=>{
    if (game.system.id!=='dark-heresy') return;
    html.classList.remove('rsa-fate-success','rsa-fate-failure','rsa-replaced');
    const body=html.querySelector('.message-content');if(!body)return;
    body.querySelectorAll('.rsa-fate-footer,.rsa-replacement').forEach(el=>el.remove());
    if (!message.isContentVisible) return;
    const fate=message.getFlag(SCOPE,'fate');
    if (fate) {
        html.classList.add(fate.success?'rsa-fate-success':'rsa-fate-failure');
        const footer=document.createElement('section');footer.className='rsa-fate-footer';
        footer.innerHTML=`<strong>${esc(t('FATE_ROLL'))} · ${esc(t(fate.success?'SUCCESS':'FAILURE'))}</strong><p>${esc(game.i18n.format('RSA.HISTORY',fate))}</p><blockquote>${esc(t((fate.success?'SUCCESS_':'FAILURE_')+fate.phraseIndex))}</blockquote>`;
        const source=game.messages.get(fate.sourceId);
        if (source?.isContentVisible) footer.append(historyLink(source.id,t('ORIGINAL')));
        body.append(footer);
    }
    const replacement=game.messages.get(message.getFlag(SCOPE,'replacement'));
    if (replacement?.isContentVisible) {
        html.classList.add('rsa-replaced');const badge=document.createElement('div');badge.className='rsa-replacement';
        badge.append(historyLink(replacement.id,t('REPLACED')));body.append(badge);
    }
});
function historyLink(id,label) {
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.addEventListener('click',async()=>{
        const message=game.messages.get(id);
        if (!message?.isContentVisible) return;
        button.disabled=true;
        try {
            const selector=`[data-message-id="${CSS.escape(id)}"]`;
            if (!document.querySelector(selector)) {
                const first=ui.chat.element?.querySelector('[data-message-id]');
                await ui.chat.postOne(message,{before:first?.dataset.messageId,notify:false,scroll:false});
            }
            document.querySelector(selector)?.scrollIntoView({behavior:'smooth',block:'center'});
        } catch(error) {fail(error);} finally {button.disabled=false;}
    });return button;
}
Hooks.on('updateChatMessage',message=>{if(message.getFlag(SCOPE,'replacement'))ui.chat?.render(true);});

Hooks.on('renderChatMessageHTML',enhanceRollCard);
