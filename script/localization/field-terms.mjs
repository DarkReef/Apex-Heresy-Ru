/** Presentation only. Native paths and non-OW ruleset labels stay unchanged. */
export const OW_CHARACTERISTICS=Object.freeze({weaponSkill:'Ближний бой',ballisticSkill:'Дальний бой',strength:'Сила',toughness:'Выносливость',agility:'Ловкость',intelligence:'Интеллект',perception:'Восприятие',willpower:'Сила воли',fellowship:'Товарищество'});
const aliases={weaponSkill:['Weapon Skill','WS','ББ','Ближний бой'],ballisticSkill:['Ballistic Skill','BS','ДБ','Стрельба','Дальний бой'],toughness:['Toughness','Стойкость','Выносливость'],fellowship:['Fellowship','Общительность','Товарищество']};
export function characteristicTerm(actor,key,{localize=k=>k,language='en',ruleset=actor?.system?.ruleset}={}){
 const original=actor?.system?.characteristics?.[key]?.label??`CHARACTERISTIC.${key.replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()}`;
 const label=ruleset==='ow'&&language==='ru'&&OW_CHARACTERISTICS[key]?OW_CHARACTERISTICS[key]:localize(original);
 return {label,aliases:[...(aliases[key]??[]),key.replace(/([a-z])([A-Z])/g,'$1 $2')]};
}
