/* Original, compact circuit-review icons. No external font or icon dependency. */
((root)=>{
  'use strict';
  const paths={
    'rotate-cw':'M20 3v6h-6 M20 9a8 8 0 1 0 0 7 M9 10h5v5H9z',
    'rotate-ccw':'M4 3v6h6 M4 9a8 8 0 1 1 0 7 M9 10h5v5H9z',
    'net-instances':'M2 3h8v7H2z M14 3h8v7h-8z M8 15h8v7H8z M6 10v2h12v-2 M12 12v3',
    'native-kicad':'M4 3h8v4H8v10h4v4H4z M14 8l7 4-7 4z',
    repository:'M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M5 7v10 M5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M19 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M19 7v3a5 5 0 0 1-5 5H5',
    dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    draftsman:'M3 3h14l4 4v14H3z M17 3v5h4 M6 16h12 M8 13v6m8-6v6 M7 7h6',
    'fast-pi':'M13 2 5 13h6l-1 9 9-13h-6z',
    download:'M4 16v5h16v-5 M12 3v12m-5-5 5 5 5-5',
    history:'M3 4v6h6 M4 9a8 8 0 1 1 0 7 M12 7v6l4 2',
    analytics:'M3 3v18h18 M7 17v-5h3v5 M12 17V7h3v10 M17 17v-8h3v8',
    star:'m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
    bookmark:'M6 3h12v19l-6-4-6 4z',
    folder:'M3 6h7l2 3h9v11H3z M3 6V4h7l2 2',
    cloud:'M7 18H5a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 2 10h-2 M12 12v10m-3-3 3 3 3-3',
    account:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21v-3a8 8 0 0 1 16 0v3',
    menu:'M4 6h16M4 12h16M4 18h16',
    compare:'M6 3v18M18 3v18 M3 7l3-3 3 3M15 17l3 3 3-3 M6 12h12',
    refresh:'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 14-2l1 1M4 17l1 1a8 8 0 0 0 14-2',
    send:'M3 3l18 9-18 9 4-9z M7 12h14',
    back:'M19 12H5m6-6-6 6 6 6',forward:'M5 12h14m-6-6 6 6-6 6',up:'M12 19V5m-6 6 6-6 6 6',home:'M3 11 12 3l9 8 M5 10v11h14V10 M10 21v-7h4v7',
    gear:'M19.11 9.05 L21.78 9.92 L21.78 14.08 L19.11 14.95 L19.11 14.95 L20.39 17.45 L17.45 20.39 L14.95 19.11 L14.95 19.11 L14.08 21.78 L9.92 21.78 L9.05 19.11 L9.05 19.11 L6.55 20.39 L3.61 17.45 L4.89 14.95 L4.89 14.95 L2.22 14.08 L2.22 9.92 L4.89 9.05 L4.89 9.05 L3.61 6.55 L6.55 3.61 L9.05 4.89 L9.05 4.89 L9.92 2.22 L14.08 2.22 L14.95 4.89 L14.95 4.89 L17.45 3.61 L20.39 6.55 L19.11 9.05z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    rules:'M12 3 22 21H2z M12 9v5m0 3v1',
    erc:'M3 12h4l3-7 4 14 3-7h4 M18 3h3v3',
    drc:'M3 5h6v6H3z M15 13h6v6h-6z M9 8h8v5 M5 21l3-3 3 3 M13 3h7',
    eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'eye-off':'M3 3l18 18 M9 5.5A11 11 0 0 1 12 5c6 0 10 7 10 7a20 20 0 0 1-4 4 M6 7a20 20 0 0 0-4 5s4 7 10 7a11 11 0 0 0 4-1 M10 10a3 3 0 0 0 4 4',
    calculator:'M5 2h14v20H5z M8 5h8v4H8z M8 13h1m3 0h1m3 0h1M8 17h1m3 0h1m3 0h1',
    pdf:'M5 2h10l4 4v16H5z M15 2v5h4 M8 17l2-7 3 7m-4-2h7',
    tools:'M14 3a6 6 0 0 0-5 8L3 17a2.8 2.8 0 0 0 4 4l6-6a6 6 0 0 0 8-5l-4 3-4-4 3-5-2-1z',
    copy:'M8 8h13v13H8z M16 8V3H3v13h5',
    text:'M3 5h18M12 5v15m-4 0h8',
    save:'M3 3h15l3 3v15H3z M7 3v6h10V3 M7 21v-8h10v8',
    board:'M4 3h13l3 3v14H4z M7 7h7v7H7z M17 9h1m-1 3h1M8 17h6 M2 6h2M2 10h2M2 14h2',
    unfitted:'M7 7h10v10H7z M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4 M3 3l18 18',
    parts:'M7 7h10v10H7z M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
    maximize:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
    restore:'M3 8h5V3 M16 3v5h5 M8 21v-5H3 M21 16h-5v5',
    sheets:'M3 4h6l2 2h10v15H3z M7 10h10 M7 14h10 M7 18h6',
    fit:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6 M8 8h8v8H8z',
    page:'M6 2h9l4 4v16H6z M15 2v5h4 M9 16h7m-7 3h7M9 10h4',
    undo:'M8 5 3 10l5 5M3 10h11a6 6 0 0 1 6 6v3',
    redo:'m16 5 5 5-5 5M21 10H10a6 6 0 0 0-6 6v3',
    magnet:'M5 4v8a7 7 0 0 0 14 0V4h-4v8a3 3 0 0 1-6 0V4zM5 8h4m6-4v4h4',
    plus:'M5 12h14M12 5v14', minus:'M5 12h14',
    inspect:'M4 4h16v16H4z M9 4v16m3-11h5m-5 4h5m-5 4h3',
    comment:'M3 4h18v12H9l-5 4v-4H3z M7 8h10m-10 4h7',
    ruler:'M3 16 16 3l5 5L8 21z M7 12l3 3m0-6 3 3m0-6 3 3',
    grid:'M4 4h16v16H4z M4 9h16M4 15h16M9 4v16M15 4v16',
    flip:'M3 5h7v14H3z M15 5h6v14h-6 M12 2v20 M16 9l3 3-3 3',
    cube:'m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5M12 12v10',
    theme:'M12 3a9 9 0 1 0 9 9c-6 2-11-3-9-9z',
    settings:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M10 15v6',
    area:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6 M8 11h8m-4-4v8',
    camera:'M3 7h5l2-3h4l2 3h5v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    assembly:'M4 7h16v13H4z M8 7V4h8v3 M8 11v5m4-5v5m4-5v5',
    import:'M4 14v6h16v-6 M12 3v12m-4-4 4 4 4-4',
    close:'M6 6l12 12M18 6 6 18',
    net:'M4 5h5v5H4z M15 14h5v5h-5z M6.5 10v6.5H15 M17.5 14V7H9',
    layers:'m12 3 10 5-10 5L2 8z M2 12l10 5 10-5M2 16l10 5 10-5',
    search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z M15 15l6 6',
    sheet:'M3 3h12v13H3z M9 16v5h12V9h-6 M6 7h6m-6 4h4',
    help:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4 M12 17h.01',
    info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 11v6M12 7v1',
    pin:'M8 3h8v8H8z M12 11v10M5 15h14',
    track:'M3 18h6V6h12 M3 16v4M19 4h3v4',
    link:'M9 15 15 9M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0'
  };
  const brands={"github":{"viewBox":"0 0 98 96","paths":[{"d":"M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z","fill":"currentColor"}]},"gitlab":{"viewBox":"110 110 160 160","paths":[{"d":"M265.26416,174.37243l-.2134-.55822-21.19899-55.30908c-.4236-1.08359-1.18542-1.99642-2.17699-2.62689-.98837-.63373-2.14749-.93253-3.32305-.87014-1.1689.06239-2.29195.48925-3.20809,1.21821-.90957.73554-1.56629,1.73047-1.87493,2.85346l-14.31327,43.80662h-57.90965l-14.31327-43.80662c-.30864-1.12299-.96536-2.11791-1.87493-2.85346-.91614-.72895-2.03911-1.15582-3.20809-1.21821-1.17548-.06239-2.33468.23641-3.32297.87014-.99166.63047-1.75348,1.5433-2.17707,2.62689l-21.19891,55.31237-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392,15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024,32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z","fill":"#e24329"},{"d":"M265.26416,174.37243l-.2134-.55822c-10.5174,2.16062-20.20405,6.6099-28.49844,12.81593-.1346.0985-25.20497,19.05805-46.55171,35.19699,15.84998,11.98517,29.6477,22.40405,29.6477,22.40405l32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z","fill":"#fc6d26"},{"d":"M160.34962,244.23117l15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024s-13.79772-10.41888-29.6477-22.40405c-15.85327,11.98517-29.65099,22.40405-29.65099,22.40405Z","fill":"#fca326"},{"d":"M143.44561,186.63014c-8.29111-6.20274-17.97446-10.65531-28.49507-12.81264l-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392s13.79772-10.41888,29.65099-22.40405c-21.34673-16.13894-46.42031-35.09848-46.55499-35.19699Z","fill":"#fc6d26"}]}};
  function icon(name){if(brands[name]){const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox",brands[name].viewBox);svg.setAttribute("class","ui-icon ui-brand ui-brand-"+name);svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");for(const entry of brands[name].paths){const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",entry.d);path.setAttribute("fill",entry.fill);svg.append(path);}return svg;}const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','ui-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.parts);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.6');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;}
  function decorate(scope=document){const nodes=[...(scope.matches?.('[data-icon]')?[scope]:[]),...scope.querySelectorAll('[data-icon]')];for(const node of nodes){const name=node.dataset.icon,existing=node.querySelector('svg');if(existing){if(node.dataset.uiIcon&&node.dataset.uiIcon!==name){existing.replaceWith(icon(name));node.dataset.uiIcon=name;}continue;}if(node.tagName==='BUTTON'){const label=document.createElement('span');label.className='button-label';label.textContent=node.textContent;if(!node.hasAttribute('aria-label'))node.setAttribute('aria-label',label.textContent.trim());node.replaceChildren(icon(name),label);}else node.prepend(icon(name));node.dataset.uiIcon=name;}}
  function label(node,text){const span=node.querySelector('.button-label');if(span)span.textContent=text;else node.textContent=text;}
  root.KiCadUIIcons={icon,decorate,label};
  // Only decorate simple action labels. Never replace inputs, connection badges,
  // rich file rows, or existing icons; original button nodes and handlers survive.
  const actions={
    'Present project':['page','Present project'],'Create slides':['sheet','Create slides'],
    'File features':['info','File features'],'3D':['cube','3D'],'Ratsnest':['net','Ratsnest'],
    'Project':['folder','Project'],'Schematic':['sheet','Schematic'],'Layout':['board','Layout'],
    'Overview':['inspect','Overview'],'All settings':['settings','Settings'],'Constraints & rules':['rules','Rules'],
    'Stackup':['layers','Stackup'],'Gerbers & drills':['layers','Fabrication'],'Saved source':['page','Source'],
    'Open drawing':['board','Open'],'View board setup':['settings','Board setup'],'Refresh structure':['refresh','Refresh'],
    'Light / dark':['theme','Theme'],'Hide project files':['folder','Files'],'Show project files':['folder','Files'],
    'Menu':['menu','Menu'],'Views':['compare','Views'],'Close':['close','Close'],
    'Open a project folder':['folder','Open folder'],'Open a file':['page','Open file'],
    'Open files':['page','Files'],'Open folder':['folder','Folder'],'Drive / cloud file':['cloud','Drive / cloud'],
    'GitHub projects':['github','GitHub'],'GitLab projects':['gitlab','GitLab'],
    'Sign in with GitHub':['github','Sign in'],'Sign in with GitLab':['gitlab','Sign in'],
    'Sign out':['account','Sign out'],'Connect GitLab':['gitlab','Connect'],
    'My projects':['folder','My projects'],'My repositories':['folder','Repositories'],
    'Add and open project':['plus','Add project'],'Cancel sign-in':['close','Cancel'],
    'Load more repositories':['plus','More'],'More projects':['plus','More'],
    'Export comments':['import','Export'],'Import comments':['folder','Import'],
    'Capture area':['camera','Capture'],'Remove image':['close','Remove image'],
    'Issue':['rules','Issue'],'Discussion':['comment','Discussion'],
    'Settings, constraints and stackup':['settings','Project settings'],'Download an offline copy':['import','Download'],'Bookmark project':['bookmark','Bookmark'],'Save offline in app':['import','Save offline'],'Your projects':['folder','Library'],'Export project ZIP':['import','Export ZIP'],
    'Download project to device':['import','Download project'],'Open from Drive or cloud storage':['cloud','Drive / cloud'],
    'Sheets and parts':['sheet','Explorer'],'Properties':['inspect','Properties'],'Clear highlights':['close','Clear'],
    'Keep editing':['comment','Keep editing'],'Save draft':['page','Save draft'],'Discard draft':['close','Discard'],
    'Add comment':['plus','Add'],'View comments':['comment','Threads'],'New comment':['plus','New comment'],
    'Publish to GitHub':['send','Publish'],'Publish to GitLab':['send','Publish'],'Download screenshot':['import','Screenshot'],
    'Split schematic + PCB':['flip','Split view'],'Compare commits':['compare','Compare'],
    'Browse designs':['folder','Browse'],'Open review':['comment','Review'],
    'Engineering tools':['tools','Tools'],'Engineering calculators':['calculator','Calculators'],'Calculate':['calculator','Calculate'],
    'PDF viewer':['pdf','PDF viewer'],'Project PDFs':['pdf','Project PDFs'],'Close document':['close','Close document'],
    'Gerber viewer & analyzer':['layers','Gerber analyzer'],'Open Gerber analyzer':['layers','Gerber analyzer'],
    'Import fabrication files':['import','Import files'],'Run analysis':['analytics','Run analysis'],
    'Import BoM / iBOM':['assembly','Import BoM / iBOM'],'BoM manager':['assembly','BoM manager'],
    'Manage variants':['assembly','Manage variants'],'Import variants':['import','Import variants'],
    'Manage':['settings','Manage'],'Manage group':['settings','Manage group'],'Advance assembly':['assembly','Advance assembly'],
    'Next unfinished part':['forward','Next unfinished part'],'Export visible CSV':['import','Export visible CSV'],
    'Export metadata JSON':['import','Export metadata JSON'],'Reset filters':['refresh','Reset filters'],
    'Save management draft':['save','Save management draft'],'Edit KiCad fields':['settings','Edit KiCad fields'],
    'Testpoints & nets':['pin','Testpoints & nets'],'Board analytics':['analytics','Board analytics'],
    'Open selected results report':['analytics','Results report'],'Export CSV':['import','Export CSV'],'Export JSON':['import','Export JSON'],
    'Fit drawing':['fit','Fit drawing'],'Measure':['ruler','Measure'],'New measurement':['ruler','New measurement'],
    'ERC':['erc','ERC'],'DRC':['drc','DRC'],'ERC / DRC':['rules','ERC / DRC'],
    'Show all':['eye','Show all'],'Hide all':['eye-off','Hide all'],'Restore view':['refresh','Restore view'],
    'Previous connection':['back','Previous connection'],'Next connection':['forward','Next connection'],
    'Previous item':['back','Previous item'],'Next item':['forward','Next item'],'Clear reports':['close','Clear reports'],
    'Library':['folder','Library'],'This project':['folder','This project'],'Temporary download':['import','Temporary download'],
    'All sheets':['sheet','All sheets'],'Select text mode':['text','Select text'],'Copy drawing text':['copy','Copy text'],
    'Select all':['text','Select all'],'Save comment':['save','Save comment'],'Cancel':['close','Cancel'],
    'Next unread':['forward','Next unread'],'Post to GitHub':['send','Post to GitHub'],'Post to GitLab':['send','Post to GitLab'],
    'Privacy policy':['info','Privacy policy']
  };
  function actionIcons(scope){
    const links=scope.matches?.('a')?[scope]:[...scope.querySelectorAll('#sourceLink,#githubLink,#installLink')];
    for(const link of links){if(!['sourceLink','githubLink','installLink'].includes(link.id)||link.querySelector('svg'))continue;const name=/gitlab/i.test(link.textContent)?'gitlab':'github';link.prepend(icon(name));link.classList.add('provider-link');}

    const nodes=scope.matches?.('button')?[scope,...scope.querySelectorAll('button')]:[...scope.querySelectorAll('button')];
    for(const node of nodes){if(node.childElementCount)continue;const full=node.textContent.trim(),entry=actions[full];if(!entry)continue;
      const provider=(node.id.startsWith('github')||node.id==='connectGitHub')?'github':(node.id.startsWith('gitlab')||node.id==='connectGitLab')?'gitlab':entry[0];node.dataset.icon=provider;node.classList.add('icon-caption');node.title=node.title||full;
      node.setAttribute('aria-label',node.getAttribute('aria-label')||full);node.replaceChildren(icon(provider),Object.assign(document.createElement('span'),{className:'button-label',textContent:entry[1]}));node.dataset.uiIcon=provider;
    }
  }
  function start(){
    const style=document.createElement('style');style.textContent=':where(.ui-icon){display:block;width:20px;height:20px;flex:0 0 20px;vertical-align:middle}.icon-caption{display:inline-flex;align-items:center;justify-content:center;gap:6px}.icon-caption .button-label{font-size:inherit;line-height:1.3}.ui-brand-github{color:#fff;color:light-dark(#000,#fff)}body[data-ui-theme=light] .ui-brand-github{color:#000}.project-tabs .icon-caption{flex-direction:column;gap:4px;min-height:48px;padding:6px 12px}.project-tabs .button-label{font-size:12px}.provider-link{display:inline-flex;align-items:center;gap:8px;font-size:12px}';document.head.append(style);
    for(const [id,name] of [['githubButton','github'],['gitlabButton','gitlab']]){const b=document.getElementById(id);if(b&&!b.querySelector('svg')){b.prepend(icon(name));b.classList.add('icon-caption');}}
    actionIcons(document);new MutationObserver(records=>{for(const record of records){if(record.target.nodeType===1&&['BUTTON','A'].includes(record.target.tagName))actionIcons(record.target);for(const node of record.addedNodes)if(node.nodeType===1)actionIcons(node);}}).observe(document.body,{childList:true,subtree:true});
  }
  if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();}
  if(typeof module==='object'&&module.exports)module.exports={paths};
})(globalThis);
