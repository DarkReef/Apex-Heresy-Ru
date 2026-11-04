/** Native Region previews plus a reviewed, token-specific area target selection.
 * The 2D footprint test is geometric only: walls, cover, height and scatter need GM review.
 * No attack, damage, condition or user targeting is performed by this module.
 */
export const ATTACK_AREA_TEXT = Object.freeze({
    'AREA.TITLE': 'Area of effect', 'AREA.CIRCLE': 'Blast / circle', 'AREA.SPRAY': 'Spray / cone',
    'AREA.SUPPRESSION': 'Suppressing fire / cone', 'AREA.KIND': 'Area type',
    'AREA.DISTANCE': 'Radius / length (scene units)', 'AREA.ANGLE': 'Cone angle (degrees)',
    'AREA.ROTATION': 'Direction (degrees)', 'AREA.X': 'Origin X (pixels)', 'AREA.Y': 'Origin Y (pixels)',
    'AREA.NEXT': 'Review targets', 'AREA.CONFIRM': 'Confirm targets', 'AREA.CANCEL': 'Cancel',
    'AREA.REVIEW': 'Review affected targets', 'AREA.WARNING': 'Geometry only: review walls, cover, elevation and scatter. No damage or conditions are applied here.',
    'AREA.NONE': 'No visible targets intersect this area.', 'AREA.STALE': 'The scene or tokens changed. Review the area again.',
    'AREA.NO_PERMISSION': 'You cannot create Regions. Target selection is available without placing a marker.',
    'AREA.CREATE_FAILED': 'The Region could not be created. Target selection was retained.',
    'AREA.PLACE_MARKER': 'Place a visible area marker', 'AREA.ALLIES': 'Allies may also be inside the area; review every target.'
});
const EPSILON = 1e-7;
const radians = degrees => degrees * Math.PI / 180;
const degrees = radians => radians * 180 / Math.PI;
const normalize = angle => ((angle % 360) + 360) % 360;
const doc = value => value?.document ?? value;
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const list = value => typeof value === 'function' ? list(value())
    : value?.contents ?? (typeof value?.values === 'function' ? [...value.values()] : [...(value ?? [])]);

function positive(value, label) {
    const result = Number(value);
    if (!Number.isFinite(result) || result <= 0) throw Error(`Invalid ${label}`);
    return result;
}
function finite(value, label) {
    const result = Number(value);
    if (!Number.isFinite(result)) throw Error(`Invalid ${label}`);
    return result;
}
function sceneUuid(scene) { return scene?.uuid ?? (scene?.id ? `Scene.${scene.id}` : null); }
function tokenUuid(token, scene) {
    const document = doc(token);
    return document?.uuid ?? (document?.id && sceneUuid(scene) ? `${sceneUuid(scene)}.Token.${document.id}` : null);
}
function belongsToScene(token, scene) {
    const document = doc(token), parent = document?.parent ?? token?.scene;
    return !!document?.id && !!parent && (parent === scene || sceneUuid(parent) === sceneUuid(scene));
}
function tokenBounds(token, scene) {
    const document = doc(token), size = positive(scene?.grid?.size, 'grid size');
    // Token rotation turns its artwork, not the occupied footprint. Bounds use
    // the rendered footprint when present and document dimensions otherwise.
    const bounds = token?.bounds;
    return {
        x: finite(bounds?.x ?? document?.x, 'token x'), y: finite(bounds?.y ?? document?.y, 'token y'),
        width: positive(bounds?.width ?? Number(document?.width) * size, 'token width'),
        height: positive(bounds?.height ?? Number(document?.height) * size, 'token height')
    };
}
function visibleTo(token, user) {
    if (user?.isGM) return true;
    const document = doc(token), object = token?.document ? token : document?.object;
    // A server document alone cannot establish what a player sees through fog.
    // Only rendered, currently visible token objects are offered to players.
    return document?.hidden !== true && !!object && object.visible === true;
}
function sourcePermission(token, user) {
    const document = doc(token), actor = token?.actor ?? document?.actor;
    return !!user && (user.isGM || actor?.testUserPermission?.(user, 'OWNER') === true
        || actor?.isOwner === true && (!globalThis.game?.user || globalThis.game.user.id === user.id));
}

