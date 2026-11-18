/** Display-only focus; saved layer visibility choices survive inspection. */
export function createLayerInspection(copperLayers){
 const copper=new Set(copperLayers),enabled=new Map([...copper,'F.SilkS','B.SilkS'].map(name=>[name,true]));let focused=null,parts=true;
 return {focus(name){if(name&&!copper.has(name))throw Error('Layer is not present in this saved board.');focused=name||null;return focused;},get:()=>focused,
 setLayer(name,visible){if(!enabled.has(name))throw Error('Unknown saved display layer.');enabled.set(name,Boolean(visible));},setParts(value){parts=Boolean(value);},
 visible(name){return focused?name===focused:enabled.get(name)!==false;},partsVisible:()=>parts&&!focused,substrateOpacity:()=>focused ? .08 : 1};
}
