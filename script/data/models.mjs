import {validateTraitOverrides} from './weapon-traits.mjs';

function merge(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (key === "templates" || ["__proto__", "constructor", "prototype"].includes(key)) continue;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            target[key] = merge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
        } else target[key] = structuredClone(value);
    }
    return target;
}

/** Resolve the same reusable defaults used by the content builder and legacy worlds. */
export function resolveTypeTemplate(data, documentName, type) {
    const group = data[documentName];
    const source = group?.[type];
    if (!source) throw new Error(`Unknown ${documentName} type: ${type}`);
    const result = {};
    for (const name of source.templates ?? []) {
        if (!group.templates[name]) throw new Error(`Missing ${documentName} template: ${name}`);
        merge(result, group.templates[name]);
    }
    merge(result, source);
    if (documentName === 'Item' && ['weapon','vehicleWeapon','psychicPower'].includes(type)) result.traitOverrides ??= {};
    return result;
}

export function migrateModelSource(source, defaults) {
    const result = structuredClone(source);
    const archive = structuredClone(source.legacyData ?? {});
    function visit(value, shape, saved) {
        for (const [key, raw] of Object.entries(value)) {
            if (key === 'legacyData' || ['__proto__','constructor','prototype'].includes(key)) continue;
            if (!(key in shape)) { saved[key] = structuredClone(raw); continue; }
            if (typeof shape[key] === 'number' && (Array.isArray(raw) || typeof raw === 'string' && raw.includes(','))) {
                const parts = Array.isArray(raw) ? raw.flat(Infinity) : raw.split(',');
                const number = parts.map(Number).find(Number.isFinite);
                if (number !== undefined) { saved[key] = structuredClone(raw); value[key] = number; }
            } else if (raw && typeof raw === 'object' && !Array.isArray(raw)
                && !['skills','specialities'].includes(key) && shape[key] && Object.keys(shape[key]).length) {
                const nested = saved[key] ?? {};
                visit(raw, shape[key], nested);
                if (Object.keys(nested).length) saved[key] = nested;
            }
        }
    }
    visit(result, defaults, archive);
    result.legacyData = archive;
    return result;
}

/** Create native V14 schemas while keeping the shipped template as the defaults contract. */
export function createDataModels(data, runtime) {
    const {fields} = runtime.data;
    function field(value, key) {
        // Массив или объект по умолчанию — своя копия на документ, иначе правка одного течёт во все.
        const initial = value && typeof value === "object" ? () => structuredClone(value) : value;
        const options = {required: false, initial};
        if (key === 'traitOverrides') return new fields.ObjectField({...options,
            validate: value => {validateTraitOverrides(value); return true;}});
        if (typeof value === "number") return new fields.NumberField({...options, nullable:false,
            ...(['price','credits','capacity','quantity'].includes(key) ? {min:0} : {}),
            ...(key === 'quantity' ? {integer:true} : {})});
        if (typeof value === "boolean") return new fields.BooleanField({...options, nullable:false});
        if (typeof value === "string") return new fields.StringField({...options, blank:true});
        if (Array.isArray(value)) return new fields.ArrayField(new fields.AnyField({nullable:true}), options);
        // Custom skill names and specialities are user-owned maps, not a closed list of schema keys.
        if (["skills", "specialities"].includes(key) || !value || !Object.keys(value).length) return new fields.ObjectField(options);
        return new fields.SchemaField(Object.fromEntries(Object.entries(value).map(([k,v]) => [k,field(v,k)])));
    }
    const models = {Actor:{}, Item:{}};
    for (const documentName of Object.keys(models)) {
        for (const type of data[documentName].types) {
            const defaults = resolveTypeTemplate(data, documentName, type);
            models[documentName][type] = class extends runtime.abstract.TypeDataModel {
                static migrateData(source) {
                    return super.migrateData(migrateModelSource(source, defaults));
                }
                static defineSchema() {
                    return {...Object.fromEntries(Object.entries(defaults).map(([key,value]) => [key,field(value,key)])),
                        legacyData: new fields.ObjectField({initial:{}})};
                }
            };
        }
    }
    return models;
}