/** Build one valid Foundry14 circle/cone shape. All user lengths are scene distance units. */
export function buildAttackArea({kind = 'blast', origin, distance, angle = 45, rotation = 0, grid} = {}) {
    if (!['blast', 'spray', 'suppression'].includes(kind)) throw Error('Unsupported attack area');
    const pixelsPerUnit = positive(grid?.size, 'grid size') / positive(grid?.distance, 'grid distance');
    const shape = {type: kind === 'blast' ? 'circle' : 'cone',
        x: finite(origin?.x, 'origin x'), y: finite(origin?.y, 'origin y'),
        radius: positive(distance, 'area distance') * pixelsPerUnit, gridBased: false};
    if (shape.type === 'cone') {
        shape.angle = positive(angle, 'cone angle');
        if (shape.angle > 360) throw Error('Cone angle cannot exceed 360');
        shape.rotation = normalize(finite(rotation, 'rotation'));
        shape.curvature = 'round';
    }
    return {version: 1, kind, distance: Number(distance), units: grid?.units ?? '', shape};
}

/** Infer a weapon's area without applying its effects. Explicit caller options can
 * replace these dimensions in the review. Suppression uses the native 45° zone;
 * Spray uses the configurable angle passed by the book-aware caller.
 */
export function attackAreaDefaults(rollData, {sprayAngle = 30} = {}) {
    const weapon=rollData?.weapon??{},traits=weapon.traits??{};
    if (rollData?.attackType?.name==='suppression' && Number(weapon.range)>0)
        return {kind:'suppression',distance:Number(weapon.range),angle:45};
    if (Number(traits.blast)>0) return {kind:'blast',distance:Number(traits.blast)};
    if ((traits.skipAttackRoll===true || traits.spray===true) && Number(weapon.range)>0)
        return {kind:'spray',distance:Number(weapon.range),angle:positive(sprayAngle,'spray angle')};
    return null;
}

function inRect(point, rectangle) {
    return point.x >= rectangle.x - EPSILON && point.x <= rectangle.x + rectangle.width + EPSILON
        && point.y >= rectangle.y - EPSILON && point.y <= rectangle.y + rectangle.height + EPSILON;
}
function inAngle(shape, point) {
    if (shape.type === 'circle' || shape.angle >= 360) return true;
    const delta = normalize(degrees(Math.atan2(point.y - shape.y, point.x - shape.x)) - shape.rotation + 180) - 180;
    return Math.abs(delta) <= shape.angle / 2 + EPSILON;
}
function inArea(shape, point) {
    const dx = point.x - shape.x, dy = point.y - shape.y;
    if (dx * dx + dy * dy <= EPSILON * EPSILON) return true;
    return dx * dx + dy * dy <= shape.radius * shape.radius + EPSILON && inAngle(shape, point);
}
function segmentRect(start, end, rectangle) {
    // Liang–Barsky, including tangencies and zero-length edges.
    let low = 0, high = 1;
    const dx = end.x - start.x, dy = end.y - start.y;
    const checks = [[-dx, start.x - rectangle.x], [dx, rectangle.x + rectangle.width - start.x],
        [-dy, start.y - rectangle.y], [dy, rectangle.y + rectangle.height - start.y]];
    for (const [p, q] of checks) {
        if (Math.abs(p) <= EPSILON) {if (q < -EPSILON) return false; continue;}
        const t = q / p;
        if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low > high + EPSILON) return false;
    }
    return true;
}

/** Exact intersection of a rectangular token footprint with a circular sector.
 * Arc intersections catch large tokens whose centres and corners are outside.
 */
