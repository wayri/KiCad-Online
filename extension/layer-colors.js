/* KiCad Default layer RGB/alpha data, checked against KiCad 10 and upstream defaults.
 * Reference: https://docs.kicad.org/doxygen/builtin__color__themes_8h_source.html
 * Independent lookup API; no KiCad executable or user configuration is required. */
((root)=>{'use strict';
 const entries = {"F.Cu":["#c83434",1],"B.Cu":["#4d7fc4",1],"In1.Cu":["#7fc87f",1],"In2.Cu":["#ce7d2c",1],"In3.Cu":["#4fcbcb",1],"In4.Cu":["#db628b",1],"In5.Cu":["#a7a5c6",1],"In6.Cu":["#28ccd9",1],"In7.Cu":["#e8b2a7",1],"In8.Cu":["#f2eda1",1],"In9.Cu":["#8dcb81",1],"In10.Cu":["#ed7c33",1],"In11.Cu":["#5bc3eb",1],"In12.Cu":["#f76f8e",1],"In13.Cu":["#a7a5c6",1],"In14.Cu":["#28ccd9",1],"In15.Cu":["#e8b2a7",1],"In16.Cu":["#f2eda1",1],"In17.Cu":["#ed7c33",1],"In18.Cu":["#5bc3eb",1],"In19.Cu":["#f76f8e",1],"In20.Cu":["#a7a5c6",1],"In21.Cu":["#28ccd9",1],"In22.Cu":["#e8b2a7",1],"In23.Cu":["#f2eda1",1],"In24.Cu":["#ed7c33",1],"In25.Cu":["#5bc3eb",1],"In26.Cu":["#f76f8e",1],"In27.Cu":["#a7a5c6",1],"In28.Cu":["#28ccd9",1],"In29.Cu":["#e8b2a7",1],"In30.Cu":["#f2eda1",1],"F.Adhes":["#840084",1],"B.Adhes":["#000084",1],"F.Paste":["#b4a09a",0.9],"B.Paste":["#00c2c2",0.9],"F.SilkS":["#f2eda1",1],"B.SilkS":["#e8b2a7",1],"F.Mask":["#d864ff",0.4],"B.Mask":["#02ffee",0.4],"F.Fab":["#afafaf",1],"B.Fab":["#585d84",1],"F.CrtYd":["#ff26e2",1],"B.CrtYd":["#26e9ff",1],"Edge.Cuts":["#d0d2cd",1],"Margin":["#ff26e2",1],"Dwgs.User":["#c2c2c2",1],"Cmts.User":["#5994dc",1],"Eco1.User":["#b4dbd2",1],"Eco2.User":["#d8c852",1],"User.1":["#c2c2c2",1],"User.2":["#5994dc",1],"User.3":["#b4dbd2",1],"User.4":["#d8c852",1],"User.5":["#c2c2c2",1],"User.6":["#5994dc",1],"User.7":["#b4dbd2",1],"User.8":["#d8c852",1],"User.9":["#e8b2a7",1],"User.10":["#5994dc",1],"User.11":["#b4dbd2",1],"User.12":["#d8c852",1],"User.13":["#c2c2c2",1],"User.14":["#5994dc",1],"User.15":["#b4dbd2",1],"User.16":["#d8c852",1],"User.17":["#c2c2c2",1],"User.18":["#5994dc",1],"User.19":["#b4dbd2",1],"User.20":["#d8c852",1],"User.21":["#c2c2c2",1],"User.22":["#5994dc",1],"User.23":["#b4dbd2",1],"User.24":["#d8c852",1],"User.25":["#c2c2c2",1],"User.26":["#5994dc",1],"User.27":["#b4dbd2",1],"User.28":["#d8c852",1],"User.29":["#c2c2c2",1],"User.30":["#5994dc",1],"User.31":["#b4dbd2",1],"User.32":["#d8c852",1],"User.33":["#c2c2c2",1],"User.34":["#5994dc",1],"User.35":["#b4dbd2",1],"User.36":["#d8c852",1],"User.37":["#c2c2c2",1],"User.38":["#5994dc",1],"User.39":["#b4dbd2",1],"User.40":["#d8c852",1],"User.41":["#c2c2c2",1],"User.42":["#5994dc",1],"User.43":["#b4dbd2",1],"User.44":["#d8c852",1],"User.45":["#c2c2c2",1]};
 for(const value of Object.values(entries))Object.freeze(value);Object.freeze(entries);
 const hexFor=layer=>entries[String(layer)]?.[0]||'#c2c2c2';
 const opacityFor=layer=>entries[String(layer)]?.[1]??1;
 const colorFor=layer=>{const hex=hexFor(layer),a=opacityFor(layer);return a===1?hex:`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;};
 // Presentation hues keep the familiar front-red/back-blue identities while
 // avoiding neon masks and muddy low-contrast copper on each canvas theme.
 // The native lookup above remains available for source/default comparisons.
 const reviewDark=Object.freeze({'F.Cu':'#fa6f68','B.Cu':'#63a5ff','F.SilkS':'#e8dcae','B.SilkS':'#b5c8df','F.Fab':'#b2bbc9','B.Fab':'#8d9ab0','F.CrtYd':'#c59be0','B.CrtYd':'#7bc6cf','Edge.Cuts':'#d6deea','F.Mask':'#b197d7','B.Mask':'#77bdb5','F.Paste':'#d2afa0','B.Paste':'#98c9ce'});
 const reviewLight=Object.freeze({'F.Cu':'#b9474c','B.Cu':'#3268ae','F.SilkS':'#766126','B.SilkS':'#596a87','F.Fab':'#647086','B.Fab':'#606c83','F.CrtYd':'#8c519e','B.CrtYd':'#257b85','Edge.Cuts':'#465368','F.Mask':'#9279b8','B.Mask':'#4d968a','F.Paste':'#9d796a','B.Paste':'#448b93'});
 function reviewColorFor(layer,dark=true){
  const hex=(dark?reviewDark:reviewLight)[String(layer)]||hexFor(layer),alpha=opacityFor(layer);
  return alpha===1?hex:`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
 }
 // Context keeps only eight percent of the layer hue; selected copper uses
 // reviewColorFor unchanged. Fixed neutral anchors keep both themes readable.
 function contextColorFor(layer,dark=true){
  const hex=(dark?reviewDark:reviewLight)[String(layer)]||hexFor(layer),base=dark?[135,145,155]:[115,123,131];
  return '#'+base.map((value,index)=>Math.round(value*.92+parseInt(hex.slice(1+index*2,3+index*2),16)*.08).toString(16).padStart(2,'0')).join('');
 }
 function fabricationLayer(role){
  const text=String(role||'').toLowerCase(),bottom=/bottom|\bbot\b/.test(text),side=bottom?'B.':'F.';
  if(/drill|plated/.test(text))return null;
  if(/outline|profile/.test(text))return 'Edge.Cuts';
  if(/copper/.test(text)){if(/inner|inr/.test(text)){const match=/copper,\s*l(\d+),\s*inr/.exec(text),named=/inner copper\s*(\d+)/.exec(text);const n=match?Number(match[1])-1:named?Number(named[1]):0;return n>=1&&n<=30?'In'+n+'.Cu':null;}return side+'Cu';}
  if(/mask/.test(text))return side+'Mask';
  if(/silk|legend/.test(text))return side+'SilkS';
  if(/paste/.test(text))return side+'Paste';return null;
 }
 const api=Object.freeze({entries,hexFor,opacityFor,colorFor,reviewColorFor,contextColorFor,fabricationLayer});root.KiCadLayerColors=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
