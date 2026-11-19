/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */
/** Mount-local reuse only. The scene resource owner disposes geometries. */
export function createSharedGeometryCache(limit=512){
 if(!Number.isInteger(limit)||limit<0||limit>4096)throw new TypeError('Choose a bounded geometry cache size.');
 const geometries=new Map();let hits=0,uncached=0;
 return {get(key,create){if(geometries.has(key)){hits++;return geometries.get(key);}const geometry=create();if(geometries.size<limit)geometries.set(key,geometry);else uncached++;return geometry;},clear(){geometries.clear();},stats(){return {entries:geometries.size,hits,uncached};}};
}