export function areaIntersectsRectangle(area, rectangle) {
    const shape = area?.shape ?? area;
    if (!shape || !['circle', 'cone'].includes(shape.type)) throw Error('Unsupported area shape');
    const r = {x: finite(rectangle?.x, 'rectangle x'), y: finite(rectangle?.y, 'rectangle y'),
        width: positive(rectangle?.width, 'rectangle width'), height: positive(rectangle?.height, 'rectangle height')};
    const nearest = {x: Math.max(r.x, Math.min(shape.x, r.x + r.width)),
        y: Math.max(r.y, Math.min(shape.y, r.y + r.height))};
    if ((nearest.x - shape.x) ** 2 + (nearest.y - shape.y) ** 2 > shape.radius ** 2 + EPSILON) return false;
    if (shape.type === 'circle' || shape.angle >= 360) return true;
    if (inRect({x: shape.x, y: shape.y}, r)) return true;
    const corners = [{x:r.x,y:r.y}, {x:r.x+r.width,y:r.y},
        {x:r.x+r.width,y:r.y+r.height}, {x:r.x,y:r.y+r.height}];
    if (corners.some(point => inArea(shape, point))) return true;
    for (const sign of [-1, 1]) {
        const theta = radians(shape.rotation + sign * shape.angle / 2);
        if (segmentRect({x:shape.x,y:shape.y}, {x:shape.x+Math.cos(theta)*shape.radius,
            y:shape.y+Math.sin(theta)*shape.radius}, r)) return true;
    }
    const arc = [];
    for (const x of [r.x, r.x + r.width]) {
        const square = shape.radius ** 2 - (x - shape.x) ** 2;
        if (square >= -EPSILON) for (const sign of [-1, 1]) arc.push({x,y:shape.y+sign*Math.sqrt(Math.max(0,square))});
    }
    for (const y of [r.y, r.y + r.height]) {
        const square = shape.radius ** 2 - (y - shape.y) ** 2;
        if (square >= -EPSILON) for (const sign of [-1, 1]) arc.push({x:shape.x+sign*Math.sqrt(Math.max(0,square)),y});
    }
    return arc.some(point => inRect(point, r) && inAngle(shape, point));
}

/** Fresh candidate list. Entries use Token UUIDs, never actor names/IDs for identity. */
export function collectAreaTargets({area, scene, tokens, sourceToken, user = globalThis.game?.user,
    includeSource = area?.kind === 'blast'} = {}) {
    if (!sceneUuid(scene)) throw Error('A scene is required');
    const source = tokenUuid(sourceToken, scene), seen = new Set();
    return list(tokens ?? scene.tokens).filter(token => {
        const uuid = tokenUuid(token, scene);
        if (!uuid || seen.has(uuid) || !belongsToScene(token, scene) || (!includeSource && uuid === source)
            || !visibleTo(token, user) || !(token?.actor ?? doc(token)?.actor)) return false;
        seen.add(uuid);
        return areaIntersectsRectangle(area, tokenBounds(token, scene));
    }).map(token => {
        const document = doc(token);
        return {tokenId:document.id, tokenUuid:tokenUuid(token, scene), sceneId:scene.id,
            name:token.name ?? document.name ?? '', actorUuid:(token.actor ?? document.actor)?.uuid ?? null,
            elevation:Number(document.elevation) || 0, hidden:document.hidden === true};
    });
}

function reviewFingerprint({area, scene, tokens, sourceToken, user, includeSource}) {
    const visible = list(tokens ?? scene.tokens).filter(token => belongsToScene(token,scene) && visibleTo(token,user));
    const state = visible.map(token => ({uuid:tokenUuid(token,scene), ...tokenBounds(token,scene),
        elevation:doc(token).elevation ?? 0, hidden:doc(token).hidden === true,
        actorUuid:(token.actor ?? doc(token).actor)?.uuid ?? null})).sort((a,b)=>a.uuid.localeCompare(b.uuid));
    return JSON.stringify({scene:sceneUuid(scene),grid:{size:scene.grid?.size,distance:scene.grid?.distance,units:scene.grid?.units,type:scene.grid?.type},
        area,source:{uuid:tokenUuid(sourceToken,scene),...tokenBounds(sourceToken,scene)},
        includeSource:includeSource??area?.kind==='blast',gm:!!user?.isGM,state});
}

