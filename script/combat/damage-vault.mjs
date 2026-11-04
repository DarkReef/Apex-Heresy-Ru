/** Ciphertext, never NPC defense values, is stored in replicated ChatMessage flags.
 * Client-scoped key survives reloads; another GM/client cannot replay an unreadable journal.
 */
const hex = bytes => Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const bytes = value => Uint8Array.from(value.match(/.{2}/g)??[],v=>parseInt(v,16));
export function createDamageVault({key, crypto = globalThis.crypto}) {
    const imported = () => crypto.subtle.importKey('raw',bytes(key()),'AES-GCM',false,['encrypt','decrypt']);
    return {
        async encrypt(value) {
            const iv=crypto.getRandomValues(new Uint8Array(12));
            const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},await imported(),new TextEncoder().encode(JSON.stringify(value)));
            return {version:1,iv:hex(iv),ciphertext:hex(new Uint8Array(ciphertext))};
        },
        async decrypt(envelope) {
            if(envelope?.version!==1) throw Error('Unknown journal format');
            const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv)},await imported(),bytes(envelope.ciphertext));
            return JSON.parse(new TextDecoder().decode(plain));
        }
    };
}
