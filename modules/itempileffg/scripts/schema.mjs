import {PHYSICAL_TYPES} from './inventory.mjs';

/** Register schema subclasses before world Documents are constructed. Existing
 * fields from the 1.5 fork or other modules retain their original definitions. */
export function extendSchemas(config = CONFIG, runtime = foundry) {
    const f = runtime.data.fields;
    const number = initial => new f.NumberField({required:false,nullable:false,initial,min:0});
    for (const [type, Base] of Object.entries(config.Actor.dataModels)) {
        if (Base.defineSchema().economy) continue;
        config.Actor.dataModels[type] = class extends Base {
            static defineSchema() {
                return {...super.defineSchema(),economy:new f.SchemaField({credits:number(0)})};
            }
        };
    }
    for (const [type, Base] of Object.entries(config.Item.dataModels)) {
        if (!PHYSICAL_TYPES.has(type)) {
            if (!Base.defineSchema().price) config.Item.dataModels[type] = class extends Base {
                static defineSchema() { return {...super.defineSchema(), price:number(0)}; }
            };
            continue;
        }
        const fields = Base.defineSchema();
        if (fields.quantity && fields.price && fields.inventory) continue;
        config.Item.dataModels[type] = class extends Base {
            static defineSchema() {
                const schema = super.defineSchema();
                return {...schema,
                    quantity:schema.quantity ?? new f.NumberField({required:false,nullable:false,initial:1,min:0,integer:true}),
                    price:schema.price ?? number(0),
                    inventory:schema.inventory ?? new f.SchemaField({
                        containerId:new f.StringField({initial:'',blank:true}),
                        parentKey:new f.StringField({initial:'',blank:true}),
                        containerKey:new f.StringField({initial:'',blank:true}),
                        isContainer:new f.BooleanField({initial:false}),capacity:number(0)
                    })
                };
            }
        };
    }
}