/** Capture candidates and a source/scene snapshot before the user reviews them. */
export function captureAreaReview(options) {
    const {scene,sourceToken,user=globalThis.game?.user}=options;
    if (!belongsToScene(sourceToken,scene) || !sourcePermission(sourceToken,user)) throw Error('No permission to operate the source token');
    return {version:1, sceneUuid:sceneUuid(scene), sourceTokenUuid:tokenUuid(sourceToken,scene),
        area:structuredClone(options.area), targets:collectAreaTargets({...options,user}),
        fingerprint:reviewFingerprint({...options,user})};
}

/** Validate a review against CURRENT tokens. Moved/new/hidden targets require a new review. */
export function finalizeAreaReview(review, selectedTokenUuids, options) {
    const current=captureAreaReview({...options,area:review.area});
    if (review.fingerprint!==current.fingerprint) return {status:'stale',targets:[]};
    const selected=new Set(selectedTokenUuids);
    const allowed=new Map(current.targets.map(target=>[target.tokenUuid,target]));
    if ([...selected].some(uuid=>!allowed.has(uuid))) return {status:'invalid-target',targets:[]};
    return {status:'confirmed',area:current.area,targets:current.targets.filter(target=>selected.has(target.tokenUuid)),
        sourceTokenUuid:current.sourceTokenUuid,sceneUuid:current.sceneUuid,
        review:{walls:false,cover:false,elevation:false,scatter:false}};
}

/** Persist a marker only after review. Refusal never changes permissions or creates fallback documents. */
export async function createAttackArea({area, scene, sourceToken, user=globalThis.game?.user,
    name='Area of effect', itemId=null, regionClass=globalThis.CONFIG?.Region?.documentClass,
    visibility=globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 2}={}) {
    if (!belongsToScene(sourceToken,scene) || !sourcePermission(sourceToken,user)) return {status:'no-permission',region:null};
    const canCreate=regionClass?.canUserCreate ? regionClass.canUserCreate(user) : user?.hasPermission?.('REGION_CREATE')===true;
    if (!canCreate) return {status:'no-permission',region:null};
    try {
        const [region]=await scene.createEmbeddedDocuments('Region',[{
            name, color:user?.color?.css ?? '#c29437', visibility,
            shapes:[structuredClone(area.shape)], behaviors:[],
            flags:{'dark-heresy':{attackArea:{version:1,kind:area.kind,sourceTokenUuid:tokenUuid(sourceToken,scene),itemId}}}
        }]);
        return {status:region?'created':'failed',region:region??null};
    } catch(error) {return {status:'failed',region:null,error};}
}

/** Configuration + explicit candidate confirmation. Parent applies returned targets to its roll.
 * No world writes occur before confirmation; marker failure does not discard reviewed targets.
 */
