import {remainingWounds,remainingWoundsPatch} from './vitals.mjs';
export const isWoundsBar=path=>['wounds','wounds.value','wounds.remaining'].includes(String(path).replace(/^system\./,''));
export function tokenWoundsUpdate(actor,value,isDelta=false){
 const wounds=actor._source?.system?.wounds??actor.system.wounds;
 const next=(isDelta?remainingWounds(wounds):0)+Number(value);
 if(!Number.isFinite(next))throw new Error('Invalid remaining wounds');
 return remainingWoundsPatch(Math.min(Number(wounds.max),next),wounds.max);
}
export function woundsTokenDocument(Base,rulesetFor){
 return class extends Base {
  getBarAttribute(barName,options={}){
   const result=super.getBarAttribute(barName,options);
   const path=options.alternative??this[barName]?.attribute;
   if(!this.actor||rulesetFor(this.actor).id!=='ow'||!isWoundsBar(path))return result;
   const wounds=this.actor.system.wounds;
   return {...result,type:'bar',attribute:String(path).replace(/^system\./,''),value:remainingWounds(wounds),max:Number(wounds.max)||0,editable:true};
  }
 };
}