export async function openAttackAreaReview({scene=globalThis.canvas?.scene, sourceToken,
    tokens, user=globalThis.game?.user, kind='blast', distance=3,
    angle=45, rotation, origin, aimToken, name, itemId, includeSource, localize, Dialog=globalThis.foundry?.applications?.api?.DialogV2,
    notify=globalThis.ui?.notifications}={}) {
    const text=key=>{const value=localize?.(key)??globalThis.game?.i18n?.localize?.(key);
        return value&&value!==key?value:ATTACK_AREA_TEXT[key]??key;};
    const options={scene,sourceToken,user,tokens,includeSource};
    if (!belongsToScene(sourceToken,scene) || !sourcePermission(sourceToken,user)) return {status:'no-permission',targets:[]};
    const bounds=tokenBounds(sourceToken,scene), center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    const targetBounds=aimToken&&belongsToScene(aimToken,scene)&&visibleTo(aimToken,user)?tokenBounds(aimToken,scene):null;
    const targetCenter=targetBounds?{x:targetBounds.x+targetBounds.width/2,y:targetBounds.y+targetBounds.height/2}:null;
    const initialOrigin=origin??(kind==='blast'&&targetCenter?targetCenter:center);
    const initialRotation=rotation??(targetCenter?degrees(Math.atan2(targetCenter.y-center.y,targetCenter.x-center.x)):doc(sourceToken).rotation??0);
    const input=(field,label,value,extra='')=>`<label>${escape(text(label))}<input name="${field}" type="number" value="${escape(value)}" ${extra}></label>`;
    const configured=await Dialog.prompt({window:{title:text('AREA.TITLE')},modal:true,rejectClose:false,
        content:`<div class="dh-dialog dh-attack-area"><label>${escape(text('AREA.KIND'))}<select name="kind">${['blast','spray','suppression'].map(value=>`<option value="${value}" ${value===kind?'selected':''}>${escape(text(value==='blast'?'AREA.CIRCLE':value==='spray'?'AREA.SPRAY':'AREA.SUPPRESSION'))}</option>`).join('')}</select></label>
        ${input('distance','AREA.DISTANCE',distance,'min="0.01" step="any"')}${input('angle','AREA.ANGLE',angle,'min="0.01" max="360" step="any"')}
        ${input('rotation','AREA.ROTATION',initialRotation,'step="any"')}${input('x','AREA.X',initialOrigin.x,'step="any"')}${input('y','AREA.Y',initialOrigin.y,'step="any"')}
        <p>${escape(text('AREA.WARNING'))}</p></div>`,
        ok:{label:text('AREA.NEXT'),callback:(_event,button)=>{const fields=button.form.elements;
            return buildAttackArea({kind:fields.kind.value,distance:fields.distance.value,angle:fields.angle.value,
                rotation:fields.rotation.value,origin:{x:fields.x.value,y:fields.y.value},grid:scene.grid});}}});
    if (!configured) return {status:'cancelled',targets:[]};
    const review=captureAreaReview({...options,area:configured});
    const selected=await Dialog.prompt({window:{title:text('AREA.REVIEW')},modal:true,rejectClose:false,
        content:`<div class="dh-dialog dh-attack-area"><p>${escape(text('AREA.WARNING'))}</p><p>${escape(text('AREA.ALLIES'))}</p>
        ${review.targets.length?review.targets.map((target,index)=>`<label><input type="checkbox" name="target-${index}" checked>${escape(target.name)} (${escape(target.elevation)})</label>`).join(''):`<p>${escape(text('AREA.NONE'))}</p>`}
        <label><input type="checkbox" name="marker" checked>${escape(text('AREA.PLACE_MARKER'))}</label></div>`,
        ok:{label:text('AREA.CONFIRM'),callback:(_event,button)=>({uuids:review.targets.filter((_target,index)=>button.form.elements[`target-${index}`]?.checked).map(target=>target.tokenUuid),marker:button.form.elements.marker.checked})}});
    if (!selected) return {status:'cancelled',targets:[]};
    const result=finalizeAreaReview(review,selected.uuids,options);
    if (result.status!=='confirmed') {notify?.warn?.(text('AREA.STALE'));return result;}
    if (selected.marker) {
        const marker=await createAttackArea({area:result.area,scene,sourceToken,user,name:name??text('AREA.TITLE'),itemId});
        result.regionUuid=marker.region?.uuid??null;result.markerStatus=marker.status;
        if (marker.status!=='created') notify?.warn?.(text(marker.status==='no-permission'?'AREA.NO_PERMISSION':'AREA.CREATE_FAILED'));
    }
    return result;
}
